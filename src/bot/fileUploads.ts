import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { request, type Dispatcher } from "undici";
import { createTelegramFetchDispatcher } from "../lib/telegramApi.js";

export type TelegramUploadKind = "document" | "image";

export interface SavedTelegramUpload {
  filePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: TelegramUploadKind;
  additionalDirectories: string[];
}

export interface TelegramFileUploadManagerLike {
  save(ctx: unknown, kind: TelegramUploadKind): Promise<SavedTelegramUpload>;
}

interface TelegramDocumentLike {
  file_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramPhotoLike {
  file_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface TelegramContextLike {
  chat?: {
    id?: string | number;
  };
  message?: {
    document?: TelegramDocumentLike;
    photo?: TelegramPhotoLike[];
  };
  telegram?: {
    getFileLink(fileId: string): Promise<string | URL>;
  };
}

interface TelegramFileRequestResponse {
  statusCode: number;
  body: Readable;
}

type TelegramFileRequest = (
  url: string,
  options?: {
    dispatcher?: Dispatcher;
  }
) => Promise<TelegramFileRequestResponse>;

export interface TelegramFileUploadManagerOptions {
  uploadRoot: string;
  proxyUrl?: string;
  maxBytes?: number;
  requestImpl?: TelegramFileRequest;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".diff",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".log",
  ".md",
  ".markdown",
  ".patch",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);
const DOCUMENT_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ".docx",
  ".pdf",
  ".xlsx"
]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SUPPORTED_EXACT_MIME_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/sql",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xml",
  "application/x-yaml",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml"
]);

export function sanitizeTelegramFileName(
  input: string | undefined,
  fallback: string
): string {
  const base = path.basename(String(input || "").trim() || fallback);
  const sanitized = base
    .replace(/[^\w.()+@ -]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 140);

  if (!sanitized || sanitized === "." || sanitized === "..") {
    return fallback;
  }

  return sanitized;
}

export function buildTelegramUploadPrompt(
  upload: SavedTelegramUpload,
  message: string
): string {
  return [
    "The user uploaded a Telegram file. It has been saved locally for inspection.",
    "",
    "File path:",
    upload.filePath,
    "",
    "Original name:",
    upload.originalName,
    "",
    "MIME type:",
    upload.mimeType || "unknown",
    "",
    "File kind:",
    upload.kind,
    "",
    "User message:",
    message,
    "",
    "Please inspect the file directly from the path above."
  ].join("\n");
}

function safeChatDirectoryName(value: unknown): string {
  return String(value || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
}

function isSupportedUpload(
  fileName: string,
  mimeType: string,
  kind: TelegramUploadKind
): boolean {
  const extension = path.extname(fileName).toLowerCase();
  const normalizedMime = mimeType.toLowerCase();

  if (kind === "image") {
    return (
      IMAGE_EXTENSIONS.has(extension) ||
      normalizedMime.startsWith("image/") ||
      SUPPORTED_EXACT_MIME_TYPES.has(normalizedMime)
    );
  }

  return (
    DOCUMENT_EXTENSIONS.has(extension) ||
    normalizedMime.startsWith("text/") ||
    SUPPORTED_EXACT_MIME_TYPES.has(normalizedMime)
  );
}

function ensureUploadSizeAllowed(size: number, maxBytes: number): void {
  if (size > maxBytes) {
    throw new Error(
      `Telegram file is too large: ${size} bytes exceeds ${maxBytes} bytes.`
    );
  }
}

function chooseLargestPhoto(photos: TelegramPhotoLike[]): TelegramPhotoLike {
  return [...photos].sort((a, b) => {
    const aPixels = (a.width || 0) * (a.height || 0);
    const bPixels = (b.width || 0) * (b.height || 0);
    return (b.file_size || bPixels) - (a.file_size || aPixels);
  })[0];
}

function timestampPrefix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export class TelegramFileUploadManager implements TelegramFileUploadManagerLike {
  private readonly uploadRoot: string;
  private readonly proxyUrl?: string;
  private readonly maxBytes: number;
  private readonly requestImpl: TelegramFileRequest;

  constructor({
    uploadRoot,
    proxyUrl,
    maxBytes = DEFAULT_MAX_BYTES,
    requestImpl = request as unknown as TelegramFileRequest
  }: TelegramFileUploadManagerOptions) {
    this.uploadRoot = path.resolve(uploadRoot);
    this.proxyUrl = proxyUrl;
    this.maxBytes = maxBytes;
    this.requestImpl = requestImpl;
  }

  async save(
    ctx: unknown,
    kind: TelegramUploadKind
  ): Promise<SavedTelegramUpload> {
    const context = ctx as TelegramContextLike;
    const metadata = this.extractMetadata(context, kind);
    ensureUploadSizeAllowed(metadata.size, this.maxBytes);

    if (!isSupportedUpload(metadata.originalName, metadata.mimeType, kind)) {
      throw new Error(
        `Unsupported Telegram file type: ${metadata.originalName} (${metadata.mimeType || "unknown"}).`
      );
    }

    if (!context.telegram?.getFileLink) {
      throw new Error("Telegram file download is unavailable in this context.");
    }

    const link = await context.telegram.getFileLink(metadata.fileId);
    const directory = path.join(
      this.uploadRoot,
      safeChatDirectoryName(context.chat?.id)
    );
    await fs.mkdir(directory, { recursive: true });

    const filePath = path.join(
      directory,
      `${timestampPrefix()}-${metadata.originalName}`
    );
    const dispatcher = createTelegramFetchDispatcher(this.proxyUrl);
    const response = await this.requestImpl(String(link), {
      ...(dispatcher ? { dispatcher } : {})
    });

    if (response.statusCode >= 400) {
      throw new Error(
        `Telegram file download failed with HTTP ${response.statusCode}.`
      );
    }

    await pipeline(response.body, createWriteStream(filePath));

    return {
      filePath,
      originalName: metadata.originalName,
      mimeType: metadata.mimeType,
      size: metadata.size,
      kind,
      additionalDirectories: [this.uploadRoot]
    };
  }

  private extractMetadata(
    context: TelegramContextLike,
    kind: TelegramUploadKind
  ): {
    fileId: string;
    originalName: string;
    mimeType: string;
    size: number;
  } {
    if (kind === "image") {
      const photos = context.message?.photo || [];
      const photo = chooseLargestPhoto(photos);
      if (!photo?.file_id) {
        throw new Error("Telegram photo upload did not include a file id.");
      }

      return {
        fileId: photo.file_id,
        originalName: sanitizeTelegramFileName(
          `telegram-photo-${photo.file_id}.jpg`,
          "telegram-photo.jpg"
        ),
        mimeType: "image/jpeg",
        size: photo.file_size || 0
      };
    }

    const document = context.message?.document;
    if (!document?.file_id) {
      throw new Error("Telegram document upload did not include a file id.");
    }

    return {
      fileId: document.file_id,
      originalName: sanitizeTelegramFileName(
        document.file_name,
        `telegram-document-${document.file_id}`
      ),
      mimeType: String(document.mime_type || ""),
      size: document.file_size || 0
    };
  }
}
