// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import { sendEmail } from "./email-sender";
import { enqueueSend } from "./lib/outbound-queue";
import {
	deleteAttachmentBlobs,
	materializeComposeAttachments,
	storeMaterializedAttachments,
	toSendEmailAttachments,
	type PersistedAttachmentRecord,
	type StoredAttachment,
} from "./lib/attachments";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
	stripHtmlToText,
} from "./lib/email-helpers";
import { ComposeAttachmentSchema, SendEmailRequestSchema } from "./lib/schemas";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { handleSignUpload } from "./routes/attachments";
import { generateEmailDraft } from "./lib/ai";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	settings: z.record(z.any()).optional(), // unvalidated — agentSystemPrompt goes straight to AI
});

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	attachments: z.array(ComposeAttachmentSchema).optional(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

function lookupAttachment(c: AppContext, attachmentId: string) {
	return c.var.mailboxStub.getAttachment(
		attachmentId,
	) as Promise<PersistedAttachmentRecord | null>;
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		try {
			const url = new URL(origin);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
		} catch { /* invalid origin */ }
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const domainsRaw = c.env.DOMAINS || "";
	const domains = domainsRaw.split(",").map((d) => d.trim()).filter(Boolean);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ domains, emailAddresses });
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const allMailboxes = await listMailboxes(c.env.BUCKET);
	return c.json(allMailboxes.map((m) => ({ ...m, name: m.id })));
});

app.post("/api/v1/mailboxes", async (c) => {
	const { name, settings, email: rawEmail } = CreateMailboxBody.parse(await c.req.json());
	const email = rawEmail.toLowerCase();
	const allowedAddresses = (c.env.EMAIL_ADDRESSES ?? []) as string[];
	if (allowedAddresses.length > 0 && !allowedAddresses.map((a) => a.toLowerCase()).includes(email)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}
	const key = `mailboxes/${email}.json`;
	if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
	const defaultSettings = { fromName: name, forwarding: { enabled: false, email: "" }, signature: { enabled: false, text: "" }, autoReply: { enabled: false, subject: "", message: "" } };
	const finalSettings = { ...defaultSettings, ...settings };
	await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
	await stub.getFolders();
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const obj = await c.env.BUCKET.get(`mailboxes/${mailboxId}.json`);
	if (!obj) return c.json({ error: "Not found" }, 404);
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: await obj.json() });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { settings } = (await c.req.json()) as { settings: Record<string, unknown> };
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.put(key, JSON.stringify(settings));
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings });
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const settingsKey = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(settingsKey))) return c.json({ error: "Not found" }, 404);

	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(mailboxId)) as unknown as {
		wipeMailbox: () => Promise<{ attachmentKeys: string[] }>;
	};
	const { attachmentKeys } = await stub.wipeMailbox();

	const avatarKey = `avatars/${mailboxId}`;
	const keysToDelete = [settingsKey, avatarKey, ...attachmentKeys];
	// R2 delete accepts up to 1000 keys per call.
	for (let i = 0; i < keysToDelete.length; i += 1000) {
		await c.env.BUCKET.delete(keysToDelete.slice(i, i + 1000));
	}
	return c.body(null, 204);
});

// Avatar upload
app.post("/api/v1/mailboxes/:mailboxId/avatar", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const formData = await c.req.formData();
	const file = formData.get("file") as File | null;
	if (!file) return c.json({ error: "No file provided" }, 400);

	const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
	if (!ALLOWED.includes(file.type))
		return c.json({ error: "File must be JPEG, PNG, or WebP" }, 400);

	if (file.size > 2 * 1024 * 1024)
		return c.json({ error: "File must be under 2 MB" }, 400);

	const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
	const avatarKey = `avatars/${mailboxId}.${ext}`;

	await c.env.BUCKET.put(avatarKey, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type },
	});

	// Clean up old avatar files with other extensions
	for (const oldExt of ["jpg", "png", "webp"]) {
		if (`avatars/${mailboxId}.${oldExt}` !== avatarKey) {
			await c.env.BUCKET.delete(`avatars/${mailboxId}.${oldExt}`).catch(() => {});
		}
	}

	const settingsKey = `mailboxes/${mailboxId}.json`;
	const existing = await c.env.BUCKET.get(settingsKey);
	const settings = existing ? ((await existing.json()) as Record<string, unknown>) : {};
	const avatarUrl = `/avatars/${mailboxId}.${ext}`;
	await c.env.BUCKET.put(settingsKey, JSON.stringify({ ...settings, avatarUrl }));

	return c.json({ avatarUrl });
});

// Avatar delete
app.delete("/api/v1/mailboxes/:mailboxId/avatar", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;

	for (const ext of ["jpg", "png", "webp"]) {
		await c.env.BUCKET.delete(`avatars/${mailboxId}.${ext}`).catch(() => {});
	}

	const settingsKey = `mailboxes/${mailboxId}.json`;
	const existing = await c.env.BUCKET.get(settingsKey);
	if (existing) {
		const settings = (await existing.json()) as Record<string, unknown>;
		const { avatarUrl: _removed, ...rest } = settings;
		await c.env.BUCKET.put(settingsKey, JSON.stringify(rest));
	}

	return c.body(null, 204);
});

