# B3 Internal Mail

**B3** = BitByBit — the internal email client for [BitByBit](https://bbyb.dev), built on Cloudflare infrastructure. Handles all `@bbyb.dev` email addresses with an AI-powered agent, MCP server integration, and a modern React UI.

**Live:** [mail.bbyb.dev](https://mail.bbyb.dev) — Cloudflare Access protected (BitByBit team only)

---

## Features

- **Full email client** — compose, reply, forward, thread view, folders, search
- **AI email agent** — auto-drafts replies, runs email tools, accessible via sidebar chat
- **Write with AI** — ✨ magic wand button generates email drafts via Workers AI (Kimi)
- **MCP server** — Claude Code, Cursor, and other AI tools can connect at `/mcp`
- **Email signature** — structured per-mailbox signature builder with live preview
- **Profile avatar** — upload a photo that shows in the sidebar and signature
- **Email forwarding** — per-mailbox forwarding to any external address
- **Dark mode** — system-level via `color-scheme: dark`
- **Cloudflare Access** — OTP authentication, BitByBit team only

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Frontend | React 19 + React Router v7 |
| API | Hono |
| Email storage | Durable Objects (SQLite) |
| Mailbox config | R2 JSON blobs |
| Attachments / avatars | R2 |
| AI | Workers AI (Kimi k2, Llama) |
| Outbound email | Cloudflare Email Service |
| UI | Cloudflare Kumo design system |
| State | Zustand + TanStack Query |
| Rich text | Tiptap |
| Auth | Cloudflare Access (OTP) |

---

## Development

### Prerequisites

- Node.js 20+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account with Workers, R2, AI, Email Routing, and Access configured

### Setup

```bash
git clone https://github.com/BitByBit-B3/mail.bbyb.dev
cd mail.bbyb.dev
npm install
```

### Local dev

```bash
npm run dev
```

Opens at `http://localhost:5173`. Auth is skipped in dev mode.

### Type checking

```bash
npm run typecheck
```

This runs `wrangler types` (regenerates `worker-configuration.d.ts`), `react-router typegen`, and `tsc`.

> **Note:** `worker-configuration.d.ts` is gitignored — it's auto-generated from `wrangler.jsonc`. Run `npm run cf-typegen` if bindings change.

### Deploy

```bash
CLOUDFLARE_ACCOUNT_ID=<your-account-id> npm run deploy
```

---

## Project Structure

```
├── app/                    # React frontend
│   ├── components/         # UI components (Compose, Sidebar, RichTextEditor, …)
│   ├── hooks/              # useComposeForm, useUIStore (Zustand)
│   ├── queries/            # TanStack Query hooks
│   ├── routes/             # React Router v7 routes
│   ├── lib/utils.ts        # Frontend utilities
│   └── types/index.ts      # Shared TypeScript types
├── workers/                # Cloudflare Worker backend
│   ├── app.ts              # Main fetch handler + auth middleware
│   ├── index.ts            # All REST routes + inbound email handler
│   ├── agent/              # EmailAgent Durable Object (AI)
│   ├── durableObject/      # MailboxDO (SQLite email store)
│   ├── email-sender.ts     # Outbound email via Email Service binding
│   ├── lib/ai.ts           # Workers AI helpers
│   ├── lib/schemas.ts      # Zod schemas
│   └── mcp/                # MCP server (EmailMCP)
├── shared/                 # Code shared between frontend and workers
│   ├── dates.ts
│   ├── folders.ts
│   └── signature.ts        # Email signature builder
├── docs/superpowers/       # Design specs and implementation plans
├── CLAUDE.md               # Claude Code project instructions
├── AGENTS.md               # Instructions for other AI coding agents
└── wrangler.jsonc          # Cloudflare Workers configuration
```

---

## Mailboxes

| Address | Purpose |
|---|---|
| `contact@bbyb.dev` | General contact |
| `team@bbyb.dev` | Internal team |
| `hello@bbyb.dev` | Welcome / onboarding |
| `info@bbyb.dev` | Information requests |
| `support@bbyb.dev` | Support |
| `methika.f@bbyb.dev` | Methika Fonseka |
| `ranuga.d@bbyb.dev` | Ranuga Disansa |

All `@bbyb.dev` addresses are caught by a wildcard Email Routing rule → this Worker.

---

## MCP Integration

Connect AI tools to the B3 mail MCP server:

**Claude Code:**
```bash
claude mcp add --transport http b3-mail https://mail.bbyb.dev/mcp
```

**Cursor / other tools:**
```json
{
  "mcpServers": {
    "b3-mail": {
      "url": "https://mail.bbyb.dev/mcp"
    }
  }
}
```

---

## Cloudflare Configuration

- **Worker name:** `b3-internal-mail`
- **Route:** `mail.bbyb.dev/*`
- **R2 bucket:** `b3-mail`
- **Access policy:** OTP, restricted to your team

---

## AI Agent

Each mailbox has a dedicated `EmailAgent` Durable Object. On new email, it:

1. Scans for prompt injection (Llama 3.1 8B)
2. If safe, auto-drafts a reply (Kimi k2 via agents SDK)
3. Verifies the draft (Llama 4 Scout) to remove any agent artifacts
4. Saves the draft for review in the Drafts folder

The agent is also accessible via the sidebar chat panel for manual instructions.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
