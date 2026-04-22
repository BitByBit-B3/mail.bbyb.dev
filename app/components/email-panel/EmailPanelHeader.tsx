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
			{/* Back button — mobile only */}
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={<ArrowLeftIcon size={16} />}
				onClick={closePanel}
				aria-label="Back to email list"
				className="lg:hidden shrink-0"
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
