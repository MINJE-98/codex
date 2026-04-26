# Topic Context Policy

## Purpose

Telegram users often switch topics without warning. CodexClaw must protect active durable work from unrelated messages while keeping ordinary chat fast.

## Topic Types

| Type       | Default durability   | Examples                                                           |
| ---------- | -------------------- | ------------------------------------------------------------------ |
| `chat`     | ephemeral            | Explanations, short questions, casual follow-up.                   |
| `research` | ephemeral or durable | Internet lookup, source gathering, market or API research.         |
| `data`     | durable              | Data extraction, table cleanup, structured analysis.               |
| `file`     | durable              | Uploaded file reading, image/document summaries.                   |
| `skill`    | durable              | Skill install, enable, disable, sync, configuration.               |
| `repo`     | durable              | Code, docs, tests, plans, commits requested as codebase work.      |
| `ops`      | durable              | Commit, push, service restart, directory cleanup, launchd changes. |

## Context Switch Gate

When an active durable context exists and a new message appears to be a different topic, do not execute the new request immediately.

Ask the user to choose one:

- Keep the current context active and queue the new request.
- Pause the current context and switch to the new request.
- Close the current context and start the new request.

## Safe Immediate Commands

These commands do not require a context switch decision:

- `/status`
- `/pwd`
- `/repo`
- `/work`
- `/help`
- `/model`
- `/language`
- `/verbose`

## Same-Topic Signals

Treat a message as the same topic when one or more are true:

- It is a Telegram reply to the active topic's bot response.
- It uses continuation wording such as "that", "continue", "same thing", or "for this".
- It is a direct correction or constraint for the active work.
- It requests verification, commit, push, or restart for the active repo/ops work.

## New-Topic Signals

Treat a message as a new topic when one or more are true:

- It uses transition wording such as "also", "different topic", "separately", or "by the way".
- Its classified type differs from the active topic and it is not a clear clarification.
- It has a different uploaded file or data artifact.
- It asks for side effects unrelated to the active topic.

## User-Facing Rule

Do not expose internal terms such as "gate failed" or "context unit" as the main Telegram response. Say plainly:

```text
You have an active context: "<title>".
The new request looks separate. What should I do with the current context?
```

## Completion Rule

Ephemeral chat can finish after the answer is sent.

Durable contexts remain active, pending, paused, blocked, done, or cancelled until the bot can account for the user's decision and any required verification.
