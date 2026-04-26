# Topic Context Harness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep CodexClaw useful in a noisy Telegram chat where users jump between topics, without polluting the active context or losing unfinished work.

**Architecture:** Add a lightweight topic context harness between Telegram handlers and Codex execution. The harness classifies incoming messages, tracks the current active durable context, and runs a context-switch gate when the user appears to jump to a different topic. General chat and simple lookups stay lightweight; side-effecting or long-running work becomes durable state.

**Tech Stack:** TypeScript, Node built-in test runner, Telegraf handlers, existing `RuntimeStateStore`, existing `PtyManager` SDK/CLI backends.

---

## Core Product Rule

Do not treat every Telegram message as a code task.

CodexClaw is primarily a chat and tool orchestration surface. Users will ask general questions, request internet searches, ask for data, add or configure skills, upload files, and only sometimes ask for code changes, commits, pushes, or service operations.

The harness exists to keep topic boundaries clean:

- Lightweight chat can answer immediately when no durable context is at risk.
- If a durable context is active and the user jumps topics, ask what to do with the current context before processing the new one.
- Side-effecting work must be durable.
- Codex thread ids are scoped to a topic context, not the whole Telegram chat.

## Context Types

```ts
type TopicType =
  | "chat"
  | "research"
  | "data"
  | "file"
  | "skill"
  | "repo"
  | "ops";

type Durability = "ephemeral" | "durable";

type TopicStatus =
  | "active"
  | "pending"
  | "paused"
  | "blocked"
  | "done"
  | "cancelled"
  | "awaiting_switch_decision";
```

Durability defaults:

| Type       | Default                  | Reason                                                            |
| ---------- | ------------------------ | ----------------------------------------------------------------- |
| `chat`     | `ephemeral`              | Usually no state or recovery needed.                              |
| `research` | `ephemeral` or `durable` | Durable only for long research, citations, or later follow-up.    |
| `data`     | `durable`                | User may expect reusable results.                                 |
| `file`     | `durable`                | Input artifacts and summaries should remain traceable.            |
| `skill`    | `durable`                | Installing/configuring skills changes local state.                |
| `repo`     | `durable`                | Code/doc changes need scope and verification.                     |
| `ops`      | `durable`                | Service, commit, push, restart, and cleanup actions change state. |

## Runtime State Shape

```ts
interface TopicHarnessSnapshot {
  chats: Record<string, ChatTopicSnapshot>;
}

interface ChatTopicSnapshot {
  projects: Record<string, ProjectTopicSnapshot>;
}

interface ProjectTopicSnapshot {
  activeTopicId: string | null;
  topics: TopicContextSnapshot[];
  pendingSwitch: PendingSwitchSnapshot | null;
}

interface TopicContextSnapshot {
  id: string;
  type: TopicType;
  durability: Durability;
  status: TopicStatus;
  title: string;
  summary: string;
  lastUserIntent: string;
  workdir: string;
  createdAt: string;
  updatedAt: string;
  codexThreadId: string | null;
  lastError: string | null;
}

interface PendingSwitchSnapshot {
  incomingText: string;
  inferredType: TopicType;
  inferredTitle: string;
  receivedAt: string;
}
```

## Context Switch Gate

The gate runs before Codex execution.

If all are true:

- There is an active durable topic.
- The new message is not clearly the same topic.
- The new message is not a safe status command.
- The user did not explicitly say to queue, pause, close, or switch.

Then CodexClaw must not process the new request yet. It asks:

```text
You have an active context: "<title>".

The new request looks like a different topic.
What should I do with the current context?

1. Keep it active and queue the new request.
2. Pause it and switch to the new request.
3. Close it and start the new request.
```

Telegram inline buttons should map to:

- `Keep + Queue`
- `Pause + Switch`
- `Close + Switch`

Text aliases:

- `/queue`
- `/switch`
- `/close`

## Immediate MVP Scope

Implement only the pieces needed to prevent context pollution:

1. Topic classification.
2. Topic state persistence.
3. Context switch gate.
4. Basic user commands for viewing and resolving topic state.
5. Per-topic Codex thread binding for durable contexts.

Do not implement full feature lists, target-repo harness mutation, elaborate completion reports, or aggressive multi-request splitting in the MVP.

---

## Task 0: Close Current Stale-Thread Fix

**Files:**

- Existing modified: `src/runner/ptyManager.ts`
- Existing modified: `tests/ptyManager.test.ts`

**Step 1: Review current changes**

Run:

```bash
git status --short
git diff -- src/runner/ptyManager.ts tests/ptyManager.test.ts
```

