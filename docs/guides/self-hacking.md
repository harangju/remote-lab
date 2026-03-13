# Self-Hacking

One of Remote Lab's most useful properties is that you can improve it from inside itself.

You can use Remote Lab to edit Remote Lab, inspect files, run builds, and iterate on the app while working in the same environment.

## Frontend changes

If you changed files under `frontend/`, rebuild the frontend bundle:

```bash
cd frontend && bun run build
```

Then refresh the browser page.

Typical examples:

- UI changes in `frontend/src/views/`
- component edits in `frontend/src/components/`
- styling changes in `frontend/src/styles.ts`

## Backend changes

If you changed files under `backend/`, restart the service so FastAPI loads the new code:

```bash
sudo systemctl restart remote-lab
```

Typical examples:

- API or WebSocket changes in `backend/server.py`
- agent or tool logic in `backend/agents.py` or `backend/tools.py`
- storage, protocol, or model changes in `backend/`

## Full-stack changes

If you changed both frontend and backend:

1. rebuild the frontend with `cd frontend && bun run build`
2. restart the backend with `sudo systemctl restart remote-lab`
3. refresh the browser page

## Practical workflow

A good self-hacking loop looks like this:

1. inspect the relevant files
2. make a focused change
3. rebuild or restart only what changed
4. refresh and verify in the UI
5. repeat

## Caveat

Restarting `remote-lab` drops the active WebSocket connection briefly, but the frontend reconnects automatically and conversation history is already persisted to disk.
