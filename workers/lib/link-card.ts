// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Compose a "download link" card for big attachments that can't be inlined
 * into an SMTP message due to the 25 MiB outbound wall.
 *
 * Two outputs: HTML (a styled table-based card so it renders in older mail
 * clients that strip flexbox) and plaintext (a single-line fallback that
 * appears in the text/plain MIME part).
 */

interface LinkCardInput {
	filename: string;
	size: number;
	downloadUrl: string;
}

export function formatBytesShort(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function renderLinkCardHtml(input: LinkCardInput): string {
	const filename = escapeHtml(input.filename);
	const size = escapeHtml(formatBytesShort(input.size));
	const url = escapeHtml(input.downloadUrl);
	return [
		`<table style="border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin:16px 0;font-family:sans-serif;max-width:480px;">`,
		`<tr>`,
		`<td style="padding-right:12px;vertical-align:top;">&#128206;</td>`,
		`<td>`,
		`<div style="font-weight:600;color:#222;">${filename}</div>`,
		`<div style="font-size:12px;color:#666;margin-top:2px;">${size}</div>`,
		`<div style="margin-top:8px;"><a href="${url}" style="color:#0070f3;text-decoration:none;">Download</a></div>`,
		`</td>`,
		`</tr>`,
		`</table>`,
	].join("");
}

export function renderLinkCardText(input: LinkCardInput): string {
	return `[Attachment: ${input.filename} (${formatBytesShort(input.size)}) — ${input.downloadUrl}]`;
}

export function injectLinkCardsHtml(
	body: string | undefined,
	cards: LinkCardInput[],
): string {
	const cardsHtml = cards.map(renderLinkCardHtml).join("");
	if (!body) return cardsHtml;
	// Append before any closing </body> tag if present, else just append.
	if (/<\/body>/i.test(body)) {
		return body.replace(/<\/body>/i, `${cardsHtml}</body>`);
	}
	return body + cardsHtml;
}

export function injectLinkCardsText(
	body: string | undefined,
	cards: LinkCardInput[],
): string {
	const cardsText = cards.map(renderLinkCardText).join("\n");
	if (!body) return cardsText;
	return body.trimEnd() + "\n\n" + cardsText;
}
