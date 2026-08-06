// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const addServer = vi.fn();
const updateServer = vi.fn();
let servers: Array<{
  id: string;
  name: string;
  transport: "stdio" | "streamable-http";
  enabled: boolean;
  command: string;
  args: string[];
  envSecretRefs: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}> = [];

vi.mock("../../features/mcp/mcp-store", () => ({
  useMcpStore: () => ({
    servers,
    loadServers: vi.fn().mockResolvedValue(undefined),
    addServer,
    updateServer,
    removeServer: vi.fn(),
    toggleServer: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  servers = [];
});

describe("McpSettings", () => {
  it("adds servers from a modal and validates transport-specific fields", async () => {
    const { McpSettings } = await import("../McpSettings");
    render(<McpSettings />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "mcp.add" }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "mcp.add" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "mcp.save" }));
    expect(screen.getAllByText("mcp.required")).toHaveLength(2);
    expect(addServer).not.toHaveBeenCalled();
  });

  it("edits an existing server", async () => {
    servers = [
      {
        id: "mcp-1",
        name: "Filesystem",
        transport: "stdio",
        enabled: false,
        command: "npx",
        args: ["-y", "server-filesystem"],
        envSecretRefs: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const { McpSettings } = await import("../McpSettings");
    render(<McpSettings />);
    await waitFor(() => expect(screen.getByText("Filesystem")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "mcp.edit" }));
    fireEvent.change(screen.getByDisplayValue("Filesystem"), { target: { value: "Files" } });
    fireEvent.click(screen.getByRole("button", { name: "mcp.saveChanges" }));
    expect(updateServer).toHaveBeenCalledWith("mcp-1", expect.objectContaining({ name: "Files" }));
  });
});
