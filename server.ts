import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { Marked } from "marked";
import { chat } from "./claude";
import type { ServerWebSocket } from "bun";

const DOCS_DIR = join(import.meta.dir, "docs");
const PORT = 3000;
const WS_TOKEN = process.env.WS_TOKEN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

function checkToken(input: string): boolean {
  if (!WS_TOKEN) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(WS_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const marked = new Marked({
  breaks: true,
  gfm: true,
});

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }

  :root {
    --bg: #fff;
    --fg: #1a1a1a;
    --fg-muted: #555;
    --link: #0969da;
    --border: #d0d7de;
    --code-bg: #f5f5f5;
    --block-bg: #f8f9fa;
    --max-w: 46rem;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --fg: #c9d1d9;
      --fg-muted: #8b949e;
      --link: #58a6ff;
      --border: #30363d;
      --code-bg: #161b22;
      --block-bg: #161b22;
    }
  }

  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica,
      Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
    font-size: 1rem;
    line-height: 1.6;
    color: var(--fg);
    background: var(--bg);
  }

  .container {
    max-width: var(--max-w);
    margin: 0 auto;
    padding: 2rem 1.25rem;
  }

  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ---- Index page ---- */
  .file-list { list-style: none; padding: 0; }
  .file-list li {
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }
  .file-list .meta {
    color: var(--fg-muted);
    font-size: 0.85rem;
    white-space: nowrap;
  }

  /* ---- Article ---- */
  .article h1, .article h2, .article h3,
  .article h4, .article h5, .article h6 {
    margin-top: 1.8em;
    margin-bottom: 0.5em;
    line-height: 1.25;
  }
  .article h1 { font-size: 1.75rem; }
  .article h2 { font-size: 1.4rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }

  .article img { max-width: 100%; height: auto; }

  .article pre {
    background: var(--code-bg);
    padding: 1rem;
    overflow-x: auto;
    border-radius: 6px;
    font-size: 0.875rem;
  }
  .article code {
    background: var(--code-bg);
    padding: 0.15em 0.35em;
    border-radius: 4px;
    font-size: 0.9em;
  }
  .article pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }

  .article blockquote {
    margin: 1rem 0;
    padding: 0.25rem 1rem;
    border-left: 4px solid var(--border);
    color: var(--fg-muted);
    background: var(--block-bg);
    border-radius: 0 6px 6px 0;
  }

  .article table {
    border-collapse: collapse;
    width: 100%;
    overflow-x: auto;
    display: block;
  }
  .article th, .article td {
    border: 1px solid var(--border);
    padding: 0.45rem 0.75rem;
    text-align: left;
  }
  .article th { background: var(--block-bg); }

  .back { display: inline-block; margin-bottom: 1rem; }

  /* MathJax overflow */
  mjx-container { overflow-x: auto; overflow-y: hidden; }
</style>

<!-- MathJax v3: $..$ inline, $$...$$ display -->
<script>
  window.MathJax = {
    tex: {
      inlineMath:  [['$', '$']],
      displayMath: [['$$', '$$']],
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    },
  };
</script>
<script id="MathJax-script" async
  src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>

