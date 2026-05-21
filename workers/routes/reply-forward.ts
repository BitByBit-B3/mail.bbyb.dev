// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { sendEmail } from "../email-sender";
import {
	materializeComposeAttachments,
	storeMaterializedAttachmentsHybrid,
	stampMailboxOnDownloadTokens,
	toSendEmailAttachments,
	type PersistedAttachmentRecord,
} from "../lib/attachments";
import { injectLinkCardsHtml, injectLinkCardsText } from "../lib/link-card";
import type { EmailFull } from "../lib/schemas";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildReferencesChain,
	buildThreadingHeaders,
	resolveOriginalEmail,
} from "../lib/email-helpers";
import { SendEmailRequestSchema } from "../lib/schemas";
import { Folders } from "../../shared/folders";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;
type RateLimitStub = { checkSendRateLimit: () => Promise<string | null> };

function lookupAttachment(c: AppContext, attachmentId: string) {
	return c.var.mailboxStub.getAttachment(
		attachmentId,
	) as Promise<PersistedAttachmentRecord | null>;
}

export async function handleReplyEmail(c: AppContext) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const id = c.req.param("id") ?? "";
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments } = body;

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	const originalEmail = await resolveOriginalEmail(stub, rawOriginal);
	const { originalMsgId, references, threadId: thread_id } = buildReferencesChain(originalEmail);

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const rateLimitError = await (stub as unknown as RateLimitStub)
		.checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	const materializedAttachments = await materializeComposeAttachments(
		c.env.BUCKET,
		attachments,
		(attachmentId) => lookupAttachment(c, attachmentId),
		(uploadId) => c.var.mailboxStub.getPendingUpload(uploadId),
	);

	const withSources = materializedAttachments.map((m, idx) => {
		const input = attachments?.[idx];
		const sourceR2Key =
			input?.kind === "r2-staged"
				? `uploads/${mailboxId}/${input.uploadId}`
				: undefined;
		return { materialized: m, sourceR2Key };
	});

	const publicBaseUrl = c.req.url
		.replace(/\/api\/v1\/.*$/, "")
		.replace(/\/$/, "");

	const { realAttached, persisted, linkCards } = await storeMaterializedAttachmentsHybrid({
		bucket: c.env.BUCKET,
		emailId: messageId,
		publicBaseUrl,
		attachments: withSources,
	});

	await stampMailboxOnDownloadTokens(
		c.env.BUCKET,
		persisted.filter((p) => p.r2_key !== null && p.r2_key !== undefined).map((p) => p.id),
		mailboxId,
	);

	const htmlWithCards = linkCards.length > 0 ? injectLinkCardsHtml(html, linkCards) : html;
	const textWithCards = linkCards.length > 0 ? injectLinkCardsText(text, linkCards) : text;

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: fromEmail,
			recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date: new Date().toISOString(),
			body: htmlWithCards || textWithCards || "",
			in_reply_to: originalMsgId,
			email_references: JSON.stringify(references),
			thread_id: thread_id,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
				...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
				{ key: "subject", value: subject },
				{ key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
				...(originalMsgId ? [{ key: "in-reply-to", value: `<${originalMsgId}>` }] : []),
				...(references.length > 0 ? [{ key: "references", value: references.map((r: string) => `<${r}>`).join(" ") }] : []),
			]),
		},
		persisted,
	);

	await stub.markThreadRead(thread_id);

	// Synchronous send: block until SMTP accepts (or fails). If sendEmail
	// throws, propagate to a 500 so the client can retry. Only small files
	// (`realAttached`) go into the MIME — big files travel via /d/ link card.
	await sendEmail(c.env.EMAIL, {
		to,
		cc,
		bcc,
		from,
		subject,
		html: htmlWithCards,
		text: textWithCards,
		attachments: toSendEmailAttachments(realAttached),
		headers: buildThreadingHeaders(originalMsgId, references),
	});

	if (attachments) {
		for (const att of attachments) {
			if (att.kind === "r2-staged") {
				await stub.deletePendingUpload(att.uploadId);
			}
		}
	}

	return c.json({ id: messageId, status: "sent" });
}

export async function handleForwardEmail(c: AppContext) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const id = c.req.param("id") ?? "";
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments } = body;

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	await resolveOriginalEmail(stub, rawOriginal);

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const rateLimitError = await (stub as unknown as RateLimitStub)
		.checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	const materializedAttachments = await materializeComposeAttachments(
		c.env.BUCKET,
		attachments,
		(attachmentId) => lookupAttachment(c, attachmentId),
		(uploadId) => c.var.mailboxStub.getPendingUpload(uploadId),
	);

	const withSources = materializedAttachments.map((m, idx) => {
		const input = attachments?.[idx];
		const sourceR2Key =
			input?.kind === "r2-staged"
				? `uploads/${mailboxId}/${input.uploadId}`
				: undefined;
		return { materialized: m, sourceR2Key };
	});

	const publicBaseUrl = c.req.url
		.replace(/\/api\/v1\/.*$/, "")
		.replace(/\/$/, "");

	const { realAttached, persisted, linkCards } = await storeMaterializedAttachmentsHybrid({
		bucket: c.env.BUCKET,
		emailId: messageId,
		publicBaseUrl,
		attachments: withSources,
	});

	await stampMailboxOnDownloadTokens(
		c.env.BUCKET,
		persisted.filter((p) => p.r2_key !== null && p.r2_key !== undefined).map((p) => p.id),
		mailboxId,
	);

	const htmlWithCards = linkCards.length > 0 ? injectLinkCardsHtml(html, linkCards) : html;
	const textWithCards = linkCards.length > 0 ? injectLinkCardsText(text, linkCards) : text;

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: fromEmail,
			recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date: new Date().toISOString(),
			body: htmlWithCards || textWithCards || "",
			in_reply_to: null,
			email_references: null,
			thread_id: messageId,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
				...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
				{ key: "subject", value: subject },
				{ key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
			]),
		},
		persisted,
	);

	await sendEmail(c.env.EMAIL, {
		to,
		cc,
		bcc,
		from,
		subject,
		html: htmlWithCards,
		text: textWithCards,
		attachments: toSendEmailAttachments(realAttached),
	});

	if (attachments) {
		for (const att of attachments) {
			if (att.kind === "r2-staged") {
				await stub.deletePendingUpload(att.uploadId);
			}
		}
	}

	return c.json({ id: messageId, status: "sent" });
}
