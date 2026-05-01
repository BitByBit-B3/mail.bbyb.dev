// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound email via the Cloudflare `send_email` Workers binding.
 *
 * The binding only accepts an `EmailMessage` instance built from raw
 * RFC 5322 MIME — passing a JSON object silently drops attachments and
 * multipart structure. We build MIME with `mimetext` and dispatch one
 * `EmailMessage` per envelope recipient (To + Cc + Bcc) so Bcc stays hidden
 * and additional Tos receive a copy.
 *
 * Refs:
 *  - https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
 *  - https://www.npmjs.com/package/mimetext
 */

import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

function toArray(v?: string | string[]): string[] {
	if (!v) return [];
	return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
}

function normalizeFrom(from: SendEmailParams["from"]): { addr: string; name?: string } {
	if (typeof from === "string") return { addr: from };
	return { addr: from.email, name: from.name };
}

export async function sendEmail(
	binding: SendEmail,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	const tos = toArray(params.to);
	const ccs = toArray(params.cc);
	const bccs = toArray(params.bcc);
	if (tos.length === 0) throw new Error("sendEmail: at least one `to` recipient required");

	const sender = normalizeFrom(params.from);
	const messageId = `<${crypto.randomUUID()}@${sender.addr.split("@")[1] || "bbyb.dev"}>`;

	// Build the visible MIME (To/Cc shown, Bcc hidden — Bcc gets envelope copy only).
	const visible = createMimeMessage();
	visible.setSender(sender.name ? { name: sender.name, addr: sender.addr } : sender.addr);
	visible.setRecipient(tos.length === 1 ? tos[0] : tos);
	for (const cc of ccs) visible.setRecipient(cc, { type: "Cc" });
	visible.setSubject(params.subject);
	visible.setHeader("Message-ID", messageId);

	if (params.replyTo) {
		const rt = normalizeFrom(params.replyTo);
		visible.setHeader("Reply-To", rt.name ? `${rt.name} <${rt.addr}>` : rt.addr);
	}
	if (params.headers) {
		for (const [k, v] of Object.entries(params.headers)) visible.setHeader(k, v);
	}

	if (params.text) visible.addMessage({ contentType: "text/plain", data: params.text });
	if (params.html) visible.addMessage({ contentType: "text/html", data: params.html });
	if (!params.text && !params.html) visible.addMessage({ contentType: "text/plain", data: "" });

	for (const att of params.attachments ?? []) {
		const inline = att.disposition === "inline";
		const headers: Record<string, string> = {};
		if (inline && att.contentId) headers["Content-ID"] = `<${att.contentId}>`;
		visible.addAttachment({
			filename: att.filename,
			contentType: att.type || "application/octet-stream",
			data: att.content,
			...(inline ? { inline: true } : {}),
			...(Object.keys(headers).length ? { headers } : {}),
		} as Parameters<typeof visible.addAttachment>[0]);
	}

	const visibleRaw = visible.asRaw();

	// One envelope dispatch per To + Cc recipient, sharing the same visible MIME.
	for (const rcpt of [...tos, ...ccs]) {
		await binding.send(new EmailMessage(sender.addr, rcpt, visibleRaw));
	}

	// Bcc: separate dispatch per recipient, with no Bcc header in the MIME.
	for (const rcpt of bccs) {
		await binding.send(new EmailMessage(sender.addr, rcpt, visibleRaw));
	}

	return { messageId };
}
