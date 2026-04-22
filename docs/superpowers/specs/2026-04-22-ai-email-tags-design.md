# B3 Mail — AI Email Tags Design Spec

## Goal

When a custom folder is created with an optional natural-language "filter prompt", incoming emails are automatically classified by AI and tagged with matching folder names. Tags appear as clickable pills on email rows; clicking filters the list to show only tagged emails.

## What Changes vs What Stays

### Changes
- `folders` SQLite table: add `filter_prompt TEXT` nullable column
- `emails` SQLite table: add `tags TEXT` column (JSON array of folder IDs, default `'[]'`)
- `workers/lib/ai.ts`: new `classifyEmailTags()` function
- `workers/index.ts`: call classifier in `receiveEmail`; update folder create/update routes; add `?tag=` filter to email list route
- `app/components/Sidebar.tsx`: add filter prompt textarea to create folder dialog
- `app/routes/email-list.tsx`: render tag pills on rows; handle `?tag=` URL param
- `app/queries/folders.ts`: pass `filter_prompt` in create/update mutations
- `app/types/index.ts`: add `filter_prompt` to `Folder` type, `tags` to `Email` type

### Stays the same
- Email routing and storage logic
- Folder navigation and display
- Existing folder CRUD (just extended with new optional field)
- All React Query hooks structure

---

## Data Layer

### folders table — new column

```sql
ALTER TABLE folders ADD COLUMN filter_prompt TEXT;
```

Nullable — folders without a prompt are never used for classification and never produce tags.

### emails table — new column

```sql
ALTER TABLE emails ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
```

Stores a JSON array of folder IDs that matched this email, e.g. `'["nisalvila","clients"]'`. Empty array `'[]'` means no tags.

---

## AI Classification

### Function: `classifyEmailTags`

**File:** `workers/lib/ai.ts`

```typescript
export async function classifyEmailTags(
  ai: Ai,
  email: { subject: string; sender: string; bodyText: string },
  folders: Array<{ id: string; name: string; filter_prompt: string }>,
): Promise<string[]>
```

- Model: `@cf/meta/llama-3.1-8b-instruct-fast` (fast, cheap — classification only)
- Prompt: structured JSON request asking which folder IDs match the email
- Returns array of matching folder IDs (subset of input folder IDs)
- On any error (model failure, parse failure): returns `[]` — never throws, never blocks email delivery

**Prompt structure:**
```
You are an email classifier. Given an email and a list of categories, return a JSON array of category IDs that apply to this email. Return only the JSON array, nothing else.

Email:
- From: {sender}
- Subject: {subject}
- Body (first 500 chars): {bodyText}

Categories:
{id: "nisalvila", name: "Nisalvila", filter: "Emails related to the Nisalvila project"}
...

Respond with ONLY a JSON array of matching IDs, e.g. ["nisalvila"] or [].
```

### Integration in `receiveEmail`

After the email record is created in the database, and before returning:

1. Fetch all folders for the mailbox that have a non-null `filter_prompt`
2. If none → skip (no AI call)
3. Strip HTML from email body to plain text (reuse `stripHtmlToText`)
4. Call `classifyEmailTags(env.AI, { subject, sender, bodyText }, foldersWithPrompts)`
5. If result is non-empty → `UPDATE emails SET tags = ? WHERE id = ?` with JSON stringified array
6. Run classification via `ctx.waitUntil()` so it never delays email delivery

---

## API Changes

### Folder create route

`POST /api/v1/mailboxes/:mailboxId/folders`

Body extended to accept optional `filter_prompt`:
```typescript
{ name: string; filter_prompt?: string }
```

### Folder update route

`PUT /api/v1/mailboxes/:mailboxId/folders/:folderId`

Body extended:
```typescript
{ name?: string; filter_prompt?: string }
```

### Email list route

`GET /api/v1/mailboxes/:mailboxId/emails?folder=inbox&tag=nisalvila`

New optional `tag` query param. When present, adds `AND JSON_EXTRACT(tags, '$') LIKE '%"nisalvila"%'` to the SQL WHERE clause (or uses `json_each` for proper JSON array membership check).

### Email response

`Folder` type gains `filter_prompt?: string | null`.
`Email` type gains `tags: string[]` (parsed from JSON before sending response).

---

## Frontend

### Folder creation dialog (Sidebar)

Add below the folder name input:

```
[Folder name input]

[AI Filter Prompt — optional]
textarea placeholder: "e.g. Emails about the Nisalvila project, from the Nisalvila team, or mentioning Nisalvila"
helper text: "AI will automatically tag matching emails when they arrive."
```

Only shown/sent if non-empty. No prompt = no classification for that folder.

### Email rows — tag pills

In the email list row's right column (currently shows date + hover actions), tag pills appear **above** the date when `email.tags.length > 0`:

```
[Nisalvila] [clients]    9:01 AM
```

Each pill:
- `text-[10px] font-medium px-1.5 py-0.5 rounded-full`
- Background: `bg-kumo-fill`, text: `text-kumo-default`
- `cursor-pointer` — clicking navigates to same folder + `?tag=<folderId>`
- Max 2 pills shown; if more, show `+N`

### Tag filtering

When `?tag=<folderId>` is in the URL:
- Email list passes `tag` param to the API query
- A small filter indicator appears in the folder header: `Inbox · tagged: Nisalvila [×]`
- Clicking `×` removes the `?tag=` param

---

## Responsive Behaviour

Tags show on all screen sizes. On mobile (compact), only the first tag pill shows to avoid overflow.

---

## Error Handling

- Classification failure → email stored with `tags = []`, delivery unaffected
- Malformed JSON in `tags` column → treated as empty array on read
- Missing `filter_prompt` on existing folders → no migration needed (nullable column, default null)

---

## Non-Goals

- Moving emails to folders based on tags (tags are display-only)
- Retroactive re-tagging of existing emails
- Manual tag assignment by user
- Tag management UI (tags are derived entirely from folder prompts)
- Spam/system folder classification
