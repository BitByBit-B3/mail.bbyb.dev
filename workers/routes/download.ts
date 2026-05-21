// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import type { Env } from "../types";

interface DownloadToken {
	mailboxId: string;
	r2Key: string;
	filename: string;
	mimetype: string;
}

const NOT_FOUND_HTML = `<!doctype html>
<html><head><title>File not available</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#333;text-align:center}</style>
</head><body>
<h1>This file is no longer available</h1>
<p>The sender may have deleted it, or the link is incorrect.</p>
</body></html>`;

export async function handleDownload(c: Context<{ Bindings: Env }>) {
	const attId = c.req.param("attId")!;
	const requestedFilename = c.req.param("filename")!;

	if (!/^[0-9a-f-]{36}$/.test(attId)) {
		return c.html(NOT_FOUND_HTML, 404);
	}

	const tokenKey = `download-tokens/${attId}.json`;
	const tokenObj = await c.env.BUCKET.get(tokenKey);
	if (!tokenObj) {
		return c.html(NOT_FOUND_HTML, 404);
	}
	const token = (await tokenObj.json()) as DownloadToken;

	// Path-safety: the filename in the URL must match the stored filename.
	if (decodeURIComponent(requestedFilename) !== token.filename) {
		return c.html(NOT_FOUND_HTML, 404);
	}

	const fileObj = await c.env.BUCKET.get(token.r2Key);
	if (!fileObj) {
		return c.html(NOT_FOUND_HTML, 404);
	}

	return new Response(fileObj.body, {
		status: 200,
		headers: {
			"Content-Type": token.mimetype,
			"Content-Length": String(fileObj.size),
			"Content-Disposition": `attachment; filename="${encodeRfc5987(token.filename)}"`,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, max-age=3600",
			"X-Robots-Tag": "noindex, nofollow",
		},
	});
}

function encodeRfc5987(filename: string): string {
	// RFC 5987 percent-encoding for Content-Disposition filename parameter.
	// Replaces double-quotes and percent-encodes anything outside RFC 5987's
	// "attr-char" alphabet.
	return filename.replace(/[^\w!#$&+\-.^`|~]/g, (c) =>
		c === '"' ? "" : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
	);
}
