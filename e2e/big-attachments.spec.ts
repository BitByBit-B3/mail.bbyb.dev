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
