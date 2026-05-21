// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { z } from "zod";
import { presignR2Put } from "../lib/r2-presign";
import { AttachmentSignRequestSchema } from "../lib/schemas";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;

const ConfirmBodySchema = z.object({
	uploadId: z.string().uuid(),
	filename: z.string().min(1).max(255),
	type: z.string().min(1).max(128),
});

const STAGING_QUOTA_BYTES = 50 * 1024 * 1024 * 1024; // 50 GiB per mailbox

function sanitizeFilename(filename: string): string {
	return (filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
}

function uploadKey(mailboxId: string, uploadId: string): string {
	return `uploads/${mailboxId}/${uploadId}`;
}

export async function handleSignUpload(c: AppContext) {
	const mailboxId = c.req.param("mailboxId")!;
	const body = AttachmentSignRequestSchema.parse(await c.req.json());

	// Enforce per-mailbox staging quota.
	const used = await c.var.mailboxStub.sumPendingUploadSize();
	if (used + body.size > STAGING_QUOTA_BYTES) {
		return c.json(
			{ error: "Staging quota exceeded. Delete unsent files first." },
			413,
		);
	}

	const uploadId = crypto.randomUUID();
	const key = uploadKey(mailboxId, uploadId);

	const { url, expiresAt } = await presignR2Put({
		env: c.env,
		key,
	});

	return c.json({
		uploadId,
		url,
		expiresAt,
		// The client sends these back unchanged on confirm so the server can
		// record them in pending_uploads without re-reading from R2 metadata.
		filename: sanitizeFilename(body.filename),
		mimetype: body.type,
		declaredSize: body.size,
	});
}

export async function handleConfirmUpload(c: AppContext) {
	const mailboxId = c.req.param("mailboxId")!;
	const body = ConfirmBodySchema.parse(await c.req.json());
	const { uploadId, filename, type } = body;

	const key = uploadKey(mailboxId, uploadId);
	const head = await c.env.BUCKET.head(key);
	if (!head) {
		return c.json({ error: "Upload not found." }, 404);
	}

	// R2's stored size is authoritative. The client's declared filename + type
	// are advisory — they're sanitized here and final at send time.
	await c.var.mailboxStub.insertPendingUpload({
		uploadId,
		r2Key: key,
		filename: sanitizeFilename(filename),
		mimetype: type,
		size: head.size,
	});

	return c.json({ uploadId, size: head.size });
}
