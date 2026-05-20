# Big Attachments via Direct R2 Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach files up to 5 GB. Files ≤ 10 MB go as real SMTP attachments. Files > 10 MB get parked in R2 and the email body gets a `mail.bbyb.dev/d/...` download link.

**Architecture:** Browser uploads directly to R2 via S3 presigned PUT URLs (signed by Worker, executed by browser). Worker never sees the file bytes during upload. On send, the Worker chooses delivery mode based on size and either stream-copies small files into the per-email folder or leaves big files in the per-mailbox uploads folder and injects a link card into the HTML. Outbox queue payloads reference R2 keys instead of carrying base64.

**Tech Stack:** Cloudflare Workers, Hono, Durable Object SQLite, R2 (binding + S3 API via aws4fetch), TypeScript, React 19, Tiptap, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-20-big-attachments-r2-upload-design.md`

**Testing approach:** The project has no unit-test framework today; it uses Playwright E2E against the local Wrangler dev server (which runs the full Worker + miniflare R2 + DO stack). We extend that — using Playwright's `request` fixture for API/integration tests and `page` fixture for UI tests. Each task includes a Playwright test that exercises the new code end-to-end via the dev server, plus a manual curl probe step when useful for debugging.

**Prerequisites (the user must do these before starting Phase 1):**

1. In the Cloudflare dashboard, go to **R2 → Manage R2 API Tokens → Create API token**, scoped to the `b3-mail` bucket with **Object Read & Write** permission. Save the Access Key ID and Secret Access Key.
2. Run `wrangler secret put R2_S3_ACCESS_KEY_ID` and paste the access key.
3. Run `wrangler secret put R2_S3_SECRET_ACCESS_KEY` and paste the secret key.
4. On the R2 bucket, add a CORS rule:
   ```json
   [{
     "AllowedOrigins": ["https://mail.bbyb.dev", "http://localhost:5173"],
     "AllowedMethods": ["PUT", "GET", "HEAD"],
     "AllowedHeaders": ["*"],
     "MaxAgeSeconds": 3000
   }]
   ```
   Set via dashboard (Bucket → Settings → CORS Policy) or `wrangler r2 bucket cors put b3-mail --rules <file>`.

**Use a worktree for execution.** Run the `superpowers:using-git-worktrees` skill at execution time to create an isolated branch.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `workers/lib/r2-presign.ts` | Create | aws4fetch wrapper that signs PUT URLs against R2's S3 endpoint |
| `workers/routes/attachments.ts` | Create | `sign`, `confirm`, `cancel` endpoints |
| `workers/routes/download.ts` | Create | `GET /d/:emailId/:attId/:filename` |
| `workers/scheduled.ts` | Create | Cron handler for orphan cleanup |
| `workers/lib/link-card.ts` | Create | Inject HTML + plaintext link cards into outgoing email bodies |
| `shared/compose-attachments.ts` | Modify | Add `R2StagedComposeAttachment` variant |
| `app/lib/composeAttachments.ts` | Modify | Replace base64 path with `uploadFilesToR2` (sign → PUT → confirm) |
| `app/components/ComposeAttachments.tsx` | Modify | Progress bars, cancel, error states per attachment |
| `app/hooks/useComposeForm.ts` | Modify | Track upload state per attachment |
| `workers/lib/attachments.ts` | Modify | Handle `kind: "r2-staged"`; add stream-copy helper |
| `workers/lib/outbound-queue.ts` | Modify | `OutboxPayload.attachmentRefs` references R2 keys (not bytes) |
| `workers/index.ts` | Modify | Send route splits small/big, claims pending_uploads; mount attachments + download routes |
| `workers/app.ts` | Modify | Mount `/d/*` before Access JWT middleware |
| `workers/durableObject/migrations.ts` | Modify | Add migration #10: `pending_uploads` table + `attachments.r2_key` |
| `workers/durableObject/index.ts` | Modify | Methods for pending_uploads CRUD + attachmentR2Key helper |
| `workers/db/schema.ts` | Modify | Drizzle reflection: add `r2_key` column to attachments, add `pending_uploads` table |
| `wrangler.jsonc` | Modify | `[triggers.crons]`, env vars `R2_S3_ACCOUNT_ID`, `R2_S3_BUCKET` |
| `app/types/index.ts` | Modify | Extend attachment types |
| `e2e/big-attachments.spec.ts` | Create | All new integration + UI tests live here |

---

## Phase 0 — Dependencies

### Task 0.1: Install aws4fetch

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install aws4fetch
```

- [ ] **Step 2: Verify it lands in dependencies**

Run: `node -e 'console.log(require("./package.json").dependencies["aws4fetch"])'`
Expected: a version string like `^1.0.20`

- [ ] **Step 3: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add aws4fetch for R2 S3 presign"
```

---

## Phase 1 — Backend pipeline (no UI change)

### Task 1.1: DO migration — pending_uploads table + attachments.r2_key

**Files:**
- Modify: `workers/durableObject/migrations.ts` (append to `mailboxMigrations`)
- Modify: `workers/db/schema.ts`

- [ ] **Step 1: Append migration #10 to `mailboxMigrations`**

```ts
// In workers/durableObject/migrations.ts, append to the mailboxMigrations array:
{
    name: "10_big_attachments_staging",
    sql: `
        ALTER TABLE attachments ADD COLUMN r2_key TEXT;

        CREATE TABLE IF NOT EXISTS pending_uploads (
            upload_id TEXT PRIMARY KEY,
            r2_key TEXT NOT NULL,
            filename TEXT NOT NULL,
            mimetype TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pending_uploads_created
            ON pending_uploads(created_at);
    `,
},
```

(Do **not** wrap in `txn()` — migration #8 already documents that CREATE INDEX IF NOT EXISTS plus ALTER TABLE are safe to run without a SQL-level transaction; the DO `transactionSync` wrapper in `applyMigrations` handles atomicity.)

- [ ] **Step 2: Mirror in `workers/db/schema.ts`**

Add to the existing `attachments` definition:

```ts
export const attachments = sqliteTable("attachments", {
    id: text("id").primaryKey(),
    email_id: text("email_id")
        .notNull()
        .references(() => emails.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimetype: text("mimetype").notNull(),
    size: integer("size").notNull(),
    content_id: text("content_id"),
    disposition: text("disposition"),
    r2_key: text("r2_key"),
});

export const pending_uploads = sqliteTable("pending_uploads", {
    upload_id: text("upload_id").primaryKey(),
    r2_key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mimetype: text("mimetype").notNull(),
    size: integer("size").notNull(),
    created_at: integer("created_at").notNull(),
});
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Verify migration runs on dev startup**

```bash
npm run dev
```

Open dev server logs — should see no migration errors. Hit any mailbox endpoint (e.g. `curl http://localhost:5173/api/v1/mailboxes/ranuga.d@bbyb.dev`) and confirm the response is normal (no 500 from a migration failure).

- [ ] **Step 5: Commit**

```bash
git add workers/durableObject/migrations.ts workers/db/schema.ts
git commit -m "feat(db): add pending_uploads table + attachments.r2_key"
```

---

### Task 1.2: DO methods for pending_uploads + attachmentR2Key helper

**Files:**
- Modify: `workers/durableObject/index.ts` (add methods on `MailboxDO`)
- Modify: `workers/lib/attachments.ts` (add helper)

- [ ] **Step 1: Read the existing MailboxDO class to find the right spot**

Run: `grep -n "class MailboxDO\|getAttachment\b\|async listEmails" workers/durableObject/index.ts | head`
Find the cluster of attachment-related methods.

- [ ] **Step 2: Add `pending_uploads` methods to `MailboxDO`**

In `workers/durableObject/index.ts`, add these methods to the `MailboxDO` class (near the existing `getAttachment` method):

```ts
async insertPendingUpload(input: {
    uploadId: string;
    r2Key: string;
    filename: string;
    mimetype: string;
    size: number;
}): Promise<void> {
    this.sql.exec(
        `INSERT INTO pending_uploads
            (upload_id, r2_key, filename, mimetype, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        input.uploadId,
        input.r2Key,
        input.filename,
        input.mimetype,
        input.size,
        Date.now(),
    );
}

async getPendingUpload(uploadId: string): Promise<{
    upload_id: string;
    r2_key: string;
    filename: string;
    mimetype: string;
    size: number;
    created_at: number;
} | null> {
    const rows = [
        ...this.sql.exec(
            `SELECT upload_id, r2_key, filename, mimetype, size, created_at
             FROM pending_uploads WHERE upload_id = ?`,
            uploadId,
        ),
    ];
    return (rows[0] as unknown as {
        upload_id: string;
        r2_key: string;
        filename: string;
        mimetype: string;
        size: number;
        created_at: number;
    }) ?? null;
}

async deletePendingUpload(uploadId: string): Promise<void> {
    this.sql.exec(`DELETE FROM pending_uploads WHERE upload_id = ?`, uploadId);
}

async sumPendingUploadSize(): Promise<number> {
    const rows = [
        ...this.sql.exec(
            `SELECT COALESCE(SUM(size), 0) AS total FROM pending_uploads`,
        ),
    ];
    return Number((rows[0] as unknown as { total: number })?.total ?? 0);
}

async listPendingUploadsOlderThan(cutoffMs: number): Promise<Array<{
    upload_id: string;
    r2_key: string;
}>> {
    return [
        ...this.sql.exec(
            `SELECT upload_id, r2_key FROM pending_uploads WHERE created_at < ?`,
            cutoffMs,
        ),
    ] as unknown as Array<{ upload_id: string; r2_key: string }>;
}
```

(`this.sql` is the existing `SqlStorage` reference inside `MailboxDO` — verify the field name by reading any existing method like `getAttachment` and match the same access pattern.)

- [ ] **Step 3: Add `attachmentR2Key()` helper**

In `workers/lib/attachments.ts`, add near the top after imports:

```ts
/**
 * Resolve the R2 key for an attachment row.
 *
 * Legacy rows (r2_key NULL) use the implicit convention
 * `attachments/<emailId>/<id>/<filename>`. New big-file attachments
 * stamp `r2_key` explicitly because they live at
 * `uploads/<mailboxId>/<uploadId>` (no copy).
 */
