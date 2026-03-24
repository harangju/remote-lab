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

from backend.data.protocol import AgentStart, FileChanged
from backend.agent.skills import get_skill

import httpx
from pydantic_ai import RunContext
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPartDelta,
)


# Working directory per-run (ContextVar so background tasks keep their own copy)
_workdir: ContextVar[Path] = ContextVar("workdir", default=Path("/srv/remote-lab"))

# Broadcast function for real-time tool notifications (set per-run)
_broadcast_fn: ContextVar[Callable[[str], Awaitable[None]] | None] = ContextVar(
    "broadcast_fn", default=None
)

# Agent configs available for delegation (set per-run)
_agent_configs: ContextVar[list] = ContextVar("agent_configs", default=[])
# Model override for the current conversation (set per-run)
_model_override: ContextVar[str | None] = ContextVar("model_override", default=None)
# Run ID for the current run (set per-run)
_run_id: ContextVar[str] = ContextVar("run_id", default="")


def get_workdir() -> Path:
    return _workdir.get()


def set_workdir(path: Path):
    _workdir.set(path)


def set_broadcast(fn: Callable[[str], Awaitable[None]] | None):
    """Set the broadcast function for tool call notifications."""
    _broadcast_fn.set(fn)


def clear_broadcast():
    _broadcast_fn.set(None)


def set_delegate_context(
    agent_configs: list,
    model_override: str | None,
    run_id: str,
):
    """Set context needed by the delegate tool."""
    _agent_configs.set(agent_configs)
    _model_override.set(model_override)
    _run_id.set(run_id)


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


def _expand_braces(pattern: str) -> list[str]:
    """Expand top-level brace groups like '{a,b,c}' into individual patterns."""
    import re
    m = re.fullmatch(r"\{([^}]+)\}", pattern)
    if m:
        return [p.strip() for p in m.group(1).split(",")]
    # Check for brace group embedded in a larger pattern (e.g. 'src/{a,b}/*.py')
    m = re.search(r"\{([^}]+)\}", pattern)
    if m:
        prefix = pattern[:m.start()]
        suffix = pattern[m.end():]
        return [prefix + p.strip() + suffix for p in m.group(1).split(",")]
    return [pattern]


async def _glob(ctx: RunContext, pattern: str) -> str:
    """Find files matching a glob pattern (e.g. '**/*.py'). Returns newline-separated paths."""
    workdir = get_workdir()
    patterns = _expand_braces(pattern)
    seen: set[str] = set()
    results: list[str] = []
    for pat in patterns:
        for m in sorted(workdir.glob(pat)):
            if str(m.resolve()).startswith(str(workdir)):
                rel = str(m.relative_to(workdir))
                if rel not in seen:
                    seen.add(rel)
                    results.append(rel)
            if len(results) >= 200:
                break
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


