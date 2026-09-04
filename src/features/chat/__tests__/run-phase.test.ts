import { describe, expect, it } from "vitest";
import { deriveRunPhase, type RunPhaseFacts } from "../run-phase";

describe("deriveRunPhase (canonical run state machine)", () => {
  const facts = (overrides: Partial<RunPhaseFacts> = {}): RunPhaseFacts => ({
    hasPendingApproval: false,
    waitingUser: false,
    ...overrides,
  });

  it("resolves lifecycle phases from the stream slot", () => {
    expect(deriveRunPhase(facts({ slotPhase: "preparing" }))).toBe("preparing");
    expect(deriveRunPhase(facts({ slotPhase: "streaming" }))).toBe("streaming");
    expect(deriveRunPhase(facts({ slotPhase: "verifying" }))).toBe("verifying");
  });

  it("an approval wait outranks an open slot — the run is parked", () => {
    expect(
      deriveRunPhase(facts({ slotPhase: "streaming", hasPendingApproval: true })),
    ).toBe("approval");
  });

  it("an open slot outranks terminal outcomes — stopped tails still persist", () => {
    expect(deriveRunPhase(facts({ slotPhase: "streaming", outcomeStatus: "failed" }))).toBe(
      "streaming",
    );
  });

  it("terminal outcomes beat waiting-user", () => {
    expect(deriveRunPhase(facts({ outcomeStatus: "stopped", waitingUser: true }))).toBe("stopped");
    expect(deriveRunPhase(facts({ outcomeStatus: "failed" }))).toBe("failed");
  });

  it("waiting-user only when nothing is executing or settled", () => {
    expect(deriveRunPhase(facts({ waitingUser: true }))).toBe("waiting-user");
  });

  it("idle conversations resolve to null (unread is a view concern)", () => {
    expect(deriveRunPhase(facts())).toBeNull();
    expect(deriveRunPhase(facts({ outcomeStatus: "completed" }))).toBeNull();
  });
});
