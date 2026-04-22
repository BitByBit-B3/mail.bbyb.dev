# AI Compose — Design Spec

**Date:** 2026-04-22  
**Status:** Approved  
**Feature:** "Write with AI" magic wand button in email composer

---

## Overview

A magic wand (✨) button in the compose toolbar that generates email body content using Workers AI (Kimi). Two modes: auto-draft from subject/recipient context when available, or prompt-first when the composer is blank. A "Refine" bar lets the user iterate on the draft without reopening a modal.

---

## User Flow

### Mode A — Auto-draft (subject or recipient filled)
1. User opens compose, fills in recipient and/or subject
2. Clicks ✨ button in toolbar
3. Spinner appears in editor area
4. Draft inserts into editor immediately
5. "Refine" bar appears below editor: `[________________] [Regenerate]`
6. User edits the draft directly or types a refinement prompt and hits Regenerate

### Mode B — Prompt-first (composer is blank)
1. User opens compose with empty subject + recipient
2. Clicks ✨ button
3. Small popover appears above the toolbar: `"What should this email be about?" [________________] [Generate]`
4. User types prompt, hits Generate
5. Draft inserts into editor
6. "Refine" bar appears (same as Mode A step 5)

Both modes use the same API endpoint and streaming response.

---

## Backend

### New endpoint: `POST /api/mailboxes/:mailboxId/ai-compose`

**Request:**
```ts
{
  prompt?: string;   // explicit user prompt (Mode B or refinement)
  subject?: string;  // from compose form
  to?: string;       // recipient address
  existing?: string; // current editor content (for refinements)
}
```

**System prompt sent to Kimi:**
```
You are an email drafting assistant for B3 Internal Mail.
Write professional, concise email body content only — no subject line, no greeting/sign-off unless asked.
Return plain text. Do not wrap in markdown.
```

**User prompt construction:**
```ts
const userPrompt = prompt
  ? existing
    ? `Refine this email draft: "${existing}"\n\nInstruction: ${prompt}`
    : prompt
  : `Write an email${to ? ` to ${to}` : ""}${subject ? ` about: ${subject}` : ""}. Be professional and concise.`;
```

**Response:** Streaming text via `ReadableStream` (Workers AI supports streaming). Returns `Content-Type: text/plain; charset=utf-8`.

**Location:** New route in `workers/index.ts` under the existing API router.

---

## Frontend

### `app/components/RichTextEditor.tsx`

Add a `SparkleIcon` (✨) button to the existing toolbar. Positioned after the existing formatting buttons, separated by a divider.

Props added to `RichTextEditor`:
```ts
onAICompose?: (opts: { subject?: string; to?: string }) => void;
```

### `app/components/ComposePanel.tsx` (or `app/hooks/useComposeForm.ts`)

Owns the AI compose state:

```ts
const [isGenerating, setIsGenerating] = useState(false);
const [refinePrompt, setRefinePrompt] = useState("");
const [showRefine, setShowRefine] = useState(false);
```

**`aiCompose(opts)` function:**
1. Sets `isGenerating = true`
2. Fetches `POST /api/mailboxes/:id/ai-compose` with streaming
3. Reads stream chunks, appends to editor content via Tiptap's `editor.commands.setContent()`
4. On complete: `isGenerating = false`, `showRefine = true`

**Refine bar** (shown below editor when `showRefine`):
```tsx
<div className="flex gap-2 px-3 py-2 border-t border-kumo-line">
  <input
    placeholder="Refine (e.g. make it shorter, more formal)..."
    value={refinePrompt}
    onChange={...}
    className="flex-1 text-sm ..."
  />
  <Button size="sm" onClick={() => aiCompose({ prompt: refinePrompt, existing: editorContent })}>
    Regenerate
  </Button>
</div>
```

---

## Files Modified

| File | Change |
|---|---|
| `workers/index.ts` | New `POST /api/mailboxes/:id/ai-compose` route |
| `workers/lib/ai.ts` | `generateEmailDraft(env, opts)` helper using Workers AI streaming |
| `app/components/RichTextEditor.tsx` | Add ✨ toolbar button + `onAICompose` prop |
| `app/components/ComposePanel.tsx` | Wire AI compose state, refine bar, streaming insert |
| `app/queries/mailboxes.ts` | `useAICompose` hook (fetch wrapper) |

---

## Error Handling

- AI call fails → toast "Couldn't generate draft, try again" — editor content unchanged
- Streaming interrupted mid-way → keep partial content in editor, show toast
- Workers AI rate limit → same toast treatment

---

## Out of Scope

- Tone selector (formal / casual / friendly)
- Template library
- AI-powered subject line generation
- Reply drafting (existing `draft_reply` agent tool handles this)
