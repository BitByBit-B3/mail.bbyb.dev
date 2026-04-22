# Notion Mail–Style UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor B3 Mail's visual layout to match Notion Mail: 3-pane desktop, compact single-line email rows, no top header bar, and a floating compose popover — keeping all existing data and business logic intact.

**Architecture:** The root layout (`mailbox.tsx`) loses its `<Header />` and gains a `<ComposePopover />` portal. `MailboxSplitView` becomes a true 3-pane layout (list always-visible on desktop, reading pane always mounted). `Sidebar` gains embedded identity, search, VIEWS/MAIL grouping, and a pencil compose icon. Compose becomes a fixed bottom-right floating window via `createPortal`.

**Tech Stack:** React 19, React Router v7, Zustand, Cloudflare Kumo (`@cloudflare/kumo`), Phosphor Icons (`@phosphor-icons/react`), Tailwind CSS, TypeScript.

---

## File Map

| File | Action |
|---|---|
| `app/hooks/useUIStore.ts` | Add `isComposeMinimized`, `toggleComposeMinimize`, `isSidebarCollapsed`, `toggleSidebarCollapsed` |
| `app/components/EmptyReadingPane.tsx` | **Create** — placeholder for unselected reading pane |
| `app/components/ComposePanel.tsx` | Add `hideHeader?: boolean` prop |
| `app/components/ComposePopover.tsx` | **Create** — fixed bottom-right floating compose (portal) |
| `app/components/MailboxSplitView.tsx` | Rewrite — 3-pane, no compose in right pane, reads store directly |
| `app/routes/email-list.tsx` | Update MailboxSplitView call site (remove old props); rewrite rows to 3-col compact + date groups; update list header |
| `app/components/Sidebar.tsx` | Full rewrite — identity block, search, VIEWS/MAIL sections, Settings bottom |
| `app/routes/mailbox.tsx` | Rewrite — remove Header + ComposeEmail, add ComposePopover, restructure |
| `app/components/email-panel/EmailPanelHeader.tsx` | Add back button (mobile) + agent panel toggle |
| `app/components/Header.tsx` | **Delete** |
| `app/components/ComposeEmail.tsx` | **Delete** |

---

## Task 1: Extend useUIStore with compose-minimize and sidebar-collapse state

**Files:**
- Modify: `app/hooks/useUIStore.ts`

- [ ] **Step 1: Add new state fields and actions to UIState interface**

Open `app/hooks/useUIStore.ts`. Add these fields to the `UIState` interface (after the existing `isAgentPanelOpen` line):

```typescript
// Compose minimize (for floating popover)
isComposeMinimized: boolean;
toggleComposeMinimize: () => void;

// Desktop sidebar collapse
isSidebarCollapsed: boolean;
toggleSidebarCollapsed: () => void;
```

- [ ] **Step 2: Add initial values and implementations to the store**

In the `create<UIState>((set, get) => ({` block, add after `isAgentPanelOpen: true,`:

```typescript
isComposeMinimized: false,
isSidebarCollapsed: false,
```

After `toggleAgentPanel: () => set({ isAgentPanelOpen: !get().isAgentPanelOpen }),` add:

```typescript
toggleComposeMinimize: () => set({ isComposeMinimized: !get().isComposeMinimized }),
toggleSidebarCollapsed: () => set({ isSidebarCollapsed: !get().isSidebarCollapsed }),
```

Also update `startCompose` to reset minimize state when opening compose. Change the `startCompose` implementation to add `isComposeMinimized: false` inside the `set()` call:

```typescript
startCompose: (options) =>
    set((state) => {
        const mode = options?.mode || "new";
        const isReplyOrForward = mode === "reply" || mode === "reply-all" || mode === "forward";
        return {
            isComposing: true,
            isComposeMinimized: false,
            _previousEmailId: state.selectedEmailId,
            selectedEmailId: isReplyOrForward ? state.selectedEmailId : null,
            composeOptions: options || { mode: "new", originalEmail: null },
            isSidebarOpen: false,
        };
    }),
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd /Users/ranugadisansa/Programming/Team/B3/mail-client && npm run typecheck 2>&1 | grep -E "error TS|✨"
```

Expected: `✨ Types written to worker-configuration.d.ts` with no `error TS` lines.

- [ ] **Step 4: Commit**

```bash
git add app/hooks/useUIStore.ts
git commit -m "feat: add compose minimize and sidebar collapse state to UIStore"
```

---

## Task 2: Create EmptyReadingPane component

**Files:**
- Create: `app/components/EmptyReadingPane.tsx`

- [ ] **Step 1: Create the file**

