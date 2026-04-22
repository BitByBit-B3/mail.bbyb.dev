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
	const { mailboxId } = useParams<{ mailboxId: string; folder: string }>();
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
