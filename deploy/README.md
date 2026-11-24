# Server setup

`server-setup.sh` puts the guard service on a fresh Debian or Ubuntu server (x86-64), behind Caddy with automatic HTTPS, in one command. Running it again is safe: it updates the code, the env file and the commit records, and restarts what changed.

## On the server

1. Point the domain's DNS **A record** at the server's IP address, and wait until `getent hosts guard.example.com` shows it.
2. Copy two things to the server (for example with `scp`):
   - the guard env file with its keys (`guard/.env` on mainnet, `guard/.env.testnet` on testnet);
   - the folder of commit records made with `npm run commit` (`guard/.secrets/commits`, or `guard/.secrets/commits-testnet` on testnet).
3. Run, as your normal user (it uses `sudo` where needed):

```bash
curl -fsSLO https://raw.githubusercontent.com/amityadav0/turncoat/main/deploy/server-setup.sh
bash server-setup.sh --domain guard.example.com --env ~/guard.env --commits ~/commits
```

It ends with `PASS: the guard service is live at https://guard.example.com`, or `FAIL` and the reason.

Options:
- `--branch <name>` deploys another branch (default `main`).
- `--repo <url or path>` uses another copy of the repository.
- `--dir <path>` sets the checkout location (default `~/turncoat`).
- `--port <n>` sets the local port behind Caddy (default 8787).

What it does:
1. Installs Docker with the Compose plugin and Caddy, each only if missing.
2. Clones the repository, or fast-forwards it.
3. Copies the env file to `guard/.env` (mode 600) and the commit records to `guard/.secrets/commits`.
4. Starts the guard with `docker compose`, on `127.0.0.1` only and with `TRUST_PROXY=1`.
5. Configures Caddy for the domain in `/etc/caddy/turncoat.caddy`, which `/etc/caddy/Caddyfile` imports.

It never creates, prints or logs a key.

Afterwards:
- Logs: `sudo docker compose -p turncoat -f ~/turncoat/guard/docker-compose.yml logs -f guard`.
- Health: `curl https://guard.example.com/health`.

## Rehearsal (no server needed)

The same script runs in a privileged x86-64 Ubuntu 24.04 container, with Caddy's internal CA for a made-up domain:

```bash
B=$(git branch --show-current); git bundle create /tmp/turncoat.bundle "$B"
docker run -d --name tc-srv --platform linux/amd64 --privileged -v "$PWD/deploy:/deploy:ro" ubuntu:24.04 sleep infinity
docker exec tc-srv bash -c 'apt-get update -qq && apt-get install -y -qq sudo && useradd -m amit && echo "amit ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/amit && mkdir -p /home/amit/in'
docker cp /tmp/turncoat.bundle tc-srv:/home/amit/in/
docker cp guard/.env.testnet tc-srv:/home/amit/in/guard.env
docker cp guard/.secrets/commits-testnet tc-srv:/home/amit/in/commits
docker exec tc-srv chown -R amit /home/amit/in
docker exec -u amit -w /home/amit tc-srv bash /deploy/server-setup.sh --domain guard.turncoat.test \
  --env /home/amit/in/guard.env --commits /home/amit/in/commits \
  --repo /home/amit/in/turncoat.bundle --branch "$B" --internal-tls
docker rm -f tc-srv
```

`--internal-tls` is only for rehearsals: Caddy signs the certificate itself, and the final check resolves the domain to `127.0.0.1` and trusts that CA.
