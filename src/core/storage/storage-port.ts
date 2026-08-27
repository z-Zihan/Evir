export type StorageLayer = "keychain" | "config" | "structured" | "artifact" | "temporary";

export type EntityName =
  | "projects"
  | "providers"
  | "conversations"
  | "messages"
  | "attachments"
  | "agent_runs"
  | "task_briefs"
  | "plans"
  | "run_steps"
  | "run_events"
  | "agent_assignments"
  | "approvals"
  | "tool_executions"
  | "memories"
  | "skills"
  | "mcp_servers"
  | "artifacts"
  | "backups"
  | "notifications"
  | "shortcuts"
  | "personalization"
  | "usage_records"
  | "settings";

export interface StoragePort {
  read<T>(entity: EntityName, id: string): Promise<T | undefined>;
  readAll<T>(entity: EntityName): Promise<T[]>;
  write<T>(entity: EntityName, id: string, data: T): Promise<void>;
  writeMany<T>(entity: EntityName, data: T[]): Promise<void>;
  delete(entity: EntityName, id: string): Promise<void>;
  deleteMany(entity: EntityName, ids: string[]): Promise<void>;
  clear(entity: EntityName): Promise<void>;
  query<T>(entity: EntityName, filter: Partial<T>): Promise<T[]>;
  apply(mutations: StorageMutation[]): Promise<void>;
}

export type StorageMutation =
  | { type: "write"; entity: EntityName; id: string; data: object }
  | { type: "delete"; entity: EntityName; id: string }
  | { type: "clear"; entity: EntityName };

export interface ArtifactMetadata {
  id: string;
  path: string;
  hash: string;
  mimeType: string;
  size: number;
  createdAt: number;
  relatedEntityType: string;
  relatedEntityId: string;
}

export interface SchemaMigration {
  version: number;
  name: string;
  up: (db: unknown) => Promise<void>;
}

export interface MigrationPort {
  getCurrentVersion(): Promise<number>;
  migrate(targetVersion?: number): Promise<void>;
}

export interface PrivacySession {
  conversationId: string;
  ephemeral: true;
  expiresAt?: number;
}
