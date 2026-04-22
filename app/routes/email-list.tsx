// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Pagination, Tooltip } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowsClockwiseIcon,
	CaretDoubleRightIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	ListIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { Folders } from "shared/folders";
import { formatListDate } from "shared/dates";
import MailboxSplitView from "~/components/MailboxSplitView";
import { getSnippetText } from "~/lib/utils";
import {
	useDeleteEmail,
	useEmails,
	useMarkThreadRead,
	useUpdateEmail,
} from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

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

const FOLDER_EMPTY_STATES: Record<
	string,
	{
		icon: React.ReactNode;
		title: string;
		description: string;
		showCompose?: boolean;
	}
> = {
	[Folders.INBOX]: {
		icon: <TrayIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Your inbox is empty",
		description:
			"New emails will appear here when they arrive. Send an email to get the conversation started.",
		showCompose: true,
	},
	[Folders.SENT]: {
		icon: (
			<PaperPlaneTiltIcon size={48} weight="thin" className="text-kumo-subtle" />
		),
		title: "No sent emails",
		description: "Emails you send will show up here.",
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "No drafts",
		description: "Emails you're still working on will be saved here.",
		showCompose: true,
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Archive is empty",
		description:
			"Move emails here to keep your inbox clean without deleting them.",
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Trash is empty",
		description:
			"Deleted emails will appear here. You can restore them or permanently delete them.",
	},
};

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

function FolderEmptyState({
	folder,
	onCompose,
}: {
	folder?: string;
	onCompose: () => void;
}) {
	const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
		icon: (
			<EnvelopeSimpleIcon size={48} weight="thin" className="text-kumo-subtle" />
		),
		title: "No emails",
		description: "This folder is empty.",
	};

	return (
		<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
			<div className="mb-4">{config.icon}</div>
			<h3 className="text-base font-semibold text-kumo-default mb-1.5">
				{config.title}
			</h3>
			<p className="text-sm text-kumo-subtle max-w-xs mb-5">
				{config.description}
			</p>
			{"showCompose" in config && config.showCompose && (
				<Button
					variant="primary"
					size="sm"
					icon={<PencilSimpleIcon size={16} />}
					onClick={onCompose}
				>
					Compose
				</Button>
			)}
		</div>
	);
}

export default function EmailListRoute() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();
	const {
		selectedEmailId,
		selectEmail,
		closePanel,
		startCompose,
		toggleSidebar,
		isSidebarCollapsed,
		toggleSidebarCollapsed,
	} = useUIStore();
	const [page, setPage] = useState(1);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const deleteEmail = useDeleteEmail();

	const params = useMemo(
		() => ({
			folder: folder || "",
			page: String(page),
			limit: String(PAGE_SIZE),
		}),
		[folder, page],
	);

	const {
		data: emailData,
		isFetching: isRefreshing,
	} = useEmails(mailboxId, params, { refetchInterval: 30_000 });

	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

	const { data: folders = [] } = useFolders(mailboxId);

	const folderName = useMemo(() => {
		const found = folders.find((f) => f.id === folder);
		if (found) return found.name;
		return folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : "Inbox";
	}, [folders, folder]);


	// Track folder identity to detect folder changes vs page changes
	const prevFolderRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		const folderChanged = prevFolderRef.current !== `${mailboxId}/${folder}`;
		prevFolderRef.current = `${mailboxId}/${folder}`;

		if (folderChanged) {
			closePanel();
			setPage(1);
		}
	}, [mailboxId, folder, closePanel]);

	const handleDelete = (e: React.MouseEvent, emailId: string) => {
		e.preventDefault();
		e.stopPropagation();
		if (mailboxId) {
			const confirmed = window.confirm("Are you sure you want to delete this email?");
			if (!confirmed) return;
			deleteEmail.mutate({ mailboxId, id: emailId });
			if (selectedEmailId === emailId) closePanel();
		}
	};

	const handleRefresh = () => {
		if (mailboxId) {
			queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
			queryClient.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			});
		}
	};

	// Thread-aware helpers
	const hasUnread = (email: Email): boolean => {
		if (email.thread_unread_count !== undefined) {
			return email.thread_unread_count > 0;
		}
		return !email.read;
	};

	const handleRowClick = (email: Email) => {
		selectEmail(email.id);
		if (mailboxId && hasUnread(email)) {
			if (email.thread_id && email.thread_count && email.thread_count > 1) {
				markThreadRead.mutate({
					mailboxId,
					threadId: email.thread_id,
				});
			} else {
				updateEmail.mutate({
					mailboxId,
					id: email.id,
					data: { read: true },
				});
			}
		}
	};

	const formatParticipants = (email: Email): string => {
		if (email.participants) {
			const names = email.participants
				.split(",")
				.map((p) => p.trim().split("@")[0])
				.filter((name, idx, arr) => arr.indexOf(name) === idx);
			if (names.length <= 3) return names.join(", ");
			return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
		}
		return email.sender.split("@")[0];
	};

	return (
		<MailboxSplitView>
				{/* Folder header */}
				<div className="flex items-center justify-between px-3 py-2.5 border-b border-kumo-line shrink-0">
					<div className="flex items-center gap-1.5">
						{/* Mobile hamburger */}
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ListIcon size={18} />}
							onClick={toggleSidebar}
							aria-label="Open menu"
							className="lg:hidden shrink-0"
						/>
						{/* Desktop: expand button when sidebar is collapsed */}
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
					<div className="flex items-center gap-1">
						<Tooltip
							content={isRefreshing ? "Refreshing..." : "Refresh"}
							side="bottom"
							asChild
						>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={
									<ArrowsClockwiseIcon
										size={16}
										className={isRefreshing ? "animate-spin" : ""}
									/>
								}
								onClick={handleRefresh}
								disabled={isRefreshing}
								aria-label="Refresh"
							/>
						</Tooltip>
					</div>
				</div>

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
												<Tooltip content={email.read ? "Mark unread" : "Mark read"} side="bottom" asChild>
													<Button
														variant="ghost"
														shape="square"
														size="sm"
														icon={email.read ? <EnvelopeSimpleIcon size={13} /> : <EnvelopeOpenIcon size={13} />}
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

				{/* Pagination */}
				{totalCount > PAGE_SIZE && (
					<div className="flex justify-center py-3 border-t border-kumo-line shrink-0">
						<Pagination
							page={page}
							setPage={setPage}
							perPage={PAGE_SIZE}
							totalCount={totalCount}
						/>
					</div>
				)}
		</MailboxSplitView>
	);
}
