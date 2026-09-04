// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory per-profile structured storage double.
const entityStore = new Map<string, Map<string, unknown>>();
function entity(name: string): Map<string, unknown> {
  let table = entityStore.get(name);
  if (!table) {
    table = new Map();
    entityStore.set(name, table);
  }
  return table;
}

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
  usePluginStore.setState({ plugins: [], loaded: false });
  usePluginContributionStore.getState().replaceSlashCommands([]);
});

afterEach(() => {
  vi.clearAllMocks();
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
});
