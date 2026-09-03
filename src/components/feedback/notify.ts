/**
 * Unified toast API (§18). Every toast in the app goes through `notify` so
 * position, duration and styling stay consistent via the single <Toaster/>
 * host in main.tsx. Sonner — and the i18n instance used for default labels —
 * are dynamically imported on first use so neither lands in the initial
 * bundle nor breaks hosts that mock react-i18next.
 *
 * Policy: toasts are for lightweight, recoverable, non-blocking feedback
 * (save success, copy success, background task finished, export done,
 * transient network hiccups). Dangerous approvals, unrecoverable errors and
 * anything needing a user decision must use ConfirmDialog / InlineError /
 * ErrorState instead — never a toast.
 */
type ToastModule = typeof import("sonner");
type I18nModule = typeof import("../../i18n/config");
let toastModule: Promise<ToastModule> | null = null;
let i18nModule: Promise<I18nModule> | null = null;
function toastApi(): Promise<ToastModule> {
  toastModule ??= import("sonner");
  return toastModule;
}
function i18nApi(): Promise<I18nModule> {
  i18nModule ??= import("../../i18n/config");
  return i18nModule;
}

export interface NotifyOptions {
  description?: string | undefined;
  /** ms; omit for the library default (4s) */
  duration?: number | undefined;
}

export interface NotifyHandle {
  /** Replace a loading toast with its final state. */
  success(message?: string, options?: NotifyOptions): void;
  error(message?: string, options?: NotifyOptions): void;
  /** Resolve a loading toast as cancelled/inert. */
  dismiss(): void;
}

function baseOptions(options?: NotifyOptions) {
  // Sonner's ExternalToast is exactOptional: strip undefined instead of
  // passing explicit undefined keys.
  return Object.fromEntries(
    Object.entries({
      description: options?.description,
      duration: options?.duration,
    }).filter(([, value]) => value !== undefined),
  );
}

async function defaultLabel(key: string): Promise<string> {
  const { default: i18n } = await i18nApi();
  return i18n.t(key);
}

export const notify = {
  success(message: string, options?: NotifyOptions) {
    void toastApi().then((sonner) => sonner.toast.success(message, baseOptions(options)));
  },
  error(message: string, options?: NotifyOptions) {
    void toastApi().then((sonner) => sonner.toast.error(message, baseOptions(options)));
  },
  warning(message: string, options?: NotifyOptions) {
    void toastApi().then((sonner) => sonner.toast.warning(message, baseOptions(options)));
  },
  info(message: string, options?: NotifyOptions) {
    void toastApi().then((sonner) => sonner.toast.info(message, baseOptions(options)));
  },
  /**
   * Long-ish operation feedback. Returns a handle whose success/error methods
   * morph the toast into the terminal state instead of stacking a second one.
   */
  loading(message?: string, options?: NotifyOptions): NotifyHandle {
    let id: string | number | undefined;
    let resolved = false;
    void Promise.all([
      toastApi(),
      message ? Promise.resolve(message) : defaultLabel("notify.working"),
    ]).then(([sonner, label]) => {
      if (resolved) return;
      id = sonner.toast.loading(label, baseOptions(options));
    });
    const finalize = (
      method: "success" | "error",
      finalMessage: string | undefined,
      finalOptions: NotifyOptions | undefined,
      fallbackKey: string,
    ) => {
      resolved = true;
      void Promise.all([
        toastApi(),
        finalMessage ? Promise.resolve(finalMessage) : defaultLabel(fallbackKey),
      ]).then(([sonner, label]) => {
        if (id === undefined) return;
        sonner.toast[method](label, { ...baseOptions(finalOptions), id });
      });
    };
    return {
      success(finalMessage, finalOptions) {
        finalize("success", finalMessage, finalOptions, "notify.done");
      },
      error(finalMessage, finalOptions) {
        finalize("error", finalMessage, finalOptions, "notify.failed");
      },
      dismiss() {
        resolved = true;
        void toastApi().then((sonner) => {
          if (id !== undefined) sonner.toast.dismiss(id);
        });
      },
    };
  },
};
