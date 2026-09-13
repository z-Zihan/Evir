// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory per-profile structured storage double.
const entityStore = new Map<string, Map<string, unknown>>();
function entity(name: string): Map<string, unknown> {
  let table = entityStore.get(name);
  if (!table) {
    table = new Map<string, unknown>();
    entityStore.set(name, table);
  }
  return table;
}

// PLUG-2: desktop skill-folder read double (normally the Rust command).
const skillFiles = new Map<
  string,
  Array<{ id: string; skillMd: string; manifestJson: string | null; truncated: boolean }>
>();
vi.mock("../../../runtime/tauri-ipc", () => ({
  tauriInvoke: (command: string, args: { folder?: string }) => {
    if (command === "plugin_read_skills") {
      const files = skillFiles.get(args.folder ?? "");
      if (!files) return Promise.reject(new Error("plugin folder does not exist"));
      return Promise.resolve(files);
    }
    return Promise.reject(new Error(`unexpected command: ${command}`));
  },
}));

vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: () => ({
    read: (_e: string, id: string) => Promise.resolve(entity(_e).get(id)),
    readAll: () => Promise.resolve([...entity("plugins").values()]),
    write: (_e: string, id: string, data: unknown) => Promise.resolve(entity(_e).set(id, data)),
    delete: (_e: string, id: string) => Promise.resolve(entity(_e).delete(id)),
  }),
}));

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({
    target: "web" as const,
    capabilities: new Set<string>(),
    has: () => false,
    selectWorkspaceDirectory: undefined,
  }),
}));

const { usePluginStore } = await import("../plugin-store");
const { usePluginContributionStore } = await import("../plugin-contributions");
const { useSkillStore } = await import("../../skills/skill-store");

function validManifest() {
  return {
    schemaVersion: 1 as const,
    id: "demo-plugin",
    name: "Demo Plugin",
    version: "1.0.0",
    description: "A safe test plugin",
    author: "Evir Test",
    contributes: {
      slashCommands: [
        {
          id: "deploy",
          description: "Deploy the site",
          promptTemplate: "Deploy the site to production",
        },
      ],
      skills: [
        {
          id: "release-checklist",
          name: "Release Checklist",
          description: "Checklist before release",
          content: "1. Run tests\n2. Tag release",
        },
      ],
      settings: [
        { key: "verbose", label: "Verbose logging", type: "boolean" as const, default: false },
      ],
    },
  };
}

