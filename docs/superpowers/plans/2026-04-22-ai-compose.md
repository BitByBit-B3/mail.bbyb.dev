# AI Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ✨ "Write with AI" button to the email composer that generates draft content via Workers AI (Kimi), with a streaming response and a "Refine" bar for iteration.

**Architecture:** A new `POST /api/v1/mailboxes/:mailboxId/ai-compose` endpoint streams text from Workers AI. The frontend reads the stream and updates the Tiptap editor directly (via a ref) to avoid re-render cascade. The ComposePanel owns AI state; RichTextEditor receives an `onAICompose` callback and `isGenerating` flag. Mode A (subject/recipient present) auto-drafts immediately; Mode B (blank composer) shows a prompt popover first.

**Tech Stack:** Workers AI (`env.AI` binding, Kimi k2 model), Hono streaming response, Tiptap `editor.commands.setContent()`, React `useRef`, Kumo `Button`/`Input`, `@phosphor-icons/react` `SparkleIcon`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `workers/lib/ai.ts` | **Modify** | Add `generateEmailDraft()` streaming helper |
| `workers/index.ts` | **Modify** | Add `POST /api/v1/mailboxes/:mailboxId/ai-compose` route |
| `app/components/RichTextEditor.tsx` | **Modify** | Add ✨ toolbar button, `onAICompose` prop, `editorRef` prop, `isGenerating` prop |
| `app/components/ComposePanel.tsx` | **Modify** | Own AI state, streaming logic, refine bar, prompt popover |

---

## Task 1: Backend — generateEmailDraft helper

**Files:**
- Modify: `workers/lib/ai.ts`

- [ ] **Step 1: Add generateEmailDraft to workers/lib/ai.ts**

Add this function at the bottom of `workers/lib/ai.ts`, after the existing `verifyDraft` function:

```ts
// ── Email Draft Generator ──────────────────────────────────────────

export interface DraftOpts {
  prompt?: string;
  subject?: string;
  to?: string;
  existing?: string;
}

export async function generateEmailDraft(
  ai: Ai,
  opts: DraftOpts,
): Promise<ReadableStream<Uint8Array>> {
  const { prompt, subject, to, existing } = opts;

  const systemPrompt =
    "You are an email drafting assistant for B3 Internal Mail.\n" +
    "Write professional, concise email body content only — no subject line, no greeting/sign-off unless asked.\n" +
    "Return plain text. Do not wrap in markdown.";

  const userPrompt = prompt
    ? existing
      ? `Refine this email draft: "${existing}"\n\nInstruction: ${prompt}`
      : prompt
    : `Write an email${to ? ` to ${to}` : ""}${subject ? ` about: ${subject}` : ""}. Be professional and concise.`;

  const response = (await ai.run(
    // @ts-expect-error — model string not in generated union
    "@cf/moonshot/kimi-k2-5-chat-long-context",
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: true,
    },
  )) as ReadableStream<Uint8Array>;

  return response;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors (the `@ts-expect-error` suppresses the model string complaint).

- [ ] **Step 3: Commit**

```bash
git add workers/lib/ai.ts
git commit -m "feat: add generateEmailDraft streaming helper to workers/lib/ai.ts"
```

---

## Task 2: Backend — ai-compose route

**Files:**
- Modify: `workers/index.ts`

- [ ] **Step 1: Add import at the top of workers/index.ts**

Find the existing import from `./lib/ai`:

```ts
// (there may not be one yet — add it)
import { generateEmailDraft } from "./lib/ai";
```

If `./lib/ai` is not yet imported in `workers/index.ts`, add this import after the other lib imports (around line 18).

- [ ] **Step 2: Add the Zod schema and route**

Add this block just before the `receiveEmail` function at the bottom of `workers/index.ts`:

```ts
// -- AI Compose -----------------------------------------------------

const AIComposeBody = z.object({
  prompt: z.string().optional(),
  subject: z.string().optional(),
  to: z.string().optional(),
  existing: z.string().optional(),
});

