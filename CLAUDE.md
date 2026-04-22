# B3 Internal Mail — Claude Code Instructions

## Project Overview

B3 Internal Mail is a full-stack email client built on Cloudflare infrastructure. It is deployed at `mail.bbyb.dev` for the BitByBit team and handles all `@bbyb.dev` email addresses via Cloudflare Email Routing.

**Cloudflare Account:** BitByBit (`8f0203259905d8923687286c84921e6c`)  
**Zone:** `bbyb.dev` (Zone ID: `edbc6334a5f99b90be9a2f1c65876826`)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Frontend | React 19 + React Router v7 |
| API | Hono (mounted at `/api/v1/`) |
| Email storage | Durable Objects (SQLite) |
| Mailbox config | R2 JSON blobs (`mailboxes/<id>.json`) |
| File storage | R2 (`b3-mail` bucket) |
| AI | Workers AI (`env.AI` binding) |
| Outbound email | Cloudflare Email Service (`env.EMAIL` binding) |
| UI components | Cloudflare Kumo design system |
| State | Zustand (`useUIStore`) + TanStack Query |
| Rich text editor | Tiptap |
| Auth | Cloudflare Access (OTP, restricted to BitByBit team) |

---

## Development Commands

```bash
npm run dev          # Start local dev server (no auth check in DEV)
npm run build        # Build for production
npm run typecheck    # Type-check (runs cf-typegen + react-router typegen + tsc)
npm run cf-typegen   # Regenerate worker-configuration.d.ts (gitignored, auto-generated)

# Deploy
CLOUDFLARE_ACCOUNT_ID=8f0203259905d8923687286c84921e6c npm run deploy
```

---

## Architecture

### Workers entry points

- **`workers/app.ts`** — main fetch handler; chains Access JWT middleware → MCP → API routes → agent WebSocket routing → React Router SPA fallback
- **`workers/index.ts`** — all REST API routes (`/api/v1/...`) + inbound email handler (`receiveEmail`)
- **`workers/durableObject/index.ts`** — `MailboxDO`: SQLite-backed email store (emails, folders, attachments)
- **`workers/agent/index.ts`** — `EmailAgent`: AI agent that auto-drafts replies and runs tools
- **`workers/mcp/index.ts`** — MCP server for Claude Code / Cursor integration

### Frontend structure

- **`app/routes/`** — React Router v7 file-based routes (`home.tsx`, `mailbox.tsx`, `settings.tsx`, etc.)
- **`app/components/`** — UI components (ComposePanel, RichTextEditor, Sidebar, AgentSidebar, etc.)
- **`app/hooks/`** — `useComposeForm.ts` (compose state), `useUIStore.ts` (Zustand panel state)
- **`app/queries/`** — TanStack Query hooks wrapping the API
- **`app/lib/utils.ts`** — shared frontend utilities (HTML, email formatting, signature building)
- **`app/types/index.ts`** — TypeScript interfaces (Mailbox, Email, MailboxSettings, etc.)
- **`shared/`** — code shared between workers and frontend (dates, folders, signature)

### Data layer

Mailbox settings are stored as a JSON blob in R2 at `mailboxes/<mailboxId>.json`. There is no SQL migration needed for new settings fields — the blob accepts any keys.

The `MailboxSettings` type in `app/types/index.ts` defines the shape. Adding a new setting means:
1. Add the field to `MailboxSettings` in `app/types/index.ts`
2. Read/write via the existing `PUT /api/v1/mailboxes/:mailboxId` endpoint

Email content is stored in Durable Object SQLite (`MailboxDO`). Schema is in `workers/db/schema.ts`.

---

## Key Patterns

### Adding a new API route

Routes go in `workers/index.ts`. The pattern:

```ts
app.post("/api/v1/mailboxes/:mailboxId/my-feature", async (c: AppContext) => {
  const mailboxId = c.req.param("mailboxId")!;
  const body = MySchema.parse(await c.req.json());
  // ... do work ...
  return c.json({ result });
});
```

Routes under `/api/v1/mailboxes/:mailboxId/*` automatically go through `requireMailbox` middleware (checks R2 + instantiates DO stub at `c.var.mailboxStub`).

### Adding a new settings field

1. Add to `MailboxSettings` in `app/types/index.ts`
2. Add Zod validation in `workers/lib/schemas.ts` if needed
3. Read via `GET /api/v1/mailboxes/:mailboxId` → `mailbox.settings?.myField`
4. Write via `useUpdateMailbox()` mutation → `PUT /api/v1/mailboxes/:mailboxId`

### Workers AI usage

```ts
// Non-streaming
const response = await env.AI.run("@cf/model-name", { messages, max_tokens }) as { response?: string };

// Streaming (returns SSE ReadableStream)
const stream = await env.AI.run("@cf/model-name", { messages, stream: true }) as ReadableStream;
```

Use `// @ts-expect-error` when the model string isn't in the generated type union.

### Dark mode

The app uses `color-scheme: dark` (set in `app/index.css`) which activates Kumo's `light-dark()` CSS tokens. **Do not use Tailwind `dark:` classes** — they don't work here. Use `kumo-*` color tokens (e.g. `text-kumo-default`, `bg-kumo-base`, `border-kumo-line`).

### Frontend streaming

When consuming a streaming API response in a React component, update Tiptap editor content directly via a ref rather than calling `setBody()` on every chunk (which triggers re-renders and cursor resets):

```ts
const editorRef = useRef<Editor | null>(null);
// During streaming:
editorRef.current?.commands.setContent(accumulated);
// After stream ends, sync React state once:
setBody(accumulated);
```

---

## Cloudflare Bindings

| Binding | Type | Purpose |
|---|---|---|
| `env.BUCKET` | R2 | Mailbox configs, email attachments, avatars |
| `env.AI` | Workers AI | Email drafting, security scanning |
| `env.EMAIL` | SendEmail | Outbound email via Email Service |
| `env.MAILBOX` | Durable Object | Per-mailbox SQLite email store |
| `env.EMAIL_AGENT` | Durable Object | AI agent per mailbox |
| `env.EMAIL_MCP` | Durable Object | MCP server |

`worker-configuration.d.ts` is **gitignored** and auto-generated by `npm run cf-typegen`. Run this whenever bindings change in `wrangler.jsonc`.

---

## Auth

In production, every request is protected by Cloudflare Access JWT middleware in `workers/app.ts`. The JWT is verified against `POLICY_AUD` and `TEAM_DOMAIN` (`bitbybit-b3.cloudflareaccess.com`). In `DEV` mode (`import.meta.env.DEV === true`), auth is skipped entirely.

Access is restricted to `bitbybit0123@gmail.com` via OTP on the Cloudflare Access policy.

---

## Mailboxes

Active mailboxes at `@bbyb.dev`:
- `contact`, `team`, `hello`, `info`, `support`
- `methika.f`, `ranuga.d`

Inbound catch-all `*@bbyb.dev` routes via Cloudflare Email Routing to this Worker.

---

## What NOT To Do

- Do not add `class="dark"` to `<html>` — Kumo uses `color-scheme`, not Tailwind dark mode.
- Do not use `color: black` or `background: white` hardcoded — use Kumo tokens.
- Do not write SQL migrations for new mailbox settings — the R2 JSON blob is schemaless.
- Do not commit `worker-configuration.d.ts` — it is gitignored and environment-specific.
- Do not add `console.log` in production paths — use `console.error` for actual errors only.
- Do not push to `main` without deploying and smoke-testing first.
