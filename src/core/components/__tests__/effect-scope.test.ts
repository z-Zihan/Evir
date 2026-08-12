import { describe, expect, it } from "vitest";
import { EffectScope } from "../effect-scope";

describe("EffectScope", () => {
  it("disposes effects once in reverse registration order", () => {
    const events: string[] = [];
    const scope = new EffectScope();
    const first = scope.add(() => events.push("first"));
    scope.add(() => events.push("second"));

    first();
    scope.dispose();
    scope.dispose();

    expect(events).toEqual(["first", "second"]);
  });
});
