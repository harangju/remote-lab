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
install -m 755 ~/.local/bin/uv /usr/local/bin/uv

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
sudo chown -R www-data:www-data /var/www
```

If you add or copy project files later as another user, fix ownership again or use the ACL approach described in [Operations](reference/operations.md). `/var/www` also needs to be writable by `www-data` so `uv` can create its cache under `/var/www/.cache/uv`.

## 5. Configure Caddy

In this step, you are doing two things:

1. setting DNS so your domain points to your VPS
2. editing Caddy's config on the server so that domain forwards traffic to Remote Lab

First, go to wherever your domain is managed and create an `A` record for your subdomain. For example, if your server IP is `203.0.113.10`, create:

- `lab.example.com -> 203.0.113.10`

2. On the server, open Caddy's config file:

```bash
sudo nano /etc/caddy/Caddyfile
```

3. Add a site block like this:

```caddy
lab.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Replace `lab.yourdomain.com` with your real domain.

This means: when someone visits that domain, Caddy should send the request to Remote Lab running locally on port `3000`.

4. Save the file, then reload Caddy:

```bash
sudo systemctl reload caddy
```

After this, requests to `https://lab.yourdomain.com` will go through Caddy to the app.

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
