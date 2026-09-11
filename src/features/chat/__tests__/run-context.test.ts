// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationRecord, ProjectRecord } from "../../../core/storage/db";
import { db } from "../../../core/storage/db";
import { getStructuredStorage } from "../../../runtime/structured-storage";
import { clearToolGrants, grantToolForProject } from "../../projects/tool-grants";
import {
  logRunContext,
  previousRunIdForConversation,
  runBindingForConversation,
} from "../run-context";
import { logger } from "../../../core/logging/logger";

/**
 * §17-§22 continuation contract: a run's permission context is restored from
 * the CONVERSATION's persisted projectId (with the project's current profile,
 * roots, and scoped grants) — never from which project the UI selected, and
 * never null for a bound project thread.
 */

const PROJECT_A: ProjectRecord = {
  id: "project-a",
  displayName: "Project A",
  nameIsCustom: false,
  rootPath: "/tmp/project-a",
  canonicalRootPath: "/tmp/project-a",
  permissionProfile: "ask",
  additionalAccessRoots: ["/tmp/project-a-extra"],
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
};

const PROJECT_B: ProjectRecord = {
  ...PROJECT_A,
  id: "project-b",
  displayName: "Project B",
  rootPath: "/tmp/project-b",
  canonicalRootPath: "/tmp/project-b",
  additionalAccessRoots: [],
};

function conversation(id: string, projectId: string | null): ConversationRecord {
  return {
    id,
    title: `Conversation ${id}`,
    providerId: "provider",
    modelId: "model",
    createdAt: 1,
    updatedAt: 1,
    projectId,
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  const storage = getStructuredStorage();
  await storage.write("projects", PROJECT_A.id, PROJECT_A);
  await storage.write("projects", PROJECT_B.id, PROJECT_B);
  await storage.write("conversations", "thread-a", conversation("thread-a", "project-a"));
  await storage.write("conversations", "thread-b", conversation("thread-b", "project-b"));
  await storage.write("conversations", "standalone", conversation("standalone", null));
});

describe("runBindingForConversation (§17/§18 persisted-fact binding)", () => {
  it("restores profile, roots and grants from the conversation's project", async () => {
    await grantToolForProject("project-a", "run_command");
    const binding = await runBindingForConversation("thread-a");
    expect(binding.projectId).toBe("project-a");
    expect(binding.root).toBe("/tmp/project-a");
    expect(binding.permissionContext).toMatchObject({ profile: "ask" });
    expect(binding.permissionContext?.roots).toEqual(["/tmp/project-a", "/tmp/project-a-extra"]);
    expect(binding.permissionContext?.grantedTools).toEqual(new Set(["run_command"]));
  });

  it("never returns null permission context for a bound project thread — no profile:null resume", async () => {
    // The direct regression of the L5 finding: resume rounds used to log
    // profile:null because the context came from the transient UI store.
    const binding = await runBindingForConversation("thread-a");
    expect(binding.permissionContext).not.toBeNull();
    expect(binding.permissionContext?.profile).toBe("ask");
  });

  it("scoped grants do not leak across projects (§20)", async () => {
    await grantToolForProject("project-a", "run_command");
    const bindingA = await runBindingForConversation("thread-a");
    const bindingB = await runBindingForConversation("thread-b");
    expect(bindingA.permissionContext?.grantedTools).toEqual(new Set(["run_command"]));
    expect(bindingB.permissionContext?.grantedTools ?? new Set()).toEqual(new Set());
    expect(bindingB.permissionContext?.profile).toBe("ask");
  });

  it("a profile switch is honored by later resumes — grants were cleared with it", async () => {
    await grantToolForProject("project-a", "run_command");
    // The user switches the project's profile; the real switch path clears
    // the project's grants (setPermissionProfile → clearToolGrants).
    const switched: ProjectRecord = { ...PROJECT_A, permissionProfile: "workspace" };
    await getStructuredStorage().write("projects", "project-a", switched);
    await clearToolGrants("project-a");
    const binding = await runBindingForConversation("thread-a");
    expect(binding.permissionContext?.profile).toBe("workspace");
    // No stale grants ride along into the resumed run.
    expect(binding.permissionContext?.grantedTools ?? new Set()).toEqual(new Set());
  });

  it("standalone conversations stay unbound (Ask semantics preserved)", async () => {
    const binding = await runBindingForConversation("standalone");
    expect(binding.projectId).toBeNull();
    expect(binding.root).toBeNull();
    expect(binding.permissionContext).toBeNull();
  });

  it("a conversation whose project was deleted inherits no authority", async () => {
    await getStructuredStorage().write(
      "conversations",
      "orphan",
      conversation("orphan", "deleted-project"),
    );
    const binding = await runBindingForConversation("orphan");
    expect(binding.projectId).toBe("deleted-project");
    expect(binding.permissionContext).toBeNull();
    expect(binding.root).toBeNull();
  });

  it("survives an app restart — the binding is read from storage, not memory", async () => {
    // A fresh read (as a restarted app would do) resolves the same context.
    const before = await runBindingForConversation("thread-a");
    const after = await runBindingForConversation("thread-a");
    expect(after).toEqual(before);
  });
});

