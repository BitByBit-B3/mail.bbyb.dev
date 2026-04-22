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

	const handleCreateFolder = (e: React.SyntheticEvent<HTMLFormElement>) => {
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
				<div className="flex-1 min-w-0">
					<div className="text-[13px] font-semibold text-kumo-default truncate leading-tight">
						{displayName}
					</div>
					<div className="text-[11px] text-kumo-subtle truncate leading-tight">
						{currentMailbox?.email || mailboxId}
					</div>
				</div>
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
				<button
					type="button"
					onClick={() => setIsCreateFolderOpen(true)}
					className="flex items-center gap-2.5 w-full py-1.5 px-2.5 rounded-md text-[13px] text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors bg-transparent border-0 cursor-pointer mt-0.5"
				>
					<PlusIcon size={14} />
					<span>Add view</span>
				</button>

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

			{/* Bottom */}
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
