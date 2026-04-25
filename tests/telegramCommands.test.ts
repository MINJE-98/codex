import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_TELEGRAM_COMMANDS,
  buildTelegramCommands,
  resolveCodexSkillCommand,
  syncTelegramCommands
} from "../src/bot/telegramCommands.js";

async function createSkill(root: string, name: string, description: string) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "---",
      "",
      "# Skill body",
      ""
    ].join("\n")
  );
}

test("syncTelegramCommands publishes the default Telegram command menu", async () => {
  const calls: Array<readonly { command: string; description: string }[]> = [];
  const ok = await syncTelegramCommands(
    {
      telegram: {
        setMyCommands: async (commands) => {
          calls.push(commands);
          return true;
        }
      }
    },
    { skillRoots: [] }
  );

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], DEFAULT_TELEGRAM_COMMANDS);
  assert.equal(
    calls[0].some((command) => command.command === "status"),
    true
  );
  assert.equal(
    calls[0].some((command) => command.command === "gh"),
    true
  );
  assert.equal(
    calls[0].some((command) => command.command === "mcp"),
    true
  );
  assert.equal(
    calls[0].every((command) => !command.command.startsWith("/")),
    true
  );
});

test("buildTelegramCommands includes .codex skill aliases", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skills-"));
  await createSkill(
    root,
    "test-driven-development",
    "Use this before writing implementation code."
  );

  const commands = await buildTelegramCommands({ skillRoots: [root] });
  const skillCommand = commands.find(
    (command) => command.command === "s_test_driven_development"
  );

  assert.ok(skillCommand);
  assert.match(skillCommand.description, /test-driven-development/);
});

test("resolveCodexSkillCommand maps Telegram aliases back to skill names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skills-"));
  await createSkill(
    root,
    "test-driven-development",
    "Use this before writing implementation code."
  );

  const result = await resolveCodexSkillCommand(
    "/s_test_driven_development write the failing test",
    { skillRoots: [root] }
  );

  assert.deepEqual(result, {
    command: "s_test_driven_development",
    skillName: "test-driven-development",
    task: "write the failing test"
  });
});

test("syncTelegramCommands reports failures without throwing", async () => {
  const warnings: string[] = [];
  const ok = await syncTelegramCommands(
    {
      telegram: {
        setMyCommands: async () => {
          throw new Error("telegram unavailable");
        }
      }
    },
    {
      skillRoots: [],
      warn: (message) => warnings.push(message)
    }
  );

  assert.equal(ok, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /telegram command sync failed/i);
});
