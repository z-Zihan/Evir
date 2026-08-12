import { describe, expect, it, vi } from "vitest";
import { HarnessMiddlewareRegistry } from "../middleware-registry";
import type { HarnessMiddleware } from "../types";

function middleware(
  id: HarnessMiddleware["id"],
  events: string[],
  transform?: HarnessMiddleware["execute"],
): HarnessMiddleware {
  return {
    id,
    version: "1.0.0",
    execute:
      transform ??
      (async (event, next) => {
        events.push(`before:${id}`);
        const result = await next(event);
        events.push(`after:${id}`);
        return result;
      }),
  };
}

function requestEvent() {
  return {
    type: "request" as const,
    conversationId: "conversation-1",
    target: "desktop" as const,
    requestedMode: "agent" as const,
    effectiveMode: "agent" as const,
    providerToolCalling: true,
    userInput: "hello",
    normalizedInput: "hello",
    blocked: false,
  };
}

describe("HarnessMiddlewareRegistry", () => {
  it("runs middleware in canonical order and unwinds in reverse order", async () => {
    const events: string[] = [];
    const registry = new HarnessMiddlewareRegistry();
    registry.register(middleware("verification", events), "verification-component");
    registry.register(middleware("input-normalization", events), "normalization-component");
    registry.register(middleware("skill-routing", events), "skill-component");

    await registry.dispatch(requestEvent());

    expect(events).toEqual([
      "before:input-normalization",
      "before:skill-routing",
      "before:verification",
      "after:verification",
      "after:skill-routing",
      "after:input-normalization",
    ]);
  });

  it("removes only the middleware owned by its disposer", () => {
    const registry = new HarnessMiddlewareRegistry();
    const dispose = registry.register(middleware("checkpoint", []), "checkpoint-component");
    dispose();
    dispose();
    expect(registry.inspect()).toEqual([]);
  });

  it("does not allow protected middleware to be replaced or removed", () => {
    const registry = new HarnessMiddlewareRegistry();
    registry.registerProtected(middleware("tool-policy", []), "evir.host.tool-policy");

    expect(() => registry.register(middleware("tool-policy", []), "plugin")).toThrow(
      /protected harness middleware/,
    );
    expect(registry.inspect()).toEqual([
      expect.objectContaining({ id: "tool-policy", protected: true }),
    ]);
  });

  it("rejects middleware that calls next more than once", async () => {
    const registry = new HarnessMiddlewareRegistry();
    registry.register(
      middleware("input-normalization", [], async (event, next) => {
        await next(event);
        return next(event);
      }),
      "broken-component",
    );

    await expect(registry.dispatch(requestEvent())).rejects.toThrow(/next\(\) twice/);
  });

  it("propagates middleware failures without swallowing them", async () => {
    const registry = new HarnessMiddlewareRegistry();
    const terminal = vi.fn();
    registry.register(
      middleware("mode-policy", [], () => Promise.reject(new Error("policy failed"))),
      "policy-component",
    );
    registry.register(middleware("observability", [], terminal), "observer-component");

    await expect(registry.dispatch(requestEvent())).rejects.toThrow("policy failed");
    expect(terminal).not.toHaveBeenCalled();
  });
});
