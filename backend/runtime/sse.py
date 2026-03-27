"""SSE stream + REST endpoints for chat — replaces WebSocket for everything except voice."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from pydantic_ai.messages import ModelMessagesTypeAdapter, UserContent

from backend.agent.agent_config import AgentConfig
from backend.agent.agents import create_agent, _available
from backend.agent.compact import compact, needs_compaction, needs_context_management
from backend.agent.context_manager import manage_context
from backend.agent.context import build_project_instructions
from backend.agent.mentions import extract_file_mentions, parse_mentions
from backend.agent.permissions import add_project_rule
from backend.agent.skills import SkillType, get_skill, get_skills
from backend.agent import tools as agent_tools
from backend.data import storage
from backend.data.models import ConvoStatus
from backend.data.protocol import AgentStart, Compacted, Done, Running, SkillResult, Sync
from backend.runtime.runner import build_multimodal_prompt, run_agent_task, run_bash_command_task
from backend.runtime.state import RunState, get_session, processed_message_ids, seen_tool_call_ids, sessions


def _new_run_id() -> str:
    return uuid4().hex[:12]


# ---------------------------------------------------------------------------
# Per-conversation mutable caches (keyed by convo_id, lazily populated)
# ---------------------------------------------------------------------------

_convo_caches: dict[str, dict[str, Any]] = {}


def _cache(convo_id: str) -> dict[str, Any]:
    if convo_id not in _convo_caches:
        _convo_caches[convo_id] = {
            "agent_cache": {},
            "instructions": None,
            "instructions_subsequent": None,
            "instructions_loaded": False,
            "agent_histories": {},
            "messages_cache": None,
        }
    return _convo_caches[convo_id]


def _get_cached_messages(convo_id: str) -> list[dict]:
    c = _cache(convo_id)
    if c["messages_cache"] is None:
        c["messages_cache"] = storage.read_events(convo_id)
    return c["messages_cache"]


def _invalidate_message_cache(convo_id: str):
    c = _cache(convo_id)
    c["messages_cache"] = None


def _load_history(convo_id: str, agent_id: str | None) -> tuple[list, int]:
    c = _cache(convo_id)
    histories = c["agent_histories"]
    if agent_id in histories:
        return histories[agent_id]
    hist: list = []
    ctx_tokens = 0
    hist_bytes = storage.load_agent_history(convo_id, agent_id=agent_id)
    if hist_bytes:
        try:
            hist = ModelMessagesTypeAdapter.validate_json(hist_bytes)
            for msg in reversed(_get_cached_messages(convo_id)):
                if msg.get("role") == "assistant" and "context_tokens" in msg:
                    if agent_id is None or msg.get("agent_id") == agent_id:
                        ctx_tokens = msg["context_tokens"]
                        break
            print(f"sse[{convo_id[:8]}]: restored {len(hist)} messages for agent={agent_id or 'default'}")
        except Exception as e:
            print(f"sse[{convo_id[:8]}]: failed to restore history for agent={agent_id}: {e}")
            hist = []
    histories[agent_id] = (hist, ctx_tokens)
    return hist, ctx_tokens


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class SendMessage(BaseModel):
    text: str
    message_id: str | None = None
    attachments: list[dict[str, Any]] = []


class StopRun(BaseModel):
    run_id: str


class ApproveToolCall(BaseModel):
    tool_call_id: str
    run_id: str
    approved: bool
    scope: str = "once"


class RunCommand(BaseModel):
    command: str


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def create_sse_router(
    *,
    check_token,
    append_event,
    append_message,
    update_conversation_status,
    save_agent_history,
    update_conversation_title,
    broadcast_conversation_event,
    user_event,
    tool_event,
    system_event,
    parse_tool_content,
    build_shared_context,
    auto_title,
    iso_now,
    get_workdir,
):
    _bearer = HTTPBearer()

    async def require_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
        if not check_token(credentials.credentials):
            raise HTTPException(status_code=401, detail="Invalid token")
        return credentials.credentials

    router = APIRouter(prefix="/api/convos", dependencies=[Depends(require_token)])

    # -----------------------------------------------------------------------
    # SSE stream
    # -----------------------------------------------------------------------

    @router.get("/{convo_id}/stream")
    async def sse_stream(convo_id: str, request: Request):
        convo = storage.get_conversation(convo_id)
        if convo is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        project = storage.get_project(convo.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        session = get_session(convo_id)
        client_id = uuid4().hex[:12]
        queue = session.register_sse(client_id)
        print(f"sse[{convo_id[:8]}]: client {client_id} connected (clients: {len(session.sse_queues)})")

        # Handle stale "running" status from server restart
        if convo.status == ConvoStatus.running and session.run is None:
            await update_conversation_status(convo_id, ConvoStatus.error)
            restart_event = system_event("Server restarted during run", event_type="run-error", recoverable=False)
            await append_event(convo_id, restart_event)

        # Seed seen_tool_call_ids
        existing_tc_ids = seen_tool_call_ids(convo_id)
        if not existing_tc_ids:
            for evt in _get_cached_messages(convo_id):
                if evt.get("type") == "tool-call":
                    tc_id = evt.get("tool_call_id")
                    if tc_id:
                        existing_tc_ids.add(tc_id)

        # Preload history for default agent
        _load_history(convo_id, None)

        last_event_id = request.headers.get("last-event-id")

        async def event_generator():
            event_id = 0

            # Replay active run events if reconnecting or joining mid-run
            run = session.run
            has_active_run = bool(run and run.status == "running")

            if has_active_run:
                yield _sse_event(event_id, "running", Running(run_id=run.run_id).model_dump_json())
                event_id += 1

                # Determine replay start point
                replay_from = 0
                if last_event_id:
                    try:
                        replay_from = int(last_event_id) + 1
                    except ValueError:
                        pass

                for i, event_str in enumerate(run.events):
                    if i >= replay_from:
                        yield _sse_event(event_id, "event", event_str)
                        event_id += 1

            yield _sse_event(event_id, "sync", Sync(running=has_active_run).model_dump_json())
            event_id += 1

            # Stream events from queue
            try:
                while True:
                    # Check if client disconnected
                    if await request.is_disconnected():
                        break
                    try:
                        msg_str = await asyncio.wait_for(queue.get(), timeout=30)
                        yield _sse_event(event_id, "event", msg_str)
                        event_id += 1
                    except asyncio.TimeoutError:
                        # SSE keepalive comment
                        yield ": keepalive\n\n"
            finally:
                session.unregister_sse(client_id)
                print(f"sse[{convo_id[:8]}]: client {client_id} disconnected (clients: {len(session.sse_queues)})")

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # -----------------------------------------------------------------------
    # POST /messages — send a user message
    # -----------------------------------------------------------------------

    @router.post("/{convo_id}/messages")
    async def send_message(convo_id: str, body: SendMessage, request: Request = None):
        convo = storage.get_conversation(convo_id)
        if convo is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        project = storage.get_project(convo.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        project_path = Path(project.path)
        if not project_path.exists() or not project_path.is_dir():
            raise HTTPException(status_code=400, detail=f"Project path does not exist: {project.path}")

        session = get_session(convo_id)

        # Dedup
        if body.message_id:
            seen_ids = processed_message_ids.setdefault(convo_id, set())
            if body.message_id in seen_ids:
                return {"status": "ack", "message_id": body.message_id}

        # Check for active run
        completed_run = session.run
        if completed_run and completed_run.task and completed_run.task.done():
            c = _cache(convo_id)
            c["agent_histories"][None] = (completed_run.message_history, completed_run.last_context_tokens)
            session.run = None
        elif completed_run and completed_run.status == "running":
            raise HTTPException(status_code=409, detail="Agent is still running")

        prompt = body.text.strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="Empty message")

        attachments = [a for a in body.attachments if isinstance(a, dict) and a.get("path")]

        # Handle raw_text prefixed with \! (escaped bang)
        raw_text = body.text
        if raw_text.startswith("\\!"):
            prompt = raw_text[1:]

        project_agents = storage.load_project_agents(project.id)

        # Handle slash commands
        if prompt.strip().startswith("/"):
            return await _handle_command(
                convo_id, project, project_path, project_agents,
                prompt, body.message_id, attachments,
                append_event=append_event, append_message=append_message,
                update_conversation_status=update_conversation_status,
                save_agent_history=save_agent_history,
                user_event=user_event, tool_event=tool_event,
                system_event=system_event, iso_now=iso_now,
                request=request,
            )

        # Check for bash mode (! prefix)
        bash_command = ""
        if raw_text.startswith("!"):
            bash_command = raw_text[1:]
            if not bash_command.strip():
                raise HTTPException(status_code=400, detail="Empty bash command")

        _invalidate_message_cache(convo_id)
        await append_message(
            convo_id,
            user_event(
                prompt,
                message_id=body.message_id,
                attachments=attachments or None,
                bash_mode=raw_text.startswith("!"),
            ),
        )
        if body.message_id:
            processed_message_ids.setdefault(convo_id, set()).add(body.message_id)

        # Auto-title
        current_meta = storage._read_meta(convo_id)
        if current_meta and current_meta.title == "Untitled":
            asyncio.create_task(auto_title(convo_id, prompt))

        await update_conversation_status(convo_id, ConvoStatus.running)

        run = RunState(convo_id=convo_id, run_id=_new_run_id())
        session.run = run

        # Broadcast running event to all SSE clients
        running_event = Running(run_id=run.run_id).model_dump_json()
        run.events.append(running_event)
        session.broadcast(running_event)

        if raw_text.startswith("!"):
            agent_tools.set_workdir(project_path)
            run.task = asyncio.create_task(
                run_bash_command_task(
                    run, bash_command.strip(), convo_id,
                    iso_now=iso_now, append_event=append_event,
                    append_message=append_message,
                    update_conversation_status=update_conversation_status,
                    system_event=system_event, get_workdir=get_workdir,
                )
            )
            return {"status": "ok", "run_id": run.run_id}

        # Agent run
        c = _cache(convo_id)
        if not c["instructions_loaded"]:
            c["instructions"] = await asyncio.to_thread(build_project_instructions, project_path, True, project_agents)
            c["instructions_subsequent"] = await asyncio.to_thread(build_project_instructions, project_path, False, project_agents)
            c["instructions_loaded"] = True

        if raw_text.startswith("!"):
            target_agents = [None]
            cleaned_prompt = prompt
        elif project_agents:
            target_agents, cleaned_prompt = parse_mentions(prompt, project_agents)
        else:
            target_agents = [None]
            cleaned_prompt = prompt

        file_refs, cleaned_prompt = extract_file_mentions(cleaned_prompt, project_path)
        non_image_attachment_lines: list[str] = []
        for attachment in attachments:
            rel_path = str(attachment.get("path", "")).strip()
            if not rel_path:
                continue
            target = (project_path / rel_path).resolve()
            if not str(target).startswith(str(project_path.resolve())) or not target.is_file():
                continue
            kind = attachment.get("kind", "file")
            if kind == "image":
                non_image_attachment_lines.append(f"[Attached image: {rel_path}]")
            else:
                non_image_attachment_lines.append(f"[Attached {kind}: {rel_path}]")
        if file_refs or non_image_attachment_lines:
            file_context_parts: list[str] = []
            if non_image_attachment_lines:
                file_context_parts.append("\n".join(non_image_attachment_lines))
            if file_refs:
                file_context_parts.append("\n\n".join(f"[File: {path}]\n```\n{content}\n```" for path, content in file_refs))
            cleaned_prompt = f"{'\n\n'.join(file_context_parts)}\n\n{cleaned_prompt}"

        agent_prompt = build_multimodal_prompt(cleaned_prompt, attachments, project_path)
        agent_tools.set_workdir(project_path)

        convo_meta_for_model = storage._read_meta(convo_id)
        convo_model = convo_meta_for_model.model if convo_meta_for_model else None

        agent_tools.set_delegate_context(
            agent_configs=project_agents,
            model_override=convo_model,
            run_id=run.run_id,
        )

        MAX_HANDOFFS = 10

        async def _run_with_handoffs():
            _current_targets = target_agents
            _current_prompt: str | list[UserContent] = agent_prompt
            _is_handoff = False
            _handoff_count = 0

            while _current_targets and _handoff_count <= MAX_HANDOFFS:
                _invalidate_message_cache(convo_id)
                runs: list[RunState] = []
                for ac in _current_targets:
                    aid = ac.id if ac else None
                    hist, ctx_tokens = _load_history(convo_id, aid)

                    if hist and needs_context_management(ctx_tokens, convo_model):
                        old_tokens = ctx_tokens
                        ctx_result = await manage_context(hist, ctx_tokens, model_id=convo_model)
                        if ctx_result.actions_taken:
                            hist = ctx_result.messages
                            c["agent_histories"][aid] = (hist, ctx_result.estimated_tokens)
                            actions_summary = "; ".join(ctx_result.actions_taken)
                            await append_message(convo_id, tool_event("compact", event_type="compacted", output=f"{old_tokens / 1000:.1f}k -> {ctx_result.estimated_tokens / 1000:.1f}k tokens ({actions_summary})", run_id=run.run_id))
                            await save_agent_history(convo_id, ModelMessagesTypeAdapter.dump_json(hist), agent_id=aid)
                            compacted_event = Compacted(old_tokens=old_tokens, new_tokens=ctx_result.estimated_tokens).model_dump_json()
                            run.events.append(compacted_event)
                            session.broadcast(compacted_event)

                    is_first_turn = len(hist) == 0
                    instructions = c["instructions"] if is_first_turn else c["instructions_subsequent"]
                    agent_prompt_local = _current_prompt
                    if ac:
                        _invalidate_message_cache(convo_id)
                        shared_ctx = build_shared_context(convo_id, aid, cached_messages=_get_cached_messages(convo_id))
                        if shared_ctx:
                            if isinstance(agent_prompt_local, list):
                                user_text = next((item for item in agent_prompt_local if isinstance(item, str)), "")
                                prefix = "[Handoff from another agent]" if _is_handoff else "[New message from user]"
                                agent_prompt_local = [
                                    f"[Conversation context]\n{shared_ctx}\n\n{prefix}\n{user_text}",
                                    *[item for item in agent_prompt_local if not isinstance(item, str)],
                                ]
                            else:
                                if _is_handoff:
                                    agent_prompt_local = f"[Conversation context]\n{shared_ctx}\n\n[Handoff from another agent]\n{agent_prompt_local}"
                                else:
                                    agent_prompt_local = f"[Conversation context]\n{shared_ctx}\n\n[New message from user]\n{agent_prompt_local}"
                        agent_start = AgentStart(run_id=run.run_id, agent_id=ac.id, agent_name=ac.name, agent_color=ac.color, agent_model=ac.model or convo_model).model_dump_json()
                        run.events.append(agent_start)
                        session.broadcast(agent_start)

                    cache_key = (ac.id if ac else None, convo_model)
                    agent_instance = c["agent_cache"].get(cache_key) or create_agent(ac, model_override=convo_model)
                    c["agent_cache"][cache_key] = agent_instance

                    agent_run = RunState(convo_id=convo_id, run_id=run.run_id, message_history=list(hist))
                    session.run = agent_run
                    agent_run.task = asyncio.create_task(
                        run_agent_task(
                            agent_run, agent_prompt_local, hist, convo_id,
                            instructions=instructions, agent_instance=agent_instance,
                            agent_id=aid, iso_now=iso_now, append_event=append_event,
                            append_message=append_message,
                            update_conversation_status=update_conversation_status,
                            save_agent_history=save_agent_history,
                            system_event=system_event, parse_tool_content=parse_tool_content,
                        )
                    )
                    runs.append(agent_run)

                agent_tasks = {r.task for r in runs if r.task}
                try:
                    if agent_tasks:
                        await asyncio.gather(*agent_tasks)
                except asyncio.CancelledError:
                    for r in runs:
                        if r.task and not r.task.done():
                            r.task.cancel()
                    return

                next_targets: list[AgentConfig] = []
                next_prompt_parts: list[str] = []
                for r in runs:
                    if r.status == "done":
                        aid = r.done_event.get("agent_id") if r.done_event else None
                        c["agent_histories"][aid] = (r.message_history, r.last_context_tokens)
                        if r.full_text and project_agents:
                            mentioned, remaining_text = parse_mentions(r.full_text, project_agents)
                            explicit_mentions = [a for a in mentioned if f"@{a.id}" in r.full_text.lower() or f"@{a.name.lower()}" in r.full_text.lower()]
                            if explicit_mentions:
                                for a in explicit_mentions:
                                    if a.id not in {t.id for t in next_targets}:
                                        next_targets.append(a)
                                next_prompt_parts.append(remaining_text)

                if next_targets and _handoff_count < MAX_HANDOFFS:
                    _handoff_count += 1
                    _current_targets = next_targets
                    _current_prompt = "\n".join(next_prompt_parts) if next_prompt_parts else "Continue."
                    _is_handoff = True
                    _invalidate_message_cache(convo_id)
                    print(f"sse[{convo_id[:8]}]: agent handoff #{_handoff_count} -> {[a.id for a in next_targets]}")
                else:
                    break

        run.task = asyncio.create_task(_run_with_handoffs())
        return {"status": "ok", "run_id": run.run_id}

    # -----------------------------------------------------------------------
    # POST /stop — cancel a running agent
    # -----------------------------------------------------------------------

    @router.post("/{convo_id}/stop", status_code=204)
    async def stop_run(convo_id: str, body: StopRun):
        session = sessions.get(convo_id)
        if not session:
            return
        run = session.run
        if run and run.status == "running" and run.run_id == body.run_id:
            if run.task and not run.task.done():
                run.task.cancel()

    # -----------------------------------------------------------------------
    # POST /approve — respond to a tool-confirm
    # -----------------------------------------------------------------------

    @router.post("/{convo_id}/approve", status_code=204)
    async def approve_tool(convo_id: str, body: ApproveToolCall):
        session = sessions.get(convo_id)
        if not session:
            raise HTTPException(status_code=404, detail="No active session")
        run = session.run
        if not run or run.status != "running" or run.run_id != body.run_id:
            raise HTTPException(status_code=409, detail="No matching run")
        if body.tool_call_id not in run.pending_approvals:
            raise HTTPException(status_code=409, detail="No pending approval for this tool call")

        if body.approved and body.scope == "project":
            convo = storage.get_conversation(convo_id)
            if convo:
                project = storage.get_project(convo.project_id)
                if project:
                    details = run.pending_approval_details.get(body.tool_call_id, {})
                    tool_name = details.get("name")
                    tool_args = details.get("args")
                    if tool_name:
                        add_project_rule(Path(project.path), tool_name, tool_args)

        run.approval_decisions[body.tool_call_id] = body.approved
        run.pending_approvals.discard(body.tool_call_id)
        run.pending_approval_details.pop(body.tool_call_id, None)
        if not run.pending_approvals:
            run.approval_event.set()

    # -----------------------------------------------------------------------
    # Slash command handler (shared)
    # -----------------------------------------------------------------------

    async def _handle_command(
        convo_id, project, project_path, project_agents,
        prompt, message_id, attachments,
        *, append_event, append_message, update_conversation_status,
        save_agent_history, user_event, tool_event, system_event, iso_now,
        request: Request = None,
    ):
        parts = prompt.strip().split(None, 1)
        cmd_name = parts[0][1:]
        cmd_args = parts[1] if len(parts) > 1 else ""
        skill = get_skill(cmd_name, project_path)
        session = get_session(convo_id)

        if not skill:
            raise HTTPException(status_code=400, detail=f"Unknown command: {cmd_name}")

        if skill.type == SkillType.server:
            if skill.name == "compact":
                await append_message(convo_id, user_event(prompt, message_id=message_id, server_command=True))
                _invalidate_message_cache(convo_id)
                c = _cache(convo_id)

                # Load all agent histories
                for p in storage.CONVOS_DIR.glob(f"{convo_id}.agent*.json"):
                    agent_parts = p.stem.replace(f"{convo_id}.agent", "")
                    aid = agent_parts.lstrip(".") or None
                    _load_history(convo_id, aid)

                aids_to_compact = [aid for aid, (h, _) in c["agent_histories"].items() if h]
                if not aids_to_compact:
                    if message_id:
                        processed_message_ids.setdefault(convo_id, set()).add(message_id)
                    msg = "No message history to compact"
                    session.broadcast(SkillResult(skill="compact", output=msg).model_dump_json())
                    return {"status": "error", "message": msg}

                compacted_any = False
                for aid in aids_to_compact:
                    hist, ctx_tokens = c["agent_histories"][aid]
                    old_tokens = ctx_tokens
                    # Manual /compact forces full compaction (Layer 3)
                    hist, summary = await compact(hist)
                    if summary:
                        compacted_any = True
                        from backend.agent.token_estimate import estimate_history_tokens
                        est_tokens = estimate_history_tokens(hist)
                        c["agent_histories"][aid] = (hist, est_tokens)
                        label = f"@{aid} " if aid else ""
                        await append_message(convo_id, tool_event("compact", event_type="compacted", output=f"{label}{old_tokens / 1000:.1f}k -> {est_tokens / 1000:.1f}k tokens"))
                        await save_agent_history(convo_id, ModelMessagesTypeAdapter.dump_json(hist), agent_id=aid)
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            message_id = None
                        compacted_event = Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json()
                        session.broadcast(compacted_event)

                if not compacted_any:
                    if message_id:
                        processed_message_ids.setdefault(convo_id, set()).add(message_id)
                    msg = "Not enough history to compact"
                    session.broadcast(SkillResult(skill="compact", output=msg).model_dump_json())
                    return {"status": "error", "message": msg}
                return {"status": "ok"}

            elif skill.name == "model":
                await append_message(convo_id, user_event(prompt, message_id=message_id, server_command=True))
                _invalidate_message_cache(convo_id)
                convo_meta = storage._read_meta(convo_id)
                from backend.agent.agents import active_model
                current_model = (convo_meta.model if convo_meta and convo_meta.model else active_model)
                if cmd_args.strip():
                    requested = cmd_args.strip()
                    resolved = None
                    for mid in _available:
                        if mid == requested or requested in mid:
                            resolved = mid
                            break
                    if resolved:
                        storage.update_conversation_model(convo_id, resolved)
                        c = _cache(convo_id)
                        c["agent_cache"].clear()
                        output = f"Switched to {resolved}"
                    else:
                        output = f"Unknown model: {requested}. Available: {', '.join(_available)}"
                else:
                    output = f"Model: {current_model}"
                    others = [m for m in _available if m != current_model]
                    if others:
                        output += "\nAvailable: " + ", ".join(others)
                        def _short(m: str) -> str:
                            name = m.split(":")[-1]
                            if name.startswith("claude-"):
                                name = name[len("claude-"):]
                            return name
                        output += "\nSwitch: " + ", ".join(f"/model {_short(m)}" for m in others)
                await append_message(convo_id, tool_event("model", event_type="skill-result", output=output))
                if message_id:
                    processed_message_ids.setdefault(convo_id, set()).add(message_id)
                session.broadcast(SkillResult(skill="model", output=output).model_dump_json())
                return {"status": "ok", "output": output}

            elif skill.name in ("share", "shares", "unshare"):
                from backend.server import PUBLIC_DIR, PUBLIC_BASE_URL
                from backend.runtime.commands import handle_share, handle_shares, handle_unshare, resolve_base_url
                base_url = resolve_base_url(request, PUBLIC_BASE_URL)
                await append_message(convo_id, user_event(prompt, message_id=message_id, server_command=True))
                _invalidate_message_cache(convo_id)
                if skill.name == "share":
                    output = await handle_share(cmd_args, project_path, PUBLIC_DIR, base_url)
                elif skill.name == "shares":
                    output = await handle_shares(PUBLIC_DIR, base_url)
                else:
                    output = await handle_unshare(cmd_args, PUBLIC_DIR)
                await append_message(convo_id, tool_event(skill.name, event_type="skill-result", output=output))
                if message_id:
                    processed_message_ids.setdefault(convo_id, set()).add(message_id)
                session.broadcast(SkillResult(skill=skill.name, output=output).model_dump_json())
                return {"status": "ok", "output": output}

            return {"status": "ok"}

        elif skill.type == SkillType.prompt:
            # Prompt skills get rewritten and sent as a regular message
            user_text = cmd_args.strip()
            rewritten = (
                f"Activate the `{skill.name}` skill with the activate_skill tool, then use it to help with this request. "
                "Before changing any existing file, read the current file immediately before editing and preserve any user edits unless the user explicitly asked to remove them."
            )
            if user_text:
                rewritten = f"{rewritten}\n\nUser request:\n{user_text}"
            if message_id:
                processed_message_ids.setdefault(convo_id, set()).add(message_id)
            session.broadcast(SkillResult(skill=skill.name, output=f"Queued activation for {skill.name}").model_dump_json())
            # Re-send as a regular message
            body_rewritten = SendMessage(text=rewritten, message_id=None, attachments=attachments)
            return await send_message(convo_id, body_rewritten)

        raise HTTPException(status_code=400, detail=f"Unknown command: {cmd_name}")

    return router


def _sse_event(event_id: int, event_type: str, data: str) -> str:
    return f"id: {event_id}\nevent: {event_type}\ndata: {data}\n\n"