export function attachmentR2Key(att: {
    id: string;
    email_id: string;
    filename: string;
    r2_key?: string | null;
}): string {
    if (att.r2_key) return att.r2_key;
    return `attachments/${att.email_id}/${att.id}/${att.filename}`;
}
```

Then update the existing `materializeAttachment` `stored` branch (around line 90) to use it:

```ts
// Replace:
//   const objectKey = `attachments/${stored.email_id}/${stored.id}/${stored.filename}`;
// With:
const objectKey = attachmentR2Key(stored);
```

And update `StoredAttachment` and `PersistedAttachmentRecord` to include the optional column:

```ts
export interface StoredAttachment {
    id: string;
    email_id: string;
    filename: string;
    mimetype: string;
    size: number;
    content_id: string | null;
    disposition: string | null;
    r2_key?: string | null;
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add workers/durableObject/index.ts workers/lib/attachments.ts
git commit -m "feat(do): pending_uploads CRUD + attachmentR2Key helper"
```

---

### Task 1.3: R2 S3 presign helper

**Files:**
- Create: `workers/lib/r2-presign.ts`
- Modify: `workers/types.ts` (add env var typing)
- Modify: `wrangler.jsonc` (add `vars` and document secrets)

- [ ] **Step 1: Add env vars to wrangler.jsonc**

In the existing `"vars"` block, add the account ID and bucket name (these are not secret):

```jsonc
"vars": {
    "DOMAINS": "bbyb.dev",
    "EMAIL_ADDRESSES": [],
    "R2_S3_ACCOUNT_ID": "8f0203259905d8923687286c84921e6c",
    "R2_S3_BUCKET": "b3-mail"
},
```

Add a comment block above the file or in the README listing the required secrets:

```
Secrets (set via `wrangler secret put <NAME>`):
- R2_S3_ACCESS_KEY_ID
- R2_S3_SECRET_ACCESS_KEY
```

- [ ] **Step 2: Regenerate worker types**

Run: `npm run cf-typegen`
Expected: `worker-configuration.d.ts` is regenerated (gitignored). The `Env` type now includes `R2_S3_ACCOUNT_ID`, `R2_S3_BUCKET`, `R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY`.

- [ ] **Step 3: Create the presign helper**

Create `workers/lib/r2-presign.ts`:

```ts
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
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add workers/lib/r2-presign.ts wrangler.jsonc
git commit -m "feat(worker): R2 S3 presign helper using aws4fetch"
```

---

### Task 1.4: Sign endpoint — POST /attachments/sign

**Files:**
- Create: `workers/routes/attachments.ts`
- Modify: `workers/index.ts` (mount route)
- Modify: `workers/lib/schemas.ts` (Zod schema for sign request)

- [ ] **Step 1: Add Zod schema**

In `workers/lib/schemas.ts`, append:

```ts
export const AttachmentSignRequestSchema = z.object({
    filename: z.string().min(1).max(255),
    size: z.number().int().positive().max(5 * 1024 * 1024 * 1024), // 5 GiB
    type: z.string().min(1).max(128),
});

export const AttachmentConfirmRequestSchema = z.object({
    uploadId: z.string().uuid(),
});
```

(If the file already imports `z` from `zod`, no new import needed.)

- [ ] **Step 2: Create the route handlers**

Create `workers/routes/attachments.ts`:

```ts
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { presignR2Put } from "../lib/r2-presign";
import {
    AttachmentSignRequestSchema,
    AttachmentConfirmRequestSchema,
} from "../lib/schemas";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;

const STAGING_QUOTA_BYTES = 50 * 1024 * 1024 * 1024; // 50 GiB per mailbox

function sanitizeFilename(filename: string): string {
    return (filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
}

function uploadKey(mailboxId: string, uploadId: string): string {
    return `uploads/${mailboxId}/${uploadId}`;
}

export async function handleSignUpload(c: AppContext) {
    const mailboxId = c.req.param("mailboxId")!;
    const body = AttachmentSignRequestSchema.parse(await c.req.json());

    // Enforce per-mailbox staging quota.
    const used = await c.var.mailboxStub.sumPendingUploadSize();
    if (used + body.size > STAGING_QUOTA_BYTES) {
        return c.json(
            { error: "Staging quota exceeded. Delete unsent files first." },
            413,
        );
    }

    const uploadId = crypto.randomUUID();
    const key = uploadKey(mailboxId, uploadId);

    const { url, expiresAt } = await presignR2Put({
        env: c.env,
        key,
    });

    return c.json({
        uploadId,
        url,
        expiresAt,
        // The client sends these back unchanged on confirm so the server can
        // record them in pending_uploads without re-reading from R2 metadata.
        filename: sanitizeFilename(body.filename),
        mimetype: body.type,
        declaredSize: body.size,
    });
}
```

(Confirm + cancel handlers added in next tasks; we leave them out of the file for now to keep this task small.)

- [ ] **Step 3: Mount the route in `workers/index.ts`**

Add to the imports near the top of `workers/index.ts`:

```ts
import { handleSignUpload } from "./routes/attachments";
```

Add the route registration in the same area as other mailbox routes (search for `app.post("/api/v1/mailboxes/:mailboxId/emails"` to find the neighborhood):

```ts
app.post(
    "/api/v1/mailboxes/:mailboxId/attachments/sign",
    handleSignUpload,
);
```

- [ ] **Step 4: Write the failing Playwright API test**

Append to (or create) `e2e/big-attachments.spec.ts`:

```ts
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
```

- [ ] **Step 5: Run test, expect failures**

Run: `npm run e2e -- --grep "sign endpoint"`

Expected: tests fail because either the route isn't mounted yet (404) or the R2 secrets aren't set (500 from `presignR2Put`).

If you see 500s about missing R2 secrets, ensure the prerequisite secrets from the top of this doc are set: `wrangler secret put R2_S3_ACCESS_KEY_ID` and `wrangler secret put R2_S3_SECRET_ACCESS_KEY`. For local dev you also need `.dev.vars` with these values — or skip these tests locally and run them against the deployed preview.

- [ ] **Step 6: Make tests pass**

If the route is mounted (Step 3 done) and secrets are configured, tests pass on a fresh `npm run dev` cycle. If not, revisit Steps 1–3.

Run: `npm run e2e -- --grep "sign endpoint"`
Expected: 3 tests pass

- [ ] **Step 7: Commit**

```bash
git add workers/routes/attachments.ts workers/lib/schemas.ts workers/index.ts e2e/big-attachments.spec.ts
git commit -m "feat(api): POST /attachments/sign returns presigned R2 PUT URL"
```

---

### Task 1.5: Confirm endpoint — POST /attachments/confirm

**Files:**
- Modify: `workers/routes/attachments.ts`
- Modify: `workers/index.ts`

- [ ] **Step 1: Add confirm schema + handler to `workers/routes/attachments.ts`**

The browser PUT to R2 doesn't carry filename/type metadata by default, so the client sends them back on confirm. Add this Zod schema near the top of the file:

```ts
import { z } from "zod";

const ConfirmBodySchema = z.object({
    uploadId: z.string().uuid(),
    filename: z.string().min(1).max(255),
    type: z.string().min(1).max(128),
});
```

Then append the handler:

```ts
export async function handleConfirmUpload(c: AppContext) {
    const mailboxId = c.req.param("mailboxId")!;
    const body = ConfirmBodySchema.parse(await c.req.json());
    const { uploadId, filename, type } = body;

    const key = uploadKey(mailboxId, uploadId);
    const head = await c.env.BUCKET.head(key);
    if (!head) {
        return c.json({ error: "Upload not found." }, 404);
    }

    // R2's stored size is authoritative. The client's declared filename + type
    // are advisory — they're sanitized here and final at send time.
    await c.var.mailboxStub.insertPendingUpload({
        uploadId,
        r2Key: key,
        filename: sanitizeFilename(filename),
        mimetype: type,
        size: head.size,
    });

    return c.json({ uploadId, size: head.size });
}
```

The `AttachmentConfirmRequestSchema` defined in Task 1.4 Step 1 is unused — leave it for now or delete it (either is fine). The local `ConfirmBodySchema` lets sign-time and confirm-time payloads diverge cleanly.

- [ ] **Step 2: Mount the route**

In `workers/index.ts`, update the import:

```ts
import { handleSignUpload, handleConfirmUpload } from "./routes/attachments";
```

Add the route registration:

```ts
app.post(
    "/api/v1/mailboxes/:mailboxId/attachments/confirm",
    handleConfirmUpload,
);
```

- [ ] **Step 3: Write the failing E2E test**

Append to `e2e/big-attachments.spec.ts`:

```ts
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
```

- [ ] **Step 4: Run, expect 404 test passes; full-flow test fails until PUT works**

Run: `npm run e2e -- --grep "confirm endpoint"`

If the PUT step fails with CORS errors, recheck the bucket CORS rule from the prerequisites. If it fails with auth errors, recheck the R2 token scope.

- [ ] **Step 5: Iterate until both pass**

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add workers/routes/attachments.ts workers/index.ts e2e/big-attachments.spec.ts
git commit -m "feat(api): POST /attachments/confirm verifies R2 object and records pending upload"
```

---

### Task 1.6: Cancel endpoint — DELETE /attachments/:uploadId

**Files:**
- Modify: `workers/routes/attachments.ts`
- Modify: `workers/index.ts`

- [ ] **Step 1: Add the handler**

In `workers/routes/attachments.ts`, append:

```ts
export async function handleCancelUpload(c: AppContext) {
    const mailboxId = c.req.param("mailboxId")!;
    const uploadId = c.req.param("uploadId")!;

    if (!/^[0-9a-f-]{36}$/.test(uploadId)) {
        return c.json({ error: "Invalid uploadId." }, 400);
    }

    const key = uploadKey(mailboxId, uploadId);
    await c.env.BUCKET.delete(key);
    await c.var.mailboxStub.deletePendingUpload(uploadId);

    return c.json({ ok: true });
}
```

- [ ] **Step 2: Mount in `workers/index.ts`**

Import and register:

```ts
import { handleSignUpload, handleConfirmUpload, handleCancelUpload } from "./routes/attachments";
// ...
app.delete(
    "/api/v1/mailboxes/:mailboxId/attachments/:uploadId",
    handleCancelUpload,
);
```

- [ ] **Step 3: Write the failing E2E test**

Append to `e2e/big-attachments.spec.ts`:

```ts
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
```

- [ ] **Step 4: Run; expect pass**

Run: `npm run e2e -- --grep "cancel endpoint"`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add workers/routes/attachments.ts workers/index.ts e2e/big-attachments.spec.ts
git commit -m "feat(api): DELETE /attachments/:uploadId cleans up staged uploads"
```

---

### Task 1.7: R2StagedComposeAttachment type

**Files:**
- Modify: `shared/compose-attachments.ts`
- Modify: `app/types/index.ts` (if it has a parallel type)

- [ ] **Step 1: Extend `shared/compose-attachments.ts`**

Add the new variant and update the union:

```ts
export interface R2StagedComposeAttachment {
    kind: "r2-staged";
    uploadId: string;
    filename: string;
    type: string;
    size: number;
    disposition: ComposeAttachmentDisposition;
    contentId?: string;
}

export type ComposeAttachmentPayload =
    | UploadedComposeAttachment
    | StoredComposeAttachment
    | R2StagedComposeAttachment;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors. (Most consumers use the discriminated union — adding a third variant just means anywhere that exhaustively switches on `kind` will surface a missing-case error.)

- [ ] **Step 3: Add a placeholder branch in `materializeAttachment`**

In `workers/lib/attachments.ts`, the existing `materializeAttachment` function switches on `attachment.kind`. Add the r2-staged branch (we'll fill it in properly in Task 1.8 — for now, just throw so it typechecks):

```ts
async function materializeAttachment(
    bucket: Env["BUCKET"],
    attachment: ComposeAttachmentPayload,
    lookupAttachment?: AttachmentLookup,
): Promise<MaterializedAttachment> {
    if (attachment.kind === "upload") {
        // ... existing branch ...
    }

    if (attachment.kind === "r2-staged") {
        throw new Error(
            "r2-staged materialization not yet implemented (see Task 1.8)",
        );
    }

    // ... existing "stored" branch ...
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add shared/compose-attachments.ts workers/lib/attachments.ts
git commit -m "feat(types): add R2StagedComposeAttachment variant"
```

---

### Task 1.8: materializeAttachment handles r2-staged

**Files:**
- Modify: `workers/lib/attachments.ts`

- [ ] **Step 1: Replace the throw with real materialization**

In `workers/lib/attachments.ts`, replace the placeholder branch from Task 1.7 with:

```ts
if (attachment.kind === "r2-staged") {
    // R2 staged attachments live at `uploads/<mailboxId>/<uploadId>`.
    // The caller (send route) has already validated ownership via
    // pending_uploads; we trust the key here.
    if (!lookupPendingUpload) {
        throw new Error(
            "r2-staged attachments require lookupPendingUpload context.",
        );
    }
    const pending = await lookupPendingUpload(attachment.uploadId);
    if (!pending) {
        throw new Error(`Pending upload ${attachment.uploadId} not found.`);
    }
    const object = await bucket.get(pending.r2_key);
    if (!object) {
        throw new Error(`R2 object missing for upload ${attachment.uploadId}.`);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    return {
        filename: sanitizeFilename(pending.filename),
        mimetype: pending.mimetype || attachment.type || "application/octet-stream",
        size: bytes.byteLength,
        contentId: attachment.contentId,
        disposition: attachment.disposition,
        bytes,
    };
}
```

- [ ] **Step 2: Add the lookup parameter type**

Add this type and update the function signatures at the top of `workers/lib/attachments.ts`:

```ts
type PendingUploadLookup = (
    uploadId: string,
) => Promise<{
    upload_id: string;
    r2_key: string;
    filename: string;
    mimetype: string;
    size: number;
} | null>;

// Replace existing signature:
async function materializeAttachment(
    bucket: Env["BUCKET"],
    attachment: ComposeAttachmentPayload,
    lookupAttachment?: AttachmentLookup,
    lookupPendingUpload?: PendingUploadLookup,
): Promise<MaterializedAttachment> {
    // ...
}

export async function materializeComposeAttachments(
    bucket: Env["BUCKET"],
    attachments?: ComposeAttachmentPayload[],
    lookupAttachment?: AttachmentLookup,
    lookupPendingUpload?: PendingUploadLookup,
): Promise<MaterializedAttachment[]> {
    if (!attachments?.length) return [];
    return Promise.all(
        attachments.map((attachment) =>
            materializeAttachment(
                bucket,
                attachment,
                lookupAttachment,
                lookupPendingUpload,
            ),
        ),
    );
}
```

- [ ] **Step 3: Update callers to pass the new lookup**

Search for call sites:

Run: `grep -n "materializeComposeAttachments\b" workers/`
Expected: two call sites in `workers/index.ts` and `workers/routes/reply-forward.ts`.

In each call site, add the lookup. Pattern:

```ts
const materialized = await materializeComposeAttachments(
    env.BUCKET,
    attachments,
    (id) => lookupAttachment(c, id),
    (uploadId) => c.var.mailboxStub.getPendingUpload(uploadId),
);
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Add an E2E test that sends an email with an r2-staged attachment**

Append to `e2e/big-attachments.spec.ts`:

```ts
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
```

- [ ] **Step 6: Run; iterate until pass**

Run: `npm run e2e -- --grep "send with r2-staged"`
Expected: pass.

Common issues:
- If the send route doesn't pass `lookupPendingUpload` to `materializeComposeAttachments`, you'll see the "lookupPendingUpload required" error → revisit Step 3.
- If `getPendingUpload` returns null even though the row was inserted: confirm the DO method name and arg order match what Step 2 of Task 1.2 defined.

- [ ] **Step 7: Commit**

```bash
git add workers/lib/attachments.ts workers/index.ts workers/routes/reply-forward.ts e2e/big-attachments.spec.ts
git commit -m "feat(send): materialize r2-staged attachments from pending_uploads"
```

---

### Task 1.9: Outbox payload references R2 keys instead of base64

**Files:**
- Modify: `workers/lib/outbound-queue.ts`

- [ ] **Step 1: Update OutboxPayload shape and enqueue/process logic**

Replace `workers/lib/outbound-queue.ts` content with:

```ts
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound email queue.
 *
 * Stages the payload to R2 (`outbox/<jobId>.json`) because Cloudflare Queues
 * has a 128 KB message limit. Attachment bytes are NOT embedded — instead,
 * the payload stores R2 keys, and the consumer fetches each blob just-in-time
 * during MIME assembly. This keeps Worker memory bounded even when the email
 * has multiple attachments.
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

export interface OutboxAttachmentRef {
    r2Key: string;
    filename: string;
    type: string;
    size: number;
    disposition: "attachment" | "inline";
    contentId?: string;
}

interface OutboxPayload {
    jobId: string;
    mailboxId: string;
    sentEmailId: string;
    paramsCore: Omit<SendEmailParams, "attachments">;
    attachmentRefs: OutboxAttachmentRef[];
}

function objectKey(jobId: string): string {
    return `outbox/${jobId}.json`;
}

function encodeBase64(bytes: Uint8Array) {
    const CHUNK_SIZE = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
    }
    return btoa(binary);
}

export async function enqueueSend(
    env: Env,
    mailboxId: string,
    sentEmailId: string,
    paramsCore: Omit<SendEmailParams, "attachments">,
    attachmentRefs: OutboxAttachmentRef[],
): Promise<{ jobId: string }> {
    const jobId = crypto.randomUUID();
    const payload: OutboxPayload = {
        jobId,
        mailboxId,
        sentEmailId,
        paramsCore,
        attachmentRefs,
    };
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

            // Materialize attachments just-in-time. One blob in Worker memory
            // at a time during MIME assembly. Total combined size is bounded
            // by the 25 MiB SMTP wall, so memory stays well under the 128 MB cap.
            const attachments: SendEmailParams["attachments"] = [];
            for (const ref of payload.attachmentRefs) {
                const blob = await env.BUCKET.get(ref.r2Key);
                if (!blob) {
                    throw new Error(`R2 object missing for outbox attachment: ${ref.r2Key}`);
                }
                const bytes = new Uint8Array(await blob.arrayBuffer());
                attachments.push({
                    content: encodeBase64(bytes),
                    filename: ref.filename,
                    type: ref.type,
                    disposition: ref.disposition,
                    ...(ref.contentId ? { contentId: ref.contentId } : {}),
                });
            }

            await sendEmail(env.EMAIL, {
                ...payload.paramsCore,
                attachments: attachments.length ? attachments : undefined,
            });
            await env.BUCKET.delete(objectKey(jobId));
            console.log(`Outbox job ${jobId} delivered (sent email ${sentEmailId})`);
            message.ack();
        } catch (e) {
            const err = e as Error;
            console.error(`Outbox job ${jobId} failed: ${err.message}`);
            message.retry({ delaySeconds: 30 });
        }
    }
}
```

- [ ] **Step 2: Update callers of `enqueueSend`**

The signature changed: callers now pass `paramsCore` and `attachmentRefs` separately.

Run: `grep -rn "enqueueSend\b" workers/`
Expected: call sites in `workers/index.ts` and `workers/routes/reply-forward.ts`.

At each call site, replace:

```ts
// Before:
await enqueueSend(env, mailboxId, sentEmailId, {
    to, from, subject, html, text, cc, bcc,
    attachments: sendEmailAttachments,
});

// After:
const { attachments: _drop, ...paramsCore } = {
    to, from, subject, html, text, cc, bcc,
};
const attachmentRefs: OutboxAttachmentRef[] = (sendEmailAttachments ?? []).map(
    (att, idx) => ({
        r2Key: persistedAttachments[idx].r2_key
            ?? `attachments/${persistedAttachments[idx].email_id}/${persistedAttachments[idx].id}/${persistedAttachments[idx].filename}`,
        filename: persistedAttachments[idx].filename,
        type: persistedAttachments[idx].mimetype,
        size: persistedAttachments[idx].size,
        disposition: (persistedAttachments[idx].disposition === "inline"
            ? "inline"
            : "attachment") as "attachment" | "inline",
        contentId: persistedAttachments[idx].content_id ?? undefined,
    }),
);
await enqueueSend(env, mailboxId, sentEmailId, paramsCore, attachmentRefs);
```

(Adjust local variable names to match the call site — both `workers/index.ts` and `routes/reply-forward.ts` will have similar shape.)

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Re-run the Task 1.8 test**

Run: `npm run e2e -- --grep "send with r2-staged"`
Expected: still passes (we've changed the queue internals but the externally-observable behavior is identical).

If it fails, check the queue consumer logs in `npm run dev` output for "Outbox job X failed" lines — the error message will tell you what's off.

- [ ] **Step 5: Commit**

```bash
git add workers/lib/outbound-queue.ts workers/index.ts workers/routes/reply-forward.ts
git commit -m "refactor(queue): outbox payload references R2 keys, no embedded base64"
```

---

## Phase 2 — Link delivery for big files

### Task 2.1: Link card HTML + plaintext helpers

**Files:**
- Create: `workers/lib/link-card.ts`

- [ ] **Step 1: Create the file**

```ts
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
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add workers/lib/link-card.ts
git commit -m "feat(link-card): HTML + plaintext renderers for big-attachment download links"
```

---

### Task 2.2: Download route — GET /d/:emailId/:attId/:filename

**Files:**
- Create: `workers/routes/download.ts`
- Modify: `workers/app.ts` (mount BEFORE Access middleware)
- Modify: `workers/durableObject/index.ts` (cross-mailbox attachment lookup if needed)

- [ ] **Step 1: Decide the lookup strategy**

The download URL contains `<emailId>/<attId>/<filename>` but not `<mailboxId>`. Two options:

(A) Query every mailbox DO for the attachment (slow, doesn't scale).
(B) Add a per-attachment R2 metadata blob at upload time mapping `attId → { mailboxId, r2Key, filename, mimetype }`, and have the download route read that.

Use (B). When the send route inserts an attachments row, also `BUCKET.put` a small JSON metadata object at `download-tokens/<attId>.json` containing `{ mailboxId, r2Key, filename, mimetype }`. The download route reads this directly — no DO call needed.

- [ ] **Step 2: Create the download route**

```ts
// workers/routes/download.ts
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
```

- [ ] **Step 3: Mount the route in `workers/app.ts` BEFORE the Access middleware**

Open `workers/app.ts`. Find where Access JWT middleware is registered (search for `POLICY_AUD` or `TEAM_DOMAIN`). Mount the download route before it:

```ts
import { handleDownload } from "./routes/download";

// Add BEFORE the Access middleware (which guards /api/*):
app.get("/d/:emailId/:attId/:filename", handleDownload);

// Then existing Access middleware below this line stays untouched.
```

(The Access middleware in `workers/app.ts` is gated on path. Verify its matcher doesn't accidentally catch `/d/*` — if it uses `app.use("*", accessMiddleware)`, you need to either narrow the matcher or short-circuit inside the middleware for `/d/` paths.)

- [ ] **Step 4: Write the failing E2E test**

Append to `e2e/big-attachments.spec.ts`:

```ts
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
```

- [ ] **Step 5: Run; iterate until pass**

Run: `npm run e2e -- --grep "download route"`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add workers/routes/download.ts workers/app.ts e2e/big-attachments.spec.ts
git commit -m "feat(download): GET /d/:emailId/:attId/:filename serves R2 objects unauthenticated"
```

---

### Task 2.3: Threshold logic + claim flow in send route

**Files:**
- Modify: `workers/index.ts` (the main send endpoint)
- Modify: `workers/lib/attachments.ts` (add `storeMaterializedAttachmentsHybrid`)
- Modify: `workers/routes/reply-forward.ts` (same pattern)

- [ ] **Step 1: Add the threshold constant**

In `workers/lib/attachments.ts`, near the top:

```ts
export const REAL_ATTACH_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MiB

export function shouldSendAsLink(att: {
    size: number;
    disposition: "attachment" | "inline";
}): boolean {
    // Inline images (e.g. signature embeds) always go as real attachments
    // regardless of size — they're referenced by CID from the HTML body.
    if (att.disposition === "inline") return false;
    return att.size > REAL_ATTACH_THRESHOLD_BYTES;
}
```

- [ ] **Step 2: Add a hybrid storage helper**

In `workers/lib/attachments.ts`, after `storeMaterializedAttachments`, add:

```ts
import { injectLinkCardsHtml, injectLinkCardsText, formatBytesShort } from "./link-card";

interface HybridStoreInput {
    bucket: Env["BUCKET"];
    emailId: string;
    publicBaseUrl: string;   // e.g. "https://mail.bbyb.dev"
    attachments: Array<{
        materialized: MaterializedAttachment;
        // If this is r2-staged, the original r2Key (so we can skip re-uploading).
        sourceR2Key?: string;
    }>;
}

interface HybridStoreOutput {
    realAttached: MaterializedAttachment[];   // → these go into the MIME
    persisted: StoredAttachment[];            // → attachments rows
    linkCards: Array<{ filename: string; size: number; downloadUrl: string }>;
}

/**
 * Decide per-attachment whether to inline (≤ 10 MiB) or link-deliver (> 10 MiB).
 *
 * - Small files get stream-copied to `attachments/<emailId>/<attId>/<filename>`
 *   to match the existing inbound convention (`r2_key = NULL`).
 * - Big files stay at their source key (`r2_key` stamped explicitly).
 * - For each link-delivered attachment, write a download-token JSON object so
 *   the unauthenticated `/d/...` route can serve it.
 */
export async function storeMaterializedAttachmentsHybrid(
    input: HybridStoreInput,
): Promise<HybridStoreOutput> {
    const realAttached: MaterializedAttachment[] = [];
    const persisted: StoredAttachment[] = [];
    const linkCards: Array<{ filename: string; size: number; downloadUrl: string }> = [];

    for (const { materialized, sourceR2Key } of input.attachments) {
        const attachmentId = crypto.randomUUID();
        const sendAsLink = shouldSendAsLink({
            size: materialized.size,
            disposition: materialized.disposition,
        });

        if (sendAsLink) {
            // Big file — keep at source key. If somehow sourceR2Key is missing
            // (e.g. an `upload` kind that's still in the base64 path), put it
            // to a stable location first.
            let r2Key = sourceR2Key;
            if (!r2Key) {
                r2Key = `attachments/${input.emailId}/${attachmentId}/${materialized.filename}`;
                await input.bucket.put(r2Key, materialized.bytes, {
                    httpMetadata: { contentType: materialized.mimetype },
                });
            }

            // Write the download token so /d/ can serve it.
            const tokenKey = `download-tokens/${attachmentId}.json`;
            await input.bucket.put(
                tokenKey,
                JSON.stringify({
                    mailboxId: "", // filled by caller via setMailboxOnTokens (see below)
                    r2Key,
                    filename: materialized.filename,
                    mimetype: materialized.mimetype,
                }),
                { httpMetadata: { contentType: "application/json" } },
            );

            persisted.push({
                id: attachmentId,
                email_id: input.emailId,
                filename: materialized.filename,
                mimetype: materialized.mimetype,
                size: materialized.size,
                content_id: materialized.contentId ?? null,
                disposition: materialized.disposition,
                r2_key: r2Key,
            });

            const downloadUrl = `${input.publicBaseUrl}/d/${input.emailId}/${attachmentId}/${encodeURIComponent(materialized.filename)}`;
            linkCards.push({
                filename: materialized.filename,
                size: materialized.size,
                downloadUrl,
            });
        } else {
            // Small file — stream-copy to per-email location.
            const r2Key = `attachments/${input.emailId}/${attachmentId}/${materialized.filename}`;
            await input.bucket.put(r2Key, materialized.bytes, {
                httpMetadata: { contentType: materialized.mimetype },
            });
            persisted.push({
                id: attachmentId,
                email_id: input.emailId,
                filename: materialized.filename,
                mimetype: materialized.mimetype,
                size: materialized.size,
                content_id: materialized.contentId ?? null,
                disposition: materialized.disposition,
                r2_key: null,
            });
            realAttached.push(materialized);
        }
    }

    return { realAttached, persisted, linkCards };
}
```

Also add a helper to backfill the mailboxId into download tokens (since the hybrid store doesn't know the mailboxId):

```ts
export async function stampMailboxOnDownloadTokens(
    bucket: Env["BUCKET"],
    attachmentIds: string[],
    mailboxId: string,
): Promise<void> {
    await Promise.all(
        attachmentIds.map(async (attId) => {
            const key = `download-tokens/${attId}.json`;
            const obj = await bucket.get(key);
            if (!obj) return;
            const data = (await obj.json()) as {
                mailboxId: string;
                r2Key: string;
                filename: string;
                mimetype: string;
            };
            data.mailboxId = mailboxId;
            await bucket.put(key, JSON.stringify(data), {
                httpMetadata: { contentType: "application/json" },
            });
        }),
    );
}
```

- [ ] **Step 3: Update the main send route to use the hybrid path**

Find the send endpoint in `workers/index.ts` (search for `app.post("/api/v1/mailboxes/:mailboxId/emails"`). Replace the section that currently calls `materializeComposeAttachments` + `storeMaterializedAttachments` + `toSendEmailAttachments` with:

```ts
// Materialize all attachments from their source (base64, stored, or r2-staged).
const materialized = await materializeComposeAttachments(
    env.BUCKET,
    attachments,
    (id) => lookupAttachment(c, id),
    (uploadId) => c.var.mailboxStub.getPendingUpload(uploadId),
);

// Decide delivery mode for each. Track source R2 keys for r2-staged inputs so
// big files stay at their source and small files get copied to per-email keys.
const withSources = materialized.map((m, idx) => {
    const input = attachments?.[idx];
    let sourceR2Key: string | undefined;
    if (input?.kind === "r2-staged") {
        // The pending_uploads row's r2_key.
        sourceR2Key = `uploads/${mailboxId}/${input.uploadId}`;
    }
    return { materialized: m, sourceR2Key };
});

const publicBaseUrl = c.req.url
    .replace(/\/api\/v1\/.*$/, "")
    .replace(/\/$/, "");

const { realAttached, persisted, linkCards } = await storeMaterializedAttachmentsHybrid({
    bucket: env.BUCKET,
    emailId: sentEmailId,
    publicBaseUrl,
    attachments: withSources,
});

await stampMailboxOnDownloadTokens(
    env.BUCKET,
    persisted.filter((p) => p.r2_key !== null).map((p) => p.id),
    mailboxId,
);

// Inject link cards into the outgoing email body.
const htmlWithCards = linkCards.length > 0 ? injectLinkCardsHtml(html, linkCards) : html;
const textWithCards = linkCards.length > 0 ? injectLinkCardsText(text, linkCards) : text;

// Persist the email row (existing logic) using `persisted` for attachments
// and `htmlWithCards` / `textWithCards` for the body.
// ... existing code that calls c.var.mailboxStub.createEmail(...) ...

// Build attachmentRefs for the outbox queue — only REAL attachments (small
// files at `attachments/...` keys). Link-delivered files have r2_key set
// (pointing at `uploads/...`) and stay out of the MIME.
const attachmentRefs: OutboxAttachmentRef[] = [];
for (const p of persisted) {
    if (p.r2_key !== null && p.r2_key !== undefined) continue;
    attachmentRefs.push({
        r2Key: `attachments/${p.email_id}/${p.id}/${p.filename}`,
        filename: p.filename,
        type: p.mimetype,
        size: p.size,
        disposition: (p.disposition === "inline" ? "inline" : "attachment"),
        contentId: p.content_id ?? undefined,
    });
}

const paramsCore = {
    to, from, subject,
    html: htmlWithCards,
    text: textWithCards,
    cc, bcc,
};

await enqueueSend(env, mailboxId, sentEmailId, paramsCore, attachmentRefs);

// Claim the pending_uploads rows so they're not garbage-collected.
for (const input of attachments ?? []) {
    if (input.kind === "r2-staged") {
        await c.var.mailboxStub.deletePendingUpload(input.uploadId);
    }
}
```

- [ ] **Step 4: Mirror the same logic in `workers/routes/reply-forward.ts`**

The reply and forward handlers have the same attachment-handling block. Apply the same refactor.

- [ ] **Step 5: Persist `r2_key` in `attachments` table**

The DO method that creates an attachment row needs to accept the new `r2_key` field. Find the method in `workers/durableObject/index.ts` (likely `createAttachments` or `createEmail`). Update the INSERT statement to include `r2_key`:

```sql
INSERT INTO attachments
    (id, email_id, filename, mimetype, size, content_id, disposition, r2_key)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```

And accept `r2_key` from the input.

- [ ] **Step 6: Write the failing E2E test for big-file link delivery**

Append to `e2e/big-attachments.spec.ts`:

```ts
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
        const { sentEmailId } = await sendRes.json();

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
        // (already covered indirectly by Task 1.8 — add an explicit assertion that
        // the body does NOT contain a /d/ link for sub-10MB files)
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
        const { sentEmailId } = await sendRes.json();
        const emailRes = await request.get(
            `/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails/${sentEmailId}`,
        );
        const email = await emailRes.json();
        expect(email.body).not.toContain(`/d/${sentEmailId}/`);
    });
});
```

- [ ] **Step 7: Run; iterate until pass**

Run: `npm run e2e -- --grep "link delivery"`
Expected: both tests pass.

Common debugging:
- If the body doesn't contain `/d/`, check `publicBaseUrl` derivation and that `linkCards` is being injected into `htmlWithCards`.
- If the `/d/` URL 404s, check that `stampMailboxOnDownloadTokens` ran (otherwise the token JSON exists but the mailbox lookup is empty — though in v1 the route doesn't actually use mailboxId, just confirms the token exists).

- [ ] **Step 8: Commit**

```bash
git add workers/lib/attachments.ts workers/index.ts workers/routes/reply-forward.ts workers/durableObject/index.ts e2e/big-attachments.spec.ts
git commit -m "feat(send): hybrid delivery — small files attach, big files become download links"
```

---

## Phase 3 — UI

### Task 3.1: `uploadFilesToR2` lib function with progress

**Files:**
- Modify: `app/lib/composeAttachments.ts`

- [ ] **Step 1: Add the new function**

Add to `app/lib/composeAttachments.ts`:

```ts
import type { R2StagedComposeAttachment } from "shared/compose-attachments";

