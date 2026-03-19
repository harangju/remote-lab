# Getting Started

This is the fastest path to a working Remote Lab install on a VPS.

Remote Lab is a persistent, mobile-friendly, self-hosted AI workspace: you can run agents against real files and shell tools on your own server, leave, and reconnect later from your laptop or phone.

If you want the full server provisioning and operations details, read [Deployment](reference/deployment.md).

## What you need

- a VPS running Ubuntu 24.04
- a domain name pointing at that VPS
- at least one LLM API key
- SSH access as `root`

Recommended baseline:

| | |
|---|---|
| **Plan** | 2 vCPU, 4 GB RAM |
| **OS** | Ubuntu 24.04 |
| **Provider** | Hetzner Cloud works well |

## 1. Install system dependencies

SSH into the server, then install the required tools.

```bash
# packages
apt update
apt install -y unzip caddy ripgrep

# uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Bun
curl -fsSL https://bun.sh/install | bash

source ~/.bashrc
```

## 2. Clone and install Remote Lab

```bash
cd /srv
git clone https://github.com/harangju/remote-lab.git
cd remote-lab
uv sync
cd frontend && bun install && bun run build && cd ..
```

## 3. Configure the app

```bash
cp .env.example .env
```

Edit `.env` and set:

```bash
WS_TOKEN=<generate with: openssl rand -hex 32>
ALLOWED_ORIGIN=https://lab.yourdomain.com
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=<your Deepgram API key>   # optional, enables voice input
```

You can also add other providers such as OpenAI or Gemini.

If `DEEPGRAM_API_KEY` is set, the chat composer shows a **Voice** button that streams microphone audio to Deepgram and inserts a live transcript into the draft. If you leave it unset, the rest of the app still works normally — voice input is just unavailable.

## 4. Make files writable by the service

The app runs as `www-data`.

```bash
sudo chown -R www-data:www-data /srv/remote-lab
sudo chown -R www-data:www-data /srv/projects
```

If you add or copy project files later as another user, fix ownership again or use the ACL approach described in [Operations](reference/operations.md).

## 5. Configure Caddy

Point your domain to the server, then add a Caddy site:

```caddy
lab.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Reload Caddy:

```bash
systemctl reload caddy
```

## 6. Create the systemd service

Create `/etc/systemd/system/remote-lab.service`:

```ini
[Unit]
Description=remote-lab
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/remote-lab
EnvironmentFile=/srv/remote-lab/.env
ExecStart=/usr/local/bin/uv run uvicorn backend.server:app --host 127.0.0.1 --port 3000
Restart=always

[Install]
WantedBy=multi-user.target
```

Then start it:

```bash
systemctl daemon-reload
systemctl enable --now remote-lab
```

## 7. Open the app

Visit `https://lab.yourdomain.com` and enter your `WS_TOKEN`.

## Next steps

- Read [Projects and Chat](guides/projects-and-chat.md)
- Read [Files and Tools](guides/files-and-tools.md)
- Read [Agents and Mentions](guides/agents-and-mentions.md)
- Use [Deployment](reference/deployment.md) for the full production setup
