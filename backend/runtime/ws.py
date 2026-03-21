from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect
from pydantic_ai.messages import ModelMessagesTypeAdapter

from backend.agent.agent_config import AgentConfig
from backend.agent.agents import create_agent
from backend.agent.compact import compact, needs_compaction
from backend.agent.context import build_project_instructions
from backend.agent.mentions import extract_file_mentions, parse_mentions
from backend.agent.permissions import add_project_rule
from backend.agent.skills import SkillType, get_skill
from backend.agent import tools as agent_tools
from backend.runtime.commands import handle_share, handle_shares, handle_unshare
from pydantic_ai.messages import UserContent
from backend.data import storage
from backend.data.models import ConvoStatus
from backend.data.protocol import AgentStart, AuthOk, Compacted, Error, MessageAck, Running, SkillResult, VoiceState, VoiceTranscript
from backend.runtime.runner import build_multimodal_prompt, run_agent_task, run_bash_command_task
from backend.runtime.state import RunState, get_session, processed_message_ids, sessions
from backend.voice.stt import DeepgramSTTSession


def new_run_id() -> str:
    return uuid4().hex[:12]


def create_ws_handler(
    *,
    allowed_origin: str,
    public_base_url: str,
    public_dir: Path,
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
    async def ws_convo_chat(ws: WebSocket, convo_id: str):
        origin = ws.headers.get("origin", "")
        if allowed_origin and origin and origin != allowed_origin:
            await ws.close(code=4403, reason="Forbidden")
            return

        await ws.accept()
        session = get_session(convo_id)
        session.subscribers.add(ws)
        print(f"ws[{convo_id[:8]}]: connected (subscribers: {len(session.subscribers)})")

        try:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("type") != "auth" or not check_token(msg.get("token", "")):
                    raise ValueError("bad auth")
            except Exception:
                print(f"ws[{convo_id[:8]}]: auth failed, closing")
                await ws.send_text(Error(message="Invalid token").model_dump_json())
                await ws.close(code=4401, reason="Invalid token")
                return

            convo = storage.get_conversation(convo_id)
            if convo is None:
                await ws.send_text(Error(message="Conversation not found").model_dump_json())
                await ws.close(code=4404, reason="Conversation not found")
                return

            project = storage.get_project(convo.project_id)
            if project is None:
                await ws.send_text(Error(message="Project not found").model_dump_json())
                await ws.close(code=4404, reason="Project not found")
                return

            project_path = Path(project.path)
            if not project_path.exists() or not project_path.is_dir():
                await ws.send_text(Error(message=f"Project path does not exist: {project.path}").model_dump_json())
                await ws.close(code=4400, reason="Invalid project path")
                return

            await ws.send_text(AuthOk().model_dump_json())
            print(f"ws[{convo_id[:8]}]: authenticated, project={project.name}, path={project.path}")

            if convo.status == ConvoStatus.running and session.run is None:
                await update_conversation_status(convo_id, ConvoStatus.error)
                restart_event = system_event("Server restarted during run", event_type="run-error", recoverable=True)
                await append_event(convo_id, restart_event)
                await ws.send_text(json.dumps(restart_event | {"type": "error"}))
                convo = storage.get_conversation(convo_id)

            project_agents = storage.load_project_agents(project.id)

            def _load_history(aid: str | None) -> tuple[list, int]:
                if aid in agent_histories:
                    return agent_histories[aid]
                hist: list = []
                ctx_tokens = 0
                hist_bytes = storage.load_agent_history(convo_id, agent_id=aid)
                if hist_bytes:
                    try:
                        hist = ModelMessagesTypeAdapter.validate_json(hist_bytes)
                        for msg in reversed(_get_cached_messages()):
                            if msg.get("role") == "assistant" and "context_tokens" in msg:
                                if aid is None or msg.get("agent_id") == aid:
                                    ctx_tokens = msg["context_tokens"]
                                    break
                        print(f"ws[{convo_id[:8]}]: restored {len(hist)} messages for agent={aid or 'default'}")
                    except Exception as e:
                        print(f"ws[{convo_id[:8]}]: failed to restore history for agent={aid}: {e}")
                        hist = []
                agent_histories[aid] = (hist, ctx_tokens)
                return hist, ctx_tokens

            _agent_cache: dict[str | None, "Agent"] = {}
            _UNSET = object()
            _cached_instructions: str | None | object = _UNSET
            _cached_instructions_subsequent: str | None = None
            agent_histories: dict[str | None, tuple[list, int]] = {}
            _cached_messages: list[dict] | None = None

            def _get_cached_messages() -> list[dict]:
                nonlocal _cached_messages
                if _cached_messages is None:
                    _cached_messages = storage.read_events(convo_id)
                return _cached_messages

            def _invalidate_message_cache():
                nonlocal _cached_messages
                _cached_messages = None

            _load_history(None)

            existing_run = session.run
            if existing_run and existing_run.status == "running":
                existing_run.subscribers.add(ws)
                if session.controller is None or session.controller not in session.subscribers:
                    session.controller = ws
                    print(f"ws[{convo_id[:8]}]: promoted to controller (previous controller disconnected)")
                await ws.send_text(Running(run_id=existing_run.run_id).model_dump_json())
                for event_str in existing_run.events:
                    await ws.send_text(event_str)
                print(f"ws[{convo_id[:8]}]: subscribed to active run {existing_run.run_id} ({len(existing_run.events)} events buffered)")

            while True:
                raw_message = await ws.receive_text()
                prompt = raw_message
                message_id: str | None = None
                attachments: list[dict[str, Any]] = []

                try:
                    ctrl = json.loads(raw_message)
                    if isinstance(ctrl, dict):
                        if ctrl.get("type") == "stop":
                            run_id = str(ctrl.get("run_id", ""))
                            run = session.run
                            if ws is session.controller and run and run.status == "running" and run.run_id == run_id:
                                if run.task and not run.task.done():
                                    run.task.cancel()
                            continue
                        if ctrl.get("type") == "voice-start":
                            if session.run and session.run.status == "running":
                                await ws.send_text(Error(message="Voice input is unavailable while the assistant is running", recoverable=True).model_dump_json())
                                continue
                            if session.stt_session is not None:
                                await ws.send_text(Error(message="Voice input already active", recoverable=True).model_dump_json())
                                continue
                            session.stt_partial = ""
                            session.stt_final = ""
                            await ws.send_text(VoiceState(state="starting").model_dump_json())

                            async def _on_transcript(text: str, is_final: bool) -> None:
                                if is_final:
                                    session.stt_final = f"{session.stt_final} {text}".strip()
                                    session.stt_partial = ""
                                else:
                                    session.stt_partial = text
                                combined = f"{session.stt_final} {session.stt_partial}".strip()
                                await ws.send_text(VoiceTranscript(text=combined, is_final=is_final).model_dump_json())

                            async def _on_voice_error(message: str) -> None:
                                await ws.send_text(Error(message=message, recoverable=True).model_dump_json())
                                await ws.send_text(VoiceState(state="stopped").model_dump_json())
                                session.stt_session = None
                                session.stt_partial = ""
                                session.stt_final = ""

                            async def _on_voice_state(state: str) -> None:
                                if state in {"listening", "stopped"}:
                                    await ws.send_text(VoiceState(state=state).model_dump_json())

                            try:
                                stt = DeepgramSTTSession(_on_transcript, _on_voice_error, _on_voice_state)
                                await stt.start()
                                session.stt_session = stt
                            except Exception:
                                await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())
                                await ws.send_text(VoiceState(state="stopped").model_dump_json())
                            continue
                        if ctrl.get("type") == "voice-audio":
                            stt = session.stt_session
                            if stt is None:
                                continue
                            chunk_b64 = ctrl.get("audio", "")
                            if not isinstance(chunk_b64, str) or not chunk_b64:
                                continue
                            import base64
                            try:
                                await stt.send_audio(base64.b64decode(chunk_b64))
                            except Exception:
                                await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())
                            continue
                        if ctrl.get("type") == "voice-stop":
                            stt = session.stt_session
                            session.stt_session = None
                            if stt is not None:
                                try:
                                    await stt.stop()
                                except Exception:
                                    await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())
                            session.stt_partial = ""
                            session.stt_final = ""
                            await ws.send_text(VoiceState(state="stopped").model_dump_json())
                            continue
                        if ctrl.get("type") == "tool-confirm-response":
                            tc_id = str(ctrl.get("tool_call_id", ""))
                            run_id = str(ctrl.get("run_id", ""))
                            approved = bool(ctrl.get("approved", False))
                            scope = ctrl.get("scope", "once")
                            run = session.run
                            if ws is session.controller and run and run.status == "running" and run.run_id == run_id and tc_id in run.pending_approvals:
                                details = run.pending_approval_details.get(tc_id, {})
                                if approved and scope == "project":
                                    tool_name = details.get("name")
                                    tool_args = details.get("args")
                                    if tool_name:
                                        add_project_rule(project_path, tool_name, tool_args)
                                run.approval_decisions[tc_id] = approved
                                run.pending_approvals.discard(tc_id)
                                run.pending_approval_details.pop(tc_id, None)
                                if not run.pending_approvals:
                                    run.approval_event.set()
                            continue
                        if ctrl.get("type") == "user-message":
                            raw_text = str(ctrl.get("text", ""))
                            prompt = raw_text.strip()
                            message_id = str(ctrl.get("message_id", "")).strip() or None
                            raw_attachments = ctrl.get("attachments") or []
                            if isinstance(raw_attachments, list):
                                attachments = [a for a in raw_attachments if isinstance(a, dict) and a.get("path")]
                            if raw_text.startswith("\\!"):
                                prompt = raw_text[1:]
                            if not prompt:
                                await ws.send_text(Error(message="Empty message", recoverable=True).model_dump_json())
                                continue
                            seen_ids = processed_message_ids.setdefault(convo_id, set())
                            if message_id and message_id in seen_ids:
                                await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                                continue
                except (json.JSONDecodeError, TypeError):
                    pass

                completed_run = session.run
                if completed_run and completed_run.task and completed_run.task.done():
                    agent_histories[None] = (completed_run.message_history, completed_run.last_context_tokens)
                    session.run = None
                    completed_run = None
                elif completed_run and completed_run.status == "running":
                    await ws.send_text(Error(message="Agent is still running", run_id=completed_run.run_id, recoverable=True).model_dump_json())
                    continue

                async with session.lock:
                    if session.controller not in (None, ws):
                        await ws.send_text(Error(message="Conversation is controlled by another client", recoverable=True).model_dump_json())
                        continue
                    session.controller = ws

                if prompt.strip().startswith("/"):
                    parts = prompt.strip().split(None, 1)
                    cmd_name = parts[0][1:]
                    cmd_args = parts[1] if len(parts) > 1 else ""
                    skill = get_skill(cmd_name, project_path)

                    if skill and skill.type == SkillType.server:
                        if skill.name == "compact":
                            await append_message(convo_id, user_event(prompt, message_id=message_id, server_command=True))
                            _invalidate_message_cache()
                            for p in storage.CONVOS_DIR.glob(f"{convo_id}.agent*.json"):
                                parts = p.stem.replace(f"{convo_id}.agent", "")
                                aid = parts.lstrip(".") or None
                                _load_history(aid)

                            aids_to_compact = [aid for aid, (h, _) in agent_histories.items() if h]
                            if not aids_to_compact:
                                if message_id:
                                    processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                    await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                                    message_id = None
                                await ws.send_text(Error(message="No message history to compact", recoverable=True).model_dump_json())
                            else:
                                compacted_any = False
                                for aid in aids_to_compact:
                                    hist, ctx_tokens = agent_histories[aid]
                                    old_tokens = ctx_tokens
                                    hist, summary = await compact(hist)
                                    if summary:
                                        compacted_any = True
                                        est_tokens = sum(len(str(m)) for m in hist) // 4
                                        agent_histories[aid] = (hist, est_tokens)
                                        label = f"@{aid} " if aid else ""
                                        await append_message(convo_id, tool_event("compact", event_type="compacted", output=f"{label}{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens"))
                                        await save_agent_history(convo_id, ModelMessagesTypeAdapter.dump_json(hist), agent_id=aid)
                                        if message_id:
                                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                                            message_id = None
                                        await ws.send_text(Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json())
                                if not compacted_any:
                                    if message_id:
                                        processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                        await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                                        message_id = None
                                    await ws.send_text(Error(message="Not enough history to compact", recoverable=True).model_dump_json())
                        elif skill.name == "model":
                            await append_message(convo_id, user_event(prompt, message_id=message_id, server_command=True))
                            _invalidate_message_cache()
                            from backend.agent.agents import active_model, _available, set_model
                            if cmd_args.strip():
                                try:
                                    new_model = set_model(cmd_args.strip())
                                    _agent_cache.clear()
                                    output = f"Switched to {new_model}"
                                except ValueError as e:
                                    output = str(e)
                            else:
                                output = f"Model: {active_model}"
                                others = [m for m in _available if m != active_model]
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
                                await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                            await ws.send_text(SkillResult(skill="model", output=output).model_dump_json())
                        elif skill.name == "share":
                            await append_message(convo_id, user_event(prompt, message_id=message_id, server_command=True))
                            _invalidate_message_cache()
                            output = await handle_share(cmd_args, project_path, ws, public_dir, public_base_url)
                            await append_message(convo_id, tool_event("share", event_type="skill-result", output=output))
                            if message_id:
                                processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                            await ws.send_text(SkillResult(skill="share", output=output).model_dump_json())
                        elif skill.name == "shares":
                            await append_message(convo_id, user_event(prompt, message_id=message_id, server_command=True))
                            _invalidate_message_cache()
                            output = await handle_shares(ws, public_dir, public_base_url)
                            await append_message(convo_id, tool_event("shares", event_type="skill-result", output=output))
                            if message_id:
                                processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                            await ws.send_text(SkillResult(skill="shares", output=output).model_dump_json())
                        elif skill.name == "unshare":
                            await append_message(convo_id, user_event(prompt, message_id=message_id, server_command=True))
                            _invalidate_message_cache()
                            output = await handle_unshare(cmd_args, public_dir)
                            await append_message(convo_id, tool_event("unshare", event_type="skill-result", output=output))
                            if message_id:
                                processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                            await ws.send_text(SkillResult(skill="unshare", output=output).model_dump_json())
                        continue
                    elif skill and skill.type == SkillType.prompt:
                        user_text = cmd_args.strip()
                        prompt = (
                            f"Activate the `{skill.name}` skill with the activate_skill tool, then use it to help with this request. "
                            "Before changing any existing file, read the current file immediately before editing and preserve any user edits unless the user explicitly asked to remove them."
                        )
                        if user_text:
                            prompt = f"{prompt}\n\nUser request:\n{user_text}"
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                            message_id = None
                        await ws.send_text(SkillResult(skill=skill.name, output=f"Queued activation for {skill.name}").model_dump_json())

                raw_text_value = locals().get("raw_text")
                if isinstance(raw_text_value, str) and raw_text_value.startswith("!"):
                    bash_command = raw_text_value[1:]
                    if not bash_command.strip():
                        await ws.send_text(Error(message="Empty bash command", recoverable=True).model_dump_json())
                        continue
                else:
                    bash_command = ""

                _invalidate_message_cache()
                await append_message(
                    convo_id,
                    user_event(
                        prompt,
                        message_id=message_id,
                        attachments=attachments or None,
                        bash_mode=bool(isinstance(raw_text_value, str) and raw_text_value.startswith("!")),
                    ),
                )
                if message_id:
                    processed_message_ids.setdefault(convo_id, set()).add(message_id)
                    await ws.send_text(MessageAck(message_id=message_id).model_dump_json())

                current_meta = storage._read_meta(convo_id)
                if current_meta and current_meta.title == "Untitled":
                    asyncio.create_task(auto_title(convo_id, prompt))

                await update_conversation_status(convo_id, ConvoStatus.running)

                if isinstance(raw_text_value, str) and raw_text_value.startswith("!"):
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
                    if kind != "image":
                        non_image_attachment_lines.append(f"[Attached {kind}: {rel_path}]")
                if file_refs or non_image_attachment_lines:
                    file_context_parts: list[str] = []
                    if non_image_attachment_lines:
                        file_context_parts.append("\n".join(non_image_attachment_lines))
                    if file_refs:
                        file_context_parts.append("\n\n".join(f"[File: {path}]\n```\n{content}\n```" for path, content in file_refs))
                    cleaned_prompt = f"{'\n\n'.join(file_context_parts)}\n\n{cleaned_prompt}"

                agent_prompt = build_multimodal_prompt(cleaned_prompt, attachments, project_path)

                run = RunState(convo_id=convo_id, run_id=new_run_id())
                run.subscribers.update(session.subscribers)
                session.run = run
                await ws.send_text(Running(run_id=run.run_id).model_dump_json())

                agent_tools.set_workdir(project_path)
                if isinstance(raw_text_value, str) and raw_text_value.startswith("!"):
                    run.task = asyncio.create_task(
                        run_bash_command_task(
                            run,
                            bash_command.strip(),
                            convo_id,
                            iso_now=iso_now,
                            append_event=append_event,
                            append_message=append_message,
                            update_conversation_status=update_conversation_status,
                            system_event=system_event,
                            get_workdir=get_workdir,
                        )
                    )
                    continue
                if _cached_instructions is _UNSET:
                    _cached_instructions = await asyncio.to_thread(build_project_instructions, project_path, True)
                    _cached_instructions_subsequent = await asyncio.to_thread(build_project_instructions, project_path, False)

                MAX_HANDOFFS = 10
                handoff_count = 0
                current_targets = target_agents
                current_prompt: str | list[UserContent] = agent_prompt
                is_handoff = False
                run_context = run

                async def _run_with_handoffs():
                    nonlocal agent_histories
                    _current_targets = current_targets
                    _current_prompt = current_prompt
                    _is_handoff = is_handoff
                    _handoff_count = handoff_count

                    while _current_targets and _handoff_count <= MAX_HANDOFFS:
                        _invalidate_message_cache()
                        runs: list[RunState] = []
                        for ac in _current_targets:
                            aid = ac.id if ac else None
                            hist, ctx_tokens = _load_history(aid)

                            if hist and needs_compaction(ctx_tokens):
                                old_tokens = ctx_tokens
                                hist, summary = await compact(hist)
                                if summary:
                                    est_tokens = sum(len(str(m)) for m in hist) // 4
                                    agent_histories[aid] = (hist, est_tokens)
                                    await append_message(convo_id, tool_event("compact", event_type="compacted", output=f"{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens (auto)", run_id=run_context.run_id))
                                    await save_agent_history(convo_id, ModelMessagesTypeAdapter.dump_json(hist), agent_id=aid)
                                    await run_context.broadcast(Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json())

                            is_first_turn = len(hist) == 0
                            instructions = _cached_instructions if is_first_turn else _cached_instructions_subsequent
                            agent_prompt_local = _current_prompt
                            if ac:
                                _invalidate_message_cache()
                                shared_ctx = build_shared_context(convo_id, aid, cached_messages=_get_cached_messages())
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
                                await run_context.broadcast(AgentStart(run_id=run_context.run_id, agent_id=ac.id, agent_name=ac.name, agent_color=ac.color).model_dump_json())

                            agent_instance = _agent_cache.get(ac.id if ac else None) or create_agent(ac)
                            _agent_cache[ac.id if ac else None] = agent_instance

                            agent_run = RunState(convo_id=convo_id, run_id=run_context.run_id, message_history=list(hist))
                            agent_run.subscribers.update(session.subscribers)
                            session.run = agent_run
                            agent_run.task = asyncio.create_task(
                                run_agent_task(
                                    agent_run,
                                    agent_prompt_local,
                                    hist,
                                    convo_id,
                                    instructions=instructions,
                                    agent_instance=agent_instance,
                                    agent_id=aid,
                                    iso_now=iso_now,
                                    append_event=append_event,
                                    append_message=append_message,
                                    update_conversation_status=update_conversation_status,
                                    save_agent_history=save_agent_history,
                                    system_event=system_event,
                                    parse_tool_content=parse_tool_content,
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
                                agent_histories[aid] = (r.message_history, r.last_context_tokens)
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
                            _invalidate_message_cache()
                            print(f"ws[{convo_id[:8]}]: agent handoff #{_handoff_count} → {[a.id for a in next_targets]}")
                        else:
                            break

                    if session.run and session.run.run_id == run.run_id and session.run.status != "running":
                        session.controller = None

                run.task = asyncio.create_task(_run_with_handoffs())

        except WebSocketDisconnect:
            run = session.run
            if run:
                run.subscribers.discard(ws)
                print(f"ws[{convo_id[:8]}]: disconnected, run continues in background")
        finally:
            if session.stt_session is not None:
                try:
                    await session.stt_session.stop()
                except Exception:
                    pass
                session.stt_session = None
            session.subscribers.discard(ws)
            if session.controller is ws:
                session.controller = None
            run = session.run
            if run:
                run.subscribers.discard(ws)
            if not session.subscribers and session.controller is None and session.run is None:
                sessions.pop(convo_id, None)
            print(f"ws[{convo_id[:8]}]: disconnected (subscribers: {len(session.subscribers)})")

    return ws_convo_chat