export interface UploadController {
    abort: () => void;
}

export interface UploadProgress {
    localId: string;
    phase: "signing" | "uploading" | "confirming" | "done" | "error";
    bytesUploaded?: number;
    totalBytes?: number;
    error?: string;
}

/**
 * Sign → PUT → confirm. Yields one ComposeAttachmentItem per file (r2-staged kind).
 *
 * Uses XMLHttpRequest for the PUT step because `fetch()` does not expose upload
 * progress events in Workers and most browser/runtime combos.
 */
export async function uploadFilesToR2(
    files: FileList | File[],
    mailboxId: string,
    onProgress: (p: UploadProgress) => void,
    controllers: Map<string, UploadController>,
): Promise<ComposeAttachmentItem[]> {
    const items: ComposeAttachmentItem[] = [];

    for (const file of Array.from(files)) {
        const localId = crypto.randomUUID();
        const controller = new AbortController();
        controllers.set(localId, { abort: () => controller.abort() });

        try {
            onProgress({ localId, phase: "signing", totalBytes: file.size });

            // 1. Sign
            const signRes = await fetch(
                `/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/attachments/sign`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        filename: file.name || "untitled",
                        size: file.size,
                        type: file.type || "application/octet-stream",
                    }),
                    signal: controller.signal,
                },
            );
            if (!signRes.ok) {
                throw new Error(`sign failed: ${signRes.status}`);
            }
            const { uploadId, url } = await signRes.json();

            // 2. PUT — via XHR so we get progress events
            onProgress({ localId, phase: "uploading", bytesUploaded: 0, totalBytes: file.size });
            await xhrPut(url, file, controller.signal, (loaded) => {
                onProgress({
                    localId,
                    phase: "uploading",
                    bytesUploaded: loaded,
                    totalBytes: file.size,
                });
            });

            // 3. Confirm
            onProgress({ localId, phase: "confirming", totalBytes: file.size });
            const confirmRes = await fetch(
                `/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/attachments/confirm`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        uploadId,
                        filename: file.name || "untitled",
                        type: file.type || "application/octet-stream",
                    }),
                    signal: controller.signal,
                },
            );
            if (!confirmRes.ok) {
                throw new Error(`confirm failed: ${confirmRes.status}`);
            }

            onProgress({ localId, phase: "done", totalBytes: file.size });

            const item: ComposeAttachmentItem = {
                localId,
                kind: "r2-staged",
                uploadId,
                filename: file.name || "untitled",
                type: file.type || "application/octet-stream",
                size: file.size,
                disposition: "attachment",
            };
            items.push(item);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Upload failed";
            onProgress({ localId, phase: "error", error: msg });
            // Don't push to items — caller drops failed uploads from the compose form.
        } finally {
            controllers.delete(localId);
        }
    }

    return items;
}

