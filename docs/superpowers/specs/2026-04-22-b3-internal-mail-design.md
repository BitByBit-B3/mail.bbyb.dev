# B3 Internal Mail — Design Spec

**Date:** 2026-04-22  
**Status:** Approved  
**Base project:** [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox)

---

## Overview

Fork and deploy `cloudflare/agentic-inbox` as **B3 Internal Mail** — a self-hosted email client running entirely on the bitbybit Cloudflare account. The app lives at `mail.bbyb.dev`, handles all `@bbyb.dev` email addresses via a catch-all routing rule, and is gated behind Cloudflare Access with Google SSO restricted to `bitbybit0123@gmail.com`.

---

## Goals

- Fully functional email client (send, receive, threads, attachments, AI agent) at `mail.bbyb.dev`
- Any `@bbyb.dev` address can be created as a mailbox (e.g. `contact@bbyb.dev`, `team@bbyb.dev`)
- Each mailbox is isolated — sending happens from within that mailbox's context
- Single authorized user: `bitbybit0123@gmail.com` via Google OAuth
- Branded as "B3 Internal Mail" throughout the UI

---

## Architecture

Unchanged from upstream. Three-tier:

1. **Frontend** — React 19 + React Router v7 + Tailwind CSS + Zustand
2. **Backend** — Hono on Cloudflare Workers, Durable Objects (per-mailbox SQLite)
3. **AI Layer** — Cloudflare Agents SDK, Workers AI (`@cf/moonshotai/kimi-k2-5`)

Infrastructure:
- **Email inbound** — Cloudflare Email Routing, catch-all `*@bbyb.dev` → Worker
- **Email outbound** — Cloudflare Email Service (`send_email` binding)
- **Attachments** — R2 bucket `b3-mail`
- **Auth** — Cloudflare Access, Google provider, allow policy: `bitbybit0123@gmail.com`

---

## Customizations from Upstream

| Area | Change |
|---|---|
| App name | `Agentic Inbox` → `B3 Internal Mail` |
| Page title / `<title>` tag | Updated to `B3 Internal Mail` |
| Worker name (`wrangler.jsonc`) | `agentic-inbox` → `b3-internal-mail` |
| Domain (`wrangler.jsonc`) | `example.com` → `bbyb.dev` |
| Route | `mail.bbyb.dev/*` |
| R2 bucket name | `agentic-inbox` → `b3-mail` |
| AI model | Unchanged (`@cf/moonshotai/kimi-k2-5`) |
| Mailbox from-selector | Not added — separate mailbox per address (upstream default) |

---

## Configuration

### `wrangler.jsonc` values
```jsonc
{
  "name": "b3-internal-mail",
  "vars": {
    "DOMAINS": "bbyb.dev"
  },
  "routes": [{ "pattern": "mail.bbyb.dev/*", "zone_name": "bbyb.dev" }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "b3-mail" }]
}
```

### Secrets (set via `wrangler secret put` after Access is configured)
- `POLICY_AUD` — Cloudflare Access policy audience tag
- `TEAM_DOMAIN` — `https://<team>.cloudflareaccess.com`

---

## Cloudflare Access Setup (manual, post-deploy)

1. Go to Cloudflare Zero Trust → Settings → Authentication → Add Google as identity provider
2. Create an Access Application:
   - Name: `B3 Internal Mail`
   - Domain: `mail.bbyb.dev`
   - Policy: Allow → Email → `bitbybit0123@gmail.com`
3. Copy the **Audience Tag** → `wrangler secret put POLICY_AUD`
4. Copy the **Team Domain** → `wrangler secret put TEAM_DOMAIN`

---

## Email Routing Setup (manual, post-deploy)

1. In Cloudflare dashboard → `bbyb.dev` → Email → Email Routing
2. Enable Email Routing
3. Add catch-all rule: `*@bbyb.dev` → Send to Worker → `b3-internal-mail`

---

## Email Service (outbound, manual)

1. In Worker settings → Integrations → Email Service
2. Add `send_email` binding with sender domain `bbyb.dev`

---

## Mailbox Usage

After deploy, visit `mail.bbyb.dev` and create the following mailboxes (created via the app UI, no code change needed):

| Address | Purpose |
|---|---|
| `contact@bbyb.dev` | Public-facing contact |
| `team@bbyb.dev` | Internal team |
| `hello@bbyb.dev` | General / welcome |
| `info@bbyb.dev` | General information |
| `support@bbyb.dev` | Support requests |
| `methika.f@bbyb.dev` | Methika's personal mailbox |
| `ranuga.d@bbyb.dev` | Ranuga's personal mailbox |

Each mailbox is independent — inbound routes automatically, outbound sends from that mailbox's address.

---

## What Is NOT Changed

- AI model (Kimi k2.5 — already the best available on Workers AI)
- Feature set (threads, search, attachments, AI agent, MCP endpoint all kept)
- Authorization model (all users passing Access policy can access all mailboxes — by design)
- No "From" address selector in composer — switch mailboxes to send from different addresses

---

## Deployment Approach

Clone → customize locally → deploy via Wrangler CLI.

```bash
# 1. Clone
git clone https://github.com/cloudflare/agentic-inbox .

# 2. Install
npm install

# 3. Create R2 bucket
wrangler r2 bucket create b3-mail

# 4. Deploy
npm run deploy

# 5. Set secrets (after Access is configured)
wrangler secret put POLICY_AUD
wrangler secret put TEAM_DOMAIN
```

---

## Out of Scope

- CI/CD pipeline
- Per-mailbox access control
- Custom AI model swap
- "From" address selector in composer
