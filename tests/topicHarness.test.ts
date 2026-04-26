import test from "node:test";
import assert from "node:assert/strict";
import { TopicHarness } from "../src/harness/topicHarness.js";
import type { TopicClassification } from "../src/harness/topicClassifier.js";

function classification(
  overrides: Partial<TopicClassification> = {}
): TopicClassification {
  return {
    type: "chat",
    durability: "ephemeral",
    sideEffect: false,
    safeImmediate: false,
    requiresWeb: false,
    title: "Question",
    ...overrides
  };
}

function createHarness() {
  let tick = 0;
  return new TopicHarness({
    now: () => new Date(Date.UTC(2026, 3, 26, 10, 0, tick++))
  });
}

test("durable request with no active topic becomes active", () => {
  const harness = createHarness();

  const result = harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Implement topic harness",
    classification: classification({
      type: "repo",
      durability: "durable",
      sideEffect: true,
      title: "Implement topic harness"
    })
  });

  assert.equal(result.action, "process");
  assert.equal(result.topic?.status, "active");
  assert.equal(result.topic?.id, "T001");
  assert.equal(harness.getProject(123, "/repo").activeTopicId, "T001");
});

test("ephemeral chat with no active durable topic is not persisted", () => {
  const harness = createHarness();

  const result = harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "What does this mean?",
    classification: classification()
  });

  assert.equal(result.action, "process");
  assert.equal(result.topic, null);
  assert.equal(harness.getProject(123, "/repo").topics.length, 0);
});

test("different topic while active durable topic creates pending switch", () => {
  const harness = createHarness();
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Implement topic harness",
    classification: classification({
      type: "repo",
      durability: "durable",
      sideEffect: true,
      title: "Implement topic harness"
    })
  });

  const result = harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Find latest OpenAI API changes",
    classification: classification({
      type: "research",
      durability: "ephemeral",
      requiresWeb: true,
      title: "Find latest OpenAI API changes"
    })
  });

  assert.equal(result.action, "ask_switch");
  assert.equal(result.activeTopic.title, "Implement topic harness");
  assert.equal(
    result.pendingSwitch.incomingText,
    "Find latest OpenAI API changes"
  );
});

test("queuePendingSwitch keeps active topic and queues incoming request", () => {
  const harness = createHarness();
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Implement topic harness",
    classification: classification({
      type: "repo",
      durability: "durable",
      sideEffect: true,
      title: "Implement topic harness"
    })
  });
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Install Gmail skill",
    classification: classification({
      type: "skill",
      durability: "durable",
      sideEffect: true,
      title: "Install Gmail skill"
    })
  });

  const queued = harness.queuePendingSwitch(123, "/repo");
  const project = harness.getProject(123, "/repo");

  assert.equal(queued.status, "pending");
  assert.equal(project.activeTopicId, "T001");
  assert.equal(project.pendingSwitch, null);
  assert.equal(
    project.topics.map((topic) => topic.status).join(","),
    "active,pending"
  );
});

test("pauseAndSwitch pauses active topic and starts pending switch", () => {
  const harness = createHarness();
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Implement topic harness",
    classification: classification({
      type: "repo",
      durability: "durable",
      sideEffect: true,
      title: "Implement topic harness"
    })
  });
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Find latest OpenAI API changes",
    classification: classification({
      type: "research",
      durability: "ephemeral",
      requiresWeb: true,
      title: "Find latest OpenAI API changes"
    })
  });

  const active = harness.pauseAndSwitch(123, "/repo");
  const project = harness.getProject(123, "/repo");

  assert.equal(active.status, "active");
  assert.equal(active.title, "Find latest OpenAI API changes");
  assert.equal(project.activeTopicId, "T002");
  assert.equal(project.topics[0].status, "paused");
});

test("closeAndSwitch marks active done and starts pending switch", () => {
  const harness = createHarness();
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Implement topic harness",
    classification: classification({
      type: "repo",
      durability: "durable",
      sideEffect: true,
      title: "Implement topic harness"
    })
  });
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Restart the bot",
    classification: classification({
      type: "ops",
      durability: "durable",
      sideEffect: true,
      title: "Restart the bot"
    })
  });

  const active = harness.closeAndSwitch(123, "/repo");
  const project = harness.getProject(123, "/repo");

  assert.equal(active.title, "Restart the bot");
  assert.equal(project.topics[0].status, "done");
  assert.equal(project.activeTopicId, "T002");
});

test("same-topic continuation updates active topic and processes immediately", () => {
  const harness = createHarness();
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Implement topic harness",
    classification: classification({
      type: "repo",
      durability: "durable",
      sideEffect: true,
      title: "Implement topic harness"
    })
  });

  const result = harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Do not implement yet, simulate first.",
    classification: classification({ title: "Do not implement yet" }),
    sameTopic: true
  });

  assert.equal(result.action, "process");
  assert.equal(result.topic?.id, "T001");
  assert.equal(
    result.topic?.lastUserIntent,
    "Do not implement yet, simulate first."
  );
});

test("pause, done, drop, and thread id updates mutate topic state", () => {
  const harness = createHarness();
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Install Gmail skill",
    classification: classification({
      type: "skill",
      durability: "durable",
      sideEffect: true,
      title: "Install Gmail skill"
    })
  });

  harness.recordThreadId(123, "/repo", "T001", "thread-1");
  assert.equal(
    harness.getProject(123, "/repo").topics[0].codexThreadId,
    "thread-1"
  );

  const paused = harness.pauseActive(123, "/repo");
  assert.equal(paused?.status, "paused");
  assert.equal(harness.getProject(123, "/repo").activeTopicId, null);

  const dropped = harness.dropTopic(123, "/repo", "T001");
  assert.equal(dropped.status, "cancelled");

  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Commit changes",
    classification: classification({
      type: "ops",
      durability: "durable",
      sideEffect: true,
      title: "Commit changes"
    })
  });
  const done = harness.doneActive(123, "/repo");
  assert.equal(done?.status, "done");
});

test("export and restore preserve active topic and pending switch", () => {
  const harness = createHarness();
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Implement topic harness",
    classification: classification({
      type: "repo",
      durability: "durable",
      sideEffect: true,
      title: "Implement topic harness"
    })
  });
  harness.evaluateIncoming({
    chatId: 123,
    workdir: "/repo",
    text: "Find latest OpenAI API changes",
    classification: classification({
      type: "research",
      durability: "ephemeral",
      requiresWeb: true,
      title: "Find latest OpenAI API changes"
    })
  });

  const restored = createHarness();
  restored.restoreState(harness.exportState());

  const project = restored.getProject(123, "/repo");
  assert.equal(project.activeTopicId, "T001");
  assert.equal(
    project.pendingSwitch?.incomingText,
    "Find latest OpenAI API changes"
  );
  assert.equal(project.topics[0].title, "Implement topic harness");
});
