from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from urllib.parse import urlencode

import websockets

logger = logging.getLogger("remote-lab.stt")


def _safe_voice_error_message(_: str | None = None) -> str:
    return "Voice input failed. Your existing draft was preserved."

TranscriptCallback = Callable[[str, bool], Awaitable[None]]
ErrorCallback = Callable[[str], Awaitable[None]]
StateCallback = Callable[[str], Awaitable[None]]


class DeepgramSTTSession:
    def __init__(
        self,
        on_transcript: TranscriptCallback,
        on_error: ErrorCallback,
        on_state: StateCallback | None = None,
    ):
        self.on_transcript = on_transcript
        self.on_error = on_error
        self.on_state = on_state
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._reader_task: asyncio.Task | None = None
        self._started = False
        self._closed = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._started:
            return

        api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is not configured")

        params = urlencode(
            {
                "model": "nova-3",
                "interim_results": "true",
                "smart_format": "true",
                "punctuate": "true",
            }
        )
        url = f"wss://api.deepgram.com/v1/listen?{params}"

        try:
            self._ws = await websockets.connect(
                url,
                additional_headers={"Authorization": f"Token {api_key}"},
                max_size=None,
                open_timeout=10,
                close_timeout=5,
            )
        except Exception as e:
            logger.warning("Deepgram websocket connect failed: %s", e, exc_info=True)
            raise RuntimeError(_safe_voice_error_message()) from e

        self._started = True
        if self.on_state:
            await self.on_state("listening")
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def _reader_loop(self) -> None:
        ws = self._ws
        if ws is None:
            return
        try:
            async for raw in ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    data = json.loads(raw)
                except Exception:
                    continue

                msg_type = str(data.get("type", ""))
                if msg_type.lower() == "error":
                    description = data.get("description") or data.get("message") or "Unknown Deepgram error"
                    logger.warning("Deepgram stream error: %s", description)
                    await self.on_error(_safe_voice_error_message(str(description)))
                    continue

                channel = data.get("channel") or {}
                alternatives = channel.get("alternatives") or []
                if not alternatives:
                    continue
                transcript = (alternatives[0] or {}).get("transcript", "") or ""
                if not transcript:
                    continue
                is_final = bool(data.get("is_final"))
                await self.on_transcript(transcript, is_final)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if not self._closed:
                logger.warning("Deepgram reader loop failed: %s", e, exc_info=True)
                await self.on_error(_safe_voice_error_message(str(e)))
        finally:
            self._closed = True
            if self.on_state:
                await self.on_state("closed")

    async def send_audio(self, chunk: bytes) -> None:
        if not chunk or self._closed:
            return
        if not self._started or self._ws is None:
            raise RuntimeError("STT session not started")
        async with self._lock:
            await self._ws.send(chunk)

    async def stop(self) -> None:
        self._closed = True
        ws = self._ws
        self._ws = None
        if ws is not None:
            try:
                await ws.send(json.dumps({"type": "CloseStream"}))
            except Exception:
                pass
            try:
                await ws.close()
            except Exception:
                pass
        if self._reader_task is not None:
            try:
                await self._reader_task
            except Exception:
                pass
            self._reader_task = None
