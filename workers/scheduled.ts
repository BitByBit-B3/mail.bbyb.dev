// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Env } from "./types";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Delete staged uploads older than 24 hours.
 *
 * Iterates over every mailbox listed in the R2 `mailboxes/` prefix, asks each
 * DO for its stale pending_uploads rows, and deletes the corresponding R2
 * objects. Idempotent — re-running mid-batch is safe.
 */
export async function runOrphanCleanup(env: Env): Promise<void> {
	const cutoff = Date.now() - STALE_AFTER_MS;

	const list = await env.BUCKET.list({ prefix: "mailboxes/", delimiter: "/" });
	for (const obj of list.objects) {
		const match = obj.key.match(/^mailboxes\/(.+?)\.json$/);
		if (!match) continue;
		const mailboxId = match[1];

		// Get a DO stub for this mailbox.
		const id = env.MAILBOX.idFromName(mailboxId);
		const stub = env.MAILBOX.get(id);

		// RPC: list stale rows. The DO method returns { upload_id, r2_key } pairs.
		const stale = await (stub as unknown as {
			listPendingUploadsOlderThan: (cutoff: number) => Promise<Array<{
				upload_id: string;
				r2_key: string;
			}>>;
		}).listPendingUploadsOlderThan(cutoff);

		for (const row of stale) {
			try {
				await env.BUCKET.delete(row.r2_key);
				await (stub as unknown as {
					deletePendingUpload: (id: string) => Promise<void>;
				}).deletePendingUpload(row.upload_id);
				console.log(`cleanup: deleted orphan upload ${row.upload_id} for ${mailboxId}`);
			} catch (e) {
				console.error(`cleanup: failed to delete ${row.upload_id}:`, e);
			}
		}
	}
}
