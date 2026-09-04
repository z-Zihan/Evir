import type { EvirRuntime } from "../../../runtime/types";
import {
  buildAgentRunRecord,
  finalizeAutomaticVerification,
  persistAgentRun,
  type AgentRunRecord,
} from "../agent-run-record";
import { getStructuredStorage } from "../../../runtime/structured-storage";
import type { AgentLoopResult } from "../agent-loop";
import type { TurnContext } from "./turn-state";

/**
 * verifyTurn — post-execution evidence pass. Builds the agent-run record,
 * persists it, and runs automatic verification for runs that require it.
 *
 * Verification strength follows the task type (§17 of the Core
 * Simplification plan): only coding/goal runs with artifacts or explicit
 * completion criteria get the heavyweight workspace checker; plain ask-mode
 * turns never enter this path (the caller skips agent runs for ask mode).
 */
export async function verifyTurn(
  turn: TurnContext,
  result: AgentLoopResult,
  runtime: EvirRuntime,
  mode: "agent" | "goal" | "plan" | "ask",
): Promise<AgentRunRecord | null> {
  const { get, conversationId } = turn;
  let agentRunRecord =
    mode === "agent" || mode === "goal"
      ? await buildAgentRunRecord(result, conversationId, runtime, {
          previous: await previousRunFor(turn, result),
        })
      : null;
  if (agentRunRecord && !get().privateSession) {
    await persistAgentRun(agentRunRecord);
    agentRunRecord = await finalizeAutomaticVerification(agentRunRecord, runtime);
  }
  return agentRunRecord;
}

async function previousRunFor(
  turn: TurnContext,
  result: AgentLoopResult,
): Promise<AgentRunRecord | null> {
  const { get } = turn;
  if (get().latestAgentRun?.id === result.agentRun.id) return get().latestAgentRun;
  if (get().privateSession) return null;
  return (
    (await getStructuredStorage().read<AgentRunRecord>("agent_runs", result.agentRun.id)) ?? null
  );
}
