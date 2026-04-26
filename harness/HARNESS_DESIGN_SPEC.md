# CodexClaw Harness Design Spec

## Project Context

CodexClaw is a Telegram bot that routes user messages to Codex, local tools, MCP integrations, GitHub automation, shell commands, file upload handling, and scheduled jobs.

Primary users interact through a chat window, not an issue tracker. They may jump between unrelated topics, ask ordinary questions, request internet research, upload files, install or configure skills, or occasionally request code, commit, push, or service operations.

## Harness Goal

The harness exists to keep chat topics isolated while preserving useful continuity. It should prevent an active durable context from being polluted by an unrelated request, without making lightweight chat feel like project-management overhead.

## Context Units

- Telegram UX: `src/bot/handlers.ts`, `src/bot/i18n.ts`, `src/bot/telegramCommands.ts`
- Runner/session management: `src/runner/ptyManager.ts`
- Runtime persistence: `src/runtimeStateStore.ts`
- Request/topic harness: `src/harness/`
- Service operations: `scripts/install-user-launchagent.sh`, `scripts/install-root-launchdaemon.sh`

## High-Risk Failure Modes

- A new unrelated request is appended to an active Codex thread and degrades answer quality.
- A side-effecting request runs inside the wrong topic context.
- A Codex thread id is treated as durable source of truth after `CODEX_HOME` or session storage changes.
- The bot restarts and loses active, pending, paused, or blocked work.
- The user is shown raw harness details instead of a short decision prompt.

## Hard Rules

- Do not treat every Telegram message as durable work.
- General chat and short lookups stay ephemeral unless they need recovery, artifacts, or follow-up.
- Skill, file/data, repo, and ops requests are durable by default.
- If an active durable context exists and the incoming request looks unrelated, ask the user how to handle the current context before executing the new request.
- Codex thread ids are scoped to topic contexts and remain recoverable implementation details.
- Repo, ops, and skill changes require verification evidence before being described as complete.

## Required Commands

- Install: `npm install`
- Dev: `npm run dev`
- Start: `npm run start`
- Typecheck: `npm run check`
- Lint: `npm run lint`
- Format check: `npm run format:check`
- Test: `npm test`
- Full local check: `npm run ci`
- Runtime health: `npm run healthcheck`
- Dedicated Codex home health: `CODEX_HOME=/Users/home/.codexclaw-codex npm run healthcheck`

## Definition Of Ready

Before implementation, identify:

- Which context unit is affected.
- Whether the change affects user-visible Telegram behavior.
- Whether the change affects durable state or Codex thread recovery.
- Which tests prove the behavior.

## Definition Of Done

For code or operational behavior changes:

- Relevant focused tests pass.
- `npm run ci` passes.
- Dedicated `CODEX_HOME` healthcheck passes when runner/session behavior changed.
- Runtime/service changes are reflected by restarting or reinstalling the LaunchAgent when needed.
- User-facing behavior is documented when commands or workflow change.
