// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { downloadFile, isImageMime, isPdfMime, isTextMime } from "~/lib/utils";
import type { Email } from "~/types";

interface PreviewAttachment {
	url: string;
	filename: string;
	downloadUrl: string;
	mimetype: string;
}

interface EmailPanelDialogsProps {
	sourceViewEmail: Email | null;
	previewAttachment: PreviewAttachment | null;
	onCloseSource: () => void;
	onClosePreview: () => void;
}

function getSourceHeaders(msg: Email): { key: string; value: string }[] {
	if (msg.raw_headers) {
		try {
			const parsed = JSON.parse(msg.raw_headers);
			if (Array.isArray(parsed)) {
				return parsed.map((header) => ({
					key: header.key || header.name || "",
					value: String(header.value || ""),
				}));
			}
			if (typeof parsed === "object" && parsed !== null) {
				return Object.entries(parsed).map(([key, value]) => ({
					key,
					value: String(value),
				}));
			}
		} catch {
			// Fall through to field-based headers.
		}
	}

	const headers: { key: string; value: string }[] = [];
	if (msg.sender) headers.push({ key: "From", value: msg.sender });
	if (msg.recipient) headers.push({ key: "To", value: msg.recipient });
	if (msg.cc) headers.push({ key: "Cc", value: msg.cc });
	if (msg.bcc) headers.push({ key: "Bcc", value: msg.bcc });
	if (msg.subject) headers.push({ key: "Subject", value: msg.subject });
	if (msg.date) headers.push({ key: "Date", value: msg.date });
	if (msg.message_id) headers.push({ key: "Message-ID", value: msg.message_id });
	if (msg.in_reply_to) headers.push({ key: "In-Reply-To", value: msg.in_reply_to });
	if (msg.email_references) {
		headers.push({ key: "References", value: msg.email_references });
	}
	if (msg.thread_id) headers.push({ key: "X-Thread-ID", value: msg.thread_id });
	return headers;
}

function TextPreview({ url }: { url: string }) {
	const [text, setText] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		setText(null);
		setError(null);
		fetch(url)
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				// Cap at 1 MB to avoid blowing out the dialog with huge logs
				const blob = await res.blob();
				const slice = blob.size > 1024 * 1024 ? blob.slice(0, 1024 * 1024) : blob;
				return slice.text();
			})
			.then((t) => { if (!cancelled) setText(t); })
			.catch((e: unknown) => {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
			});
		return () => { cancelled = true; };
	}, [url]);

	if (error) return <p className="text-sm text-kumo-danger p-4">Failed to load: {error}</p>;
	if (text === null) return <p className="text-sm text-kumo-subtle p-4">Loading…</p>;
	return (
		<pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words text-xs font-mono bg-kumo-tint/30 rounded-lg p-4">
			{text}
		</pre>
	);
}

export default function EmailPanelDialogs({
	sourceViewEmail,
	previewAttachment,
	onCloseSource,
	onClosePreview,
}: EmailPanelDialogsProps) {
	const sourceHeaders = sourceViewEmail ? getSourceHeaders(sourceViewEmail) : [];
	const mime = previewAttachment?.mimetype ?? "";
	const previewKind: "image" | "pdf" | "text" | "none" = previewAttachment
		? isImageMime(mime)
			? "image"
			: isPdfMime(mime)
				? "pdf"
				: isTextMime(mime)
					? "text"
					: "none"
		: "none";

	return (
		<>
			<Dialog.Root
				open={sourceViewEmail !== null}
				onOpenChange={(open) => {
					if (!open) onCloseSource();
				}}
			>
				<Dialog size="lg">
					<Dialog.Title>
						Email Source Headers
						{sourceViewEmail && (
							<span className="text-sm font-normal text-kumo-subtle ml-2">
								{sourceViewEmail.subject}
							</span>
						)}
					</Dialog.Title>
					{sourceViewEmail && (
						<div className="mt-4 max-h-[60vh] overflow-y-auto">
							<table className="w-full text-sm border-collapse">
								<tbody>
									{sourceHeaders.map((header, idx) => (
										<tr
											key={`${header.key}-${idx}`}
											className={idx % 2 === 0 ? "bg-kumo-tint/50" : ""}
										>
											<td className="py-1.5 px-3 font-mono font-semibold text-kumo-default whitespace-nowrap align-top w-[160px]">
												{header.key}
											</td>
											<td className="py-1.5 px-3 font-mono text-kumo-subtle break-all">
												{header.value}
											</td>
										</tr>
									))}
								</tbody>
							</table>
							{sourceHeaders.length === 0 && (
								<p className="text-sm text-kumo-subtle text-center py-8">
									No header data available for this email.
								</p>
							)}
						</div>
					)}
					<div className="flex justify-end mt-4">
						<Dialog.Close>
							<Button variant="secondary" size="sm">
								Close
							</Button>
						</Dialog.Close>
					</div>
				</Dialog>
			</Dialog.Root>

			<Dialog.Root
				open={previewAttachment !== null}
				onOpenChange={(open) => {
					if (!open) onClosePreview();
				}}
			>
				<Dialog size="lg">
					<Dialog.Title>{previewAttachment?.filename}</Dialog.Title>
					{previewAttachment && previewKind === "image" && (
						<div className="mt-4 flex flex-col items-center justify-center bg-kumo-tint/30 rounded-lg p-4 min-h-[200px]">
							<img
								src={previewAttachment.url}
								alt={previewAttachment.filename}
								className="max-w-full max-h-[70vh] object-contain rounded shadow-sm"
							/>
						</div>
					)}
					{previewAttachment && previewKind === "pdf" && (
						<div className="mt-4 bg-kumo-tint/30 rounded-lg overflow-hidden">
							<iframe
								src={previewAttachment.url}
								title={previewAttachment.filename}
								className="w-full h-[70vh] border-0"
							/>
						</div>
					)}
					{previewAttachment && previewKind === "text" && (
						<div className="mt-4">
							<TextPreview url={previewAttachment.url} />
						</div>
					)}
					{previewAttachment && previewKind === "none" && (
						<div className="mt-4 flex flex-col items-center justify-center bg-kumo-tint/30 rounded-lg p-8 min-h-[200px]">
							<p className="text-sm text-kumo-subtle">
								Preview not available for {previewAttachment.mimetype || "this file type"}.
							</p>
						</div>
					)}
					<div className="flex justify-between items-center mt-4">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => {
								if (previewAttachment) {
									downloadFile(
										previewAttachment.downloadUrl,
										previewAttachment.filename,
									);
								}
							}}
						>
							Download Original
						</Button>
						<Dialog.Close>
							<Button variant="primary" size="sm">
								Close
							</Button>
						</Dialog.Close>
					</div>
				</Dialog>
			</Dialog.Root>
		</>
	);
}
