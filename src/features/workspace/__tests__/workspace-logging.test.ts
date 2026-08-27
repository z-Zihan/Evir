// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { logger } from "../../../core/logging/logger";
import { useWorkspaceStore } from "../workspace-store";

beforeEach(() => {
  localStorage.clear();
  logger.clear();
  useWorkspaceStore.setState({ currentWorkspace: null, recentWorkspaces: [] });
});

describe("workspace diagnostics", () => {
  it("records selection and load state without exposing paths", () => {
    const privatePath = "/private/workspace/PRIVATE_PATH_MARKER";
    useWorkspaceStore.getState().setWorkspace(privatePath);
    useWorkspaceStore.getState().loadWorkspace();

    expect(logger.getEntries().map(({ event }) => event)).toEqual(
      expect.arrayContaining(["workspace.selected", "workspace.loaded"]),
    );
    expect(logger.exportLogs()).not.toContain(privatePath);
    expect(logger.getEntries().at(-1)).toMatchObject({
      data: { hasCurrentWorkspace: true, recentWorkspaceCount: 1 },
    });
  });
});
