#!/usr/bin/env bash
# Sync the repo to the server and restart Mia. First run installs Node 24, pnpm and Caddy.
# Redeploy after any change: MIA_IP=<ip> bash deploy/aws/deploy.sh   (from the repo root; deploys the working tree)
# /etc/mia/mia.env and the MIA_BASIC_HASH line of /etc/mia/caddy.env are written by hand once (see README.md).
set -euo pipefail
: "${MIA_IP:?Elastic IP from provision.sh}"
cd "$(git rev-parse --show-toplevel)"
KEY=~/.ssh/mia-eu-central-1.pem; SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new ec2-user@$MIA_IP"
HOST="${MIA_IP//./-}.sslip.io"
# The working tree minus .gitignore (.env, .mia-data and private profiles never leave this machine).
# Untracked files that are not ignored do ship; .git/info/exclude and global excludes are not read.
rsync -az --delete -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" --filter=':- .gitignore' \
  --exclude .git --exclude .claude ./ ec2-user@"$MIA_IP":/tmp/mia-src/
$SSH "HOST=$HOST bash -s" <<'REMOTE'
set -euo pipefail
# The marker is written last: a run that stops half-way repeats the whole block (each step is safe to repeat).
if ! sudo test -f /etc/mia/.installed; then
  # Node 24 from Amazon Linux itself; Caddy is not packaged for AL2023: official release binary, checksum-checked.
  sudo dnf -y -q install nodejs24 nodejs24-npm rsync tar
  [ -x /usr/bin/node ] || sudo ln -s "$(command -v node-24)" /usr/bin/node
  [ -x /usr/bin/npm ] || sudo ln -s "$(command -v npm-24)" /usr/bin/npm
  sudo npm i -g --silent pnpm@10.33.3
  [ -x /usr/bin/pnpm ] || sudo ln -s "$(sudo npm prefix -g)/bin/pnpm" /usr/bin/pnpm
  CV=2.10.2; T=caddy_${CV}_linux_arm64.tar.gz
  if ! command -v caddy >/dev/null; then
    cd /tmp
    curl -fsSLO "https://github.com/caddyserver/caddy/releases/download/v$CV/$T"
    curl -fsSLO "https://github.com/caddyserver/caddy/releases/download/v$CV/caddy_${CV}_checksums.txt"
    grep " $T\$" "caddy_${CV}_checksums.txt" | sha512sum -c -
    tar -xzf "$T" caddy && sudo install -m 755 caddy /usr/bin/caddy && rm -f caddy "$T" "caddy_${CV}_checksums.txt"
    cd - >/dev/null
  fi
  sudo useradd --system --home /var/lib/caddy --create-home --shell /sbin/nologin caddy || true
  sudo mkdir -p /etc/caddy
  sudo tee /etc/systemd/system/caddy.service >/dev/null <<'UNIT'
[Unit]
Description=Caddy
Wants=network-online.target
After=network-online.target
[Service]
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ=false --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force
Environment=HOME=/var/lib/caddy XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/caddy
PrivateTmp=true
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
  sudo useradd --system --home /opt/mia --shell /sbin/nologin mia || true
  sudo mkdir -p /opt/mia /etc/mia && sudo chmod 750 /etc/mia
  sudo touch /etc/mia/.installed
fi
# node_modules and pnpm's store are not in the source: keep them across syncs.
sudo rsync -a --delete --exclude .mia-data --exclude node_modules --exclude .local --exclude .cache /tmp/mia-src/ /opt/mia/
sudo mkdir -p /opt/mia/.mia-data && sudo chmod 700 /opt/mia/.mia-data
sudo chown -R mia:mia /opt/mia
cd /opt/mia && sudo -u mia HOME=/opt/mia pnpm install --frozen-lockfile --prod=false >/dev/null
sudo cp deploy/aws/mia.service /etc/systemd/system/mia.service
sudo cp deploy/aws/Caddyfile /etc/caddy/Caddyfile
sudo test -f /etc/mia/caddy.env || echo "MIA_HOST=$HOST" | sudo tee /etc/mia/caddy.env >/dev/null
sudo chmod 600 /etc/mia/caddy.env
sudo mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/mia/caddy.env\n' | sudo tee /etc/systemd/system/caddy.service.d/mia.conf >/dev/null
# Secrets stay root-only even if they were written with a looser mode.
if sudo test -f /etc/mia/mia.env; then sudo chown root:root /etc/mia/mia.env && sudo chmod 600 /etc/mia/mia.env; fi
sudo systemctl daemon-reload
# Enable only once the secrets exist: otherwise a reboot would leave mia restarting every 3 s.
if sudo test -f /etc/mia/mia.env && sudo grep -q '^MIA_BASIC_HASH=' /etc/mia/caddy.env; then
  sudo systemctl enable mia caddy
  sudo systemctl restart mia caddy
  sleep 5; sudo systemctl is-active mia caddy
else
  echo "Installed. Write /etc/mia/mia.env and MIA_BASIC_HASH (README step 2), then run deploy.sh again." >&2
fi
REMOTE
echo "https://$HOST  (basic auth user: mia)"
