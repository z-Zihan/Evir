import { describe, expect, it } from "vitest";
import { isSettingsTabAvailable } from "../settings-navigation";

describe("settings runtime boundary", () => {
  it("keeps native MCP and browser controls out of Web settings", () => {
    expect(isSettingsTabAvailable("mcp", "web")).toBe(false);
    expect(isSettingsTabAvailable("browser", "web")).toBe(false);
  });

  it("keeps native MCP and browser controls discoverable on Desktop", () => {
    expect(isSettingsTabAvailable("mcp", "desktop")).toBe(true);
    expect(isSettingsTabAvailable("browser", "desktop")).toBe(true);
  });
});
