#!/usr/bin/env bash
# FieldOS — one-time Let's Encrypt bootstrap.
#
# nginx refuses to start if the certificate files it references don't exist,
# but certbot's HTTP-01 challenge needs nginx already serving :80. This script
# breaks that chicken-and-egg:
#   1. drop a temporary self-signed cert per domain so nginx can boot,
#   2. start nginx,
#   3. delete the dummy cert and request the real one via the webroot challenge,
#   4. reload nginx.
#
# Run ONCE on the server, from the repo root, after DNS for both domains points
# at this host and .env has API_DOMAIN / DASH_DOMAIN / LETSENCRYPT_EMAIL set:
#
#   ./deploy/init-letsencrypt.sh
#
# Set STAGING=1 while testing to avoid Let's Encrypt rate limits:
#   STAGING=1 ./deploy/init-letsencrypt.sh
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

# Load .env so this script sees the same domains as compose.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

: "${API_DOMAIN:?set API_DOMAIN in .env}"
: "${DASH_DOMAIN:?set DASH_DOMAIN in .env}"
: "${LETSENCRYPT_EMAIL:?set LETSENCRYPT_EMAIL in .env}"

domains=("$API_DOMAIN" "$DASH_DOMAIN")
rsa_key_size=4096
staging_arg=""
[ "${STAGING:-0}" != "0" ] && staging_arg="--staging"

compose() { docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"; }

echo "### Downloading recommended TLS parameters ..."
compose run --rm --entrypoint "\
  sh -c 'mkdir -p /etc/letsencrypt \
    && wget -qO /etc/letsencrypt/options-ssl-nginx.conf https://raw.githubusercontent.com/certbot/certbot/main/certbot-nginx/src/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
    && (test -s /etc/letsencrypt/ssl-dhparams.pem || openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048)'" certbot

for domain in "${domains[@]}"; do
  echo "### Creating dummy certificate for $domain ..."
  path="/etc/letsencrypt/live/$domain"
  compose run --rm --entrypoint "\
    sh -c 'mkdir -p $path && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout $path/privkey.pem -out $path/fullchain.pem -subj \"/CN=$domain\"'" certbot
done

echo "### Starting nginx ..."
compose up -d nginx

for domain in "${domains[@]}"; do
  echo "### Deleting dummy certificate for $domain ..."
  compose run --rm --entrypoint "\
    rm -rf /etc/letsencrypt/live/$domain \
    /etc/letsencrypt/archive/$domain \
    /etc/letsencrypt/renewal/$domain.conf" certbot

  echo "### Requesting Let's Encrypt certificate for $domain ..."
  compose run --rm --entrypoint "\
    certbot certonly --webroot -w /var/www/certbot \
      $staging_arg \
      --email $LETSENCRYPT_EMAIL \
      -d $domain \
      --rsa-key-size $rsa_key_size \
      --agree-tos --no-eff-email \
      --force-renewal" certbot
done

echo "### Reloading nginx ..."
compose exec nginx nginx -s reload

echo "### Done. Both domains are now served over HTTPS."
