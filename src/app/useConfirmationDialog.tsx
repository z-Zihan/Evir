import { useCallback, useState, type ReactNode } from "react";
import { ConfirmationDialog, type ConfirmationOptions } from "./ConfirmationDialog";

interface PendingConfirmation extends ConfirmationOptions {
  action: () => void | Promise<void>;
}

export function useConfirmationDialog(): {
  requestConfirmation: (options: ConfirmationOptions, action: () => void | Promise<void>) => void;
  confirmationDialog: ReactNode;
} {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const close = useCallback(() => setPending(null), []);
  const requestConfirmation = useCallback(
    (options: ConfirmationOptions, action: () => void | Promise<void>) => {
      setPending({ ...options, action });
    },
    [],
  );

  return {
    requestConfirmation,
    confirmationDialog: pending ? (
      <ConfirmationDialog
        {...pending}
        onCancel={close}
        onConfirm={async () => {
          await pending.action();
          close();
        }}
      />
    ) : null,
  };
}
