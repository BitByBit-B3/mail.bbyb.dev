# Big Attachments via Direct R2 Upload + Download-Link Delivery

**Status:** Draft
**Date:** 2026-05-20
**Owner:** B3 Internal Mail

## Problem

Today, attaching a file in the compose panel reads the entire file into the browser as base64, sends it inside a JSON `POST` body to the Worker, and then the Worker re-encodes it as base64 for the outbound queue payload (`outbox/<jobId>.json`). The same file is held in memory three times across browser, Worker, and queue consumer. The pipeline breaks down around 20–25 MB raw file size because of:

- Workers request body limits combined with base64's ~33% inflation
- Worker memory pressure (128 MB cap)
- Cloudflare Email Routing's hard 25 MiB total message size limit ([source](https://developers.cloudflare.com/email-routing/limits/))

We want to support attachments up to **5 GB per file**, with a polished UX that mirrors how Gmail handles the same problem (real attachment for small files, Drive link for big ones).

## Goals

- Files up to 5 GB per attachment can be added to a draft
- Files ≤ 10 MB are delivered as real SMTP attachments (recipient sees them inline as today)
- Files > 10 MB are delivered as a download link in the email body, served from R2 via a Worker route on `mail.bbyb.dev/d/...`
- Inline images (signatures, etc.) always go as real attachments regardless of size
- Upload progress is visible to the user; uploads can be cancelled mid-flight
- Orphaned uploads (staged but never sent) are garbage-collected within 24 hours
- No regression to the existing inbound-attachment storage path

## Non-goals

- Multipart upload with resume support (single-PUT only; flaky-network reupload is a known limitation for v1)
- Per-mailbox configurable threshold (the 10 MB threshold is a hardcoded constant)
- Sender UI to delete already-sent link attachments retroactively
- Ref-counting across reply/forward — each send creates an independent `attachments` row that points at the same R2 key; deleting one email leaves other references intact
- Recipient identity verification on download (anyone with the link can download, by design)

## Background — Cloudflare's hard limits

