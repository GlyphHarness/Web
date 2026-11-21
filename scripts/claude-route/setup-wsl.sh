#!/bin/sh
# claude-route slice 1: a tmux session `claude` running the stock Claude Code TUI in a WSL distro,
# so the user signs in themselves. Re-runnable. Never reads, copies, logs or stores a credential,
# never signs in, opens no port, installs no sshd.
#
# Usage (from a Windows shell with sh, e.g. Git Bash, at the repo root):
#   sh scripts/claude-route/setup-wsl.sh [DISTRO]        DISTRO defaults to UbuntuBase (or $WH_CLAUDE_DISTRO)
# or inside the distro, as root:
#   sh /mnt/c/.../setup-wsl.sh
# Env: WH_CLAUDE_USER (default wh), WH_CLAUDE_DIR (default ~/claude-work), WH_CLAUDE_SESSION (default claude),
#      WH_CLAUDE_UPDATE=1 reinstalls/updates the npm package.
set -eu

USER_NAME=${WH_CLAUDE_USER:-wh}
SESSION=${WH_CLAUDE_SESSION:-claude}
PKG=@anthropic-ai/claude-code

if [ -z "${WSL_DISTRO_NAME:-}" ]; then
  # Host side: re-run this same script inside the distro, as root (the default WSL user there).
  DISTRO=${1:-${WH_CLAUDE_DISTRO:-UbuntuBase}}
  here=$(cd "$(dirname "$0")" && pwd)
  win=$(cygpath -m "$here/setup-wsl.sh" 2>/dev/null || echo "$here/setup-wsl.sh")
  export MSYS_NO_PATHCONV=1
  lin=$(wsl.exe -d "$DISTRO" -u root -- wslpath -u "$win" | tr -d '\r')
  WSLENV=WH_CLAUDE_USER:WH_CLAUDE_DIR:WH_CLAUDE_SESSION:WH_CLAUDE_UPDATE exec wsl.exe -d "$DISTRO" -u root -- sh "$lin"
fi

[ "$(id -u)" = 0 ] || { echo "run as root inside the distro (wsl -u root); no sudo password is used" >&2; exit 1; }
id "$USER_NAME" >/dev/null 2>&1 || { echo "user $USER_NAME missing in $WSL_DISTRO_NAME" >&2; exit 1; }
HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
WORKDIR=${WH_CLAUDE_DIR:-$HOME_DIR/claude-work}
PREFIX=$HOME_DIR/.npm-global

# 1. apt: only what is missing (tmux, curl, ca-certificates; nodejs+npm only when node < 18)
need=""
command -v tmux >/dev/null 2>&1 || need="$need tmux"
command -v curl >/dev/null 2>&1 || need="$need curl"
[ -e /etc/ssl/certs/ca-certificates.crt ] || need="$need ca-certificates"
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 18 ] || ! command -v npm >/dev/null 2>&1; then need="$need nodejs npm"; fi
if [ -n "$need" ]; then
  echo "apt install:$need"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $need
fi

# 2. claude code in the user's home (rootless npm prefix)
runuser -u "$USER_NAME" -- sh -c '
  set -eu
  mkdir -p "$1" "$2"
  if [ ! -x "$1/bin/claude" ] || [ "${WH_CLAUDE_UPDATE:-}" = 1 ]; then
    npm install -g --prefix "$1" "$3"
  fi
' sh "$PREFIX" "$WORKDIR" "$PKG"

# 3. tmux session, stock sign-in: the three variables are unset for it, nothing else is passed.
run_as() { runuser -u "$USER_NAME" -- env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  HOME="$HOME_DIR" PATH="$PREFIX/bin:/usr/local/bin:/usr/bin:/bin" "$@"; }
if run_as tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session $SESSION already exists"
else
  run_as tmux new-session -d -s "$SESSION" -c "$WORKDIR" "claude; exec bash -l"
  echo "tmux session $SESSION started in $WORKDIR"
fi
run_as claude --version
echo "attach: wsl -d $WSL_DISTRO_NAME -u $USER_NAME -- tmux attach -t $SESSION"
