import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerHandlers } from "../src/bot/handlers.js";

type Handler = (ctx: TestContext) => Promise<void> | void;

interface ReplyRecord {
  text: string;
  options?: Record<string, unknown>;
}

interface TestContext {
  chat: {
    id: number;
    type?: string;
  };
  from: {
    id: number;
  };
  message: {
    text: string;
    caption?: string;
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    photo?: Array<{
      file_id: string;
      file_size?: number;
      width?: number;
      height?: number;
    }>;
    reply_to_message?: {
      text?: string;
      caption?: string;
      from?: {
        id?: number;
        is_bot?: boolean;
        username?: string;
      };
    };
  };
  botInfo?: {
    id?: number;
    username: string;
  };
  callbackQuery?: {
    data?: string;
  };
  replies: ReplyRecord[];
  reply: (text: string, options?: Record<string, unknown>) => Promise<void>;
  answerCbQuery: (text?: string) => Promise<void>;
}

class FakeBot {
  readonly commands = new Map<string, Handler>();
  readonly events = new Map<string, Handler>();
  startHandler: Handler | null = null;

  start(handler: Handler): void {
    this.startHandler = handler;
  }

  command(name: string, handler: Handler): void {
    this.commands.set(name, handler);
  }

  on(event: string, handler: Handler): void {
    this.events.set(event, handler);
  }
}

function createContext(
  text: string,
  chatId = 1,
  options: {
    chatType?: string;
    botId?: number;
    botUsername?: string;
    replyToBot?: boolean;
    replyText?: string;
    replyCaption?: string;
  } = {}
): TestContext {
  const replies: ReplyRecord[] = [];
  const botId = options.botId ?? 999;
  return {
    chat: {
      id: chatId,
      type: options.chatType || "private"
    },
    from: {
      id: chatId
    },
    message: {
      text,
      ...(options.replyToBot
        ? {
            reply_to_message: {
              ...(options.replyText ? { text: options.replyText } : {}),
              ...(options.replyCaption
                ? { caption: options.replyCaption }
                : {}),
              from: {
                id: botId,
                is_bot: true,
                username: options.botUsername
              }
            }
          }
        : {})
    },
    botInfo: options.botUsername
      ? {
          id: botId,
          username: options.botUsername
        }
      : undefined,
    replies,
    reply: async (replyText: string, options?: Record<string, unknown>) => {
      replies.push({
        text: replyText,
        options
      });
    },
    answerCbQuery: async () => {}
  };
}

async function createCodexSkill(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skills-"));
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      "description: Test skill.",
      "---",
      "",
      "# Test skill",
      ""
    ].join("\n")
  );
  return root;
}