Expected: only stale SDK resume recovery changes are present.

**Step 2: Verify**

Run:

```bash
npm run ci
CODEX_HOME=/Users/home/.codexclaw-codex npm run healthcheck
```

Expected: both pass.

**Step 3: Commit**

Run:

```bash
git add src/runner/ptyManager.ts tests/ptyManager.test.ts
git commit -m "fix: recover stale codex sdk threads"
```

Expected: stale-thread fix is isolated before topic harness work begins.

---

## Task 1: Add Minimal Repo Harness Policy

**Files:**

- Create: `harness/HARNESS_DESIGN_SPEC.md`
- Create: `harness/policies/topic_context_policy.md`
- Create: `harness/state/HANDOFF.md`
- Modify: `AGENTS.md`

**Step 1: Create policy docs**

Document:

- CodexClaw serves chat, research, file/data, skill, repo, and ops requests.
- Not every message becomes durable work.
- Durable contexts require context-switch protection.
- Side-effecting requests must not run inside unrelated active context.
- Completion is evidence-based for repo/ops work, but lightweight chat can finish immediately.

**Step 2: Update `AGENTS.md` as router**

Add links to:

- `harness/HARNESS_DESIGN_SPEC.md`
- `harness/policies/topic_context_policy.md`
- `harness/state/HANDOFF.md`

Keep existing quick-start and verification commands.

**Step 3: Verify formatting**

Run:

```bash
npm run format:check
```

Expected: pass.

**Step 4: Commit**

Run:

```bash
git add AGENTS.md harness
git commit -m "chore: add topic context harness policy"
```

---

## Task 2: Implement Topic Classifier

**Files:**

- Create: `src/harness/topicClassifier.ts`
- Test: `tests/topicClassifier.test.ts`

**Step 1: Write failing tests**

Test classifications:

- General chat: "이거 무슨 뜻이야?" -> `chat`, `ephemeral`, no side effect.
- Research: "요즘 OpenAI API 변경점 찾아줘" -> `research`, likely ephemeral, requires web.
- File/data: uploaded file prompt or "이 CSV 요약해줘" -> `file` or `data`, durable.
- Skill: "스킬 추가해줘", "gmail skill 켜줘" -> `skill`, durable.
- Repo/code: "파일 업로드 읽는 기능 구현해줘" -> `repo`, durable.
- Ops: "커밋해줘", "푸쉬해줘", "봇 재시작해줘" -> `ops`, durable.
- Status commands: `/status`, `/pwd`, `/work` -> safe command.

Run:

```bash
node --import tsx --test tests/topicClassifier.test.ts
```

Expected: fail because module does not exist.

**Step 2: Implement conservative classifier**

Use deterministic keyword and command rules first. Return:

```ts
{
  type: TopicType;
  durability: Durability;
  sideEffect: boolean;
  safeImmediate: boolean;
  title: string;
}
```

Do not call an LLM for MVP classification.

**Step 3: Verify**

Run:

```bash
node --import tsx --test tests/topicClassifier.test.ts
```

Expected: pass.

**Step 4: Commit**

Run:

```bash
git add src/harness/topicClassifier.ts tests/topicClassifier.test.ts
git commit -m "feat: classify telegram topic requests"
```

---

## Task 3: Implement Topic Harness State

**Files:**

- Create: `src/harness/topicHarness.ts`
- Test: `tests/topicHarness.test.ts`

**Step 1: Write failing tests**

Test:

- Creating a durable topic with no active topic makes it active.
- Creating ephemeral chat with no active durable topic returns immediate processing and does not persist long-term context.
- Creating a different topic while active durable topic exists creates `pendingSwitch`.
- `queuePendingSwitch()` stores new request as pending and keeps current active.
- `pauseAndSwitch()` pauses active and starts new request.
- `closeAndSwitch()` marks active done and starts new request.
- `pauseActive()`, `doneActive()`, `dropTopic()` update statuses.
- Export/restore preserves active topic and pending switch.

**Step 2: Implement state manager**

API:

```ts
class TopicHarness {
  evaluateIncoming(input): TopicGateResult;
  queuePendingSwitch(chatId, workdir): TopicContextSnapshot;
  pauseAndSwitch(chatId, workdir): TopicContextSnapshot;
  closeAndSwitch(chatId, workdir): TopicContextSnapshot;
  pauseActive(chatId, workdir): TopicContextSnapshot | null;
  doneActive(chatId, workdir): TopicContextSnapshot | null;
  dropTopic(chatId, workdir, id): TopicContextSnapshot;
  getProject(chatId, workdir): ProjectTopicSnapshot;
  recordThreadId(chatId, workdir, topicId, threadId): void;
  exportState(): TopicHarnessSnapshot;
  restoreState(snapshot): void;
}
```

