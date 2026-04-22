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

			{/* Main content: email list + reading pane */}
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
