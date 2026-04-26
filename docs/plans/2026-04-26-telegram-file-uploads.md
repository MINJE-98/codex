# Telegram File Uploads Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users send Telegram documents and images, save them locally, and ask Codex to inspect the saved file path.

**Architecture:** Telegram `document` and `photo` handlers extract file metadata, validate size/type, download to an app-owned `.telegram-uploads` directory, then call the existing `PtyManager.sendPrompt` path with a prompt containing the local file path and caption/default instruction. The SDK runner can receive the upload directory as an additional readable directory for that turn.

**Tech Stack:** TypeScript, Telegraf, Node fs/path/stream APIs, undici, node:test.

---

### Task 1: Document Upload Handler

**Files:**

- Modify: `tests/handlers.test.ts`
- Modify: `src/bot/handlers.ts`

**Step 1: Write the failing test**

Add a test that registers handlers, sends a fake `document` update with a caption, stubs the upload saver, and asserts `sendPrompt` receives a prompt containing the saved path and caption.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/handlers.test.ts`
Expected: FAIL because no `document` handler is registered.

**Step 3: Write minimal implementation**

Add `bot.on("document")`, reuse mention gating for captions, save via injected upload service, build the file prompt, and pass `additionalDirectories` to `sendPrompt`.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/handlers.test.ts`
Expected: PASS.

### Task 2: Photo Upload Handler

**Files:**

- Modify: `tests/handlers.test.ts`
- Modify: `src/bot/handlers.ts`

**Step 1: Write the failing test**

Add a test that sends a fake `photo` update without caption and asserts the default instruction is used.

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/handlers.test.ts`
Expected: FAIL until `photo` handling exists.

**Step 3: Write minimal implementation**

Select the largest Telegram photo size, save it via the same upload service, and reuse the prompt builder.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/handlers.test.ts`
Expected: PASS.

### Task 3: Upload Download Service

**Files:**

- Create: `src/bot/fileUploads.ts`
- Test: `tests/fileUploads.test.ts`
- Modify: `src/index.ts`
- Modify: `.gitignore`

**Step 1: Write failing unit tests**

Cover filename sanitization, supported text/document/image classification, and prompt building.

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/fileUploads.test.ts`
Expected: FAIL because the module does not exist.

**Step 3: Write minimal implementation**

Implement an upload manager that uses `ctx.telegram.getFileLink(file_id)`, downloads with undici, stores files under `.telegram-uploads/<chatId>/`, and rejects unsupported or oversized files.

**Step 4: Wire production bootstrap**

Instantiate the upload manager in `src/index.ts` with upload root `.telegram-uploads` and Telegram proxy config.

**Step 5: Verify**

Run: `npm run ci`
Expected: typecheck, lint, format check, tests, and healthcheck all pass.