app.post("/api/v1/mailboxes/:mailboxId/ai-compose", async (c: AppContext) => {
  const body = AIComposeBody.parse(await c.req.json());

  let rawStream: ReadableStream<Uint8Array>;
  try {
    rawStream = await generateEmailDraft(c.env.AI, body);
  } catch {
    return c.json({ error: "Failed to start AI generation" }, 500);
  }

  // Workers AI streams SSE: `data: {"response":"chunk"}\n\n`
  // Transform to a plain UTF-8 text stream for the frontend.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  async function pump() {
    const reader = rawStream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Process complete SSE lines
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as { response?: string };
            if (parsed.response) {
              await writer.write(encoder.encode(parsed.response));
            }
          } catch {
            // Malformed SSE chunk — skip
          }
        }
      }
    } finally {
      await writer.close().catch(() => {});
    }
  }

  c.executionCtx.waitUntil(pump());

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add workers/index.ts
git commit -m "feat: add POST /api/v1/mailboxes/:mailboxId/ai-compose streaming route"
```

---

## Task 3: RichTextEditor — ✨ button and new props

**Files:**
- Modify: `app/components/RichTextEditor.tsx`

- [ ] **Step 1: Add new imports**

At the top of `app/components/RichTextEditor.tsx`, add to the existing phosphor import:

```ts
import { SparkleIcon } from "@phosphor-icons/react";
import { Loader } from "@cloudflare/kumo";
import type { Editor } from "@tiptap/react";
```

(`Loader` and `Tooltip`, `Button` are already imported from kumo and phosphor.)

- [ ] **Step 2: Extend RichTextEditorProps**

Replace the existing interface:

```ts
interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onAICompose?: () => void;
  isGenerating?: boolean;
  editorRef?: React.MutableRefObject<Editor | null>;
}
```

- [ ] **Step 3: Wire editorRef in component body**

After the `useEditor(...)` call, add:

```ts
useEffect(() => {
  if (editorRef && editor) {
    editorRef.current = editor;
  }
}, [editor, editorRef]);
```

- [ ] **Step 4: Add ✨ button to the toolbar**

In the toolbar `<div>`, after the Redo button block and its preceding divider, add:

```tsx
<div className="mx-1 h-5 w-px bg-kumo-fill" />

{onAICompose && (
  <Tooltip content={isGenerating ? "Generating…" : "Write with AI"} side="bottom" asChild>
    <Button
      variant="ghost"
      shape="square"
      size="sm"
      icon={
        isGenerating ? (
          <Loader size="base" />
        ) : (
          <SparkleIcon size={16} weight="fill" />
        )
      }
      onClick={onAICompose}
      disabled={isGenerating}
      aria-label="Write with AI"
    />
  </Tooltip>
)}
```

- [ ] **Step 5: Pass new props through**

Update the component signature:

```ts
export default function RichTextEditor({
  value,
  onChange,
  onAICompose,
  isGenerating,
  editorRef,
}: RichTextEditorProps) {
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/components/RichTextEditor.tsx
git commit -m "feat: add AI compose button to RichTextEditor toolbar"
```

---

## Task 4: ComposePanel — AI state, streaming, refine bar, prompt popover

**Files:**
- Modify: `app/components/ComposePanel.tsx`

This is the main integration task. Replace the entire file:

- [ ] **Step 1: Write the new ComposePanel.tsx**

```tsx
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Input } from "@cloudflare/kumo";
import {
  FloppyDiskIcon,
  PaperPlaneTiltIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Editor } from "@tiptap/react";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import { useKumoToastManager } from "@cloudflare/kumo";
import { useComposeForm } from "~/hooks/useComposeForm";
import RichTextEditor from "./RichTextEditor";

