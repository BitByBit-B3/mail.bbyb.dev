// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { PaperclipIcon, FileIcon, ImageIcon, FilePdfIcon, FileTextIcon } from "@phosphor-icons/react";
import {
	formatBytes,
	getAttachmentUrl,
	getNonInlineAttachments,
	isImageMime,
	isPdfMime,
	isPreviewableMime,
	isTextMime,
} from "~/lib/utils";
import type { Attachment } from "~/types";

interface EmailAttachmentListProps {
	mailboxId?: string;
	emailId: string;
	attachments?: Attachment[];
	onPreviewAttachment?: (
		previewUrl: string,
		filename: string,
		downloadUrl: string,
		mimetype: string,
	) => void;
	className?: string;
	showHeading?: boolean;
}

export default function EmailAttachmentList({
	mailboxId,
	emailId,
	attachments,
	onPreviewAttachment,
	className,
	showHeading = false,
}: EmailAttachmentListProps) {
	if (!mailboxId) return null;

	const files = getNonInlineAttachments(attachments);
	if (files.length === 0) return null;

	return (
		<div className={className}>
			{showHeading && (
				<div className="flex items-center gap-2 mb-2">
					<PaperclipIcon size={14} className="text-kumo-subtle" />
					<span className="text-sm font-medium text-kumo-default">
						{files.length} attachment{files.length !== 1 ? "s" : ""}
					</span>
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				{files.map((attachment) => {
					const downloadUrl = getAttachmentUrl(
						mailboxId,
						emailId,
						attachment.id,
						{ disposition: "attachment" },
					);
					const previewUrl = getAttachmentUrl(
						mailboxId,
						emailId,
						attachment.id,
						{ disposition: "inline" },
					);
					const mime = attachment.mimetype || "";
					const Icon = isImageMime(mime)
						? ImageIcon
						: isPdfMime(mime)
							? FilePdfIcon
							: isTextMime(mime)
								? FileTextIcon
								: FileIcon;
					const previewable = isPreviewableMime(mime);

					if (previewable && onPreviewAttachment) {
						return (
							<button
								key={attachment.id}
								type="button"
								onClick={() =>
									onPreviewAttachment(
										previewUrl,
										attachment.filename,
										downloadUrl,
										mime,
									)
								}
								className="flex items-center gap-2 rounded-md border border-kumo-line px-3 py-2 transition-colors hover:bg-kumo-tint text-sm text-left"
							>
								<Icon size={16} className="text-kumo-subtle shrink-0" />
								<span className="text-kumo-default font-medium truncate max-w-[140px]">
									{attachment.filename}
								</span>
								<span className="text-kumo-subtle">{formatBytes(attachment.size)}</span>
							</button>
						);
					}

					return (
						<a
							key={attachment.id}
							href={downloadUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 rounded-md border border-kumo-line px-3 py-2 no-underline transition-colors hover:bg-kumo-tint text-sm"
						>
							<Icon size={16} className="text-kumo-subtle shrink-0" />
							<span className="text-kumo-default font-medium truncate max-w-[140px]">
								{attachment.filename}
							</span>
							<span className="text-kumo-subtle">{formatBytes(attachment.size)}</span>
						</a>
					);
				})}
			</div>
		</div>
	);
}
