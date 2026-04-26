import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toErrorMessage } from "../lib/errors.js";

export interface TelegramCommand {
  command: string;
  description: string;
}

export interface TelegramCommandSyncTarget {
  telegram: {
    setMyCommands(commands: readonly TelegramCommand[]): Promise<unknown>;
  };
}

export interface TelegramCommandSyncLogger {
  warn(message: string): void;
}

export interface CodexSkillCommand {
  command: string;
  skillName: string;
  description: string;
  path: string;
}

export interface TelegramCommandBuildOptions {
  skillRoots?: readonly string[];
}

export interface TelegramCommandSyncOptions
  extends TelegramCommandBuildOptions, TelegramCommandSyncLogger {}

export interface CodexSkillInvocation {
  command: string;
  skillName: string;
  task: string;
}

export const DEFAULT_TELEGRAM_COMMANDS = [
  { command: "help", description: "Show help" },
  { command: "status", description: "Show runtime status" },
  { command: "pwd", description: "Show current project directory" },
  { command: "repo", description: "List or switch projects" },
  { command: "skill", description: "Manage skill switches" },
  { command: "new", description: "Clear current project conversation" },
  { command: "exec", description: "Run a one-off Codex task" },
  { command: "auto", description: "Run a fully automatic Codex task" },
  { command: "plan", description: "Ask Codex for a plan only" },
  { command: "continue", description: "Replay a blocked request once" },
  { command: "model", description: "Show or set the Codex model" },
  { command: "language", description: "Show or set bot language" },
  { command: "verbose", description: "Toggle system notices" },
  { command: "dev", description: "Manage frontend dev server" },
  { command: "sh", description: "Run an allowlisted shell command" },
  { command: "restart", description: "Restart the bot process" },
  { command: "interrupt", description: "Interrupt active Codex run" },
  { command: "stop", description: "Terminate active Codex run" },
  { command: "cron_now", description: "Trigger daily summary now" },
  { command: "gh", description: "GitHub skill commands" },
  { command: "mcp", description: "MCP control commands" }
] as const satisfies readonly TelegramCommand[];

export function defaultCodexSkillRoots(): string[] {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return [
    path.join(codexHome, "skills"),
    path.join(process.cwd(), ".codex", "skills")
  ];
}

function parseFrontmatterValue(source: string, key: string): string {
  const frontmatter = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatter) return "";

  const lines = frontmatter[1].split(/\r?\n/);
  const pattern = new RegExp(`^${key}:\\s*(.*?)\\s*$`);

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(pattern);
    if (!match) continue;

    const rawValue = match[1].trim();
    if (/^[>|]/.test(rawValue)) {
      const blockLines: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (/^\S[^:]*:\s*/.test(line)) break;
        blockLines.push(line.replace(/^\s+/, ""));
      }

      return blockLines.join(" ").trim();
    }

    return rawValue.replace(/^["']|["']$/g, "").trim();
  }

  return "";
}

function truncateDescription(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 256) return normalized;
  return `${normalized.slice(0, 253).trimEnd()}...`;
}

function createSkillCommandAlias(skillName: string): string {
  const slug = skillName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const fallback = slug || "skill";
  const command = `s_${fallback}`;

  if (command.length <= 32) return command;

  const hash = createHash("sha1").update(skillName).digest("hex").slice(0, 6);
  return `${command.slice(0, 25)}_${hash}`;
}

async function findSkillFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isFile() && entry.name === "SKILL.md") return [fullPath];
        if (entry.isDirectory()) return findSkillFiles(fullPath);
        return [];
      })
    );

    return files.flat();
  } catch {
    return [];
  }
}

export async function discoverCodexSkillCommands(
  roots: readonly string[] = defaultCodexSkillRoots()
): Promise<CodexSkillCommand[]> {
  const files = (await Promise.all(roots.map((root) => findSkillFiles(root))))
    .flat()
    .sort();
  const byName = new Map<string, CodexSkillCommand>();
  const usedCommands = new Set<string>();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8").catch(() => "");
    const skillName = parseFrontmatterValue(source, "name");
    if (!skillName || byName.has(skillName)) continue;

    let command = createSkillCommandAlias(skillName);
    if (usedCommands.has(command)) {
      const hash = createHash("sha1").update(file).digest("hex").slice(0, 6);
      command = `${command.slice(0, 25)}_${hash}`;
    }

    usedCommands.add(command);
    byName.set(skillName, {
      command,
      skillName,
      description: truncateDescription(
        `Skill ${skillName}: ${parseFrontmatterValue(source, "description") || skillName}`
      ),
      path: file
    });
  }

  return [...byName.values()].sort((a, b) =>
    a.command.localeCompare(b.command)
  );
}

export async function buildTelegramCommands(
  options: TelegramCommandBuildOptions = {}
): Promise<TelegramCommand[]> {
  const skillCommands = await discoverCodexSkillCommands(options.skillRoots);

  return [
    ...DEFAULT_TELEGRAM_COMMANDS,
    ...skillCommands.map((skill) => ({
      command: skill.command,
      description: skill.description
    }))
  ].slice(0, 100);
}

export async function resolveCodexSkillCommand(
  text: string,
  options: TelegramCommandBuildOptions = {}
): Promise<CodexSkillInvocation | null> {
  const match = String(text || "").match(
    /^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/
  );
  if (!match) return null;

  const commandName = match[1];
  const skill = (await discoverCodexSkillCommands(options.skillRoots)).find(
    (candidate) => candidate.command === commandName
  );
  if (!skill) return null;

  return {
    command: skill.command,
    skillName: skill.skillName,
    task: (match[2] || "").trim()
  };
}

export async function syncTelegramCommands(
  bot: TelegramCommandSyncTarget,
  options: Partial<TelegramCommandSyncOptions> = {}
): Promise<boolean> {
  const logger = options.warn ? { warn: options.warn } : console;
  try {
    await bot.telegram.setMyCommands(
      await buildTelegramCommands({ skillRoots: options.skillRoots })
    );
    return true;
  } catch (error) {
    logger.warn(`[bot] telegram command sync failed: ${toErrorMessage(error)}`);
    return false;
  }
}
