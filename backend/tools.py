"""Server-side tools for the coding agent."""

from __future__ import annotations

import asyncio
import json
import os
from contextvars import ContextVar
from pathlib import Path
from fnmatch import fnmatch

from pydantic_ai import RunContext


# The working directory the agent operates in (set by the caller)
WORKDIR = Path("/srv/remote-lab")

# WebSocket reference for real-time tool notifications
_active_ws: ContextVar = ContextVar("active_ws", default=None)


def set_active_ws(ws):
    """Set the active WebSocket for tool call notifications."""
    _active_ws.set(ws)


def clear_active_ws():
    _active_ws.set(None)


async def _notify_tool(name: str, input_summary: str):
    """Send a tool-use event over the active WebSocket, if any."""
    ws = _active_ws.get()
    if ws:
        try:
            await ws.send_text(json.dumps({
                "type": "tool-use",
                "name": name,
                "input": input_summary[:200],
            }))
        except Exception:
            pass


def register(agent):
    """Register all tools on the given PydanticAI agent."""

    @agent.tool
    async def bash(ctx: RunContext, command: str) -> str:
        """Run a shell command and return stdout+stderr. Use for git, python, npm, etc."""
        await _notify_tool("bash", command)
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(WORKDIR),
            env={**os.environ, "HOME": str(WORKDIR)},
        )
        stdout, _ = await proc.communicate()
        output = stdout.decode(errors="replace")
        # Truncate very long output
        if len(output) > 50_000:
            output = output[:50_000] + "\n... (truncated)"
        return f"exit {proc.returncode}\n{output}"

    @agent.tool
    async def read_file(ctx: RunContext, path: str) -> str:
        """Read a file's contents. Path is relative to the working directory."""
        await _notify_tool("read_file", path)
        p = (WORKDIR / path).resolve()
        if not str(p).startswith(str(WORKDIR)):
            return "Error: path outside working directory"
        try:
            text = p.read_text(errors="replace")
            if len(text) > 100_000:
                text = text[:100_000] + "\n... (truncated)"
            return text
        except Exception as e:
            return f"Error: {e}"

    @agent.tool
    async def write_file(ctx: RunContext, path: str, content: str) -> str:
        """Write content to a file. Creates parent directories if needed."""
        await _notify_tool("write_file", path)
        p = (WORKDIR / path).resolve()
        if not str(p).startswith(str(WORKDIR)):
            return "Error: path outside working directory"
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            return f"Wrote {len(content)} bytes to {path}"
        except Exception as e:
            return f"Error: {e}"

    @agent.tool
    async def edit_file(ctx: RunContext, path: str, old_string: str, new_string: str) -> str:
        """Replace the first occurrence of old_string with new_string in a file."""
        await _notify_tool("edit_file", path)
        p = (WORKDIR / path).resolve()
        if not str(p).startswith(str(WORKDIR)):
            return "Error: path outside working directory"
        try:
            text = p.read_text()
            if old_string not in text:
                return "Error: old_string not found in file"
            text = text.replace(old_string, new_string, 1)
            p.write_text(text)
            return "OK"
        except Exception as e:
            return f"Error: {e}"

    @agent.tool
    async def glob(ctx: RunContext, pattern: str) -> str:
        """Find files matching a glob pattern (e.g. '**/*.py'). Returns newline-separated paths."""
        await _notify_tool("glob", pattern)
        matches = sorted(WORKDIR.glob(pattern))
        # Filter to within workdir and limit results
        results = []
        for m in matches[:200]:
            if str(m.resolve()).startswith(str(WORKDIR)):
                results.append(str(m.relative_to(WORKDIR)))
        return "\n".join(results) if results else "No matches"

    @agent.tool
    async def grep(ctx: RunContext, pattern: str, path: str = ".", include: str = "") -> str:
        """Search file contents with ripgrep. Returns matching lines with file:line format."""
        await _notify_tool("grep", pattern)
        cmd = ["rg", "--no-heading", "--line-number", "--max-count=50", pattern]
        if include:
            cmd.extend(["--glob", include])
        cmd.append(path)
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(WORKDIR),
        )
        stdout, _ = await proc.communicate()
        output = stdout.decode(errors="replace")
        if len(output) > 30_000:
            output = output[:30_000] + "\n... (truncated)"
        return output or "No matches"