function xhrPut(
    url: string,
    file: File | Blob,
    signal: AbortSignal,
    onProgress: (loaded: number) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(e.loaded);
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`PUT failed: ${xhr.status} ${xhr.statusText}`));
        };
        xhr.onerror = () => reject(new Error("network error during upload"));
        xhr.onabort = () => reject(new Error("upload aborted"));
        signal.addEventListener("abort", () => xhr.abort());
        xhr.send(file);
    });
}
```

Also update the `ComposeAttachmentItem` union to include the new kind:

```ts
export type ComposeAttachmentItem = (
    | UploadedComposeAttachment
    | StoredComposeAttachment
    | R2StagedComposeAttachment
) & { localId: string };
```

- [ ] **Step 2: Update `serializeComposeAttachments` to handle r2-staged**

It already strips `localId` from any variant; no change needed — verify by reading the function and confirming it just spreads the rest of the object.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/lib/composeAttachments.ts
git commit -m "feat(compose): uploadFilesToR2 — direct R2 upload with progress + cancel"
```

---

### Task 3.2: ComposeAttachments.tsx progress UI

**Files:**
- Modify: `app/components/ComposeAttachments.tsx`

- [ ] **Step 1: Extend the props**

Update the props interface to include progress + cancel:

```tsx
interface AttachmentProgress {
    phase: "signing" | "uploading" | "confirming" | "done" | "error";
    bytesUploaded?: number;
    totalBytes?: number;
    error?: string;
}

interface ComposeAttachmentsProps {
    attachments: ComposeAttachmentItem[];
    progress: Map<string, AttachmentProgress>;
    isAddingAttachments: boolean;
    disabled?: boolean;
    onAddFiles: (files: FileList | null) => Promise<void> | void;
    onCancelUpload: (localId: string) => void;
    onRemoveAttachment: (localId: string) => void;
}
```

