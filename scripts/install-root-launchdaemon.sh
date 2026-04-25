#!/usr/bin/env bash
set -euo pipefail

LABEL="com.minje.codexclaw"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
TSX_CLI="${TSX_CLI:-${REPO_DIR}/node_modules/tsx/dist/cli.mjs}"
ENTRYPOINT="${ENTRYPOINT:-${REPO_DIR}/src/index.ts}"
OWNER_HOME="${CODEXCLAW_HOME:-/Users/home}"
OWNER_UID="${OWNER_UID:-${SUDO_UID:-501}}"
CODEX_HOME_VALUE="${CODEX_HOME:-${OWNER_HOME}/.codex}"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
AGENT_PLIST="${OWNER_HOME}/Library/LaunchAgents/${LABEL}.plist"
TMP_PLIST="$(mktemp)"

cleanup() {
  rm -f "${TMP_PLIST}"
}
trap cleanup EXIT

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo \
    CODEXCLAW_HOME="${OWNER_HOME}" \
    CODEX_HOME="${CODEX_HOME_VALUE}" \
    NODE_BIN="${NODE_BIN}" \
    TSX_CLI="${TSX_CLI}" \
    ENTRYPOINT="${ENTRYPOINT}" \
    OWNER_UID="${OWNER_UID}" \
    "$0" "$@"
fi

if [[ ! -x "${NODE_BIN}" ]]; then
  echo "Node binary is not executable: ${NODE_BIN}" >&2
  exit 1
fi

if [[ ! -f "${TSX_CLI}" ]]; then
  echo "tsx CLI was not found: ${TSX_CLI}" >&2
  echo "Run npm install in ${REPO_DIR} first." >&2
  exit 1
fi

if [[ ! -f "${ENTRYPOINT}" ]]; then
  echo "Entrypoint was not found: ${ENTRYPOINT}" >&2
  exit 1
fi

/bin/launchctl bootout "gui/${OWNER_UID}" "${AGENT_PLIST}" 2>/dev/null || true
/bin/launchctl bootout "system/${LABEL}" 2>/dev/null || true
/bin/launchctl bootout system "${PLIST}" 2>/dev/null || true

/bin/cat >"${TMP_PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>UserName</key>
  <string>root</string>
  <key>GroupName</key>
  <string>wheel</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${TSX_CLI}</string>
    <string>${ENTRYPOINT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${OWNER_HOME}</string>
    <key>CODEX_HOME</key>
    <string>${CODEX_HOME_VALUE}</string>
    <key>PATH</key>
    <string>${REPO_DIR}/node_modules/.bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${REPO_DIR}/bot.log</string>
  <key>StandardErrorPath</key>
  <string>${REPO_DIR}/bot.err.log</string>
</dict>
</plist>
PLIST

/usr/sbin/chown root:wheel "${TMP_PLIST}"
/bin/chmod 0644 "${TMP_PLIST}"
/usr/bin/install -m 0644 -o root -g wheel "${TMP_PLIST}" "${PLIST}"
/bin/launchctl bootstrap system "${PLIST}"
/bin/launchctl enable "system/${LABEL}"
/bin/launchctl kickstart -k "system/${LABEL}"

echo "Installed ${LABEL} as a root LaunchDaemon."
/bin/launchctl print "system/${LABEL}" | /usr/bin/sed -n '1,80p'
