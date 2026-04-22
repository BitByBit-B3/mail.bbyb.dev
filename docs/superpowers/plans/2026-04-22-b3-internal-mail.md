# B3 Internal Mail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork `cloudflare/agentic-inbox`, brand it as B3 Internal Mail, configure it for `mail.bbyb.dev` / `@bbyb.dev`, and deploy it to the bitbybit Cloudflare account with Google SSO access control.

**Architecture:** Self-hosted Cloudflare Worker (Hono + React 19 + Durable Objects) cloned from upstream, customized with branding and domain config, then deployed via Wrangler CLI. Cloudflare Access (Google SSO) and Email Routing are configured manually via the Cloudflare dashboard post-deploy.

**Tech Stack:** Cloudflare Workers, Wrangler CLI, React 19, React Router v7, Hono, Durable Objects, R2, Workers AI (`@cf/moonshotai/kimi-k2-5`), Cloudflare Access, Cloudflare Email Routing.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `wrangler.jsonc` | Modify | Worker name, DOMAINS var, R2 bucket, route |
| `app/root.tsx` | Modify | `<title>` tag |
| `app/routes/home.tsx` | Modify | Any "Agentic Inbox" text in empty states |
| Other UI files | Modify (if found) | Any remaining "Agentic Inbox" strings (discovered by grep after clone) |

---

## Task 1: Clone upstream repo into current directory

**Files:**
- Creates: all upstream files in `/Users/ranugadisansa/Programming/Team/B3/mail-client/`

> Note: The `docs/` directory already exists with the spec and plan. The clone uses `--no-checkout` trick to avoid overwriting it.