// -- AI Compose (streaming) -----------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/ai-compose", async (c: AppContext) => {
	const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
	const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
	const subject = typeof body.subject === "string" ? body.subject : undefined;
	const to = typeof body.to === "string" ? body.to : undefined;
	const existing = typeof body.existing === "string" ? body.existing : undefined;

	const sseStream = await generateEmailDraft(c.env.AI, { prompt, subject, to, existing });

	// Transform SSE (data: {"response":"chunk"}\n\n) → plain text chunks
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const plainStream = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			const text = decoder.decode(chunk, { stream: true });
			for (const line of text.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;
				const json = trimmed.slice(5).trim();
				if (json === "[DONE]") continue;
				try {
					const parsed = JSON.parse(json) as { response?: string };
					if (parsed.response) controller.enqueue(encoder.encode(parsed.response));
				} catch {}
			}
		},
	});

	sseStream.pipeTo(plainStream.writable);

	return new Response(plainStream.readable, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "no-store",
		},
	});
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;
	const tag = c.req.query("tag");

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit, tag });
		const totalCount = await (stub as any).countThreadedEmails(folder, tag);
		return c.json({ emails, totalCount });
	}
	const emails = await (stub as any).getEmails({ folder, thread_id, tag, page, limit, sortColumn, sortDirection }) as any[];
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments, in_reply_to, references, thread_id } = body;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await (stub as any).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	const materializedAttachments = await materializeComposeAttachments(
		c.env.BUCKET,
		attachments,
		(attachmentId) => lookupAttachment(c, attachmentId),
	);
	const attachmentData = await storeMaterializedAttachments(
		c.env.BUCKET,
		messageId,
		materializedAttachments,
	);

	await stub.createEmail(Folders.SENT, {
		id: messageId, subject, sender: fromEmail, recipient: toStr,
		cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
		bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
		date: new Date().toISOString(), body: html || text || "",
		in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
		thread_id: thread_id || in_reply_to || messageId, message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
			...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
			...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
			{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
		]),
	}, attachmentData);

	const { jobId } = await enqueueSend(c.env, mailboxId, messageId, {
		to, cc, bcc, from, subject, html, text,
		attachments: toSendEmailAttachments(materializedAttachments),
		...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
	});
	return c.json({ id: messageId, jobId, status: "queued" }, 202);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { to, cc, bcc, subject, body, attachments, in_reply_to, thread_id, draft_id } = DraftBody.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	const materializedAttachments = await materializeComposeAttachments(
		c.env.BUCKET,
		attachments,
		(attachmentId) => lookupAttachment(c, attachmentId),
	);
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	const attachmentData = await storeMaterializedAttachments(
		c.env.BUCKET,
		messageId,
		materializedAttachments,
	);
	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: subject || "", sender: mailboxId.toLowerCase(),
		recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null, bcc: bcc?.toLowerCase() || null,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: thread_id || in_reply_to || messageId,
	}, attachmentData);
	// Delete old draft only after new one is safely persisted
	if (draft_id) {
		const deletedAttachments = await stub.deleteEmail(draft_id);
		if (deletedAttachments?.length) {
			await deleteAttachmentBlobs(c.env.BUCKET, draft_id, deletedAttachments);
		}
	}
	return c.json({ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	await deleteAttachmentBlobs(c.env.BUCKET, id, attachments);
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Big attachments (direct R2 upload) -----------------------------

app.post("/api/v1/mailboxes/:mailboxId/attachments/sign", handleSignUpload);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()));

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const body = (await c.req.json()) as { name: string; filter_prompt?: string };
	const { name, filter_prompt } = body;
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const prompt = typeof filter_prompt === "string" && filter_prompt.trim() ? filter_prompt.trim() : null;
	const f = await (c.var.mailboxStub as any).createFolder(slug, name, 1, prompt);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const body = (await c.req.json()) as { name?: string; filter_prompt?: string };
	const { name, filter_prompt } = body;
	if (!name) return c.json({ error: "name is required" }, 400);
	const prompt = filter_prompt !== undefined
		? (typeof filter_prompt === "string" && filter_prompt.trim() ? filter_prompt.trim() : null)
		: undefined;
	const f = await (c.var.mailboxStub as any).updateFolder(c.req.param("id")!, name, prompt);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
	};
	const stub = c.var.mailboxStub as any;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment || attachment.email_id !== emailId) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	// Buffer fully — streaming strips Content-Length in Workers, causing truncated downloads
	const bytes = await obj.arrayBuffer();
	const headers = new Headers();
	obj.writeHttpMetadata(headers);
	// Fallback content-type if not stored in R2 metadata
	if (!headers.get("Content-Type")) {
		headers.set("Content-Type", attachment.mimetype || "application/octet-stream");
	}
	headers.set("Content-Length", bytes.byteLength.toString());
	headers.set("Cache-Control", "private, no-store");
	const disposition = c.req.query("disposition") === "inline" ? "inline" : "attachment";
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set(
		"Content-Disposition",
		`${disposition}; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
	);
	return new Response(bytes, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	// Slice to actual bytes — trailing zero-pad confuses MIME boundary scanning
	// and can truncate attachments mid-stream.
	return bytesRead === streamSize ? result : result.subarray(0, bytesRead);
}

async function receiveEmail(event: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	// Force base64 mode so attachment.content is always a base64 string —
	// removes the "is it ArrayBuffer / Uint8Array / string?" guessing game.
	const parsedEmail = await new PostalMime({ attachmentEncoding: "base64" }).parse(rawEmail);

	const allowedAddresses = ((env.EMAIL_ADDRESSES ?? []) as string[]).map((a) => a.toLowerCase());
	const envelopeRecipient = event.to.trim().toLowerCase();
	if (!envelopeRecipient) throw new Error("received email with empty envelope recipient");

	const allRecipients = (parsedEmail.to || []).map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];

	if (allowedAddresses.length > 0) {
		if (!allowedAddresses.includes(envelopeRecipient)) {
			console.log(`Ignoring email for ${envelopeRecipient}: recipient not in EMAIL_ADDRESSES.`);
			return;
		}
	}

	const mailboxId = envelopeRecipient;

	const messageId = crypto.randomUUID();
	if (!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) { console.log(`Ignoring email for ${mailboxId}: mailbox does not exist`); return; }

	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));

	const attachmentData: StoredAttachment[] = [];
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			// PostalMime is in base64 mode — content is always a base64 string. Decode once.
			const b64 = (typeof att.content === "string" ? att.content : "").replace(/\s/g, "");
			const bin = atob(b64);
			const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
			const mimetype = att.mimeType || "application/octet-stream";
			await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, bytes, {
				httpMetadata: { contentType: mimetype },
			});
			attachmentData.push({ id: attId, email_id: messageId, filename, mimetype,
				size: bytes.byteLength,
				content_id: att.contentId || null, disposition: att.disposition || "attachment" });
		}
	}

	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
	let threadId = emailReferences[0] || inReplyTo || messageId;

	if (!inReplyTo && emailReferences.length === 0) {
		const subjectThread = await (stub as any).findThreadBySubject(parsedEmail.subject || "", parsedEmail.from?.address || undefined);
		if (subjectThread) threadId = subjectThread;
	}

	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

	await stub.createEmail(Folders.INBOX, {
		id: messageId, subject: parsedEmail.subject || "",
		sender: (parsedEmail.from?.address || "").toLowerCase(),
		recipient: allRecipients.join(", ") || mailboxId,
		cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
		date: new Date().toISOString(), // uses receive time, not the email's Date header
		body: parsedEmail.html || parsedEmail.text || "",
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: JSON.stringify(parsedEmail.headers),
	}, attachmentData);

	// AI tag classification — non-blocking, never delays delivery
	ctx.waitUntil(
		(async () => {
			try {
				const foldersWithPrompts = await (stub as any).getFoldersWithPrompts() as Array<{ id: string; name: string; filter_prompt: string }>;
				if (foldersWithPrompts.length === 0) return;
				const { classifyEmailTags } = await import("./lib/ai");
				const bodyText = stripHtmlToText(parsedEmail.html || parsedEmail.text || "");
				const tags = await classifyEmailTags(env.AI, {
					subject: parsedEmail.subject || "",
					sender: (parsedEmail.from?.address || "").toLowerCase(),
					bodyText,
				}, foldersWithPrompts);
				if (tags.length > 0) {
					await (stub as any).setEmailTags(messageId, tags);
				}
			} catch (e) {
				console.error("AI tag classification failed:", (e as Error).message);
			}
		})(),
	);

	// Forward if enabled
	const mailboxSettingsObj = await env.BUCKET.get(`mailboxes/${mailboxId}.json`);
	if (mailboxSettingsObj) {
		const mailboxSettings = (await mailboxSettingsObj.json()) as {
			forwarding?: { enabled?: boolean; email?: string };
		};
		if (mailboxSettings?.forwarding?.enabled && mailboxSettings.forwarding.email) {
			ctx.waitUntil(
				sendEmail(env.EMAIL, {
					to: mailboxSettings.forwarding.email,
					from: mailboxId,
					subject: `Fwd: ${parsedEmail.subject || ""}`,
					html: parsedEmail.html || `<pre>${parsedEmail.text || ""}</pre>`,
					text: parsedEmail.text || "",
				}).catch((e: Error) =>
					console.error("Email forwarding failed:", e.message),
				),
			);
		}
	}

	// Auto-draft on every inbound disabled — the agent only runs when the user
	// chats with it from the AgentPanel.
}

export { app, receiveEmail };
