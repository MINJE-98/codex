export type TopicType =
  | "chat"
  | "research"
  | "data"
  | "file"
  | "skill"
  | "repo"
  | "ops";

export type TopicDurability = "ephemeral" | "durable";

export interface ClassifyTopicRequestOptions {
  hasUpload?: boolean;
  uploadKind?: "document" | "image";
}

export interface TopicClassification {
  type: TopicType;
  durability: TopicDurability;
  sideEffect: boolean;
  safeImmediate: boolean;
  requiresWeb: boolean;
  title: string;
}

const SAFE_COMMANDS = new Set([
  "status",
  "pwd",
  "repo",
  "work",
  "help",
  "model",
  "language",
  "verbose"
]);

function commandName(text: string): string {
  const match = text.trim().match(/^\/([A-Za-z0-9_-]+)(?:@[A-Za-z0-9_]+)?\b/);
  return match?.[1]?.toLowerCase() || "";
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function titleFromText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled request";
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

export function classifyTopicRequest(
  text: string,
  options: ClassifyTopicRequestOptions = {}
): TopicClassification {
  const source = String(text || "");
  const normalized = source.toLowerCase();
  const title = titleFromText(source);
  const command = commandName(source);

  if (command && SAFE_COMMANDS.has(command)) {
    return {
      type: "chat",
      durability: "ephemeral",
      sideEffect: false,
      safeImmediate: true,
      requiresWeb: false,
      title
    };
  }

  if (options.hasUpload) {
    return {
      type: "file",
      durability: "durable",
      sideEffect: false,
      safeImmediate: false,
      requiresWeb: false,
      title
    };
  }

  if (
    matchesAny(normalized, [
      /\b(commit|push|restart|reboot|launchd|service|delete|remove|clean up)\b/,
      /커밋|푸쉬|푸시|재시작|리부팅|삭제|지워|서비스/
    ])
  ) {
    return {
      type: "ops",
      durability: "durable",
      sideEffect: true,
      safeImmediate: false,
      requiresWeb: false,
      title
    };
  }

  if (
    matchesAny(normalized, [
      /\b(skill|install|enable|disable|configure|sync)\b/,
      /스킬|설치|활성화|비활성화|설정|동기화/
    ])
  ) {
    return {
      type: "skill",
      durability: "durable",
      sideEffect: true,
      safeImmediate: false,
      requiresWeb: false,
      title
    };
  }

  if (
    matchesAny(normalized, [
      /\b(csv|json|spreadsheet|table|dataset|data|extract|parse)\b/,
      /데이터|표|추출|파싱|정리|요약/
    ])
  ) {
    return {
      type: "data",
      durability: "durable",
      sideEffect: false,
      safeImmediate: false,
      requiresWeb: false,
      title
    };
  }

  if (
    matchesAny(normalized, [
      /\b(implement|code|fix|bug|test|refactor|repo|readme|typescript)\b/,
      /구현|코드|수정|버그|테스트|리팩터|레포/
    ])
  ) {
    return {
      type: "repo",
      durability: "durable",
      sideEffect: true,
      safeImmediate: false,
      requiresWeb: false,
      title
    };
  }

  if (
    matchesAny(normalized, [
      /\b(search|find|research|latest|recent|lookup|internet|web)\b/,
      /검색|찾아|리서치|최신|최근|인터넷|웹/
    ])
  ) {
    return {
      type: "research",
      durability: "ephemeral",
      sideEffect: false,
      safeImmediate: false,
      requiresWeb: true,
      title
    };
  }

  return {
    type: "chat",
    durability: "ephemeral",
    sideEffect: false,
    safeImmediate: false,
    requiresWeb: false,
    title
  };
}
