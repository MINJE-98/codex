# Handoff

## Current Focus

Implement the topic context harness MVP from `docs/plans/2026-04-26-topic-context-harness.md`.

## Current State

- Stale Codex SDK thread recovery is fixed in `09a1c65`.
- Topic context harness implementation has not started yet.
- The first implementation task is the deterministic topic classifier.

## Immediate Next Action

1. Add `src/harness/topicClassifier.ts`.
2. Add `tests/topicClassifier.test.ts`.
3. Use TDD to cover chat, research, file/data, skill, repo, ops, and safe command classification.

## Warnings

- Do not convert every chat message into durable work.
- Do not process a new unrelated request while an active durable context exists until the user chooses queue, pause-and-switch, or close-and-switch.
- Keep Codex thread ids scoped to topic contexts once the thread-binding task begins.
