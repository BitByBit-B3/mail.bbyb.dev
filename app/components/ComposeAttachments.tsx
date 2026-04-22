// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { FileIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import { formatBytes } from "~/lib/utils";
import type { ComposeAttachmentItem } from "~/lib/composeAttachments";

interface ComposeAttachmentsProps {
	attachments: ComposeAttachmentItem[];
	isAddingAttachments: boolean;
	disabled?: boolean;
	onAddFiles: (files: FileList | null) => Promise<void> | void;
	onRemoveAttachment: (localId: string) => void;
}

export default function ComposeAttachments({
	attachments,
	isAddingAttachments,
	disabled = false,
	onAddFiles,
	onRemoveAttachment,
}: ComposeAttachmentsProps) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	return (
		<div className="py-3 border-b border-kumo-line">
			<div className="flex items-center gap-3">
				<input
					ref={fileInputRef}
					type="file"
					multiple
					className="hidden"
					onChange={async (event) => {
						await onAddFiles(event.target.files);
						event.target.value = "";
					}}
					disabled={disabled || isAddingAttachments}
				/>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					icon={<PaperclipIcon size={14} />}
					loading={isAddingAttachments}
					disabled={disabled || isAddingAttachments}
					onClick={() => fileInputRef.current?.click()}
				>
					{isAddingAttachments ? "Adding files…" : "Attach files"}
				</Button>
				{attachments.length > 0 && (
					<span className="text-xs text-kumo-subtle">
						{attachments.length} file{attachments.length === 1 ? "" : "s"}
					</span>
				)}
			</div>

			{attachments.length > 0 && (
				<div className="flex flex-wrap gap-2 pt-3">
					{attachments.map((attachment) => (
						<div
							key={attachment.localId}
							className="flex max-w-full items-center gap-2 rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2"
						>
							<FileIcon
								size={16}
								className="text-kumo-subtle shrink-0"
							/>
							<div className="min-w-0">
								<div className="truncate text-sm font-medium text-kumo-default">
									{attachment.filename}
								</div>
								<div className="text-xs text-kumo-subtle">
									{formatBytes(attachment.size)}
								</div>
							</div>
							<button
								type="button"
								onClick={() => onRemoveAttachment(attachment.localId)}
								disabled={disabled}
								aria-label={`Remove ${attachment.filename}`}
								className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-50"
							>
								<XIcon size={12} />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
