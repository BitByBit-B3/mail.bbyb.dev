# Mailbox Settings Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add avatar upload, structured email signature, and email forwarding to each mailbox's settings page.

**Architecture:** Settings are a JSON blob in R2 at `mailboxes/<mailboxId>.json`; new fields extend `MailboxSettings` without migrations. The signature builder lives in `shared/signature.ts` so both the frontend preview and compose form can use it. Avatar files are stored in R2 at `avatars/<mailboxId>.<ext>` and served via a new proxy route.

**Tech Stack:** Hono (backend routes), React 19 + React Query (frontend), R2 (avatar storage), Kumo design system, Tiptap (editor), TanStack Query mutations.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `shared/signature.ts` | **Create** | `SignatureFields` interface + `buildSignatureHtml()` utility (shared frontend/backend) |
| `app/types/index.ts` | **Modify** | Add `avatarUrl`, `signatureFields`, `signatureEnabled` to `MailboxSettings` |
| `workers/index.ts` | **Modify** | Avatar upload `POST`, avatar delete `DELETE`, forwarding logic in `receiveEmail` |
| `workers/app.ts` | **Modify** | Add `GET /avatars/:filename` R2 proxy route |
| `app/lib/utils.ts` | **Modify** | Update `getSignatureBlock()` to use `signatureFields` via `buildSignatureHtml` |
| `app/routes/settings.tsx` | **Modify** | Add Profile (avatar), Signature, Forwarding sections |
| `app/components/Sidebar.tsx` | **Modify** | Show avatar image or initials fallback |
| `app/queries/mailboxes.ts` | **Modify** | Add `useUploadAvatar`, `useDeleteAvatar` mutations |

---

## Task 1: Signature builder utility in shared/

**Files:**
- Create: `shared/signature.ts`

- [ ] **Step 1: Create the file**

```ts
// shared/signature.ts

export interface SignatureFields {
  name: string;
  title?: string;
  company?: string;
  tagline?: string;
  phone?: string;
  website?: string;
  email?: string;
  linkedIn?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSignatureHtml(fields: SignatureFields, avatarUrl?: string): string {
  const contactRows: string[] = [];
  if (fields.phone)
    contactRows.push(
      `<div style="font-size:12px;color:#666;padding:2px 0">📞 <a href="tel:${esc(fields.phone)}" style="color:#555;text-decoration:none">${esc(fields.phone)}</a></div>`,
    );
  if (fields.email)
    contactRows.push(
      `<div style="font-size:12px;color:#666;padding:2px 0">✉ <a href="mailto:${esc(fields.email)}" style="color:#555;text-decoration:none">${esc(fields.email)}</a></div>`,
    );
  if (fields.website)
    contactRows.push(
      `<div style="font-size:12px;color:#666;padding:2px 0">🌐 <a href="${esc(fields.website)}" style="color:#555;text-decoration:none">${esc(fields.website)}</a></div>`,
    );
  if (fields.linkedIn)
    contactRows.push(
      `<div style="font-size:12px;color:#666;padding:2px 0"><a href="${esc(fields.linkedIn)}" style="color:#555;text-decoration:none">LinkedIn</a></div>`,
    );

  const avatarHtml = avatarUrl
    ? `<img src="${esc(avatarUrl)}" width="52" height="52" style="border-radius:50%;object-fit:cover;display:block" alt="${esc(fields.name)}">`
    : "";

  const identity = [
    `<div style="font-weight:700;font-size:14px;color:#111">${esc(fields.name)}</div>`,
    fields.title
      ? `<div style="font-size:12px;color:#555;margin-top:1px">${esc(fields.title)}</div>`
      : "",
    fields.company
      ? `<div style="font-size:12px;color:#555">${esc(fields.company)}</div>`
      : "",
    fields.tagline
      ? `<div style="font-size:11px;color:#888;font-style:italic;margin-top:2px">${esc(fields.tagline)}</div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const leftCol = avatarUrl
    ? `<td style="padding-right:14px;vertical-align:top">${avatarHtml}</td>`
    : "";

  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px"><tr>${leftCol}<td style="vertical-align:top">${identity}${contactRows.length > 0 ? `<div style="margin-top:6px">${contactRows.join("")}</div>` : ""}</td></tr></table>`;
}
```

- [ ] **Step 2: Verify TypeScript accepts it**

```bash
npm run typecheck
```

Expected: no errors from `shared/signature.ts` (it has no imports, so it's self-contained).

- [ ] **Step 3: Commit**

```bash
git add shared/signature.ts
git commit -m "feat: add shared signature builder utility"
```

---

## Task 2: Extend MailboxSettings type

**Files:**
- Modify: `app/types/index.ts`

- [ ] **Step 1: Add fields to MailboxSettings and import SignatureFields**

Open `app/types/index.ts`. Replace the existing content with:

```ts
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export type { SignatureFields } from "../../shared/signature";

