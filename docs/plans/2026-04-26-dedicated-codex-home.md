# Dedicated Codex Home Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep terminal Codex and CodexClaw Codex state separate by giving CodexClaw its own default `CODEX_HOME`.

**Architecture:** CodexClaw launchd scripts should default `CODEX_HOME` to `/Users/home/.codexclaw-codex`, while still allowing operators to override `CODEX_HOME` explicitly. The user LaunchAgent path should be installable from the repo just like the root LaunchDaemon path, so runtime environment stays reproducible.

**Tech Stack:** Bash launchd scripts, macOS plist XML, npm scripts, node:test static checks.

---

### Task 1: Lock In Script Defaults

**Files:**

- Modify: `tests/config-files.test.ts`
- Modify: `scripts/install-root-launchdaemon.sh`
- Create: `scripts/install-user-launchagent.sh`

**Step 1: Write failing tests**

Add static tests that assert:

- root LaunchDaemon installer defaults to `${OWNER_HOME}/.codexclaw-codex`
- user LaunchAgent installer exists
- user LaunchAgent installer writes a `CODEX_HOME` environment variable
- package scripts expose `service:user:install`

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/config-files.test.ts`
Expected: FAIL before the script/package changes.

**Step 3: Implement scripts**

Change the root installer default and add a user LaunchAgent installer that writes `~/Library/LaunchAgents/com.codexclaw.bot.plist` with `CODEX_HOME`.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/config-files.test.ts`
Expected: PASS.

### Task 2: Documentation And Runtime Apply

**Files:**

- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Document the separation**

Update operations docs to explain:

- CLI Codex uses `~/.codex`
- CodexClaw defaults to `~/.codexclaw-codex`
- override with `CODEX_HOME=...` when intentionally sharing state

**Step 2: Verify**

Run: `npm run ci`
Expected: PASS.

**Step 3: Apply locally**

Create the dedicated directory, copy minimal non-session config if needed, run `npm run service:user:install`, and verify launchd shows `CODEX_HOME=/Users/home/.codexclaw-codex`.
