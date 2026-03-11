"""Server-side tools for the coding agent."""

from __future__ import annotations

import asyncio
import json
import os
from contextvars import ContextVar
from pathlib import Path
from typing import Awaitable, Callable

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


async def _notify_tool(name: str, input_summary: str):
    """Send a tool-use event via the broadcast function, if set."""
    fn = _broadcast_fn.get()
    if fn:
        try:
            await fn(json.dumps({
                "type": "tool-use",
                "name": name,
                "input": input_summary[:200],
            }))
        except Exception:
            pass


async def _notify_tool_result(name: str, output: str):
    """Send a tool-result event via the broadcast function, if set."""
    fn = _broadcast_fn.get()
    if fn:
        try:
            await fn(json.dumps({
                "type": "tool-result",
                "name": name,
                "output": output[:500],
            }))
        except Exception:
            pass


def register(agent):
    """Register all tools on the given PydanticAI agent."""

    @agent.tool
    async def bash(ctx: RunContext, command: str) -> str:
        """Run a shell command and return stdout+stderr. Use for git, python, npm, etc."""
        await _notify_tool("bash", command)
        workdir = get_workdir()
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(workdir),
            env={**os.environ, "HOME": str(workdir)},
        )
        stdout, _ = await proc.communicate()
        output = stdout.decode(errors="replace")
        # Truncate very long output
        if len(output) > 50_000:
            output = output[:50_000] + "\n... (truncated)"
        result = f"exit {proc.returncode}\n{output}"
        await _notify_tool_result("bash", result)
        return result

    @agent.tool
    async def read_file(ctx: RunContext, path: str) -> str:
        """Read a file's contents. Path is relative to the working directory."""
        await _notify_tool("read_file", path)
        workdir = get_workdir()
        p = (workdir / path).resolve()
        if not str(p).startswith(str(workdir)):
            result = "Error: path outside working directory"
            await _notify_tool_result("read_file", result)
            return result
        try:
            text = p.read_text(errors="replace")
            if len(text) > 100_000:
                text = text[:100_000] + "\n... (truncated)"
            await _notify_tool_result("read_file", f"{len(text)} chars")
            return text
        except Exception as e:
            result = f"Error: {e}"
            await _notify_tool_result("read_file", result)
            return result

    @agent.tool
    async def write_file(ctx: RunContext, path: str, content: str) -> str:
        """Write content to a file. Creates parent directories if needed."""
        await _notify_tool("write_file", path)
        workdir = get_workdir()
        p = (workdir / path).resolve()
        if not str(p).startswith(str(workdir)):
            result = "Error: path outside working directory"
            await _notify_tool_result("write_file", result)
            return result
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            result = f"Wrote {len(content)} bytes to {path}"
            await _notify_tool_result("write_file", result)
            return result
        except Exception as e:
            result = f"Error: {e}"
            await _notify_tool_result("write_file", result)
            return result

    @agent.tool
    async def edit_file(ctx: RunContext, path: str, old_string: str, new_string: str) -> str:
        """Replace the first occurrence of old_string with new_string in a file."""
        await _notify_tool("edit_file", path)
        workdir = get_workdir()
        p = (workdir / path).resolve()
        if not str(p).startswith(str(workdir)):
            result = "Error: path outside working directory"
            await _notify_tool_result("edit_file", result)
            return result
        try:
            text = p.read_text()
            if old_string not in text:
                result = "Error: old_string not found in file"
                await _notify_tool_result("edit_file", result)
                return result
            text = text.replace(old_string, new_string, 1)
            p.write_text(text)
            await _notify_tool_result("edit_file", "OK")
            return "OK"
        except Exception as e:
            result = f"Error: {e}"
            await _notify_tool_result("edit_file", result)
            return result

    @agent.tool
    async def glob(ctx: RunContext, pattern: str) -> str:
        """Find files matching a glob pattern (e.g. '**/*.py'). Returns newline-separated paths."""
        await _notify_tool("glob", pattern)
        workdir = get_workdir()
        matches = sorted(workdir.glob(pattern))
        # Filter to within workdir and limit results
        results = []
        for m in matches[:200]:
            if str(m.resolve()).startswith(str(workdir)):
                results.append(str(m.relative_to(workdir)))
        result = "\n".join(results) if results else "No matches"
        await _notify_tool_result("glob", f"{len(results)} matches")
        return result

    @agent.tool
    async def grep(ctx: RunContext, pattern: str, path: str = ".", include: str = "") -> str:
        """Search file contents with ripgrep. Returns matching lines with file:line format."""
        await _notify_tool("grep", pattern)
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
        await _notify_tool_result("grep", result)
        return result