- [ ] **Step 1: Fetch upstream files without clobbering docs/**

```bash
# We already have git init + docs committed. Pull upstream as a remote.
git remote add upstream https://github.com/cloudflare/agentic-inbox.git
git fetch upstream main
git checkout upstream/main -- app workers shared public wrangler.jsonc package.json package-lock.json react-router.config.ts tsconfig.json tsconfig.cloudflare.json tsconfig.node.json vite.config.ts .dev.vars.example .gitignore
```

- [ ] **Step 2: Verify key files are present**

```bash
ls app/root.tsx app/components/Header.tsx wrangler.jsonc workers/app.ts
```

Expected output: all four paths printed, no "No such file" errors.

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Commit the upstream baseline**

```bash
git add -A
git commit -m "chore: add upstream agentic-inbox baseline"
```

---

## Task 2: Update `wrangler.jsonc` for B3 Internal Mail

**Files:**
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Open `wrangler.jsonc` and apply all config changes**

Replace the entire file content with:

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "b3-internal-mail",
	"compatibility_date": "2025-11-28",
	"main": "./workers/app.ts",
	"observability": {
		"enabled": true
	},
	"compatibility_flags": [
		"nodejs_compat"
	],
	"vars": {
		// Production deploys must also define POLICY_AUD and TEAM_DOMAIN as secrets.
		// TEAM_DOMAIN may be the base Access URL or the full /cdn-cgi/access/certs URL.
		// The worker fails closed outside local development if Access is not configured.
		"DOMAINS": "bbyb.dev",
		"EMAIL_ADDRESSES": []
	},
	"routes": [
		{
			"pattern": "mail.bbyb.dev/*",
			"zone_name": "bbyb.dev"
		}
	],
	"send_email": [
		{
			"name": "EMAIL",
			"remote": true
		}
	],
	"r2_buckets": [
		{
			"binding": "BUCKET",
			"bucket_name": "b3-mail",
			"preview_bucket_name": "b3-mail"
		}
	],
	"ai": {
		"binding": "AI"
	},
	"durable_objects": {
		"bindings": [
			{
				"name": "MAILBOX",
				"class_name": "MailboxDO"
			},
			{
				"name": "EMAIL_AGENT",
				"class_name": "EmailAgent"
			},
			{
				"name": "EMAIL_MCP",
				"class_name": "EmailMCP"
			}
		]
	},
	"migrations": [
		{
			"tag": "v1",
			"new_sqlite_classes": [
				"MailboxDO"
			]
		},
		{
			"tag": "v2",
			"new_sqlite_classes": [
				"EmailAgent"
			]
		},
		{
			"tag": "v3",
			"new_sqlite_classes": [
				"EmailMCP"
			]
		}
	]
}
```

- [ ] **Step 2: Commit**

```bash
git add wrangler.jsonc
git commit -m "chore: configure wrangler for b3-internal-mail on bbyb.dev"
```

---

## Task 3: Apply B3 Internal Mail branding

**Files:**
- Modify: `app/root.tsx`
- Modify: `app/routes/home.tsx` (if it contains "Agentic Inbox")
- Modify: any other files found by grep

- [ ] **Step 1: Find all "Agentic Inbox" occurrences**

```bash
grep -r "Agentic Inbox" --include="*.tsx" --include="*.ts" --include="*.html" -l .
```

Note every file path printed — those all need to be updated.

- [ ] **Step 2: Update `app/root.tsx` title tag**

In `app/root.tsx`, find:
```tsx
<title>Agentic Inbox</title>
```
Replace with:
```tsx
<title>B3 Internal Mail</title>
```

- [ ] **Step 3: Update any remaining "Agentic Inbox" strings**

For each file found in Step 1 (other than `app/root.tsx`):

Open the file and replace every instance of `Agentic Inbox` with `B3 Internal Mail`.

For example, in `app/routes/home.tsx` there is likely empty-state UI text referencing "Agentic Inbox" — change it to `B3 Internal Mail`.

Run after each file to confirm no instances remain:
```bash
grep -r "Agentic Inbox" --include="*.tsx" --include="*.ts" .
```

Expected: no output (zero matches).

- [ ] **Step 4: Commit branding changes**

```bash
git add -A
git commit -m "feat: rebrand to B3 Internal Mail"
```

---

## Task 4: Create R2 bucket and deploy

**Files:**
- No code changes — infra + deploy steps only.

> Prerequisite: You must be logged in to Wrangler with the bitbybit Cloudflare account.
> Run `wrangler whoami` to confirm. If not logged in, run `wrangler login`.

- [ ] **Step 1: Confirm Wrangler is authenticated to the correct account**

```bash
wrangler whoami
```

Expected: shows account name associated with the bitbybit Cloudflare account (domain `bbyb.dev`).

- [ ] **Step 2: Create the R2 bucket**

```bash
wrangler r2 bucket create b3-mail
```

Expected output: `Created bucket 'b3-mail'` (or similar success message).

- [ ] **Step 3: Build and deploy**

```bash
npm run deploy
```

Expected: build succeeds, worker deployed to `b3-internal-mail`, URL shown in output.

> If you see a route conflict error for `mail.bbyb.dev/*`, go to the Cloudflare dashboard → Workers & Pages → your worker → Settings → Domains & Routes and remove any conflicting routes first.

- [ ] **Step 4: Verify the worker is live (without Access configured yet)**

```bash
curl -I https://mail.bbyb.dev/
```

Expected: HTTP 200 or 401/403 (any response means the worker is reachable). If you get a DNS error, check the route was applied in the Cloudflare dashboard under the worker's settings.

---

## Task 5: Configure Cloudflare Access — Google SSO (manual, dashboard)

> These steps are done in the Cloudflare Zero Trust dashboard. No code changes.

- [ ] **Step 1: Add Google as an identity provider**

1. Go to [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com) → your account
2. Navigate to **Settings → Authentication → Login methods**
3. Click **Add new → Google**
4. Follow the OAuth app setup instructions:
   - Create a Google OAuth app at [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   - App name: `B3 Internal Mail`
   - Authorized redirect URI: `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`
   - Copy **Client ID** and **Client Secret** back into the Cloudflare form
5. Save

- [ ] **Step 2: Create the Access Application**

1. In Zero Trust → **Access → Applications → Add an application**
2. Choose **Self-hosted**
3. Fill in:
   - **Name:** `B3 Internal Mail`
   - **Application domain:** `mail.bbyb.dev`
   - **Path:** leave blank (covers all paths)
4. Click **Next**

- [ ] **Step 3: Create the Allow policy**

1. Policy name: `B3 Team`
2. Action: **Allow**
3. Add rule: **Emails → `bitbybit0123@gmail.com`**
4. Click **Next → Add application**

- [ ] **Step 4: Collect the Audience Tag and Team Domain**

After saving the application:
1. Find the application in the list → click it → **Overview tab**
2. Copy the **Application Audience (AUD) tag** — you'll need this in Task 6
3. Your team domain is shown at the top of the Zero Trust dashboard (format: `https://<team>.cloudflareaccess.com`) — copy this too

---

## Task 6: Set Worker secrets

> Uses values collected in Task 5. Run these commands in the terminal.

- [ ] **Step 1: Set POLICY_AUD**

```bash
wrangler secret put POLICY_AUD
```

When prompted, paste the Audience Tag from Task 5 Step 4.

- [ ] **Step 2: Set TEAM_DOMAIN**

```bash
wrangler secret put TEAM_DOMAIN
```

When prompted, paste the full team domain URL (e.g. `https://bitbybit.cloudflareaccess.com`).

- [ ] **Step 3: Verify access is enforced**

Open an incognito browser window and visit `https://mail.bbyb.dev`.

Expected: Cloudflare Access login screen appears asking you to sign in with Google. Sign in with `bitbybit0123@gmail.com` — you should reach the app. Any other Google account should be denied.

---

## Task 7: Configure Email Routing — inbound (manual, dashboard)

> Done in the Cloudflare dashboard for the `bbyb.dev` zone.

- [ ] **Step 1: Enable Email Routing**

1. Go to [https://dash.cloudflare.com](https://dash.cloudflare.com) → select your account → click **bbyb.dev**
2. Left sidebar → **Email → Email Routing**
3. Click **Enable Email Routing** if not already on
4. Follow prompts to add the required MX and SPF DNS records (Cloudflare does this automatically)

- [ ] **Step 2: Add catch-all routing rule**

1. In Email Routing → **Routing rules** tab
2. Scroll to **Catch-all address** → click **Edit**
3. Set action: **Send to Worker**
4. Select worker: `b3-internal-mail`
5. Save

- [ ] **Step 3: Test inbound delivery**

Send a test email to `contact@bbyb.dev` from any external email address.

Expected: The email appears in the `contact@bbyb.dev` mailbox in the app (once that mailbox is created in Task 9). You can also check the Email Routing activity log in the dashboard to confirm the email was received and forwarded.

---

## Task 8: Enable Email Service — outbound (manual, dashboard)

> Done in the Cloudflare Workers dashboard.

- [ ] **Step 1: Add Email Service binding**

1. Go to [https://dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → b3-internal-mail → Settings → Bindings**
2. Click **Add binding → Email Sending (Email Service)**
3. Binding variable name: `EMAIL`
4. Allowed sender addresses: enter `*@bbyb.dev` (or add specific addresses if you prefer)
5. Save

> If the "Email Service" binding option is not available in the UI, it may need to be enabled via Cloudflare's Email Workers beta. Check [https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/) for current instructions.

- [ ] **Step 2: Verify outbound works**

In the app, open any mailbox and compose a test email to an external address. Send it.

Expected: the email arrives at the destination. If it bounces or fails, check the Cloudflare Email Routing logs and confirm the `send_email` binding is configured correctly.

---

## Task 9: Create mailboxes in the app UI (manual)

> Done inside the running app at `https://mail.bbyb.dev`. No code changes.

- [ ] **Step 1: Sign in**

Visit `https://mail.bbyb.dev` and authenticate with `bitbybit0123@gmail.com` via Google.

- [ ] **Step 2: Create each mailbox**

Click **New Mailbox** (or the `+` icon on the home screen) and create one mailbox per address below. Repeat for all 7:

| # | Address | Purpose |
|---|---|---|
| 1 | `contact@bbyb.dev` | Public-facing contact |
| 2 | `team@bbyb.dev` | Internal team |
| 3 | `hello@bbyb.dev` | General / welcome |
| 4 | `info@bbyb.dev` | General information |
| 5 | `support@bbyb.dev` | Support requests |
| 6 | `methika.f@bbyb.dev` | Methika's personal mailbox |
| 7 | `ranuga.d@bbyb.dev` | Ranuga's personal mailbox |

- [ ] **Step 3: Verify each mailbox**

Click into each mailbox and confirm:
- Inbox loads without error
- The correct email address is shown in the sidebar
- You can open the compose window

- [ ] **Step 4: Send a test email between mailboxes**

From `ranuga.d@bbyb.dev`, compose and send a test email to `methika.f@bbyb.dev`.

Expected: email arrives in `methika.f@bbyb.dev`'s inbox. This confirms both inbound routing and outbound sending are working end-to-end.

---

## Task 10: Smoke test the AI agent

> Quick check that Workers AI is operational.

- [ ] **Step 1: Open the Agent panel**

In any mailbox, click the agent/chat icon (right panel on desktop).

- [ ] **Step 2: Send a test prompt**

Type: `What emails do I have in my inbox?`

Expected: The Kimi model responds with a summary of inbox contents (or "no emails" if the inbox is empty). A response of any kind confirms Workers AI is bound correctly.

- [ ] **Step 3: If the agent errors**

Check that Workers AI is enabled for your Cloudflare account:
1. Cloudflare dashboard → **AI → Workers AI**
2. Confirm it shows as enabled / active
3. Redeploy if needed: `npm run deploy`

---

## Deployment Reference

```bash
# One-liner to redeploy after any future code changes
npm run deploy

# Update a secret
wrangler secret put POLICY_AUD
wrangler secret put TEAM_DOMAIN

# View live logs
wrangler tail b3-internal-mail

# Local dev (no Access enforcement)
npm run dev
```

---

## Mailbox Quick Reference

| Address | Purpose |
|---|---|
| `contact@bbyb.dev` | Public-facing contact |
| `team@bbyb.dev` | Internal team |
| `hello@bbyb.dev` | General / welcome |
| `info@bbyb.dev` | General information |
| `support@bbyb.dev` | Support requests |
| `methika.f@bbyb.dev` | Methika |
| `ranuga.d@bbyb.dev` | Ranuga |