**Step 3: Verify**

Run:

```bash
node --import tsx --test tests/topicHarness.test.ts
```

Expected: pass.

**Step 4: Commit**

Run:

```bash
git add src/harness/topicHarness.ts tests/topicHarness.test.ts
git commit -m "feat: track topic contexts"
```

---

## Task 4: Persist Topic Harness State

**Files:**

- Modify: `src/runtimeStateStore.ts`
- Modify: `src/index.ts`
- Test: `tests/runtimeStateStore.test.ts`

**Step 1: Write failing test**

Add a runtime state fixture with:

```json
{
  "topics": {
    "chats": {
      "123": {
        "projects": {
          ".": {
            "activeTopicId": "T001",
            "topics": [],
            "pendingSwitch": null
          }
        }
      }
    }
  }
}
```

Expected before implementation: snapshot is not restored/saved.

**Step 2: Extend runtime snapshot**

Add `topics` next to `mcp`, `runner`, and `skills`.

**Step 3: Wire manager in `src/index.ts`**

Instantiate `TopicHarness`, restore state, and save it through `saveRuntimeState()`.

**Step 4: Verify**

Run:

```bash
node --import tsx --test tests/runtimeStateStore.test.ts tests/topicHarness.test.ts
```

Expected: pass.

**Step 5: Commit**

Run:

```bash
git add src/runtimeStateStore.ts src/index.ts tests/runtimeStateStore.test.ts
git commit -m "feat: persist topic context state"
```

---

## Task 5: Add Context Switch Commands

**Files:**

- Modify: `src/bot/handlers.ts`
- Modify: `src/bot/i18n.ts`
- Modify: `src/bot/telegramCommands.ts`
- Test: `tests/handlers.test.ts`
- Test: `tests/telegramCommands.test.ts`

**Step 1: Write failing handler tests**

Test:

- `/work` shows active, pending, paused, blocked counts.
- `/queue` resolves pending switch by queueing incoming request.
- `/switch` resolves pending switch by pausing active and starting incoming request.
- `/close` resolves pending switch by closing active and starting incoming request.
- `/pause` pauses active context.
- `/done` marks active context done.
- `/drop <id>` cancels pending or paused context.

**Step 2: Add Telegram commands**

Commands:

```text
work - Show current topic context
queue - Keep current context and queue pending request
switch - Pause current context and switch
close - Close current context and switch
pause - Pause current context
done - Mark current context done
drop - Cancel a pending or paused context
```

**Step 3: Add user-facing copy**

Keep copy short and non-jargony:

```text
You have an active context: "<title>".
The new request looks separate. What should I do?
```

**Step 4: Verify**

Run:

```bash
node --import tsx --test tests/handlers.test.ts tests/telegramCommands.test.ts
```

Expected: pass.

**Step 5: Commit**

Run:

```bash
git add src/bot/handlers.ts src/bot/i18n.ts src/bot/telegramCommands.ts tests/handlers.test.ts tests/telegramCommands.test.ts
git commit -m "feat: add topic context commands"
```

---

## Task 6: Gate Normal Telegram Text Before Codex

**Files:**

- Modify: `src/bot/handlers.ts`
- Test: `tests/handlers.test.ts`

**Step 1: Write failing tests**

Test:

- No active durable topic + chat message -> routes normally.
- No active durable topic + repo/ops/skill request -> creates active durable topic and routes normally.
- Active durable topic + same-topic continuation -> routes normally.
- Active durable topic + different durable request -> asks context switch question and does not call Codex.
- Active durable topic + different research/chat request -> asks context switch question and does not call Codex.
- Explicit `/queue` or "나중에 해" can queue without asking again.

**Step 2: Integrate gate**

Before `router.routeMessage()` for normal text:

1. Classify incoming message.
2. Evaluate topic harness.
3. If result is `ask_switch`, send context switch question and stop.
4. If result is `process`, send to existing router/Codex path.
5. If result is `queued`, send queue confirmation and stop.

**Step 3: Verify**

Run:

```bash
node --import tsx --test tests/handlers.test.ts tests/topicHarness.test.ts tests/topicClassifier.test.ts
```

Expected: pass.

**Step 4: Commit**

Run:

```bash
git add src/bot/handlers.ts tests/handlers.test.ts
git commit -m "feat: gate topic switches before codex"
```

---

## Task 7: Bind Codex Threads To Durable Topics

**Files:**

