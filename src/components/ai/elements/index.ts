/**
 * Vendored AI Elements (source: vercel/ai-elements, Apache-2.0) — adapted to
 * Evir's primitive layer and type shim. Each file documents its deviations
 * from upstream in a header comment. Evir domain state stays the single
 * source of truth; these are display components only.
 */
export {
  ConversationContent,
  ConversationEmptyState,
  type ConversationContentProps,
  type ConversationEmptyStateProps,
} from "./conversation";
export {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageToolbar,
  type MessageProps,
  type MessageContentProps,
  type MessageActionsProps,
  type MessageActionProps,
  type MessageToolbarProps,
} from "./message";
export {
  PromptInput,
  PromptInputProvider,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  useTextInput,
  type PromptInputProps,
  type PromptInputProviderProps,
  type PromptInputBodyProps,
  type PromptInputTextareaProps,
  type PromptInputFooterProps,
  type PromptInputToolsProps,
  type PromptInputButtonProps,
  type PromptInputButtonTooltip,
  type PromptInputSubmitProps,
} from "./prompt-input";
export {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  getStatusBadge,
  type ToolProps,
  type ToolPart,
  type ToolHeaderProps,
  type ToolContentProps,
  type ToolInputProps,
  type ToolOutputProps,
} from "./tool";
export {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
  type ConfirmationProps,
  type ConfirmationTitleProps,
  type ConfirmationRequestProps,
  type ConfirmationAcceptedProps,
  type ConfirmationRejectedProps,
  type ConfirmationActionsProps,
  type ConfirmationActionProps,
} from "./confirmation";
export {
  Task,
  TaskTrigger,
  TaskContent,
  TaskItem,
  TaskItemFile,
  type TaskProps,
  type TaskTriggerProps,
  type TaskContentProps,
  type TaskItemProps,
  type TaskItemFileProps,
} from "./task";
export type {
  ChatStatus,
  FileUIPart,
  ToolUIPart,
  ToolUIPartState,
  DynamicToolUIPart,
  SourceDocumentUIPart,
} from "./ai-types";