export default function ComposePanel() {
  const { mailboxId, folder } = useParams<{
    mailboxId: string;
    folder: string;
  }>();
  const toastManager = useKumoToastManager();

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

  // AI compose state
  const editorRef = useRef<Editor | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [showPromptPopover, setShowPromptPopover] = useState(false);
  const [promptInput, setPromptInput] = useState("");

  const runAICompose = async (opts: {
    prompt?: string;
    subject?: string;
    to?: string;
    existing?: string;
  }) => {
    if (!mailboxId) return;
    setIsGenerating(true);
    setShowPromptPopover(false);

    try {
      const res = await fetch(
        `/api/v1/mailboxes/${mailboxId}/ai-compose`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts),
        },
      );

      if (!res.ok || !res.body) {
        toastManager.add({
          title: "Couldn't generate draft, try again",
          variant: "error",
        });
        return;
      }

      // Clear editor before streaming
      setBody("");
      if (editorRef.current && !editorRef.current.isDestroyed) {
        editorRef.current.commands.setContent("");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        // Update editor directly (avoids re-render on every chunk)
        if (editorRef.current && !editorRef.current.isDestroyed) {
          editorRef.current.commands.setContent(accumulated);
        }
      }

      // Sync React state once after stream ends
      setBody(accumulated);
      setShowRefine(true);
    } catch {
      toastManager.add({
        title: "Couldn't generate draft, try again",
        variant: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAIComposeClick = () => {
    const hasContext = subject.trim() || to.trim();
    if (hasContext) {
      // Mode A: auto-draft from context
      runAICompose({ subject, to });
    } else {
      // Mode B: show prompt popover first
      setShowPromptPopover((v) => !v);
    }
  };

  const handlePromptGenerate = () => {
    if (!promptInput.trim()) return;
    runAICompose({ prompt: promptInput.trim() });
    setPromptInput("");
  };

  const handleRegenerate = () => {
    runAICompose({
      prompt: refinePrompt.trim() || undefined,
      subject,
      to,
      existing: body,
    });
    setRefinePrompt("");
  };

  return (
    <div className="flex flex-col h-full bg-kumo-base">
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

      <form
        onSubmit={(e) => handleSend(e, closePanel)}
        className="flex flex-col flex-1 min-h-0 overflow-y-auto"
      >
        <div className="p-4 md:p-6 space-y-4">
          {error && <Banner variant="error" text={error} />}

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

          <div className="relative border border-kumo-line rounded-md overflow-hidden bg-kumo-base">
            <RichTextEditor
              value={body}
              onChange={setBody}
              onAICompose={handleAIComposeClick}
              isGenerating={isGenerating}
              editorRef={editorRef}
            />

            {/* Mode B: Prompt popover */}
            {showPromptPopover && (
              <div className="absolute bottom-full left-0 right-0 z-10 mb-1 px-1">
                <div className="rounded-lg border border-kumo-line bg-kumo-base shadow-lg p-3 flex gap-2">
                  <Input
                    placeholder='What should this email be about? e.g. "Request a meeting for next week"'
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    size="sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handlePromptGenerate();
                      }
                      if (e.key === "Escape") setShowPromptPopover(false);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handlePromptGenerate}
                    disabled={!promptInput.trim()}
                  >
                    Generate
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Refine bar */}
          {showRefine && (
            <div className="flex gap-2 border-t border-kumo-line pt-2">
              <Input
                placeholder='Refine (e.g. "make it shorter", "more formal")…'
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                size="sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleRegenerate();
                  }
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                loading={isGenerating}
                onClick={handleRegenerate}
              >
                Regenerate
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="mt-auto px-4 py-3 border-t border-kumo-line bg-kumo-fill/30 shrink-0 md:px-6">
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
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/ComposePanel.tsx
git commit -m "feat: add AI compose with streaming, refine bar, and prompt popover to ComposePanel"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test Mode A (auto-draft)**

1. Open any mailbox → Compose
2. Fill in "To" and/or "Subject"
3. Click the ✨ button in the editor toolbar
4. Spinner should appear; text should stream into the editor
5. "Refine" bar should appear below the editor after generation completes
6. Type "make it shorter" in the refine field → click Regenerate
7. New shorter draft should stream in

- [ ] **Step 3: Test Mode B (blank compose)**

1. Open Compose with empty To and Subject
2. Click ✨ button
3. Popover should appear above the toolbar: "What should this email be about?"
4. Type a prompt → click Generate or press Enter
5. Draft should stream into the editor

- [ ] **Step 4: Test error handling**

1. Disconnect from internet (or block the API endpoint)
2. Click ✨ — expect toast "Couldn't generate draft, try again"
3. Editor content should be unchanged (or empty if it was a new compose)

- [ ] **Step 5: Deploy**

```bash
CLOUDFLARE_ACCOUNT_ID=<your-account-id> npm run deploy
```
