// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export type ComposeAttachmentDisposition = "attachment" | "inline";

export interface UploadedComposeAttachment {
	kind: "upload";
	filename: string;
	type: string;
	size: number;
	content: string;
	disposition: ComposeAttachmentDisposition;
	contentId?: string;
}

export interface StoredComposeAttachment {
	kind: "stored";
	attachmentId: string;
	emailId: string;
	filename: string;
	type: string;
	size: number;
	disposition: ComposeAttachmentDisposition;
	contentId?: string;
}

export interface R2StagedComposeAttachment {
	kind: "r2-staged";
	uploadId: string;
	filename: string;
	type: string;
	size: number;
	disposition: ComposeAttachmentDisposition;
	contentId?: string;
}

export type ComposeAttachmentPayload =
	| UploadedComposeAttachment
	| StoredComposeAttachment
	| R2StagedComposeAttachment;
