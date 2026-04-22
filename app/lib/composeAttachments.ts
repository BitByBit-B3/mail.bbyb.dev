// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ComposeAttachmentPayload, StoredComposeAttachment, UploadedComposeAttachment } from "shared/compose-attachments";
import type { Email } from "~/types";

export type ComposeAttachmentItem = (UploadedComposeAttachment | StoredComposeAttachment) & {
	localId: string;
};

function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
		reader.onload = () => {
			const result = reader.result;
			if (typeof result !== "string") {
				reject(new Error(`Failed to read ${file.name}`));
				return;
			}
			const [, content = ""] = result.split(",", 2);
			resolve(content);
		};
		reader.readAsDataURL(file);
	});
}

function normalizeDisposition(disposition?: string | null): "attachment" | "inline" {
	return disposition === "inline" ? "inline" : "attachment";
}

export async function readFilesAsComposeAttachments(
	files: FileList | File[],
): Promise<ComposeAttachmentItem[]> {
	return Promise.all(
		Array.from(files).map(async (file) => ({
			localId: crypto.randomUUID(),
			kind: "upload" as const,
			filename: file.name || "untitled",
			type: file.type || "application/octet-stream",
			size: file.size,
			content: await readFileAsBase64(file),
			disposition: "attachment" as const,
		})),
	);
}

export function buildStoredComposeAttachments(
	email: Email | null | undefined,
	options?: { includeInline?: boolean },
): ComposeAttachmentItem[] {
	if (!email?.id || !email.attachments?.length) return [];

	return email.attachments
		.filter(
			(attachment) =>
				options?.includeInline || attachment.disposition !== "inline",
		)
		.map((attachment) => ({
			localId: `stored-${attachment.id}`,
			kind: "stored" as const,
			attachmentId: attachment.id,
			emailId: email.id,
			filename: attachment.filename,
			type: attachment.mimetype || "application/octet-stream",
			size: attachment.size,
			disposition: normalizeDisposition(attachment.disposition),
			...(attachment.content_id ? { contentId: attachment.content_id } : {}),
		}));
}

export function serializeComposeAttachments(
	attachments: ComposeAttachmentItem[],
): ComposeAttachmentPayload[] {
	return attachments.map(({ localId: _localId, ...attachment }) => attachment);
}
