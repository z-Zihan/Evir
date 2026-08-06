import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import { TOOL_NOT_AVAILABLE } from "../tool-executor";

export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

// Loaded lazily so this module has no static dependency on the Tauri runtime; callers may
// also inject their own InvokeFn (e.g. in tests) instead of relying on this default.
let tauriInvoke: InvokeFn | null = null;

const defaultInvoke: InvokeFn = async (command, args) => {
  if (!tauriInvoke) {
    const module = await import("@tauri-apps/api/core");
    tauriInvoke = module.invoke;
  }
  return tauriInvoke(command, args);
};

function unavailable(): ToolResult {
  return {
    success: false,
    output: "This tool is not available in browser mode.",
    error: TOOL_NOT_AVAILABLE,
  };
}

function toolError(error: unknown): ToolResult {
  return {
    success: false,
    output: error instanceof Error ? error.message : "Browser automation operation failed",
    error: "tool_error",
  };
}

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

function isAllowedUrl(url: string): boolean {
  try {
    return ALLOWED_URL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

const navigateArgsSchema = z
  .object({ url: z.string().min(1).refine(isAllowedUrl, "URL must use http: or https:") })
  .strict();
const clickArgsSchema = z.object({ selector: z.string().min(1) }).strict();
const typeArgsSchema = z.object({ selector: z.string().min(1), text: z.string() }).strict();
const screenshotArgsSchema = z.object({}).strict();
const extractTextArgsSchema = z.object({ selector: z.string().min(1).optional() }).strict();

function browserNavigate(invoke: InvokeFn) {
  return async (args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> => {
    if (runtime.target !== "desktop") return unavailable();
    const parsed = navigateArgsSchema.safeParse(args);
    if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
    try {
      const title = await invoke<string>("browser_navigate", { url: parsed.data.url });
      return { success: true, output: title };
    } catch (error) {
      return toolError(error);
    }
  };
}

function browserClick(invoke: InvokeFn) {
  return async (args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> => {
    if (runtime.target !== "desktop") return unavailable();
    const parsed = clickArgsSchema.safeParse(args);
    if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
    try {
      await invoke("browser_click", { selector: parsed.data.selector });
      return { success: true, output: `clicked: ${parsed.data.selector}` };
    } catch (error) {
      return toolError(error);
    }
  };
}

function browserType(invoke: InvokeFn) {
  return async (args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> => {
    if (runtime.target !== "desktop") return unavailable();
    const parsed = typeArgsSchema.safeParse(args);
    if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
    try {
      await invoke("browser_type", {
        selector: parsed.data.selector,
        text: parsed.data.text,
      });
      return { success: true, output: `typed into: ${parsed.data.selector}` };
    } catch (error) {
      return toolError(error);
    }
  };
}

function browserScreenshot(invoke: InvokeFn) {
  return async (args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> => {
    if (runtime.target !== "desktop") return unavailable();
    const parsed = screenshotArgsSchema.safeParse(args);
    if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
    try {
      const base64Png = await invoke<string>("browser_screenshot", {});
      return { success: true, output: base64Png };
    } catch (error) {
      return toolError(error);
    }
  };
}

function browserExtractText(invoke: InvokeFn) {
  return async (args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> => {
    if (runtime.target !== "desktop") return unavailable();
    const parsed = extractTextArgsSchema.safeParse(args);
    if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
    try {
      const text = await invoke<string>("browser_extract_text", {
        selector: parsed.data.selector ?? null,
      });
      return { success: true, output: text };
    } catch (error) {
      return toolError(error);
    }
  };
}

export function createBrowserTools(invoke: InvokeFn = defaultInvoke): readonly ToolDefinition[] {
  return [
    {
      id: "browser_navigate",
      name: "browser_navigate",
      description: "Open a URL in a headless browser and return the page title.",
      source: "evir-local",
      riskLevel: "L3",
      schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to navigate to" },
        },
        required: ["url"],
        additionalProperties: false,
      },
      execute: browserNavigate(invoke),
    },
    {
      id: "browser_click",
      name: "browser_click",
      description: "Click an element on the current page identified by a CSS selector.",
      source: "evir-local",
      riskLevel: "L3",
      schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the element to click" },
        },
        required: ["selector"],
        additionalProperties: false,
      },
      execute: browserClick(invoke),
    },
    {
      id: "browser_type",
      name: "browser_type",
      description:
        "Type text into an input field on the current page identified by a CSS selector.",
      source: "evir-local",
      riskLevel: "L3",
      schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the input field" },
          text: { type: "string", description: "Text to type into the field" },
        },
        required: ["selector", "text"],
        additionalProperties: false,
      },
      execute: browserType(invoke),
    },
    {
      id: "browser_screenshot",
      name: "browser_screenshot",
      description: "Take a screenshot of the current page and return it as a base64-encoded PNG.",
      source: "evir-local",
      riskLevel: "L1",
      schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: browserScreenshot(invoke),
    },
    {
      id: "browser_extract_text",
      name: "browser_extract_text",
      description:
        "Extract text content from the current page, or from a specific element if a CSS selector is given.",
      source: "evir-local",
      riskLevel: "L1",
      schema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Optional CSS selector to scope text extraction to a specific element",
          },
        },
        additionalProperties: false,
      },
      execute: browserExtractText(invoke),
    },
  ];
}
