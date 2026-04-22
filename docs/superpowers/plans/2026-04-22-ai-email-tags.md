# AI Email Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a custom folder has a natural-language `filter_prompt`, incoming emails are automatically classified by AI and tagged with matching folder IDs. Tags appear as clickable pills on email rows; clicking filters the list via `?tag=<folderId>`.

**Architecture:** SQLite migrations add `filter_prompt` to folders and `tags` (JSON array) to emails. On email ingest, `ctx.waitUntil()` fires `classifyEmailTags()` against Workers AI — failure never blocks delivery. Frontend shows tag pills on rows and a filter indicator in the folder header when `?tag=` is in the URL.

**Tech Stack:** Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`), Drizzle ORM (DO SQLite), React Router v7, TanStack Query, Cloudflare Kumo design system.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `workers/db/schema.ts` | Modify | Add `filter_prompt` to folders table; add `tags` to emails table |
| `workers/durableObject/migrations.ts` | Modify | Add migration #9 with both new columns |
| `workers/durableObject/index.ts` | Modify | Update `createFolder`, `updateFolder`, `getFolders` for `filter_prompt`; add `getFoldersWithPrompts()` and `setEmailTags()` |
| `workers/lib/ai.ts` | Modify | Add `classifyEmailTags()` function |
| `workers/index.ts` | Modify | Folder create/update body; `?tag=` in email list; call classifier in `receiveEmail` |
| `app/types/index.ts` | Modify | `filter_prompt?: string \| null` on `Folder`; `tags?: string[]` on `Email` |
| `app/services/api.ts` | Modify | `createFolder` and `updateFolder` accept `filter_prompt` |
| `app/queries/folders.ts` | Modify | `useCreateFolder` and `useUpdateFolder` mutations pass `filter_prompt` |
| `app/components/Sidebar.tsx` | Modify | Add AI filter prompt textarea to create-folder dialog |
| `app/routes/email-list.tsx` | Modify | Tag pills on rows; `?tag=` param; filter indicator in header |

---

### Task 1: Schema + Migrations

**Files:**
- Modify: `workers/db/schema.ts`
- Modify: `workers/durableObject/migrations.ts`

- [ ] **Step 1: Update Drizzle schema**

In `workers/db/schema.ts`, add the two new columns:

```typescript
export const folders = sqliteTable("folders", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	is_deletable: integer("is_deletable").notNull().default(1),
	filter_prompt: text("filter_prompt"),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	folder_id: text("folder_id")
		.notNull()
		.references(() => folders.id, { onDelete: "cascade" }),
	subject: text("subject"),
	sender: text("sender"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	date: text("date"),
	read: integer("read").default(0),
	starred: integer("starred").default(0),
	body: text("body"),
	in_reply_to: text("in_reply_to"),
	email_references: text("email_references"),
	thread_id: text("thread_id"),
	message_id: text("message_id"),
	raw_headers: text("raw_headers"),
	tags: text("tags").notNull().default("[]"),
});
```

- [ ] **Step 2: Add migration #9**

In `workers/durableObject/migrations.ts`, append to the `mailboxMigrations` array (after the existing `8_add_folder_date_indexes` entry):

```typescript
{
	name: "9_add_ai_tags",
	sql: txn(`
		ALTER TABLE folders ADD COLUMN filter_prompt TEXT;
		ALTER TABLE emails ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
	`),
},
```

- [ ] **Step 3: Verify typecheck passes**

```bash
npm run typecheck
```
Expected: no errors related to schema.

- [ ] **Step 4: Commit**

```bash
git add workers/db/schema.ts workers/durableObject/migrations.ts
git commit -m "feat: add filter_prompt and tags columns (migration #9)"
```

---

### Task 2: AI Classifier

**Files:**
- Modify: `workers/lib/ai.ts`

- [ ] **Step 1: Add `classifyEmailTags` function**

Append after the existing exports in `workers/lib/ai.ts`:

```typescript
// ── Email Tag Classifier ───────────────────────────────────────────

const CLASSIFIER_PROMPT = `You are an email classifier. Given an email and a list of categories, return a JSON array of category IDs that apply to this email. Return ONLY the JSON array, nothing else.`;

