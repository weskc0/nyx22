# Deploy Nyx on one OVHcloud VPS

Nyx and its Wisp WebSocket server run together on one VPS. Nginx accepts public HTTP/HTTPS traffic and forwards it to Nyx on private port `8080`. No `WISP_URL` is needed.

## Before buying anything

- Buy the domain from Namecheap without web hosting, paid SSL, or PremiumDNS.
- Buy an OVHcloud VPS with Ubuntu 24.04 and at least 2 GB RAM.
- Keep the domain on Namecheap BasicDNS.
- Use this repository under the name `nyx`.

## 1. Check and push the repository

On the development computer:

```powershell
npm ci
npm run check:deploy
git status --short
git add -A
git commit -m "Prepare Nyx for OVHcloud"
git push
```

Never commit `.env` files, private keys, passwords, or API keys.

## 2. Clone Nyx onto the VPS

Connect to the new VPS using the IP address supplied by OVHcloud:

```powershell
ssh ubuntu@YOUR_VPS_IP
```

Some OVH images use a different initial username. Use the username shown in the OVHcloud installation email.

On the VPS, install Git and clone the repository into the expected location:

```bash
sudo apt-get update
sudo apt-get install -y git
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
git clone git@github.com:YOUR-GITHUB-USERNAME/nyx.git /var/www/nyx
cd /var/www/nyx
```

For a private GitHub repository, add the VPS public SSH key as a read-only GitHub deploy key before cloning.

## 3. Run the prepared OVH installer

Replace `yourdomain.com` with the purchased domain, without `www`:

```bash
sudo bash deploy/setup-ovh.sh yourdomain.com
```

The installer:

- installs Node.js 22, Nginx, Git, and the firewall;
- installs production dependencies and checks the deployment;
- creates a locked-down `nyx` service account;
- installs and starts the `nyx.service` systemd service;
- configures Nginx, including Wisp WebSocket forwarding;
- opens only SSH, HTTP, and HTTPS in the firewall;
- confirms `/healthz` responds locally.

Check the service at any time with:

```bash
sudo systemctl status nyx
sudo journalctl -u nyx -n 100 --no-pager
```

## 4. Point Namecheap DNS at OVHcloud

In Namecheap, open **Domain List > Manage > Advanced DNS**. Add:

| Type | Host | Value |
| --- | --- | --- |
| A Record | `@` | `YOUR_VPS_IP` |
| A Record | `www` | `YOUR_VPS_IP` |

Use automatic TTL. Remove conflicting parking records for `@` or `www`, but preserve mail records. Wait until both names resolve to the VPS.

## 5. Enable free HTTPS

Only after the DNS records point to the VPS:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
sudo certbot renew --dry-run
```

Then verify:

```bash
curl https://yourdomain.com/healthz
```

The result should contain `"ok":true` and `"wisp":"embedded"`.

## Updating Nyx later

The `nyx` service account only runs the application; your SSH user continues to own and update the repository. Update with:

```bash
git -C /var/www/nyx pull --ff-only
npm --prefix /var/www/nyx ci --omit=dev
sudo systemctl restart nyx
curl --fail https://yourdomain.com/healthz
```

## Optional Nyx AI secret

The application does not automatically read a project `.env` file. Put server-only variables in `/etc/nyx/nyx.env`:

```bash
sudo nano /etc/nyx/nyx.env
sudo systemctl restart nyx
```

Add `NYX_AI_API_KEY=...` or `OPENROUTER_API_KEY=...`. Never add those values to this repository.
