import { describe, expect, it, vi } from "vitest";

const readMock = vi.fn();
const writeMock = vi.fn();

vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: () => ({ read: readMock, write: writeMock }),
}));

import {
  loadComponentConfiguration,
  normalizeComponentConfiguration,
  saveComponentConfiguration,
} from "../component-configuration";

describe("component configuration", () => {
  it("drops malformed entries instead of guessing", () => {
    expect(normalizeComponentConfiguration(null)).toEqual({});
    expect(normalizeComponentConfiguration([])).toEqual({});
    expect(normalizeComponentConfiguration("enabled")).toEqual({});
    expect(normalizeComponentConfiguration({ "evir.tools.x": { enabled: "yes" } })).toEqual({});
    expect(normalizeComponentConfiguration({ "evir.tools.x": null })).toEqual({});
    expect(
      normalizeComponentConfiguration({
        "evir.tools.x": { enabled: false },
        "evir.tools.y": { enabled: true, config: { extra: true } },
      }),
    ).toEqual({
      "evir.tools.x": { enabled: false },
      "evir.tools.y": { enabled: true },
    });
  });

  it("loads the stored map through structured storage", async () => {
    readMock.mockResolvedValue({
      name: "componentConfiguration",
      value: { "evir.tools.computer-use": { enabled: true } },
    });

    await expect(loadComponentConfiguration()).resolves.toEqual({
      "evir.tools.computer-use": { enabled: true },
    });
    expect(readMock).toHaveBeenCalledWith("settings", "componentConfiguration");
  });

  it("saves the whole map under the settings entity", async () => {
    writeMock.mockResolvedValue(undefined);

    await saveComponentConfiguration({ "evir.tools.computer-use": { enabled: false } });

    expect(writeMock).toHaveBeenCalledWith("settings", "componentConfiguration", {
      name: "componentConfiguration",
      value: { "evir.tools.computer-use": { enabled: false } },
    });
  });
});
