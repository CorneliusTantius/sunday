#!/bin/sh
set -eu
umask 077

repo_url="https://github.com/CorneliusTantius/sunday.git"
base="${HOME:?HOME must be set}/sunday"
app="$base/sunday"

for command in git node npm; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing requirement: %s\n' "$command" >&2; exit 1; }
done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) { console.error("Sunday requires Node.js 22.19 or newer."); process.exit(1); }'

for directory in "$base" "$base/data" "$base/data/sessions" "$base/workspace" "$base/workspace/repos" "$app"; do
  if [ -L "$directory" ]; then
    printf 'Refusing symbolic link: %s\n' "$directory" >&2
    exit 1
  fi
done
for directory in "$base" "$base/data" "$base/data/sessions" "$base/workspace" "$base/workspace/repos"; do
  mkdir -p "$directory"
  chmod 700 "$directory"
done

if [ -e "$app" ]; then
  if [ ! -d "$app/.git" ]; then
    printf 'Installation directory already exists and is not a Git checkout: %s\n' "$app" >&2
    exit 1
  fi
  printf 'Keeping existing checkout at %s (no local changes overwritten).\n' "$app"
else
  git clone "$repo_url" "$app"
fi

create_json() {
  path="$1"
  content="$2"
  if [ -L "$path" ]; then
    printf 'Refusing symbolic link: %s\n' "$path" >&2
    exit 1
  fi
  if [ ! -e "$path" ]; then
    (set -C; printf '%s\n' "$content" > "$path")
  fi
  [ -f "$path" ] || { printf 'Not a regular file: %s\n' "$path" >&2; exit 1; }
  chmod 600 "$path"
}
create_json "$base/data/settings.json" '{"mode":"api_key","model":"gpt-4o-mini"}'
create_json "$base/data/auth.json" '{}'
# The application seeds personas and installation identity on its first launch.
cd "$app"
npm ci
npm run build
printf '\nSunday installed. Start it with:\n  cd "%s" && npm start\n\nThen open http://localhost:3000 and connect a provider in Settings.\n' "$app"
