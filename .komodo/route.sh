#!/bin/sh
# Publishes this app on the server's Caddy (owned by config): writes conf.d/<stack>.caddy from
# site.caddy, validates and reloads. Called by komodo.sh post-deploy, with STACK_NAME exported.
set -eu

: "${STACK_NAME:?}"

# Route files from the Ansible deploy, replaced by <stack>.caddy (same domain: Caddy refuses both).
LEGACY_ROUTES="acerola-sync.caddy"

conf=/etc/caddy/conf.d
dir="$(cd "$(dirname "$0")" && pwd)"

for legacy in $LEGACY_ROUTES; do
  docker exec caddy rm -f "$conf/$legacy"
done

docker exec -i caddy sh -c "cat > $conf/$STACK_NAME.caddy" <"$dir/site.caddy"

if ! docker exec caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  docker exec caddy rm -f "$conf/$STACK_NAME.caddy"
  echo "Invalid site.caddy: route removed, Caddy kept the previous config." >&2
  exit 1
fi

docker exec caddy caddy reload --config /etc/caddy/Caddyfile
