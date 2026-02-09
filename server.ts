import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Marked } from "marked";
import { chat } from "./claude";
import type { ServerWebSocket } from "bun";

const DOCS_DIR = join(import.meta.dir, "docs");
const PORT = 3000;

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
    url.searchParams.get("token") ||
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
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handler(req: Request, server: ReturnType<typeof Bun.serve>): Promise<Response> {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);

  // --- WebSocket upgrade ---
  if (path === "/ws") {
    const sessionId = url.searchParams.get("session") ?? undefined;
    const upgraded = server.upgrade<WSData>(req, { data: { sessionId } });
    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return undefined as unknown as Response;
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
    // realpath follows symlinks
    const resolved = await realpath(filePath);
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
      console.log(`ws: connected${ws.data.sessionId ? ` (resuming ${ws.data.sessionId})` : ""}`);
    },
    async message(ws, raw) {
      const prompt = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      try {
        for await (const event of chat(prompt, ws.data.sessionId)) {
          ws.sendText(JSON.stringify(event));
          // Capture session ID for subsequent turns
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
      console.log(`ws: disconnected${ws.data.sessionId ? ` (session ${ws.data.sessionId})` : ""}`);
    },
  },
});

console.log(`md-server listening on http://localhost:${PORT}`);
