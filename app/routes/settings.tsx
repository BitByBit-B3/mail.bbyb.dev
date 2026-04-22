// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import {
  ArrowCounterClockwiseIcon,
  RobotIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import DOMPurify from "dompurify";
import { buildSignatureHtml } from "../../shared/signature";
import type { SignatureFields } from "../../shared/signature";
import {
  useDeleteAvatar,
  useMailbox,
  useUpdateMailbox,
  useUploadAvatar,
} from "~/queries/mailboxes";

const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

const EMPTY_SIG_FIELDS: SignatureFields = {
  name: "",
  title: "",
  company: "",
  tagline: "",
  phone: "",
  website: "",
  email: "",
  linkedIn: "",
};

export default function SettingsRoute() {
  const { mailboxId } = useParams<{ mailboxId: string }>();
  const toastManager = useKumoToastManager();
  const { data: mailbox } = useMailbox(mailboxId);
  const updateMailboxMutation = useUpdateMailbox();
  const uploadAvatarMutation = useUploadAvatar();
  const deleteAvatarMutation = useDeleteAvatar();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [sigFields, setSigFields] = useState<SignatureFields>(EMPTY_SIG_FIELDS);
  const [sigEnabled, setSigEnabled] = useState(false);

  const [forwardEmail, setForwardEmail] = useState("");
  const [forwardEnabled, setForwardEnabled] = useState(false);
  const [isSavingForward, setIsSavingForward] = useState(false);

  useEffect(() => {
    if (!mailbox) return;
    setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
    setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
    setSigFields({
      ...EMPTY_SIG_FIELDS,
      ...(mailbox.settings?.signatureFields || {}),
      email: mailbox.settings?.signatureFields?.email || mailbox.email || "",
    });
    setSigEnabled(mailbox.settings?.signatureEnabled ?? false);
    setForwardEmail(mailbox.settings?.forwarding?.email || "");
    setForwardEnabled(mailbox.settings?.forwarding?.enabled ?? false);
  }, [mailbox]);

  const handleSave = async () => {
    if (!mailbox || !mailboxId) return;
    setIsSaving(true);
    const settings = {
      ...mailbox.settings,
      fromName: displayName,
      agentSystemPrompt: agentPrompt.trim() || undefined,
      signatureFields: sigFields,
      signatureEnabled: sigEnabled,
    };
    try {
      await updateMailboxMutation.mutateAsync({ mailboxId, settings });
      toastManager.add({ title: "Settings saved!" });
    } catch {
      toastManager.add({ title: "Failed to save settings", variant: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveForwarding = async () => {
    if (!mailbox || !mailboxId) return;
    setIsSavingForward(true);
    const settings = {
      ...mailbox.settings,
      forwarding: { enabled: forwardEnabled, email: forwardEmail },
    };
    try {
      await updateMailboxMutation.mutateAsync({ mailboxId, settings });
      toastManager.add({ title: "Forwarding settings saved!" });
    } catch {
      toastManager.add({ title: "Failed to save forwarding settings", variant: "error" });
    } finally {
      setIsSavingForward(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !mailboxId) return;
    try {
      await uploadAvatarMutation.mutateAsync({ mailboxId, file });
      toastManager.add({ title: "Avatar updated!" });
    } catch (err) {
      toastManager.add({
        title: err instanceof Error ? err.message : "Upload failed",
        variant: "error",
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAvatarDelete = async () => {
    if (!mailboxId) return;
    try {
      await deleteAvatarMutation.mutateAsync(mailboxId);
      toastManager.add({ title: "Avatar removed" });
    } catch {
      toastManager.add({ title: "Failed to remove avatar", variant: "error" });
    }
  };

  const sigPreviewHtml =
    sigEnabled && sigFields.name
      ? DOMPurify.sanitize(buildSignatureHtml(sigFields, mailbox?.settings?.avatarUrl))
      : null;

  const isCustomPrompt = agentPrompt.trim().length > 0;

  if (!mailbox) {
    return (
      <div className="flex justify-center py-20">
        <Loader size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
      <h1 className="text-lg font-semibold text-kumo-default mb-6">Settings</h1>

      <div className="space-y-6">
        {/* Account */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-4">Account</div>
          <div className="space-y-3">
            <Input
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Input label="Email" type="email" value={mailbox.email} disabled />
          </div>
        </div>

        {/* Avatar */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-4">Profile Avatar</div>
          <div className="flex items-center gap-4">
            {mailbox.settings?.avatarUrl ? (
              <img
                src={mailbox.settings.avatarUrl}
                alt="Avatar"
                className="h-16 w-16 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-kumo-fill flex items-center justify-center text-xl font-semibold text-kumo-default shrink-0">
                {displayName.charAt(0).toUpperCase() || "?"}
              </div>
            )}
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<UploadSimpleIcon size={14} />}
                loading={uploadAvatarMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {mailbox.settings?.avatarUrl ? "Change Avatar" : "Upload Avatar"}
              </Button>
              {mailbox.settings?.avatarUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<TrashIcon size={14} />}
                  loading={deleteAvatarMutation.isPending}
                  onClick={handleAvatarDelete}
                >
                  Remove
                </Button>
              )}
              <p className="text-xs text-kumo-subtle">JPEG, PNG or WebP · max 2 MB</p>
            </div>
          </div>
        </div>

        {/* Signature */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-1">Email Signature</div>
          <p className="text-xs text-kumo-subtle mb-4">
            Appended to emails you compose. Rendered from your profile info.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Name *"
                placeholder="Jane Smith"
                value={sigFields.name}
                onChange={(e) => setSigFields({ ...sigFields, name: e.target.value })}
              />
              <Input
                label="Title"
                placeholder="Software Engineer"
                value={sigFields.title || ""}
                onChange={(e) => setSigFields({ ...sigFields, title: e.target.value })}
              />
              <Input
                label="Company"
                placeholder="BitByBit"
                value={sigFields.company || ""}
                onChange={(e) => setSigFields({ ...sigFields, company: e.target.value })}
              />
              <Input
                label="Tagline"
                placeholder="Building something great"
                value={sigFields.tagline || ""}
                onChange={(e) => setSigFields({ ...sigFields, tagline: e.target.value })}
              />
              <Input
                label="Phone"
                type="tel"
                placeholder="+1 234 567 8900"
                value={sigFields.phone || ""}
                onChange={(e) => setSigFields({ ...sigFields, phone: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                placeholder="you@bbyb.dev"
                value={sigFields.email || ""}
                onChange={(e) => setSigFields({ ...sigFields, email: e.target.value })}
              />
              <Input
                label="Website"
                placeholder="https://bitbybit.dev"
                value={sigFields.website || ""}
                onChange={(e) => setSigFields({ ...sigFields, website: e.target.value })}
              />
              <Input
                label="LinkedIn URL"
                placeholder="https://linkedin.com/in/..."
                value={sigFields.linkedIn || ""}
                onChange={(e) => setSigFields({ ...sigFields, linkedIn: e.target.value })}
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={sigEnabled}
                onChange={(e) => setSigEnabled(e.target.checked)}
                className="rounded border-kumo-line"
              />
              <span className="text-sm text-kumo-default">
                Include signature in outgoing emails
              </span>
            </label>

            {sigPreviewHtml && (
              <div>
                <div className="text-xs font-medium text-kumo-subtle mb-2">Preview</div>
                <div
                  className="border border-kumo-line rounded-md p-4 bg-kumo-recessed text-kumo-default"
                  dangerouslySetInnerHTML={{ __html: sigPreviewHtml }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Forwarding */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-1">Email Forwarding</div>
          <p className="text-xs text-kumo-subtle mb-4">
            Forward a copy of every inbound email to an external address.
          </p>
          <div className="space-y-3">
            <Input
              label="Forward incoming emails to"
              type="email"
              placeholder="you@gmail.com"
              value={forwardEmail}
              onChange={(e) => setForwardEmail(e.target.value)}
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={forwardEnabled}
                onChange={(e) => setForwardEnabled(e.target.checked)}
                disabled={!forwardEmail.trim()}
                className="rounded border-kumo-line"
              />
              <span className="text-sm text-kumo-default">Enable forwarding</span>
            </label>
            {forwardEnabled && forwardEmail && (
              <p className="text-xs text-kumo-subtle">
                Forwarding active →{" "}
                <strong className="text-kumo-default">{forwardEmail}</strong>
              </p>
            )}
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                loading={isSavingForward}
                onClick={handleSaveForwarding}
              >
                Save Forwarding
              </Button>
            </div>
          </div>
        </div>

        {/* Agent System Prompt */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <RobotIcon size={16} weight="duotone" className="text-kumo-subtle" />
              <span className="text-sm font-medium text-kumo-default">AI Agent Prompt</span>
              {isCustomPrompt ? (
                <Badge variant="primary">Custom</Badge>
              ) : (
                <Badge variant="secondary">Default</Badge>
              )}
            </div>
            {isCustomPrompt && (
              <Button
                variant="ghost"
                size="xs"
                icon={<ArrowCounterClockwiseIcon size={14} />}
                onClick={() => setAgentPrompt("")}
              >
                Reset to default
              </Button>
            )}
          </div>
          <p className="text-xs text-kumo-subtle mb-3">
            Customize how the AI agent behaves for this mailbox. Leave empty to use the
            built-in default prompt.
          </p>
          <textarea
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            placeholder={PROMPT_PLACEHOLDER}
            rows={12}
            className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
          />
        </div>

        {/* Save (account + signature + agent prompt) */}
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={isSaving}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
