#!/bin/sh
set -eu

# Send SIGTERM so Sunday can close its SQLite databases cleanly.
fuser -k -TERM 3000/tcp