- Modify: `src/runner/ptyManager.ts`
- Modify: `src/bot/handlers.ts`
- Test: `tests/ptyManager.test.ts`
- Test: `tests/handlers.test.ts`

**Step 1: Write failing tests**

Test:

- New durable topic starts fresh even if project has a previous session id.
- Same durable topic continuation resumes that topic's `codexThreadId`.
- Stale topic thread retries fresh and updates that topic's thread id.
- Ephemeral chat does not overwrite durable topic thread id.

**Step 2: Add explicit session options**

Extend `SendPromptOptions` with:

```ts
conversationSessionId?: string | null;
trackProjectConversation?: boolean;
onSessionId?: (sessionId: string) => void;
```

Rules:

- `null` means force fresh.
- `string` means resume that exact thread.
- `undefined` keeps legacy project-level behavior.

**Step 3: Wire topic thread callback**

When a durable topic is processed:

- Pass its `codexThreadId` if present.
- Otherwise pass `conversationSessionId: null`.
- On new session id, store it in the topic harness.

**Step 4: Verify**

Run:

```bash
node --import tsx --test tests/ptyManager.test.ts tests/handlers.test.ts
```

Expected: pass.

**Step 5: Commit**

Run:

```bash
git add src/runner/ptyManager.ts src/bot/handlers.ts tests/ptyManager.test.ts tests/handlers.test.ts
git commit -m "feat: bind codex threads to topic contexts"
```

---

## Task 8: Full MVP Verification And Rollout

**Files:**

- No planned code changes.

**Step 1: Full verification**

Run:

```bash
npm run ci
CODEX_HOME=/Users/home/.codexclaw-codex npm run healthcheck
```

Expected: pass.

**Step 2: Restart service**

Run:

```bash
launchctl kickstart -k gui/$(id -u)/com.codexclaw.bot
launchctl print gui/$(id -u)/com.codexclaw.bot | rg -n "state =|pid =|CODEX_HOME"
```

Expected:

- `state = running`
- `CODEX_HOME => /Users/home/.codexclaw-codex`

**Step 3: Manual Telegram smoke**

Scenario:

1. Start a durable request: "CodexClaw topic harness 설계 계속해줘".
2. Send a separate request: "OpenAI API 최신 변경점 찾아줘".
3. Bot asks what to do with active context.
4. Choose `Pause + Switch`.
5. `/work` shows paused original and active research.
6. Restart bot.
7. `/work` still shows both contexts.

---

## Deferred Work

These are intentionally out of MVP.

### D1: Aggressive Multi-Request Splitting

Later:

- Split clear numbered/bulleted independent requests.
- Ask before splitting ambiguous paragraphs.
- Preserve ordering for dependent workflows like "test, commit, push".

### D2: Durable Research Evidence

Later:

- Store sources, query, result summary, and date for research contexts.
- Allow `/work <id>` to show citations or saved findings.

### D3: File/Data Artifact Tracking

Later:

- Link uploaded files to topic context.
- Store summaries and derived output paths.
- Add expiration/cleanup policy for uploads.

### D4: Skill Lifecycle Harness

Later:

- Track skill install/configuration as durable context.
- Record verification evidence that skill was discovered and command menu synced.

### D5: Target Repository Harness Integration

Later:

- Detect target repo `harness/`, `AGENTS.md`, and `HANDOFF.md`.
- Inject concise target harness summary into Codex prompt.
- Do not auto-edit target harness files unless user requested repo work.

### D6: Completion Reports

Later:

- Generate user-facing completion report for durable tasks.
- Include changed/not changed/verification/risk/next action.

### D7: Harness Health Check Script

Later:

- Add `npm run harness:check`.
- Validate topic state invariants.
- Report active/pending/paused/blocked counts and stale contexts.

### D8: Automatic Done Heuristics

Later:

- Auto-complete low-risk ephemeral contexts.
- Keep repo/ops/skill/file contexts explicit until `/done` or verified finalization.

## MVP Non-Goals

- Do not make every chat message durable.
- Do not block all general chat while a durable topic exists; block only topic jumps until user chooses what to do.
- Do not implement a full project feature-list system in the first pass.
- Do not replace existing `/continue` workspace contention behavior.
- Do not push or commit automatically unless the user asks.

## Final MVP Verification Commands

```bash
node --import tsx --test tests/topicClassifier.test.ts tests/topicHarness.test.ts
node --import tsx --test tests/handlers.test.ts tests/ptyManager.test.ts tests/runtimeStateStore.test.ts
npm run ci
CODEX_HOME=/Users/home/.codexclaw-codex npm run healthcheck
```
