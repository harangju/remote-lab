# Setup

Step-by-step guide to set up Remote Lab on a VPS.

## 1. Get a VPS

We recommend [Hetzner Cloud](https://www.hetzner.com/cloud/). It's affordable, reliable, and has good global coverage.

**Recommended specs:**

| | |
|---|---|
| **Plan** | CX22 (2 vCPU, 4 GB RAM) |
| **OS** | Ubuntu 24.04 |
| **Location** | Closest to you (see below) |

**Pick the closest datacenter for lowest latency:**

| You're in | Choose |
|-----------|--------|
| US East | Ashburn |
| US West | Hillsboro |
| Europe | Falkenstein, Nuremberg, or Helsinki |
| Asia | Singapore |

**Steps:**

1. Sign up at [hetzner.com](https://www.hetzner.com/cloud/)
2. Create a project, then add a server
3. Choose Ubuntu 24.04, your plan, and location
4. Add your SSH key (generate one with `ssh-keygen -t ed25519` if needed)
5. Create the server and note the IP address

## 2. Point your domain

Add two DNS A records pointing to your server IP:

```
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

# Firewall — only allow SSH and HTTPS
ufw default deny incoming
ufw allow 22
ufw allow 443
ufw enable

# Block brute-force SSH
apt update && apt install -y fail2ban
```

## 4. Install dependencies

```bash
# uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Bun (JS runtime + bundler)
curl -fsSL https://bun.sh/install | bash

# System packages
apt install -y caddy ripgrep

# Reload shell
source ~/.bashrc
```

## 5. Clone and install

```bash
cd /srv
git clone https://github.com/harangju/remote-lab.git
cd remote-lab

# Python deps
uv sync

# Frontend
cd frontend && bun install && bun run build && cd ..
```

## 6. Set permissions

The service runs as `www-data`. Give it ownership of the project directory:

```bash
sudo chown -R www-data:www-data /srv/remote-lab
```

## 7. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```bash
WS_TOKEN=<generate with: openssl rand -hex 32>
ALLOWED_ORIGIN=https://lab.yourdomain.com

# At least one LLM key required
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...        # optional
GOOGLE_API_KEY=AI...          # optional
```

## 8. Set up Caddy

Edit `/etc/caddy/Caddyfile`:

```
lab.yourdomain.com {
    reverse_proxy localhost:3000
}

docs.yourdomain.com {
    reverse_proxy localhost:3001
}
```

```bash
systemctl reload caddy
```

Caddy auto-provisions HTTPS certificates from Let's Encrypt.

## 9. Create systemd services

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

Start everything:

```bash
systemctl daemon-reload
systemctl enable --now remote-lab
systemctl enable --now remote-lab-docs
```

## 10. Verify

Open `https://lab.yourdomain.com` and enter your token.

```bash
systemctl status remote-lab
journalctl -u remote-lab -f   # tail logs
```

## Updating

```bash
cd /srv/remote-lab
git pull
uv sync
cd frontend && bun install && bun run build && cd ..
sudo systemctl restart remote-lab
```