```tsx
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { EnvelopeSimpleIcon } from "@phosphor-icons/react";

export default function EmptyReadingPane() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3 text-kumo-subtle select-none">
			<EnvelopeSimpleIcon size={40} weight="thin" />
			<p className="text-sm">Select an email to read</p>
		</div>
	);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit**

```bash
git add app/components/EmptyReadingPane.tsx
git commit -m "feat: add EmptyReadingPane placeholder component"
```

---

## Task 3: Add hideHeader prop to ComposePanel

**Files:**
- Modify: `app/components/ComposePanel.tsx`

- [ ] **Step 1: Add hideHeader to the props interface**

In `app/components/ComposePanel.tsx`, the component is exported as `export default function ComposePanel()` with no props. Change it to accept an optional prop:

Replace the function signature:
```tsx
export default function ComposePanel() {
```

With:
```tsx
export default function ComposePanel({ hideHeader = false }: { hideHeader?: boolean }) {
```

- [ ] **Step 2: Wrap the header div conditionally**

The header block in ComposePanel is the first child inside the outer `<div className="flex flex-col h-full bg-kumo-base">`. It looks like:

```tsx
<div className="flex items-center justify-between px-4 py-3 border-b border-kumo-line shrink-0 md:px-6">
    <h2 className="text-base font-semibold text-kumo-default">
        {formTitle}
    </h2>
    <div className="flex items-center gap-1">
        <Button ... XIcon ... closeCompose ... />
    </div>
</div>
```

Wrap it with `{!hideHeader && (...)}`:

```tsx
{!hideHeader && (
    <div className="flex items-center justify-between px-4 py-3 border-b border-kumo-line shrink-0 md:px-6">
        <h2 className="text-base font-semibold text-kumo-default">
            {formTitle}
        </h2>
        <div className="flex items-center gap-1">
            <Button
                variant="ghost"
                shape="square"
                size="sm"
                icon={<XIcon size={18} />}
                onClick={closeCompose}
                disabled={isSending}
                aria-label="Close compose"
            />
        </div>
    </div>
)}
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

- [ ] **Step 4: Commit**

```bash
git add app/components/ComposePanel.tsx
git commit -m "feat: add hideHeader prop to ComposePanel for floating popover use"
```

---

## Task 4: Create ComposePopover — floating fixed compose window

**Files:**
- Create: `app/components/ComposePopover.tsx`

- [ ] **Step 1: Create the component**

```tsx
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { MinusIcon, XIcon } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { useParams } from "react-router";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import ComposePanel from "./ComposePanel";

export default function ComposePopover() {
	const { mailboxId, folder } = useParams<{ mailboxId: string; folder: string }>();
	const {
		isComposing,
		closeCompose,
		isComposeMinimized,
		toggleComposeMinimize,
	} = useUIStore();
	const { data: mailbox } = useMailbox(mailboxId);

	if (!isComposing) return null;

	const displayName =
		mailbox?.settings?.fromName ?? mailbox?.name ?? mailboxId ?? "Compose";
	const emailAddress = mailbox?.email ?? mailboxId ?? "";

	return createPortal(
		<>
			{/* Mobile: full-screen overlay */}
			<div className="md:hidden fixed inset-0 z-50 bg-kumo-base flex flex-col">
				<ComposePanel hideHeader={false} />
			</div>

			{/* Desktop/tablet: floating popover bottom-right */}
			<div
				className={`hidden md:flex flex-col fixed bottom-6 right-6 z-50 w-[520px] bg-kumo-base border border-kumo-line rounded-xl shadow-2xl overflow-hidden transition-[height] duration-150 ${
					isComposeMinimized ? "h-10" : "h-[440px]"
				}`}
			>
				{/* Popover header */}
				<div
					className="flex items-center gap-2 px-4 h-10 shrink-0 border-b border-kumo-line bg-kumo-recessed cursor-pointer select-none"
					onClick={isComposeMinimized ? toggleComposeMinimize : undefined}
					role={isComposeMinimized ? "button" : undefined}
					tabIndex={isComposeMinimized ? 0 : undefined}
					onKeyDown={
						isComposeMinimized
							? (e) => e.key === "Enter" && toggleComposeMinimize()
							: undefined
					}
					aria-label={isComposeMinimized ? "Restore compose" : undefined}
				>
					<div className="flex-1 flex items-center gap-2 min-w-0">
						<span className="text-sm font-medium text-kumo-default truncate">
							{displayName}
						</span>
						<span className="text-xs text-kumo-subtle truncate hidden sm:block">
							{emailAddress}
						</span>
					</div>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<MinusIcon size={14} />}
						onClick={(e) => {
							e.stopPropagation();
							toggleComposeMinimize();
						}}
						aria-label={isComposeMinimized ? "Restore" : "Minimize"}
					/>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<XIcon size={14} />}
						onClick={(e) => {
							e.stopPropagation();
							closeCompose();
						}}
						aria-label="Close compose"
					/>
				</div>

				{/* Compose body — hidden when minimized */}
				{!isComposeMinimized && (
					<div className="flex-1 min-h-0 overflow-hidden">
						<ComposePanel hideHeader={true} />
					</div>
				)}
			</div>
		</>,
		document.body,
	);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

- [ ] **Step 3: Commit**

```bash
git add app/components/ComposePopover.tsx
git commit -m "feat: add floating ComposePopover portal component"
```

---

## Task 5: Rewrite MailboxSplitView for 3-pane layout

**Files:**
- Modify: `app/components/MailboxSplitView.tsx`
- Modify: `app/routes/email-list.tsx` (update call site only — remove old props)

- [ ] **Step 1: Rewrite MailboxSplitView.tsx completely**

Replace the entire file with:

```tsx
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ReactNode } from "react";
import EmailPanel from "~/components/EmailPanel";
import EmptyReadingPane from "~/components/EmptyReadingPane";
import { useUIStore } from "~/hooks/useUIStore";

export default function MailboxSplitView({ children }: { children: ReactNode }) {
	const { selectedEmailId } = useUIStore();

	return (
		<div className="flex h-full">
			{/* Email list column
			    - Mobile: full-width when no email, hidden when reading
			    - Tablet (md): 320px fixed when email open, full-width otherwise
			    - Desktop (lg): 380px always visible */}
			<div
				className={`flex flex-col shrink-0 overflow-hidden ${
					selectedEmailId
						? "hidden md:flex md:w-[320px] md:border-r md:border-kumo-line lg:w-[380px]"
						: "flex w-full lg:w-[380px] lg:border-r lg:border-kumo-line"
				}`}
			>
				{children}
			</div>

			{/* Reading pane
			    - Mobile: full-screen when email selected, hidden otherwise
			    - Tablet (md): flex-1 always visible (empty state hidden on mobile)
			    - Desktop (lg): flex-1 with empty state placeholder */}
			<div
				className={`flex-1 flex flex-col min-w-0 overflow-hidden ${
					selectedEmailId ? "flex" : "hidden lg:flex"
				}`}
			>
				{selectedEmailId ? (
					<EmailPanel emailId={selectedEmailId} />
				) : (
					<EmptyReadingPane />
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Update the MailboxSplitView call site in email-list.tsx**

In `app/routes/email-list.tsx`, find the return statement (around line 271):

```tsx
return (
    <MailboxSplitView
        selectedEmailId={selectedEmailId}
        isComposing={isComposing}
    >
```

Replace it with:

```tsx
return (
    <MailboxSplitView>
```

Also remove `isComposing` from the `useUIStore()` destructure at the top of `EmailListRoute` (around line 149):

```typescript
const {
    selectedEmailId,
    isComposing,   // <-- remove this line
    selectEmail,
    closePanel,
    startCompose,
} = useUIStore();
```

And remove `isComposing` from the `isPanelOpen` calculation (around line 187) — but actually since `isPanelOpen` is only used by the folder header for padding adjustments, search for `isPanelOpen` in email-list.tsx and remove those references (the new 3-pane layout handles sizing via CSS in MailboxSplitView, not via the `isPanelOpen` prop).

Find and remove this line:
```typescript
const isPanelOpen = selectedEmailId !== null || isComposing;
```

Find the `className` on the email row div that references `isPanelOpen`:
```tsx
className={`group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-kumo-line px-4 py-2.5 md:px-6 md:py-3 ${
    isPanelOpen ? "md:px-4 md:py-2.5" : ""
} ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}
```

Simplify to (the compact rows in Task 7 will replace this anyway):
```tsx
className={`group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-kumo-line px-4 py-2.5 ${
    isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"
}`}
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

- [ ] **Step 4: Commit**

```bash
git add app/components/MailboxSplitView.tsx app/routes/email-list.tsx
git commit -m "feat: rewrite MailboxSplitView for always-visible 3-pane layout"
```

---

## Task 6: Rewrite Sidebar with identity block, search, VIEWS/MAIL sections

**Files:**
- Modify: `app/components/Sidebar.tsx`

- [ ] **Step 1: Replace Sidebar.tsx entirely**

```tsx
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Dialog, Input, Tooltip } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	CaretDoubleLeftIcon,
	CaretLeftIcon,
	FileIcon,
	FolderIcon,
	GearSixIcon,
	MagnifyingGlassIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrayIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Folders, SYSTEM_FOLDER_IDS } from "shared/folders";
import { useCreateFolder, useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";

const VIEWS_FOLDER_LINKS = [
	{ id: Folders.INBOX, label: "Inbox", icon: <TrayIcon size={16} weight="regular" /> },
];

const MAIL_FOLDER_LINKS = [
	{ id: Folders.SENT, label: "Sent", icon: <PaperPlaneTiltIcon size={16} weight="regular" /> },
	{ id: Folders.DRAFT, label: "Drafts", icon: <FileIcon size={16} weight="regular" /> },
	{ id: Folders.ARCHIVE, label: "Archive", icon: <ArchiveIcon size={16} weight="regular" /> },
	{ id: Folders.TRASH, label: "Trash", icon: <TrashIcon size={16} weight="regular" /> },
];

interface FolderLinkProps {
	to: string;
	icon: React.ReactNode;
	label: string;
	unreadCount?: number;
	onClick?: () => void;
}

function FolderLink({ to, icon, label, unreadCount, onClick }: FolderLinkProps) {
	return (
		<NavLink
			to={to}
			onClick={onClick}
			className={({ isActive }) =>
				`flex items-center gap-2.5 py-1.5 px-2.5 rounded-md text-[13px] transition-colors ${
					isActive
						? "bg-kumo-fill font-medium text-kumo-default"
						: "text-kumo-strong hover:bg-kumo-tint"
				}`
			}
		>
			<span className="shrink-0 text-kumo-subtle">{icon}</span>
			<span className="truncate flex-1">{label}</span>
			{unreadCount != null && unreadCount > 0 && (
				<Badge variant="secondary">{unreadCount}</Badge>
			)}
		</NavLink>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="px-2.5 pt-4 pb-1">
			<span className="text-[10px] font-semibold text-kumo-subtle uppercase tracking-wider">
				{children}
			</span>
		</div>
	);
}

export default function Sidebar() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const { data: folders = [] } = useFolders(mailboxId);
	const createFolderMutation = useCreateFolder();
	const { startCompose, closeSidebar, toggleSidebarCollapsed } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [searchQuery, setSearchQuery] = useState("");

	// Sync search input with URL
	const urlQuery = searchParams.get("q") || "";
	useEffect(() => {
		if (location.pathname.includes("/search") && urlQuery) {
			setSearchQuery(urlQuery);
		} else if (!location.pathname.includes("/search")) {
			setSearchQuery("");
		}
	}, [urlQuery, location.pathname]);

	const performSearch = () => {
		if (mailboxId && searchQuery.trim()) {
			navigate(`/mailbox/${mailboxId}/search?q=${encodeURIComponent(searchQuery.trim())}`);
			closeSidebar();
		}
	};

	const clearSearch = () => {
		setSearchQuery("");
		if (location.pathname.includes("/search") && mailboxId) {
			navigate(`/mailbox/${mailboxId}/emails/inbox`);
		}
	};

	const customFolders = useMemo(
		() => folders.filter((f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id)),
		[folders],
	);

	const getUnreadCount = (folderId: string) => {
		const found = folders.find((f) => f.id === folderId);
		return found?.unreadCount || 0;
	};

	const handleCreateFolder = (e: React.FormEvent) => {
		e.preventDefault();
		if (newFolderName.trim() && mailboxId) {
			createFolderMutation.mutate({ mailboxId, name: newFolderName.trim() });
			setNewFolderName("");
			setIsCreateFolderOpen(false);
		}
	};

	const displayName = useMemo(() => {
		if (!currentMailbox) return mailboxId?.split("@")[0] || "Mailbox";
		if (currentMailbox.settings?.fromName) return currentMailbox.settings.fromName;
		if (currentMailbox.name && currentMailbox.name !== currentMailbox.email) return currentMailbox.name;
		return currentMailbox.email.split("@")[0] || currentMailbox.name;
	}, [currentMailbox, mailboxId]);

	const handleNavClick = () => closeSidebar();

	return (
		<aside className="h-full w-[240px] bg-kumo-recessed flex flex-col shrink-0 border-r border-kumo-line">
			{/* Identity block */}
			<div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
				{/* Avatar */}
				{currentMailbox?.settings?.avatarUrl ? (
					<img
						src={currentMailbox.settings.avatarUrl}
						alt={displayName}
						className="h-8 w-8 rounded-full object-cover shrink-0"
					/>
				) : (
					<div className="h-8 w-8 rounded-full bg-kumo-fill flex items-center justify-center text-sm font-semibold text-kumo-default shrink-0">
						{displayName.charAt(0).toUpperCase()}
					</div>
				)}
				{/* Name + email */}
				<div className="flex-1 min-w-0">
					<div className="text-[13px] font-semibold text-kumo-default truncate leading-tight">
						{displayName}
					</div>
					<div className="text-[11px] text-kumo-subtle truncate leading-tight">
						{currentMailbox?.email || mailboxId}
					</div>
				</div>
				{/* Collapse sidebar (desktop) */}
				<Tooltip content="Collapse sidebar" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<CaretDoubleLeftIcon size={14} />}
						onClick={toggleSidebarCollapsed}
						aria-label="Collapse sidebar"
						className="hidden lg:inline-flex shrink-0"
					/>
				</Tooltip>
				{/* Compose pencil */}
				<Tooltip content="Compose" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<PencilSimpleIcon size={14} />}
						onClick={() => { startCompose(); closeSidebar(); }}
						aria-label="Compose new email"
						className="shrink-0"
					/>
				</Tooltip>
			</div>

			{/* Search */}
			<div className="px-3 pb-2 shrink-0">
				<div className="relative flex items-center">
					<MagnifyingGlassIcon
						size={14}
						className="absolute left-2.5 text-kumo-subtle pointer-events-none"
					/>
					<input
						type="text"
						placeholder="Search"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") performSearch();
							if (e.key === "Escape") clearSearch();
						}}
						className="w-full pl-8 pr-7 py-1.5 text-[13px] bg-kumo-fill border border-kumo-line rounded-md text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={clearSearch}
							className="absolute right-2 text-kumo-subtle hover:text-kumo-default bg-transparent border-0 p-0 cursor-pointer"
							aria-label="Clear search"
						>
							<XIcon size={12} />
						</button>
					)}
				</div>
			</div>

			{/* Navigation */}
			<nav className="flex-1 overflow-y-auto px-2 pb-2">
				{/* VIEWS section */}
				<SectionLabel>Views</SectionLabel>
				{VIEWS_FOLDER_LINKS.map((folder) => (
					<FolderLink
						key={folder.id}
						to={`/mailbox/${mailboxId}/emails/${folder.id}`}
						icon={folder.icon}
						label={folder.label}
						unreadCount={getUnreadCount(folder.id)}
						onClick={handleNavClick}
					/>
				))}

				{/* Custom folders under Views */}
				{customFolders.map((folder) => (
					<FolderLink
						key={folder.id}
						to={`/mailbox/${mailboxId}/emails/${folder.id}`}
						icon={<FolderIcon size={16} />}
						label={folder.name}
						unreadCount={folder.unreadCount}
						onClick={handleNavClick}
					/>
				))}

				{/* Add custom folder */}
				<button
					type="button"
					onClick={() => setIsCreateFolderOpen(true)}
					className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-md text-[13px] text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors bg-transparent border-0 cursor-pointer mt-0.5"
				>
					<PlusIcon size={14} />
					<span>Add view</span>
				</button>

				{/* MAIL section */}
				<SectionLabel>Mail</SectionLabel>
				{MAIL_FOLDER_LINKS.map((folder) => (
					<FolderLink
						key={folder.id}
						to={`/mailbox/${mailboxId}/emails/${folder.id}`}
						icon={folder.icon}
						label={folder.label}
						unreadCount={getUnreadCount(folder.id)}
						onClick={handleNavClick}
					/>
				))}
			</nav>

			{/* Bottom: Settings + Back to mailboxes */}
			<div className="px-2 py-2 border-t border-kumo-line shrink-0 space-y-0.5">
				<NavLink
					to={`/mailbox/${mailboxId}/settings`}
					onClick={handleNavClick}
					className={({ isActive }) =>
						`flex items-center gap-2.5 py-1.5 px-2.5 rounded-md text-[13px] transition-colors ${
							isActive
								? "bg-kumo-fill font-medium text-kumo-default"
								: "text-kumo-strong hover:bg-kumo-tint"
						}`
					}
				>
					<GearSixIcon size={16} className="text-kumo-subtle shrink-0" />
					<span>Settings</span>
				</NavLink>
				<button
					type="button"
					onClick={() => { navigate("/"); closeSidebar(); }}
					className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-md text-[13px] text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors bg-transparent border-0 cursor-pointer"
				>
					<CaretLeftIcon size={14} className="shrink-0" />
					<span>All mailboxes</span>
				</button>
			</div>

			{/* Create folder dialog */}
			<Dialog.Root open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						Create folder
					</Dialog.Title>
					<form onSubmit={handleCreateFolder} className="space-y-4">
						<Input
							label="Folder name"
							placeholder="e.g. Projects"
							value={newFolderName}
							onChange={(e) => setNewFolderName(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">Cancel</Button>
								)}
							/>
							<Button type="submit" variant="primary" disabled={!newFolderName.trim()}>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
		</aside>
	);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

- [ ] **Step 3: Commit**

```bash
git add app/components/Sidebar.tsx
git commit -m "feat: rewrite Sidebar with VIEWS/MAIL sections, embedded search, pencil compose"
```

---

## Task 7: Rewrite email list rows to 3-column compact layout with date groups

**Files:**
- Modify: `app/routes/email-list.tsx`

- [ ] **Step 1: Add date bucket helper and update imports**

At the top of `app/routes/email-list.tsx`, add `ListIcon` and `CaretDoubleRightIcon` to the phosphor import:

```tsx
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowsClockwiseIcon,
	CaretDoubleRightIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	ListIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
```

Add `toggleSidebarCollapsed`, `toggleSidebar`, and `isSidebarCollapsed` to the `useUIStore()` destructure inside `EmailListRoute`:

```typescript
const {
	selectedEmailId,
	selectEmail,
	closePanel,
	startCompose,
	toggleSidebar,
	isSidebarCollapsed,
	toggleSidebarCollapsed,
} = useUIStore();
```

- [ ] **Step 2: Add getDateBucket helper function**

Add this function before the `EmailListRoute` component (after `PAGE_SIZE = 25`):

```typescript
type DateBucket = "Today" | "Yesterday" | "This week" | "Older";

function getDateBucket(dateStr: string): DateBucket {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterdayStart = new Date(todayStart);
	yesterdayStart.setDate(yesterdayStart.getDate() - 1);
	const weekStart = new Date(todayStart);
	weekStart.setDate(weekStart.getDate() - 7);
	const d = new Date(dateStr);
	const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	if (dStart >= todayStart) return "Today";
	if (dStart >= yesterdayStart) return "Yesterday";
	if (dStart >= weekStart) return "This week";
	return "Older";
}
```

- [ ] **Step 3: Replace the EmailListSkeleton component**

Replace the existing `EmailListSkeleton` function with one matching the new compact row height:

```tsx
function EmailListSkeleton() {
	return (
		<div className="animate-pulse">
			{Array.from({ length: 10 }).map((_, i) => (
				<div key={i} className="flex items-center gap-2 px-4 h-9 border-b border-kumo-line">
					<div className="w-4 shrink-0" />
					<div className="w-44 shrink-0 h-3 rounded bg-kumo-fill" />
					<div className="flex-1 h-3 rounded bg-kumo-fill mx-2" />
					<div className="w-16 h-3 rounded bg-kumo-fill shrink-0" />
				</div>
			))}
		</div>
	);
}
```

- [ ] **Step 4: Update the folder header in EmailListRoute**

Find the folder header div (around line 277 in the original, after the return + MailboxSplitView):

```tsx
{/* Folder header */}
<div className="flex items-center justify-between px-4 py-3.5 border-b border-kumo-line shrink-0 md:px-5">
    <h1 className="text-lg font-semibold text-kumo-default">
        {folderName}
    </h1>
```

Replace with:

```tsx
{/* Folder header */}
<div className="flex items-center justify-between px-3 py-2.5 border-b border-kumo-line shrink-0">
    <div className="flex items-center gap-1.5">
        {/* Mobile hamburger — opens sidebar overlay */}
        <Button
            variant="ghost"
            shape="square"
            size="sm"
            icon={<ListIcon size={18} />}
            onClick={toggleSidebar}
            aria-label="Open menu"
            className="lg:hidden shrink-0"
        />
        {/* Desktop: expand button shown when sidebar is collapsed */}
        {isSidebarCollapsed && (
            <Button
                variant="ghost"
                shape="square"
                size="sm"
                icon={<CaretDoubleRightIcon size={14} />}
                onClick={toggleSidebarCollapsed}
                aria-label="Expand sidebar"
                className="hidden lg:inline-flex shrink-0"
            />
        )}
        <h1 className="text-base font-semibold text-kumo-default pl-1">
            {folderName}
        </h1>
    </div>
```

- [ ] **Step 5: Replace the email rows rendering block**

Find the `{/* Email rows */}` section and replace the entire `emails.map(...)` block with the new 3-column rows plus date group headers:

```tsx
{/* Email rows */}
<div className="flex-1 overflow-y-auto">
    {isRefreshing && emails.length === 0 ? (
        <EmailListSkeleton />
    ) : emails.length > 0 ? (
        <div>
            {emails.map((email, idx) => {
                const isSelected = selectedEmailId === email.id;
                const snippet = getSnippetText(email.snippet);
                const bucket = getDateBucket(email.date);
                const prevBucket = idx > 0 ? getDateBucket(emails[idx - 1].date) : null;
                const showHeader = bucket !== prevBucket;

                return (
                    <div key={email.id}>
                        {/* Date group header */}
                        {showHeader && (
                            <div className="px-4 py-1.5 text-[11px] font-semibold text-kumo-subtle uppercase tracking-wider bg-kumo-recessed border-b border-kumo-line">
                                {bucket}
                            </div>
                        )}

                        {/* Email row — single line 3-column */}
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => handleRowClick(email)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleRowClick(email);
                                }
                            }}
                            className={`group flex items-center h-9 px-4 cursor-pointer border-b border-kumo-line transition-colors ${
                                isSelected ? "bg-kumo-tint" : "hover:bg-kumo-fill/40"
                            }`}
                        >
                            {/* Unread dot */}
                            <div className="w-4 shrink-0 flex justify-center">
                                {hasUnread(email) && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-kumo-brand" />
                                )}
                            </div>

                            {/* Left col: sender + thread count */}
                            <div className="w-44 shrink-0 flex items-center gap-1.5 min-w-0 mr-3">
                                <span
                                    className={`text-[13px] truncate ${
                                        hasUnread(email)
                                            ? "font-semibold text-kumo-default"
                                            : "font-normal text-kumo-strong"
                                    }`}
                                >
                                    {formatParticipants(email)}
                                </span>
                                {(email.thread_count ?? 1) > 1 && (
                                    <span className="shrink-0 text-[11px] text-kumo-subtle">
                                        {email.thread_count}
                                    </span>
                                )}
                                {email.has_draft && (
                                    <span className="shrink-0 text-[11px] text-kumo-destructive font-medium">
                                        Draft
                                    </span>
                                )}
                            </div>

                            {/* Middle col: subject + preview */}
                            <div className="flex-1 min-w-0 flex items-baseline gap-1 mr-2 overflow-hidden">
                                <span
                                    className={`text-[13px] truncate shrink-0 max-w-[50%] ${
                                        hasUnread(email)
                                            ? "font-medium text-kumo-default"
                                            : "font-normal text-kumo-strong"
                                    }`}
                                >
                                    {email.subject}
                                </span>
                                {snippet && (
                                    <span className="text-[13px] text-kumo-subtle truncate">
                                        &nbsp;{snippet}
                                    </span>
                                )}
                            </div>

                            {/* Right col: date + hover actions */}
                            <div className="w-24 shrink-0 flex items-center justify-end gap-1">
                                <span className="text-[11px] text-kumo-subtle group-hover:hidden tabular-nums">
                                    {formatListDate(email.date)}
                                </span>
                                <div className="hidden group-hover:flex items-center">
                                    <Tooltip
                                        content={email.read ? "Mark unread" : "Mark read"}
                                        side="bottom"
                                        asChild
                                    >
                                        <Button
                                            variant="ghost"
                                            shape="square"
                                            size="sm"
                                            icon={
                                                email.read ? (
                                                    <EnvelopeSimpleIcon size={13} />
                                                ) : (
                                                    <EnvelopeOpenIcon size={13} />
                                                )
                                            }
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (mailboxId)
                                                    updateEmail.mutate({
                                                        mailboxId,
                                                        id: email.id,
                                                        data: { read: !email.read },
                                                    });
                                            }}
                                            aria-label={email.read ? "Mark unread" : "Mark read"}
                                        />
                                    </Tooltip>
                                    <Tooltip content="Delete" side="bottom" asChild>
                                        <Button
                                            variant="ghost"
                                            shape="square"
                                            size="sm"
                                            icon={<TrashIcon size={13} />}
                                            onClick={(e) => handleDelete(e, email.id)}
                                            aria-label="Delete"
                                        />
                                    </Tooltip>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    ) : (
        <FolderEmptyState
            folder={folder}
            onCompose={() => startCompose()}
        />
    )}
</div>
```

Also remove the `StarIcon` import (star button is removed from compact rows) and remove `PencilSimpleIcon` if it's no longer used in email-list.tsx (check for usages first).

- [ ] **Step 6: Verify typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

Fix any unused import errors (remove `StarIcon`, `PencilSimpleIcon`, `ArrowBendUpLeftIcon` if not used elsewhere in the file).

- [ ] **Step 7: Commit**

```bash
git add app/routes/email-list.tsx
git commit -m "feat: 3-column compact email rows with date groups and sidebar toggle"
```

---

## Task 8: Rewrite mailbox.tsx — remove Header, add ComposePopover

**Files:**
- Modify: `app/routes/mailbox.tsx`

- [ ] **Step 1: Rewrite mailbox.tsx completely**

```tsx
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { Outlet, useParams } from "react-router";
import AgentSidebar from "~/components/AgentSidebar";
import ComposePopover from "~/components/ComposePopover";
import Sidebar from "~/components/Sidebar";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";

export default function MailboxRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	useMailbox(mailboxId);
	const prevMailboxIdRef = useRef<string | undefined>(undefined);
	const {
		isSidebarOpen,
		closeSidebar,
		isAgentPanelOpen,
		closePanel,
		isSidebarCollapsed,
	} = useUIStore();

	useEffect(() => {
		if (
			prevMailboxIdRef.current &&
			mailboxId &&
			prevMailboxIdRef.current !== mailboxId
		) {
			closePanel();
			closeSidebar();
		}
		prevMailboxIdRef.current = mailboxId;
	}, [mailboxId, closePanel, closeSidebar]);

	return (
		<div className="flex h-screen overflow-hidden bg-kumo-base">
			{/* Mobile sidebar overlay backdrop */}
			{isSidebarOpen && (
				<div
					className="fixed inset-0 z-30 bg-black/40 lg:hidden"
					onClick={closeSidebar}
					onKeyDown={(e) => e.key === "Escape" && closeSidebar()}
					role="button"
					tabIndex={-1}
					aria-label="Close sidebar"
				/>
			)}

			{/* Sidebar:
			    - Mobile: fixed overlay, shown/hidden via isSidebarOpen
			    - Desktop: fixed column in flex layout, hideable via isSidebarCollapsed */}
			<div
				className={`
					fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 ease-in-out
					lg:relative lg:z-0 lg:translate-x-0 lg:transition-none
					${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
					${isSidebarCollapsed ? "lg:hidden" : ""}
				`}
			>
				<Sidebar />
			</div>

			{/* Main content: email list + reading pane via Outlet → email-list.tsx → MailboxSplitView */}
			<main className="flex-1 min-w-0 overflow-hidden">
				<Outlet />
			</main>

			{/* Agent + MCP sidebar — togglable on desktop */}
			{isAgentPanelOpen && (
				<div className="hidden lg:flex w-[380px] shrink-0 border-l border-kumo-line flex-col bg-kumo-base overflow-hidden">
					<AgentSidebar />
				</div>
			)}

			{/* Floating compose popover */}
			<ComposePopover />
		</div>
	);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

- [ ] **Step 3: Commit**

```bash
git add app/routes/mailbox.tsx
git commit -m "feat: remove Header bar, add ComposePopover to root mailbox layout"
```

---

## Task 9: Update EmailPanelHeader — add back button and agent toggle

**Files:**
- Modify: `app/components/email-panel/EmailPanelHeader.tsx`

- [ ] **Step 1: Rewrite EmailPanelHeader.tsx**

```tsx
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import { ArrowLeftIcon, RobotIcon } from "@phosphor-icons/react";
import { useUIStore } from "~/hooks/useUIStore";

interface EmailPanelHeaderProps {
	subject: string;
	messageCount: number;
	showThreadCount: boolean;
}

export default function EmailPanelHeader({
	subject,
	messageCount,
	showThreadCount,
}: EmailPanelHeaderProps) {
	const { closePanel, toggleAgentPanel, isAgentPanelOpen } = useUIStore();

	return (
		<div className="flex items-center gap-2 px-4 py-3 border-b border-kumo-line shrink-0 md:px-5">
			{/* Back button — visible on mobile/tablet (reading pane is full-screen there) */}
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={<ArrowLeftIcon size={16} />}
				onClick={closePanel}
				aria-label="Back to email list"
				className="md:hidden shrink-0"
			/>

			<div className="flex-1 min-w-0">
				<h2 className="text-base font-semibold text-kumo-default truncate">
					{subject}
				</h2>
				{showThreadCount && (
					<span className="text-xs text-kumo-subtle mt-0.5 block">
						{messageCount} messages in this thread
					</span>
				)}
			</div>

			{/* Agent panel toggle — desktop only */}
			<Tooltip
				content={isAgentPanelOpen ? "Hide AI agent" : "Show AI agent"}
				side="bottom"
				asChild
			>
				<Button
					variant={isAgentPanelOpen ? "secondary" : "ghost"}
					shape="square"
					size="sm"
					icon={<RobotIcon size={16} />}
					onClick={toggleAgentPanel}
					aria-label="Toggle AI agent panel"
					className="hidden lg:inline-flex shrink-0"
				/>
			</Tooltip>
		</div>
	);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

- [ ] **Step 3: Commit**

```bash
git add app/components/email-panel/EmailPanelHeader.tsx
git commit -m "feat: add back button and agent panel toggle to EmailPanelHeader"
```

---

## Task 10: Delete Header.tsx and ComposeEmail.tsx; clean up UIStore

**Files:**
- Delete: `app/components/Header.tsx`
- Delete: `app/components/ComposeEmail.tsx`
- Modify: `app/hooks/useUIStore.ts` (remove modal compose state)

- [ ] **Step 1: Delete Header.tsx**

```bash
rm /Users/ranugadisansa/Programming/Team/B3/mail-client/app/components/Header.tsx
```

- [ ] **Step 2: Delete ComposeEmail.tsx**

```bash
rm /Users/ranugadisansa/Programming/Team/B3/mail-client/app/components/ComposeEmail.tsx
```

- [ ] **Step 3: Remove modal compose fields from UIState interface in useUIStore.ts**

Remove from the `UIState` interface:
```typescript
// Remove these three lines:
isComposeModalOpen: boolean;
openComposeModal: (options?: ComposeOptions) => void;
closeComposeModal: () => void;
```

Remove from the `create<UIState>(...)` initial state:
```typescript
// Remove this line:
isComposeModalOpen: false,
```

Remove the `openComposeModal` and `closeComposeModal` implementations:
```typescript
// Remove these:
openComposeModal: (options) =>
    set({
        composeOptions: options || { mode: "new", originalEmail: null },
        isComposeModalOpen: true,
    }),

closeComposeModal: () =>
    set({
        isComposeModalOpen: false,
        composeOptions: { mode: "new", originalEmail: null },
    }),
```

- [ ] **Step 4: Verify typecheck — should be clean**

```bash
npm run typecheck 2>&1 | grep -E "error TS|✨"
```

Expected: no errors.

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | tail -15
```

Expected: `✓ built in ...` with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/hooks/useUIStore.ts
git rm app/components/Header.tsx app/components/ComposeEmail.tsx
git commit -m "chore: delete Header and ComposeEmail, remove legacy modal compose state"
```

---

## Final: Push and update PR

- [ ] **Push branch**

```bash
git push origin ui-refactor
```

- [ ] **Update PR description**

```bash
gh pr edit 1 --body "$(cat <<'EOF'
## Summary

- 3-pane layout: sidebar (240px) | email list (380px) | reading pane (flex-1) — always visible on desktop
- No top header bar — identity, search, and navigation all live in the sidebar
- Sidebar redesigned with VIEWS (Inbox + custom folders) and MAIL (Sent, Drafts, Archive, Trash) sections, embedded search, pencil compose icon, and collapse toggle
- Email rows redesigned to single-line 3-column compact layout (sender | subject + preview | date) with date group headers (Today / Yesterday / This week / Older)
- Compose moved from right-pane takeover to floating fixed popover (bottom-right, 520×440px), with minimize button; full-screen on mobile
- Back button added to email panel header on mobile; agent panel toggle moved from header to email panel header on desktop
- All existing data fetching, routing, AI compose, and business logic unchanged

## Test plan

- [ ] Desktop (≥1024px): sidebar fixed, list 380px, reading pane always visible with empty state
- [ ] Tablet (768–1024px): sidebar as overlay (hamburger in list header), list + reading pane side by side
- [ ] Mobile (<768px): sidebar as overlay, list full-screen, reading pane full-screen when email selected, back button returns to list
- [ ] Compose: pencil icon in sidebar triggers floating popover; minimize/restore works; close works; mobile shows full-screen
- [ ] Sidebar collapse (`<<` button): hides sidebar on desktop, `>>` button appears in list header to restore
- [ ] Email rows: compact single-line, date group headers correct, hover shows mark-read + delete actions
- [ ] Agent panel toggle in EmailPanelHeader works on desktop
- [ ] Settings navigation, folder creation, search all work correctly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --repo BitByBit-B3/mail.bbyb.dev
```

---
