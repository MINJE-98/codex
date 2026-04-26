#!/usr/bin/env bash
set -euo pipefail

LABEL="com.codexclaw.bot"
LEGACY_LABELS=("com.minje.codexclaw")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
TSX_CLI="${TSX_CLI:-${REPO_DIR}/node_modules/tsx/dist/cli.mjs}"
ENTRYPOINT="${ENTRYPOINT:-${REPO_DIR}/src/index.ts}"
OWNER_HOME="${CODEXCLAW_HOME:-/Users/home}"
OWNER_UID="${OWNER_UID:-$(id -u)}"
CODEX_HOME_VALUE="${CODEX_HOME:-${OWNER_HOME}/.codexclaw-codex}"
PLIST_DIR="${OWNER_HOME}/Library/LaunchAgents"
PLIST="${PLIST_DIR}/${LABEL}.plist"
TMP_PLIST="$(mktemp)"

cleanup() {
  rm -f "${TMP_PLIST}"
}
trap cleanup EXIT

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

stop_agent_label() {
  local label="$1"
  local agent_plist="${PLIST_DIR}/${label}.plist"

  /bin/launchctl bootout "gui/${OWNER_UID}" "${agent_plist}" 2>/dev/null || true
  /bin/launchctl bootout "gui/${OWNER_UID}/${label}" 2>/dev/null || true
}

for legacy_label in "${LEGACY_LABELS[@]}"; do
  stop_agent_label "${legacy_label}"
done

stop_agent_label "${LABEL}"
/bin/mkdir -p "${PLIST_DIR}"
/bin/mkdir -p "${CODEX_HOME_VALUE}"

/bin/cat >"${TMP_PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
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

/usr/bin/install -m 0644 "${TMP_PLIST}" "${PLIST}"
/bin/launchctl bootstrap "gui/${OWNER_UID}" "${PLIST}"
/bin/launchctl enable "gui/${OWNER_UID}/${LABEL}"
/bin/launchctl kickstart -k "gui/${OWNER_UID}/${LABEL}"

echo "Installed ${LABEL} as a user LaunchAgent."
/bin/launchctl print "gui/${OWNER_UID}/${LABEL}" | /usr/bin/sed -n '1,80p'
