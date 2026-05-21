// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared types and Zod schemas for email data.
 *
 * Types (from email-types.ts): used by the agent, MCP server, and route
 * handlers to avoid `as any` casting.
 *
 * Zod schemas: used across route handlers to eliminate duplication.
 */
import { z } from "zod";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	folder_id?: string | null;
	snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
	body?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([
	z.string().email(),
	z.array(z.string().email()).min(1),
]);

export const ComposeAttachmentSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("upload"),
		content: z.string(),
		filename: z.string(),
		type: z.string(),
		size: z.number().int().nonnegative(),
		disposition: z.enum(["attachment", "inline"]),
		contentId: z.string().optional(),
	}),
	z.object({
		kind: z.literal("stored"),
		attachmentId: z.string(),
		emailId: z.string(),
		filename: z.string(),
		type: z.string(),
		size: z.number().int().nonnegative(),
		disposition: z.enum(["attachment", "inline"]),
		contentId: z.string().optional(),
	}),
	z.object({
		kind: z.literal("r2-staged"),
		uploadId: z.string().uuid(),
		filename: z.string(),
		type: z.string(),
		size: z.number().int().nonnegative(),
		disposition: z.enum(["attachment", "inline"]),
		contentId: z.string().optional(),
	}),
]);

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

export const SendEmailRequestSchema = z
	.object({
		to: RecipientFieldSchema,
		cc: RecipientFieldSchema.optional(),
		bcc: RecipientFieldSchema.optional(),
		from: z.union([
			z.string().email(),
			z.object({ email: z.string().email(), name: z.string() }),
		]),
		subject: z.string(),
		html: z.string().optional(),
		text: z.string().optional(),
		attachments: z
			.array(ComposeAttachmentSchema)
			.optional(),
		in_reply_to: z.string().optional(),
		references: z.array(z.string()).optional(),
		thread_id: z.string().optional(),
	})
	.refine((data) => data.html || data.text, {
		message: "Either 'html' or 'text' must be provided",
	});

export const SendEmailResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
});

export const AttachmentSignRequestSchema = z.object({
	filename: z.string().min(1).max(255),
	size: z.number().int().positive().max(5 * 1024 * 1024 * 1024), // 5 GiB
	type: z.string().min(1).max(128),
});

export const AttachmentConfirmRequestSchema = z.object({
	uploadId: z.string().uuid(),
});
