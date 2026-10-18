#!/usr/bin/env bash
#
# Server preparation, invoked over SSH by CI before every deployment:
#
#     bash provision.sh
#
# Idempotent: each step checks before it acts, so the first run sets the server up and
# later runs only rewrite .env. Everything it needs arrives as environment variables from
# the workflow (see the deploy job in .github/workflows/ci-cd.yml).
#
# What it does:
#   1. installs Docker if missing
#   2. generates the server-only secrets once (JWT secret, NID pepper, PII key)
#   3. writes .env from CI configuration + those secrets
#   4. adds an nginx site for API_DOMAIN and a Let's Encrypt certificate, once

set -euo pipefail
cd "$(dirname "$0")"

: "${API_DOMAIN:?API_DOMAIN is required}"
: "${BLOCKCHAIN_RPC_URL:?Set the BLOCKCHAIN_RPC_URL secret in GitHub}"
: "${BACKEND_PRIVATE_KEY:?Set the BACKEND_PRIVATE_KEY secret in GitHub}"
APP_PORT="${APP_PORT:-5000}"

if [[ $EUID -eq 0 ]]; then
  SUDO=''
elif sudo -n true 2>/dev/null; then
  SUDO='sudo'
else
  echo "::error:: $(whoami) needs passwordless sudo to install packages and configure nginx." >&2
  echo "On the server, run once as root:  echo '$(whoami) ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/$(whoami)" >&2
  exit 1
fi

# ── 1. Docker ──────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
if [[ -n "$SUDO" ]] && ! id -nG | grep -qw docker; then
  $SUDO usermod -aG docker "$(whoami)"
fi

# ── 2. Server-only secrets, generated once ─────────────────────────────────
# Never regenerated: a new NID pepper orphans every duplicate-detection hash and a new PII
# key makes every encrypted record unreadable. Back this file up.
if [[ ! -f secrets.env ]]; then
  echo "Generating server secrets (secrets.env)"
  umask 077
  cat > secrets.env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
NID_HMAC_PEPPER=$(openssl rand -hex 32)
PII_ENCRYPTION_KEY=$(openssl rand -hex 32)
EOF
fi
chmod 600 secrets.env

# ── 3. .env, rebuilt every deploy so GitHub stays the source of configuration ─
umask 077
{
  echo "# Written by provision.sh on every deploy — edit the GitHub secrets/variables instead."
  echo "NODE_ENV=production"
  echo "PORT=${APP_PORT}"
  echo "TRUST_PROXY=1"
  echo "MONGODB_URI=mongodb://mongo:27017/e_voting_system"
  # Unset falls back to the backend default; set the CORS_ORIGIN variable to the frontend URL.
  [[ -n "${CORS_ORIGIN:-}" ]] && echo "CORS_ORIGIN=${CORS_ORIGIN}"
  echo "BLOCKCHAIN_RPC_URL=${BLOCKCHAIN_RPC_URL}"
  echo "CONTRACT_ADDRESS=${CONTRACT_ADDRESS}"
  echo "BACKEND_PRIVATE_KEY=${BACKEND_PRIVATE_KEY}"
  echo "BLOCKCHAIN_START_BLOCK=${BLOCKCHAIN_START_BLOCK:-0}"
  echo "LOG_BLOCK_RANGE=${LOG_BLOCK_RANGE:-10}"
  echo "CONFIRMATIONS=${CONFIRMATIONS:-2}"
  echo "TRUSTEE_ADDRESSES=${TRUSTEE_ADDRESSES:-}"
  echo "PAILLIER_KEY_BITS=${PAILLIER_KEY_BITS:-2048}"
  echo "NID_PROVIDER=${NID_PROVIDER:-mock}"
  echo "FACE_PROVIDER=${FACE_PROVIDER:-mock}"
  echo "ALLOW_MOCK_PROVIDERS=${ALLOW_MOCK_PROVIDERS:-true}"
  echo "BACKEND_IMAGE=${BACKEND_IMAGE}"
  cat secrets.env
} > .env
chmod 600 .env

# Another app on the server may already own the port; fail clearly instead of letting the
# container crash-loop on "address in use".
if $SUDO ss -ltnp "( sport = :${APP_PORT} )" 2>/dev/null | grep -q LISTEN &&
  ! $SUDO ss -ltnp "( sport = :${APP_PORT} )" | grep -q docker-proxy; then
  echo "::error:: Port ${APP_PORT} is already used by another program on this server:" >&2
  $SUDO ss -ltnp "( sport = :${APP_PORT} )" >&2
  echo "Set the APP_PORT variable in GitHub to a free port (e.g. 5050) and re-run." >&2
  exit 1
fi

# ── 4. nginx + HTTPS, once ─────────────────────────────────────────────────
if ! command -v nginx >/dev/null 2>&1; then
  echo "Installing nginx"
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq nginx
fi

if [[ -d /etc/nginx/sites-available ]]; then
  SITE=/etc/nginx/sites-available/evoting-api
  ENABLED=/etc/nginx/sites-enabled/evoting-api
else
  SITE=/etc/nginx/conf.d/evoting-api.conf
  ENABLED=''
fi

# Written only when absent: certbot edits it afterwards to add TLS, and overwriting it on
# every deploy would strip HTTPS off again.
if [[ ! -f "$SITE" ]]; then
  echo "Creating nginx site for ${API_DOMAIN}"
  $SUDO tee "$SITE" >/dev/null <<EOF
server {
    listen 80;
    server_name ${API_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Relayed transactions wait for Sepolia confirmations.
        proxy_read_timeout 120s;
    }
}
EOF
  [[ -n "$ENABLED" ]] && $SUDO ln -sf "$SITE" "$ENABLED"
  $SUDO nginx -t
  $SUDO systemctl reload nginx
fi

if command -v ufw >/dev/null 2>&1 && $SUDO ufw status | grep -q 'Status: active'; then
  $SUDO ufw allow 'Nginx Full' >/dev/null 2>&1 || { $SUDO ufw allow 80 >/dev/null; $SUDO ufw allow 443 >/dev/null; }
fi

if [[ ! -d "/etc/letsencrypt/live/${API_DOMAIN}" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    echo "Installing certbot"
    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq certbot python3-certbot-nginx
  fi
  if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
    EMAIL_ARGS=(-m "$CERTBOT_EMAIL")
  else
    EMAIL_ARGS=(--register-unsafely-without-email)
  fi
  echo "Requesting a TLS certificate for ${API_DOMAIN}"
  # Not fatal: a DNS record that has not propagated yet should not block the deploy. The
  # next deploy tries again.
  $SUDO certbot --nginx -d "$API_DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}" ||
    echo "WARNING: certificate request failed — check that ${API_DOMAIN} points at this server." >&2
fi

echo "Provisioning complete"
