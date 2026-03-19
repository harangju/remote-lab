# Tailscale

Tailscale creates a private WireGuard mesh (a "tailnet") so you can reach your VPS without exposing SSH to the public internet.

## 1. Install Tailscale on the VPS

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

## 2. Bring it up

```bash
sudo tailscale up
```

## 3. Authenticate

Open the login link it prints and authenticate in your browser.

## 4. Confirm the VPS got a Tailscale IP

```bash
tailscale ip -4
```

You should see a `100.x.y.z` address.

## 5. Install Tailscale on your laptop

- Log into the same tailnet.
- Confirm you can reach the VPS over its Tailscale IP:

```bash
ssh user@100.x.y.z
```

## 6. Lock down SSH

Do this **only after** you've successfully SSH'd to the VPS over its Tailscale IP.

### Firewall SSH to Tailscale only

If using `ufw`:

```bash
# Remove any existing allow rules for port 22
sudo ufw delete allow 22
sudo ufw delete allow 22/tcp

# Allow SSH only on the Tailscale interface, deny everywhere else
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw deny 22/tcp
sudo ufw reload
```

Then verify:

```bash
sudo ufw status verbose
```

You should see:

```text
To                         Action      From
--                         ------      ----
443                        ALLOW IN    Anywhere
22/tcp on tailscale0       ALLOW IN    Anywhere
22/tcp                     DENY IN     Anywhere
443 (v6)                   ALLOW IN    Anywhere (v6)
22/tcp (v6) on tailscale0  ALLOW IN    Anywhere (v6)
22/tcp (v6)                DENY IN     Anywhere (v6)
```

That keeps sshd running, but only reachable via `tailscale0`.

### If `ufw` is not active

Use your host firewall tool directly, but the idea is the same:

- allow `22/tcp` on interface `tailscale0`
- deny `22/tcp` on public interfaces

### Very important

Keep your **current public SSH session open** while testing a **new Tailscale SSH session**.

```bash
ssh your-user@<vps-tailscale-ip>
```

If that works after the firewall change, you're done.

### Desired state

- `22` reachable via **Tailscale only**
- `443` reachable publicly
- everything else closed unless intentional

## 7. Update your SSH config

Now that public SSH is closed, update `~/.ssh/config` on your laptop to use the Tailscale IP:

```ssh-config
Host my-vps
    HostName 100.x.y.z    # your VPS's Tailscale IP
    User your-user
    IdentityFile ~/.ssh/id_ed25519_hetzner
    SetEnv TERM=xterm-256color
```

Then connect with:

```bash
ssh my-vps
```

### Verify the new setup

What should happen:

- `ssh your-user@<public-ip-or-domain>` → **fail** (port 22 denied publicly)
- `ssh your-user@<tailscale-ip>` with Tailscale on → **work**

## Troubleshooting

If SSH over the Tailscale IP isn't working, check these on the VPS:

```bash
tailscale ip -4              # confirm the Tailscale IP
ip addr show tailscale0      # confirm the interface is up
sudo ss -tulpn | grep ':22\b'  # confirm sshd is listening
```

Likely causes:

1. `tailscale0` isn't up on the VPS
2. You're using the wrong Tailscale IP
3. sshd is running but Tailscale ACLs or routing are blocking it
4. You're still SSHing to the public IP or domain instead of the `100.x.y.z` address
