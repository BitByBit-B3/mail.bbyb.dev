// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared attachment storage logic.
 * Eliminates the triplicated attachment materialization and R2.put pattern.
 */
import type { ComposeAttachmentPayload } from "../../shared/compose-attachments";
import type { SendEmailParams } from "../email-sender";
import type { Env } from "../types";

export interface StoredAttachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string | null;
	r2_key?: string | null;
}

/**
 * Resolve the R2 key for an attachment row.
 *
 * Legacy rows (r2_key NULL) use the implicit convention
 * `attachments/<emailId>/<id>/<filename>`. New big-file attachments
 * stamp `r2_key` explicitly because they live at
 * `uploads/<mailboxId>/<uploadId>` (no copy).
 */
export function attachmentR2Key(att: {
	id: string;
	email_id: string;
	filename: string;
	r2_key?: string | null;
}): string {
	if (att.r2_key) return att.r2_key;
	return `attachments/${att.email_id}/${att.id}/${att.filename}`;
}

export interface PersistedAttachmentRecord extends StoredAttachment {}

export interface MaterializedAttachment {
	filename: string;
	mimetype: string;
	size: number;
	contentId?: string;
	disposition: "attachment" | "inline";
	bytes: Uint8Array;
}

type AttachmentLookup = (
	attachmentId: string,
) => Promise<PersistedAttachmentRecord | null>;

function sanitizeFilename(filename: string) {
	return (filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
}

function decodeBase64(content: string) {
	// Strip whitespace — MIME base64 may have \r\n line breaks that atob() rejects
	const binaryStr = atob(content.replace(/\s/g, ""));
	return Uint8Array.from(binaryStr, (char) => char.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array) {
	const CHUNK_SIZE = 0x8000;
	let binary = "";
	for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
		const chunk = bytes.subarray(index, index + CHUNK_SIZE);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

function normalizeDisposition(
	disposition?: string | null,
): "attachment" | "inline" {
	return disposition === "inline" ? "inline" : "attachment";
}

async function materializeAttachment(
	bucket: Env["BUCKET"],
	attachment: ComposeAttachmentPayload,
	lookupAttachment?: AttachmentLookup,
): Promise<MaterializedAttachment> {
	if (attachment.kind === "upload") {
		const bytes = decodeBase64(attachment.content);
		return {
			filename: sanitizeFilename(attachment.filename),
			mimetype: attachment.type || "application/octet-stream",
			size: bytes.byteLength,
			contentId: attachment.contentId,
			disposition: attachment.disposition,
			bytes,
		};
	}

	if (attachment.kind === "r2-staged") {
		throw new Error(
			"r2-staged materialization not yet implemented (see Task 1.8)",
		);
	}

	if (!lookupAttachment) {
		throw new Error("Stored attachments are not supported in this context.");
	}

	const stored = await lookupAttachment(attachment.attachmentId);
	if (!stored || stored.email_id !== attachment.emailId) {
		throw new Error("Attachment not found.");
	}

	const objectKey = attachmentR2Key(stored);
	const object = await bucket.get(objectKey);
	if (!object) {
		throw new Error("Attachment file not found.");
	}

	const bytes = new Uint8Array(await object.arrayBuffer());
	return {
		filename: stored.filename,
		mimetype: stored.mimetype || attachment.type || "application/octet-stream",
		size: bytes.byteLength,
		contentId: stored.content_id || attachment.contentId,
		disposition: normalizeDisposition(stored.disposition || attachment.disposition),
		bytes,
	};
}

export async function materializeComposeAttachments(
	bucket: Env["BUCKET"],
	attachments?: ComposeAttachmentPayload[],
	lookupAttachment?: AttachmentLookup,
): Promise<MaterializedAttachment[]> {
	if (!attachments?.length) return [];
	return Promise.all(
		attachments.map((attachment) =>
			materializeAttachment(bucket, attachment, lookupAttachment),
		),
	);
}

/**
 * Store materialized attachments to R2 and return metadata for the DO.
 */
export async function storeMaterializedAttachments(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments: MaterializedAttachment[],
): Promise<StoredAttachment[]> {
	if (!attachments.length) return [];

	const results: StoredAttachment[] = [];
	for (const att of attachments) {
		const attachmentId = crypto.randomUUID();
		const safeFilename = sanitizeFilename(att.filename);
		const key = `attachments/${emailId}/${attachmentId}/${safeFilename}`;
		await bucket.put(key, att.bytes, {
			httpMetadata: { contentType: att.mimetype },
		});
		results.push({
			id: attachmentId,
			email_id: emailId,
			filename: safeFilename,
			mimetype: att.mimetype,
			size: att.size,
			content_id: att.contentId || null,
			disposition: att.disposition,
		});
	}
	return results;
}

export function toSendEmailAttachments(
	attachments: MaterializedAttachment[],
): SendEmailParams["attachments"] {
	if (attachments.length === 0) return undefined;

	return attachments.map((attachment) => ({
		content: encodeBase64(attachment.bytes),
		filename: attachment.filename,
		type: attachment.mimetype,
		disposition: attachment.disposition,
		...(attachment.contentId ? { contentId: attachment.contentId } : {}),
	}));
}

export async function deleteAttachmentBlobs(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments: Array<{ id: string; filename: string }>,
) {
	if (attachments.length === 0) return;
	await bucket.delete(
		attachments.map(
			(attachment) =>
				`attachments/${emailId}/${attachment.id}/${attachment.filename}`,
		),
	);
}
