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

test.describe("big attachments — download route", () => {
	test("returns 404 for non-existent token", async ({ request }) => {
		const res = await request.get(
			"/d/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/anything.bin",
		);
		expect(res.status()).toBe(404);
	});

	test("download route does NOT require Access JWT", async ({ request }) => {
		// The 404 above already proves no auth wall, because if Access were guarding
		// /d/*, we'd see a 302 redirect to the OTP login flow rather than a 404.
		const res = await request.get(
			"/d/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/x.bin",
			{ maxRedirects: 0 },
		);
		expect(res.status()).toBe(404);
	});
});

test.describe("big attachments — send with r2-staged", () => {
	test("a small r2-staged file lands as a real attachment in Sent", async ({ request }) => {
		// 1. Upload a small file via the new pipeline
		const signRes = await request.post(SIGN_URL, {
			data: { filename: "hello.txt", size: 5, type: "text/plain" },
		});
		const { uploadId, url } = await signRes.json();
		await request.put(url, { data: "hello", headers: { "content-type": "text/plain" } });
		await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/confirm`,
			{ data: { uploadId, filename: "hello.txt", type: "text/plain" } },
		);

		// 2. Send an email referencing it
		const sendRes = await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails`,
			{
				data: {
					to: MAILBOX,
					from: MAILBOX,
					subject: "r2-staged small attach test",
					html: "<p>body</p>",
					text: "body",
					attachments: [
						{
							kind: "r2-staged",
							uploadId,
							filename: "hello.txt",
							type: "text/plain",
							size: 5,
							disposition: "attachment",
						},
					],
				},
			},
		);
		expect(sendRes.status()).toBe(200);

		// 3. Find the email in Sent
		const sentRes = await request.get(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails?folder=sent`,
		);
		expect(sentRes.status()).toBe(200);
		const emails = await sentRes.json();
		const ours = emails.emails?.find?.(
			(e: { subject?: string }) => e.subject === "r2-staged small attach test",
		);
		expect(ours).toBeDefined();
	});
});

test.describe("big attachments — link delivery", () => {
	test("a 12 MB file is delivered as a download link, not as MIME", async ({ request }) => {
		// 1. Upload a 12 MB file (just above the 10 MB threshold)
		const body = "A".repeat(12 * 1024 * 1024);
		const signRes = await request.post(SIGN_URL, {
			data: { filename: "big.txt", size: body.length, type: "text/plain" },
		});
		const { uploadId, url } = await signRes.json();
		await request.put(url, { data: body, headers: { "content-type": "text/plain" } });
		await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/confirm`,
			{ data: { uploadId, filename: "big.txt", type: "text/plain" } },
		);

		// 2. Send the email
		const sendRes = await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails`,
			{
				data: {
					to: MAILBOX,
					from: MAILBOX,
					subject: "link delivery test",
					html: "<p>see attached</p>",
					text: "see attached",
					attachments: [{
						kind: "r2-staged",
						uploadId,
						filename: "big.txt",
						type: "text/plain",
						size: body.length,
						disposition: "attachment",
					}],
				},
			},
		);
		expect(sendRes.status()).toBe(200);
		const { id: sentEmailId } = await sendRes.json();

		// 3. Fetch the email — body should contain a /d/ link
		const emailRes = await request.get(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails/${sentEmailId}`,
		);
		const email = await emailRes.json();
		expect(email.body).toContain(`/d/${sentEmailId}/`);
		expect(email.body).toContain("big.txt");

		// 4. The /d/ link should resolve and serve the file
		const downloadUrlMatch = email.body.match(/\/d\/[^"<>\s]+/);
		expect(downloadUrlMatch).not.toBeNull();
		const dlRes = await request.get(downloadUrlMatch![0]);
		expect(dlRes.status()).toBe(200);
		expect(dlRes.headers()["content-disposition"]).toContain('filename="big.txt"');
	});

	test("a small file goes as a real MIME attachment, not a link", async ({ request }) => {
		const signRes = await request.post(SIGN_URL, {
			data: { filename: "small.txt", size: 6, type: "text/plain" },
		});
		const { uploadId, url } = await signRes.json();
		await request.put(url, { data: "small!", headers: { "content-type": "text/plain" } });
		await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/attachments/confirm`,
			{ data: { uploadId, filename: "small.txt", type: "text/plain" } },
		);
		const sendRes = await request.post(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails`,
			{
				data: {
					to: MAILBOX, from: MAILBOX, subject: "small attach",
					html: "<p>hi</p>", text: "hi",
					attachments: [{
						kind: "r2-staged", uploadId,
						filename: "small.txt", type: "text/plain",
						size: 6, disposition: "attachment",
					}],
				},
			},
		);
		const { id: sentEmailId } = await sendRes.json();
		const emailRes = await request.get(
			`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails/${sentEmailId}`,
		);
		const email = await emailRes.json();
		expect(email.body).not.toContain(`/d/${sentEmailId}/`);
	});
});
