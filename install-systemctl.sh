#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  echo "Run this script as your normal user, not with sudo." >&2
  exit 1
fi

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
username="$(id -un)"
npm_path="$(command -v npm || true)"
curl_path="$(command -v curl || true)"
port="${PORT:-3000}"

if [[ -z "$npm_path" || -z "$curl_path" ]]; then
  echo "npm and curl must be installed and available on PATH." >&2
  exit 1
fi
if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  echo "PORT must be a valid TCP port (1-65535)." >&2
  exit 1
fi
if [[ ! -d "$project_dir/node_modules" ]]; then
  echo "Dependencies are missing. Run npm install in $project_dir first." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "A running systemd user manager is required." >&2
  exit 1
fi

(cd "$project_dir" && npm run build)
mkdir -p "$config_dir"
service_path="$(dirname -- "$npm_path"):$PATH"

cat > "$config_dir/sunday.service" <<EOF
[Unit]
Description=Sunday AI assistant
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory="$project_dir"
ExecStart="$npm_path" start
Environment="PATH=$service_path"
Environment="PORT=$port"
Restart=always
RestartSec=5s
TimeoutStopSec=30s

[Install]
WantedBy=default.target
EOF

cat > "$config_dir/sunday-healthcheck.service" <<EOF
[Unit]
Description=Check Sunday health and restart it if unavailable

[Service]
Type=oneshot
Environment="PATH=$service_path"
Environment="PORT=$port"
Environment="SUNDAY_CURL=$curl_path"
ExecStart="$project_dir/sunday-healthcheck.sh"
EOF

cat > "$config_dir/sunday-healthcheck.timer" <<'EOF'
[Unit]
Description=Periodically check Sunday health

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=15s
Unit=sunday-healthcheck.service

[Install]
WantedBy=timers.target
EOF

chmod 644 "$config_dir/sunday.service" "$config_dir/sunday-healthcheck.service" "$config_dir/sunday-healthcheck.timer"
systemctl --user daemon-reload
systemctl --user enable --now sunday.service sunday-healthcheck.timer

if command -v loginctl >/dev/null 2>&1 && [[ "$(loginctl show-user "$username" -p Linger --value 2>/dev/null || true)" != yes ]]; then
  if command -v sudo >/dev/null 2>&1; then
    sudo loginctl enable-linger "$username" || echo "Warning: enable lingering manually to keep Sunday running after logout: sudo loginctl enable-linger $username" >&2
  else
    echo "Warning: enable lingering to keep Sunday running after logout: sudo loginctl enable-linger $username" >&2
  fi
fi

printf 'Installed Sunday user service and healthcheck timer.\n'
printf 'Service: systemctl --user status sunday.service\n'
printf 'Logs:    journalctl --user -u sunday.service -f\n'
printf 'Health:  systemctl --user status sunday-healthcheck.timer\n'
printf 'URL:     http://localhost:%s\n' "$port"