<!-- Hypothesis -->
<script src="https://hypothes.is/embed.js" async></script>
</head>
<body>
<div class="container">
${body}
</div>
</body>
</html>`;
}

function chatPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #fff; --fg: #1a1a1a; --fg-muted: #555; --border: #d0d7de;
    --code-bg: #f5f5f5; --user-bg: #e3f2fd; --bot-bg: #f5f5f5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #c9d1d9; --fg-muted: #8b949e; --border: #30363d;
      --code-bg: #161b22; --user-bg: #1a3a5c; --bot-bg: #161b22;
    }
  }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 1rem; line-height: 1.6; color: var(--fg); background: var(--bg);
    display: flex; flex-direction: column;
  }
  #messages {
    flex: 1; overflow-y: auto; padding: 1rem;
    max-width: 46rem; width: 100%; margin: 0 auto;
  }
  .msg { margin-bottom: 1rem; padding: 0.6rem 1rem; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; }
  .msg.user { background: var(--user-bg); margin-left: 3rem; }
  .msg.bot { background: var(--bot-bg); margin-right: 3rem; }
  .msg.error { background: #5c1a1a; color: #f8d7da; }
  .msg pre { background: var(--code-bg); padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.875rem; }
  .msg code { background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
  .msg pre code { background: none; padding: 0; }
  .tool { font-size: 0.85rem; color: var(--fg-muted); padding: 0.3rem 1rem; margin-bottom: 0.25rem; }
  .meta { font-size: 0.75rem; color: var(--fg-muted); text-align: right; margin-top: 0.25rem; }
  #input-area {
    border-top: 1px solid var(--border); padding: 0.75rem 1rem;
    max-width: 46rem; width: 100%; margin: 0 auto;
    display: flex; gap: 0.5rem;
  }
  #input {
    flex: 1; padding: 0.5rem 0.75rem; border: 1px solid var(--border);
    border-radius: 6px; background: var(--bg); color: var(--fg);
    font-family: inherit; font-size: 1rem; resize: none;
    min-height: 2.5rem; max-height: 8rem;
  }
  #input:focus { outline: none; border-color: #58a6ff; }
  #send {
    padding: 0.5rem 1rem; border: none; border-radius: 6px;
    background: #238636; color: #fff; font-size: 1rem; cursor: pointer;
    align-self: flex-end;
  }
  #send:hover { background: #2ea043; }
  #send:disabled { opacity: 0.5; cursor: not-allowed; }
  #status { font-size: 0.75rem; color: var(--fg-muted); padding: 0.25rem 1rem; text-align: center; }
</style>
</head>
<body>
<div id="status">Connecting...</div>
<div id="messages"></div>
<div id="input-area">
  <textarea id="input" rows="1" placeholder="Send a message..." disabled></textarea>
  <button id="send" disabled>Send</button>
</div>
<script>
const messages = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const status = document.getElementById("status");

let ws;
let currentBot = null;
let busy = false;
const TOKEN_KEY = "ws_token";

function getToken() {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = prompt("Enter access token:");
    if (t) localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

function connect() {
  const token = getToken();
  if (!token) { status.textContent = "No token provided"; return; }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  status.textContent = "Connecting...";
  ws = new WebSocket(proto + "//" + location.host + "/ws");

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "auth", token }));
  };

  ws.onmessage = (e) => {
    const evt = JSON.parse(e.data);
    switch (evt.type) {
      case "auth-ok":
        status.textContent = "Connected";
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
        break;
      case "text-delta":
        if (!currentBot) {
          currentBot = document.createElement("div");
          currentBot.className = "msg bot";
          messages.appendChild(currentBot);
        }
        currentBot.textContent += evt.delta;
        messages.scrollTop = messages.scrollHeight;
        break;
      case "tool-use": {
        const tool = document.createElement("div");
        tool.className = "tool";
        tool.textContent = "\\u{1F527} " + evt.name;
        messages.appendChild(tool);
        messages.scrollTop = messages.scrollHeight;
        break;
      }
      case "done":
        if (currentBot) {
          const meta = document.createElement("div");
          meta.className = "meta";
          meta.textContent = "$" + evt.cost.toFixed(4) + " \\u00b7 " + evt.turns + " turn" + (evt.turns !== 1 ? "s" : "");
          currentBot.appendChild(meta);
        }
        currentBot = null;
        busy = false;
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
        break;
      case "error": {
        const err = document.createElement("div");
        err.className = "msg error";
        err.textContent = evt.message;
        messages.appendChild(err);
        currentBot = null;
        busy = false;
        input.disabled = false;
        sendBtn.disabled = false;
        break;
      }
    }
  };

  ws.onclose = (ev) => {
    input.disabled = true;
    sendBtn.disabled = true;
    if (ev.code === 4401) {
      localStorage.removeItem(TOKEN_KEY);
      status.textContent = "Invalid token. Reload to retry.";
      return;
    }
    status.textContent = "Disconnected. Reconnecting...";
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

function send() {
  const text = input.value.trim();
  if (!text || busy) return;

  const userMsg = document.createElement("div");
  userMsg.className = "msg user";
  userMsg.textContent = text;
  messages.appendChild(userMsg);
  messages.scrollTop = messages.scrollHeight;

  ws.send(text);
  input.value = "";
  input.style.height = "auto";
  busy = true;
  input.disabled = true;
  sendBtn.disabled = true;
}

sendBtn.onclick = send;
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 128) + "px";
});

connect();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

type AccessRules = Record<string, string[]>; // slug → list of allowed tokens

const ACCESS_FILE = join(DOCS_DIR, ".access.json");

async function loadAccess(): Promise<AccessRules> {
  try {
    return JSON.parse(await readFile(ACCESS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function getToken(req: Request, url: URL): string | null {
  return (
    url.searchParams.get("t") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null
  );
}

function canAccess(slug: string, token: string | null, rules: AccessRules): boolean {
  if (!(slug in rules)) return true; // not listed → public
  return token !== null && rules[slug].includes(token);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DocEntry {
  slug: string;
  name: string;
  mtime: Date;
}

async function listDocs(): Promise<DocEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(DOCS_DIR);
  } catch {
    return [];
  }

  const docs: DocEntry[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const fullPath = join(DOCS_DIR, entry);
    try {
      // realpath follows symlinks; stat the resolved path
      const resolved = await realpath(fullPath);
      const docsReal = await realpath(DOCS_DIR);
      if (!resolved.startsWith(docsReal + "/")) continue;
      const st = await stat(resolved);
      if (!st.isFile()) continue;
      docs.push({
        slug: entry.replace(/\.md$/, ""),
        name: entry.replace(/\.md$/, ""),
        mtime: st.mtime,
      });
    } catch {
      // broken symlink or permission error — skip
    }
  }

  docs.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return docs;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// WebSocket types
// ---------------------------------------------------------------------------

interface WSData {
  sessionId?: string;
  authenticated: boolean;
}

let activeWsCount = 0;

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handler(req: Request, server: ReturnType<typeof Bun.serve>): Promise<Response> {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);

  // --- WebSocket upgrade ---
  if (path === "/ws") {
    if (!WS_TOKEN) {
      return new Response("WS auth not configured", { status: 503 });
    }
    // Origin check (#7)
    const origin = req.headers.get("origin");
    if (ALLOWED_ORIGIN && origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }
    // Concurrency limit (#9)
    if (activeWsCount >= 1) {
      return new Response("Too many connections", { status: 429 });
    }
    const ok = server.upgrade(req, { data: { authenticated: false } });
    if (!ok) return new Response("WebSocket upgrade failed", { status: 400 });
    return undefined as unknown as Response;
  }

  // --- Chat UI ---
  if (path === "/chat") {
    if (!WS_TOKEN) {
      return new Response("Chat not configured", { status: 503 });
    }
    return new Response(chatPage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const rules = await loadAccess();
  const token = getToken(req, url);

  // --- Index ---
  if (path === "/") {
    const docs = (await listDocs()).filter((d) => canAccess(d.slug, token, rules));
    const items = docs
      .map(
        (d) =>
          `<li><a href="/${encodeURIComponent(d.slug)}">${escapeHtml(d.name)}</a> <span class="meta">${formatDate(d.mtime)}</span></li>`
      )
      .join("\n");

    const body =
      docs.length > 0
        ? `<h1>Documents</h1>\n<ul class="file-list">\n${items}\n</ul>`
        : `<h1>Documents</h1>\n<p>No markdown files found in <code>docs/</code>.</p>`;

    return new Response(layout("Documents", body), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // --- Static assets (images) from docs/ ---
  const ASSET_EXT: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  const assetName = path.slice(1);
  const ext = assetName.includes(".") ? assetName.slice(assetName.lastIndexOf(".")).toLowerCase() : "";
  if (ext in ASSET_EXT && !assetName.includes("/") && !assetName.includes("\0")) {
    const assetPath = join(DOCS_DIR, assetName);
    try {
      const resolved = await realpath(assetPath);
      const docsReal = await realpath(DOCS_DIR);
      if (!resolved.startsWith(docsReal + "/")) throw new Error("outside docs");
      const data = await readFile(resolved);
      return new Response(data, {
        headers: { "Content-Type": ASSET_EXT[ext], "Cache-Control": "public, max-age=3600" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  // --- Document page ---
  const slug = path.slice(1); // strip leading /
  if (slug.includes("/") || slug.includes("\0")) {
    return new Response("Not found", { status: 404 });
  }

  if (!canAccess(slug, token, rules)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const filePath = join(DOCS_DIR, `${slug}.md`);

  let md: string;
  try {
    // realpath follows symlinks — validate it's still inside docs/
    const resolved = await realpath(filePath);
    const docsReal = await realpath(DOCS_DIR);
    if (!resolved.startsWith(docsReal + "/")) throw new Error("outside docs");
    md = await readFile(resolved, "utf-8");
  } catch {
    return new Response(layout("Not Found", `<h1>404</h1><p>File not found.</p><a class="back" href="/">&larr; Back</a>`), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const html = await marked.parse(md);
  const body = `<a class="back" href="/">&larr; Back</a>\n<article class="article">\n${html}\n</article>`;

  return new Response(layout(slug, body), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

Bun.serve<WSData>({
  port: PORT,
  fetch: handler,
  websocket: {
    open(ws) {
      activeWsCount++;
      console.log(`ws: connected (active: ${activeWsCount})`);
    },
    async message(ws, raw) {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

      // First message must be auth
      if (!ws.data.authenticated) {
        try {
          const msg = JSON.parse(text);
          if (msg.type === "auth" && typeof msg.token === "string" && checkToken(msg.token)) {
            ws.data.authenticated = true;
            ws.sendText(JSON.stringify({ type: "auth-ok" }));
            console.log("ws: authenticated");
            return;
          }
        } catch {}
        console.log("ws: auth failed, closing");
        ws.close(4401, "Invalid token");
        return;
      }

      try {
        for await (const event of chat(text, ws.data.sessionId)) {
          ws.sendText(JSON.stringify(event));
          if (event.type === "done") {
            ws.data.sessionId = event.session_id;
          }
        }
      } catch (err) {
        ws.sendText(JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
          recoverable: false,
        }));
      }
    },
    close(ws) {
      activeWsCount--;
      console.log(`ws: disconnected (active: ${activeWsCount})`);
    },
  },
});

console.log(`md-server listening on http://localhost:${PORT}`);