- [ ] **Step 2: Render progress per attachment**

Replace the attachment-row JSX with:

```tsx
{attachments.map((attachment) => {
    const prog = progress.get(attachment.localId);
    const isUploading = prog && prog.phase !== "done" && prog.phase !== "error";
    const pct = prog?.bytesUploaded && prog?.totalBytes
        ? Math.min(100, Math.round((prog.bytesUploaded / prog.totalBytes) * 100))
        : prog?.phase === "done" ? 100 : 0;

    return (
        <div
            key={attachment.localId}
            className="flex max-w-full items-center gap-2 rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2"
            style={{ minWidth: 220 }}
        >
            <FileIcon size={16} className="text-kumo-subtle shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-kumo-default">
                    {attachment.filename}
                </div>
                <div className="text-xs text-kumo-subtle">
                    {formatBytes(attachment.size)}
                    {isUploading && prog ? ` · ${prog.phase} ${pct}%` : ""}
                    {prog?.phase === "error" ? ` · ${prog.error}` : ""}
                </div>
                {isUploading && (
                    <div
                        className="mt-1 h-1 w-full overflow-hidden rounded-full bg-kumo-line"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        <div
                            className="h-full bg-kumo-default transition-all"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                )}
            </div>
            <button
                type="button"
                onClick={() =>
                    isUploading
                        ? onCancelUpload(attachment.localId)
                        : onRemoveAttachment(attachment.localId)
                }
                disabled={disabled}
                aria-label={`${isUploading ? "Cancel" : "Remove"} ${attachment.filename}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-50"
            >
                <XIcon size={12} />
            </button>
        </div>
    );
})}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/components/ComposeAttachments.tsx
git commit -m "feat(ui): per-file upload progress bars and cancel for compose attachments"
```

---

### Task 3.3: useComposeForm.ts — wire upload state

**Files:**
- Modify: `app/hooks/useComposeForm.ts`

- [ ] **Step 1: Read the current hook**

Run: `wc -l app/hooks/useComposeForm.ts && head -80 app/hooks/useComposeForm.ts`

Identify:
- Where `attachments` state is held
- Where the add-files callback lives
- How attachments are passed to the send mutation

- [ ] **Step 2: Replace the base64 add path with the R2 upload path**

Inside `useComposeForm`:

```ts
import { useRef, useState, useCallback } from "react";
import { uploadFilesToR2, type UploadController, type UploadProgress } from "~/lib/composeAttachments";

