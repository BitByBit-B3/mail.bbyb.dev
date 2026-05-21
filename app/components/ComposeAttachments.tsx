// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { FileIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import { formatBytes } from "~/lib/utils";
import type { ComposeAttachmentItem } from "~/lib/composeAttachments";

export interface AttachmentProgress {
	phase: "signing" | "uploading" | "confirming" | "done" | "error";
	bytesUploaded?: number;
	totalBytes?: number;
	error?: string;
}

interface ComposeAttachmentsProps {
	attachments: ComposeAttachmentItem[];
	progress?: Map<string, AttachmentProgress>;
	isAddingAttachments: boolean;
	disabled?: boolean;
	onAddFiles: (files: FileList | null) => Promise<void> | void;
	onCancelUpload?: (localId: string) => void;
	onRemoveAttachment: (localId: string) => void;
}

const EMPTY_PROGRESS = new Map<string, AttachmentProgress>();

function phaseLabel(phase: AttachmentProgress["phase"]): string {
	switch (phase) {
		case "signing":
			return "Preparing";
		case "uploading":
			return "Uploading";
		case "confirming":
			return "Finishing";
		case "done":
			return "Ready";
		case "error":
			return "Failed";
	}
}

export default function ComposeAttachments({
	attachments,
	progress = EMPTY_PROGRESS,
	isAddingAttachments,
	disabled = false,
	onAddFiles,
	onCancelUpload,
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
					{attachments.map((attachment) => {
						const prog = progress.get(attachment.localId);
						const isUploading =
							!!prog && prog.phase !== "done" && prog.phase !== "error";
						const pct =
							prog?.bytesUploaded !== undefined && prog?.totalBytes
								? Math.min(
										100,
										Math.round(
											(prog.bytesUploaded / prog.totalBytes) * 100,
										),
									)
								: prog?.phase === "done"
									? 100
									: 0;

						return (
							<div
								key={attachment.localId}
								className="flex max-w-full items-center gap-2 rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2"
								style={{ minWidth: 220 }}
							>
								<FileIcon
									size={16}
									className="text-kumo-subtle shrink-0"
								/>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium text-kumo-default">
										{attachment.filename}
									</div>
									<div className="text-xs text-kumo-subtle">
										{formatBytes(attachment.size)}
										{isUploading && prog
											? ` · ${phaseLabel(prog.phase)} ${pct}%`
											: ""}
										{prog?.phase === "error" && prog.error
											? ` · ${prog.error}`
											: ""}
									</div>
									{isUploading && (
										<div
											className="mt-1 h-1 w-full overflow-hidden rounded-full bg-kumo-line"
											role="progressbar"
											aria-valuenow={pct}
											aria-valuemin={0}
											aria-valuemax={100}
										>
											<div
												className="h-full bg-kumo-default transition-all"
												style={{ width: `${pct}%` }}
											/>
										</div>
									)}
								</div>
								<button
									type="button"
									onClick={() => {
										if (isUploading) {
											onCancelUpload?.(attachment.localId);
										} else {
											onRemoveAttachment(attachment.localId);
										}
									}}
									disabled={disabled}
									aria-label={`${isUploading ? "Cancel" : "Remove"} ${attachment.filename}`}
									className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-50"
								>
									<XIcon size={12} />
								</button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
