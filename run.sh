#!/bin/sh
set -eu
umask 077

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
log_dir="${HOME:?HOME must be set}/sunday/data"
log_file="$log_dir/sunday.log"

cd "$project_dir"
git pull
npm install
npm run build

mkdir -p "$log_dir"
chmod 700 "$log_dir"
nohup npm start >>"$log_file" 2>&1 </dev/null &
server_pid=$!
printf 'Sunday started in the background (PID %s).\nLogs: %s\n' "$server_pid" "$log_file"