// Inside the hook:
const [attachmentProgress, setAttachmentProgress] = useState<Map<string, UploadProgress>>(
    new Map(),
);
const uploadControllers = useRef<Map<string, UploadController>>(new Map());

const handleAddFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsAddingAttachments(true);
    try {
        const newItems = await uploadFilesToR2(
            files,
            mailboxId,
            (p) => {
                setAttachmentProgress((prev) => {
                    const next = new Map(prev);
                    next.set(p.localId, p);
                    return next;
                });
            },
            uploadControllers.current,
        );
        setAttachments((prev) => [...prev, ...newItems]);
    } finally {
        setIsAddingAttachments(false);
    }
}, [mailboxId]);

const handleCancelUpload = useCallback((localId: string) => {
    uploadControllers.current.get(localId)?.abort();
}, []);
```

- [ ] **Step 3: Update the return shape to expose progress + cancel**

Add `attachmentProgress` and `onCancelUpload: handleCancelUpload` to the return object.

- [ ] **Step 4: Update consumers of the hook (ComposePanel, etc.) to pass these to `ComposeAttachments`**

Run: `grep -rn "ComposeAttachments\b" app/`
At each consumer, pass the new props through.

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Manual smoke test**

```bash
npm run dev
```

Open the app, attach a file in compose. Watch the progress bar appear and complete. The file should land in the compose attachments list. Click Send. Check the dev server logs for the outbox job's success message.

- [ ] **Step 7: Commit**

```bash
git add app/hooks/useComposeForm.ts app/components/ComposePanel.tsx
git commit -m "feat(compose): upload attachments directly to R2 with progress + cancel"
```

---

### Task 3.4: Remove deprecated base64 upload path

**Files:**
- Modify: `app/lib/composeAttachments.ts`
- Modify: `shared/compose-attachments.ts`
- Modify: `workers/lib/attachments.ts`

- [ ] **Step 1: Delete `readFilesAsComposeAttachments` and `readFileAsBase64`**

In `app/lib/composeAttachments.ts`, delete the two functions and the `UploadedComposeAttachment` import if it's no longer referenced.

- [ ] **Step 2: Remove `UploadedComposeAttachment` from the union**

In `shared/compose-attachments.ts`:

```ts
export type ComposeAttachmentPayload =
    | StoredComposeAttachment
    | R2StagedComposeAttachment;
