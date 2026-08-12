import { z } from "zod";
import type { ComponentDefinition } from "../../core/components/types";
import type { Capability } from "../types";
import { LOCAL_FILE_TOOLS } from "../../core/tools/builtin/local-file-tools";

const emptyConfigSchema = z.object({}).strict().optional();

function createToolComponent(capability: "filesystem" | "terminal" | "git") {
  const tools = LOCAL_FILE_TOOLS.filter((tool) => tool.requiredCapability === capability);
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
] as const;

export function capabilityDependencies(capabilities: ReadonlySet<Capability>): string[] {
  return [...capabilities].map((capability) => `capability:${capability}`);
}
