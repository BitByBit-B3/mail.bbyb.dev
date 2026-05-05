# B3 Internal Mail — Remaining TODOs

Code is deployed to `mail.bbyb.dev`. The steps below are manual dashboard tasks to complete setup.

---

## 1. Cloudflare Access — OTP Login

Protects `mail.bbyb.dev` so only authorized team members can log in via one-time PIN (no OAuth app needed).

**Steps (Zero Trust dashboard):**
1. Go to https://one.dash.cloudflare.com → your BitByBit account
2. **Access → Applications → Add an application → Self-hosted**
3. Fill in:
   - Name: `B3 Internal Mail`
   - Application domain: `mail.bbyb.dev`
   - Path: _(leave blank)_
4. Under **Identity providers** — uncheck everything except **One-time PIN**
5. Click **Next**
6. Policy name: `B3 Team`, Action: **Allow**
7. Add rule: **Emails → `<your-email@domain.com>`**
8. Click **Next → Save**
9. Open the saved application → **Overview tab**
10. Copy the **Application Audience (AUD) tag**
11. Copy your **Team Domain** (top of Zero Trust dashboard, format: `https://xxx.cloudflareaccess.com`)

**Then set the secrets (run in terminal):**
```bash
! CLOUDFLARE_ACCOUNT_ID=<your-account-id> npx wrangler secret put POLICY_AUD
! CLOUDFLARE_ACCOUNT_ID=<your-account-id> npx wrangler secret put TEAM_DOMAIN
```

---

## 2. Email Routing — Inbound

Routes all `*@bbyb.dev` emails to the worker.

**Steps:**
1. https://dash.cloudflare.com → **bbyb.dev** → **Email → Email Routing**
2. Click **Enable Email Routing** (follow prompts to add DNS records — Cloudflare does it automatically)
3. Go to **Routing rules** tab → **Catch-all address → Edit**
4. Action: **Send to Worker** → select `b3-internal-mail`
5. Save

---

## 3. Email Service — Outbound

Allows the worker to send emails from `@bbyb.dev` addresses.

**Steps:**
1. https://dash.cloudflare.com → **Workers & Pages → b3-internal-mail → Settings → Bindings**
2. **Add binding → Email Sending**
3. Binding variable name: `EMAIL`
4. Allowed sender: `*@bbyb.dev`
5. Save

> Note: If "Email Sending" isn't available yet, check https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/

---

## 4. Create Mailboxes (in the app)

Visit `https://mail.bbyb.dev` after Access is set up, sign in with your authorized email, and create these mailboxes:

| # | Address | Purpose |
|---|---|---|
| 1 | `contact@bbyb.dev` | Public-facing contact |
| 2 | `team@bbyb.dev` | Internal team |
| 3 | `hello@bbyb.dev` | General / welcome |
| 4 | `info@bbyb.dev` | General information |
| 5 | `support@bbyb.dev` | Support requests |
| 6 | `methika.f@bbyb.dev` | Methika |
| 7 | `ranuga.d@bbyb.dev` | Ranuga |

---

## 5. Smoke Test

- [ ] Open `mail.bbyb.dev` in incognito → OTP login screen appears
- [ ] Enter your authorized email → receive PIN → access granted
- [ ] Create a mailbox and send a test email to an external address
- [ ] Send a test email to `contact@bbyb.dev` from outside → confirm it lands in the mailbox
- [ ] Open the AI agent panel → ask "What emails do I have?" → Kimi responds

---

---

## Future Features

- **Reply to original sender from a forwarded email** — when opening a forwarded email (Fwd: prefix), offer a "Reply to Original" button that parses the forwarded-message block, extracts the original From/Subject, and pre-fills compose with the original sender as To and strips the forwarded body wrapper. Relevant code: `workers/routes/reply-forward.ts → handleForwardEmail`.

---

## Quick Reference

```bash
# Redeploy after any code changes
CLOUDFLARE_ACCOUNT_ID=<your-account-id> npm run deploy

# Update a secret
CLOUDFLARE_ACCOUNT_ID=<your-account-id> npx wrangler secret put POLICY_AUD
CLOUDFLARE_ACCOUNT_ID=<your-account-id> npx wrangler secret put TEAM_DOMAIN

# Live logs
CLOUDFLARE_ACCOUNT_ID=<your-account-id> npx wrangler tail b3-internal-mail

# Local dev
npm run dev
```
