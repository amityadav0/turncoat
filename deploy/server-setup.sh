#!/usr/bin/env bash
# Turncoat guard service on a fresh Debian/Ubuntu server, behind Caddy (HTTPS), in one command.
#
#   bash server-setup.sh --domain guard.example.com --env /path/to/guard.env --commits /path/to/commits
#        [--repo https://github.com/amityadav0/turncoat.git | /local/path] [--branch main]
#        [--dir ~/turncoat] [--port 8787] [--internal-tls]
#
# Run as a normal user with sudo (root works too). Safe to run again: every step checks first.
#   1. installs Docker and the Compose plugin if missing, and makes sure the daemon runs;
#   2. installs Caddy from its official apt repository if missing;
#   3. clones the repo into --dir, or fetches and fast-forwards it;
#   4. copies --env to guard/.env (mode 600) and the commit records from --commits to
#      guard/.secrets/commits. Nothing here creates, reads out or prints a key;
#   5. starts the guard with docker compose, listening on 127.0.0.1 only, with TRUST_PROXY=1;
#   6. points Caddy at it for --domain (automatic HTTPS from Let's Encrypt; the domain's DNS A record
#      must already point at this server, and ports 80 and 443 must be open);
#   7. checks https://<domain>/health and prints PASS or FAIL (exit 0 or 1).
#
# --internal-tls is for rehearsals only: Caddy signs the certificate with its own local CA, and the
# final check resolves the domain to 127.0.0.1 and trusts that CA.
set -euo pipefail

DOMAIN="" ENV_SRC="" COMMITS_SRC="" REPO="https://github.com/amityadav0/turncoat.git" BRANCH="main"
DIR="${HOME}/turncoat" PORT="8787" INTERNAL_TLS=0
usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --env) ENV_SRC="${2:-}"; shift 2 ;;
    --commits) COMMITS_SRC="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --internal-tls) INTERNAL_TLS=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "--domain is required"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$DOMAIN" == *.* ]] || die "--domain must be a host name like guard.example.com"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be a number"
[ -n "$ENV_SRC" ] || die "--env is required (the guard's env file with its keys; this script never creates one)"
[ -f "$ENV_SRC" ] && [ -r "$ENV_SRC" ] || die "env file not found or not readable: $ENV_SRC"
[ -n "$COMMITS_SRC" ] || die "--commits is required (the folder of commit records made with 'npm run commit')"
[ -d "$COMMITS_SRC" ] || die "commits folder not found: $COMMITS_SRC"
ls "$COMMITS_SRC"/0x*.json >/dev/null 2>&1 || die "no commit records (0x….json) in $COMMITS_SRC"
ENV_SRC="$(cd "$(dirname "$ENV_SRC")" && pwd)/$(basename "$ENV_SRC")"
COMMITS_SRC="$(cd "$COMMITS_SRC" && pwd)"
# Only the variable names are checked, never the values.
for v in RPC_URL CHAIN_ID TURNCOAT_ADDRESS GUARD_SIGNER_PRIVATE_KEY; do
  grep -q "^${v}=." "$ENV_SRC" || die "the env file has no ${v}= line"
done
grep -qE '^(MODEL_API_KEY|ANTHROPIC_API_KEY)=.' "$ENV_SRC" || die "the env file has no MODEL_API_KEY= or ANTHROPIC_API_KEY= line"

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; command -v sudo >/dev/null || die "run as root or install sudo"; fi
command -v apt-get >/dev/null || die "this script supports Debian and Ubuntu (apt-get not found)"
case "$(uname -m)" in x86_64|amd64|aarch64|arm64) ;; *) die "unsupported CPU $(uname -m)" ;; esac
has_systemd() { [ -d /run/systemd/system ]; }
ME="$(id -un)"
STATE="${HOME}/.turncoat-server"; mkdir -p "$STATE"; chmod 700 "$STATE"

