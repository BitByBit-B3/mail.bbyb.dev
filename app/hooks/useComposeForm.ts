// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	buildStoredComposeAttachments,
	serializeComposeAttachments,
	uploadFilesToR2,
	type ComposeAttachmentItem,
	type UploadController,
	type UploadProgress,
} from "~/lib/composeAttachments";
import {
	buildQuotedReplyBlock,
	escapeHtml,
	formatComposeDate,
	getSignatureBlock,
	htmlToPlainText,
	splitEmailList,
	stripHtml,
	toEmailListValue,
} from "~/lib/utils";
import { useDeleteEmail, useForwardEmail, useReplyToEmail, useSaveDraft, useSendEmail } from "~/queries/emails";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";

function appendUniqueAddress(
	addresses: string[],
	seen: Set<string>,
	address: string,
	exclude?: string,
) {
	const trimmed = address.trim();
	if (!trimmed) return;

	const normalized = trimmed.toLowerCase();
	if (normalized === exclude || seen.has(normalized)) return;

	seen.add(normalized);
	addresses.push(trimmed);
}

interface ComposeFormFields {
	to: string;
	cc: string;
	bcc: string;
	showCcBcc: boolean;
	subject: string;
	body: string;
	attachments: ComposeAttachmentItem[];
}

const EMPTY_FIELDS: ComposeFormFields = {
	to: "",
	cc: "",
	bcc: "",
	showCcBcc: false,
	subject: "",
	body: "",
	attachments: [],
};

function getPrefixedSubject(subject: string, prefix: "Re" | "Fwd") {
	const expectedPrefix = `${prefix}: `;
	return subject.startsWith(expectedPrefix)
		? subject
		: `${expectedPrefix}${subject}`;
}

function buildForwardBody(
	original: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"]>,
	sigBlock: string,
) {
	const safeSender = escapeHtml(original.sender);
	const safeSubject = escapeHtml(original.subject);
	const safeBody = escapeHtml(stripHtml(original.body || "")).replace(/\n/g, "<br>");

	return `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}<div style="border: 1px solid #ddd; padding: 1em; background-color: #f9f9f9; margin: 1em 0;"><strong>Forwarded message:</strong><br><strong>From:</strong> ${safeSender}<br><strong>Date:</strong> ${formatComposeDate(original.date)}<br><strong>Subject:</strong> ${safeSubject}<br><br>${safeBody}</div>`;
}

function buildReplyAllFields(
	original: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"]>,
	selfAddress?: string,
) {
	const toRecipients: string[] = [];
	const toSeen = new Set<string>();
	appendUniqueAddress(toRecipients, toSeen, original.sender, selfAddress);

	for (const recipient of splitEmailList(original.recipient)) {
		appendUniqueAddress(toRecipients, toSeen, recipient, selfAddress);
	}

	const ccRecipients: string[] = [];
	const ccSeen = new Set<string>();
	for (const recipient of splitEmailList(original.cc)) {
		const normalized = recipient.toLowerCase();
		if (
			normalized === selfAddress ||
			toSeen.has(normalized) ||
			ccSeen.has(normalized)
		) {
			continue;
		}
		ccSeen.add(normalized);
		ccRecipients.push(recipient);
	}

	return {
		to: toRecipients.join(", "),
		cc: ccRecipients.join(", "),
		showCcBcc: ccRecipients.length > 0,
	};
}

function buildInitialComposeFields(
	composeOptions: ReturnType<typeof useUIStore.getState>["composeOptions"],
	mailboxEmail: string | undefined,
): ComposeFormFields {
	const { draftEmail: draft, originalEmail: original, mode } = composeOptions;

	// Signatures are NOT injected into the editor — they're appended at
	// send/save time. Editor stays clean for what the user is actually writing.

	if (draft) {
		return {
			to: draft.recipient || "",
			cc: draft.cc || "",
			bcc: draft.bcc || "",
			showCcBcc: Boolean(draft.cc || draft.bcc),
			subject: draft.subject || "",
			body: draft.body || "",
			attachments: buildStoredComposeAttachments(draft, { includeInline: true }),
		};
	}

	if (!original) {
		return { ...EMPTY_FIELDS };
	}

	if (mode === "reply") {
		return {
			...EMPTY_FIELDS,
			to: original.sender,
			subject: getPrefixedSubject(original.subject, "Re"),
			body: `<p><br></p>${buildQuotedReplyBlock(original.date, original.sender, original.body || "")}`,
		};
	}

	if (mode === "reply-all") {
		const recipients = buildReplyAllFields(original, mailboxEmail?.toLowerCase());
		return {
			...EMPTY_FIELDS,
			...recipients,
			subject: getPrefixedSubject(original.subject, "Re"),
			body: `<p><br></p>${buildQuotedReplyBlock(original.date, original.sender, original.body || "")}`,
		};
	}

	if (mode === "forward") {
		return {
			...EMPTY_FIELDS,
			subject: getPrefixedSubject(original.subject, "Fwd"),
			body: buildForwardBody(original, ""),
			attachments: buildStoredComposeAttachments(original, { includeInline: true }),
		};
	}

	return { ...EMPTY_FIELDS };
}

