import type {
  TopicClassification,
  TopicDurability,
  TopicType
} from "./topicClassifier.js";

export type TopicStatus =
  | "active"
  | "pending"
  | "paused"
  | "blocked"
  | "done"
  | "cancelled"
  | "awaiting_switch_decision";

export interface TopicContextSnapshot {
  id: string;
  type: TopicType;
  durability: TopicDurability;
  status: TopicStatus;
  title: string;
  summary: string;
  lastUserIntent: string;
  workdir: string;
  createdAt: string;
  updatedAt: string;
  codexThreadId: string | null;
  lastError: string | null;
}

export interface PendingSwitchSnapshot {
  incomingText: string;
  inferredType: TopicType;
  inferredDurability: TopicDurability;
  inferredTitle: string;
  sideEffect: boolean;
  requiresWeb: boolean;
  receivedAt: string;
}

export interface ProjectTopicSnapshot {
  activeTopicId: string | null;
  topics: TopicContextSnapshot[];
  pendingSwitch: PendingSwitchSnapshot | null;
}

export interface ChatTopicSnapshot {
  projects: Record<string, ProjectTopicSnapshot>;
}

export interface TopicHarnessSnapshot {
  chats: Record<string, ChatTopicSnapshot>;
}

export interface EvaluateIncomingInput {
  chatId: string | number;
  workdir: string;
  text: string;
  classification: TopicClassification;
  sameTopic?: boolean;
}

export type TopicGateResult =
  | {
      action: "process";
      topic: TopicContextSnapshot | null;
      classification: TopicClassification;
    }
  | {
      action: "ask_switch";
      activeTopic: TopicContextSnapshot;
      pendingSwitch: PendingSwitchSnapshot;
      classification: TopicClassification;
    };

interface TopicHarnessOptions {
  now?: () => Date;
  onChange?: () => void;
}

function emptyProject(): ProjectTopicSnapshot {
  return {
    activeTopicId: null,
    topics: [],
    pendingSwitch: null
  };
}

function cloneProject(project: ProjectTopicSnapshot): ProjectTopicSnapshot {
  return {
    activeTopicId: project.activeTopicId,
    topics: project.topics.map((topic) => ({ ...topic })),
    pendingSwitch: project.pendingSwitch ? { ...project.pendingSwitch } : null
  };
}

function shouldPersistAsActive(classification: TopicClassification): boolean {
  return classification.durability === "durable";
}

function durableForStoredContext(
  classification: TopicClassification
): TopicDurability {
  return classification.durability === "durable" ? "durable" : "durable";
}

export class TopicHarness {
  private readonly chats: Map<string, Map<string, ProjectTopicSnapshot>>;
  private readonly now: () => Date;
  private readonly onChange?: () => void;

  constructor(options: TopicHarnessOptions = {}) {
    this.chats = new Map();
    this.now = options.now || (() => new Date());
    this.onChange = options.onChange;
  }

  evaluateIncoming(input: EvaluateIncomingInput): TopicGateResult {
    const project = this.ensureProject(input.chatId, input.workdir);
    const activeTopic = this.getActiveTopicFromProject(project);

    if (input.classification.safeImmediate) {
      return {
        action: "process",
        topic: null,
        classification: input.classification
      };
    }

    if (!activeTopic) {
      const topic = shouldPersistAsActive(input.classification)
        ? this.createTopic(
            project,
            input,
            "active",
            input.classification.durability
          )
        : null;
      if (topic) {
        project.activeTopicId = topic.id;
        this.changed();
      }
      return {
        action: "process",
        topic,
        classification: input.classification
      };
    }

    if (input.sameTopic) {
      activeTopic.lastUserIntent = input.text;
      activeTopic.updatedAt = this.timestamp();
      this.changed();
      return {
        action: "process",
        topic: activeTopic,
        classification: input.classification
      };
    }

    const pendingSwitch = this.buildPendingSwitch(input);
    project.pendingSwitch = pendingSwitch;
    this.changed();
    return {
      action: "ask_switch",
      activeTopic,
      pendingSwitch,
      classification: input.classification
    };
  }

