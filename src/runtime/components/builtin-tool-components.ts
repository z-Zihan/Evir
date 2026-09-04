import { z } from "zod";
import type { ComponentDefinition } from "../../core/components/types";
import type { Capability } from "../types";
import { LOCAL_FILE_TOOLS } from "../../core/tools/builtin/local-file-tools";
import { BROWSER_TOOLS } from "../../core/tools/builtin/browser-tools";
import { CANVAS_TOOLS } from "../../core/tools/builtin/canvas-tools";

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
      for (const tool of BROWSER_TOOLS) context.registerTool(tool);
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

export const BUILTIN_TOOL_COMPONENTS = [
  createToolComponent("filesystem"),
  createToolComponent("terminal"),
  createToolComponent("git"),
  createBrowserToolComponent(),
] as const;

export function capabilityDependencies(capabilities: ReadonlySet<Capability>): string[] {
  return [...capabilities].map((capability) => `capability:${capability}`);
}