function createDependencies(
  overrides: {
    sendPrompt?: (
      ctx: TestContext,
      prompt: string,
      options?: Record<string, unknown>
    ) => Promise<unknown>;
    continuePendingPrompt?: () => Promise<unknown>;
    routeMessage?: (text: string) => Promise<unknown>;
    githubExecute?: () => Promise<unknown>;
    shellInspect?: () => Record<string, unknown>;
    shellExecute?: () => Promise<Record<string, unknown>>;
    getStatus?: () => Record<string, unknown>;
    switchWorkdir?: (chatId: string | number, target: string) => unknown;
    resetCurrentProjectConversation?: () => Record<string, unknown>;
    closeSession?: () => boolean;
    setVerbose?: (chatId: string | number, enabled: boolean) => boolean;
    devStart?: () => Promise<unknown>;
    devStatus?: () => Record<string, unknown>;
    devStop?: () => boolean;
    devLogs?: () => string;
    devUrl?: () => string | null;
    restart?: () => Promise<void>;
    syncTelegramCommands?: () => Promise<boolean>;
    codexSkillRoots?: string[];
    saveUpload?: (
      ctx: TestContext,
      kind: "document" | "image"
    ) => Promise<{
      filePath: string;
      originalName: string;
      mimeType: string;
      size: number;
      kind: "document" | "image";
      additionalDirectories: string[];
    }>;
  } = {}
) {
  const bot = new FakeBot();
  const ptyManager = {
    getLanguage: () => "en",
    sendPrompt:
      overrides.sendPrompt ||
      (async () => ({
        started: true,
        mode: "sdk"
      })),
    continuePendingPrompt:
      overrides.continuePendingPrompt ||
      (async () => ({
        started: true,
        mode: "sdk"
      })),
    getStatus:
      overrides.getStatus ||
      (() => ({
        backend: "sdk",
        active: false,
        activeMode: null,
        lastMode: null,
        lastExitCode: null,
        lastExitSignal: null,
        projectSessionId: null,
        preferredModel: null,
        language: "en",
        verboseOutput: false,
        ptySupported: null,
        workdir: process.cwd(),
        relativeWorkdir: ".",
        workspaceRoot: process.cwd(),
        command: "codex",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        reasoningEffort: "inherit",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        mcpServers: [],
        workflowSystem: "superpowers",
        workflowPhase: "none"
      })),
    getRecentProjects: () => [],
    listProjects: () => [],
    switchWorkdir:
      overrides.switchWorkdir ||
      (() => ({
        workdir: process.cwd(),
        relativePath: "."
      })),
    resetCurrentProjectConversation:
      overrides.resetCurrentProjectConversation ||
      (() => ({
        closed: false,
        workdir: process.cwd()
      })),
    closeSession: overrides.closeSession || (() => false),
    setVerbose: overrides.setVerbose || (() => true)
  };

  registerHandlers({
    bot,
    router: {
      routeMessage:
        overrides.routeMessage ||
        (async (text: string) => ({
          target: "pty" as const,
          prompt: text
        }))
    } as any,
    ptyManager: ptyManager as any,
    shellManager: {
      isEnabled: () => false,
      isReadOnly: () => true,
      getAllowedCommands: () => [],
      inspectCommand:
        overrides.shellInspect ||
        (() => {
          throw new Error("not used");
        }),
      execute:
        overrides.shellExecute ||
        (async () => ({ started: false, reason: "busy" }))
    } as any,
    devServerManager: {
      start:
        overrides.devStart ||
        (async () => ({
          started: true,
          scriptName: "dev",
          packageManager: "npm",
          command: "npm run dev"
        })),
      getStatus:
        overrides.devStatus ||
        (() => ({
          running: false,
          status: "stopped",
          workdir: process.cwd(),
          startedByChatId: null,
          command: null,
          packageManager: null,
          scriptName: null,
          pid: null,
          startedAt: null,
          exitedAt: null,
          exitCode: null,
          signal: null,
          detectedUrl: null
        })),
      stop: overrides.devStop || (() => false),
      getLogs: overrides.devLogs || (() => "(no logs yet)"),
      getUrl: overrides.devUrl || (() => null)
    } as any,
    skills: {
      github: {
        execute: overrides.githubExecute || (async () => ({ text: "unused" })),
        getTestStatus: async () => null
      },
      mcp: {
        execute: async () => ({ text: "unused" }),
        mcpClient: {
          listServers: () => []
        }
      }
    } as any,
    skillRegistry: {
      list: () => [],
      isEnabled: () => true,
      enable: () => ({
        changed: true,
        skills: []
      }),
      disable: () => ({
        changed: true,
        skills: []
      })
    } as any,
    scheduler: {
      triggerDailySummaryNow: async () => {}
    } as any,
    fileUploads: {
      save:
        overrides.saveUpload ||
        (async () => ({
          filePath: "/tmp/upload.txt",
          originalName: "upload.txt",
          mimeType: "text/plain",
          size: 12,
          kind: "document" as const,
          additionalDirectories: ["/tmp"]
        }))
    },
    adminActions: overrides.restart
      ? {
          restart: overrides.restart
        }
      : undefined,
    syncTelegramCommands: overrides.syncTelegramCommands,
    codexSkillRoots: overrides.codexSkillRoots
  });

  return { bot };
}

