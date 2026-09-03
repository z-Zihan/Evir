/**
 * Public feedback systems (§17-19): dialogs, toasts, content states, forms.
 * Everything user-facing that needs user feedback composes from here.
 */
export {
  AppDialog,
  ConfirmDialog,
  DangerConfirmDialog,
  FormDialog,
  type AppDialogProps,
  type ConfirmDialogProps,
  type ConfirmTone,
  type FormDialogProps,
} from "./dialog-composites";
export { notify, type NotifyOptions, type NotifyHandle } from "./notify";
export {
  LoadingState,
  ErrorState,
  EmptyState,
  InlineError,
  type ErrorStateProps,
  type EmptyStateProps,
} from "./states";
export { FormField, FormLabel, FormDescription, FormError, FormControl, FieldBlock } from "./field";
