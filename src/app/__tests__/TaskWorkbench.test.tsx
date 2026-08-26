// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  beforeEach(() => useOrchestrationStore.setState({ current: null, preparing: null }));

  it("shows compact, timed feedback while the model analyzes a task", () => {
    useOrchestrationStore.setState({
      preparing: {
        conversationId: "conversation-1",
        objective: "A very long objective that is already visible in the user message",
        stage: "intake",
        startedAt: Date.now() - 20_000,
      },
    });

    const { container } = render(<TaskWorkbench />);

    expect(screen.getByText("orchestration.preparing.intakeTitle")).toBeTruthy();
    expect(screen.getByText("orchestration.preparing.intakeDescription")).toBeTruthy();
    expect(screen.getByText("orchestration.preparing.slow")).toBeTruthy();
    expect(screen.queryByText(/A very long objective/)).toBeNull();
    expect(container.querySelector(".task-preparation-strip")).toBeTruthy();
  });

  it("distinguishes plan generation from initial task analysis", () => {
    useOrchestrationStore.setState({
      preparing: {
        conversationId: "conversation-1",
        objective: "Prepare a plan",
        stage: "planning",
        startedAt: Date.now(),
      },
    });

    render(<TaskWorkbench />);

    expect(screen.getByText("orchestration.preparing.planningTitle")).toBeTruthy();
    expect(screen.getByText("orchestration.preparing.planningDescription")).toBeTruthy();
    expect(screen.queryByText("orchestration.preparing.slow")).toBeNull();
  });

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
    const assumptionLabels = screen.getAllByText("orchestration.assumptions");
    const assumptionLabel = assumptionLabels[0];
    if (!assumptionLabel) throw new Error("Missing assumptions disclosure");
    const context = assumptionLabel.closest("details");
    expect(context?.open).toBe(false);
    fireEvent.click(assumptionLabel);
    expect(context?.open).toBe(true);
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
    fireEvent.click(screen.getByRole("button", { name: "orchestration.showDetails" }));
    expect(screen.getByText("orchestration.summary.title")).toBeTruthy();
    expect(screen.getAllByText("Change files")).toHaveLength(2);
    expect(screen.getByText("orchestration.summary.noEvidence")).toBeTruthy();
  });

  it("labels a finished run by its actual plan status instead of always saying finished", () => {
    useOrchestrationStore.setState({
      current: {
        runId: brief.runId,
        conversationId: brief.conversationId,
        phase: "finished",
        brief,
        plan: { ...plan, status: "failed" },
        assignments: [],
        events: [],
      },
    });
    render(<TaskWorkbench />);

    expect(screen.getByText("orchestration.finishedStatus.failed")).toBeTruthy();
    expect(screen.queryByText("orchestration.phase.finished")).toBeNull();
  });

  it("keeps the completed label for a successfully finished run", () => {
    useOrchestrationStore.setState({
      current: {
        runId: brief.runId,
        conversationId: brief.conversationId,
        phase: "finished",
        brief,
        plan: { ...plan, status: "completed" },
        assignments: [],
        events: [],
      },
    });
    render(<TaskWorkbench />);

    expect(screen.getByText("orchestration.finishedStatus.completed")).toBeTruthy();
  });
});
