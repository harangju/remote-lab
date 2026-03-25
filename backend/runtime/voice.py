"""Voice-only WebSocket handler — opened on demand for mic input."""

from __future__ import annotations

import asyncio
import base64
import json

from fastapi import WebSocket, WebSocketDisconnect

from backend.data.protocol import Error, VoiceState, VoiceTranscript
from backend.runtime.state import get_session
from backend.voice.stt import DeepgramSTTSession


def create_voice_ws_handler(*, check_token, allowed_origin: str):
    async def ws_voice(ws: WebSocket, convo_id: str):
        origin = ws.headers.get("origin", "")
        if allowed_origin and origin and origin != allowed_origin:
            await ws.close(code=4403, reason="Forbidden")
            return

        await ws.accept()

        # Auth: first message must be {"type": "auth", "token": "..."}
        try:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            if msg.get("type") != "auth" or not check_token(msg.get("token", "")):
                await ws.send_text(Error(message="Invalid token").model_dump_json())
                await ws.close(code=4401, reason="Invalid token")
                return
        except Exception:
            await ws.close(code=4401, reason="Invalid token")
            return

        await ws.send_text(json.dumps({"type": "auth-ok"}))

        session = get_session(convo_id)
        stt: DeepgramSTTSession | None = None

        async def _on_transcript(text: str, is_final: bool) -> None:
            if is_final:
                session.stt_final = f"{session.stt_final} {text}".strip()
                session.stt_partial = ""
            else:
                session.stt_partial = text
            combined = f"{session.stt_final} {session.stt_partial}".strip()
            try:
                await ws.send_text(VoiceTranscript(text=combined, is_final=is_final).model_dump_json())
            except Exception:
                pass

        async def _on_voice_error(message: str) -> None:
            try:
                await ws.send_text(Error(message=message, recoverable=True).model_dump_json())
                await ws.send_text(VoiceState(state="stopped").model_dump_json())
            except Exception:
                pass

        async def _on_voice_state(state: str) -> None:
            if state in {"listening", "stopped"}:
                try:
                    await ws.send_text(VoiceState(state=state).model_dump_json())
                except Exception:
                    pass

        try:
            while True:
                raw_message = await ws.receive_text()
                try:
                    ctrl = json.loads(raw_message)
                except (json.JSONDecodeError, TypeError):
                    continue

                if not isinstance(ctrl, dict):
                    continue

                if ctrl.get("type") == "voice-start":
                    if session.run and session.run.status == "running":
                        await ws.send_text(Error(message="Voice input is unavailable while the assistant is running", recoverable=True).model_dump_json())
                        continue
                    if stt is not None:
                        await ws.send_text(Error(message="Voice input already active", recoverable=True).model_dump_json())
                        continue
                    session.stt_partial = ""
                    session.stt_final = ""
                    await ws.send_text(VoiceState(state="starting").model_dump_json())
                    try:
                        stt = DeepgramSTTSession(_on_transcript, _on_voice_error, _on_voice_state)
                        await stt.start()
                        session.stt_session = stt
                    except Exception:
                        await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())
                        await ws.send_text(VoiceState(state="stopped").model_dump_json())
                        stt = None

                elif ctrl.get("type") == "voice-audio":
                    if stt is None:
                        continue
                    chunk_b64 = ctrl.get("audio", "")
                    if not isinstance(chunk_b64, str) or not chunk_b64:
                        continue
                    try:
                        await stt.send_audio(base64.b64decode(chunk_b64))
                    except Exception:
                        await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())

                elif ctrl.get("type") == "voice-stop":
                    if stt is not None:
                        try:
                            await stt.stop()
                        except Exception:
                            await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())
                        stt = None
                    session.stt_session = None
                    session.stt_partial = ""
                    session.stt_final = ""
                    await ws.send_text(VoiceState(state="stopped").model_dump_json())

        except WebSocketDisconnect:
            pass
        finally:
            if stt is not None:
                try:
                    await stt.stop()
                except Exception:
                    pass
            session.stt_session = None
            print(f"voice[{convo_id[:8]}]: disconnected")

    return ws_voice
