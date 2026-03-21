# Operations

## Updating Remote Lab

```bash
cd /srv/remote-lab
git pull
uv sync
cd frontend && bun install && bun run build && cd ..
sudo systemctl restart remote-lab
```

## Restarting services

```bash
sudo systemctl restart remote-lab
sudo systemctl status remote-lab
sudo systemctl restart remote-lab-docs
sudo systemctl restart remote-lab remote-lab-docs
```

## Logs

```bash
systemctl status remote-lab
journalctl -u remote-lab -f
```

## Frontend vs backend changes

- changes under `frontend/` require `cd frontend && bun run build`
- changes under `backend/` require `sudo systemctl restart remote-lab`
- full-stack changes require both

## Permissions

The service runs as `www-data`, but files may be created by another user.

A robust fix is to grant ACL access so new files and directories remain writable:

```bash
sudo setfacl -R -m u:www-data:rwX /srv/remote-lab
sudo setfacl -R -d -m u:www-data:rwX /srv/remote-lab
```

Apply the same pattern to your project directories if needed.

## Service assumptions

The service runs as `www-data` under systemd.

Practical implications:

- git identity and credentials must be configured for `www-data` (see [Deployment step 7](deployment.md#7-configure-git-for-the-agent))
- PATH may need to be extended in the systemd unit for tools installed outside standard system paths

## Reconnect behavior

Restarting `remote-lab` drops active WebSocket connections briefly, but the frontend reconnects automatically and conversation history is preserved.
