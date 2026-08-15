// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const addServer = vi.fn();
const updateServer = vi.fn();
const removeServer = vi.fn();
const restartServer = vi.fn();
const testServer = vi.fn();
const executeApprovedTestTool = vi.fn();
let runtimeSnapshots: Record<string, unknown> = {};
let connectionTests: Record<string, unknown> = {};
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
  url?: string;
  headerSecretRefs?: Record<string, string>;
}> = [];

vi.mock("../../features/mcp/mcp-store", () => ({
  useMcpStore: () => ({
    servers,
    runtimeSnapshots,
    connectionTests,
    loadServers: vi.fn().mockResolvedValue(undefined),
    addServer,
    updateServer,
    removeServer,
    toggleServer: vi.fn(),
    restartServer,
    testServer,
    executeApprovedTestTool,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  servers = [];
  runtimeSnapshots = {};
  connectionTests = {};
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

  it("requires confirmation before deleting a server", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "mcp.delete" }));
    expect(removeServer).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "mcp.delete" }),
    );
    await waitFor(() => expect(removeServer).toHaveBeenCalledWith("mcp-1"));
  });

  it("tests a disabled server without enabling it", async () => {
    servers = [
      {
        id: "mcp-1",
        name: "Filesystem",
        transport: "stdio",
        enabled: false,
        command: "node",
        args: ["fixture.mjs"],
        envSecretRefs: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    testServer.mockResolvedValue(undefined);
    const { McpSettings } = await import("../McpSettings");
    render(<McpSettings />);
    await waitFor(() => expect(screen.getByText("Filesystem")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "mcp.testConnection" }));

    await waitFor(() => expect(testServer).toHaveBeenCalledWith("mcp-1"));
  });

  it("inspects and explicitly approves a ready MCP tool test", async () => {
    servers = [
      {
        id: "mcp-1",
        name: "Fixture",
        transport: "stdio",
        enabled: true,
        command: "node",
        args: ["fixture.mjs"],
        envSecretRefs: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    runtimeSnapshots = {
      "mcp-1": {
        serverId: "mcp-1",
        state: "ready",
        tools: [
          {
            name: "fixture_echo",
            description: "Echo text",
            inputSchema: { type: "object" },
          },
        ],
      },
    };
    executeApprovedTestTool.mockResolvedValue({ success: true, output: "hello" });
    const { McpSettings } = await import("../McpSettings");
    render(<McpSettings />);
    await waitFor(() => expect(screen.getByText("Fixture")).toBeDefined());

    fireEvent.click(screen.getByText("mcp.inspectTools"));
    fireEvent.change(screen.getByLabelText("mcp.testArguments"), {
      target: { value: '{"text":"hello"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "mcp.testTool" }));
    expect(executeApprovedTestTool).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "mcp.runTest" }),
    );

    await waitFor(() =>
      expect(executeApprovedTestTool).toHaveBeenCalledWith("mcp-1", "fixture_echo", {
        text: "hello",
      }),
    );
    expect(screen.getByText("hello")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "mcp.restart" }));
    expect(restartServer).toHaveBeenCalledWith("mcp-1");
    expect(screen.queryByText("hello")).toBeNull();
  });

  it("discloses the remote destination and disables smart text substitutions", async () => {
    servers = [
      {
        id: "mcp-http",
        name: "Remote fixture",
        transport: "streamable-http",
        enabled: true,
        command: "",
        args: [],
        envSecretRefs: {},
        url: "https://mcp.example.test/rpc",
        headerSecretRefs: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    runtimeSnapshots = {
      "mcp-http": {
        serverId: "mcp-http",
        state: "ready",
        tools: [{ name: "remote_echo", inputSchema: { type: "object" } }],
      },
    };
    const { McpSettings } = await import("../McpSettings");
    render(<McpSettings />);
    await waitFor(() => expect(screen.getByText("Remote fixture")).toBeDefined());

    fireEvent.click(screen.getByText("mcp.inspectTools"));
    const input = screen.getByLabelText("mcp.testArguments");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "mcp.testTool" }));

    expect(
      within(screen.getByRole("alertdialog")).getByText(/mcp\.testToolRemoteDestination/),
    ).toBeDefined();
  });
});
