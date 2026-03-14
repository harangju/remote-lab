# Deployment

This page covers the full production-style setup for Remote Lab on a VPS.

## 1. Get a VPS

We recommend [Hetzner Cloud](https://www.hetzner.com/cloud/).

| | |
|---|---|
| **Plan** | CX22 (2 vCPU, 4 GB RAM) |
| **OS** | Ubuntu 24.04 |
| **Location** | Closest to you |

Suggested regions:

| You're in | Choose |
|-----------|--------|
| US East | Ashburn |
| US West | Hillsboro |
| Europe | Falkenstein, Nuremberg, or Helsinki |
| Asia | Singapore |

## 2. Point your domain

Add DNS A records pointing to your server IP:

```text
lab.yourdomain.com  →  <server-ip>
docs.yourdomain.com →  <server-ip>
```

Verify with:

```bash
dig +short lab.yourdomain.com
```

## 3. Secure the server

```bash
ssh root@<server-ip>
ufw default deny incoming
ufw allow 22
ufw allow 443
ufw enable
apt update && apt install -y fail2ban
```

## 4. Install dependencies

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
curl -fsSL https://bun.sh/install | bash
apt install -y caddy ripgrep
source ~/.bashrc

# Symlink bun as node (needed for global bun packages whose shims use #!/usr/bin/env node)
ln -s /root/.bun/bin/bun /usr/local/bin/node

# Marp CLI for building slide decks
bun install -g @marp-team/marp-cli
```

## 5. Clone and install

```bash
cd /srv
git clone https://github.com/harangju/remote-lab.git
cd remote-lab
uv sync
cd frontend && bun install && bun run build && cd ..
```

## 6. Set permissions

The service runs as `www-data`.

```bash
sudo chown -R www-data:www-data /srv/remote-lab
sudo chown -R www-data:www-data /srv/projects
```

Projects typically live under `/srv/projects/`. If files are later created by `root` or another user, the agent may lose write access.

## 7. Allow the agent to restart itself

```bash
echo 'www-data ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart remote-lab' | sudo tee /etc/sudoers.d/remote-lab
```

This allows the bash tool to restart the app after backend changes.

## 8. Configure environment

```bash
cp .env.example .env
```

Set at least:

```bash
WS_TOKEN=<generate with: openssl rand -hex 32>
ALLOWED_ORIGIN=https://lab.yourdomain.com
PUBLIC_BASE_URL=https://docs.yourdomain.com
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=<your Deepgram API key>   # optional, enables voice input
OPENAI_API_KEY=sk-...   # optional
GOOGLE_API_KEY=AI...    # optional
```

`PUBLIC_BASE_URL` is used by `/share` and `/shares` to report published URLs on the docs/public site instead of the lab app origin.

If `DEEPGRAM_API_KEY` is configured, users can start **voice input** from the chat composer. Browser microphone audio is streamed to the backend, proxied to Deepgram's realtime API (`nova-3`), and partial/final transcripts are inserted into the draft without auto-sending.

## 9. Set up Caddy

Edit `/etc/caddy/Caddyfile`:

```caddy
lab.yourdomain.com {
    reverse_proxy localhost:3000
}

docs.yourdomain.com {
    reverse_proxy localhost:3001
}
```

Then reload:

```bash
systemctl reload caddy
```

## 10. Create systemd services

`/etc/systemd/system/remote-lab.service`:

```ini
[Unit]
Description=remote-lab
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/remote-lab
EnvironmentFile=/srv/remote-lab/.env
ExecStart=/usr/local/bin/uv run uvicorn backend.server:app --host 0.0.0.0 --port 3000
Restart=always

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/remote-lab-docs.service`:

```ini
[Unit]
Description=remote-lab-docs
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/remote-lab
EnvironmentFile=/srv/remote-lab/.env
ExecStart=/usr/local/bin/uv run uvicorn backend.docs_server:app --host 0.0.0.0 --port 3001
Restart=always

[Install]
WantedBy=multi-user.target
```

Start them:

```bash
systemctl daemon-reload
systemctl enable --now remote-lab
systemctl enable --now remote-lab-docs
```

## 11. Verify

Open `https://lab.yourdomain.com` and enter your token.

```bash
systemctl status remote-lab
journalctl -u remote-lab -f
```
