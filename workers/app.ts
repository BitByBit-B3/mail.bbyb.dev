// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import { app as apiApp, receiveEmail } from "./index";
import { EmailMCP } from "./mcp";
import { processOutboxBatch, type OutboxJob } from "./lib/outbound-queue";
import type { Env } from "./types";

export { MailboxDO } from "./durableObject";
export { EmailAgent } from "./agent";
export { EmailMCP } from "./mcp";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

// -- Password auth --------------------------------------------------------
//
// Cloudflare Access removed. We gate the app behind a single shared password
// (env.APP_PASSWORD). Cookie value is sha256(password); we compare against
// sha256(env.APP_PASSWORD) in constant time. HttpOnly + Secure + SameSite=Lax.

const AUTH_COOKIE = "b3_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const buf = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

function readCookie(req: Request, name: string): string | null {
	const header = req.headers.get("Cookie") || "";
	for (const part of header.split(/;\s*/)) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1));
	}
	return null;
}

function loginPage(error: string | null, redirectTo: string, status = 200): Response {
	const safeError = error ? error.replace(/[<>&"']/g, "") : "";
	const safeRedirect = redirectTo.replace(/[<>&"']/g, "");
	const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>B3 Mail — Sign in</title><style>
html,body{height:100%;margin:0;background:#0b0b0c;color:#e6e6e6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.wrap{display:flex;align-items:center;justify-content:center;height:100%}
form{background:#141416;padding:32px;border-radius:12px;border:1px solid #2a2a2d;width:320px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
h1{margin:0 0 16px;font-size:18px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #2a2a2d;background:#0b0b0c;color:#e6e6e6;font-size:14px;margin-bottom:12px}
input:focus{outline:none;border-color:#4a90ff}
button{width:100%;padding:10px;border-radius:8px;border:0;background:#4a90ff;color:#fff;font-weight:600;cursor:pointer;font-size:14px}
button:hover{background:#3a7fe8}
.err{color:#ff6b6b;font-size:13px;margin-bottom:12px}
</style></head><body><div class="wrap"><form method="POST" action="/auth/login">
<h1>B3 Internal Mail</h1>
${safeError ? `<div class="err">${safeError}</div>` : ""}
<input type="hidden" name="redirect" value="${safeRedirect}">
<input type="password" name="password" placeholder="Password" autofocus required>
<button type="submit">Sign in</button>
</form></div></body></html>`;
	return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function buildAuthCookie(value: string): string {
	return `${AUTH_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

function clearAuthCookie(): string {
	return `${AUTH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Main app
const app = new Hono<{ Bindings: Env }>();

// Public auth routes — exempt from the gate
app.get("/auth/login", (c) => {
	const redirect = c.req.query("redirect") || "/";
	return loginPage(null, redirect);
});

app.post("/auth/login", async (c) => {
	const form = await c.req.formData();
	const password = String(form.get("password") || "");
	const redirect = String(form.get("redirect") || "/") || "/";
	const expected = c.env.APP_PASSWORD;
	if (!expected) return c.text("APP_PASSWORD not configured", 500);
	if (!password || !timingSafeEqual(password, expected)) {
		return loginPage("Wrong password", redirect, 401);
	}
	const cookieValue = await sha256Hex(expected);
	return new Response(null, {
		status: 302,
		headers: { Location: redirect.startsWith("/") ? redirect : "/", "Set-Cookie": buildAuthCookie(cookieValue) },
	});
});

app.post("/auth/logout", (_c) => {
	return new Response(null, { status: 302, headers: { Location: "/auth/login", "Set-Cookie": clearAuthCookie() } });
});

// Auth gate for everything else (skipped in dev)
app.use("*", async (c, next) => {
	if (import.meta.env.DEV) return next();
	const expected = c.env.APP_PASSWORD;
	if (!expected) return c.text("APP_PASSWORD not configured", 500);

	const cookie = readCookie(c.req.raw, AUTH_COOKIE);
	if (cookie) {
		const want = await sha256Hex(expected);
		if (timingSafeEqual(cookie, want)) return next();
	}

	const url = new URL(c.req.url);
	const path = url.pathname + url.search;

	// API/MCP/agents requests — return 401 JSON, don't redirect.
	if (
		path.startsWith("/api/") ||
		path.startsWith("/mcp") ||
		path.startsWith("/agents/")
	) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const redirect = encodeURIComponent(path);
	return new Response(null, { status: 302, headers: { Location: `/auth/login?redirect=${redirect}` } });
});

// MCP server endpoint
const mcpHandler = EmailMCP.serve("/mcp", { binding: "EMAIL_MCP" });
app.all("/mcp", async (c) => {
	return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});
app.all("/mcp/*", async (c) => {
	return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});

// Mount the API routes
app.route("/", apiApp);

// Agent WebSocket routing
app.all("/agents/*", async (c) => {
	const response = await routeAgentRequest(c.req.raw, c.env);
	if (response) return response;
	return c.text("Agent not found", 404);
});

// Serve avatars from R2
app.get("/avatars/:filename{.+}", async (c) => {
	const filename = c.req.param("filename");
	const obj = await c.env.BUCKET.get(`avatars/${filename}`);
	if (!obj) return c.text("Not found", 404);
	return new Response(obj.body, {
		headers: {
			"Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
});

// React Router catch-all
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
	});
});

export default {
	fetch: app.fetch,
	async email(
		event: ForwardableEmailMessage,
		env: Env,
		ctx: ExecutionContext,
	) {
		try {
			await receiveEmail(event, env, ctx);
		} catch (e) {
			console.error("Failed to process incoming email:", (e as Error).message, (e as Error).stack);
			throw e;
		}
	},
	async queue(batch: MessageBatch<OutboxJob>, env: Env) {
		await processOutboxBatch(env, batch);
	},
};
