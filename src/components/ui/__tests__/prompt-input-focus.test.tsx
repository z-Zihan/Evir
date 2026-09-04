// @vitest-environment jsdom
/**
 * Focus contract regression guard (§3): the accepted composer focus effect is
 * the restrained ring on the PromptInput container keyed off the textarea's
 * `data-slot=input-group-control`. No default browser ring, no double ring,
 * no neutral-gray redesign — if these hooks change, this test fails so the
 * change is a deliberate decision, not drift.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PromptInput, PromptInputTextarea } from "../../ai/elements/prompt-input";

afterEach(cleanup);

describe("PromptInput focus contract", () => {
  it("keys the container ring off the control's data-slot, not its own outline", () => {
    const { container } = render(
      <PromptInput onSubmit={() => undefined}>
        <PromptInputTextarea value="" onChange={() => undefined} />
      </PromptInput>,
    );
    const form = container.querySelector("form");
    const textarea = container.querySelector("textarea");

    expect(form).toBeTruthy();
    expect(textarea).toBeTruthy();
    expect(textarea?.getAttribute("data-slot")).toBe("input-group-control");
    // The visible ring lives on the container; the control itself stays clean.
    expect(form?.className).toContain(
      "has-[[data-slot=input-group-control]:focus-visible]:ring-[3px]",
    );
    expect(form?.className).toContain(
      "has-[[data-slot=input-group-control]:focus-visible]:ring-ring/20",
    );
    expect(textarea?.className).toContain("outline-none");
    expect(textarea?.className).toContain("focus-visible:ring-0");
  });
});
