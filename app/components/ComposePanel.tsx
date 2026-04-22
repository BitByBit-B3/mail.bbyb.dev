// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Input } from "@cloudflare/kumo";
import { ArrowCounterClockwiseIcon, FloppyDiskIcon, PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import type { Editor } from "@tiptap/react";
import { useComposeForm } from "~/hooks/useComposeForm";
import RichTextEditor from "./RichTextEditor";

export default function ComposePanel({ hideHeader = false }: { hideHeader?: boolean }) {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();

	const {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		error,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
		closeCompose,
		closePanel,
	} = useComposeForm(mailboxId, folder);

	const editorRef = useRef<Editor | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [showPrompt, setShowPrompt] = useState(false);
	const [aiPrompt, setAiPrompt] = useState("");
	const [lastGenerated, setLastGenerated] = useState(false);

	async function streamAIDraft(prompt?: string) {
		if (!mailboxId || isGenerating) return;

		const currentBody = editorRef.current?.getHTML() ?? body;
		const hasExistingBody = currentBody && currentBody.trim() !== "" && currentBody !== "<p></p>";

		setIsGenerating(true);
		setShowPrompt(false);

		try {
			const res = await fetch(`/api/v1/mailboxes/${mailboxId}/ai-compose`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: prompt || undefined,
					subject: subject || undefined,
					to: to || undefined,
					existing: hasExistingBody ? currentBody : undefined,
				}),
			});

			if (!res.ok || !res.body) throw new Error("AI compose failed");

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let accumulated = "";

			// Clear editor and start streaming
			if (editorRef.current && !editorRef.current.isDestroyed) {
				editorRef.current.commands.setContent("");
			}

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				accumulated += decoder.decode(value, { stream: true });

				if (editorRef.current && !editorRef.current.isDestroyed) {
					editorRef.current.commands.setContent(
						accumulated.replace(/\n/g, "<br>"),
					);
				}
			}

			// Sync final content to React state
			setBody(editorRef.current?.getHTML() ?? accumulated);
			setLastGenerated(true);
		} catch {
			// leave editor as-is on error
		} finally {
			setIsGenerating(false);
			setAiPrompt("");
		}
	}

	function handleAICompose() {
		const currentBody = editorRef.current?.getHTML() ?? body;
		const hasBody = currentBody && currentBody.trim() !== "" && currentBody !== "<p></p>";
		if (hasBody) {
			setShowPrompt(true);
		} else {
			streamAIDraft();
		}
	}

	return (
		<div className="flex flex-col h-full bg-kumo-base">
			{!hideHeader && (
				<div className="flex items-center justify-between px-4 py-3 border-b border-kumo-line shrink-0 md:px-6">
					<h2 className="text-base font-semibold text-kumo-default">
						{formTitle}
					</h2>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<XIcon size={18} />}
							onClick={closeCompose}
							disabled={isSending}
							aria-label="Close compose"
						/>
					</div>
				</div>
			)}

			<form
				onSubmit={(e) => handleSend(e, closePanel)}
				className="flex flex-col flex-1 min-h-0 overflow-y-auto"
			>
				<div className="p-4 md:p-6 space-y-4">
					{error && <Banner variant="error">{error}</Banner>}

					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
								To
							</label>
							<div className="flex-1 flex items-center gap-2 min-w-0">
								<Input
									type="text"
									placeholder="recipient@example.com"
									size="sm"
									value={to}
									onChange={(e) => setTo(e.target.value)}
									required
								/>
								{!showCcBcc && (
									<button
										type="button"
										onClick={() => setShowCcBcc(true)}
										className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium"
									>
										CC / BCC
									</button>
								)}
							</div>
						</div>

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
									CC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										value={cc}
										onChange={(e) => setCc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
									BCC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										value={bcc}
										onChange={(e) => setBcc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						<div className="flex items-center gap-2">
							<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
								Subject
							</label>
							<div className="flex-1">
								<Input
									type="text"
									placeholder="Email subject"
									size="sm"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									required
								/>
							</div>
						</div>
					</div>

					{/* AI prompt bar (refine mode) */}
					{showPrompt && (
						<div className="flex items-center gap-2 px-3 py-2 bg-kumo-recessed rounded-lg border border-kumo-line">
							<Input
								type="text"
								size="sm"
								placeholder="Instructions for AI (e.g. make it shorter, more formal…)"
								value={aiPrompt}
								onChange={(e) => setAiPrompt(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") { e.preventDefault(); streamAIDraft(aiPrompt); }
									if (e.key === "Escape") { setShowPrompt(false); setAiPrompt(""); }
								}}
								autoFocus
							/>
							<Button
								type="button"
								variant="primary"
								size="sm"
								onClick={() => streamAIDraft(aiPrompt)}
								disabled={isGenerating}
							>
								Generate
							</Button>
							<Button
								type="button"
								variant="ghost"
								shape="square"
								size="sm"
								icon={<XIcon size={14} />}
								onClick={() => { setShowPrompt(false); setAiPrompt(""); }}
								aria-label="Cancel"
							/>
						</div>
					)}

					{/* Regenerate bar shown after a successful generation */}
					{lastGenerated && !showPrompt && !isGenerating && (
						<div className="flex items-center gap-2 text-sm text-kumo-subtle">
							<ArrowCounterClockwiseIcon size={14} />
							<span>AI draft generated.</span>
							<button
								type="button"
								className="text-kumo-link hover:text-kumo-link-hover"
								onClick={() => { setLastGenerated(false); setShowPrompt(true); }}
							>
								Refine
							</button>
							<span>or</span>
							<button
								type="button"
								className="text-kumo-link hover:text-kumo-link-hover"
								onClick={() => { setLastGenerated(false); streamAIDraft(); }}
							>
								Regenerate
							</button>
						</div>
					)}

					<div className="border border-kumo-line rounded-md overflow-hidden bg-kumo-base">
						<RichTextEditor
							value={body}
							onChange={setBody}
							onAICompose={handleAICompose}
							isGenerating={isGenerating}
							editorRef={editorRef}
						/>
					</div>
				</div>

				{/* Footer actions */}
				<div className="mt-auto px-4 py-3 border-t border-kumo-line bg-kumo-fill/30 shrink-0 md:px-6">
					<div className="flex items-center justify-between">
						<Button type="button" variant="ghost" size="sm" onClick={closeCompose} disabled={isSending}>
							Discard
						</Button>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								loading={isSavingDraft}
								disabled={isSending}
								icon={<FloppyDiskIcon size={14} />}
								onClick={handleSaveDraft}
							>
								{isSavingDraft ? "Saving..." : "Save as Draft"}
							</Button>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isSending}
								disabled={isSavingDraft || isSending}
								icon={<PaperPlaneTiltIcon size={14} />}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						</div>
					</div>
				</div>
			</form>
		</div>
	);
}
