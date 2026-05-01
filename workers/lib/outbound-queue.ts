// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound email queue.
 *
 * Why a queue: synchronous SMTP dispatch via env.EMAIL.send() can take a
 * couple seconds per recipient and has no retry semantics under
 * ctx.waitUntil(). Cloudflare Queues gives us automatic retries (3 attempts),
 * a dead-letter queue for permanent failures, and observability. The user's
 * Sent-folder write still happens synchronously so the email shows up
 * instantly in their UI; only the actual dispatch is async.
 *
 * Sizing: SendEmailParams + base64 attachments can exceed the 128 KB queue
 * message limit, so we stage the payload to R2 (`outbox/<jobId>.json`) and
 * enqueue just `{ jobId, mailboxId, sentEmailId }`.
 */

import type { SendEmailParams } from "../email-sender";
import { sendEmail } from "../email-sender";
import type { Env } from "../types";

export interface OutboxJob {
	jobId: string;
	mailboxId: string;
	sentEmailId: string;
	enqueuedAt: string;
}

interface OutboxPayload {
	jobId: string;
	mailboxId: string;
	sentEmailId: string;
	params: SendEmailParams;
}

function objectKey(jobId: string): string {
	return `outbox/${jobId}.json`;
}

export async function enqueueSend(
	env: Env,
	mailboxId: string,
	sentEmailId: string,
	params: SendEmailParams,
): Promise<{ jobId: string }> {
	const jobId = crypto.randomUUID();
	const payload: OutboxPayload = { jobId, mailboxId, sentEmailId, params };
	await env.BUCKET.put(objectKey(jobId), JSON.stringify(payload), {
		httpMetadata: { contentType: "application/json" },
	});
	const job: OutboxJob = {
		jobId,
		mailboxId,
		sentEmailId,
		enqueuedAt: new Date().toISOString(),
	};
	await (env as Env & { OUTBOUND_QUEUE: Queue<OutboxJob> }).OUTBOUND_QUEUE.send(job);
	return { jobId };
}

export async function processOutboxBatch(
	env: Env,
	batch: MessageBatch<OutboxJob>,
): Promise<void> {
	for (const message of batch.messages) {
		const { jobId, sentEmailId } = message.body;
		try {
			const obj = await env.BUCKET.get(objectKey(jobId));
			if (!obj) {
				console.warn(`Outbox payload missing for job ${jobId} — already processed?`);
				message.ack();
				continue;
			}
			const payload = (await obj.json()) as OutboxPayload;
			await sendEmail(env.EMAIL, payload.params);
			await env.BUCKET.delete(objectKey(jobId));
			console.log(`Outbox job ${jobId} delivered (sent email ${sentEmailId})`);
			message.ack();
		} catch (e) {
			const err = e as Error;
			console.error(`Outbox job ${jobId} failed: ${err.message}`);
			// retry() with backoff; after max_retries it lands in the DLQ
			message.retry({ delaySeconds: 30 });
		}
	}
}
