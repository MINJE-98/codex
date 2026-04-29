import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildTelegramUploadPrompt,
  sanitizeTelegramFileName,
  TelegramFileUploadManager
} from "../src/bot/fileUploads.js";

test("sanitizeTelegramFileName removes path traversal and unsafe characters", () => {
  assert.equal(
    sanitizeTelegramFileName("../unsafe report?.md", "upload.txt"),
    "unsafe_report_.md"
  );
  assert.equal(sanitizeTelegramFileName("", "upload.txt"), "upload.txt");
});

test("buildTelegramUploadPrompt points Codex at the saved local path", () => {
  const prompt = buildTelegramUploadPrompt(
    {
      filePath: "/tmp/codexclaw-uploads/report.md",
      originalName: "report.md",
      mimeType: "text/markdown",
      size: 42,
      kind: "document",
      additionalDirectories: ["/tmp/codexclaw-uploads"]
    },
    "검토해줘"
  );

  assert.match(prompt, /The user uploaded a Telegram file/);
  assert.match(prompt, /File path:\n\/tmp\/codexclaw-uploads\/report\.md/);
  assert.match(prompt, /Original name:\nreport\.md/);
  assert.match(prompt, /User message:\n검토해줘/);
});

test("TelegramFileUploadManager downloads supported documents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claws-upload-"));
  const requestedFileIds: string[] = [];
  const manager = new TelegramFileUploadManager({
    uploadRoot: root,
    requestImpl: async () => ({
      statusCode: 200,
      body: Readable.from(["hello from telegram"])
    })
  });

  const result = await manager.save(
    {
      chat: { id: -100 },
      message: {
        document: {
          file_id: "file-1",
          file_name: "../notes.md",
          mime_type: "text/markdown",
          file_size: 19
        }
      },
      telegram: {
        getFileLink: async (fileId: string) => {
          requestedFileIds.push(fileId);
          return new URL("https://telegram.example/file");
        }
      }
    },
    "document"
  );

  assert.deepEqual(requestedFileIds, ["file-1"]);
  assert.equal(result.originalName, "notes.md");
  assert.equal(result.mimeType, "text/markdown");
  assert.equal(result.kind, "document");
  assert.deepEqual(result.additionalDirectories, [root]);
  assert.equal(
    await fs.readFile(result.filePath, "utf8"),
    "hello from telegram"
  );
});

test("TelegramFileUploadManager downloads zip documents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claws-zip-"));
  const manager = new TelegramFileUploadManager({
    uploadRoot: root,
    requestImpl: async () => ({
      statusCode: 200,
      body: Readable.from(["zip-bytes"])
    })
  });

  const result = await manager.save(
    {
      chat: { id: 1 },
      message: {
        document: {
          file_id: "zip-1",
          file_name: "notion-export.zip",
          mime_type: "application/zip",
          file_size: 9
        }
      },
      telegram: {
        getFileLink: async () => new URL("https://telegram.example/zip")
      }
    },
    "document"
  );

  assert.equal(result.originalName, "notion-export.zip");
  assert.equal(result.mimeType, "application/zip");
  assert.equal(await fs.readFile(result.filePath, "utf8"), "zip-bytes");
});

test("TelegramFileUploadManager accepts zip documents reported as octet-stream", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claws-zip-"));
  const manager = new TelegramFileUploadManager({
    uploadRoot: root,
    requestImpl: async () => ({
      statusCode: 200,
      body: Readable.from(["zip-bytes"])
    })
  });

  const result = await manager.save(
    {
      chat: { id: 1 },
      message: {
        document: {
          file_id: "zip-2",
          file_name: "notion-export.zip",
          mime_type: "application/octet-stream",
          file_size: 9
        }
      },
      telegram: {
        getFileLink: async () => new URL("https://telegram.example/zip")
      }
    },
    "document"
  );

  assert.equal(result.originalName, "notion-export.zip");
  assert.equal(result.mimeType, "application/octet-stream");
  assert.equal(await fs.readFile(result.filePath, "utf8"), "zip-bytes");
});

test("TelegramFileUploadManager uses the largest photo size", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claws-photo-"));
  const requestedFileIds: string[] = [];
  const manager = new TelegramFileUploadManager({
    uploadRoot: root,
    requestImpl: async () => ({
      statusCode: 200,
      body: Readable.from(["image-bytes"])
    })
  });

  const result = await manager.save(
    {
      chat: { id: 1 },
      message: {
        photo: [
          { file_id: "small", file_size: 10, width: 64, height: 64 },
          { file_id: "large", file_size: 100, width: 1024, height: 768 }
        ]
      },
      telegram: {
        getFileLink: async (fileId: string) => {
          requestedFileIds.push(fileId);
          return new URL("https://telegram.example/photo");
        }
      }
    },
    "image"
  );

  assert.deepEqual(requestedFileIds, ["large"]);
  assert.equal(result.kind, "image");
  assert.equal(result.mimeType, "image/jpeg");
  assert.match(path.basename(result.filePath), /telegram-photo-large\.jpg$/);
});

test("TelegramFileUploadManager rejects unsupported document types", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claws-upload-"));
  const manager = new TelegramFileUploadManager({ uploadRoot: root });

  await assert.rejects(
    () =>
      manager.save(
        {
          chat: { id: 1 },
          message: {
            document: {
              file_id: "file-1",
              file_name: "malware.exe",
              mime_type: "application/x-msdownload",
              file_size: 1024
            }
          },
          telegram: {
            getFileLink: async () => new URL("https://telegram.example/file")
          }
        },
        "document"
      ),
    /Unsupported Telegram file type/
  );
});
