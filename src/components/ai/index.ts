/**
 * Evir AI presentation layer.
 *
 * Message / PromptInput / Tool / Confirmation / Task are VENDORED from
 * vercel/ai-elements (Apache-2.0) with documented adaptations — see
 * src/components/ai/elements/*. Evir domain state remains the single source
 * of truth; adapters live in features/app, not here. glue.tsx holds small
 * Evir-specific presentation pieces without an upstream equivalent.
 */
export {
  ConversationContent,
  ConversationEmptyState,
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageToolbar,
  PromptInput,
  PromptInputProvider,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  getStatusBadge,
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
  Task,
  TaskTrigger,
  TaskContent,
  TaskItem,
  TaskItemFile,
  type ChatStatus,
} from "./elements";

/** Evir-specific presentation pieces without an upstream equivalent. */
export { ThinkingDots, BusyIndicator } from "./loader";
export { MessageRail, MessageRoleMark, MessageState } from "./glue";
export {
  PlanNodeIcon,
  TaskCard,
  TaskSectionHeading,
  TaskSectionTitle,
  TaskSectionCaption,
  PlanTimeline,
  PlanStep,
  PlanStepMarker,
  TaskPauseStrip,
  PauseIcon,
  type PlanNodeStatus,
} from "./task";
/**
 * Grouped, summary-first tool timeline: Evir aggregates calls by domain
 * (inspect/change/command/browser) with localized summaries, while the
 * upstream Tool component is per-call. Kept as an Evir adapter on top of
 * the same primitives; see the acceptance report comparison table.
 */
export { ToolGroupHeader, ToolGroupCalls, ToolRow, ToolTimeline, type ToolStatus } from "./tool";
