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
