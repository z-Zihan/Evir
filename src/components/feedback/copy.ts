/**
 * Unified clipboard write with user feedback (§18): every user-invoked copy
 * goes through here so success/failure toasts stay consistent across message
 * copy, code copy, JSON copy, diagnostics copy, etc. Component-level icon
 * swaps (Copy → Check) may layer on top, but the toast is the primary
 * feedback channel — never rely on a tooltip alone.
 */
import { notify } from "./notify";

type I18nModule = typeof import("../../i18n/config");
let i18nModule: Promise<I18nModule> | null = null;
function i18nApi(): Promise<I18nModule> {
  i18nModule ??= import("../../i18n/config");
  return i18nModule;
}

async function label(key: string): Promise<string> {
  const { default: i18n } = await i18nApi();
  return i18n.t(key);
}

export interface CopyFeedbackOptions {
  /**
   * i18n key shown on success. Defaults to `notify.copySuccess`.
   * Callers with domain-specific wording (e.g. "Log directory copied") pass
   * their own key.
   */
  successKey?: string;
  /** i18n key shown on failure. Defaults to `notify.copyFailed`. */
  failureKey?: string;
}

/**
 * Write `text` to the clipboard and surface a success/error toast.
 * Returns whether the write succeeded so callers can drive icon swaps.
 */
export async function copyTextWithFeedback(
  text: string,
  options: CopyFeedbackOptions = {},
): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    notify.success(await label(options.successKey ?? "notify.copySuccess"));
    return true;
  } catch {
    notify.error(await label(options.failureKey ?? "notify.copyFailed"));
    return false;
  }
}
