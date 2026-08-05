import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROVIDER_PRESETS } from "../providers/provider-presets";
import { MODE_TOOL_RISK_LIMITS } from "../providers/tool-registry";
import type { ProviderPreset } from "../providers/types";

const SRC_DIR = path.resolve(process.cwd(), "src");
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},]+from\s+)?["']([^"']+)["']/g;

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function importedModules(file: string): string[] {
  return [...withoutComments(fs.readFileSync(file, "utf8")).matchAll(IMPORT_PATTERN)].map(
    (match) => match[1] ?? "",
  );
}

function forbiddenImports(files: string[], isForbidden: (moduleName: string) => boolean): string[] {
  return files.flatMap((file) =>
    importedModules(file)
      .filter(isForbidden)
      .map((moduleName) => `${path.relative(SRC_DIR, file)} -> ${moduleName}`),
  );
}

const appFiles = sourceFiles(path.join(SRC_DIR, "app"));
const componentFiles = sourceFiles(path.join(SRC_DIR, "components"));
const coreFiles = sourceFiles(path.join(SRC_DIR, "core"));

describe("architecture dependency direction", () => {
  it("keeps Tauri APIs out of the UI layer", () => {
    const uiFiles = [...appFiles, ...componentFiles];
    expect(
      forbiddenImports(
        uiFiles,
        (moduleName) =>
          moduleName === "@tauri-apps/api" || moduleName.startsWith("@tauri-apps/api/"),
      ),
    ).toEqual([]);
  });

  it("keeps provider SDKs out of the app layer", () => {
    const providerSdks = ["openai", "@anthropic-ai/sdk"];
    expect(
      forbiddenImports(appFiles, (moduleName) =>
        providerSdks.some((sdk) => moduleName === sdk || moduleName.startsWith(`${sdk}/`)),
      ),
    ).toEqual([]);
  });

  it("keeps React out of core", () => {
    expect(
      forbiddenImports(
        coreFiles,
        (moduleName) => moduleName === "react" || moduleName.startsWith("react-dom"),
      ),
    ).toEqual([]);
  });

  it("keeps Tauri out of core", () => {
    expect(
      forbiddenImports(coreFiles, (moduleName) => moduleName.startsWith("@tauri-apps")),
    ).toEqual([]);
  });

  it("does not use the any type in source files", () => {
    const anyTypePattern = /(?:\bas\s+any\b|:\s*any\b)/;
    const violations = sourceFiles(SRC_DIR)
      .filter((file) => anyTypePattern.test(withoutComments(fs.readFileSync(file, "utf8"))))
      .map((file) => path.relative(SRC_DIR, file));

    expect(violations).toEqual([]);
  });

  it("provides the required typed provider presets", () => {
    const presets = PROVIDER_PRESETS satisfies readonly ProviderPreset[];
    const providerIds = presets.map(({ id }) => id);

    expect(providerIds).toEqual(
      expect.arrayContaining(["openai", "anthropic", "google-gemini", "deepseek", "zhipu"]),
    );
  });

  it("defines tool risk limits for every interaction mode", () => {
    expect(Object.keys(MODE_TOOL_RISK_LIMITS).sort()).toEqual(["agent", "ask", "plan"]);
  });
});
