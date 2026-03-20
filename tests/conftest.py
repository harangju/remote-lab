from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture()
def temp_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data_dir = tmp_path / "data"
    monkeypatch.setenv("WS_TOKEN", "test-token")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-deepgram-key")
    monkeypatch.setattr("backend.data.storage.DATA_DIR", data_dir, raising=False)
    monkeypatch.setattr("backend.data.storage.PROJECTS_FILE", data_dir / "projects.json", raising=False)
    monkeypatch.setattr("backend.data.storage.CONVOS_DIR", data_dir / "conversations", raising=False)
    monkeypatch.setattr("backend.data.storage.AGENTS_DIR", data_dir / "agents", raising=False)
    return data_dir


@pytest.fixture()
def storage_module(temp_data_dir: Path):
    import backend.data.storage as storage

    return storage


@pytest.fixture()
def server_module(temp_data_dir: Path, monkeypatch: pytest.MonkeyPatch):
    import backend.agent.agents as agents

    monkeypatch.setattr(agents, "_available", ["openai:gpt-5-nano"], raising=False)
    monkeypatch.setattr(agents, "model", "openai:gpt-5-nano", raising=False)
    monkeypatch.setattr(agents, "active_model", "openai:gpt-5-nano", raising=False)

    import backend.server as server

    server.WS_TOKEN = "test-token"
    return server


@pytest.fixture()
def client(server_module):
    with TestClient(server_module.app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}
