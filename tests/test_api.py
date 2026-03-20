from __future__ import annotations

from pathlib import Path


def create_project(client, auth_headers, tmp_path: Path) -> dict:
    project_path = tmp_path / "project"
    response = client.post(
        "/api/projects",
        headers=auth_headers,
        json={"name": "Demo", "path": str(project_path)},
    )
    assert response.status_code == 201
    return response.json()


def test_api_requires_auth(client):
    response = client.get("/api/projects")
    assert response.status_code in {401, 403}


def test_project_file_crud_and_listing(client, auth_headers, tmp_path: Path):
    project = create_project(client, auth_headers, tmp_path)
    project_id = project["id"]

    write_response = client.post(
        f"/api/projects/{project_id}/file",
        headers=auth_headers,
        json={"path": "src/app.py", "content": "print('hi')\n"},
    )
    assert write_response.status_code == 200

    read_response = client.get(
        f"/api/projects/{project_id}/file",
        headers=auth_headers,
        params={"path": "src/app.py"},
    )
    assert read_response.status_code == 200
    assert read_response.json()["content"] == "print('hi')\n"

    list_response = client.get(f"/api/projects/{project_id}/files", headers=auth_headers)
    assert list_response.status_code == 200
    assert "src/app.py" in list_response.json()["files"]


def test_file_endpoints_block_path_traversal(client, auth_headers, tmp_path: Path):
    project = create_project(client, auth_headers, tmp_path)
    project_id = project["id"]

    response = client.post(
        f"/api/projects/{project_id}/file",
        headers=auth_headers,
        json={"path": "../escape.txt", "content": "nope"},
    )
    assert response.status_code == 403

    raw_response = client.get(
        f"/api/projects/{project_id}/file/raw",
        headers=auth_headers,
        params={"path": "../escape.txt"},
    )
    assert raw_response.status_code == 403


def test_api_returns_404_for_missing_resources(client, auth_headers):
    project_response = client.get("/api/projects/missing", headers=auth_headers)
    assert project_response.status_code == 404

    convo_response = client.get("/api/convos/missing", headers=auth_headers)
    assert convo_response.status_code == 404


def test_empty_updates_are_rejected(client, auth_headers, tmp_path: Path):
    project = create_project(client, auth_headers, tmp_path)

    project_response = client.put(
        f"/api/projects/{project['id']}",
        headers=auth_headers,
        json={},
    )
    assert project_response.status_code == 400

    convo_response = client.post(
        f"/api/projects/{project['id']}/convos",
        headers=auth_headers,
        json={"title": "Test convo"},
    )
    convo = convo_response.json()
    patch_response = client.patch(
        f"/api/convos/{convo['id']}",
        headers=auth_headers,
        json={},
    )
    assert patch_response.status_code == 400


def test_conversation_pagination_endpoint(client, auth_headers, tmp_path: Path, storage_module):
    project = create_project(client, auth_headers, tmp_path)
    convo_response = client.post(
        f"/api/projects/{project['id']}/convos",
        headers=auth_headers,
        json={"title": "Test convo"},
    )
    assert convo_response.status_code == 201
    convo = convo_response.json()

    storage_module.append_event(convo["id"], {"type": "user-message", "role": "user", "content": "one"})
    storage_module.append_event(convo["id"], {"type": "assistant-message", "role": "assistant", "content": "two"})
    storage_module.append_event(convo["id"], {"type": "user-message", "role": "user", "content": "three"})

    response = client.get(
        f"/api/convos/{convo['id']}",
        headers=auth_headers,
        params={"limit": 2},
    )
    assert response.status_code == 200
    detail = response.json()
    assert [m["content"] for m in detail["messages"]] == ["two", "three"]
    assert detail["has_more"] is True
    assert detail["next_before"] == 1
