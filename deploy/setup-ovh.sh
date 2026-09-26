#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo: sudo bash deploy/setup-ovh.sh yourdomain.com"
  exit 1
fi

DOMAIN=${1:-}
if [[ ! ${DOMAIN} =~ ^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  echo "Usage: sudo bash deploy/setup-ovh.sh yourdomain.com"
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=$(cd -- "${SCRIPT_DIR}/.." && pwd)
APP_OWNER=${SUDO_USER:-root}

echo "Installing Nyx for ${DOMAIN} from ${APP_DIR}"
apt-get update
apt-get install -y ca-certificates curl git nginx ufw

if ! command -v node >/dev/null || [[ $(node -p 'Number(process.versions.node.split(".")[0])') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id nyx >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/nyx --shell /usr/sbin/nologin nyx
fi

cd "${APP_DIR}"
runuser -u "${APP_OWNER}" -- npm ci --omit=dev
runuser -u "${APP_OWNER}" -- npm run check:deploy

install -d -m 0750 -o root -g nyx /etc/nyx
sed "s|https://example.com|https://${DOMAIN}|g" deploy/nyx.env.example \
  | grep -v '^#' \
  | sed '/^[[:space:]]*$/d' \
  > /etc/nyx/nyx.env
chown root:nyx /etc/nyx/nyx.env
chmod 0640 /etc/nyx/nyx.env

sed "s|__NYX_ROOT__|${APP_DIR}|g" deploy/systemd/nyx.service.template \
  > /etc/systemd/system/nyx.service
sed "s|__NYX_DOMAIN__|${DOMAIN}|g" deploy/nginx/nyx.conf.template \
  > /etc/nginx/sites-available/nyx
ln -sfn /etc/nginx/sites-available/nyx /etc/nginx/sites-enabled/nyx
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl daemon-reload
systemctl enable --now nyx nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

sleep 1
curl --fail --show-error http://127.0.0.1:8080/healthz >/dev/null
echo
echo "Nyx is running. Point ${DOMAIN} and www.${DOMAIN} to this VPS IP."
echo "Then enable HTTPS with:"
echo "  sudo apt-get install -y certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