  queuePendingSwitch(
    chatId: string | number,
    workdir: string
  ): TopicContextSnapshot {
    const project = this.ensureProject(chatId, workdir);
    const pending = this.requirePendingSwitch(project);
    const topic = this.createTopicFromPending(
      project,
      workdir,
      pending,
      "pending"
    );
    project.pendingSwitch = null;
    this.changed();
    return topic;
  }

  pauseAndSwitch(
    chatId: string | number,
    workdir: string
  ): TopicContextSnapshot {
    const project = this.ensureProject(chatId, workdir);
    const pending = this.requirePendingSwitch(project);
    const active = this.getActiveTopicFromProject(project);
    if (active) {
      active.status = "paused";
      active.updatedAt = this.timestamp();
    }

    const topic = this.createTopicFromPending(
      project,
      workdir,
      pending,
      "active"
    );
    project.activeTopicId = topic.id;
    project.pendingSwitch = null;
    this.changed();
    return topic;
  }

  closeAndSwitch(
    chatId: string | number,
    workdir: string
  ): TopicContextSnapshot {
    const project = this.ensureProject(chatId, workdir);
    const pending = this.requirePendingSwitch(project);
    const active = this.getActiveTopicFromProject(project);
    if (active) {
      active.status = "done";
      active.updatedAt = this.timestamp();
    }

    const topic = this.createTopicFromPending(
      project,
      workdir,
      pending,
      "active"
    );
    project.activeTopicId = topic.id;
    project.pendingSwitch = null;
    this.changed();
    return topic;
  }

  pauseActive(
    chatId: string | number,
    workdir: string
  ): TopicContextSnapshot | null {
    const project = this.ensureProject(chatId, workdir);
    const active = this.getActiveTopicFromProject(project);
    if (!active) return null;

    active.status = "paused";
    active.updatedAt = this.timestamp();
    project.activeTopicId = null;
    this.changed();
    return active;
  }

  doneActive(
    chatId: string | number,
    workdir: string
  ): TopicContextSnapshot | null {
    const project = this.ensureProject(chatId, workdir);
    const active = this.getActiveTopicFromProject(project);
    if (!active) return null;

    active.status = "done";
    active.updatedAt = this.timestamp();
    project.activeTopicId = null;
    this.changed();
    return active;
  }

  dropTopic(
    chatId: string | number,
    workdir: string,
    topicId: string
  ): TopicContextSnapshot {
    const project = this.ensureProject(chatId, workdir);
    const topic = this.requireTopic(project, topicId);
    topic.status = "cancelled";
    topic.updatedAt = this.timestamp();
    if (project.activeTopicId === topic.id) {
      project.activeTopicId = null;
    }
    this.changed();
    return topic;
  }

  recordThreadId(
    chatId: string | number,
    workdir: string,
    topicId: string,
    threadId: string
  ): void {
    const project = this.ensureProject(chatId, workdir);
    const topic = this.requireTopic(project, topicId);
    topic.codexThreadId = threadId;
    topic.updatedAt = this.timestamp();
    this.changed();
  }

  getProject(chatId: string | number, workdir: string): ProjectTopicSnapshot {
    return this.ensureProject(chatId, workdir);
  }

  exportState(): TopicHarnessSnapshot {
    const chats: TopicHarnessSnapshot["chats"] = {};

    for (const [chatId, projects] of this.chats.entries()) {
      chats[chatId] = {
        projects: {}
      };

      for (const [workdir, project] of projects.entries()) {
        chats[chatId].projects[workdir] = cloneProject(project);
      }
    }

    return {
      chats
    };
  }