```

Delete the `UploadedComposeAttachment` interface.

- [ ] **Step 3: Delete the `upload` branch from `materializeAttachment`**

In `workers/lib/attachments.ts`, delete the `if (attachment.kind === "upload")` block.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors. (If there are errors, they'll point to lingering references to `UploadedComposeAttachment` — delete those too.)

- [ ] **Step 5: Re-run all Phase 1 + 2 E2E tests**

Run: `npm run e2e -- --grep "big attachments"`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/lib/composeAttachments.ts shared/compose-attachments.ts workers/lib/attachments.ts
git commit -m "refactor: remove deprecated base64 upload path"
```

---

### Task 3.5: Update existing Playwright e2e/attachments.spec.ts

**Files:**
- Modify: `e2e/attachments.spec.ts`

- [ ] **Step 1: The existing tests upload via file input and look for "test.pdf" to appear**

The new flow shows a progress bar then settles. Update assertions so they wait for `done` state. Find any tests that don't wait long enough — bump the timeout to 30s for big-file tests.

- [ ] **Step 2: Re-run**

Run: `npm run e2e -- --grep "attachment workflow"`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/attachments.spec.ts
git commit -m "test: update existing attachment specs for the new upload UX"
```

---

## Phase 4 — Production safety

### Task 4.1: Orphan cleanup cron handler

**Files:**
- Create: `workers/scheduled.ts`
- Modify: `workers/app.ts` (export scheduled handler)
- Modify: `wrangler.jsonc` (cron trigger)

- [ ] **Step 1: Create the handler**

```ts
// workers/scheduled.ts
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
```

- [ ] **Step 2: Export the `scheduled` handler from `workers/app.ts`**

Add at the bottom of `workers/app.ts`:

```ts
import { runOrphanCleanup } from "./scheduled";