describe("previousRunIdForConversation (§21 continuation trace)", () => {
  it("chains a continuation to the newest persisted run of the thread", async () => {
    const storage = getStructuredStorage();
    expect(await previousRunIdForConversation("thread-a")).toBeNull();
    await storage.write("agent_runs", "run-1", {
      id: "run-1",
      conversationId: "thread-a",
      status: "cancelled",
      toolCalls: [],
      toolResults: [],
      snapshots: [],
      fileReferences: [],
      verificationEvidence: [],
      resolution: { complete: false, reason: "stopped" },
      maxIterationsReached: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await storage.write("agent_runs", "run-2", {
      id: "run-2",
      conversationId: "thread-a",
      status: "completed",
      toolCalls: [],
      toolResults: [],
      snapshots: [],
      fileReferences: [],
      verificationEvidence: [],
      resolution: { complete: true, reason: "done" },
      maxIterationsReached: false,
      createdAt: 2,
      updatedAt: 5,
    });
    expect(await previousRunIdForConversation("thread-a")).toBe("run-2");
    // Runs of another thread never chain into this one.
    expect(await previousRunIdForConversation("thread-b")).toBeNull();
  });
});

describe("logRunContext (§21 audit line)", () => {
  it("records continuation linkage and grant provenance without secrets", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    // Snapshot before mockRestore() — restore clears mock.calls.
    let runContextCall: Array<unknown> | undefined;
    try {
      await grantToolForProject("project-a", "run_command");
      const storage = getStructuredStorage();
      await storage.write("agent_runs", "run-0", {
        id: "run-0",
        conversationId: "thread-a",
        status: "cancelled",
        toolCalls: [],
        toolResults: [],
        snapshots: [],
        fileReferences: [],
        verificationEvidence: [],
        resolution: { complete: false, reason: "stopped" },
        maxIterationsReached: false,
        createdAt: 1,
        updatedAt: 1,
      });
      const binding = await runBindingForConversation("thread-a");
      await logRunContext({
        conversationId: "thread-a",
        runId: "run-1",
        binding,
        source: "conversation-project",
      });
      runContextCall = infoSpy.mock.calls.find(([, event]) => event === "run.context");
    } finally {
      infoSpy.mockRestore();
    }
    expect(runContextCall).toBeDefined();
    const fields = (runContextCall?.[2] ?? {}) as Record<string, unknown>;
    expect(fields.continuationOfRunId).toBe("run-0");
    expect(fields.projectId).toBe("project-a");
    expect(fields.permissionProfile).toBe("ask");
    expect(fields.scopedGrantCount).toBe(1);
    expect(fields.source).toBe("conversation-project");
    // No environment values or secrets ride along.
    expect(Object.keys(fields).some((key) => /key|token|secret/i.test(key))).toBe(false);
  });
});