export interface SignatureSettings {
  enabled: boolean;
  text: string;
  html?: string;
}

export interface MailboxSettings {
  fromName?: string;
  forwarding?: { enabled: boolean; email: string };
  signature?: SignatureSettings;
  autoReply?: { enabled: boolean; subject: string; message: string };
  agentSystemPrompt?: string;
  // New fields (settings pack)
  avatarUrl?: string;
  signatureFields?: import("../../shared/signature").SignatureFields;
  signatureEnabled?: boolean;
}

export interface Mailbox {
  id: string;
  email: string;
  name: string;
  settings?: MailboxSettings;
}

export interface Email {
  id: string;
  thread_id?: string | null;
  folder_id?: string | null;
  subject: string;
  sender: string;
  recipient: string;
  cc?: string;
  bcc?: string;
  date: string;
  read: boolean;
  starred: boolean;
  body?: string | null;
  in_reply_to?: string | null;
  email_references?: string | null;
  message_id?: string | null;
  raw_headers?: string | null;
  attachments?: Attachment[];
  snippet?: string | null;
  thread_count?: number;
  thread_unread_count?: number;
  participants?: string;
  needs_reply?: boolean;
  has_draft?: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  content_id?: string;
  disposition?: string;
}

export interface Folder {
  id: string;
  name: string;
  unreadCount: number;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/types/index.ts
git commit -m "feat: extend MailboxSettings with avatarUrl, signatureFields, signatureEnabled"
```

---

## Task 3: Update getSignatureBlock to use structured fields

**Files:**
- Modify: `app/lib/utils.ts`

- [ ] **Step 1: Import buildSignatureHtml at the top of utils.ts**

Add import after the existing imports:

```ts
import { buildSignatureHtml } from "../../shared/signature";
import type { SignatureFields } from "../../shared/signature";
```

- [ ] **Step 2: Replace getSignatureBlock function**

Find the existing `getSignatureBlock` function and replace it:

```ts
export function getSignatureBlock(settings?: {
  signature?: { enabled: boolean; text?: string; html?: string };
  signatureFields?: SignatureFields;
  signatureEnabled?: boolean;
  avatarUrl?: string;
}): string {
  if (!settings) return "";

  // Prefer structured signatureFields if present and enabled
  if (settings.signatureEnabled && settings.signatureFields?.name) {
    const html = buildSignatureHtml(settings.signatureFields, settings.avatarUrl);
    return `<div class="b3-signature" style="margin-top:16px">${html}</div>`;
  }

  // Fall back to legacy signature.enabled/text/html
  const sig = settings.signature;
  if (sig?.enabled && (sig?.html || sig?.text)) {
    const content = sig.html
      ? DOMPurify.sanitize(sig.html)
      : escapeHtml(sig.text || "");
    return `<div style="border-top: 1px solid #ccc; margin-top: 16px; padding-top: 12px;">${content}</div>`;
  }

  return "";
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/utils.ts
git commit -m "feat: update getSignatureBlock to use structured signatureFields"
```

---

## Task 4: Avatar backend routes + R2 proxy

**Files:**
- Modify: `workers/index.ts`
- Modify: `workers/app.ts`

- [ ] **Step 1: Add avatar upload route to workers/index.ts**

Add these two routes after the mailbox DELETE route (around line 141) in `workers/index.ts`:

```ts
// Avatar upload
app.post("/api/v1/mailboxes/:mailboxId/avatar", async (c: AppContext) => {
  const mailboxId = c.req.param("mailboxId")!;
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: "No file provided" }, 400);

  const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  if (!ALLOWED.includes(file.type))
    return c.json({ error: "File must be JPEG, PNG, or WebP" }, 400);

  if (file.size > 2 * 1024 * 1024)
    return c.json({ error: "File must be under 2 MB" }, 400);

  const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const avatarKey = `avatars/${mailboxId}.${ext}`;

  await c.env.BUCKET.put(avatarKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  // Clean up old avatar files with other extensions
  for (const oldExt of ["jpg", "png", "webp"]) {
    if (`avatars/${mailboxId}.${oldExt}` !== avatarKey) {
      await c.env.BUCKET.delete(`avatars/${mailboxId}.${oldExt}`).catch(() => {});
    }
  }

  const settingsKey = `mailboxes/${mailboxId}.json`;
  const existing = await c.env.BUCKET.get(settingsKey);
  const settings = existing ? ((await existing.json()) as Record<string, unknown>) : {};
  const avatarUrl = `/avatars/${mailboxId}.${ext}`;
  await c.env.BUCKET.put(settingsKey, JSON.stringify({ ...settings, avatarUrl }));

  return c.json({ avatarUrl });
});

// Avatar delete
app.delete("/api/v1/mailboxes/:mailboxId/avatar", async (c: AppContext) => {
  const mailboxId = c.req.param("mailboxId")!;

  for (const ext of ["jpg", "png", "webp"]) {
    await c.env.BUCKET.delete(`avatars/${mailboxId}.${ext}`).catch(() => {});
  }

  const settingsKey = `mailboxes/${mailboxId}.json`;
  const existing = await c.env.BUCKET.get(settingsKey);
  if (existing) {
    const settings = (await existing.json()) as Record<string, unknown>;
    const { avatarUrl: _removed, ...rest } = settings;
    await c.env.BUCKET.put(settingsKey, JSON.stringify(rest));
  }

  return c.body(null, 204);
});
```

- [ ] **Step 2: Add R2 avatar proxy route to workers/app.ts**

Add this route just before the `app.all("*", ...)` React Router catch-all at the bottom of `workers/app.ts`:

```ts
// Serve avatars from R2
app.get("/avatars/:filename{.+}", async (c) => {
  const filename = c.req.param("filename");
  const obj = await c.env.BUCKET.get(`avatars/${filename}`);
  if (!obj) return c.text("Not found", 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add workers/index.ts workers/app.ts
git commit -m "feat: add avatar upload/delete routes and R2 proxy for /avatars/"
```

---

## Task 5: Avatar mutations in queries

**Files:**
- Modify: `app/queries/mailboxes.ts`

- [ ] **Step 1: Add avatar upload and delete mutations**

Add these two hooks at the end of `app/queries/mailboxes.ts`:

```ts
export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mailboxId, file }: { mailboxId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/v1/mailboxes/${mailboxId}/avatar`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Upload failed");
      }
      return res.json() as Promise<{ avatarUrl: string }>;
    },
    onSuccess: (_data, { mailboxId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(mailboxId) });
      qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
    },
  });
}

export function useDeleteAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const res = await fetch(`/api/v1/mailboxes/${mailboxId}/avatar`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: (_data, mailboxId) => {
      qc.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(mailboxId) });
      qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add app/queries/mailboxes.ts
git commit -m "feat: add useUploadAvatar and useDeleteAvatar mutations"
```

---

## Task 6: Sidebar avatar display

**Files:**
- Modify: `app/components/Sidebar.tsx`

- [ ] **Step 1: Replace the name/email header with avatar + text**

In `app/components/Sidebar.tsx`, find the `<div className="px-1">` block (around line 138) and replace it:

```tsx
<div className="flex items-center gap-3 px-1">
  {currentMailbox?.settings?.avatarUrl ? (
    <img
      src={currentMailbox.settings.avatarUrl}
      alt={displayName}
      className="h-9 w-9 rounded-full object-cover shrink-0"
    />
  ) : (
    <div className="h-9 w-9 rounded-full bg-kumo-fill flex items-center justify-center text-sm font-semibold text-kumo-default shrink-0">
      {displayName.charAt(0).toUpperCase()}
    </div>
  )}
  <div className="min-w-0">
    <div className="text-base font-semibold text-kumo-default truncate">
      {displayName}
    </div>
    <div className="text-sm text-kumo-subtle truncate mt-0.5">
      {currentMailbox?.email || mailboxId}
    </div>
  </div>
</div>
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add app/components/Sidebar.tsx
git commit -m "feat: show avatar or initials in sidebar header"
```

---

## Task 7: Settings page — Profile, Signature, Forwarding sections

**Files:**
- Modify: `app/routes/settings.tsx`

This is the largest task. Replace the entire file content with the following (which extends the existing Account + Agent Prompt sections with three new sections):

- [ ] **Step 1: Write the new settings page**

```tsx
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import {
  ArrowCounterClockwiseIcon,
  RobotIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import DOMPurify from "dompurify";
import { buildSignatureHtml } from "../../../shared/signature";
import type { SignatureFields } from "../../../shared/signature";
import {
  useDeleteAvatar,
  useMailbox,
  useUpdateMailbox,
  useUploadAvatar,
} from "~/queries/mailboxes";

const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

const EMPTY_SIG_FIELDS: SignatureFields = {
  name: "",
  title: "",
  company: "",
  tagline: "",
  phone: "",
  website: "",
  email: "",
  linkedIn: "",
};

export default function SettingsRoute() {
  const { mailboxId } = useParams<{ mailboxId: string }>();
  const toastManager = useKumoToastManager();
  const { data: mailbox } = useMailbox(mailboxId);
  const updateMailboxMutation = useUpdateMailbox();
  const uploadAvatarMutation = useUploadAvatar();
  const deleteAvatarMutation = useDeleteAvatar();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Signature state
  const [sigFields, setSigFields] = useState<SignatureFields>(EMPTY_SIG_FIELDS);
  const [sigEnabled, setSigEnabled] = useState(false);

  // Forwarding state
  const [forwardEmail, setForwardEmail] = useState("");
  const [forwardEnabled, setForwardEnabled] = useState(false);
  const [isSavingForward, setIsSavingForward] = useState(false);

  useEffect(() => {
    if (!mailbox) return;
    setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
    setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
    setSigFields({
      ...EMPTY_SIG_FIELDS,
      ...(mailbox.settings?.signatureFields || {}),
      // Pre-fill email from mailbox if empty
      email: mailbox.settings?.signatureFields?.email || mailbox.email || "",
    });
    setSigEnabled(mailbox.settings?.signatureEnabled ?? false);
    setForwardEmail(mailbox.settings?.forwarding?.email || "");
    setForwardEnabled(mailbox.settings?.forwarding?.enabled ?? false);
  }, [mailbox]);

  const handleSave = async () => {
    if (!mailbox || !mailboxId) return;
    setIsSaving(true);
    const settings = {
      ...mailbox.settings,
      fromName: displayName,
      agentSystemPrompt: agentPrompt.trim() || undefined,
      signatureFields: sigFields,
      signatureEnabled: sigEnabled,
    };
    try {
      await updateMailboxMutation.mutateAsync({ mailboxId, settings });
      toastManager.add({ title: "Settings saved!" });
    } catch {
      toastManager.add({ title: "Failed to save settings", variant: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveForwarding = async () => {
    if (!mailbox || !mailboxId) return;
    setIsSavingForward(true);
    const settings = {
      ...mailbox.settings,
      forwarding: { enabled: forwardEnabled, email: forwardEmail },
    };
    try {
      await updateMailboxMutation.mutateAsync({ mailboxId, settings });
      toastManager.add({ title: "Forwarding settings saved!" });
    } catch {
      toastManager.add({ title: "Failed to save forwarding settings", variant: "error" });
    } finally {
      setIsSavingForward(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !mailboxId) return;
    try {
      await uploadAvatarMutation.mutateAsync({ mailboxId, file });
      toastManager.add({ title: "Avatar updated!" });
    } catch (err) {
      toastManager.add({
        title: err instanceof Error ? err.message : "Upload failed",
        variant: "error",
      });
    }
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAvatarDelete = async () => {
    if (!mailboxId) return;
    try {
      await deleteAvatarMutation.mutateAsync(mailboxId);
      toastManager.add({ title: "Avatar removed" });
    } catch {
      toastManager.add({ title: "Failed to remove avatar", variant: "error" });
    }
  };

  const sigPreviewHtml =
    sigEnabled && sigFields.name
      ? DOMPurify.sanitize(buildSignatureHtml(sigFields, mailbox?.settings?.avatarUrl))
      : null;

  const isCustomPrompt = agentPrompt.trim().length > 0;

  if (!mailbox) {
    return (
      <div className="flex justify-center py-20">
        <Loader size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
      <h1 className="text-lg font-semibold text-kumo-default mb-6">Settings</h1>

      <div className="space-y-6">
        {/* Account */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-4">Account</div>
          <div className="space-y-3">
            <Input
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Input label="Email" type="email" value={mailbox.email} disabled />
          </div>
        </div>

        {/* Avatar */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-4">Profile Avatar</div>
          <div className="flex items-center gap-4">
            {mailbox.settings?.avatarUrl ? (
              <img
                src={mailbox.settings.avatarUrl}
                alt="Avatar"
                className="h-16 w-16 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-kumo-fill flex items-center justify-center text-xl font-semibold text-kumo-default shrink-0">
                {displayName.charAt(0).toUpperCase() || "?"}
              </div>
            )}
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<UploadSimpleIcon size={14} />}
                loading={uploadAvatarMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {mailbox.settings?.avatarUrl ? "Change Avatar" : "Upload Avatar"}
              </Button>
              {mailbox.settings?.avatarUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<TrashIcon size={14} />}
                  loading={deleteAvatarMutation.isPending}
                  onClick={handleAvatarDelete}
                >
                  Remove
                </Button>
              )}
              <p className="text-xs text-kumo-subtle">JPEG, PNG or WebP · max 2 MB</p>
            </div>
          </div>
        </div>

        {/* Signature */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-1">Email Signature</div>
          <p className="text-xs text-kumo-subtle mb-4">
            Appended to emails you compose. Rendered from your profile info.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Name *"
                placeholder="Jane Smith"
                value={sigFields.name}
                onChange={(e) => setSigFields({ ...sigFields, name: e.target.value })}
              />
              <Input
                label="Title"
                placeholder="Software Engineer"
                value={sigFields.title || ""}
                onChange={(e) => setSigFields({ ...sigFields, title: e.target.value })}
              />
              <Input
                label="Company"
                placeholder="BitByBit"
                value={sigFields.company || ""}
                onChange={(e) => setSigFields({ ...sigFields, company: e.target.value })}
              />
              <Input
                label="Tagline"
                placeholder="Building something great"
                value={sigFields.tagline || ""}
                onChange={(e) => setSigFields({ ...sigFields, tagline: e.target.value })}
              />
              <Input
                label="Phone"
                type="tel"
                placeholder="+1 234 567 8900"
                value={sigFields.phone || ""}
                onChange={(e) => setSigFields({ ...sigFields, phone: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                placeholder="you@bbyb.dev"
                value={sigFields.email || ""}
                onChange={(e) => setSigFields({ ...sigFields, email: e.target.value })}
              />
              <Input
                label="Website"
                placeholder="https://bitbybit.dev"
                value={sigFields.website || ""}
                onChange={(e) => setSigFields({ ...sigFields, website: e.target.value })}
              />
              <Input
                label="LinkedIn URL"
                placeholder="https://linkedin.com/in/..."
                value={sigFields.linkedIn || ""}
                onChange={(e) => setSigFields({ ...sigFields, linkedIn: e.target.value })}
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={sigEnabled}
                onChange={(e) => setSigEnabled(e.target.checked)}
                className="rounded border-kumo-line"
              />
              <span className="text-sm text-kumo-default">
                Include signature in outgoing emails
              </span>
            </label>

            {sigPreviewHtml && (
              <div>
                <div className="text-xs font-medium text-kumo-subtle mb-2">Preview</div>
                <div
                  className="border border-kumo-line rounded-md p-4 bg-kumo-recessed text-kumo-default"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: sigPreviewHtml }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Forwarding */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-1">Email Forwarding</div>
          <p className="text-xs text-kumo-subtle mb-4">
            Forward a copy of every inbound email to an external address.
          </p>
          <div className="space-y-3">
            <Input
              label="Forward incoming emails to"
              type="email"
              placeholder="you@gmail.com"
              value={forwardEmail}
              onChange={(e) => setForwardEmail(e.target.value)}
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={forwardEnabled}
                onChange={(e) => setForwardEnabled(e.target.checked)}
                disabled={!forwardEmail.trim()}
                className="rounded border-kumo-line"
              />
              <span className="text-sm text-kumo-default">Enable forwarding</span>
            </label>
            {forwardEnabled && forwardEmail && (
              <p className="text-xs text-kumo-subtle">
                Forwarding active → <strong className="text-kumo-default">{forwardEmail}</strong>
              </p>
            )}
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                loading={isSavingForward}
                onClick={handleSaveForwarding}
              >
                Save Forwarding
              </Button>
            </div>
          </div>
        </div>

        {/* Agent System Prompt */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <RobotIcon size={16} weight="duotone" className="text-kumo-subtle" />
              <span className="text-sm font-medium text-kumo-default">AI Agent Prompt</span>
              {isCustomPrompt ? (
                <Badge variant="primary">Custom</Badge>
              ) : (
                <Badge variant="secondary">Default</Badge>
              )}
            </div>
            {isCustomPrompt && (
              <Button
                variant="ghost"
                size="xs"
                icon={<ArrowCounterClockwiseIcon size={14} />}
                onClick={() => setAgentPrompt("")}
              >
                Reset to default
              </Button>
            )}
          </div>
          <p className="text-xs text-kumo-subtle mb-3">
            Customize how the AI agent behaves for this mailbox. Leave empty to use the built-in
            default prompt.
          </p>
          <textarea
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            placeholder={PROMPT_PLACEHOLDER}
            rows={12}
            className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
          />
        </div>

        {/* Save (account + signature + agent prompt) */}
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={isSaving}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/routes/settings.tsx
git commit -m "feat: add avatar, signature, and forwarding sections to settings page"
```

---

## Task 8: Inbound email forwarding in receiveEmail

**Files:**
- Modify: `workers/index.ts`

- [ ] **Step 1: Add forwarding logic after email is stored**

In `workers/index.ts`, find the `receiveEmail` function. After the `await stub.createEmail(...)` call (around line 395) and before the agent trigger, add:

```ts
// Forward if enabled
const mailboxSettingsObj = await env.BUCKET.get(`mailboxes/${mailboxId}.json`);
if (mailboxSettingsObj) {
  const mailboxSettings = (await mailboxSettingsObj.json()) as { forwarding?: { enabled?: boolean; email?: string } };
  if (mailboxSettings?.forwarding?.enabled && mailboxSettings.forwarding.email) {
    ctx.waitUntil(
      sendEmail(env.EMAIL, {
        to: mailboxSettings.forwarding.email,
        from: mailboxId,
        subject: `Fwd: ${parsedEmail.subject || ""}`,
        html: parsedEmail.html || `<pre>${parsedEmail.text || ""}</pre>`,
        text: parsedEmail.text || "",
      }).catch((e: Error) =>
        console.error("Email forwarding failed:", e.message),
      ),
    );
  }
}
```

Note: `sendEmail` is already imported at the top of `workers/index.ts` (it's used for other purposes). Check the import at line 9: `import { sendEmail } from "./email-sender";`.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workers/index.ts
git commit -m "feat: forward inbound emails when mailbox forwarding is enabled"
```

---

## Task 9: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test avatar upload**

1. Open `http://localhost:5173/mailbox/<any-mailboxId>/settings`
2. Click "Upload Avatar" — select a JPEG/PNG file under 2 MB
3. Avatar should appear in the settings page and in the sidebar
4. Click "Remove" — avatar should disappear

- [ ] **Step 3: Test signature**

1. Fill in Name + Title fields in the Signature section
2. Check "Include signature in outgoing emails"
3. Live preview should appear below the fields
4. Save Changes
5. Click Compose — the signature should appear at the bottom of the compose body

- [ ] **Step 4: Test forwarding UI**

1. Enter a forwarding email address
2. Check "Enable forwarding" + Save Forwarding
3. Verify toast appears and status shows "Forwarding active → ..."

- [ ] **Step 5: Deploy**

```bash
CLOUDFLARE_ACCOUNT_ID=8f0203259905d8923687286c84921e6c npm run deploy
```
