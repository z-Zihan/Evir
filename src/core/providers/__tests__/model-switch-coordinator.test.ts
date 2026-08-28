import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type MessageRecord, type ProviderRecord } from "../../storage/db";
import { ModelSwitchCoordinatorImpl } from "../model-switch-coordinator-impl";
import type { ModelSwitchRequest } from "../model-switching";

const source: ProviderRecord = {
  id: "source",
  name: "Source",
  protocolId: "openai-chat-completions",
  baseUrl: "https://source.example/v1",
  apiKey: "source-key",
  modelId: "source-model",
  modelCapabilities: { streaming: true, toolCalling: true, maxContextTokens: 128_000 },
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

function target(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    ...source,
    id: "target",
    name: "Target",
    baseUrl: "https://target.example/v1",
    apiKey: "target-key",
    modelId: "target-model",
    isDefault: false,
    ...overrides,
  };
}

function request(overrides: Partial<ModelSwitchRequest> = {}): ModelSwitchRequest {
  return {
    conversationId: "conversation-1",
    fromProviderId: "source",
    fromModelId: "source-model",
    toProviderId: "target",
    toModelId: "target-model",
    requestedAt: 1,
    mode: "agent",
    ...overrides,
  };
}

const userMessage: MessageRecord = {
  id: "message-1",
  conversationId: "conversation-1",
  role: "user",
  content: "Continue this task without losing constraints",
  status: "complete",
  createdAt: 1,
};

describe("ModelSwitchCoordinatorImpl", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.providers.put(source);
    await db.messages.put(userMessage);
  });

  it("requires confirmation for a cross-provider destination", async () => {
    await db.providers.put(target());
    const assessment = await new ModelSwitchCoordinatorImpl().assess(request());
    expect(assessment).toMatchObject({
      status: "requires-confirmation",
      requiresDataDestinationConfirmation: true,
      requiresModeDowngrade: false,
    });
  });

  it("keeps the default project task when the target can only chat", async () => {
    await db.providers.put(
      target({
        id: "source",
        modelId: "target-model",
        modelCapabilities: { streaming: true, toolCalling: false },
      }),
    );
    const assessment = await new ModelSwitchCoordinatorImpl().assess(
      request({ toProviderId: "source" }),
    );
    expect(assessment).toMatchObject({
      status: "switched",
      requiresDataDestinationConfirmation: false,
      requiresModeDowngrade: false,
    });
  });

  it("requires a downgrade when an explicit Plan or Goal cannot use tools", async () => {
    await db.providers.put(
      target({
        id: "source",
        modelId: "target-model",
        modelCapabilities: { streaming: true, toolCalling: false },
      }),
    );
    const coordinator = new ModelSwitchCoordinatorImpl();
    for (const mode of ["plan", "goal"] as const) {
      await expect(
        coordinator.assess(request({ toProviderId: "source", mode })),
      ).resolves.toMatchObject({
        status: "requires-confirmation",
        requiresModeDowngrade: true,
      });
    }
  });

  it("blocks active execution and target context overflow", async () => {
    await db.providers.put(target());
    const coordinator = new ModelSwitchCoordinatorImpl();
    await expect(coordinator.assess(request({ hasActiveExecution: true }))).resolves.toMatchObject({
      status: "blocked",
      blockReason: "active-tool-execution",
    });

    await db.providers.put(
      target({ modelCapabilities: { streaming: true, toolCalling: true, maxContextTokens: 2 } }),
    );
    await expect(coordinator.assess(request())).resolves.toMatchObject({
      status: "blocked",
      blockReason: "context-overflow",
      requiresContextCompaction: true,
    });
  });

  it("creates and persists a model-neutral handoff", async () => {
    await db.providers.put(
      target({
        id: "source",
        modelId: "target-model",
        modelCapabilities: { streaming: true, toolCalling: true },
      }),
    );
    const coordinator = new ModelSwitchCoordinatorImpl();
    const switchRequest = request({ toProviderId: "source" });
    const assessment = await coordinator.assess(switchRequest);
    const result = await coordinator.execute(switchRequest, assessment);

    expect(result.status).toBe("switched");
    expect(result.handoffMessage?.content).toContain("Model Handoff");
    expect(result.handoffMessage?.content).toContain("Continue this task");
    expect(await db.messages.get(result.handoffMessage?.id ?? "missing")).toMatchObject({
      role: "system",
    });
  });

  it("does not persist a handoff or checkpoint for a private session", async () => {
    await db.providers.put(
      target({
        id: "source",
        modelId: "target-model",
        modelCapabilities: { streaming: true, toolCalling: true },
      }),
    );
    const coordinator = new ModelSwitchCoordinatorImpl();
    const switchRequest = request({ toProviderId: "source", privateSession: true });
    const assessment = await coordinator.assess(switchRequest);
    const beforeMessages = await db.messages.count();
    const result = await coordinator.execute(switchRequest, assessment);

    expect(result).toEqual({ status: "switched" });
    expect(await db.messages.count()).toBe(beforeMessages);
    expect(await db.settings.get("checkpoint:conversation-1")).toBeUndefined();
  });
});
