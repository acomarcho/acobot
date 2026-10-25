#!/usr/bin/env bash
# Runs the copy of acobot that is actually used, apart from this checkout.
# It copies this checkout to ~/acobot-stable, builds it there, and (re)starts it as the systemd user service
# `acobot-stable`. Editing or building this checkout afterwards does not touch the running copy.
# systemd starts it again when it crashes and when the machine boots. As a service it also has its own process
# group, so it survives whatever ran this script being stopped (a tmux server, or acocrew restarting).
# Run it again to update. That restarts the server and its OpenCode, so a reply in progress is cut short.
#
#   Is it up:    systemctl --user status acobot-stable
#   Its output:  journalctl --user -u acobot-stable -f
set -euo pipefail

src="$(cd "$(dirname "$0")/.." && pwd)"
name=acobot-stable
dest="$HOME/$name"
port="${ACOBOT_PORT:-5375}"

rsync -a --delete --exclude node_modules --exclude .git --exclude dist --exclude logbooks --exclude mocks "$src/" "$dest/"
cd "$dest"
pnpm install --frozen-lockfile
pnpm build

# A service does not get what a shell sets up. OpenCode needs the same tools on its PATH as the shell that ran
# this script, and the same folder for temporary files. Anything else it should have (tokens, for example) goes
# in ~/.acobot/env, one NAME=value per line.
# node is named by where it really is: the folder a version manager puts on the PATH can be gone after a reboot.
# pnpm puts this checkout's own tools on the PATH of the scripts it runs. Those are left out, or OpenCode would
# find them first in every repository. Repeats are dropped, so the PATH does not grow when this is run from the
# service itself.
node="$(realpath "$(command -v node)")"
path="$(tr ':' '\n' <<<"$(dirname "$node"):$PATH" | grep -v /node_modules/ | awk '!seen[$0]++' | paste -sd:)"
unit="$HOME/.config/systemd/user/$name.service"
mkdir -p "$(dirname "$unit")"
cat >"$unit" <<EOF
[Unit]
Description=acobot ($name)

[Service]
WorkingDirectory=$dest
Environment="PATH=$path"
Environment=ACOBOT_PORT=$port
${TMPDIR:+Environment="TMPDIR=$TMPDIR"}
EnvironmentFile=-$HOME/.acobot/env
ExecStart=$node apps/server/src/main.ts
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --quiet "$name"
# Lets the service start at boot, before anyone has logged in.
loginctl enable-linger "$USER"
echo "acobot runs on http://127.0.0.1:$port (systemd user service: $name)"
# The restart comes last. When this script is run from inside the copy being restarted (by OpenCode in a chat),
# the restart ends the script too. systemd carries on with the restart by itself.
systemctl --user restart "$name"
# Before it was a service, it ran in a tmux session of the same name, which still holds the port. The service
# keeps trying until the port is free. The `=` is for that exact name only.
tmux kill-session -t "=$name" 2>/dev/null || true
