"""Server-side tools for the coding agent."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from fnmatch import fnmatch

from pydantic_ai import RunContext


# The working directory the agent operates in (set by the caller)
WORKDIR = Path("/srv/remote-lab")


def register(agent):
    """Register all tools on the given PydanticAI agent."""

    @agent.tool
    async def bash(ctx: RunContext, command: str) -> str:
        """Run a shell command and return stdout+stderr. Use for git, python, npm, etc."""
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
