# B3 Internal Mail — Agent Instructions

This file provides context for AI coding agents (Codex, GPT-4, Gemini, etc.) working in this repository. See `CLAUDE.md` for the full project reference — this file highlights the most critical facts to avoid common mistakes.

---

## What This Is

A full-stack email client for the BitByBit team, deployed at `mail.bbyb.dev`. Built on Cloudflare Workers + React + Hono. Handles all `@bbyb.dev` email.

---

## Critical Facts

### Project structure
- `workers/` — Cloudflare Worker backend (TypeScript)
- `app/` — React 19 frontend (React Router v7)
- `shared/` — code shared between workers and frontend
- `docs/superpowers/` — design specs and implementation plans

### Backend API
- All routes live in `workers/index.ts`
- API prefix: `/api/v1/`
- Routes under `/api/v1/mailboxes/:mailboxId/*` get `requireMailbox` middleware automatically
- Mailbox settings stored in R2 at `mailboxes/<mailboxId>.json` — no SQL migrations needed for settings changes

### Frontend patterns
- UI components use the **Kumo** design system (`@cloudflare/kumo`)
- Use `kumo-*` color tokens: `text-kumo-default`, `bg-kumo-base`, `border-kumo-line`, etc.
- **Dark mode**: `color-scheme: dark` in CSS. Do NOT use Tailwind `dark:` classes.
- State: Zustand (`useUIStore`) + TanStack Query (`useQuery`/`useMutation`)
- Compose state: `app/hooks/useComposeForm.ts`

### Data types
- `MailboxSettings` — `app/types/index.ts` — JSON blob in R2, add fields freely
- `Email`, `Attachment`, `Folder` — also in `app/types/index.ts`

### Bindings (env)
```
env.BUCKET    — R2 (mailbox configs, attachments, avatars)
env.AI        — Workers AI
env.EMAIL     — SendEmail binding (outbound)
env.MAILBOX   — MailboxDO (Durable Object, per-mailbox SQLite)
env.EMAIL_AGENT — EmailAgent (Durable Object, AI agent)
```

### Generated files
- `worker-configuration.d.ts` is **gitignored** and auto-generated via `npm run cf-typegen`. Never commit it.

---

## Dev Commands

```bash
npm run dev          # local dev (auth skipped)
npm run typecheck    # type-check everything
npm run build        # production build
CLOUDFLARE_ACCOUNT_ID=8f0203259905d8923687286c84921e6c npm run deploy
```

---

## Common Mistakes to Avoid

| Mistake | Correct approach |
|---|---|
| `class="dark"` on `<html>` | Use `:root { color-scheme: dark; }` in CSS |
| Hardcoded `color: white` | Use `text-kumo-default` / Kumo tokens |
| SQL migration for new setting | Just add field to `MailboxSettings` type and R2 JSON |
| Mutating settings object in-place | Always spread: `{ ...settings, newField: value }` |
| Committing `worker-configuration.d.ts` | It's gitignored — run `npm run cf-typegen` locally |
| Adding `console.log` | Use `console.error` for errors only |

---

## Key Files Quick Reference

| File | Purpose |
|---|---|
| `workers/app.ts` | Main Worker fetch handler + auth middleware |
| `workers/index.ts` | All REST API routes + inbound email handler |
| `workers/lib/ai.ts` | Workers AI helpers (prompt injection, draft verification) |
| `workers/email-sender.ts` | Outbound email via `env.EMAIL.send()` |
| `app/hooks/useComposeForm.ts` | All compose state (to, subject, body, send, draft) |
| `app/components/ComposePanel.tsx` | Compose UI |
| `app/components/RichTextEditor.tsx` | Tiptap editor with toolbar |
| `app/queries/mailboxes.ts` | Mailbox CRUD React Query hooks |
| `app/lib/utils.ts` | Frontend utilities (HTML, signature, formatting) |
| `app/types/index.ts` | Shared TypeScript interfaces |
| `shared/signature.ts` | Email signature builder (shared frontend + backend) |
