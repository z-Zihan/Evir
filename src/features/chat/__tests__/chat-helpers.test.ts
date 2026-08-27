import { describe, expect, it } from "vitest";
import type { AgentLoopTurn } from "../agent-loop";
import { toMessage } from "../chat-helpers";

describe("chat helpers", () => {
  it("accepts stable timestamps for ordered Agent turns", () => {
    const turn: AgentLoopTurn = { stream: { content: "step", status: "complete" } };

    expect(toMessage(turn, "conversation-1", undefined, 100).createdAt).toBe(100);
    expect(toMessage(turn, "conversation-1", undefined, 101).createdAt).toBe(101);
  });
});
