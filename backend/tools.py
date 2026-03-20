"""Server-side tools for the coding agent."""

from __future__ import annotations

import asyncio
import difflib
import json
import os
import signal
from contextvars import ContextVar
from pathlib import Path
from typing import Awaitable, Callable

from backend.protocol import FileChanged
from backend.skills import get_skill

import httpx
from pydantic_ai import RunContext


# Working directory per-run (ContextVar so background tasks keep their own copy)
_workdir: ContextVar[Path] = ContextVar("workdir", default=Path("/srv/remote-lab"))

# Broadcast function for real-time tool notifications (set per-run)
_broadcast_fn: ContextVar[Callable[[str], Awaitable[None]] | None] = ContextVar(
    "broadcast_fn", default=None
)


def get_workdir() -> Path:
    return _workdir.get()


def set_workdir(path: Path):
    _workdir.set(path)


def set_broadcast(fn: Callable[[str], Awaitable[None]] | None):
    """Set the broadcast function for tool call notifications."""
    _broadcast_fn.set(fn)


def clear_broadcast():
    _broadcast_fn.set(None)


async def _notify_tool_output(name: str, chunk: str):
    """Send incremental tool output via the broadcast function, if set."""
    fn = _broadcast_fn.get()
    if fn:
        try:
            await fn(json.dumps({
                "type": "tool-output",
                "name": name,
                "output": chunk,
            }))
        except Exception:
            pass


async def _notify_file_changed(path: str, change: str):
    """Send a file-changed event via the broadcast function, if set."""
    fn = _broadcast_fn.get()
    if fn:
        try:
            await fn(FileChanged(path=path, change=change, run_id="").model_dump_json())
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Tool implementations (standalone functions)
# ---------------------------------------------------------------------------

async def _bash(ctx: RunContext, command: str) -> str:
    """Run a shell command and return stdout+stderr. Use for git, python, npm, etc."""
    workdir = get_workdir()
    proc = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(workdir),
        env=dict(os.environ),
        start_new_session=True,
    )

    chunks: list[str] = []
    total_len = 0
    truncated = False

    try:
        assert proc.stdout is not None
        while True:
            chunk = await proc.stdout.read(4096)
            if not chunk:
                break
            text = chunk.decode(errors="replace")
            total_len += len(text)
            if total_len > 50_000:
                truncated = True
                break
            chunks.append(text)
            await _notify_tool_output("bash", text)

        await proc.wait()
    except asyncio.CancelledError:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        raise

    output = "".join(chunks)
    if truncated:
        output += "\n... (truncated)"
    result = f"exit {proc.returncode}\n{output}"
    return result


async def _read_file(ctx: RunContext, path: str) -> str:
    """Read a file's contents. Path is relative to the working directory."""
    workdir = get_workdir()
    p = (workdir / path).resolve()
    if not str(p).startswith(str(workdir)):
        result = "Error: path outside working directory"
        return result
    try:
        text = p.read_text(errors="replace")
        if len(text) > 100_000:
            text = text[:100_000] + "\n... (truncated)"
        return text
    except Exception as e:
        result = f"Error: {e}"
        return result


async def _write_file(ctx: RunContext, path: str, content: str) -> str:
    """Write content to a file. Creates parent directories if needed."""
    workdir = get_workdir()
    p = (workdir / path).resolve()
    if not str(p).startswith(str(workdir)):
        result = "Error: path outside working directory"
        return result
    try:
        existed = p.exists()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        result = f"Wrote {len(content)} bytes to {path}"
        await _notify_file_changed(path, "updated" if existed else "created")
        return result
    except Exception as e:
        result = f"Error: {e}"
        return result


async def _edit_file(ctx: RunContext, path: str, old_string: str, new_string: str) -> str:
    """Replace the first occurrence of old_string with new_string in a file."""
    workdir = get_workdir()
    p = (workdir / path).resolve()
    if not str(p).startswith(str(workdir)):
        result = "Error: path outside working directory"
        return result
    try:
        before_text = p.read_text()
        if old_string not in before_text:
            result = "Error: old_string not found in file"
            return result
        after_text = before_text.replace(old_string, new_string, 1)
        p.write_text(after_text)
        diff_lines = list(
            difflib.unified_diff(
                before_text.splitlines(),
                after_text.splitlines(),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
                lineterm="",
                n=3,
            )
        )
        await _notify_file_changed(path, "updated")
        return json.dumps({
            "status": "OK",
            "output": "OK",
            "diff": "\n".join(diff_lines),
        })
    except Exception as e:
        result = f"Error: {e}"
        return result


