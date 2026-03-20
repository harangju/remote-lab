from __future__ import annotations

import asyncio
import json
from pathlib import Path
from uuid import uuid4

from fastapi import WebSocket


def sanitize_public_name(name: str) -> str:
    cleaned = Path(name).name.strip().replace("\x00", "")
    safe = "".join(ch if ch.isalnum() or ch in {".", "-", "_"} else "-" for ch in cleaned)
    return safe or "shared-file"


def public_url_base(ws: WebSocket, public_base_url: str) -> str:
    if public_base_url:
        return public_base_url
    origin = ws.headers.get("origin", "").strip().rstrip("/")
    if origin:
        return origin
    host = ws.headers.get("host", "").strip()
    if not host:
        return ""
    proto = "https" if ws.url.scheme == "wss" else "http"
    return f"{proto}://{host}"


def share_output_name(output_name: str) -> str:
    path = Path(output_name)
    if path.suffix.lower() in {".html", ".md"}:
        return path.stem
    return output_name


def shared_access_key(name: str) -> str:
    path = Path(name)
    if path.suffix.lower() in {".html", ".md"}:
        return path.stem
    return path.name


def load_public_access(public_dir: Path) -> dict[str, list[str]]:
    access_file = public_dir / ".access.json"
    try:
        data = json.loads(access_file.read_text())
        if isinstance(data, dict):
            return {str(k): [str(v) for v in values if isinstance(v, str)] for k, values in data.items() if isinstance(values, list)}
    except Exception:
        pass
    return {}


def save_public_access(public_dir: Path, rules: dict[str, list[str]]) -> None:
    public_dir.mkdir(parents=True, exist_ok=True)
    access_file = public_dir / ".access.json"
    access_file.write_text(json.dumps(rules, indent=2, sort_keys=True) + "\n")


def share_output(output_name: str, ws: WebSocket, public_base_url: str, token: str | None = None) -> str:
    public_name = share_output_name(output_name)
    path = f"/{public_name}"
    if token:
        path = f"{path}?t={token}"
    base = public_url_base(ws, public_base_url)
    if base:
        return f"Shared to {base}{path}"
    return f"Shared to {path}"


def share_url_for_slug(slug: str, ws: WebSocket, public_base_url: str, token: str | None = None) -> str:
    path = f"/{slug}"
    if token:
        path = f"{path}?t={token}"
    base = public_url_base(ws, public_base_url)
    if base:
        return f"{base}{path}"
    return path


def resolve_share_source(project_root: Path, raw_path: str) -> tuple[Path | None, str | None]:
    allowed_exts = {".md", ".html", ".pdf"}
    rel_path = raw_path.strip()
    if rel_path.startswith("@"):
        rel_path = rel_path[1:]
    rel_path = rel_path.strip()
    if not rel_path:
        return None, "Usage: /share <project-relative .md, .html, or .pdf file>"

    direct = (project_root / rel_path).resolve()
    if not str(direct).startswith(str(project_root)):
        return None, "Source file must be inside the current project"
    if direct.is_file() and direct.suffix.lower() in allowed_exts:
        return direct, None

    search_terms: list[str] = []
    if rel_path:
        search_terms.append(rel_path)
        rel_obj = Path(rel_path)
        if rel_obj.suffix.lower() not in allowed_exts:
            search_terms.extend([f"{rel_path}.md", f"{rel_path}.html", f"{rel_path}.pdf"])
        name = rel_obj.name
        if name and name not in search_terms:
            search_terms.append(name)
        if name and Path(name).suffix.lower() not in allowed_exts:
            search_terms.extend([f"{name}.md", f"{name}.html", f"{name}.pdf"])

    candidates: list[Path] = []
    seen: set[str] = set()
    for file_path in project_root.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in allowed_exts:
            continue
        try:
            rel = str(file_path.relative_to(project_root))
        except ValueError:
            continue
        rel_lower = rel.lower()
        name_lower = file_path.name.lower()
        if any(rel_lower == term.lower() or name_lower == term.lower() for term in search_terms):
            if rel not in seen:
                seen.add(rel)
                candidates.append(file_path)

    if len(candidates) == 1:
        return candidates[0], None
    if len(candidates) > 1:
        options = ", ".join(str(p.relative_to(project_root)) for p in sorted(candidates)[:5])
        more = "" if len(candidates) <= 5 else f", ... ({len(candidates)} matches)"
        return None, f"Multiple matching files found: {options}{more}"
    return None, "No matching .md, .html, or .pdf file found"


