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

/**
 * SMTP-attached size ceiling. Files at or below this go into the outbound
 * MIME message; files above are uploaded once and delivered as a download
 * link card injected into the body. The 10 MiB threshold leaves headroom
 * under the Email Workers 25 MiB outbound cap.
 */
export const REAL_ATTACH_THRESHOLD_BYTES = 10 * 1024 * 1024;

export function shouldSendAsLink(att: {
	size: number;
	disposition: "attachment" | "inline";
}): boolean {
	// Inline images (e.g. signature embeds) always go as real attachments
	// regardless of size — they're referenced by CID from the HTML body.
	if (att.disposition === "inline") return false;
	return att.size > REAL_ATTACH_THRESHOLD_BYTES;
}

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

export type PendingUploadLookup = (
	uploadId: string,
) => Promise<{
	upload_id: string;
	r2_key: string;
	filename: string;
	mimetype: string;
	size: number;
	created_at: number;
} | null>;

function sanitizeFilename(filename: string) {
	return (filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
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
	lookupPendingUpload?: PendingUploadLookup,
): Promise<MaterializedAttachment> {
	if (attachment.kind === "r2-staged") {
		// R2 staged attachments live at `uploads/<mailboxId>/<uploadId>`.
		// The caller (send route) has already validated ownership via the
		// pending_uploads row — we trust the r2_key recorded there.
		if (!lookupPendingUpload) {
			throw new Error(
				"r2-staged attachments require lookupPendingUpload context.",
			);
		}
		const pending = await lookupPendingUpload(attachment.uploadId);
		if (!pending) {
			throw new Error(`Pending upload ${attachment.uploadId} not found.`);
		}
		const object = await bucket.get(pending.r2_key);
		if (!object) {
			throw new Error(
				`R2 object missing for upload ${attachment.uploadId}.`,
			);
		}
		const bytes = new Uint8Array(await object.arrayBuffer());
		return {
			filename: sanitizeFilename(pending.filename),
			mimetype:
				pending.mimetype || attachment.type || "application/octet-stream",
			size: bytes.byteLength,
			contentId: attachment.contentId,
			disposition: attachment.disposition,
			bytes,
		};
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
	lookupPendingUpload?: PendingUploadLookup,
): Promise<MaterializedAttachment[]> {
	if (!attachments?.length) return [];
	return Promise.all(
		attachments.map((attachment) =>
			materializeAttachment(
				bucket,
				attachment,
				lookupAttachment,
				lookupPendingUpload,
			),
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

interface HybridStoreInput {
	bucket: Env["BUCKET"];
	emailId: string;
	publicBaseUrl: string; // e.g. "https://mail.bbyb.dev"
	attachments: Array<{
		materialized: MaterializedAttachment;
		// If this is r2-staged, the original r2Key (so we can skip re-uploading).
		sourceR2Key?: string;
	}>;
}

interface HybridStoreOutput {
	realAttached: MaterializedAttachment[]; // → these go into the MIME
	persisted: StoredAttachment[]; // → attachments rows
	linkCards: Array<{ filename: string; size: number; downloadUrl: string }>;
}

/**
 * Decide per-attachment whether to inline (≤ 10 MiB) or link-deliver (> 10 MiB).
 *
 * - Small files get stream-copied to `attachments/<emailId>/<attId>/<filename>`
 *   to match the existing inbound convention (`r2_key = NULL`).
 * - Big files stay at their source key (`r2_key` stamped explicitly).
 * - For each link-delivered attachment, write a download-token JSON object so
 *   the unauthenticated `/d/...` route can serve it.
 */
export async function storeMaterializedAttachmentsHybrid(
	input: HybridStoreInput,
): Promise<HybridStoreOutput> {
	const realAttached: MaterializedAttachment[] = [];
	const persisted: StoredAttachment[] = [];
	const linkCards: Array<{ filename: string; size: number; downloadUrl: string }> = [];

	for (const { materialized, sourceR2Key } of input.attachments) {
		const attachmentId = crypto.randomUUID();
		const sendAsLink = shouldSendAsLink({
			size: materialized.size,
			disposition: materialized.disposition,
		});

		const safeFilename = sanitizeFilename(materialized.filename);

		if (sendAsLink) {
			// Big file — keep at source key. If somehow sourceR2Key is missing
			// (e.g. an `upload` kind that's still in the base64 path), put it
			// to a stable location first.
			let r2Key = sourceR2Key;
			if (!r2Key) {
				r2Key = `attachments/${input.emailId}/${attachmentId}/${safeFilename}`;
				await input.bucket.put(r2Key, materialized.bytes, {
					httpMetadata: { contentType: materialized.mimetype },
				});
			}

			// Write the download token so /d/ can serve it.
			const tokenKey = `download-tokens/${attachmentId}.json`;
			await input.bucket.put(
				tokenKey,
				JSON.stringify({
					mailboxId: "", // filled by caller via stampMailboxOnDownloadTokens
					r2Key,
					filename: safeFilename,
					mimetype: materialized.mimetype,
				}),
				{ httpMetadata: { contentType: "application/json" } },
			);

			persisted.push({
				id: attachmentId,
				email_id: input.emailId,
				filename: safeFilename,
				mimetype: materialized.mimetype,
				size: materialized.size,
				content_id: materialized.contentId ?? null,
				disposition: materialized.disposition,
				r2_key: r2Key,
			});

			const downloadUrl = `${input.publicBaseUrl}/d/${input.emailId}/${attachmentId}/${encodeURIComponent(safeFilename)}`;
			linkCards.push({
				filename: safeFilename,
				size: materialized.size,
				downloadUrl,
			});
		} else {
			// Small file — stream-copy to per-email location.
			const r2Key = `attachments/${input.emailId}/${attachmentId}/${safeFilename}`;
			await input.bucket.put(r2Key, materialized.bytes, {
				httpMetadata: { contentType: materialized.mimetype },
			});
			persisted.push({
				id: attachmentId,
				email_id: input.emailId,
				filename: safeFilename,
				mimetype: materialized.mimetype,
				size: materialized.size,
				content_id: materialized.contentId ?? null,
				disposition: materialized.disposition,
				r2_key: null,
			});
			realAttached.push(materialized);
		}
	}

	return { realAttached, persisted, linkCards };
}

/**
 * Backfill the `mailboxId` field on download-token JSON blobs after the
 * hybrid store has run. Kept out of the hybrid store itself because it
 * doesn't naturally know which mailbox the email belongs to.
 */
export async function stampMailboxOnDownloadTokens(
	bucket: Env["BUCKET"],
	attachmentIds: string[],
	mailboxId: string,
): Promise<void> {
	if (attachmentIds.length === 0) return;
	await Promise.all(
		attachmentIds.map(async (attId) => {
			const key = `download-tokens/${attId}.json`;
			const obj = await bucket.get(key);
			if (!obj) return;
			const data = (await obj.json()) as {
				mailboxId: string;
				r2Key: string;
				filename: string;
				mimetype: string;
			};
			const updated = { ...data, mailboxId };
			await bucket.put(key, JSON.stringify(updated), {
				httpMetadata: { contentType: "application/json" },
			});
		}),
	);
}
