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

```bash
# Remove the open 443 rule
sudo ufw delete allow 443

# Allow 443 from Cloudflare IPv4 ranges only
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
    sudo ufw allow from "$ip" to any port 443 proto tcp
done

sudo ufw reload
```

Verify with:

```bash
sudo ufw status verbose
```

You should see a list of `ALLOW IN` rules for 443, each from a Cloudflare CIDR block.

### Shortest safe order

1. Add site to Cloudflare
2. Add proxied `lab` + `docs` DNS records
3. Change nameservers
4. Verify both URLs work
5. **Then** firewall 443 to Cloudflare-only