say "1/7 base packages"
need=()
for p in ca-certificates curl git gnupg; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
dpkg -s debian-keyring >/dev/null 2>&1 || true
if [ ${#need[@]} -gt 0 ]; then $SUDO apt-get update -qq; $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}" >/dev/null; fi
echo "ok"

say "2/7 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com -o "$STATE/get-docker.sh"
  $SUDO sh "$STATE/get-docker.sh" >/dev/null
fi
if ! $SUDO docker compose version >/dev/null 2>&1; then
  $SUDO apt-get update -qq; $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin >/dev/null
fi
if ! $SUDO docker info >/dev/null 2>&1; then
  if has_systemd; then $SUDO systemctl enable --now docker >/dev/null 2>&1 || true; fi
  $SUDO docker info >/dev/null 2>&1 || $SUDO service docker start >/dev/null 2>&1 || true
  if ! $SUDO docker info >/dev/null 2>&1; then
    # No init system (containers): run the daemon directly.
    $SUDO sh -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'
  fi
  for _ in $(seq 1 60); do $SUDO docker info >/dev/null 2>&1 && break; sleep 1; done
fi
$SUDO docker info >/dev/null 2>&1 || die "the Docker daemon is not running (see /var/log/dockerd.log or 'systemctl status docker')"
if [ -n "$SUDO" ] && ! id -nG "$ME" | grep -qw docker; then $SUDO usermod -aG docker "$ME" || true; fi
echo "$($SUDO docker --version); $($SUDO docker compose version)"

say "3/7 Caddy"
if ! command -v caddy >/dev/null; then
  $SUDO install -d -m 0755 /usr/share/keyrings
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  $SUDO apt-get update -qq
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null
fi
caddy version

say "4/7 repository ($REPO, branch $BRANCH) in $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" remote set-url origin "$REPO"
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH" 2>/dev/null || git -C "$DIR" checkout -q -b "$BRANCH" "origin/$BRANCH"
  git -C "$DIR" merge -q --ff-only "origin/$BRANCH" || die "local changes in $DIR block a fast-forward; resolve them and run again"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
echo "at $(git -C "$DIR" log --oneline -1)"

say "5/7 env file and commit records"
G="$DIR/guard"
if ! cmp -s "$ENV_SRC" "$G/.env" 2>/dev/null; then install -m 600 "$ENV_SRC" "$G/.env"; echo "guard/.env updated (mode 600)"; else chmod 600 "$G/.env"; echo "guard/.env unchanged"; fi
# The container runs as the image's "node" user (uid 1000) and reads these read-only, so they belong
# to uid 1000 with mode 600; copied with sudo, since that may not be this user.
$SUDO install -d -m 700 -o 1000 -g 1000 "$G/.secrets/commits"
n=0
for f in "$COMMITS_SRC"/0x*.json; do
  t="$G/.secrets/commits/$(basename "$f")"
  if ! $SUDO cmp -s "$f" "$t" 2>/dev/null; then $SUDO install -m 600 -o 1000 -g 1000 "$f" "$t"; fi
  n=$((n + 1))
done
echo "$n commit record(s) in guard/.secrets/commits"

say "6/7 guard service (docker compose, 127.0.0.1:$PORT, TRUST_PROXY=1)"
cat > "$STATE/compose.server.yml" <<'YAML'
# Written by deploy/server-setup.sh: the server's additions to guard/docker-compose.yml.
services:
  guard:
    build:
      network: host      # RUN steps use the host network during the build (no bridge setup needed)
    environment:
      TRUST_PROXY: "1"   # exactly one proxy (Caddy) in front: per-visitor rate limits use its X-Forwarded-For
YAML
export GUARD_PORT="$PORT" GUARD_ENV_FILE=".env" GUARD_COMMITS_DIR="./.secrets/commits"
DC=($SUDO env GUARD_PORT="$PORT" GUARD_ENV_FILE=.env GUARD_COMMITS_DIR=./.secrets/commits docker compose -p turncoat -f "$G/docker-compose.yml" -f "$STATE/compose.server.yml")
"${DC[@]}" up -d --build --remove-orphans
ok=0
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" || true)
  if [ "$code" = 200 ] || [ "$code" = 503 ]; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { "${DC[@]}" logs --tail 40 guard || true; die "the guard did not answer on 127.0.0.1:$PORT"; }
echo "guard answers on 127.0.0.1:$PORT (HTTP $code)"

say "7/7 Caddy for https://$DOMAIN"
SITE=/etc/caddy/turncoat.caddy
TLS_LINE=""; [ "$INTERNAL_TLS" = 1 ] && TLS_LINE="	tls internal"
$SUDO tee "$SITE.new" >/dev/null <<EOF
# Written by deploy/server-setup.sh
$DOMAIN {
$TLS_LINE
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
$SUDO mv "$SITE.new" "$SITE"
CF=/etc/caddy/Caddyfile
if ! $SUDO grep -qx "import $SITE" "$CF" 2>/dev/null; then
  if [ ! -s "$CF" ] || $SUDO grep -q "The Caddyfile is an easy way" "$CF"; then
    echo "import $SITE" | $SUDO tee "$CF" >/dev/null       # replace the package's placeholder page
  else
    echo "import $SITE" | $SUDO tee -a "$CF" >/dev/null    # keep other sites already configured
  fi
fi
$SUDO caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 || { $SUDO caddy validate --config "$CF" --adapter caddyfile; die "Caddyfile does not validate"; }
if has_systemd; then
  $SUDO systemctl enable --now caddy >/dev/null 2>&1
  $SUDO systemctl reload caddy
else
  if curl -s -o /dev/null http://127.0.0.1:2019/config/; then $SUDO caddy reload --config "$CF" --adapter caddyfile >/dev/null 2>&1
  else $SUDO caddy start --config "$CF" --adapter caddyfile >/dev/null 2>&1; fi
fi
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then $SUDO ufw allow 80/tcp >/dev/null; $SUDO ufw allow 443/tcp >/dev/null; fi
echo "Caddy serves $DOMAIN -> 127.0.0.1:$PORT$([ "$INTERNAL_TLS" = 1 ] && echo ' (internal CA, rehearsal)')"

CURL=(curl -sS --max-time 15)
if [ "$INTERNAL_TLS" = 1 ]; then
  CA=""
  for _ in $(seq 1 30); do
    CA=$($SUDO find / -path /proc -prune -o -path '*/caddy/pki/authorities/local/root.crt' -print 2>/dev/null | head -1)
    [ -n "$CA" ] && break; sleep 1
  done
  [ -n "$CA" ] || die "Caddy's local CA certificate was not found"
  $SUDO cat "$CA" > "$STATE/caddy-root.crt"
  CURL+=(--cacert "$STATE/caddy-root.crt" --resolve "$DOMAIN:443:127.0.0.1")
elif ! getent hosts "$DOMAIN" >/dev/null; then
  echo "warning: $DOMAIN does not resolve yet; HTTPS needs its DNS A record pointing at this server"
fi

body="" code=""
for _ in $(seq 1 40); do
  code=$("${CURL[@]}" -o "$STATE/health.json" -w '%{http_code}' "https://$DOMAIN/health" 2>/dev/null || true)
  [ "$code" = 200 ] && break
  sleep 3
done
body=$(cat "$STATE/health.json" 2>/dev/null || true)
echo
echo "https://$DOMAIN/health -> HTTP ${code:-none}"
echo "$body"
if [ "$code" = 200 ] && printf '%s' "$body" | grep -q '"ok":true'; then
  echo "PASS: the guard service is live at https://$DOMAIN"
  exit 0
fi
echo "FAIL: https://$DOMAIN/health did not return 200 with ok:true (logs: ${DC[*]} logs guard)"
exit 1