| Resource | Limit | Source |
|---|---|---|
| `send_email` binding total message size (inc. base64) | **25 MiB** | [Email Routing limits](https://developers.cloudflare.com/email-routing/limits/) |
| Workers request body (Free/Pro plan) | 100 MB | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| R2 single PUT | 5 GiB | [R2 docs](https://developers.cloudflare.com/r2/) |
| R2 object max | 5 TiB (with multipart) | R2 docs |

The 25 MiB outbound wall is the reason the link-delivery path exists: it is not something we can engineer around. Even Cloudflare's own Limit Increase Request Form does not guarantee an increase, and recipient mail servers (Gmail, Outlook) impose the same ~25 MB cap downstream.

## Architecture

### Data flow

```
[Browser]                        [Worker]                      [R2]
   │                                │                            │
   │ 1. POST /attachments/sign      │                            │
   ├───────────────────────────────►│                            │
   │    { filename, size, type }    │ aws4fetch presign PUT      │
   │                                │ key = uploads/<mbox>/<id>  │
   │ ◄──────────────────────────────┤                            │
   │    { url, uploadId }           │                            │
   │                                │                            │
   │ 2. PUT to presigned URL ───────┼───────────────────────────►│
   │    (raw bytes, direct)         │                            │ ← bypasses Worker
   │                                │                            │
   │ 3. POST /attachments/confirm   │                            │
   ├───────────────────────────────►│ HEAD verify size+type,     │
   │    { uploadId }                │ write pending_uploads row  │
   │ ◄──────────────────────────────┤                            │
   │                                │                            │
   │ 4. POST /emails (send)         │                            │
   ├───────────────────────────────►│ For each r2-staged attach: │
   │    { attachments: [            │  size ≤ 10MB → real attach │
   │      { kind:"r2-staged", ... } │  size > 10MB → link card   │
   │    ] }                         │ Persist attachments rows   │
   │                                │ Enqueue job w/ r2_key refs │
   │                                │                            │
   │ … recipient opens email …      │                            │
   │                                │                            │
   │                                │ GET /d/:emailId/:attId/... │
   │                                │ ◄───── (no auth)           │
   │                                │ Stream R2 object back      │
```

### R2 layout

```
mailboxes/<mailboxId>.json                  (existing — mailbox config)
attachments/<emailId>/<attId>/<filename>    (existing — inbound + small outbound)
outbox/<jobId>.json                          (existing — but no longer embeds bytes)

uploads/<mailboxId>/<uploadId>              ← NEW: staging area for browser→R2 PUT
                                              also the permanent home for
                                              big-file link attachments
```

Big-file attachments stay at `uploads/<mailboxId>/<uploadId>` permanently. We do not copy them to `attachments/<emailId>/...` because a 5 GB stream-copy through the Worker would exceed queue consumer time budgets. The new `attachments.r2_key` column records the explicit key.

Small-file attachments still get stream-copied into `attachments/<emailId>/<attId>/<filename>` to preserve the existing convention; their `r2_key` column stays NULL.

### Files touched

**New files**

- `workers/lib/r2-presign.ts` — aws4fetch-based S3 presign helper for R2
- `workers/routes/attachments.ts` — sign / confirm / cancel endpoints
- `workers/routes/download.ts` — `GET /d/:emailId/:attId/:filename` handler
- `workers/scheduled.ts` — Cron Trigger handler for orphan cleanup

**Modified files**

- `shared/compose-attachments.ts` — add `R2StagedComposeAttachment` variant
- `app/lib/composeAttachments.ts` — replace `readFilesAsComposeAttachments` with `uploadFilesToR2`
- `app/components/ComposeAttachments.tsx` — per-file progress, cancel, error states
- `app/hooks/useComposeForm.ts` — track upload state per attachment
- `workers/lib/attachments.ts` — handle `kind: "r2-staged"`, link-card HTML/text injection
- `workers/lib/outbound-queue.ts` — payload references R2 keys instead of embedded base64
- `workers/index.ts` — send route splits small vs big, claims pending_uploads rows
- `workers/app.ts` — mount `/d/*` route **before** Access JWT middleware
- `workers/durableObject/migrations.ts` — add `pending_uploads` table, `attachments.r2_key` column
- `wrangler.jsonc` — add `[triggers.crons]`, env vars `R2_S3_ACCOUNT_ID`, `R2_S3_BUCKET`
- `app/types/index.ts` — extend attachment types

**Secrets** (user creates an R2 API token in the Cloudflare dashboard, then `wrangler secret put`)

- `R2_S3_ACCESS_KEY_ID`
- `R2_S3_SECRET_ACCESS_KEY`

## API surface

### `POST /api/v1/mailboxes/:mailboxId/attachments/sign`

Request:
```ts
{ filename: string; size: number; type: string }
```

Validation:
- `size <= 5_368_709_120` (5 GiB)
- `filename` non-empty after sanitization
- Per-mailbox staging quota: sum of `pending_uploads.size` ≤ 50 GiB

Response:
```ts
{
  uploadId: string;       // UUID
  url: string;            // presigned PUT, 1 hour expiry, signs only host header
  expiresAt: string;      // ISO 8601
}
```

Errors: `413` quota exceeded or file too large · `400` invalid input

### `POST /api/v1/mailboxes/:mailboxId/attachments/confirm`

Request:
```ts
{ uploadId: string }
```

Behavior:
- `HEAD uploads/<mailboxId>/<uploadId>` — must exist
- Compare actual size to sign-time declared size (must match exactly — R2 stored size is authoritative)
- Insert `pending_uploads` row

Response:
```ts
{ uploadId: string; size: number }
```

Errors: `404` object missing · `409` size mismatch

### `DELETE /api/v1/mailboxes/:mailboxId/attachments/:uploadId`

Deletes the R2 staging object and the `pending_uploads` row. Used when the user removes an attachment from the compose panel before sending.

### `GET /d/:emailId/:attId/:filename`

**No Cloudflare Access JWT required** — this is the public download link. Must be mounted in `workers/app.ts` before the Access middleware.

Behavior:
- Look up the `attachments` row by `(emailId, attId)` via the mailbox DO
- Verify `filename` in the URL matches the stored filename (path-safety)
- Stream the R2 object back

Response headers:
- `Content-Type: <stored mimetype>`
- `Content-Disposition: attachment; filename="<filename>"` (always — forces download, prevents inline HTML/JS rendering on `mail.bbyb.dev` origin)
- `X-Content-Type-Options: nosniff`
- `Cache-Control: private, max-age=3600`
- `X-Robots-Tag: noindex, nofollow`

Errors: `404` with a friendly "this file is no longer available" page

### Modified send routes

`POST /api/v1/mailboxes/:mailboxId/emails` (and the reply/forward variants) accept a new attachment kind:

```ts
type ComposeAttachmentPayload =
  | UploadedComposeAttachment      // existing — base64 inline (deprecated, removed in phase 3)
  | StoredComposeAttachment        // existing — reuse from earlier email
  | R2StagedComposeAttachment;     // NEW

interface R2StagedComposeAttachment {
  kind: "r2-staged";
  uploadId: string;
  filename: string;
  type: string;
  size: number;
  disposition: "attachment" | "inline";
  contentId?: string;
}
```

Server-side processing:

1. Resolve each `r2-staged` item: fetch `pending_uploads` row by `uploadId`, verify ownership (matches `mailboxId`)
2. For each attachment, decide delivery mode:
   - `disposition === "inline"` → always real attach (no threshold check)
   - `size <= 10 * 1024 * 1024` → real attach (stream-copy synchronously to `attachments/<emailId>/<attId>/<filename>`, `attachments.r2_key = NULL`). Synchronous is acceptable because the path is gated by the 10 MB threshold — copy time is on the order of 200 ms.
   - else → link delivery (stay at `uploads/<mailboxId>/<uploadId>`, `attachments.r2_key = uploads/<mailboxId>/<uploadId>`)
3. Insert one `attachments` row per file
4. Delete the `pending_uploads` rows (claim)
5. For link-delivery attachments, inject the link card into the outgoing HTML and a plaintext fallback into the text part
6. Enqueue the outbox job with `attachmentRefs` (R2 keys, not bytes)

## Data model changes

In `workers/durableObject/migrations.ts`, add a new migration:

```sql
-- Migration: big-attachments-staging
ALTER TABLE attachments ADD COLUMN r2_key TEXT;

CREATE TABLE pending_uploads (
  upload_id  TEXT PRIMARY KEY,
  r2_key     TEXT NOT NULL,
  filename   TEXT NOT NULL,
  mimetype   TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_pending_uploads_created ON pending_uploads(created_at);
```

`attachments.r2_key` is nullable. NULL means legacy convention (`attachments/<emailId>/<id>/<filename>`). Non-NULL means use this exact key. A helper `attachmentR2Key(att)` centralizes the lookup so call sites never branch.

## Outbox payload change

In `workers/lib/outbound-queue.ts`, `OutboxPayload` evolves:

```ts
// Before
interface OutboxPayload {
  jobId: string;
  mailboxId: string;
  sentEmailId: string;
  params: SendEmailParams;    // params.attachments[].content is base64 of the full file
}

// After
interface OutboxPayload {
  jobId: string;
  mailboxId: string;
  sentEmailId: string;
  paramsCore: Omit<SendEmailParams, "attachments">;
  attachmentRefs: Array<{
    r2Key: string;
    filename: string;
    type: string;
    size: number;
    disposition: "attachment" | "inline";
    contentId?: string;
  }>;
}
```

The queue consumer fetches each blob via `BUCKET.get(r2Key)` just-in-time, base64-encodes, and assembles MIME via `mimetext` as today. Because all real-attached files combined stay under 25 MiB (enforced by the threshold), MIME assembly memory remains bounded.

Link-delivery attachments are **not** in `attachmentRefs` — they live only in the HTML body as link cards by the time the job is enqueued.

## Link card markup

HTML injected at the end of the email body, before any signature:

```html
<table style="border:1px solid #e0e0e0; border-radius:8px; padding:12px; margin:16px 0; font-family:sans-serif; max-width:480px;">
  <tr>
    <td style="padding-right:12px; vertical-align:top;">📎</td>
    <td>
      <div style="font-weight:600; color:#222;">filename.zip</div>
      <div style="font-size:12px; color:#666; margin-top:2px;">125 MB</div>
      <div style="margin-top:8px;">
        <a href="https://mail.bbyb.dev/d/<emailId>/<attId>/filename.zip"
           style="color:#0070f3; text-decoration:none;">Download</a>
      </div>
    </td>
  </tr>
</table>
```

Plaintext fallback appended to the text part:

```
[Attachment: filename.zip (125 MB) — https://mail.bbyb.dev/d/<emailId>/<attId>/filename.zip]
```

## Error handling

| Failure | Behavior |
|---|---|
| Browser dies mid-PUT | R2 single PUT is atomic — failed PUT leaves nothing. User retries. |
| Confirm fails with object missing | `404`; UI removes the attachment row with an error toast |
| Confirm fails with size mismatch | `409`; UI removes the attachment row, asks user to retry |
| Send route can't find `pending_uploads` row (e.g. retry after success) | Look in `attachments` table for an `r2_key` equal to `uploads/<mailboxId>/<uploadId>`; if present, treat as already-claimed and short-circuit the claim step |
| Queue consumer retries fail with R2 fetch 404 | DLQ the message after configured retries; log loudly |
| Recipient clicks `/d/...` link, R2 object deleted | Return `404` with a static "this file is no longer available" HTML page |
| User uploads an HTML/JS file, recipient clicks link | `Content-Disposition: attachment` + `nosniff` forces download, no inline render |
| Inline-image signature attachments | `disposition === "inline"` always real-attach; threshold only applies to `attachment` disposition |
| Per-mailbox staging blows past 50 GiB | Sign endpoint returns `413` with "delete unsent files first" |
| Concurrent uploads from the same user | Each gets a unique `uploadId`; no collision |
| Browser refresh before confirm | Orphan in R2; cleaned by 24h cron |

## Cleanup

A Cron Trigger runs daily at 03:00 UTC. The handler:

1. For each mailbox DO, query `pending_uploads WHERE created_at < now - 24h`
2. Delete the corresponding R2 objects (one `bucket.delete` per orphan)
3. Delete the `pending_uploads` rows
4. Idempotent: re-running mid-batch picks up where it left off

The handler does **not** touch `attachments.r2_key` rows — those are claimed and tracked by the email lifecycle.

## Frontend changes

### Upload flow in `app/lib/composeAttachments.ts`

Replace `readFilesAsComposeAttachments` with `uploadFilesToR2`:

```ts
export interface UploadProgress {
  localId: string;
  phase: "signing" | "uploading" | "confirming" | "done" | "error";
  bytesUploaded?: number;
  totalBytes?: number;
  error?: string;
}

export async function uploadFilesToR2(
  files: FileList | File[],
  mailboxId: string,
  onProgress: (p: UploadProgress) => void,
  signal: AbortSignal,
): Promise<ComposeAttachmentItem[]> {
  // 1. POST /attachments/sign per file
  // 2. fetch(url, { method:"PUT", body: file, signal }) — use XMLHttpRequest for progress events
  // 3. POST /attachments/confirm
  // 4. Yield ComposeAttachmentItem with kind: "r2-staged"
}
```

`XMLHttpRequest` is used because `fetch()` does not expose upload progress events in all browser/runtime combos.

### `ComposeAttachments.tsx`

- Per-file row shows: filename, size, progress bar (during upload), cancel button (during upload), remove button (after upload)
- Cancel during upload calls `AbortController.abort()` and `DELETE /attachments/:uploadId`
- Error state shows a retry button

### Compose state in `useComposeForm.ts`

The form's `attachments` array now mixes:
- `kind: "r2-staged"` items (newly uploaded)
- `kind: "stored"` items (replying/forwarding existing attachments)
- No more `kind: "upload"` items — that path is removed once phase 3 ships

## Security considerations

- **`/d/...` is unauthenticated by design** — anyone with the link can download. URL contains two UUIDs (122 bits + 122 bits of entropy) which is unguessable.
- **Always serve as attachment, not inline** — prevents XSS via uploaded HTML on the `mail.bbyb.dev` origin
- **`X-Content-Type-Options: nosniff`** — prevents MIME-sniffing surprises
- **Presigned URLs sign only the `host` header** (per aws4fetch + R2 conventions) so the browser can PUT without colliding on Content-Type signing
- **R2 S3 token scoping** — the API token created in the Cloudflare dashboard should be scoped to the `b3-mail` bucket only, with read+write permissions
- **CORS on R2 bucket** — needs to allow `PUT` from `https://mail.bbyb.dev` (and `http://localhost:5173` in dev)
- **No rate limiting in v1** — Access JWT gates the upload endpoints; rate limiting can be layered on later via Cloudflare WAF if abuse is observed

## Testing

### Unit
- `r2-presign.ts`: signs only host header, expiry param correct, URL format valid
- Threshold logic: 9.9 MB → real, 10.1 MB → link, inline always real
- Link-card HTML/text injection produces well-formed output
- `materializeAttachment` correctly handles all three `kind` values

### Integration (Miniflare R2 + DO)
- Full upload→confirm→send for a 1 KB file → arrives as real attachment in MIME
- Full upload→confirm→send for a 50 MB file → MIME has no attachment, body has link card
- Mixed 2 small + 1 big → 2 real attachments + 1 link card
- Confirm fails when R2 object missing (`404`)
- Confirm fails on size mismatch (`409`)
- Concurrent upload sessions for the same mailbox don't collide
- Quota: 51st GB of staging is rejected with `413`
- Cleanup cron: orphan staging older than 24h is deleted; claimed uploads survive

### E2E (Playwright)
- User uploads a 50 MB file, sees progress, clicks Send, recipient receives email with download link
- User uploads 2 files, removes one before send, sends — only kept file is attached/linked
- User opens a `/d/...` link in incognito → file downloads with the original filename
- User cancels an in-progress upload — partial state is cleaned up

## Build order

| Phase | Deliverable | Demo-able outcome |
|---|---|---|
| **1** | R2 presign helper, sign + confirm endpoints, `r2-staged` materialization, outbox payload references R2 keys | curl can upload→confirm→send a small file via the new path; existing UI still works |
| **2** | `/d/...` route, threshold logic, link-card injection | Send a 100 MB file via curl; recipient gets a working download link |
| **3** | UI swap: progress bars, cancel, drag-drop | Real users can send 1 GB+ files |
| **4** | Cron cleanup + per-mailbox quota | Production-safe; no R2 cost runaway |

Phases 1–2 ship the actual capability; 3–4 polish.

## Open questions

- Should the 10 MB threshold be settable per-mailbox in `MailboxSettings`? (Decision: NO for v1 — keep hardcoded constant. Trivial to add later.)
- Should we add a "download notification" feature (sender sees when recipient downloaded)? (Decision: NO for v1 — out of scope.)
