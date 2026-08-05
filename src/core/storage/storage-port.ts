export type StorageLayer = "keychain" | "config" | "structured" | "artifact" | "temporary";

export type EntityName =
  | "providers"
  | "conversations"
  | "messages"
  | "agent_runs"
  | "tool_executions"
  | "memories"
  | "skills"
  | "mcp_servers"
  | "artifacts"
  | "backups"
  | "notifications"
  | "shortcuts"
  | "personalization"
  | "usage_records";

export interface StoragePort {
  read<T>(entity: EntityName, id: string): Promise<T | undefined>;
  readAll<T>(entity: EntityName): Promise<T[]>;
  write<T>(entity: EntityName, id: string, data: T): Promise<void>;
  delete(entity: EntityName, id: string): Promise<void>;
  query<T>(entity: EntityName, filter: Partial<T>): Promise<T[]>;
}

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
