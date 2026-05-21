import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAILBOX = "ranuga.d@bbyb.dev";
const PDF_FIXTURE = path.join(__dirname, "fixtures", "test.pdf");

/**
 * After Phase 3 of the big-attachments plan, attaching a file no longer reads
 * it into memory as base64. The browser signs an upload, PUTs the file to R2,
 * and confirms with the worker. The UI shows a per-file progress bar that
 * settles once `confirm` returns, at which point the file row is "done" and
 * the X button becomes a remove (not cancel) action.
 *
 * Assertions wait for that settled state so they don't race the upload.
 */
const UPLOAD_TIMEOUT = 30_000;

test.describe("attachment workflow", () => {
	test.beforeEach(async ({ page }) => {
		// In dev mode (import.meta.env.DEV), the worker skips Cloudflare Access JWT
		// verification, so we can hit the API + UI directly.
		await page.goto("/");
	});

	test("home page loads without auth in dev", async ({ page }) => {
		await expect(page).toHaveURL(/localhost:5173/);
		// Either the mailbox list or the redirect-to-mailbox should appear.
		await expect(page.locator("body")).toBeVisible();
	});

	async function openCompose(page: import("@playwright/test").Page) {
		await page.goto(`/mailbox/${MAILBOX}/emails/inbox`);
		await page.waitForLoadState("networkidle");
		const composeButton = page.getByRole("button", { name: /compose/i }).first();
		await composeButton.waitFor({ state: "visible", timeout: 10_000 });
		await composeButton.click();
		await expect(page.getByRole("button", { name: /attach files/i })).toBeVisible({
			timeout: 10_000,
		});
	}

	/**
	 * Wait for the file row to reach the "done" state — i.e. the X button is
	 * labelled "Remove <filename>" rather than "Cancel <filename>". Use this
	 * instead of just `getByText(filename)` so we don't act on a row that's
	 * still uploading.
	 */
	async function waitForAttachmentSettled(
		page: import("@playwright/test").Page,
		filename: string,
	) {
		await expect(
			page.getByRole("button", { name: new RegExp(`^remove ${filename}$`, "i") }),
		).toBeVisible({ timeout: UPLOAD_TIMEOUT });
	}

	test("compose panel accepts an attachment and lists it", async ({ page }) => {
		await openCompose(page);
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(PDF_FIXTURE);
		await waitForAttachmentSettled(page, "test.pdf");
		await expect(page.getByText("test.pdf")).toBeVisible();
		await expect(page.getByText(/1 file\b/i)).toBeVisible();
	});

	test("compose attachment can be removed", async ({ page }) => {
		await openCompose(page);
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(PDF_FIXTURE);
		await waitForAttachmentSettled(page, "test.pdf");
		await page.getByRole("button", { name: /remove test\.pdf/i }).click();
		await expect(page.getByText("test.pdf")).toBeHidden();
	});

	test("multiple attachments accumulate in the list", async ({ page }) => {
		test.setTimeout(60_000);
		await openCompose(page);
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(PDF_FIXTURE);
		await waitForAttachmentSettled(page, "test.pdf");
		await expect(page.getByText(/1 file\b/i)).toBeVisible();
		await fileInput.setInputFiles(PDF_FIXTURE);
		await expect(page.getByText(/2 files\b/i)).toBeVisible({
			timeout: UPLOAD_TIMEOUT,
		});
	});
});
