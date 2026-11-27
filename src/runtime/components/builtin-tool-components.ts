import { z } from "zod";
import type { ComponentDefinition } from "../../core/components/types";
import type { Capability } from "../types";
import { LOCAL_FILE_TOOLS } from "../../core/tools/builtin/local-file-tools";
import { browserToolsForProvider } from "../../core/tools/builtin/browser-tools";
import { CANVAS_TOOLS } from "../../core/tools/builtin/canvas-tools";
import { KNOWLEDGE_TOOLS } from "../../core/tools/builtin/knowledge-tools";
import { COMPUTER_TOOLS } from "../../core/tools/builtin/computer-tools";
import { readAgentBrowserProvider } from "../../features/browser/browser-provider";

const emptyConfigSchema = z.object({}).strict().optional();

function createBrowserToolComponent() {
  const definition: ComponentDefinition<null> = {
    manifest: {
      id: "evir.tools.browser-automation",
      version: "1.0.0",
      kind: "tool",
      targets: ["desktop"],
      provides: ["tools:browserAutomation"],
      requires: ["capability:browserAutomation"],
      defaultEnabled: true,
      trust: "builtin",
    },
    parseConfig(input) {
      emptyConfigSchema.parse(input);
      return null;
    },
    activate(context) {
      // EGO-2: advertise only the tools the active provider can execute.
      for (const tool of browserToolsForProvider(readAgentBrowserProvider())) {
        context.registerTool(tool);
      }
    },
  };
  return definition;
}

function createToolComponent(capability: "filesystem" | "terminal" | "git") {
  const tools = [
    ...LOCAL_FILE_TOOLS.filter((tool) => tool.requiredCapability === capability),
    ...(capability === "filesystem" ? CANVAS_TOOLS : []),
  ];
  const definition: ComponentDefinition<null> = {
    manifest: {
      id: `evir.tools.${capability}`,
      version: "1.0.0",
      kind: "tool",
      targets: ["desktop"],
      provides: [`tools:${capability}`],
      requires: [`capability:${capability}`],
      defaultEnabled: true,
      trust: "builtin",
    },
    parseConfig(input) {
      emptyConfigSchema.parse(input);
      return null;
    },
    activate(context) {
      for (const tool of tools) context.registerTool(tool);
    },
  };
  return definition;
}

function createKnowledgeToolComponent(): ComponentDefinition<null> {
  const definition: ComponentDefinition<null> = {
    manifest: {
      id: "evir.tools.knowledge",
      version: "1.0.0",
      kind: "tool",
      targets: ["web", "desktop"],
      provides: ["tools:knowledge"],
      requires: [],
      defaultEnabled: true,
      trust: "builtin",
    },
    parseConfig(input) {
      emptyConfigSchema.parse(input);
      return null;
    },
    activate(context) {
      for (const tool of KNOWLEDGE_TOOLS) context.registerTool(tool);
    },
  };
  return definition;
}

/**
 * Computer use is opt-in: synthetic desktop input is the highest-risk tool
 * family Evir ships, so the component starts disabled and only registers its
 * tools when the host passes a component configuration that enables it. It
 * also requires the `computerUse` capability, which only the desktop runtime
 * advertises.
 *
 * Known gap (honest): the app calls `createRuntime()` without a component
 * configuration and there is no settings-UI switch for components yet, so
 * today this can only be enabled in code. A component-switch settings surface
 * is the follow-up that makes this reachable for users.
 */
function createComputerToolComponent(): ComponentDefinition<null> {
  const definition: ComponentDefinition<null> = {
    manifest: {
      id: "evir.tools.computer-use",
      version: "1.0.0",
      kind: "tool",
      targets: ["desktop"],
      provides: ["tools:computerUse"],
      requires: ["capability:computerUse"],
      defaultEnabled: false,
      trust: "builtin",
    },
    parseConfig(input) {
      emptyConfigSchema.parse(input);
      return null;
    },
    activate(context) {
      for (const tool of COMPUTER_TOOLS) context.registerTool(tool);
    },
  };
  return definition;
}

export const BUILTIN_TOOL_COMPONENTS = [
  createToolComponent("filesystem"),
  createToolComponent("terminal"),
  createToolComponent("git"),
  createBrowserToolComponent(),
  createKnowledgeToolComponent(),
  createComputerToolComponent(),
] as const;

export function capabilityDependencies(capabilities: ReadonlySet<Capability>): string[] {
  return [...capabilities].map((capability) => `capability:${capability}`);
}
