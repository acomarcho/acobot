#!/usr/bin/env bash
# Runs the copy of acobot that is actually used, apart from this checkout.
# It copies this checkout to ~/acobot-stable, builds it there, and (re)starts it in the tmux session
# `acobot-stable`. Editing or building this checkout afterwards does not touch the running copy.
# Run it again to update. That restarts the server and its OpenCode, so a reply in progress is cut short.
set -euo pipefail

src="$(cd "$(dirname "$0")/.." && pwd)"
dest="$HOME/acobot-stable"
port="${ACOBOT_PORT:-5375}"

rsync -a --delete --exclude node_modules --exclude .git --exclude dist --exclude logbooks --exclude mocks "$src/" "$dest/"
cd "$dest"
pnpm install --frozen-lockfile
pnpm build

tmux kill-session -t acobot-stable 2>/dev/null || true
tmux new-session -d -s acobot-stable -c "$dest" "ACOBOT_PORT=$port node apps/server/src/main.ts"
echo "acobot is running on http://127.0.0.1:$port (tmux session: acobot-stable)"
