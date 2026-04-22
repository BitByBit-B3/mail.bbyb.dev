# Mailbox Settings Pack — Design Spec

**Date:** 2026-04-22  
**Status:** Approved  
**Features:** Avatar upload, Email signature/footer, Email forwarding

---

## Overview

Three per-mailbox settings that share a single data layer: profile avatar (stored in R2), HTML email signature (appended to outgoing emails), and email forwarding (copies all inbound emails to an external address). All managed via the existing Settings page.

---

## Data Layer

All three fields extend the existing `settings` JSON column on the `mailboxes` table in `MailboxDO`'s SQLite. No migration file needed — the column is already a flexible JSON blob.

```ts
// Added to the existing settings object
{
  avatarUrl?: string;    // R2 public URL, e.g. /avatars/<mailboxId>.jpg
  signature?: string;   // Rendered HTML string
  forwardTo?: string;   // Email address, empty string = disabled
}
```

**Existing schema reference:** `workers/db/schema.ts` — `mailboxes.settings` column.

---

## Feature 1: Avatar Upload

### Backend

**New endpoint:** `POST /api/mailboxes/:mailboxId/avatar`

- Accepts `multipart/form-data` with a single `file` field (JPEG/PNG/WebP, max 2MB)
- Validates file type and size, rejects with 400 on failure
- Stores in R2 as `avatars/<mailboxId>` (overwrites on re-upload)
- Updates `settings.avatarUrl` in the mailbox SQLite DB
- Returns `{ avatarUrl: string }`

**New endpoint:** `DELETE /api/mailboxes/:mailboxId/avatar`

- Deletes the R2 object
- Clears `settings.avatarUrl`

**R2 serving:** R2 objects are served via the existing worker asset pipeline at `/avatars/<mailboxId>`. Add a new route in `workers/app.ts` that proxies `GET /avatars/:mailboxId` from R2 `BUCKET`.

### Frontend

**`app/components/Sidebar.tsx`** — replace the initials avatar with `<img>` when `settings.avatarUrl` exists. Fall back to initials if not set.

**`app/routes/settings.tsx`** — new "Profile" section:
- Shows current avatar (or initials placeholder)
- Upload button → triggers file input → POSTs to avatar endpoint
- Remove button (shown when avatar exists)

---

## Feature 2: Email Signature

### Backend

**Updated endpoint:** `PATCH /api/mailboxes/:mailboxId/settings` (already exists)

- Accepts `{ signature: string }` — the HTML string to store
- Stores in `settings.signature`

**`workers/email-sender.ts`** — `sendEmail()` function receives the mailbox settings. If `settings.signature` is non-empty, append it to the outgoing email HTML body:

```ts
const fullBody = settings?.signature
  ? `${htmlBody}<br><br><hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">${settings.signature}`
  : htmlBody;
```

For plain-text emails, append a plain-text version (strip HTML tags from signature).

### Signature Structure

The signature is built from structured fields (not a free-text HTML editor) to keep quality consistent:

```ts
interface SignatureFields {
  name: string;
  title?: string;
  company?: string;
  tagline?: string;
  phone?: string;
  website?: string;
  email?: string;
  linkedIn?: string;
}
```

A `buildSignatureHtml(fields, avatarUrl?)` utility renders these into the HTML block shown in the reference image: avatar left, name/title/tagline right, divider, contact details below.

### Frontend

**`app/routes/settings.tsx`** — new "Signature" section:
- Form fields: Name, Title, Company, Tagline, Phone, Website, Email (pre-filled from mailbox), LinkedIn URL
- Live preview renders the signature HTML as it'll appear in emails
- Save button → PATCH settings
- Toggle: "Include signature in outgoing emails" (enabled by default when signature is saved)

---

## Feature 3: Email Forwarding

### Backend

**`workers/index.ts`** — in the inbound email handler (`receiveEmail` / `email` export):

```ts
if (mailboxSettings?.forwardTo) {
  await env.EMAIL.send({
    to: mailboxSettings.forwardTo,
    from: message.to,
    subject: `Fwd: ${message.headers.get("subject")}`,
    // Forward raw message
    rawMessage: message.raw,
  });
}
```

Forwarding happens after the email is stored — a failure to forward does not block storage.

**Updated endpoint:** `PATCH /api/mailboxes/:mailboxId/settings`

- Accepts `{ forwardTo: string }` — empty string disables forwarding

### Frontend

**`app/routes/settings.tsx`** — new "Forwarding" section:
- Input: "Forward incoming emails to" + email field
- Save button
- Status indicator: "Forwarding active → user@example.com" or "Forwarding disabled"

---

## Files Modified

| File | Change |
|---|---|
| `workers/db/schema.ts` | Add `avatarUrl`, `signature`, `forwardTo` to settings type |
| `workers/lib/mailbox.ts` | Extend settings read/write helpers |
| `workers/lib/schemas.ts` | Add Zod schemas for new settings fields |
| `workers/index.ts` | Avatar upload/delete routes, forwarding in `receiveEmail` |
| `workers/app.ts` | R2 proxy route for `/avatars/:mailboxId` |
| `workers/email-sender.ts` | Append signature to outgoing emails |
| `app/routes/settings.tsx` | Profile, Signature, Forwarding sections |
| `app/components/Sidebar.tsx` | Avatar display |
| `app/queries/mailboxes.ts` | Avatar upload mutation, settings queries |

---

## Out of Scope

- Signature rich-text editor (structured fields only)
- Per-folder forwarding rules
- Forwarding filters (forward all or nothing)
- Image resizing/compression (store as-is, max 2MB enforced)
