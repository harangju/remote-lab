# md-server

Bun + TypeScript server that renders markdown files as responsive HTML.

## How it works

```
browser → Caddy (HTTPS, port 443) → Bun server (port 3000) → reads .md file → returns HTML
```

- **`server.ts`** — Bun HTTP server. On each request, reads a `.md` file from `docs/`, renders it to HTML with `marked`, and wraps it in a responsive template. No build step, no caching — renders fresh every time.
- **`docs/`** — Drop `.md` files here. They show up on the index page sorted by last modified. Symlinks work, so you can link to files in other repos.
- **`Caddyfile`** — Reference copy. The live one is at `/etc/caddy/Caddyfile`.

## Routes

| Route | What it does |
|-------|-------------|
| `/` | Lists all `.md` files in `docs/`, sorted by last modified |
| `/:slug` | Renders `docs/{slug}.md` as HTML |

## What's in the HTML template

- **MathJax v3** — renders LaTeX math. Inline `$...$` and display `$$...$$`.
- **Hypothesis** — adds inline annotation/commenting sidebar (via hypothes.is embed script).
- **Responsive CSS** — mobile-friendly, dark mode via `prefers-color-scheme`.

## Adding documents

Drop a markdown file in `docs/`:

```bash
cp ~/notes.md /srv/md-server/docs/
```

Or symlink from another repo:

```bash
ln -s /path/to/other-repo/paper.md /srv/md-server/docs/paper.md
```

## Services

Two systemd services run this:

### md-server (the Bun app)

```
/etc/systemd/system/md-server.service
```

```bash
systemctl status md-server    # check status
systemctl restart md-server   # restart after code changes
journalctl -u md-server -f    # tail logs
```

### Caddy (reverse proxy + HTTPS)

```
/etc/caddy/Caddyfile
```

Caddy reverse-proxies your domain → `localhost:3000` and auto-provisions Let's Encrypt TLS certs.

```bash
systemctl status caddy
systemctl reload caddy        # reload after Caddyfile changes
journalctl -u caddy -f
```

## Domain setup

Get a domain and point an A record at your server IP — Caddy handles HTTPS automatically.

1. Add an A record: **Host** = your subdomain (e.g. `lab`), **Value** = `<your-server-ip>`
2. Update the `Caddyfile` with your domain
3. Reload Caddy: `systemctl reload caddy`

## Access control

Restrict access to individual documents using `docs/.access.json`. Documents not listed are public.

```json
{
  "my-private-doc": ["tok_abc123", "tok_def456"],
  "another-doc": ["tok_abc123"]
}
```

Each key is a document slug, and the value is a list of tokens that grant access. Share the secret link:

```
https://yourdomain.com/my-private-doc?token=tok_abc123
```

Tokens also work via `Authorization: Bearer tok_abc123` header.

Generate a token:

```bash
openssl rand -hex 16
```

Restricted documents are hidden from the index unless the viewer has a valid token.

## Security

Lock down the server to only what's needed — SSH for access and HTTPS for traffic.

```bash
ufw default deny incoming    # block ALL incoming traffic by default
ufw allow 22                 # then poke a hole for SSH
ufw allow 443                # and a hole for HTTPS
ufw enable                   # turn on the firewall
apt install fail2ban         # auto-bans IPs after repeated failed SSH attempts
```

## Dependencies

- **Runtime:** [Bun](https://bun.sh)
- **npm:** `marked` (markdown → HTML)
- **System:** `caddy` (installed via apt from official repo)