beforeEach(() => {
  entityStore.clear();
  skillFiles.clear();
  usePluginStore.setState({ plugins: [], loaded: false });
  usePluginContributionStore.getState().replaceSlashCommands([]);
});

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("plugin store v1", () => {
  it("installs a valid manifest, derives permissions, publishes contributions", async () => {
    const record = await usePluginStore.getState().install(validManifest(), "/plugins/demo");

    expect(record.permissions).toEqual(["slash-commands", "skills", "settings"]);
    expect(record.enabled).toBe(true);

    // Slash contribution live in the palette store (§48).
    const commands = usePluginContributionStore.getState().slashCommands;
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ pluginId: "demo-plugin", id: "deploy" });

    // Skill contribution merged into the skill catalog (§42).
    const skills = useSkillStore.getState().skills;
    expect(skills.some((skill) => skill.manifest.id === "demo-plugin--release-checklist")).toBe(
      true,
    );

    // Persisted to the per-profile plugins entity (§46: profile-scoped by
    // construction — the entity store IS the profile namespace).
    expect(entity("plugins").get("demo-plugin")).toBeTruthy();
  });

  it("rejects invalid manifests at parse time (schema validation)", async () => {
    const { pluginManifestSchema } = await import("../plugin-types");
    const bad = { ...validManifest(), id: "../escape" };
    expect(pluginManifestSchema.safeParse(bad).success).toBe(false);
    const badVersion = { ...validManifest(), version: "not semver" };
    expect(pluginManifestSchema.safeParse(badVersion).success).toBe(false);
  });

  it("disabling a plugin removes its contributions; enabling restores them", async () => {
    await usePluginStore.getState().install(validManifest(), "/plugins/demo");
    expect(usePluginContributionStore.getState().slashCommands).toHaveLength(1);

    await usePluginStore.getState().setEnabled("demo-plugin", false);
    expect(usePluginContributionStore.getState().slashCommands).toHaveLength(0);
    expect(
      useSkillStore
        .getState()
        .skills.some((s) => s.manifest.id === "demo-plugin--release-checklist"),
    ).toBe(false);
    expect(usePluginStore.getState().plugins[0]?.enabled).toBe(false);

    await usePluginStore.getState().setEnabled("demo-plugin", true);
    expect(usePluginContributionStore.getState().slashCommands).toHaveLength(1);
  });

  it("uninstalling removes record, settings and contributions", async () => {
    await usePluginStore.getState().install(validManifest(), "/plugins/demo");
    await usePluginStore.getState().setSetting("demo-plugin", "verbose", true);
    expect(entity("settings").get("plugin:demo-plugin")).toBeTruthy();

    await usePluginStore.getState().uninstall("demo-plugin");
    expect(usePluginStore.getState().plugins).toHaveLength(0);
    expect(entity("plugins").get("demo-plugin")).toBeUndefined();
    expect(entity("settings").get("plugin:demo-plugin")).toBeUndefined();
    expect(usePluginContributionStore.getState().slashCommands).toHaveLength(0);
  });

  it("flags newly granted permissions on reinstall (no silent escalation)", async () => {
    const { permissionDiff, effectivePermissions } = await import("../plugin-types");
    const first = validManifest();
    expect(effectivePermissions(first)).toEqual(["slash-commands", "skills", "settings"]);
    // First install had only a slash command; adding skills must surface as new.
    const previous = ["slash-commands"] as const;
    expect(permissionDiff(previous, effectivePermissions(first))).toEqual(["skills", "settings"]);
    expect(
      permissionDiff(["slash-commands", "skills", "settings"], effectivePermissions(first)),
    ).toEqual([]);
  });

  it("runs a slash command by dispatching the declarative template event", async () => {
    await usePluginStore.getState().install(validManifest(), "/plugins/demo");
    const listener = vi.fn<(event: CustomEvent<{ template?: string }>) => void>();
    window.addEventListener("evir:plugin-command", listener as unknown as EventListener);
    void usePluginContributionStore.getState().slashCommands[0]!.run();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].detail.template).toBe("Deploy the site to production");
    window.removeEventListener("evir:plugin-command", listener as unknown as EventListener);
  });

  it("skill content flows through getSkillContent for selected plugin skills", async () => {
    await usePluginStore.getState().install(validManifest(), "/plugins/demo");
    const content = await useSkillStore
      .getState()
      .getSkillContent(new Set(["demo-plugin--release-checklist"]));
    expect(content).toContain("Release Checklist");
    expect(content).toContain("Tag release");
  });

  it("drops corrupted persisted records instead of loading them", async () => {
    entity("plugins").set("broken", { id: "broken", nope: true });
    await usePluginStore.getState().load();
    expect(usePluginStore.getState().plugins.map((plugin) => plugin.id)).toEqual([]);
  });

  it("PLUG-1: boolean, string, number and select settings round-trip with typed reads", async () => {
    const { pluginManifestSchema } = await import("../plugin-types");
    const manifest = {
      ...validManifest(),
      contributes: {
        ...validManifest().contributes,
        settings: [
          { key: "verbose", label: "Verbose", type: "boolean" as const, default: false },
          { key: "theme", label: "Theme", type: "string" as const, default: "light" },
          { key: "retries", label: "Retries", type: "number" as const, default: 3 },
          {
            key: "mode",
            label: "Mode",
            type: "select" as const,
            default: "fast",
            options: ["fast", "safe"],
          },
        ],
      },
    };
    expect(pluginManifestSchema.safeParse(manifest).success).toBe(true);
    await usePluginStore.getState().install(manifest, "/plugins/typed");

    await usePluginStore.getState().setSetting(manifest.id, "verbose", true);
    await usePluginStore.getState().setSetting(manifest.id, "theme", "dark");
    await usePluginStore.getState().setSetting(manifest.id, "retries", 7);
    await usePluginStore.getState().setSetting(manifest.id, "mode", "safe");

    expect(await usePluginStore.getState().getSetting(manifest.id, "verbose", false)).toBe(true);
    expect(await usePluginStore.getState().getSetting(manifest.id, "theme", "light")).toBe("dark");
    expect(await usePluginStore.getState().getSetting(manifest.id, "retries", 3)).toBe(7);
    expect(await usePluginStore.getState().getSetting(manifest.id, "mode", "fast")).toBe("safe");

    // Fallback when the stored type no longer matches the declared one.
    entity("settings").set(`plugin:${manifest.id}`, {
      name: `plugin:${manifest.id}`,
      value: { retries: "not-a-number" },
    });
    expect(await usePluginStore.getState().getSetting(manifest.id, "retries", 3)).toBe(3);
  });

  it("PLUG-1: schema rejects select without options, default outside options, and mismatched types", async () => {
    const { pluginManifestSchema } = await import("../plugin-types");
    const base = validManifest();
    const noOptions = {
      ...base,
      contributes: {
        ...base.contributes,
        settings: [{ key: "m", label: "Mode", type: "select", default: "a" }],
      },
    };
    expect(pluginManifestSchema.safeParse(noOptions).success).toBe(false);

    const defaultOutside = {
      ...base,
      contributes: {
        ...base.contributes,
        settings: [
          { key: "m", label: "Mode", type: "select", default: "zzz", options: ["a", "b"] },
        ],
      },
    };
    expect(pluginManifestSchema.safeParse(defaultOutside).success).toBe(false);

    const mismatchedDefault = {
      ...base,
      contributes: {
        ...base.contributes,
        settings: [{ key: "n", label: "N", type: "number", default: "3" }],
      },
    };
    expect(pluginManifestSchema.safeParse(mismatchedDefault).success).toBe(false);

    const unknownType = {
      ...base,
      contributes: {
        ...base.contributes,
        settings: [{ key: "x", label: "X", type: "json", default: {} }],
      },
    };
    expect(pluginManifestSchema.safeParse(unknownType).success).toBe(false);
  });

  it("PLUG-1: setSetting rejects out-of-contract values", async () => {
    await usePluginStore.getState().install(validManifest(), "/plugins/demo");
    await expect(
      usePluginStore.getState().setSetting("demo-plugin", "verbose", { hack: true } as never),
    ).rejects.toThrow(/boolean, string, or number/);
    await expect(
      usePluginStore.getState().setSetting("demo-plugin", "verbose", Number.NaN),
    ).rejects.toThrow(/finite/);
  });

  it("PLUG-1: uninstall removes the record but never touches the source folder", async () => {
    // Uninstall deletes the plugin record + settings + contributions only;
    // the on-disk source folder is the user's data and stays untouched
    // (sourcePath is a recorded string, no fs operation exists in uninstall).
    const record = await usePluginStore.getState().install(validManifest(), "/plugins/demo");
    expect(record.sourcePath).toBe("/plugins/demo");
    await usePluginStore.getState().uninstall("demo-plugin");
    expect(usePluginStore.getState().plugins).toHaveLength(0);
    expect(usePluginContributionStore.getState().slashCommands).toHaveLength(0);
  });

  it("PLUG-2: skillsFrom expands folder skills into inline contributions at install time", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    skillFiles.set("/plugins/hello", [
      {
        id: "greet",
        skillMd: "# Greet\nKeep it short.",
        manifestJson: JSON.stringify({
          name: "Greeting Style",
          description: "House style for greetings.",
          riskLevel: "low",
        }),
        truncated: false,
      },
      {
        id: "plain",
        skillMd: "No metadata file.",
        manifestJson: null,
        truncated: true,
      },
    ]);
    const manifest = {
      schemaVersion: 1 as const,
      id: "hello-evir",
      name: "Hello Evir",
      version: "1.0.0",
      contributes: {
        skillsFrom: "skills/" as const,
        settings: [
          { key: "enthusiastic", label: "Enthusiastic", type: "boolean" as const, default: true },
        ],
      },
    };
    const { manifest: expanded, truncatedSkills } = await usePluginStore
      .getState()
      .expandSkillsFromFolder(manifest, "/plugins/hello");
    expect(truncatedSkills).toEqual(["plain"]);
    const skills = expanded.contributes?.skills ?? [];
    expect(skills.map((skill) => skill.id)).toEqual(["greet", "plain"]);
    expect(skills[0]).toMatchObject({
      name: "Greeting Style",
      description: "House style for greetings.",
      riskLevel: "low",
      content: "# Greet\nKeep it short.",
    });
    // Missing metadata falls back to the directory id and a generated description.
    expect(skills[1]).toMatchObject({ name: "plain" });
    expect(skills[1]?.description).toContain("Hello Evir");

    // The expanded manifest installs like any other: skills enter the catalog.
    const record = await usePluginStore.getState().install(expanded, "/plugins/hello");
    expect(record.manifest.contributes?.skills).toHaveLength(2);
    expect(
      useSkillStore.getState().skills.some((skill) => skill.manifest.id === "hello-evir--greet"),
    ).toBe(true);
  });

  it("PLUG-2: inline skill id colliding with a folder skill is rejected", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    skillFiles.set("/plugins/collide", [
      { id: "same", skillMd: "folder body", manifestJson: null, truncated: false },
    ]);
    const manifest = {
      schemaVersion: 1 as const,
      id: "collide-plugin",
      name: "Collide",
      version: "1.0.0",
      contributes: {
        skillsFrom: "skills/" as const,
        skills: [
          {
            id: "same",
            name: "Inline Same",
            description: "inline",
            content: "inline body",
          },
        ],
      },
    };
    await expect(
      usePluginStore.getState().expandSkillsFromFolder(manifest, "/plugins/collide"),
    ).rejects.toThrow("plugins.skillIdCollision");
  });

  it("PLUG-2: manifests without skillsFrom pass through untouched", async () => {
    const manifest = validManifest();
    const { manifest: same, truncatedSkills } = await usePluginStore
      .getState()
      .expandSkillsFromFolder(manifest, "/plugins/demo");
    expect(truncatedSkills).toEqual([]);
    expect(same).toEqual(manifest);
  });
});