  restoreState(snapshot: Partial<TopicHarnessSnapshot> = {}): void {
    this.chats.clear();

    if (!snapshot.chats || typeof snapshot.chats !== "object") {
      return;
    }

    for (const [chatId, rawChat] of Object.entries(snapshot.chats)) {
      const projects = new Map<string, ProjectTopicSnapshot>();
      const rawProjects = rawChat?.projects || {};

      for (const [workdir, rawProject] of Object.entries(rawProjects)) {
        projects.set(workdir, {
          activeTopicId:
            typeof rawProject?.activeTopicId === "string"
              ? rawProject.activeTopicId
              : null,
          topics: Array.isArray(rawProject?.topics)
            ? rawProject.topics.map((topic) => ({
                ...topic,
                codexThreadId: topic.codexThreadId || null,
                lastError: topic.lastError || null
              }))
            : [],
          pendingSwitch: rawProject?.pendingSwitch
            ? { ...rawProject.pendingSwitch }
            : null
        });
      }

      this.chats.set(chatId, projects);
    }
  }

  private ensureProject(
    chatId: string | number,
    workdir: string
  ): ProjectTopicSnapshot {
    const chatKey = String(chatId);
    let projects = this.chats.get(chatKey);
    if (!projects) {
      projects = new Map();
      this.chats.set(chatKey, projects);
    }

    let project = projects.get(workdir);
    if (!project) {
      project = emptyProject();
      projects.set(workdir, project);
    }

    return project;
  }

  private getActiveTopicFromProject(
    project: ProjectTopicSnapshot
  ): TopicContextSnapshot | null {
    if (!project.activeTopicId) return null;
    return (
      project.topics.find((topic) => topic.id === project.activeTopicId) || null
    );
  }

  private createTopic(
    project: ProjectTopicSnapshot,
    input: EvaluateIncomingInput,
    status: TopicStatus,
    durability: TopicDurability
  ): TopicContextSnapshot {
    const now = this.timestamp();
    const topic: TopicContextSnapshot = {
      id: this.nextTopicId(project),
      type: input.classification.type,
      durability,
      status,
      title: input.classification.title,
      summary: "",
      lastUserIntent: input.text,
      workdir: input.workdir,
      createdAt: now,
      updatedAt: now,
      codexThreadId: null,
      lastError: null
    };
    project.topics.push(topic);
    return topic;
  }

  private createTopicFromPending(
    project: ProjectTopicSnapshot,
    workdir: string,
    pending: PendingSwitchSnapshot,
    status: TopicStatus
  ): TopicContextSnapshot {
    const now = this.timestamp();
    const topic: TopicContextSnapshot = {
      id: this.nextTopicId(project),
      type: pending.inferredType,
      durability: durableForStoredContext({
        type: pending.inferredType,
        durability: pending.inferredDurability,
        sideEffect: pending.sideEffect,
        safeImmediate: false,
        requiresWeb: pending.requiresWeb,
        title: pending.inferredTitle
      }),
      status,
      title: pending.inferredTitle,
      summary: "",
      lastUserIntent: pending.incomingText,
      workdir,
      createdAt: now,
      updatedAt: now,
      codexThreadId: null,
      lastError: null
    };
    project.topics.push(topic);
    return topic;
  }

  private buildPendingSwitch(
    input: EvaluateIncomingInput
  ): PendingSwitchSnapshot {
    return {
      incomingText: input.text,
      inferredType: input.classification.type,
      inferredDurability: input.classification.durability,
      inferredTitle: input.classification.title,
      sideEffect: input.classification.sideEffect,
      requiresWeb: input.classification.requiresWeb,
      receivedAt: this.timestamp()
    };
  }

  private requirePendingSwitch(
    project: ProjectTopicSnapshot
  ): PendingSwitchSnapshot {
    if (!project.pendingSwitch) {
      throw new Error("No pending context switch request.");
    }
    return project.pendingSwitch;
  }

  private requireTopic(
    project: ProjectTopicSnapshot,
    topicId: string
  ): TopicContextSnapshot {
    const topic = project.topics.find((entry) => entry.id === topicId);
    if (!topic) {
      throw new Error(`Unknown topic context: ${topicId}`);
    }
    return topic;
  }

  private nextTopicId(project: ProjectTopicSnapshot): string {
    const next = project.topics.length + 1;
    return `T${String(next).padStart(3, "0")}`;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private changed(): void {
    this.onChange?.();
  }
}
