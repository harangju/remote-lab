from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from pydantic_ai.messages import BinaryImage, ModelMessage, ModelRequest, ModelResponse, ModelMessagesTypeAdapter, PartDeltaEvent, PartStartEvent, TextPart, TextPartDelta, ThinkingPartDelta, ToolCallPart, ToolReturnPart, UserContent, FunctionToolCallEvent, FunctionToolResultEvent
from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults, ToolApproved, ToolDenied

from backend.agent import tools as agent_tools
from backend.agent.agents import USAGE_LIMITS, agent, get_context_limit
from backend.agent.compact import compact
from backend.agent.permissions import build_project_rule, is_tool_auto_allowed, tool_is_always_confirmed
from backend.data.models import ConvoStatus
from backend.data.protocol import Compacted, Done, TextDelta, ThinkingDelta, ToolConfirm, ToolResult
from backend.runtime.state import RunState, sessions


def sanitize_history(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Ensure every ToolCallPart has a matching ToolReturnPart.

    Walks backward from the tail, removing any ModelResponse whose
    ToolCallParts lack corresponding ToolReturnParts in the next
    ModelRequest.  This keeps agent history valid for PydanticAI's
    iter() which rejects histories with unresolved tool calls.
    """
    while len(messages) >= 1:
        last = messages[-1]
        if not isinstance(last, ModelResponse):
            break
        call_ids = {p.tool_call_id for p in last.parts if isinstance(p, ToolCallPart)}
        if not call_ids:
            break
        # Check if a subsequent ModelRequest has all matching returns
        if len(messages) >= 2 and isinstance(messages[-2], ModelResponse):
            # Two responses in a row — the earlier one is orphaned
            messages.pop()
            continue
        # No following request at all — orphaned
        messages.pop()
        continue

    # Also handle case: ModelRequest with ToolReturnParts but no
    # preceding ModelResponse with the matching ToolCallParts
    while len(messages) >= 1:
        last = messages[-1]
        if not isinstance(last, ModelRequest):
            break
        has_tool_returns = any(isinstance(p, ToolReturnPart) for p in last.parts)
        if not has_tool_returns:
            break
        # Check if preceding message is a ModelResponse with matching calls
        if len(messages) >= 2 and isinstance(messages[-2], ModelResponse):
            call_ids = {p.tool_call_id for p in messages[-2].parts if isinstance(p, ToolCallPart)}
            return_ids = {p.tool_call_id for p in last.parts if isinstance(p, ToolReturnPart)}
            if return_ids.issubset(call_ids):
                break  # All returns match — history is clean
        # Orphaned returns without matching calls — remove
        messages.pop()
        # And remove the now-trailing response if it has orphaned calls
        if messages and isinstance(messages[-1], ModelResponse):
            call_ids = {p.tool_call_id for p in messages[-1].parts if isinstance(p, ToolCallPart)}
            if call_ids:
                messages.pop()

    return messages


async def _finalize_run_session(convo_id: str, run: RunState) -> None:
    session = sessions.get(convo_id)
    if session and session.run is run:
        session.run = None
        if not session.sse_queues:
            sessions.pop(convo_id, None)


def build_multimodal_prompt(prompt: str, attachments: list[dict[str, Any]], project_path: Path) -> str | list[UserContent]:
    if not attachments:
        return prompt

    content: list[UserContent] = [prompt]
    for attachment in attachments:
        rel_path = str(attachment.get("path", "")).strip()
        kind = str(attachment.get("kind", "file")).strip() or "file"
        mime_type = str(attachment.get("mime_type", "application/octet-stream")).strip() or "application/octet-stream"
        if not rel_path:
            continue
        target = (project_path / rel_path).resolve()
        if not str(target).startswith(str(project_path.resolve())) or not target.is_file():
            continue
        if kind == "image":
            try:
                content.append(BinaryImage(data=target.read_bytes(), media_type=mime_type, identifier=rel_path))
            except Exception:
                content.append(f"[Attached image could not be loaded: {rel_path}]")
        else:
            content.append(f"[Attached file: {rel_path}]")
    return content


async def run_bash_command_task(
    run: RunState,
    command: str,
    convo_id: str,
    *,
    iso_now,
    append_event,
    append_message,
    update_conversation_status,
    system_event,
    get_workdir,
):
    async def _emit(msg_str: str):
        try:
            payload = json.loads(msg_str)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            payload.setdefault("run_id", run.run_id)
            if payload.get("type") == "tool-output":
                await append_event(convo_id, {
                    "type": "tool-output",
                    "name": payload.get("name", ""),
                    "output": payload.get("output", ""),
                    "timestamp": iso_now(),
                    "run_id": payload.get("run_id"),
                })
            msg_str = json.dumps(payload)
        run.events.append(msg_str)
        await run.broadcast(msg_str)

    async def _wait_for_approval(tool_call_id: str, command_input: dict[str, str]) -> bool:
        from backend.data import storage

        convo_meta = storage._read_meta(convo_id)
        convo_autonomous = bool(convo_meta.autonomous_tools_enabled) if convo_meta else False
        if is_tool_auto_allowed(get_workdir(), convo_autonomous, "bash", command_input):
            return True

        run.pending_approvals = {tool_call_id}
        run.pending_approval_details = {tool_call_id: {"name": "bash", "args": command_input}}
        run.approval_decisions = {}
        run.approval_event = asyncio.Event()
        always_confirm = tool_is_always_confirmed("bash", command_input)
        await _emit(ToolConfirm(
            tool_call_id=tool_call_id,
            name="bash",
            run_id=run.run_id,
            args=json.dumps(command_input),
            can_allow_project=not always_confirm,
            can_turn_on_auto=not always_confirm,
        ).model_dump_json())
        await run.approval_event.wait()
        approved = bool(run.approval_decisions.get(tool_call_id, False))
        run.pending_approvals.clear()
        run.pending_approval_details.clear()
        return approved

    agent_tools.set_broadcast(_emit)
    try:
        command_input = {"command": command}
        tool_call_id = f"bash-{uuid4().hex[:8]}"
        tool_call_event = {
            "type": "tool-call",
            "role": "tool",
            "name": "bash",
            "input": json.dumps(command_input),
            "tool_call_id": tool_call_id,
            "timestamp": iso_now(),
            "run_id": run.run_id,
        }
        await append_event(convo_id, tool_call_event)
        await _emit(json.dumps({**tool_call_event, "type": "tool-use"}))

        approved = await _wait_for_approval(tool_call_id, command_input)
        if not approved:
            event = system_event("User denied this tool call", event_type="run-error", run_id=run.run_id, recoverable=True)
            await append_event(convo_id, event)
            await _emit(json.dumps({**event, "type": "error"}))
            run.status = "error"
            await update_conversation_status(convo_id, ConvoStatus.idle)
            return

        if build_project_rule("bash", command_input) is None:
            event = system_event("Invalid bash command", event_type="run-error", run_id=run.run_id, recoverable=True)
            await append_event(convo_id, event)
            await _emit(json.dumps({**event, "type": "error"}))
            run.status = "error"
            await update_conversation_status(convo_id, ConvoStatus.error)
            return

        result = await agent_tools._bash(SimpleNamespace(), command)
        output = result[:500] if result else "OK"
        await append_event(convo_id, {
            "type": "tool-result",
            "role": "tool",
            "name": "bash",
            "output": output,
            "tool_call_id": tool_call_id,
            "timestamp": iso_now(),
            "run_id": run.run_id,
        })
        await _emit(ToolResult(name="bash", output=output, run_id=run.run_id).model_dump_json())

        meta_msg = {
            "type": "assistant-message",
            "role": "assistant",
            "content": "",
            "timestamp": iso_now(),
            "turns": 0,
            "context_tokens": 0,
            "context_limit": 0,
            "run_id": run.run_id,
        }
        await append_message(convo_id, meta_msg)

        done = Done(turns=0, run_id=run.run_id, context_tokens=0, context_limit=0)
        run.done_event = done.model_dump()
        run.status = "done"
        await _emit(done.model_dump_json())
        await update_conversation_status(convo_id, ConvoStatus.done)
    except asyncio.CancelledError:
        run.status = "error"
        await update_conversation_status(convo_id, ConvoStatus.idle)
        done = Done(turns=0, run_id=run.run_id, status="cancelled")
        run.done_event = done.model_dump()
        await _emit(done.model_dump_json())
        await _finalize_run_session(convo_id, run)
        raise
    except Exception as e:
        run.error_msg = str(e)
        run.status = "error"
        await update_conversation_status(convo_id, ConvoStatus.error)
        done = Done(turns=0, run_id=run.run_id, status="error", error_message=str(e))
        run.done_event = done.model_dump()
        await _emit(done.model_dump_json())
    finally:
        agent_tools.clear_broadcast()
        if run.status != "error":
            await asyncio.sleep(10)
        await _finalize_run_session(convo_id, run)


async def run_agent_task(
    run: RunState,
    prompt: str | list[UserContent],
    message_history: list,
    convo_id: str,
    *,
    instructions: str | None = None,
    agent_instance=None,
    agent_id: str | None = None,
    iso_now,
    append_event,
    append_message,
    update_conversation_status,
    save_agent_history,
    system_event,
    parse_tool_content,
):
    active_agent = agent_instance or agent
    _model_id = active_agent.model if isinstance(active_agent.model, str) else None

    async def _emit(msg_str: str):
        try:
            payload = json.loads(msg_str)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            payload.setdefault("run_id", run.run_id)
            if agent_id and payload.get("agent_id") is None:
                payload["agent_id"] = agent_id
            if payload.get("type") == "tool-output":
                await append_event(convo_id, {
                    "type": "tool-output",
                    "name": payload.get("name", ""),
                    "output": payload.get("output", ""),
                    "timestamp": iso_now(),
                    "run_id": payload.get("run_id"),
                    **({"agent_id": agent_id} if agent_id else {}),
                })
            msg_str = json.dumps(payload)
        run.events.append(msg_str)
        await run.broadcast(msg_str)

    agent_tools.set_broadcast(_emit)

    try:
        current_prompt: str | list[UserContent] | None = prompt
        current_history = message_history if message_history else None
        deferred_results: DeferredToolResults | None = None
        total_turns = 0

        while True:
            iter_kwargs: dict = dict(
                message_history=current_history,
                usage_limits=USAGE_LIMITS,
                instructions=instructions,
            )
            if deferred_results:
                iter_kwargs["deferred_tool_results"] = deferred_results
                deferred_results = None

            async with active_agent.iter(current_prompt, **iter_kwargs) as agent_run:
                async for node in agent_run:
                    if active_agent.is_model_request_node(node):
                        segment_text = ""
                        async with node.stream(agent_run.ctx) as stream:
                            async for event in stream:
                                if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart) and event.part.content:
                                    segment_text += event.part.content
                                    run.full_text += event.part.content
                                    await _emit(TextDelta(delta=event.part.content, run_id=run.run_id, agent_id=agent_id).model_dump_json())
                                elif isinstance(event, PartDeltaEvent):
                                    if isinstance(event.delta, TextPartDelta) and event.delta.content_delta:
                                        segment_text += event.delta.content_delta
                                        run.full_text += event.delta.content_delta
                                        await _emit(TextDelta(delta=event.delta.content_delta, run_id=run.run_id, agent_id=agent_id).model_dump_json())
                                    elif isinstance(event.delta, ThinkingPartDelta):
                                        await _emit(ThinkingDelta(delta=event.delta.content_delta or "", run_id=run.run_id, agent_id=agent_id).model_dump_json())
                        if segment_text:
                            msg: dict = {
                                "type": "assistant-message",
                                "role": "assistant",
                                "content": segment_text,
                                "timestamp": iso_now(),
                                "run_id": run.run_id,
                            }
                            if agent_id:
                                msg["agent_id"] = agent_id
                            await append_message(convo_id, msg)
                    elif active_agent.is_call_tools_node(node):
                        async with node.stream(agent_run.ctx) as tool_stream:
                            async for event in tool_stream:
                                if isinstance(event, FunctionToolCallEvent):
                                    tool_call_id = getattr(event.part, "tool_call_id", "") or ""
                                    ev = {
                                        "type": "tool-call",
                                        "role": "tool",
                                        "name": event.part.tool_name,
                                        "input": str(event.part.args)[:200],
                                        "tool_call_id": tool_call_id,
                                        "timestamp": iso_now(),
                                        "run_id": run.run_id,
                                    }
                                    if agent_id:
                                        ev["agent_id"] = agent_id
                                    await append_event(convo_id, ev)
                                    await _emit(json.dumps({**ev, "type": "tool-use"}))
                                elif isinstance(event, FunctionToolResultEvent):
                                    tool_name = event.result.tool_name if hasattr(event.result, "tool_name") else ""
                                    raw_content = getattr(event.result, "content", None)
                                    if raw_content is None:
                                        raw_content = event.content
                                    output, diff = parse_tool_content(tool_name, raw_content)
                                    ev = {
                                        "type": "tool-result",
                                        "name": tool_name,
                                        "output": output,
                                        "tool_call_id": getattr(event.result, "tool_call_id", "") or "",
                                        "timestamp": iso_now(),
                                        "run_id": run.run_id,
                                    }
                                    if diff is not None:
                                        ev["diff"] = diff
                                    if agent_id:
                                        ev["agent_id"] = agent_id
                                    await append_event(convo_id, ev)
                                    await _emit(json.dumps(ev))

                usage = agent_run.usage()
                # Snapshot history after each iteration so cancelled runs
                # preserve tool results for the next run.
                run.message_history = agent_run.all_messages()
                total_turns += len([m for m in run.message_history if isinstance(m, ModelResponse)])

                result = agent_run.result
                if result and isinstance(result.output, DeferredToolRequests) and result.output.approvals:
                    from backend.data import storage

                    approvals_needed = result.output.approvals
                    run.pending_approvals = set()
                    run.pending_approval_details = {}
                    run.approval_decisions = {}
                    run.approval_event = asyncio.Event()

                    convo_meta = storage._read_meta(convo_id)
                    convo_autonomous = bool(convo_meta.autonomous_tools_enabled) if convo_meta else False
                    for tool_call in approvals_needed:
                        if is_tool_auto_allowed(agent_tools.get_workdir(), convo_autonomous, tool_call.tool_name, tool_call.args):
                            run.approval_decisions[tool_call.tool_call_id] = True
                            continue
                        run.pending_approvals.add(tool_call.tool_call_id)
                        run.pending_approval_details[tool_call.tool_call_id] = {
                            "name": tool_call.tool_name,
                            "args": tool_call.args,
                        }
                        always_confirm = tool_is_always_confirmed(tool_call.tool_name, tool_call.args)
                        await _emit(ToolConfirm(
                            tool_call_id=tool_call.tool_call_id,
                            name=tool_call.tool_name,
                            run_id=run.run_id,
                            args=str(tool_call.args)[:500] if tool_call.args else None,
                            agent_id=agent_id,
                            can_allow_project=not always_confirm,
                            can_turn_on_auto=not always_confirm,
                        ).model_dump_json())

                    if run.pending_approvals:
                        await run.approval_event.wait()

                    approval_map: dict = {}
                    for tc_id, approved in run.approval_decisions.items():
                        approval_map[tc_id] = ToolApproved() if approved else ToolDenied(message="User denied this tool call")

                    deferred_results = DeferredToolResults(approvals=approval_map)
                    current_history = agent_run.all_messages()
                    current_prompt = None
                    continue

                break

        context_tokens = usage.request_tokens or 0
        context_limit = get_context_limit(_model_id)
        run.last_context_tokens = context_tokens

        await save_agent_history(
            convo_id,
            ModelMessagesTypeAdapter.dump_json(run.message_history),
            agent_id=agent_id,
        )

        meta_msg = {
            "type": "assistant-message",
            "role": "assistant",
            "content": "",
            "timestamp": iso_now(),
            "turns": total_turns,
            "context_tokens": context_tokens,
            "context_limit": context_limit,
            "run_id": run.run_id,
        }
        if agent_id:
            meta_msg["agent_id"] = agent_id
        await append_message(convo_id, meta_msg)

        done = Done(turns=total_turns, run_id=run.run_id, context_tokens=context_tokens, context_limit=context_limit, agent_id=agent_id)
        run.done_event = done.model_dump()
        run.status = "done"
        await _emit(done.model_dump_json())
        await update_conversation_status(convo_id, ConvoStatus.done)

    except asyncio.CancelledError:
        run.status = "error"
        await update_conversation_status(convo_id, ConvoStatus.idle)
        # Emit a Done with status="cancelled" so the frontend can
        # cleanly flush stream blocks without needing reloadConversation.
        done = Done(
            turns=total_turns, run_id=run.run_id,
            context_tokens=run.last_context_tokens, context_limit=get_context_limit(_model_id),
            agent_id=agent_id, status="cancelled",
        )
        run.done_event = done.model_dump()
        await _emit(done.model_dump_json())
        await _finalize_run_session(convo_id, run)
        raise
    except Exception as e:
        run.error_msg = str(e)
        run.status = "error"
        await update_conversation_status(convo_id, ConvoStatus.error)
        done = Done(
            turns=total_turns, run_id=run.run_id,
            context_tokens=run.last_context_tokens, context_limit=get_context_limit(_model_id),
            agent_id=agent_id, status="error", error_message=str(e),
        )
        run.done_event = done.model_dump()
        await _emit(done.model_dump_json())
    finally:
        agent_tools.clear_broadcast()
        # Persist a run-done event to JSONL so buildDisplayMessages
        # knows where run boundaries are (flushes orphaned tool blocks).
        try:
            await append_event(convo_id, {
                "type": "run-done",
                "run_id": run.run_id,
                "status": run.status,
                "timestamp": iso_now(),
                **({"agent_id": agent_id} if agent_id else {}),
            })
        except Exception:
            pass
        # Save agent history even on cancel/error so the next run
        # doesn't lose tool results and re-read the same files.
        if run.message_history:
            sanitize_history(run.message_history)
        if run.message_history:
            try:
                await save_agent_history(
                    convo_id,
                    ModelMessagesTypeAdapter.dump_json(run.message_history),
                    agent_id=agent_id,
                )
            except Exception:
                pass
        if run.status != "error":
            await asyncio.sleep(10)
        await _finalize_run_session(convo_id, run)
