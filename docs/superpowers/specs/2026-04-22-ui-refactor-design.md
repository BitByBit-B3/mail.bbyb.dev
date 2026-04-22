# B3 Mail — Notion Mail–Style UI Refactor Design Spec

## Goal

Refactor the B3 Internal Mail UI to match the visual layout and interaction style of Notion Mail: a compact 3-pane desktop layout, a sidebar-embedded identity header (no separate top bar), single-line 3-column email rows, and a floating compose popover — while keeping all existing data, routing, and business logic completely intact.

## Reference

Screenshots: Notion Mail inbox (3-pane reading, compose overlay, email list).

---

## What Changes vs What Stays

### Changes
- Layout root: remove top `Header` bar; sidebar owns identity + navigation
- Sidebar: full visual rewrite with `VIEWS` / `MAIL` sections, pencil compose icon
- Email list rows: 2-line card → single-line 3-column compact row
- Compose: right-pane takeover → fixed floating popover (portal at root)
- `MailboxSplitView`: 3-pane always-visible on desktop

### Stays the same
- All API calls, React Query hooks, routing
- Folder navigation logic (existing system folders + custom folders)
- `useUIStore` compose state (`startCompose`, `closeCompose`, etc.)
- `ComposePanel` internal form logic, AI compose, draft saving
- `EmailPanel`, `ThreadMessage`, `SingleMessageView` reading pane
- `AgentPanel` / MCP panel
- Kumo design tokens throughout (`kumo-*` color classes)
- Dark mode via `color-scheme: dark`

---

## Layout Architecture

### Breakpoints

| Breakpoint | Sidebar | Email List | Reading Pane |
|---|---|---|---|
| Desktop ≥1024px (`lg`) | Fixed 240px | Fixed 380px | `flex-1` |
| Tablet 768–1024px (`md`) | Overlay (slide-in) | `w-[320px]` | `flex-1` |
| Mobile <768px (`sm`) | Overlay (slide-in) | Full-screen | Full-screen (replaces list) |

### Desktop 3-pane

All three columns are always mounted. Reading pane shows an empty-state placeholder when no email is selected. The left border of the list pane and left border of the reading pane serve as dividers.

```
┌─────────────┬──────────────────────┬────────────────────────────┐
│  Sidebar    │    Email List        │    Reading Pane            │
│  240px      │    380px             │    flex-1                  │
│             │                      │                            │
│  Identity   │  [header: Inbox]     │  (empty state or email)    │
│  Search     │  ──────────────────  │                            │
│  VIEWS      │  email rows...       │                            │
│  MAIL       │  date groups...      │                            │
│             │                      │                            │
│  Settings   │                      │                            │
└─────────────┴──────────────────────┴────────────────────────────┘
                                                    [Compose popover ↗]
```

### Mobile / Tablet

Sidebar is a fixed overlay triggered by a hamburger icon (visible on mobile only). On mobile, navigating to an email pushes the reading pane to full-screen; the back arrow returns to the list. On tablet, list + reading pane are side-by-side; sidebar overlays both.

---

## Component Changes

### 1. Root Layout (`app/routes/mailbox.tsx`)

- **Remove** `<Header />` component entirely from the layout.
- **Remove** the `<AgentPanel />` from the root (stays mounted in reading pane area as a togglable right-side panel — existing behaviour for `lg` screens).
- Layout becomes: `<Sidebar /> | <MailboxSplitView />` with no top bar.
- `<ComposePortal />` — new component — rendered at this level, fixed-positioned.

```tsx
// Simplified new root structure
<div className="flex h-screen overflow-hidden bg-kumo-base">
  <Sidebar />
  <div className="flex flex-1 min-w-0">
    <MailboxSplitView />
  </div>
  <ComposePortal />  {/* floating compose window */}
</div>
```

### 2. Sidebar (`app/components/Sidebar.tsx`)

Full rewrite. Sections top to bottom:

**Identity block (top):**
```
[Avatar 32px]  Display Name          [<<]  [✏]
               email@bbyb.dev
```
- Avatar: existing `settings.avatarUrl` or initials circle (reuse current logic)
- Display name: `settings.fromName ?? mailboxId`
- `<<` toggle: hides the sidebar on desktop (simple `isSidebarCollapsed` boolean in `useUIStore`; sidebar re-opens via a `>>` button that appears at the top-left of the email list). No icon-only rail — just show/hide.
- `✏` pencil icon: calls `startCompose()` from `useUIStore`

**Search bar:**
- Full-width input, same as current

**VIEWS section:**
- Label: `VIEWS` in `text-[10px] font-semibold text-kumo-subtle uppercase tracking-wider`
- Items: Inbox (red inbox icon) + each custom folder (folder icon)
- Each item: `[icon] Label [badge]` — badge is unread count pill, hidden if 0
- Active item: `bg-kumo-fill rounded-md`

**MAIL section:**
- Label: `MAIL` same styling as VIEWS
- Items: All Mail, Sent, Drafts, Spam, Trash — fixed list using existing `SYSTEM_FOLDER_LINKS`
- Same row styling as VIEWS

**Bottom:**
- `Settings` link (gear icon) — routes to `/mailboxes/:id/settings`
- No "Get macOS app", "Support & feedback" (those are Notion-specific)

**Mobile behaviour:** clicking any nav item closes the sidebar overlay (existing `handleNavClick` logic).

### 3. Email List Rows (`app/routes/email-list.tsx`)

Replace the 2-line card row with a single-line 3-column row.

**Row structure:**
```
[•] [Sender name + count]    [Subject bold  preview muted…]    [time/date]
```