export async function classifyEmailTags(
	ai: Ai,
	email: { subject: string; sender: string; bodyText: string },
	folders: Array<{ id: string; name: string; filter_prompt: string }>,
): Promise<string[]> {
	if (folders.length === 0) return [];

	const categoriesText = folders
		.map((f) => `{id: "${f.id}", name: "${f.name}", filter: "${f.filter_prompt}"}`)
		.join("\n");

	const userMessage =
		`Email:\n` +
		`- From: ${email.sender}\n` +
		`- Subject: ${email.subject}\n` +
		`- Body (first 500 chars): ${email.bodyText.slice(0, 500)}\n\n` +
		`Categories:\n${categoriesText}\n\n` +
		`Respond with ONLY a JSON array of matching IDs, e.g. ["folder-id"] or [].`;

	try {
		const response = (await ai.run(
			// @ts-expect-error — model string not in generated union
			"@cf/meta/llama-3.1-8b-instruct-fast",
			{
				messages: [
					{ role: "system", content: CLASSIFIER_PROMPT },
					{ role: "user", content: userMessage },
				],
				max_tokens: 200,
				temperature: 0,
			},
		)) as { response?: string };

		const raw = (response?.response || "[]").trim();
		const match = raw.match(/\[[\s\S]*\]/);
		if (!match) return [];
		const parsed = JSON.parse(match[0]);
		if (!Array.isArray(parsed)) return [];
		const validIds = new Set(folders.map((f) => f.id));
		return parsed.filter((id): id is string => typeof id === "string" && validIds.has(id));
	} catch {
		return [];
	}
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workers/lib/ai.ts
git commit -m "feat: add classifyEmailTags AI function"
```

---

### Task 3: MailboxDO — Update folder CRUD + add tag helpers

**Files:**
- Modify: `workers/durableObject/index.ts`

- [ ] **Step 1: Update `GetEmailsOptions` to include tag filter**

In `workers/durableObject/index.ts`, find the `GetEmailsOptions` interface (line ~65) and add the `tag` field:

```typescript
interface GetEmailsOptions {
	folder?: string;
	thread_id?: string;
	page?: number;
	limit?: number;
	sortColumn?: SortColumn;
	sortDirection?: "ASC" | "DESC";
	tag?: string;
}
```

- [ ] **Step 2: Update `getFolders` to return `filter_prompt`**

Find the `getFolders` method (~line 575). Replace the select with:

```typescript
async getFolders() {
	const result = this.db
		.select({
			id: schema.folders.id,
			name: schema.folders.name,
			filter_prompt: schema.folders.filter_prompt,
			unreadCount: sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(Number),
		})
		.from(schema.folders)
		.leftJoin(schema.emails, eq(schema.emails.folder_id, schema.folders.id))
		.groupBy(schema.folders.id, schema.folders.name, schema.folders.filter_prompt)
		.all();
	return result;
}
```

- [ ] **Step 3: Update `createFolder` to accept `filter_prompt`**

Find `createFolder` (~line 589). Update the signature and insert:

```typescript
async createFolder(id: string, name: string, is_deletable: number = 1, filter_prompt?: string | null) {
	try {
		const result = this.db
			.insert(schema.folders)
			.values({ id, name, is_deletable, filter_prompt: filter_prompt ?? null })
			.returning({ id: schema.folders.id, name: schema.folders.name, filter_prompt: schema.folders.filter_prompt })
			.get();
		return { ...result, unreadCount: 0 };
	} catch (e: unknown) {
		if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
			return null;
		}
		throw e;
	}
}
```

- [ ] **Step 4: Update `updateFolder` to accept `filter_prompt`**

Find `updateFolder` (~line 605). Update signature and set:

```typescript
async updateFolder(id: string, name: string, filter_prompt?: string | null) {
	const updates: { name: string; filter_prompt?: string | null } = { name };
	if (filter_prompt !== undefined) {
		updates.filter_prompt = filter_prompt;
	}
	const result = this.db
		.update(schema.folders)
		.set(updates)
		.where(eq(schema.folders.id, id))
		.returning({ id: schema.folders.id, name: schema.folders.name, filter_prompt: schema.folders.filter_prompt })
		.get();
	return result;
}
```

- [ ] **Step 5: Add `getFoldersWithPrompts` method**

After `updateFolder`, add:

```typescript
async getFoldersWithPrompts(): Promise<Array<{ id: string; name: string; filter_prompt: string }>> {
	const rows = this.ctx.storage.sql.exec(
		`SELECT id, name, filter_prompt FROM folders WHERE filter_prompt IS NOT NULL AND filter_prompt != ''`,
	);
	return [...rows].map((r: any) => ({
		id: String(r.id),
		name: String(r.name),
		filter_prompt: String(r.filter_prompt),
	}));
}
```

- [ ] **Step 6: Add `setEmailTags` method**

After `getFoldersWithPrompts`, add:

```typescript
async setEmailTags(emailId: string, tags: string[]): Promise<void> {
	this.ctx.storage.sql.exec(
		`UPDATE emails SET tags = ?1 WHERE id = ?2`,
		JSON.stringify(tags),
		emailId,
	);
}
```

- [ ] **Step 7: Update `getEmails` to support `?tag=` filter and include `tags` in result**

Find the `getEmails` method. Update the select and conditions:

In the select block, add `tags: schema.emails.tags` to the list of selected fields:

```typescript
const result = this.db
	.select({
		id: schema.emails.id,
		subject: schema.emails.subject,
		sender: schema.emails.sender,
		recipient: schema.emails.recipient,
		cc: schema.emails.cc,
		bcc: schema.emails.bcc,
		date: schema.emails.date,
		read: schema.emails.read,
		starred: schema.emails.starred,
		in_reply_to: schema.emails.in_reply_to,
		email_references: schema.emails.email_references,
		thread_id: schema.emails.thread_id,
		folder_id: schema.emails.folder_id,
		tags: schema.emails.tags,
		snippet: sql<string>`SUBSTR(${schema.emails.body}, 1, 300)`,
	})
