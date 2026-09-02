import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useThemeStore } from "../../features/settings/theme-store";

/**
 * App toast host. Only lightweight cross-conversation notifications use it
 * (surfaces with visible in-page state must not double-toast).
 */
export function Toaster(props: ToasterProps) {
  const theme = useThemeStore((state) => state.resolvedTheme);
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--color-surface-elevated)",
          border: "1px solid var(--color-border)",
          color: "var(--color-foreground)",
          borderRadius: "12px",
          fontSize: "12.5px",
          boxShadow: "var(--shadow-popover)",
        },
      }}
      {...props}
    />
  );
}