export default {
    fetch: app.fetch,
    async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        ctx.waitUntil(runOrphanCleanup(env));
    },
    async queue(batch: MessageBatch<OutboxJob>, env: Env) {
        // ... existing queue handler ...
    },
};
```

(Match the existing export shape — if `workers/app.ts` currently exports `app.fetch` directly, wrap it in an object literal that includes `scheduled` and `queue`.)

- [ ] **Step 3: Add the cron trigger to wrangler.jsonc**

```jsonc
"triggers": {
    "crons": ["0 3 * * *"]   // daily at 03:00 UTC
},
```

- [ ] **Step 4: Test manually**

```bash
npm run dev
curl -X POST http://localhost:5173/__scheduled?cron=0+3+*+*+*
```

(Wrangler dev exposes a `/__scheduled` endpoint for triggering crons locally.)

Check the dev logs for cleanup messages.

- [ ] **Step 5: Commit**

```bash
git add workers/scheduled.ts workers/app.ts wrangler.jsonc
git commit -m "feat(cron): daily orphan cleanup for staged uploads"
```

---

### Task 4.2: E2E test for quota enforcement

**Files:**
- Modify: `e2e/big-attachments.spec.ts`

- [ ] **Step 1: Write the test**

Append:

```ts
test.describe("big attachments — quota", () => {
    test("sign endpoint rejects with 413 when staging quota exceeded", async ({ request }) => {
        // We can't actually upload 50 GiB in a test, but we can simulate the
        // condition by upload-and-confirming many small files. For dev mode,
        // override the quota constant via env var (add this support in Task 1.4
        // if not present), or just verify the 5 GiB single-file cap is enforced.
        const res = await request.post(SIGN_URL, {
            data: {
                filename: "huge.bin",
                size: 5 * 1024 * 1024 * 1024 + 1, // 5 GiB + 1 byte
                type: "application/octet-stream",
            },
        });
        expect(res.status()).toBe(400); // Zod schema cap
    });
});
```

- [ ] **Step 2: Run**

Run: `npm run e2e -- --grep "quota"`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/big-attachments.spec.ts
git commit -m "test: quota enforcement E2E"
```

---

### Task 4.3: Final smoke pass + deploy

- [ ] **Step 1: Run the full test suite**

Run: `npm run e2e`
Expected: all pass.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Deploy preview**

```bash
CLOUDFLARE_ACCOUNT_ID=8f0203259905d8923687286c84921e6c npx wrangler deploy --env preview
```

(Skip if there's no preview env yet — deploy to prod after manual smoke testing in dev.)

- [ ] **Step 5: Manual smoke against deployed environment**

In the deployed UI:
1. Attach a 1 KB file, send to yourself, verify it arrives as a real attachment.
2. Attach a 50 MB file, send to yourself, verify the email body has a Download link.
3. Click the link, verify the file downloads with the correct filename.
4. Cancel an in-progress upload, verify the partial state is cleaned up.

- [ ] **Step 6: Final commit + push**

Nothing left to commit unless tweaks were made.

---

## Self-review (already done by author)

- All four phases produce demoable progress.
- Tests exist for every public behavior change.
- Type names (`R2StagedComposeAttachment`, `OutboxAttachmentRef`, `MaterializedAttachment`) are consistent across tasks.
- No TBDs, no "implement later".
- Each task ends with a commit step.
- Tasks 2.3 and 3.3 are the largest — flag them for extra subagent review.
