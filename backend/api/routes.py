from __future__ import annotations

import asyncio
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from backend.data import storage
from backend.agent.agent_config import AgentConfig
from backend.agent.agents import active_model, _available
from backend.data.models import ConvoCreate, ConvoDetail, ConvoMeta, ConvoUpdate, Project, ProjectCreate, ProjectUpdate, UploadResult
from backend.agent.skills import get_skills


class FileWrite(BaseModel):
    path: str
    content: str


_EXCLUDED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".next", "dist", "build", ".cache", ".mypy_cache", ".ruff_cache"}
_bearer = HTTPBearer()


def create_api_router(*, check_token, resolve_project_file):
    async def require_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
        if not check_token(credentials.credentials):
            raise HTTPException(status_code=401, detail="Invalid token")
        return credentials.credentials

    api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])

    @api.get("/projects", response_model=list[Project])
    async def api_list_projects():
        return storage.list_projects()

    @api.post("/projects", response_model=Project, status_code=201)
    async def api_create_project(body: ProjectCreate):
        if body.github_url:
            target = Path(body.path)
            if target.exists() and any(target.iterdir()):
                raise HTTPException(status_code=400, detail="Target directory already exists and is not empty")
            clone_url = body.github_url
            import re as _re
            m = _re.match(r"https?://github\.com/(.+)", clone_url)
            if m:
                clone_url = f"git@github.com:{m.group(1)}"
                if not clone_url.endswith(".git"):
                    clone_url += ".git"
            proc = await asyncio.create_subprocess_exec(
                "git", "clone", "--depth", "1", clone_url, str(target),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=dict(os.environ),
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise HTTPException(status_code=400, detail=f"git clone failed: {stderr.decode().strip()}")
        return storage.create_project(body)

    @api.get("/projects/{project_id}", response_model=Project)
    async def api_get_project(project_id: str):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        return proj

    @api.put("/projects/{project_id}", response_model=Project)
    async def api_update_project(project_id: str, body: ProjectUpdate, request: Request):
        payload = await request.json()
        if not payload:
            raise HTTPException(status_code=400, detail="No fields to update")
        proj = storage.update_project(project_id, body)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        return proj

    @api.delete("/projects/{project_id}", status_code=204)
    async def api_delete_project(project_id: str):
        if not storage.delete_project(project_id):
            raise HTTPException(status_code=404, detail="Project not found")

    @api.get("/projects/{project_id}/convos", response_model=list[ConvoMeta])
    async def api_list_convos(project_id: str):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        return storage.list_conversations(project_id)

    @api.post("/projects/{project_id}/convos", response_model=ConvoMeta, status_code=201)
    async def api_create_convo(project_id: str, body: ConvoCreate):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        return storage.create_conversation(project_id, body.title)

    @api.get("/convos/{convo_id}", response_model=ConvoDetail)
    async def api_get_convo(convo_id: str, before: int | None = None, limit: int | None = None):
        convo = storage.get_conversation(convo_id, before=before, limit=limit)
        if not convo:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return convo

    @api.patch("/convos/{convo_id}", response_model=ConvoMeta)
    async def api_update_convo(convo_id: str, body: ConvoUpdate, request: Request):
        meta = storage._read_meta(convo_id)
        if not meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        payload = await request.json()
        if not payload:
            raise HTTPException(status_code=400, detail="No fields to update")
        if "title" in payload:
            meta = storage.update_conversation_title(convo_id, body.title or "Untitled")
        if "archived_at" in payload:
            meta = storage.update_conversation_archive(convo_id, body.archived_at)
        if "autonomous_tools_enabled" in payload:
            meta = storage.update_conversation_autonomy(convo_id, bool(body.autonomous_tools_enabled))
        if "model" in payload:
            meta = storage.update_conversation_model(convo_id, body.model)
        if not meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return meta

    @api.delete("/convos/{convo_id}", status_code=204)
    async def api_delete_convo(convo_id: str):
        if not storage.delete_conversation(convo_id):
            raise HTTPException(status_code=404, detail="Conversation not found")

    @api.get("/models")
    async def api_list_models():
        from backend.agent.agents import MODEL_CONTEXT_LIMITS
        return {"models": _available, "active": active_model, "context_limits": MODEL_CONTEXT_LIMITS}

    @api.get("/agents")
    async def api_list_global_agents():
        return [a.model_dump() for a in storage.load_global_agents()]

    @api.put("/agents")
    async def api_save_global_agents(body: list[AgentConfig]):
        storage.save_global_agents(body)
        return [a.model_dump() for a in body]

    @api.get("/projects/{project_id}/agents")
    async def api_list_agents(project_id: str):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        agents = storage.load_project_agents(project_id)
        return {
            "agents": [a.model_dump() for a in agents],
            "custom": storage.has_project_agents(project_id),
        }

    @api.put("/projects/{project_id}/agents")
    async def api_save_agents(project_id: str, body: list[AgentConfig]):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        storage.save_project_agents(project_id, body)
        return [a.model_dump() for a in body]

    @api.delete("/projects/{project_id}/agents")
    async def api_delete_project_agents(project_id: str):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        storage.delete_project_agents(project_id)
        return {"ok": True}

    @api.get("/projects/{project_id}/skills")
    async def api_list_skills(project_id: str):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        project_path = Path(proj.path)
        skills = get_skills(project_path if project_path.is_dir() else None)
        return [s.model_dump() for s in skills]

    # NOTE: /file/raw lives on the embed router (no global Bearer dep)
    # so that <img> tags can authenticate via query-string token.

    @api.get("/projects/{project_id}/file")
    async def api_read_file(project_id: str, path: str):
        _, target = resolve_project_file(project_id, path)
        try:
            content = target.read_text(errors="replace")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        if len(content) > 200_000:
            content = content[:200_000] + "\n\n--- truncated at 200KB ---"
        return {"path": path, "content": content}

    def sanitize_upload_name(name: str) -> str:
        cleaned = Path(name).name.strip().replace("\x00", "")
        if not cleaned:
            return "upload"
        return "".join(ch if ch.isalnum() or ch in {".", "-", "_"} else "-" for ch in cleaned)

    def upload_kind(mime_type: str, filename: str) -> str:
        image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
        if mime_type.startswith("image/") or Path(filename).suffix.lower() in image_exts:
            return "image"
        return "file"

    @api.post("/projects/{project_id}/file")
    async def api_write_file(project_id: str, body: FileWrite):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        project_path = Path(proj.path)
        if not project_path.exists() or not project_path.is_dir():
            raise HTTPException(status_code=400, detail="Project path does not exist")
        target = (project_path / body.path).resolve()
        if not str(target).startswith(str(project_path.resolve())):
            raise HTTPException(status_code=403, detail="Path traversal not allowed")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body.content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        return {"path": body.path, "size": len(body.content.encode())}

    @api.post("/projects/{project_id}/uploads", response_model=list[UploadResult])
    async def api_upload_files(project_id: str, files: list[UploadFile] = File(...)):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        project_path = Path(proj.path).resolve()
        if not project_path.exists() or not project_path.is_dir():
            raise HTTPException(status_code=400, detail="Project path does not exist")
        now = datetime.now(timezone.utc)
        upload_dir = project_path / ".remote-lab" / "uploads" / now.strftime("%Y") / now.strftime("%m")
        upload_dir.mkdir(parents=True, exist_ok=True)
        results: list[UploadResult] = []
        total_size = 0
        for upload in files:
            content = await upload.read()
            size = len(content)
            total_size += size
            if size > 50 * 1024 * 1024:
                raise HTTPException(status_code=400, detail=f"File too large: {upload.filename}")
            if total_size > 100 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="Total upload size exceeds 100 MB")
            safe_name = sanitize_upload_name(upload.filename or "upload")
            stored_name = f"{uuid4().hex[:12]}-{safe_name}"
            target = (upload_dir / stored_name).resolve()
            if not str(target).startswith(str(project_path)):
                raise HTTPException(status_code=403, detail="Invalid upload path")
            target.write_bytes(content)
            rel_path = str(target.relative_to(project_path))
            mime_type = upload.content_type or "application/octet-stream"
            results.append(UploadResult(
                path=rel_path,
                name=upload.filename or safe_name,
                mime_type=mime_type,
                size=size,
                kind=upload_kind(mime_type, safe_name),
            ))
        return results

    @api.get("/projects/{project_id}/files")
    async def api_list_files(project_id: str, hidden: bool = False):
        proj = storage.get_project(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        project_path = Path(proj.path).resolve()
        if not project_path.exists() or not project_path.is_dir():
            raise HTTPException(status_code=400, detail="Project path does not exist")
        files: list[str] = []
        for root, dirs, filenames in os.walk(project_path):
            dirs[:] = [
                d for d in dirs
                if d not in _EXCLUDED_DIRS and (hidden or not d.startswith("."))
            ]
            for f in sorted(filenames):
                if not hidden and f.startswith("."):
                    continue
                rel = os.path.relpath(os.path.join(root, f), project_path)
                files.append(rel)
                if len(files) >= 5000:
                    break
            if len(files) >= 5000:
                break
        return {"root": proj.path, "files": sorted(files)}

    # Separate router with no global Bearer dep — authenticates via query-string or Bearer token
    embed = APIRouter(prefix="/api")

    async def _check_any_auth(request: Request, token: str | None = None) -> None:
        """Accept either a query-string token or a Bearer header."""
        if token and check_token(token):
            return
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer ") and check_token(auth[7:]):
            return
        raise HTTPException(status_code=401, detail="Invalid token")

    @embed.get("/projects/{project_id}/file/raw")
    async def api_read_file_raw(request: Request, project_id: str, path: str, token: str | None = None):
        await _check_any_auth(request, token)
        _, target = resolve_project_file(project_id, path)
        media_type, _ = mimetypes.guess_type(str(target))
        return Response(target.read_bytes(), media_type=media_type or "application/octet-stream")

    @embed.get("/projects/{project_id}/file/embed")
    async def api_read_file_embed(project_id: str, path: str, token: str):
        if not check_token(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        _, target = resolve_project_file(project_id, path)
        media_type, _ = mimetypes.guess_type(str(target))
        if target.suffix.lower() in {".html", ".htm"}:
            html = target.read_text(encoding="utf-8", errors="replace")
            # Inject a snippet that hides the body until scripts have finished
            # rendering (e.g. Marp scroll-to-paginated transition), then fades in.
            hide_snippet = (
                '<style>body{opacity:0!important;transition:opacity .12s ease-in}</style>'
                '<script>addEventListener("load",()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{document.body.style.setProperty("opacity","1","important")})))</script>'
            )
            # Insert right before </head> if possible, otherwise prepend
            if "</head>" in html:
                html = html.replace("</head>", hide_snippet + "</head>", 1)
            elif "<head>" in html:
                html = html.replace("<head>", "<head>" + hide_snippet, 1)
            else:
                html = hide_snippet + html
            response = Response(content=html, media_type="text/html")
            response.headers["Content-Disposition"] = f'inline; filename="{target.name}"'
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
            response.headers["Content-Security-Policy"] = "default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; frame-ancestors 'self'; form-action 'none'"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["Cache-Control"] = "no-cache"
            return response
        response = FileResponse(target, media_type=media_type or "application/octet-stream")
        response.headers["Content-Disposition"] = f'inline; filename="{target.name}"'
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        return response

    return api, embed