Column widths:
- **Left** (`w-44 shrink-0`): unread dot (6px colored circle, hidden if read) + sender name (bold if unread, truncated). Thread participant count inline if > 1 (e.g. `me .. Rukshan 37`).
- **Middle** (`flex-1 min-w-0`): Subject (`font-medium` if unread, `font-normal` if read) + `" "` + preview snippet (`text-kumo-subtle`, same truncated line). Single `truncate` on the whole middle column.
- **Right** (`w-24 shrink-0 text-right`): time (today → `9:01 AM`, older → `Apr 21`). Labels/tag pills stacked above time if present.

**Row styling:**
- Height: `h-9` (36px) — compact single line
- Padding: `px-4`
- Selected: `bg-kumo-tint`
- Hover: `bg-kumo-fill/40` + checkbox appears on far left (replaces unread dot on hover)
- Unread dot: `w-1.5 h-1.5 rounded-full bg-kumo-brand shrink-0`

**Date group headers:**
- `Yesterday`, `Last week`, etc. — `text-[11px] font-semibold text-kumo-subtle uppercase px-4 py-1 bg-kumo-recessed`

**List header (above rows):**
- Mobile only: hamburger icon (left) to open sidebar overlay
- `📥 Inbox` title (or current folder name) — `text-base font-semibold text-kumo-default px-4 py-3`
- No filter chips — existing folder navigation logic unchanged

### 4. `MailboxSplitView.tsx`

Rearchitected for always-visible 3-pane on desktop:

```tsx
<div className="flex h-full">
  {/* Email list — always visible on md+, full-screen on mobile when no email */}
  <div className={`flex flex-col border-r border-kumo-line shrink-0
    ${isPanelOpen ? "hidden md:flex md:w-[380px]" : "flex w-full md:w-[380px]"}`}>
    <Outlet />  {/* email list route */}
  </div>

  {/* Reading pane — flex-1, shows email or empty state */}
  <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
    {selectedEmailId ? <EmailPanel /> : <EmptyReadingPane />}
    {/* Note: compose is no longer rendered here — it's a portal */}
  </div>
</div>
```

`EmptyReadingPane`: centered placeholder — inbox icon + "Select an email to read" in `text-kumo-subtle`. Simple, no interactivity.

### 5. Floating Compose Popover (`app/components/ComposePopover.tsx`)

New component. Rendered via a React portal at the root, fixed bottom-right.

**Positioning:**
```css
position: fixed;
bottom: 24px;
right: 24px;
width: 520px;
height: 420px;
z-index: 50;
```

**States:**
- `open` — full size, all fields visible
- `minimized` — title bar only (~40px tall), click to restore
- `hidden` — not mounted (when `isComposing === false`)

**Header bar:**
```
[Display Name  email@bbyb.dev]          [—]  [×]
```
- `—` minimizes, `×` calls `closeCompose()`
- Dragging: not implemented (YAGNI)

**Body:** Reuses `ComposePanel` internals directly — same To/CC/BCC/Subject/RichTextEditor/AI button. `ComposePanel.tsx` is refactored to be layout-agnostic (no position or size assumptions).

**Mobile:** When screen width < 768px, the popover renders as `position: fixed; inset: 0` — full-screen, same as current mobile compose behaviour.

**Shadow:** `shadow-2xl rounded-xl border border-kumo-line` — elevated floating card.

### 6. `Header.tsx`

Deleted. All its functionality (hamburger for mobile sidebar, mailbox title, agent panel toggle) moves:
- Hamburger → sidebar itself handles mobile overlay
- Agent panel toggle → button inside reading pane header (`EmailPanelHeader.tsx`)
- Mailbox title → email list header (folder name)

### 7. `ComposeEmail.tsx` (modal compose)

Removed — the floating popover replaces both the right-pane compose and the modal compose. `useUIStore` keeps `startCompose()` / `closeCompose()` unchanged. `openComposeModal` / `isComposeModalOpen` can be deleted from the store.

---

## File Map

| File | Action |
|---|---|
| `app/routes/mailbox.tsx` | Rewrite root layout, remove Header, add ComposePortal |
| `app/components/Sidebar.tsx` | Full rewrite — identity + VIEWS/MAIL sections |
| `app/components/Header.tsx` | Delete |
| `app/components/MailboxSplitView.tsx` | Rearchitect for always-visible 3-pane |
| `app/routes/email-list.tsx` | Rewrite email row to 3-column compact |
| `app/components/ComposePanel.tsx` | Refactor to layout-agnostic (remove position assumptions) |
| `app/components/ComposePopover.tsx` | New — fixed floating compose window |
| `app/components/ComposeEmail.tsx` | Delete |
| `app/components/EmailPanelHeader.tsx` | Add agent panel toggle button |
| `app/hooks/useUIStore.ts` | Remove `isComposeModalOpen`, add `isComposeMinimized` |
| `app/components/EmptyReadingPane.tsx` | New — placeholder for unselected reading pane |

---

## Responsive Behaviour Summary

| Feature | Mobile | Tablet | Desktop |
|---|---|---|---|
| Sidebar | Fixed overlay, hamburger trigger | Fixed overlay | Fixed 240px column |
| Email list | Full screen (when no email selected) | ~320px fixed | 380px fixed |
| Reading pane | Full screen (replaces list) | flex-1 | flex-1 |
| Compose | Full-screen fixed | Floating popover | Floating popover |
| Empty reading pane | Hidden | Visible | Visible |

---

## Non-Goals

- Filter chips / smart categories (kept for future)
- Drag-to-reorder compose popover
- Multi-compose windows
- Any changes to email fetching, threading, or backend
