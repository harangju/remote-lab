"""Standalone FastAPI app for serving markdown documents."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import markdown
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, Response

app = FastAPI()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DOCS_DIR = Path(__file__).parent.parent / "public"

ASSET_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".pdf": "application/pdf",
}

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def _load_access() -> dict[str, list[str]]:
    access_file = DOCS_DIR / ".access.json"
    try:
        return json.loads(access_file.read_text())
    except Exception:
        return {}


def _can_access(slug: str, token: str | None, rules: dict) -> bool:
    if slug not in rules:
        return True
    return token is not None and token in rules[slug]


def _get_token(request: Request) -> str | None:
    t = request.query_params.get("t")
    if t:
        return t
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return None


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------


def _escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _layout(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{_escape(title)}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; }}
  :root {{
    --bg: #fff; --fg: #1a1a1a; --fg-muted: #555; --link: #0969da;
    --border: #d0d7de; --code-bg: #f5f5f5; --block-bg: #f8f9fa; --max-w: 46rem;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #0d1117; --fg: #c9d1d9; --fg-muted: #8b949e; --link: #58a6ff;
      --border: #30363d; --code-bg: #161b22; --block-bg: #161b22;
    }}
  }}
  body {{
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica,
      Arial, sans-serif; font-size: 1rem; line-height: 1.6;
    color: var(--fg); background: var(--bg);
  }}
  .container {{ max-width: var(--max-w); margin: 0 auto; padding: 2rem 1.25rem; }}
  a {{ color: var(--link); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .file-list {{ list-style: none; padding: 0; }}
  .file-list li {{
    padding: 0.6rem 0; border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
  }}
  .file-list .meta {{ color: var(--fg-muted); font-size: 0.85rem; white-space: nowrap; }}
  .article h1, .article h2, .article h3 {{ margin-top: 1.8em; margin-bottom: 0.5em; line-height: 1.25; }}
  .article h1 {{ font-size: 1.75rem; }}
  .article h2 {{ font-size: 1.4rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }}
  .article img {{ max-width: 100%; height: auto; }}
  .article pre {{ background: var(--code-bg); padding: 1rem; overflow-x: auto; border-radius: 6px; font-size: 0.875rem; }}
  .article code {{ background: var(--code-bg); padding: 0.15em 0.35em; border-radius: 4px; font-size: 0.9em; }}
  .article pre code {{ background: none; padding: 0; border-radius: 0; font-size: inherit; }}
  .article blockquote {{
    margin: 1rem 0; padding: 0.25rem 1rem; border-left: 4px solid var(--border);
    color: var(--fg-muted); background: var(--block-bg); border-radius: 0 6px 6px 0;
  }}
  .article table {{ border-collapse: collapse; width: 100%; overflow-x: auto; display: block; }}
  .article th, .article td {{ border: 1px solid var(--border); padding: 0.45rem 0.75rem; text-align: left; }}
  .article th {{ background: var(--block-bg); }}
  .back {{ display: inline-block; margin-bottom: 1rem; }}
  mjx-container {{ overflow-x: auto; overflow-y: hidden; }}
</style>
<script>
  window.MathJax = {{
    tex: {{ inlineMath: [['$', '$']], displayMath: [['$$', '$$']] }},
    options: {{ skipHtmlTags: ['script','noscript','style','textarea','pre','code'] }},
  }};
</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<script src="https://hypothes.is/embed.js" async></script>
</head>
<body>
<div class="container">
{body}
</div>
</body>
</html>"""


def _format_date(mtime: float) -> str:
    d = datetime.fromtimestamp(mtime)
    return d.strftime("%b %d, %Y")


def _safe_resolve(base: Path, rel: str) -> Path | None:
    """Resolve a path and ensure it's inside the base directory."""
    try:
        p = (base / rel).resolve()
        base_resolved = base.resolve()
        if str(p).startswith(str(base_resolved) + "/") or p == base_resolved:
            return p
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    rules = _load_access()
    token = _get_token(request)
    docs = []
    if DOCS_DIR.exists():
        for f in sorted(DOCS_DIR.iterdir()):
            if not f.name.endswith((".md", ".html")):
                continue
            resolved = _safe_resolve(DOCS_DIR, f.name)
            if not resolved or not resolved.is_file():
                continue
            slug = f.stem
            if not _can_access(slug, token, rules):
                continue
            docs.append((slug, f.name.replace(".md", "").replace(".html", ""), resolved.stat().st_mtime))

    docs.sort(key=lambda x: x[2], reverse=True)
    items = "\n".join(
        f'<li><a href="/{_escape(slug)}">{_escape(name)}</a> <span class="meta">{_format_date(mt)}</span></li>'
        for slug, name, mt in docs
    )
    body = (
        f'<h1>Documents</h1>\n<ul class="file-list">\n{items}\n</ul>'
        if docs
        else '<h1>Documents</h1>\n<p>No markdown files found in <code>docs/</code>.</p>'
    )
    return HTMLResponse(_layout("Documents", body))


@app.get("/{path:path}")
async def doc_or_asset(path: str, request: Request):
    if "\0" in path:
        return Response("Not found", status_code=404)

    # Check if it's a static asset
    ext = ""
    if "." in path:
        ext = path[path.rfind("."):].lower()

    if ext in ASSET_TYPES:
        resolved = _safe_resolve(DOCS_DIR, path)
        if resolved and resolved.is_file():
            data = resolved.read_bytes()
            return Response(data, media_type=ASSET_TYPES[ext], headers={"Cache-Control": "public, max-age=3600"})
        return Response("Not found", status_code=404)

    # Document page
    slug = path
    if "/" in slug:
        return Response("Not found", status_code=404)

    rules = _load_access()
    token = _get_token(request)
    if not _can_access(slug, token, rules):
        return Response("Unauthorized", status_code=401)

    # Try HTML first (served as-is), then markdown
    html_resolved = _safe_resolve(DOCS_DIR, f"{slug}.html")
    if html_resolved and html_resolved.is_file():
        return HTMLResponse(html_resolved.read_text(errors="replace"))

    resolved = _safe_resolve(DOCS_DIR, f"{slug}.md")
    if not resolved or not resolved.is_file():
        body = '<h1>404</h1><p>File not found.</p><a class="back" href="/">&larr; Back</a>'
        return HTMLResponse(_layout("Not Found", body), status_code=404)

    md_text = resolved.read_text(errors="replace")
    html = markdown.markdown(md_text, extensions=["fenced_code", "tables", "toc", "sane_lists"])
    body = f'<article class="article">\n{html}\n</article>'
    return HTMLResponse(_layout(slug, body))