async def _delegate(ctx: RunContext, agent_id: str, task: str) -> str:
    """Delegate a task to a sub-agent. The sub-agent runs independently with its own context window.

    Multiple delegate calls in the same response run in PARALLEL — use this for
    concurrent work (e.g. one agent researches while another implements).

    The sub-agent has access to project tools (bash, read_file, etc.) and runs
    to completion. You receive its final output as the return value.

    Args:
        agent_id: The ID of the agent to delegate to (e.g. "worker", "reviewer").
        task: A clear, self-contained description of what the sub-agent should do.
              Include all necessary context — the sub-agent has no memory of this conversation.
    """
    from backend.agent.agents import create_agent

    configs = _agent_configs.get()
    config = next((c for c in configs if c.id == agent_id), None)
    if not config:
        available = ", ".join(c.id for c in configs)
        return f"Error: unknown agent '{agent_id}'. Available: {available}"

    model_override = _model_override.get()
    run_id = _run_id.get()
    parent_broadcast = _broadcast_fn.get()

    # Create a sub-agent with no tool approval (parent approved the delegation).
    # Exclude delegate from sub-agent tools to prevent infinite recursion.
    sub_tools = config.tools
    if sub_tools is None:
        sub_tools = [name for name in ALL_TOOLS if name != "delegate"]
    elif "delegate" in sub_tools:
        sub_tools = [t for t in sub_tools if t != "delegate"]
    sub_config = type(config)(**{**config.model_dump(), "tools": sub_tools})
    sub_agent = create_agent(sub_config, model_override=model_override, skip_approval=True)

    # Wrap broadcast to tag all events with the sub-agent's agent_id
    async def sub_broadcast(msg_str: str):
        if not parent_broadcast:
            return
        try:
            payload = json.loads(msg_str)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            payload["agent_id"] = agent_id
            payload.setdefault("run_id", run_id)
            msg_str = json.dumps(payload)
        await parent_broadcast(msg_str)

    # Set ContextVars for this task (isolated — won't affect sibling tasks)
    set_broadcast(sub_broadcast)

    # Announce sub-agent start
    await sub_broadcast(AgentStart(
        run_id=run_id,
        agent_id=config.id,
        agent_name=config.name,
        agent_color=config.color,
        agent_model=config.model or model_override,
    ).model_dump_json())

    full_text = ""
    try:
        async with sub_agent.iter(task) as agent_run:
            async for node in agent_run:
                if sub_agent.is_model_request_node(node):
                    async with node.stream(agent_run.ctx) as stream:
                        async for event in stream:
                            if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart) and event.part.content:
                                full_text += event.part.content
                                await sub_broadcast(json.dumps({
                                    "type": "text-delta",
                                    "delta": event.part.content,
                                    "run_id": run_id,
                                    "agent_id": agent_id,
                                }))
                            elif isinstance(event, PartDeltaEvent):
                                if isinstance(event.delta, TextPartDelta) and event.delta.content_delta:
                                    full_text += event.delta.content_delta
                                    await sub_broadcast(json.dumps({
                                        "type": "text-delta",
                                        "delta": event.delta.content_delta,
                                        "run_id": run_id,
                                        "agent_id": agent_id,
                                    }))
                                elif isinstance(event.delta, ThinkingPartDelta) and event.delta.content_delta:
                                    await sub_broadcast(json.dumps({
                                        "type": "thinking-delta",
                                        "delta": event.delta.content_delta,
                                        "run_id": run_id,
                                        "agent_id": agent_id,
                                    }))
                elif sub_agent.is_call_tools_node(node):
                    async with node.stream(agent_run.ctx) as tool_stream:
                        async for event in tool_stream:
                            if isinstance(event, FunctionToolCallEvent):
                                await sub_broadcast(json.dumps({
                                    "type": "tool-use",
                                    "name": event.part.tool_name,
                                    "input": str(event.part.args)[:200],
                                    "tool_call_id": getattr(event.part, "tool_call_id", "") or "",
                                    "run_id": run_id,
                                    "agent_id": agent_id,
                                }))
                            elif isinstance(event, FunctionToolResultEvent):
                                raw_content = getattr(event.result, "content", None)
                                if raw_content is None:
                                    raw_content = event.content
                                output = str(raw_content)[:500] if raw_content else "OK"
                                await sub_broadcast(json.dumps({
                                    "type": "tool-result",
                                    "name": event.result.tool_name if hasattr(event.result, "tool_name") else "",
                                    "output": output,
                                    "tool_call_id": getattr(event.result, "tool_call_id", "") or "",
                                    "run_id": run_id,
                                    "agent_id": agent_id,
                                }))
    except Exception as e:
        return f"Error running sub-agent '{agent_id}': {e}"

    # Truncate very long outputs so the parent's context doesn't explode
    if len(full_text) > 10_000:
        full_text = full_text[:10_000] + "\n... (truncated)"

    return full_text or "(sub-agent produced no text output)"


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
    "delegate": (_delegate,),
}

if _brave_key:
    ALL_TOOLS["web_search"] = (_web_search,)

# Tools that require user approval before execution
APPROVAL_REQUIRED = {"bash", "write_file", "edit_file"}


def register(agent, allowed: list[str] | None = None, *, skip_approval: bool = False):
    """Register tools on the given PydanticAI agent.

    If *allowed* is set, only register tools whose names are in that list.
    If *skip_approval* is True, all tools are registered without requiring approval
    (used for sub-agents spawned by the delegate tool).
    """
    for name, (impl,) in ALL_TOOLS.items():
        if allowed is not None and name not in allowed:
            continue
        # PydanticAI uses __name__ for the tool name — override the leading underscore
        impl.__name__ = name
        needs_approval = False if skip_approval else name in APPROVAL_REQUIRED
        agent.tool(impl, requires_approval=needs_approval)