async def _glob(ctx: RunContext, pattern: str) -> str:
    """Find files matching a glob pattern (e.g. '**/*.py'). Returns newline-separated paths."""
    workdir = get_workdir()
    matches = sorted(workdir.glob(pattern))
    results = []
    for m in matches[:200]:
        if str(m.resolve()).startswith(str(workdir)):
            results.append(str(m.relative_to(workdir)))
    result = "\n".join(results) if results else "No matches"
    return result


async def _grep(ctx: RunContext, pattern: str, path: str = ".", include: str = "") -> str:
    """Search file contents with ripgrep. Returns matching lines with file:line format."""
    workdir = get_workdir()
    cmd = ["rg", "--no-heading", "--line-number", "--max-count=50", pattern]
    if include:
        cmd.extend(["--glob", include])
    cmd.append(path)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(workdir),
    )
    stdout, _ = await proc.communicate()
    output = stdout.decode(errors="replace")
    if len(output) > 30_000:
        output = output[:30_000] + "\n... (truncated)"
    result = output or "No matches"
    return result


_brave_key = os.environ.get("BRAVE_API_KEY")


async def _web_search(ctx: RunContext, query: str, count: int = 5) -> str:
    """Search the web using Brave Search. Returns top results with title, URL, and description."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": min(count, 10)},
                headers={
                    "Accept": "application/json",
                    "X-Subscription-Token": _brave_key or "",
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        result = f"Error: {e}"
        return result

    results = data.get("web", {}).get("results", [])
    if not results:
        return "No results found."

    lines = []
    for r in results:
        lines.append(f"**{r.get('title', '')}**")
        lines.append(r.get("url", ""))
        lines.append(r.get("description", ""))
        lines.append("")

    output = "\n".join(lines)
    return output


async def _activate_skill(ctx: RunContext, name: str) -> str:
    """Load a packaged agent skill by name and return structured instructions plus resource listings."""
    workdir = get_workdir()
    skill = get_skill(name, workdir if workdir.is_dir() else None)
    if not skill or skill.type != "prompt" or not skill.location:
        return f"Error: skill not found: {name}"

    skill_file = Path(skill.location).resolve()
    skill_dir = skill_file.parent
    try:
        relative_skill_dir = skill_dir.relative_to(workdir)
        skill_dir_display = relative_skill_dir.as_posix()
    except ValueError:
        skill_dir_display = str(skill_dir)

    resources: list[str] = []
    for subdir in ("scripts", "references", "assets"):
        base = skill_dir / subdir
        if not base.is_dir():
            continue
        for file in sorted(p for p in base.rglob("*") if p.is_file())[:200]:
            resources.append(file.relative_to(skill_dir).as_posix())

    resource_block = ""
    if resources:
        resource_lines = "\n".join(f"<file>{path}</file>" for path in resources)
        resource_block = f"\n\n<skill_resources>\n{resource_lines}\n</skill_resources>"

    return (
        f"<skill_content name=\"{skill.name}\">\n"
        f"{skill.prompt}\n\n"
        f"Skill directory: {skill_dir_display}\n"
        "Relative paths in this skill are relative to the skill directory."
        f"{resource_block}\n"
        f"</skill_content>"
    )


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

# All available tools: name → (impl,)
ALL_TOOLS: dict[str, tuple] = {
    "bash": (_bash,),
    "read_file": (_read_file,),
    "write_file": (_write_file,),
    "edit_file": (_edit_file,),
    "glob": (_glob,),
    "grep": (_grep,),
    "activate_skill": (_activate_skill,),
}

if _brave_key:
    ALL_TOOLS["web_search"] = (_web_search,)

# Tools that require user approval before execution
APPROVAL_REQUIRED = {"bash", "write_file", "edit_file"}


def register(agent, allowed: list[str] | None = None):
    """Register tools on the given PydanticAI agent.

    If *allowed* is set, only register tools whose names are in that list.
    """
    for name, (impl,) in ALL_TOOLS.items():
        if allowed is not None and name not in allowed:
            continue
        # PydanticAI uses __name__ for the tool name — override the leading underscore
        impl.__name__ = name
        agent.tool(impl, requires_approval=name in APPROVAL_REQUIRED)