def parse_share_args(cmd_args: str) -> tuple[str, str | None]:
    raw = cmd_args.strip()
    if not raw:
        return "", None
    parts = raw.rsplit(None, 1)
    if len(parts) == 2 and parts[1].strip():
        candidate_path, candidate_token = parts[0].strip(), parts[1].strip()
        if candidate_path:
            return candidate_path, candidate_token
    return raw, None


async def handle_share(cmd_args: str, project_path: Path, ws: WebSocket, public_dir: Path, public_base_url: str) -> str:
    project_root = project_path.resolve()
    source_arg, token_arg = parse_share_args(cmd_args)
    source, error = resolve_share_source(project_root, source_arg)
    if error:
        return error
    assert source is not None

    ext = source.suffix.lower()
    public_dir.mkdir(parents=True, exist_ok=True)

    if ext in {".html", ".pdf"}:
        output_name = sanitize_public_name(source.name)
        destination = (public_dir / output_name).resolve()
        if destination.parent != public_dir.resolve():
            return "Invalid destination"
        destination.write_bytes(source.read_bytes())
    else:
        content = source.read_text(errors="replace")
        is_marp = content.lstrip().startswith("---") and "marp:" in content[:500]
        if is_marp:
            output_name = sanitize_public_name(f"{source.stem}.html")
            destination = (public_dir / output_name).resolve()
            if destination.parent != public_dir.resolve():
                return "Invalid destination"
            proc = await asyncio.create_subprocess_exec(
                "marp", "--html", str(source), "-o", str(destination),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                err = stderr.decode(errors="replace").strip()
                return f"Marp build failed: {err or 'unknown error'}"
        else:
            output_name = sanitize_public_name(source.name)
            destination = (public_dir / output_name).resolve()
            if destination.parent != public_dir.resolve():
                return "Invalid destination"
            destination.write_text(content)

    access_key = shared_access_key(output_name)
    rules = load_public_access(public_dir)
    existing_tokens = [t for t in rules.get(access_key, []) if t]
    token = token_arg or (existing_tokens[0] if existing_tokens else uuid4().hex[:12])
    rules[access_key] = [token]
    save_public_access(public_dir, rules)
    return share_output(output_name, ws, public_base_url, token=token)


def resolve_unshare_target(public_root: Path, raw_path: str) -> str | None:
    rel_path = raw_path.strip()
    if rel_path.startswith("@"):
        rel_path = rel_path[1:]
    rel_path = rel_path.strip()
    if not rel_path:
        return None
    direct = (public_root / rel_path).resolve()
    if str(direct).startswith(str(public_root)) and direct.is_file() and direct.suffix.lower() in {".md", ".html", ".pdf"}:
        return shared_access_key(direct.name)
    return shared_access_key(rel_path)


async def handle_shares(ws: WebSocket, public_dir: Path, public_base_url: str) -> str:
    rules = load_public_access(public_dir)
    public_root = public_dir.resolve()
    shared_files: dict[str, str] = {}
    if public_root.exists():
        for file_path in sorted(public_root.iterdir()):
            if not file_path.is_file() or file_path.name.startswith("."):
                continue
            if file_path.suffix.lower() not in {".md", ".html", ".pdf"}:
                continue
            shared_files[shared_access_key(file_path.name)] = file_path.name

    if not shared_files:
        return "No shared files"

    lines: list[str] = []
    for slug, filename in shared_files.items():
        tokens = [t for t in rules.get(slug, []) if t]
        url = share_url_for_slug(slug, ws, public_base_url, tokens[0] if tokens else None)
        lines.append(f"{filename}: {url}")
    return "\n".join(lines)


async def handle_unshare(cmd_args: str, public_dir: Path) -> str:
    slug = resolve_unshare_target(public_dir.resolve(), cmd_args)
    if not slug:
        return "Usage: /unshare <path-or-slug>"
    removed_files: list[str] = []
    pdf_target = (public_dir / slug).resolve()
    if pdf_target.parent == public_dir.resolve() and pdf_target.is_file() and pdf_target.suffix.lower() == ".pdf":
        pdf_target.unlink()
        removed_files.append(pdf_target.name)
    for ext in (".html", ".md"):
        target = (public_dir / f"{slug}{ext}").resolve()
        if target.parent == public_dir.resolve() and target.is_file():
            target.unlink()
            removed_files.append(target.name)
    rules = load_public_access(public_dir)
    rules.pop(slug, None)
    save_public_access(public_dir, rules)
    if not removed_files:
        return f"Nothing shared for {slug}"
    return f"Unshared {', '.join(removed_files)}"