function appendSignature(body: string, sigBlock: string): string {
	if (!sigBlock) return body;
	const sep = body && body.trim() ? "<br>" : "";
	return `${body}${sep}${sigBlock}`;
}

export function useComposeForm(mailboxId?: string, _folder?: string) {
	const toastManager = useKumoToastManager();
	const { composeOptions, closePanel, closeCompose } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const sendEmailMutation = useSendEmail();
	const saveDraftMutation = useSaveDraft();
	const replyMutation = useReplyToEmail();
	const forwardMutation = useForwardEmail();
	const deleteEmailMutation = useDeleteEmail();

	const [to, setTo] = useState("");
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [showCcBcc, setShowCcBcc] = useState(false);
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [attachments, setAttachments] = useState<ComposeAttachmentItem[]>([]);
	const [attachmentProgress, setAttachmentProgress] = useState<
		Map<string, UploadProgress>
	>(new Map());
	const uploadControllers = useRef<Map<string, UploadController>>(new Map());
	const [error, setError] = useState<string | null>(null);
	const [isSavingDraft, setIsSavingDraft] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [isAddingAttachments, setIsAddingAttachments] = useState(false);
	const [draftId, setDraftId] = useState<string | undefined>(
		composeOptions.draftEmail?.id || undefined,
	);
	const lastInitializedOptionsRef = useRef<typeof composeOptions | null>(null);
	const isDraftEdit = !!composeOptions.draftEmail;

	const formTitle = useMemo(() => {
		if (isDraftEdit) return "Edit Draft";
		switch (composeOptions.mode) { case "reply": return "Reply"; case "reply-all": return "Reply All"; case "forward": return "Forward"; default: return "New Message"; }
	}, [composeOptions.mode, isDraftEdit]);

	const sigBlock = useMemo(() => getSignatureBlock(currentMailbox?.settings), [currentMailbox]);

	useEffect(() => {
		if (lastInitializedOptionsRef.current === composeOptions) return;
		lastInitializedOptionsRef.current = composeOptions;

		const initialFields = buildInitialComposeFields(
			composeOptions,
			currentMailbox?.email,
		);
		setError(null);
		setTo(initialFields.to);
		setCc(initialFields.cc);
		setBcc(initialFields.bcc);
		setShowCcBcc(initialFields.showCcBcc);
		setSubject(initialFields.subject);
		setBody(initialFields.body);
		setAttachments(initialFields.attachments);
		setDraftId(composeOptions.draftEmail?.id || undefined);
	}, [composeOptions, currentMailbox?.email]);

	const addAttachments = useCallback(
		async (files: FileList | null) => {
			if (!files || files.length === 0) return;
			if (!mailboxId) {
				toastManager.add({
					title: "Select a mailbox before attaching files.",
					variant: "error",
				});
				return;
			}
			const totalIncoming = Array.from(files).length;
			setIsAddingAttachments(true);
			try {
				const newItems = await uploadFilesToR2(
					files,
					mailboxId,
					(p) => {
						setAttachmentProgress((prev) => {
							const next = new Map(prev);
							next.set(p.localId, p);
							return next;
						});
					},
					uploadControllers.current,
					{
						onItemStart: (item) => {
							// Eagerly add a placeholder row so the progress bar
							// has something to render against. The placeholder
							// uses an empty uploadId; it's replaced when the
							// upload finishes.
							setAttachments((current) => [
								...current,
								{
									localId: item.localId,
									kind: "r2-staged",
									uploadId: "",
									filename: item.filename,
									type: item.type,
									size: item.size,
									disposition: "attachment",
								},
							]);
						},
						onItemFailed: (localId) => {
							setAttachments((current) =>
								current.filter((a) => a.localId !== localId),
							);
						},
					},
				);
				if (newItems.length > 0) {
					// Replace placeholder rows (matched by localId) with the
					// confirmed items that now carry real uploadIds.
					setAttachments((current) => {
						const byLocalId = new Map(
							newItems.map((item) => [item.localId, item]),
						);
						return current.map((existing) =>
							byLocalId.get(existing.localId) ?? existing,
						);
					});
				}
				if (newItems.length < totalIncoming) {
					toastManager.add({
						title: "Some files failed to upload.",
						variant: "error",
					});
				}
			} finally {
				setIsAddingAttachments(false);
			}
		},
		[mailboxId, toastManager],
	);

	const cancelUpload = useCallback((localId: string) => {
		uploadControllers.current.get(localId)?.abort();
		// The abort will trigger `onItemFailed`, which strips the placeholder
		// row from `attachments`. Clear progress here too so the row vanishes
		// cleanly even in the rare case where abort and rejection race.
		setAttachmentProgress((prev) => {
			if (!prev.has(localId)) return prev;
			const next = new Map(prev);
			next.delete(localId);
			return next;
		});
		setAttachments((current) =>
			current.filter((a) => a.localId !== localId),
		);
	}, []);

	const removeAttachment = (localId: string) => {
		setAttachments((current) =>
			current.filter((attachment) => attachment.localId !== localId),
		);
		setAttachmentProgress((prev) => {
			if (!prev.has(localId)) return prev;
			const next = new Map(prev);
			next.delete(localId);
			return next;
		});
	};

	const handleSaveDraft = async () => {
		if (!mailboxId || isSending) return;
		if (isAddingAttachments) {
			setError("Wait for attachments to finish loading.");
			return;
		}
		setIsSavingDraft(true);
		setError(null);
		try {
			const finalBody = appendSignature(body, sigBlock);
			const savedDraft = await saveDraftMutation.mutateAsync({ mailboxId, draft: {
				to,
				cc: cc || undefined,
				bcc: bcc || undefined,
				subject,
				body: finalBody,
				attachments: serializeComposeAttachments(attachments),
				in_reply_to: composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to || undefined,
				thread_id: composeOptions.originalEmail?.thread_id || composeOptions.draftEmail?.thread_id || undefined,
				draft_id: draftId,
			} });
			setDraftId(savedDraft.id);
			toastManager.add({ title: "Draft saved!" });
		}
		catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to save draft.";
			setError(message);
			toastManager.add({ title: message, variant: "error" });
		}
		finally { setIsSavingDraft(false); }
	};

	const handleSend = async (e: FormEvent, onClose: () => void) => {
		e.preventDefault();
		if (isSending) return;
		setError(null);
		if (!currentMailbox || !mailboxId) { setError("No mailbox selected."); return; }
		if (isAddingAttachments) { setError("Wait for attachments to finish loading."); return; }
		const toRecipients = splitEmailList(to);
		if (toRecipients.length === 0) { setError("Add at least one recipient."); return; }
		const ccRecipients = splitEmailList(cc); const bccRecipients = splitEmailList(bcc);
		const fromName = currentMailbox.settings?.fromName || currentMailbox.name;
		const from = fromName && fromName !== currentMailbox.email ? { email: currentMailbox.email, name: fromName } : currentMailbox.email;
		const finalBody = appendSignature(body, sigBlock);
		const emailData = {
			to: toEmailListValue(toRecipients),
			cc: toEmailListValue(ccRecipients),
			bcc: toEmailListValue(bccRecipients),
			from,
			subject,
			html: finalBody,
			text: htmlToPlainText(finalBody),
			attachments: serializeComposeAttachments(attachments),
		};
		const mode = composeOptions.mode; const originalId = composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to;
		setIsSending(true); toastManager.add({ title: "Sending email..." });
		try {
			if ((mode === "reply" || mode === "reply-all") && originalId) await replyMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else if (mode === "forward" && originalId) await forwardMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else await sendEmailMutation.mutateAsync({ mailboxId, email: emailData });
			if (draftId) deleteEmailMutation.mutate({ mailboxId, id: draftId });
			toastManager.add({ title: "Email sent!" });
			onClose();
		} catch (err: unknown) { const message = (err instanceof Error ? err.message : null) || "Failed to send email."; setError(message); toastManager.add({ title: message, variant: "error" }); }
		finally { setIsSending(false); }
	};

	return {
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
		attachmentProgress,
		isAddingAttachments,
		addAttachments,
		cancelUpload,
		removeAttachment,
		error,
		setError,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
		closeCompose,
		closePanel,
		sigBlock,
	};
}
