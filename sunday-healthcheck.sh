#!/usr/bin/env bash
set -euo pipefail

port="${PORT:-3000}"
curl_bin="${SUNDAY_CURL:-curl}"

if systemctl --user is-active --quiet sunday.service && "$curl_bin" --fail --silent --show-error --max-time 5 "http://127.0.0.1:${port}/api/health" >/dev/null; then
  exit 0
fi

systemctl --user reset-failed sunday.service || true
systemctl --user restart sunday.service
