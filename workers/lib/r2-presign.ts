// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { AwsClient } from "aws4fetch";
import type { Env } from "../types";

const DEFAULT_PUT_EXPIRY_SECONDS = 3600;

interface PresignPutInput {
	env: Env;
	key: string;
	expiresInSeconds?: number;
}

/**
 * Generate a presigned S3 PUT URL for an R2 object.
 *
 * The browser uses this URL to upload directly to R2 without the bytes
 * passing through the Worker. We sign ONLY the host header — Content-Type
 * is left unsigned so the browser can set it freely on the PUT request.
 * Signing Content-Type from a browser is fragile (CORS, fetch quirks).
 */
export async function presignR2Put(input: PresignPutInput): Promise<{
	url: string;
	expiresAt: string;
}> {
	const { env, key } = input;
	const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_PUT_EXPIRY_SECONDS;

	const accountId = env.R2_S3_ACCOUNT_ID;
	const bucket = env.R2_S3_BUCKET;
	const accessKeyId = env.R2_S3_ACCESS_KEY_ID;
	const secretAccessKey = env.R2_S3_SECRET_ACCESS_KEY;

	if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
		throw new Error(
			"R2 S3 credentials not configured. Set R2_S3_ACCOUNT_ID, " +
			"R2_S3_BUCKET, R2_S3_ACCESS_KEY_ID, R2_S3_SECRET_ACCESS_KEY.",
		);
	}

	const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeKey(key)}`;
	const url = new URL(endpoint);
	url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

	const client = new AwsClient({
		accessKeyId,
		secretAccessKey,
		service: "s3",
		region: "auto",
	});

	const signed = await client.sign(
		new Request(url.toString(), { method: "PUT" }),
		{ aws: { signQuery: true } },
	);

	return {
		url: signed.url,
		expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
	};
}

function encodeKey(key: string): string {
	// R2 keys may contain slashes that should remain as slashes in the URL path,
	// but every other special char (spaces, etc.) must be percent-encoded.
	return key.split("/").map(encodeURIComponent).join("/");
}