function createDocumentContext(
  caption: string,
  chatId = 1,
  options: Parameters<typeof createContext>[2] & {
    fileId?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
  } = {}
): TestContext {
  const ctx = createContext("", chatId, options);
  ctx.message.caption = caption;
  ctx.message.document = {
    file_id: options.fileId || "file-1",
    file_name: options.fileName,
    mime_type: options.mimeType,
    file_size: options.fileSize
  };
  return ctx;
}

function createPhotoContext(
  caption: string,
  chatId = 1,
  options: Parameters<typeof createContext>[2] & {
    photos?: TestContext["message"]["photo"];
  } = {}
): TestContext {
  const ctx = createContext("", chatId, options);
  ctx.message.caption = caption;
  ctx.message.photo = options.photos || [
    {
      file_id: "photo-small",
      file_size: 32,
      width: 90,
      height: 90
    },
    {
      file_id: "photo-large",
      file_size: 1024,
      width: 1280,
      height: 720
    }
  ];
  return ctx;
}

test("dev start reports the selected frontend script", async () => {
  const { bot } = createDependencies({
    devStart: async () => ({
      started: true,
      scriptName: "start",
      packageManager: "npm",
      command: "npm run start"
    })
  });
  const ctx = createContext("/dev start");
  const handler = bot.commands.get("dev");

  if (!handler) {
    throw new Error("Expected /dev handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /npm run start/i);
  assert.match(ctx.replies[0].text, /dev server|frontend/i);
});

test("sh git clone success suggests switching to the cloned repo", async () => {
  const { bot } = createDependencies({
    getStatus: () => ({
      backend: "sdk",
      active: false,
      activeMode: null,
      lastMode: null,
      lastExitCode: null,
      lastExitSignal: null,
      projectSessionId: null,
      preferredModel: null,
      language: "en",
      verboseOutput: false,
      ptySupported: null,
      workdir: "/workspace",
      relativeWorkdir: ".",
      workspaceRoot: "/workspace",
      command: "codex",
      mcpServers: [],
      workflowSystem: "superpowers",
      workflowPhase: "none"
    }),
    shellInspect: () => ({
      argv: ["git", "clone", "https://github.com/MackDing/opc-ren.git"],
      commandText: "git clone https://github.com/MackDing/opc-ren.git",
      confirmed: false,
      dangerous: false,
      requiresConfirmation: false,
      confirmationCommand: ""
    }),
    shellExecute: async () => ({
      started: true,
      status: "passed",
      command: "git clone https://github.com/MackDing/opc-ren.git",
      workdir: "/workspace",
      exitCode: 0,
      signal: null,
      output: "Cloning into 'opc-ren'..."
    })
  });
  const ctx = createContext(
    "/sh git clone https://github.com/MackDing/opc-ren.git"
  );
  const handler = bot.commands.get("sh");

  if (!handler) {
    throw new Error("Expected /sh handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length, 3);
  assert.match(ctx.replies[2].text, /Clone completed/i);
  assert.match(ctx.replies[2].text, /opc\\-ren/i);
  assert.match(ctx.replies[2].text, /repo opc\\-ren/i);
});

test("dev status, url, and logs expose repo-scoped frontend runtime details", async () => {
  const { bot } = createDependencies({
    devStatus: () => ({
      running: true,
      status: "running",
      workdir: process.cwd(),
      startedByChatId: "1",
      command: "npm run dev",
      packageManager: "npm",
      scriptName: "dev",
      pid: 123,
      startedAt: "2026-03-15T04:00:00.000Z",
      exitedAt: null,
      exitCode: null,
      signal: null,
      detectedUrl: "http://127.0.0.1:5173/"
    }),
    devLogs: () => "Local: http://127.0.0.1:5173/",
    devUrl: () => "http://127.0.0.1:5173/"
  });
  const statusHandler = bot.commands.get("dev");

  if (!statusHandler) {
    throw new Error("Expected /dev handler to be registered");
  }

  const statusCtx = createContext("/dev status");
  await statusHandler(statusCtx);
  assert.equal(statusCtx.replies.length > 0, true);
  assert.match(statusCtx.replies[0].text, /running/i);
  assert.match(statusCtx.replies[0].text, /npm run dev/i);

  const urlCtx = createContext("/dev url");
  await statusHandler(urlCtx);
  assert.match(urlCtx.replies[0].text, /5173/);

  const logsCtx = createContext("/dev logs");
  await statusHandler(logsCtx);
  assert.match(logsCtx.replies[0].text, /Local:/);
});

test("status command includes the internal superpowers workflow phase", async () => {
  const { bot } = createDependencies({
    getStatus: () => ({
      backend: "sdk",
      active: false,
      activeMode: null,
      lastMode: "sdk",
      lastExitCode: 0,
      lastExitSignal: null,
      projectSessionId: "thread-123",
      preferredModel: null,
      language: "en",
      verboseOutput: true,
      ptySupported: null,
      workdir: process.cwd(),
      relativeWorkdir: ".",
      workspaceRoot: process.cwd(),
      command: "codex",
      mcpServers: [],
      workflowSystem: "superpowers",
      workflowPhase: "brainstorming"
    })
  });
  const ctx = createContext("/status");
  const handler = bot.commands.get("status");

  if (!handler) {
    throw new Error("Expected /status handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /workflow system: superpowers/i);
  assert.match(ctx.replies[0].text, /workflow phase: brainstorming/i);
});

test("status command renders a Codex dashboard with action buttons", async () => {
  const { bot } = createDependencies({
    getStatus: () => ({
      backend: "sdk",
      active: true,
      activeMode: "sdk",
      lastMode: "sdk",
      lastExitCode: 0,
      lastExitSignal: null,
      projectSessionId: "thread-123",
      preferredModel: "gpt-5.4",
      language: "en",
      verboseOutput: true,
      ptySupported: null,
      workdir: process.cwd(),
      relativeWorkdir: "CodexClaw",
      workspaceRoot: "/Users/home",
      command: "codex",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      reasoningEffort: "high",
      networkAccessEnabled: true,
      webSearchMode: "live",
      mcpServers: ["github"],
      workflowSystem: "superpowers",
      workflowPhase: "working"
    })
  });
  const ctx = createContext("/status");
  const handler = bot.commands.get("status");

  if (!handler) {
    throw new Error("Expected /status handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /Codex Dashboard/i);
  assert.match(ctx.replies[0].text, /Project: CodexClaw/i);
  assert.match(ctx.replies[0].text, /Thread: thread\\-123/i);
  assert.match(ctx.replies[0].text, /Safety: workspace\\-write \/ never/i);
  assert.match(ctx.replies[0].text, /Search: live/i);

  const keyboard = ctx.replies[0].options?.reply_markup as {
    inline_keyboard?: Array<Array<{ callback_data?: string }>>;
  };
  const callbacks = (keyboard?.inline_keyboard || [])
    .flat()
    .map((button) => button.callback_data);

  assert.deepEqual(callbacks.slice(0, 4), [
    "dash:refresh",
    "dash:new",
    "dash:repo",
    "dash:model"
  ]);
  assert.ok(callbacks.includes("dash:stop"));
});

test("bot does not register repo-owned topic context commands", async () => {
  const { bot } = createDependencies();

  for (const name of [
    "work",
    "queue",
    "switch",
    "close",
    "pause",
    "done",
    "drop"
  ]) {
    assert.equal(bot.commands.has(name), false);
  }
});

test("text handler forwards messages without bot-side topic options", async () => {
  const sendOptions: Array<Record<string, unknown> | undefined> = [];
  const { bot } = createDependencies({
    sendPrompt: async (_ctx, _prompt, options) => {
      sendOptions.push(options);
      return {
        started: true,
        mode: "sdk"
      };
    }
  });
  const ctx = createContext("Fix topic harness tests");
  const handler = bot.events.get("text");

  if (!handler) {
    throw new Error("Expected text handler to be registered");
  }

  await handler(ctx);

  assert.equal(sendOptions.length, 1);
  assert.equal(sendOptions[0], undefined);
});

test("skill list explains that superpowers is internal and not toggleable", async () => {
  const { bot } = createDependencies();
  const ctx = createContext("/skill");
  const handler = bot.commands.get("skill");

  if (!handler) {
    throw new Error("Expected /skill handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /internal workflow: superpowers/i);
  assert.match(ctx.replies[0].text, /not toggleable/i);
});

test("skill state changes resync the Telegram command menu", async () => {
  let syncCalls = 0;
  const { bot } = createDependencies({
    syncTelegramCommands: async () => {
      syncCalls += 1;
      return true;
    }
  });
  const ctx = createContext("/skill off github");
  const handler = bot.commands.get("skill");

  if (!handler) {
    throw new Error("Expected /skill handler to be registered");
  }

  await handler(ctx);

  assert.equal(syncCalls, 1);
  assert.equal(ctx.replies.length > 0, true);
});

test("restart command schedules restart after replying", async () => {
  let restartCalls = 0;
  const { bot } = createDependencies({
    restart: async () => {
      restartCalls += 1;
    }
  });
  const ctx = createContext("/restart");
  const handler = bot.commands.get("restart");

  if (!handler) {
    throw new Error("Expected /restart handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0].text, /Restarting/i);
  assert.equal(restartCalls, 0);

  await new Promise((resolve) => setTimeout(resolve, 1100));

  assert.equal(restartCalls, 1);
});

test("text handler warns before starting a second codex run in the same workdir", async () => {
  const { bot } = createDependencies({
    sendPrompt: async () => ({
      started: false,
      reason: "workspace_busy",
      activeMode: "sdk",
      blockingChatId: "2",
      relativeWorkdir: "."
    })
  });
  const ctx = createContext("please fix the repo");
  const textHandler = bot.events.get("text");

  if (!textHandler) {
    throw new Error("Expected text handler to be registered");
  }

  await textHandler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /\/continue/);
  assert.match(ctx.replies[0].text, /same workdir|same project|another chat/i);
});

test("text handler ignores group messages that do not mention the bot", async () => {
  let routed = false;
  const { bot } = createDependencies({
    routeMessage: async () => {
      routed = true;
      return {
        target: "pty" as const,
        prompt: "should not run"
      };
    }
  });
  const ctx = createContext("please fix the repo", -100, {
    chatType: "group",
    botUsername: "CodexClawBot"
  });
  const textHandler = bot.events.get("text");

  if (!textHandler) {
    throw new Error("Expected text handler to be registered");
  }

  await textHandler(ctx);

  assert.equal(routed, false);
  assert.equal(ctx.replies.length, 0);
});

test("text handler responds to group messages that mention the bot", async () => {
  let routedText = "";
  const { bot } = createDependencies({
    routeMessage: async (text: string) => {
      routedText = text;
      return {
        target: "pty" as const,
        prompt: text
      };
    }
  });
  const ctx = createContext("@CodexClawBot please fix the repo", -100, {
    chatType: "supergroup",
    botUsername: "CodexClawBot"
  });
  const textHandler = bot.events.get("text");

  if (!textHandler) {
    throw new Error("Expected text handler to be registered");
  }

  await textHandler(ctx);

  assert.equal(routedText, "please fix the repo");
});

test("text handler responds to group replies to the bot", async () => {
  let routedText = "";
  const { bot } = createDependencies({
    routeMessage: async (text: string) => {
      routedText = text;
      return {
        target: "pty" as const,
        prompt: text
      };
    }
  });
  const ctx = createContext("please fix the repo", -100, {
    chatType: "group",
    botUsername: "CodexClawBot",
    replyToBot: true
  });
  const textHandler = bot.events.get("text");

  if (!textHandler) {
    throw new Error("Expected text handler to be registered");
  }

  await textHandler(ctx);

  assert.equal(routedText, "please fix the repo");
});

test("text handler includes replied message text in Codex prompt", async () => {
  const prompts: string[] = [];
  const { bot } = createDependencies({
    routeMessage: async (text: string) => ({
      target: "pty" as const,
      prompt: text
    }),
    sendPrompt: async (_ctx, prompt) => {
      prompts.push(prompt);
      return {
        started: true,
        mode: "sdk"
      };
    }
  });
  const ctx = createContext("왜 이렇게 판단했어?", -100, {
    chatType: "group",
    botUsername: "CodexClawBot",
    replyToBot: true,
    replyText: "Money Printer health check failed: HTTP 500"
  });
  const textHandler = bot.events.get("text");

  if (!textHandler) {
    throw new Error("Expected text handler to be registered");
  }

  await textHandler(ctx);

  assert.equal(prompts.length, 1);
  assert.match(
    prompts[0],
    /The user is replying to this previous Telegram message:/
  );
  assert.match(prompts[0], /Money Printer health check failed: HTTP 500/);
  assert.match(prompts[0], /User message:\n왜 이렇게 판단했어\?/);
});

test("document handler saves upload and sends file path prompt to Codex", async () => {
  const prompts: string[] = [];
  const options: unknown[] = [];
  const { bot } = createDependencies({
    sendPrompt: async (_ctx, prompt, sendOptions) => {
      prompts.push(prompt);
      options.push(sendOptions);
      return {
        started: true,
        mode: "sdk"
      };
    },
    saveUpload: async () => ({
      filePath: "/tmp/codexclaw-uploads/notes.md",
      originalName: "notes.md",
      mimeType: "text/markdown",
      size: 128,
      kind: "document",
      additionalDirectories: ["/tmp/codexclaw-uploads"]
    })
  });
  const ctx = createDocumentContext("요약해줘", -100, {
    chatType: "group",
    botUsername: "CodexClawBot",
    replyToBot: true,
    fileName: "notes.md",
    mimeType: "text/markdown",
    fileSize: 128
  });
  const handler = bot.events.get("document");

  if (!handler) {
    throw new Error("Expected document handler to be registered");
  }

  await handler(ctx);

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /The user uploaded a Telegram file/);
  assert.match(prompts[0], /\/tmp\/codexclaw-uploads\/notes\.md/);
  assert.match(prompts[0], /Original name:\nnotes\.md/);
  assert.match(prompts[0], /User message:\n요약해줘/);
  assert.deepEqual(
    (options[0] as { additionalDirectories?: string[] }).additionalDirectories,
    ["/tmp/codexclaw-uploads"]
  );
});

test("document handler accepts group caption mentions and strips the mention", async () => {
  const prompts: string[] = [];
  const { bot } = createDependencies({
    sendPrompt: async (_ctx, prompt) => {
      prompts.push(prompt);
      return {
        started: true,
        mode: "sdk"
      };
    },
    saveUpload: async () => ({
      filePath: "/tmp/codexclaw-uploads/notes.md",
      originalName: "notes.md",
      mimeType: "text/markdown",
      size: 128,
      kind: "document",
      additionalDirectories: ["/tmp/codexclaw-uploads"]
    })
  });
  const ctx = createDocumentContext("@CodexClawBot 분석해줘", -100, {
    chatType: "group",
    botUsername: "CodexClawBot",
    fileName: "notes.md",
    mimeType: "text/markdown",
    fileSize: 128
  });
  const handler = bot.events.get("document");

  if (!handler) {
    throw new Error("Expected document handler to be registered");
  }

  await handler(ctx);

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /User message:\n분석해줘/);
  assert.doesNotMatch(prompts[0], /@CodexClawBot/);
});

test("photo handler saves image and uses default prompt when caption is empty", async () => {
  const prompts: string[] = [];
  const uploads: Array<"document" | "image"> = [];
  const { bot } = createDependencies({
    sendPrompt: async (_ctx, prompt) => {
      prompts.push(prompt);
      return {
        started: true,
        mode: "sdk"
      };
    },
    saveUpload: async (_ctx, kind) => {
      uploads.push(kind);
      return {
        filePath: "/tmp/codexclaw-uploads/photo.jpg",
        originalName: "telegram-photo.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        kind,
        additionalDirectories: ["/tmp/codexclaw-uploads"]
      };
    }
  });
  const ctx = createPhotoContext("", 1);
  const handler = bot.events.get("photo");

  if (!handler) {
    throw new Error("Expected photo handler to be registered");
  }

  await handler(ctx);

  assert.deepEqual(uploads, ["image"]);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /\/tmp\/codexclaw-uploads\/photo\.jpg/);
  assert.match(
    prompts[0],
    /Please inspect this uploaded file and summarize the relevant details\./
  );
});

test("command handlers ignore unmentioned group commands", async () => {
  const { bot } = createDependencies();
  const ctx = createContext("/status", -100, {
    chatType: "group",
    botUsername: "CodexClawBot"
  });
  const handler = bot.commands.get("status");

  if (!handler) {
    throw new Error("Expected /status handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length, 0);
});

test("command handlers respond to mentioned group commands", async () => {
  const { bot } = createDependencies();
  const ctx = createContext("/status@CodexClawBot", -100, {
    chatType: "group",
    botUsername: "CodexClawBot"
  });
  const handler = bot.commands.get("status");

  if (!handler) {
    throw new Error("Expected /status handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /Codex Dashboard/i);
});

test("command handlers respond to group command replies to the bot", async () => {
  const { bot } = createDependencies();
  const ctx = createContext("/status", -100, {
    chatType: "group",
    botUsername: "CodexClawBot",
    replyToBot: true
  });
  const handler = bot.commands.get("status");

  if (!handler) {
    throw new Error("Expected /status handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /Codex Dashboard/i);
});

test("text handler routes .codex skill aliases to Codex with skill instruction", async () => {
  const skillRoot = await createCodexSkill("test-driven-development");
  const prompts: string[] = [];
  const { bot } = createDependencies({
    codexSkillRoots: [skillRoot],
    sendPrompt: async (_ctx, prompt) => {
      prompts.push(prompt);
      return {
        started: true,
        mode: "sdk"
      };
    }
  });
  const ctx = createContext("/s_test_driven_development write failing tests");
  const textHandler = bot.events.get("text");

  if (!textHandler) {
    throw new Error("Expected text handler to be registered");
  }

  await textHandler(ctx);

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /test-driven-development/);
  assert.match(prompts[0], /write failing tests/);
});

test("continue command replays a blocked request once", async () => {
  const { bot } = createDependencies({
    continuePendingPrompt: async () => ({
      started: true,
      mode: "sdk"
    })
  });
  const ctx = createContext("/continue");
  const handler = bot.commands.get("continue");

  if (!handler) {
    throw new Error("Expected /continue handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /continu|replay/i);
});

test("continue command reports when no blocked request is pending", async () => {
  const { bot } = createDependencies({
    continuePendingPrompt: async () => ({
      started: false,
      reason: "no_pending_prompt"
    })
  });
  const ctx = createContext("/continue");
  const handler = bot.commands.get("continue");

  if (!handler) {
    throw new Error("Expected /continue handler to be registered");
  }

  await handler(ctx);

  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /no blocked|nothing pending/i);
});

test("text handler shows guidance when plain-text github write actions are blocked", async () => {
  const switched: Array<{ chatId: string | number; target: string }> = [];
  const { bot } = createDependencies({
    routeMessage: async (text: string) => ({
      target: "skill" as const,
      skill: "github" as const,
      payload: text
    }),
    githubExecute: async () => ({
      text: "GitHub write actions require explicit /gh commands. Use /gh create repo five-in-a-row."
    }),
    switchWorkdir: (chatId, target) => {
      switched.push({ chatId, target });
      return {
        workdir: `/tmp/${target}`,
        relativePath: target
      };
    }
  });
  const ctx = createContext("create repo five-in-a-row");
  const textHandler = bot.events.get("text");

  if (!textHandler) {
    throw new Error("Expected text handler to be registered");
  }

  await textHandler(ctx);

  assert.deepEqual(switched, []);
  assert.equal(ctx.replies.length > 0, true);
  assert.match(ctx.replies[0].text, /explicit/i);
  assert.match(ctx.replies[0].text, /\/gh create repo/i);
});