```

Add the tag condition in the conditions array building block. Find where `folder` and `thread_id` conditions are added, and add:

```typescript
const { tag } = options;
// ...existing conditions for folder and thread_id...
if (tag) {
	conditions.push(
		sql`EXISTS (SELECT 1 FROM json_each(${schema.emails.tags}) WHERE value = ${tag})`,
	);
}
```

In the return `.map()`, parse tags from JSON:

```typescript
return result.map((email) => ({
	...email,
	read: !!email.read,
	starred: !!email.starred,
	tags: (() => { try { return JSON.parse(email.tags || "[]"); } catch { return []; } })(),
}));
```

- [ ] **Step 8: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add workers/durableObject/index.ts
git commit -m "feat: update MailboxDO for filter_prompt, tags, and tag-based filtering"
```

---

### Task 4: API Routes — folder CRUD + email list + receiveEmail

**Files:**
- Modify: `workers/index.ts`

- [ ] **Step 1: Update folder create route**

Find the `POST /api/v1/mailboxes/:mailboxId/folders` handler (~line 376):

```typescript
app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const body = (await c.req.json()) as { name: string; filter_prompt?: string };
	const { name, filter_prompt } = body;
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const prompt = typeof filter_prompt === "string" && filter_prompt.trim() ? filter_prompt.trim() : null;
	const f = await (c.var.mailboxStub as any).createFolder(slug, name, 1, prompt);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});
```

- [ ] **Step 2: Update folder update route**

Find the `PUT /api/v1/mailboxes/:mailboxId/folders/:id` handler (~line 384):

```typescript
app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const body = (await c.req.json()) as { name?: string; filter_prompt?: string };
	const { name, filter_prompt } = body;
	if (!name) return c.json({ error: "name is required" }, 400);
	const prompt = filter_prompt !== undefined
		? (typeof filter_prompt === "string" && filter_prompt.trim() ? filter_prompt.trim() : null)
		: undefined;
	const f = await (c.var.mailboxStub as any).updateFolder(c.req.param("id")!, name, prompt);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});
```

- [ ] **Step 3: Update email list route to support `?tag=`**

Find the `GET /api/v1/mailboxes/:mailboxId/emails` route (around line 240-265). Add `tag` extraction and pass it through:

```typescript
app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const tag = c.req.query("tag") || undefined;
	const page = intQuery(c, "page") ?? 1;
	const limit = intQuery(c, "limit") ?? 25;
	const threaded = c.req.query("threaded") === "true";
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection, tag } as any);
	if (folder || tag) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});
```

- [ ] **Step 4: Add AI classification to `receiveEmail`**

Find `receiveEmail` (~line 446). After the `await stub.createEmail(...)` call and before the forwarding block, add the classification via `ctx.waitUntil`:

```typescript
// AI tag classification — non-blocking, never delays delivery
ctx.waitUntil(
	(async () => {
		try {
			const foldersWithPrompts = await (stub as any).getFoldersWithPrompts() as Array<{ id: string; name: string; filter_prompt: string }>;
			if (foldersWithPrompts.length === 0) return;
			const bodyText = stripHtmlToText(parsedEmail.html || parsedEmail.text || "");
			const { classifyEmailTags } = await import("./lib/ai");
			const tags = await classifyEmailTags(env.AI, {
				subject: parsedEmail.subject || "",
				sender: (parsedEmail.from?.address || "").toLowerCase(),
				bodyText,
			}, foldersWithPrompts);
			if (tags.length > 0) {
				await (stub as any).setEmailTags(messageId, tags);
			}
		} catch (e) {
			console.error("AI tag classification failed:", (e as Error).message);
		}
	})(),
);
```

