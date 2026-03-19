# Cloudflare

Cloudflare sits in front of your VPS as a reverse proxy, providing DDoS protection, CDN caching, and free TLS. Traffic flows: user → Cloudflare → your VPS origin.

## 1. Add your domain to Cloudflare

- Create or log into a [Cloudflare](https://dash.cloudflare.com) account.
- Click **Add site** and enter your domain (e.g. `harangju.com`).
- Pick the **Free** plan.
- Cloudflare will scan your existing DNS records.

## 2. Create proxied DNS records

In Cloudflare DNS, add two **A** records pointing to your VPS public IP:

| Type | Name | Content | Proxy status |
|------|------|---------|--------------|
| A | `lab` | `<vps-public-ip>` | Proxied (orange cloud) |
| A | `docs` | `<vps-public-ip>` | Proxied (orange cloud) |

Both must be **Proxied**, not DNS-only.

## 3. Point your registrar nameservers to Cloudflare

Cloudflare will give you two nameservers. At your domain registrar, replace the current nameservers with those.

### Squarespace Domains

1. Log in to [Squarespace Domains](https://domains.squarespace.com).
2. Go to **Domains** → click your domain.
3. Open **DNS Settings** or **Nameservers**.
4. Choose **Use custom nameservers**.
5. Replace the current nameservers with the two Cloudflare nameservers.
6. Save.

!!! warning
    Once you switch nameservers, **Cloudflare becomes your DNS manager** for the domain. Make sure the `lab` and `docs` records exist in Cloudflare first.

## 4. Wait for propagation

This can take a few minutes to a few hours. Check propagation with:

```bash
dig +short lab.yourdomain.com
dig +short docs.yourdomain.com
```

When ready, both should resolve through Cloudflare (you'll see Cloudflare IPs, not your raw VPS IP).

## 5. Verify the sites still load

Check both URLs in your browser:

- `https://lab.yourdomain.com`
- `https://docs.yourdomain.com`

## 6. Set Cloudflare SSL mode

In Cloudflare dashboard → **SSL/TLS** → set the mode to **Full** or **Full (strict)**.

Do **not** use Flexible — it causes redirect loops with Caddy.

## 7. Lock down the VPS origin

Only after step 5 works, restrict port `443` on the VPS to Cloudflare IPs only. This prevents anyone from bypassing Cloudflare and hitting your origin directly.

Keep your current SSH session open while doing this.

### Allow Cloudflare IPs

These are [Cloudflare's published IP ranges](https://www.cloudflare.com/ips/) — global edge IPs, not account-specific.

```bash
# IPv4
sudo ufw allow proto tcp from 173.245.48.0/20 to any port 443
sudo ufw allow proto tcp from 103.21.244.0/22 to any port 443
sudo ufw allow proto tcp from 103.22.200.0/22 to any port 443
sudo ufw allow proto tcp from 103.31.4.0/22 to any port 443
sudo ufw allow proto tcp from 141.101.64.0/18 to any port 443
sudo ufw allow proto tcp from 108.162.192.0/18 to any port 443
sudo ufw allow proto tcp from 190.93.240.0/20 to any port 443
sudo ufw allow proto tcp from 188.114.96.0/20 to any port 443
sudo ufw allow proto tcp from 197.234.240.0/22 to any port 443
sudo ufw allow proto tcp from 198.41.128.0/17 to any port 443
sudo ufw allow proto tcp from 162.158.0.0/15 to any port 443
sudo ufw allow proto tcp from 104.16.0.0/13 to any port 443
sudo ufw allow proto tcp from 104.24.0.0/14 to any port 443
sudo ufw allow proto tcp from 172.64.0.0/13 to any port 443
sudo ufw allow proto tcp from 131.0.72.0/22 to any port 443

# IPv6
sudo ufw allow proto tcp from 2400:cb00::/32 to any port 443
sudo ufw allow proto tcp from 2606:4700::/32 to any port 443
sudo ufw allow proto tcp from 2803:f800::/32 to any port 443
sudo ufw allow proto tcp from 2405:b500::/32 to any port 443
sudo ufw allow proto tcp from 2405:8100::/32 to any port 443
sudo ufw allow proto tcp from 2a06:98c0::/29 to any port 443
sudo ufw allow proto tcp from 2c0f:f248::/32 to any port 443
```

### Remove broad public 443 rules

```bash
# Remove all broad allow rules for 443
sudo ufw delete allow 443
sudo ufw delete allow 443/tcp

# Deny 443 generally (Cloudflare-specific allows take precedence)
sudo ufw deny 443/tcp
sudo ufw reload
```

If the `delete` commands fail (rule not found), use numbered rules instead:

```bash
sudo ufw status numbered
sudo ufw delete <number>
```

### Verify

```bash
sudo ufw status verbose
```

The desired final state:

- `22/tcp on tailscale0` — allow
- `22/tcp` — deny
- `443/tcp` — allow from each Cloudflare CIDR only
- `443/tcp` — deny generally
- **No** `443 ALLOW IN Anywhere` rules

Then test:

- `https://lab.yourdomain.com` → **should work** (traffic goes through Cloudflare)
- `https://<vps-public-ip>` → **should fail** (direct origin access blocked)

### Shortest safe order

1. Add site to Cloudflare
2. Add proxied `lab` + `docs` DNS records
3. Change nameservers
4. Verify both URLs work
5. Set SSL mode to Full (strict)
6. **Then** firewall 443 to Cloudflare-only
