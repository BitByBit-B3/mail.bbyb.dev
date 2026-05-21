// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type {
	ComposeAttachmentPayload,
	R2StagedComposeAttachment,
	StoredComposeAttachment,
} from "shared/compose-attachments";
import type { Email } from "~/types";

export type ComposeAttachmentItem = (
	| StoredComposeAttachment
	| R2StagedComposeAttachment
) & {
	localId: string;
};

export interface UploadController {
	abort: () => void;
}

export interface UploadProgress {
	localId: string;
	phase: "signing" | "uploading" | "confirming" | "done" | "error";
	bytesUploaded?: number;
	totalBytes?: number;
	error?: string;
}

function normalizeDisposition(disposition?: string | null): "attachment" | "inline" {
	return disposition === "inline" ? "inline" : "attachment";
}

export interface UploadStartedItem {
	localId: string;
	filename: string;
	type: string;
	size: number;
}

/**
 * Sign → PUT → confirm. Yields one ComposeAttachmentItem per file (r2-staged kind).
 *
 * Uses XMLHttpRequest for the PUT step because `fetch()` does not expose upload
 * progress events in Workers and most browser/runtime combos.
 *
 * @param onItemStart Optional callback fired with the assigned localId before
 *   the sign step. Lets the caller render a row + progress bar immediately.
 * @param onItemFailed Optional callback fired when a file's upload fails or is
 *   aborted, so the caller can remove its placeholder row.
 */
export async function uploadFilesToR2(
	files: FileList | File[],
	mailboxId: string,
	onProgress: (p: UploadProgress) => void,
	controllers: Map<string, UploadController>,
	callbacks?: {
		onItemStart?: (item: UploadStartedItem) => void;
		onItemFailed?: (localId: string) => void;
	},
): Promise<ComposeAttachmentItem[]> {
	const items: ComposeAttachmentItem[] = [];

	for (const file of Array.from(files)) {
		const localId = crypto.randomUUID();
		const controller = new AbortController();
		controllers.set(localId, { abort: () => controller.abort() });

		callbacks?.onItemStart?.({
			localId,
			filename: file.name || "untitled",
			type: file.type || "application/octet-stream",
			size: file.size,
		});

		try {
			onProgress({ localId, phase: "signing", totalBytes: file.size });

			// 1. Sign
			const signRes = await fetch(
				`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/attachments/sign`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						filename: file.name || "untitled",
						size: file.size,
						type: file.type || "application/octet-stream",
					}),
					signal: controller.signal,
				},
			);
			if (!signRes.ok) {
				throw new Error(`sign failed: ${signRes.status}`);
			}
			const { uploadId, url } = (await signRes.json()) as {
				uploadId: string;
				url: string;
			};

			// 2. PUT — via XHR so we get progress events
			onProgress({
				localId,
				phase: "uploading",
				bytesUploaded: 0,
				totalBytes: file.size,
			});
			await xhrPut(url, file, controller.signal, (loaded) => {
				onProgress({
					localId,
					phase: "uploading",
					bytesUploaded: loaded,
					totalBytes: file.size,
				});
			});

			// 3. Confirm
			onProgress({ localId, phase: "confirming", totalBytes: file.size });
			const confirmRes = await fetch(
				`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/attachments/confirm`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						uploadId,
						filename: file.name || "untitled",
						type: file.type || "application/octet-stream",
					}),
					signal: controller.signal,
				},
			);
			if (!confirmRes.ok) {
				throw new Error(`confirm failed: ${confirmRes.status}`);
			}

			onProgress({
				localId,
				phase: "done",
				bytesUploaded: file.size,
				totalBytes: file.size,
			});

			const item: ComposeAttachmentItem = {
				localId,
				kind: "r2-staged",
				uploadId,
				filename: file.name || "untitled",
				type: file.type || "application/octet-stream",
				size: file.size,
				disposition: "attachment",
			};
			items.push(item);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Upload failed";
			onProgress({ localId, phase: "error", error: msg });
			callbacks?.onItemFailed?.(localId);
			// Don't push to items — caller drops failed uploads from the compose form.
		} finally {
			controllers.delete(localId);
		}
	}

	return items;
}

function xhrPut(
	url: string,
	file: File | Blob,
	signal: AbortSignal,
	onProgress: (loaded: number) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", url);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(e.loaded);
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else reject(new Error(`PUT failed: ${xhr.status} ${xhr.statusText}`));
		};
		xhr.onerror = () => reject(new Error("network error during upload"));
		xhr.onabort = () => reject(new Error("upload aborted"));
		signal.addEventListener("abort", () => xhr.abort());
		xhr.send(file);
	});
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
