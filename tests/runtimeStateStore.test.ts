import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeStateStore } from "../src/runtimeStateStore.js";

test("runtime state store defaults topic harness state", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-state-"));
  const file = path.join(tempDir, "missing-runtime-state.json");
  const store = new RuntimeStateStore({
    config: {
      app: {
        name: "CodexClaw",
        stateFile: file
      }
    }
  });

  const state = await store.load();

  assert.deepEqual(state.topics, {
    chats: {}
  });
});

test("runtime state store saves and loads MCP and skill state", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-state-"));
  const file = path.join(tempDir, "runtime-state.json");
  const store = new RuntimeStateStore({
    config: {
      app: {
        name: "CodexClaw",
        stateFile: file
      }
    }
  });

  await store.save({
    mcp: {
      disabledServers: ["context7"]
    },
    runner: {
      chats: {
        42: {
          preferredModel: null,
          language: "zh-HK",
          verboseOutput: true,
          currentWorkdir: "project-a",
          recentWorkdirs: ["project-a", "project-b"],
          projects: {
            "project-a": {
              lastSessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              lastMode: null,
              lastExitCode: null,
              lastExitSignal: null,
              lastWorkflowPhase: null
            }
          }
        }
      }
    },
    skills: {
      chats: {
        42: {
          enabledSkills: ["mcp"]
        }
      }
    },
    topics: {
      chats: {
        42: {
          projects: {
            "project-a": {
              activeTopicId: "T001",
              topics: [
                {
                  id: "T001",
                  type: "repo",
                  durability: "durable",
                  status: "active",
                  title: "Implement topic harness",
                  summary: "",
                  lastUserIntent: "Implement topic harness",
                  workdir: "project-a",
                  createdAt: "2026-04-26T10:00:00.000Z",
                  updatedAt: "2026-04-26T10:00:00.000Z",
                  codexThreadId: null,
                  lastError: null
                }
              ],
              pendingSwitch: null
            }
          }
        }
      }
    }
  });

  const state = await store.load();

  assert.deepEqual(state.mcp, {
    disabledServers: ["context7"]
  });
  assert.deepEqual(state.runner, {
    chats: {
      42: {
        preferredModel: null,
        language: "zh-HK",
        verboseOutput: true,
        currentWorkdir: "project-a",
        recentWorkdirs: ["project-a", "project-b"],
        projects: {
          "project-a": {
            lastSessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            lastMode: null,
            lastExitCode: null,
            lastExitSignal: null,
            lastWorkflowPhase: null
          }
        }
      }
    }
  });
  assert.deepEqual(state.skills, {
    chats: {
      42: {
        enabledSkills: ["mcp"]
      }
    }
  });
  assert.equal(
    state.topics.chats[42].projects["project-a"].topics[0].title,
    "Implement topic harness"
  );
});