Also ensure `stripHtmlToText` is imported. Check the top of `workers/index.ts` — if it's not imported from `./lib/email-helpers`, add it to that import line.

- [ ] **Step 5: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add workers/index.ts
git commit -m "feat: update API routes for filter_prompt, tag filtering, and AI classification on ingest"
```

---

### Task 5: Frontend — Types, API client, and React Query hooks

**Files:**
- Modify: `app/types/index.ts`
- Modify: `app/services/api.ts`
- Modify: `app/queries/folders.ts`

- [ ] **Step 1: Update `Folder` and `Email` types**

In `app/types/index.ts`, update the interfaces:

```typescript
export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: Attachment[];
	snippet?: string | null;
	tags?: string[];
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
	filter_prompt?: string | null;
}
```

- [ ] **Step 2: Update API client**

In `app/services/api.ts`, update `createFolder` and `updateFolder`:

```typescript
// Folders
listFolders: (mailboxId: string) =>
	get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
createFolder: (mailboxId: string, name: string, filter_prompt?: string) =>
	post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name, ...(filter_prompt ? { filter_prompt } : {}) }),
updateFolder: (mailboxId: string, id: string, name: string, filter_prompt?: string | null) =>
	put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name, ...(filter_prompt !== undefined ? { filter_prompt } : {}) }),
deleteFolder: (mailboxId: string, id: string) =>
	del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),
```

- [ ] **Step 3: Update React Query hooks**

In `app/queries/folders.ts`, update `useCreateFolder` and `useUpdateFolder`:

```typescript
export function useCreateFolder() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			name,
			filter_prompt,
		}: { mailboxId: string; name: string; filter_prompt?: string }) =>
			api.createFolder(mailboxId, name, filter_prompt),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		},
	});
}

export function useUpdateFolder() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			name,
			filter_prompt,
		}: { mailboxId: string; id: string; name: string; filter_prompt?: string | null }) =>
			api.updateFolder(mailboxId, id, name, filter_prompt),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		},
	});
}
```

- [ ] **Step 4: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/types/index.ts app/services/api.ts app/queries/folders.ts
git commit -m "feat: extend Folder/Email types and API client for AI tags"
```

---

### Task 6: Sidebar — AI filter prompt in create folder dialog

**Files:**
- Modify: `app/components/Sidebar.tsx`

- [ ] **Step 1: Add `filterPrompt` state and textarea to the create folder dialog**

In `app/components/Sidebar.tsx`:

1. Add state for the filter prompt next to `newFolderName`:

```typescript
const [newFolderPrompt, setNewFolderPrompt] = useState("");
```

2. Update `handleCreateFolder` to pass the prompt and reset it:

```typescript
const handleCreateFolder = (e: React.SyntheticEvent<HTMLFormElement>) => {
	e.preventDefault();
	if (newFolderName.trim() && mailboxId) {
		createFolderMutation.mutate({
			mailboxId,
			name: newFolderName.trim(),
			filter_prompt: newFolderPrompt.trim() || undefined,
		});
		setNewFolderName("");
		setNewFolderPrompt("");
		setIsCreateFolderOpen(false);
	}
};
```

3. In the Dialog content (where the folder name `<Input>` is rendered), add the textarea below the input. The existing dialog form looks like:

```tsx
<form onSubmit={handleCreateFolder} className="flex flex-col gap-3">
	<Input
		placeholder="Folder name"
		value={newFolderName}
		onChange={(e) => setNewFolderName(e.target.value)}
		autoFocus
	/>
	<textarea
		placeholder='e.g. Emails about the Nisalvila project, from the Nisalvila team, or mentioning Nisalvila'
		value={newFolderPrompt}
		onChange={(e) => setNewFolderPrompt(e.target.value)}
		rows={3}
		className="w-full text-sm rounded-md border border-kumo-line bg-kumo-base px-3 py-2 text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-brand resize-none"
	/>
	<p className="text-xs text-kumo-subtle -mt-1">
		AI filter prompt (optional) — AI will automatically tag matching emails when they arrive.
	</p>
	{/* existing buttons */}
</form>
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/Sidebar.tsx
git commit -m "feat: add AI filter prompt textarea to create folder dialog"
```

---

