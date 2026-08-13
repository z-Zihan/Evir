// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationSnapshot, PlanGraph } from "../../core/orchestration/types";
import { useOrchestrationStore } from "../../features/orchestration/orchestration-store";
import { TaskWorkbench } from "../TaskWorkbench";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      currentConversationId: "conversation-1",
      privateSession: true,
      stopGeneration: vi.fn(),
    }),
}));

vi.mock("../../runtime/use-runtime", () => ({ getRuntime: () => ({ target: "desktop" }) }));

vi.mock("../../features/orchestration/continue-orchestration", () => ({
  answerCurrentClarifications: vi.fn(),
  confirmCurrentPlan: vi.fn(),
  continueCurrentExecution: vi.fn(),
}));

vi.mock("../../features/orchestration/orchestration-session", () => ({
  cancelCurrentRun: vi.fn(),
  cancelTaskPreparation: vi.fn(),
  pauseCurrentRun: vi.fn(),
  resumeCurrentRun: vi.fn(),
  reviseCurrentPlan: vi.fn(),
}));

const brief: OrchestrationSnapshot["brief"] = {
  id: "brief-1",
  runId: "run-1",
  conversationId: "conversation-1",
  goalKind: "change",
  objective: "Change the project",
  constraints: [],
  deliverables: [],
  acceptanceCriteria: [],
  requiredCapabilities: ["filesystem"],
  assumptions: [{ id: "assumption-1", statement: "Use the current branch", source: "inferred" }],
  unknowns: [
    {
      id: "unknown-1",
      question: "Which workspace?",
      impact: "permission",
      suggestedAnswers: ["Current workspace"],
    },
    {
      id: "unknown-2",
      question: "Where may data be sent?",
      impact: "data",
      suggestedAnswers: ["Configured provider only"],
    },
  ],
  risk: "medium",
  clarificationRound: 0,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

const plan: PlanGraph = {
  id: "plan-1",
  runId: brief.runId,
  conversationId: brief.conversationId,
  briefVersion: brief.version,
  revision: 1,
  nodes: [],
  edges: [],
  status: "awaiting_confirmation",
  requiresConfirmation: true,
  createdAt: 1,
  updatedAt: 1,
};

afterEach(cleanup);

describe("TaskWorkbench", () => {
  beforeEach(() => useOrchestrationStore.setState({ current: null }));

  it("focuses the first blocking clarification and exposes suggestions as pressed buttons", () => {
    useOrchestrationStore.setState({
      current: {
        runId: "run-1",
        conversationId: "conversation-1",
        phase: "clarification",
        brief,
        assignments: [],
        events: [],
      },
    });
    render(<TaskWorkbench />);

    expect(screen.getAllByPlaceholderText("orchestration.answerPlaceholder")[0]).toBe(
      document.activeElement,
    );
    expect(
      screen.getByRole("button", { name: "Current workspace" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByText("Use the current branch")).toBeTruthy();
    expect(screen.getAllByText("Configured provider only")).toHaveLength(2);
  });

  it("focuses the safe rejection action when plan confirmation opens", () => {
    useOrchestrationStore.setState({
      current: {
        runId: brief.runId,
        conversationId: brief.conversationId,
        phase: "confirmation",
        brief,
        plan,
        assignments: [],
        events: [],
      },
    });
    render(<TaskWorkbench />);

    expect(screen.getByRole("button", { name: "common.cancel" })).toBe(document.activeElement);
  });

  it("does not render a failed run with a success icon", () => {
    const failedNode: PlanGraph["nodes"][number] = {
      id: "change",
      kind: "task",
      title: "Change files",
      objective: "Apply the requested change",
      dependencies: [],
      requiredCapabilities: ["filesystem"],
      resourceScopes: [{ kind: "workspace", value: "/workspace", access: "write" }],
      expectedArtifacts: [],
      successCriteria: [],
      status: "failed",
    };
    useOrchestrationStore.setState({
      current: {
        runId: brief.runId,
        conversationId: brief.conversationId,
        phase: "finished",
        brief,
        plan: { ...plan, status: "failed", nodes: [failedNode] },
        assignments: [],
        events: [],
      },
    });
    const { container } = render(<TaskWorkbench />);

    expect(container.querySelector(".lucide-circle-x")).toBeTruthy();
    expect(container.querySelector(".lucide-circle-check-big")).toBeFalsy();
    expect(screen.getByText("orchestration.summary.title")).toBeTruthy();
    expect(screen.getAllByText("Change files")).toHaveLength(2);
    expect(screen.getByText("orchestration.summary.noEvidence")).toBeTruthy();
  });
});
