import { test, expect } from "@playwright/test";

const MAILBOX = "ranuga.d@bbyb.dev";
const SIGN_URL = `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/sign`;

test.describe("big attachments — sign endpoint", () => {
	test("returns a presigned PUT URL for a valid request", async ({ request }) => {
		const res = await request.post(SIGN_URL, {
			data: { filename: "report.pdf", size: 1024, type: "application/pdf" },
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.uploadId).toMatch(/^[0-9a-f-]{36}$/);
		expect(body.url).toMatch(/^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\//);
		expect(body.url).toContain("X-Amz-Signature=");
		expect(body.url).toContain("X-Amz-Expires=");
		expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
	});

	test("rejects files larger than 5 GiB", async ({ request }) => {
		const res = await request.post(SIGN_URL, {
			data: {
				filename: "huge.bin",
				size: 6 * 1024 * 1024 * 1024,
				type: "application/octet-stream",
			},
		});
		expect(res.status()).toBe(400); // Zod schema rejection
	});

	test("rejects invalid input", async ({ request }) => {
		const res = await request.post(SIGN_URL, {
			data: { filename: "", size: 100, type: "application/pdf" },
		});
		expect(res.status()).toBe(400);
	});
});

test.describe("big attachments — confirm endpoint", () => {
	test("returns 404 when R2 object is missing", async ({ request }) => {
		const res = await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/confirm`,
			{
				data: {
					uploadId: "00000000-0000-0000-0000-000000000000",
					filename: "ghost.pdf",
					type: "application/pdf",
				},
			},
		);
		expect(res.status()).toBe(404);
	});

	test("full sign + PUT + confirm flow lands in pending_uploads", async ({ request }) => {
		// 1. Sign
		const signRes = await request.post(SIGN_URL, {
			data: { filename: "tiny.txt", size: 5, type: "text/plain" },
		});
		const { uploadId, url } = await signRes.json();

		// 2. PUT to the presigned URL
		const putRes = await request.put(url, {
			data: "hello",
			headers: { "content-type": "text/plain" },
		});
		expect(putRes.status()).toBe(200);

		// 3. Confirm
		const confirmRes = await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/confirm`,
			{ data: { uploadId, filename: "tiny.txt", type: "text/plain" } },
		);
		expect(confirmRes.status()).toBe(200);
		const confirmBody = await confirmRes.json();
		expect(confirmBody.uploadId).toBe(uploadId);
		expect(confirmBody.size).toBe(5);
	});
});

test.describe("big attachments — cancel endpoint", () => {
	test("deletes the staged upload", async ({ request }) => {
		const signRes = await request.post(SIGN_URL, {
			data: { filename: "trash.txt", size: 4, type: "text/plain" },
		});
		const { uploadId, url } = await signRes.json();
		await request.put(url, { data: "junk", headers: { "content-type": "text/plain" } });
		await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/confirm`,
			{ data: { uploadId, filename: "trash.txt", type: "text/plain" } },
		);

		const cancelRes = await request.delete(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/${uploadId}`,
		);
		expect(cancelRes.status()).toBe(200);

		// Re-confirm should now 404
		const reconfirmRes = await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/confirm`,
			{ data: { uploadId, filename: "trash.txt", type: "text/plain" } },
		);
		expect(reconfirmRes.status()).toBe(404);
	});
});