### Task 7: Email list — tag pills, ?tag= filter, and filter header indicator

**Files:**
- Modify: `app/routes/email-list.tsx`

- [ ] **Step 1: Read `?tag=` param and pass to API query**

In `app/routes/email-list.tsx`, add `useSearchParams` import and read the param:

```typescript
import { useParams, useSearchParams, useNavigate } from "react-router";
```

Add inside the component (near the top):

```typescript
const [searchParams, setSearchParams] = useSearchParams();
const navigate = useNavigate();
const activeTag = searchParams.get("tag") || undefined;
```

Update the `params` memo to include `tag`:

```typescript
const params = useMemo(
	() => ({
		folder: folder || "",
		page: String(page),
		limit: String(PAGE_SIZE),
		...(activeTag ? { tag: activeTag } : {}),
	}),
	[folder, page, activeTag],
);
```

- [ ] **Step 2: Build tag label lookup from folders data**

Add a derived map for tag label lookup (after the `folderName` memo):

```typescript
const folderMap = useMemo(
	() => Object.fromEntries(folders.map((f) => [f.id, f.name])),
	[folders],
);

const activeTagName = activeTag ? (folderMap[activeTag] || activeTag) : null;
```

- [ ] **Step 3: Add filter indicator to folder header**

In the folder header `<div>`, after the `<h1>` with `folderName`, add:

```tsx
{activeTagName && (
	<div className="flex items-center gap-1.5 mt-0.5">
		<span className="text-sm text-kumo-subtle">
			tagged: <span className="text-kumo-default font-medium">{activeTagName}</span>
		</span>
		<button
			type="button"
			onClick={() => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("tag"); return next; })}
			className="text-kumo-subtle hover:text-kumo-default text-sm leading-none bg-transparent border-0 cursor-pointer p-0"
			aria-label="Remove tag filter"
		>
			×
		</button>
	</div>
)}
```

- [ ] **Step 4: Add tag pills to email rows**

Find where the email row date is rendered. It's in the right column. Wrap it with a flex column that shows pills above the date:

In the email row, find the date display (the rightmost column). Change it to:

```tsx
{/* Date + tags column */}
<div className="flex flex-col items-end shrink-0 gap-1">
	{email.tags && email.tags.length > 0 && (
		<div className="flex flex-wrap gap-1 justify-end">
			{email.tags.slice(0, 2).map((tagId) => (
				<button
					key={tagId}
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						navigate(`/mailbox/${mailboxId}/emails/${folder}?tag=${tagId}`);
					}}
					className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-kumo-fill text-kumo-default cursor-pointer border-0"
				>
					{folderMap[tagId] || tagId}
				</button>
			))}
			{email.tags.length > 2 && (
				<span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-kumo-fill text-kumo-subtle">
					+{email.tags.length - 2}
				</span>
			)}
		</div>
	)}
	<span className="text-xs text-kumo-subtle whitespace-nowrap">
		{formatListDate(email.date)}
	</span>
</div>
```

Replace the existing date-only span in the row. In the existing row code, find the date display and replace it with the above block.

- [ ] **Step 5: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Build check**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/routes/email-list.tsx
git commit -m "feat: add tag pills to email rows and ?tag= filter support"
```

---

## Self-Review Checklist

- [x] Schema: `filter_prompt TEXT` (nullable) on folders; `tags TEXT NOT NULL DEFAULT '[]'` on emails
- [x] Migration #9 adds both columns via `txn()` wrapper
- [x] `classifyEmailTags` uses `@cf/meta/llama-3.1-8b-instruct-fast`, returns `[]` on any failure
- [x] `receiveEmail` calls classifier via `ctx.waitUntil()` — never blocks delivery
- [x] `getFoldersWithPrompts` only returns folders where `filter_prompt IS NOT NULL AND filter_prompt != ''`
- [x] `setEmailTags` uses parameterized SQL — no injection
- [x] `getEmails` tag condition uses `json_each` — correct JSON array membership check
- [x] Folder create/update routes accept optional `filter_prompt`
- [x] API client and hooks propagate `filter_prompt`
- [x] Sidebar textarea state resets after folder creation
- [x] Tag pills: max 2 shown, `+N` for overflow, cursor-pointer, clicking navigates to `?tag=`
- [x] Filter indicator in folder header with `×` to clear
- [x] `countEmails` not updated for tag — tag filtering is list-only, count excludes tag to avoid confusion (spec says tags are display-only, not folder-moving)
- [x] Types: `Folder.filter_prompt?: string | null`, `Email.tags?: string[]`
