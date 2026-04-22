// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Input } from "@cloudflare/kumo";
import {
	ArrowCounterClockwiseIcon,
	CaretDownIcon,
	FloppyDiskIcon,
	PaperPlaneTiltIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import type { Editor } from "@tiptap/react";
import { useComposeForm } from "~/hooks/useComposeForm";
import ComposeAttachments from "./ComposeAttachments";
import RecipientInput from "./RecipientInput";
import RichTextEditor from "./RichTextEditor";

export default function ComposePanel() {
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
		attachments,
		isAddingAttachments,
		addAttachments,
		removeAttachment,
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
		const hasExistingBody =
			currentBody && currentBody.trim() !== "" && currentBody !== "<p></p>";

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
		const hasBody =
			currentBody && currentBody.trim() !== "" && currentBody !== "<p></p>";
		if (hasBody) {
			setShowPrompt(true);
		} else {
			streamAIDraft();
		}
	}

	return (
		<div className="flex flex-col h-full bg-kumo-base">
			{/* Header */}
			<div className="flex items-center justify-between px-5 py-3 border-b border-kumo-line shrink-0">
				<h2 className="text-sm font-semibold text-kumo-default tracking-tight">
					{formTitle}
				</h2>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={<XIcon size={16} />}
					onClick={closeCompose}
					disabled={isSending}
					aria-label="Close compose"
				/>
			</div>

			<form
				onSubmit={(e) => handleSend(e, closePanel)}
				className="flex flex-col flex-1 min-h-0"
			>
				{/* Recipient fields */}
				<div className="px-5 pt-2 pb-0 shrink-0">
					{error && (
						<div className="mb-2">
							<Banner variant="error">{error}</Banner>
						</div>
					)}

					<RecipientInput
						label="To"
						value={to}
						onChange={setTo}
						placeholder="Add recipients…"
						required
						autoFocus={!to}
					/>

					{showCcBcc ? (
						<>
							<RecipientInput
								label="Cc"
								value={cc}
								onChange={setCc}
								placeholder="Add recipients…"
							/>
							<RecipientInput
								label="Bcc"
								value={bcc}
								onChange={setBcc}
								placeholder="Add recipients…"
							/>
						</>
					) : (
						<div className="flex justify-end pb-1">
							<button
								type="button"
								onClick={() => setShowCcBcc(true)}
								className="text-xs text-kumo-subtle hover:text-kumo-default font-medium flex items-center gap-1 bg-transparent border-0 cursor-pointer py-1"
							>
								<CaretDownIcon size={11} />
								Cc / Bcc
							</button>
						</div>
					)}

					{/* Subject */}
					<div className="flex items-center gap-3 py-2 border-b border-kumo-line">
						<span className="text-xs font-semibold text-kumo-subtle uppercase tracking-wide w-12 shrink-0">
							Subject
						</span>
						<input
							type="text"
							placeholder="Email subject"
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							required
							className="flex-1 bg-transparent border-0 outline-none text-sm text-kumo-default placeholder:text-kumo-subtle py-0.5"
						/>
					</div>

					<ComposeAttachments
						attachments={attachments}
						isAddingAttachments={isAddingAttachments}
						disabled={isSending || isSavingDraft}
						onAddFiles={addAttachments}
						onRemoveAttachment={removeAttachment}
					/>
				</div>

				{/* AI prompt bar (refine mode) */}
				{showPrompt && (
					<div className="px-5 pt-3 shrink-0">
						<div className="flex items-center gap-2 px-3 py-2 bg-kumo-recessed rounded-lg border border-kumo-line">
							<Input
								type="text"
								size="sm"
								placeholder="Instructions for AI (e.g. make it shorter, more formal…)"
								value={aiPrompt}
								onChange={(e) => setAiPrompt(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										streamAIDraft(aiPrompt);
									}
									if (e.key === "Escape") {
										setShowPrompt(false);
										setAiPrompt("");
									}
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
								onClick={() => {
									setShowPrompt(false);
									setAiPrompt("");
								}}
								aria-label="Cancel"
							/>
						</div>
					</div>
				)}

				{/* Regenerate bar */}
				{lastGenerated && !showPrompt && !isGenerating && (
					<div className="px-5 pt-3 shrink-0 flex items-center gap-2 text-sm text-kumo-subtle">
						<ArrowCounterClockwiseIcon size={13} />
						<span>AI draft generated.</span>
						<button
							type="button"
							className="text-kumo-link hover:text-kumo-link-hover bg-transparent border-0 cursor-pointer p-0"
							onClick={() => {
								setLastGenerated(false);
								setShowPrompt(true);
							}}
						>
							Refine
						</button>
						<span>or</span>
						<button
							type="button"
							className="text-kumo-link hover:text-kumo-link-hover bg-transparent border-0 cursor-pointer p-0"
							onClick={() => {
								setLastGenerated(false);
								streamAIDraft();
							}}
						>
							Regenerate
						</button>
					</div>
				)}

				{/* Editor */}
				<div className="flex-1 min-h-0 overflow-y-auto px-5 pt-3 pb-0">
					<div className="border border-kumo-line rounded-md overflow-hidden bg-kumo-base h-full min-h-[180px]">
						<RichTextEditor
							value={body}
							onChange={setBody}
							onAICompose={handleAICompose}
							isGenerating={isGenerating}
							editorRef={editorRef}
						/>
					</div>
				</div>

				{/* Footer */}
				<div className="px-5 py-3 border-t border-kumo-line shrink-0 mt-3">
					<div className="flex items-center justify-between">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={closeCompose}
							disabled={isSending}
						>
							Discard
						</Button>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								loading={isSavingDraft}
								disabled={isSending || isAddingAttachments}
								icon={<FloppyDiskIcon size={14} />}
								onClick={handleSaveDraft}
							>
								{isSavingDraft ? "Saving…" : "Save Draft"}
							</Button>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isSending}
								disabled={isSavingDraft || isSending || isAddingAttachments}
								icon={<PaperPlaneTiltIcon size={14} />}
							>
								{isSending ? "Sending…" : "Send"}
							</Button>
						</div>
					</div>
				</div>
			</form>
		</div>
	);
}
