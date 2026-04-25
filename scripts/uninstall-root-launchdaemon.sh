#!/usr/bin/env bash
set -euo pipefail

LABEL="com.minje.codexclaw"
OWNER_HOME="${CODEXCLAW_HOME:-/Users/home}"
OWNER_UID="${OWNER_UID:-${SUDO_UID:-501}}"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
AGENT_PLIST="${OWNER_HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo \
    CODEXCLAW_HOME="${OWNER_HOME}" \
    OWNER_UID="${OWNER_UID}" \
    "$0" "$@"
fi

/bin/launchctl bootout "system/${LABEL}" 2>/dev/null || true
/bin/launchctl bootout system "${PLIST}" 2>/dev/null || true
rm -f "${PLIST}"

if [[ -f "${AGENT_PLIST}" ]]; then
  /bin/launchctl bootstrap "gui/${OWNER_UID}" "${AGENT_PLIST}" 2>/dev/null || true
  /bin/launchctl kickstart -k "gui/${OWNER_UID}/${LABEL}" 2>/dev/null || true
  echo "Removed root LaunchDaemon and restored user LaunchAgent: ${AGENT_PLIST}"
else
  echo "Removed root LaunchDaemon. No user LaunchAgent found at ${AGENT_PLIST}."
fi
