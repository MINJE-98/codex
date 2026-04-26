import test from "node:test";
import assert from "node:assert/strict";
import { classifyTopicRequest } from "../src/harness/topicClassifier.js";

test("classifies general chat as ephemeral with no side effect", () => {
  const result = classifyTopicRequest("What does this error mean?");

  assert.equal(result.type, "chat");
  assert.equal(result.durability, "ephemeral");
  assert.equal(result.sideEffect, false);
  assert.equal(result.safeImmediate, false);
});

test("classifies internet lookup as research", () => {
  const result = classifyTopicRequest("Find the latest OpenAI API changes.");

  assert.equal(result.type, "research");
  assert.equal(result.durability, "ephemeral");
  assert.equal(result.sideEffect, false);
  assert.equal(result.requiresWeb, true);
});

test("classifies data and uploaded file requests as durable file or data work", () => {
  const data = classifyTopicRequest("Summarize this CSV by customer segment.");
  const upload = classifyTopicRequest("Please summarize this upload.", {
    hasUpload: true,
    uploadKind: "document"
  });

  assert.equal(data.type, "data");
  assert.equal(data.durability, "durable");
  assert.equal(upload.type, "file");
  assert.equal(upload.durability, "durable");
});

test("classifies skill operations as durable side-effecting work", () => {
  const result = classifyTopicRequest("Install the Gmail skill and enable it.");

  assert.equal(result.type, "skill");
  assert.equal(result.durability, "durable");
  assert.equal(result.sideEffect, true);
});

test("classifies repo changes as durable side-effecting work", () => {
  const result = classifyTopicRequest(
    "Implement topic context harness in CodexClaw."
  );

  assert.equal(result.type, "repo");
  assert.equal(result.durability, "durable");
  assert.equal(result.sideEffect, true);
});

test("classifies operational requests as durable side-effecting work", () => {
  const commit = classifyTopicRequest("Commit this change.");
  const restart = classifyTopicRequest("Restart the bot service.");

  assert.equal(commit.type, "ops");
  assert.equal(commit.durability, "durable");
  assert.equal(commit.sideEffect, true);
  assert.equal(restart.type, "ops");
});

test("marks safe status commands as safe immediate chat", () => {
  const result = classifyTopicRequest("/status@CodexClawBot");

  assert.equal(result.type, "chat");
  assert.equal(result.durability, "ephemeral");
  assert.equal(result.sideEffect, false);
  assert.equal(result.safeImmediate, true);
});

test("creates a compact title from the request", () => {
  const result = classifyTopicRequest(
    "Please research the latest Telegram Bot API file upload behavior."
  );

  assert.equal(
    result.title,
    "Please research the latest Telegram Bot API file upload behavior."
  );
});
