import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROVIDER_PRESETS } from "../providers/provider-presets";
import { MODE_TOOL_RISK_LIMITS } from "../providers/tool-registry";
import type { ProviderPreset } from "../providers/types";

const SRC_DIR = path.resolve(process.cwd(), "src");
// Static imports/exports AND dynamic import("...") — a dynamic import is the
// classic way to slip an infrastructure dependency past a static-only scan.
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},]+from\s+)?["']([^"']+)["']|(?:^|\n)\s*import\s*\(\s*["']([^"']+)["']\s*\)/g;

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
    (match) => match[1] ?? match[2] ?? "",
  );
}

function forbiddenImports(files: string[], isForbidden: (moduleName: string) => boolean): string[] {
  return files.flatMap((file) =>
    importedModules(file)
      .filter(isForbidden)
      .map((moduleName) => `${path.relative(SRC_DIR, file)} -> ${moduleName}`),
  );
}

function translationKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, nestedValue]) =>
    translationKeys(nestedValue, prefix ? `${prefix}.${key}` : key),
  );
}

const appFiles = sourceFiles(path.join(SRC_DIR, "app"));
// UI includes core/components (the shared component layer); there is no
// top-level src/components directory.
const componentFiles = sourceFiles(path.join(SRC_DIR, "core", "components"));
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
    expect(Object.keys(MODE_TOOL_RISK_LIMITS).sort()).toEqual(["agent", "ask", "goal", "plan"]);
  });

  it("provides mode and personalization translations in every locale", () => {
    const requiredKeys = [
      "chat.modes.ask",
      "chat.modes.plan",
      "chat.modes.goal",
      "chat.modes.agent",
      "chat.modes.askDesc",
      "chat.modes.planDesc",
      "chat.modes.goalDesc",
      "chat.modes.agentDesc",
      "chat.modeHints.agent",
      "chat.modeHints.plan",
      "chat.switchModel",
      "chat.currentModel",
      "chat.regenerate",
      "chat.edit",
      "chat.save",
      "chat.cancel",
      "tools.title",
      "tools.arguments",
      "tools.result",
      "tools.success",
      "tools.failed",
      "tools.permissionRequired",
      "tools.approve",
      "tools.deny",
      "tools.notAvailable",
      "tools.maxIterations",
      "tools.executing",
      "tools.denied",
      "tools.deniedMessage",
      "tools.read_file",
      "tools.list_directory",
      "tools.write_file",
      "personalization.title",
      "personalization.enable",
      "personalization.displayName",
      "personalization.responseLanguage",
      "personalization.detailLevel",
      "personalization.style",
      "personalization.customInstructions",
      "personalization.save",
      "personalization.reset",
      "personalization.followApp",
      "personalization.english",
      "personalization.chinese",
      "personalization.concise",
      "personalization.balanced",
      "personalization.detailed",
      "personalization.professional",
      "personalization.casual",
      "personalization.academic",
      "personalization.loadError",
      "personalization.saveError",
      "shortcuts.newConversation",
      "shortcuts.openSettings",
      "shortcuts.toggleSidebar",
      "shortcuts.sendMessage",
      "shortcuts.stopCurrentRun",
      "shortcuts.shortcutHelp",
      "shortcuts.comingSoon",
      "skill.title",
      "skill.enabled",
      "skill.disabled",
      "skill.enable",
      "skill.disable",
      "skill.riskLevel",
      "skill.noSkills",
      "skill.builtin",
      "skill.low",
      "skill.medium",
      "skill.high",
      "mcp.title",
      "mcp.add",
      "mcp.name",
      "mcp.transport",
      "mcp.stdio",
      "mcp.streamableHttp",
      "mcp.command",
      "mcp.arguments",
      "mcp.workingDirectory",
      "mcp.url",
      "mcp.headers",
      "mcp.enabled",
      "mcp.disabled",
      "mcp.enable",
      "mcp.disable",
      "mcp.delete",
      "mcp.noServers",
      "mcp.desktopOnly",
      "mcp.securityNotice",
      "mcp.save",
      "mcp.cancel",
      "privacy.title",
      "privacy.clearConversations",
      "privacy.clearProviders",
      "privacy.clearUsage",
      "privacy.clearMcp",
      "privacy.clearAll",
      "privacy.confirmClear",
      "privacy.cleared",
      "privacy.clearFailed",
      "about.title",
      "about.version",
      "about.description",
      "about.github",
      "about.license",
      "about.notDeclared",
      "diagnostics.createEvidenceMarker",
      "diagnostics.evidenceMarkerCreated",
    ];

    for (const locale of ["en.json", "zh-CN.json"]) {
      const localePath = path.join(SRC_DIR, "i18n", "locales", locale);
      const keys = translationKeys(JSON.parse(fs.readFileSync(localePath, "utf8")));
      expect(keys, locale).toEqual(expect.arrayContaining(requiredKeys));
    }
  });
});
