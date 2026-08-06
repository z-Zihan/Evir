import { useEffect, useRef } from "react";
import { DEFAULT_SHORTCUTS } from "../core/shortcuts/default-shortcuts";
import { isMac } from "../core/shortcuts/platform";

interface ShortcutCallbacks {
  onShortcutHelp: () => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onSendMessage: () => void;
  onStop: () => void;
}

const callbackById: Partial<
  Record<(typeof DEFAULT_SHORTCUTS)[number]["id"], keyof ShortcutCallbacks>
> = {
  "shortcut-help": "onShortcutHelp",
  "new-conversation": "onNewConversation",
  "open-settings": "onOpenSettings",
  "toggle-sidebar": "onToggleSidebar",
  "send-message": "onSendMessage",
  "stop-current-run": "onStop",
};

function matches(event: KeyboardEvent, accelerator: string, isMac: boolean): boolean {
  const parts = accelerator.toLowerCase().split("+");
  const wantsPrimary = parts.includes("cmdorctrl");
  const wantsShift = parts.includes("shift");
  const key = parts.at(-1);
  if (!key) return false;
  return (
    event.metaKey === (wantsPrimary && isMac) &&
    event.ctrlKey === (wantsPrimary && !isMac) &&
    event.shiftKey === wantsShift &&
    !event.altKey &&
    event.key.toLowerCase() === key
  );
}

export function useShortcuts(callbacks: ShortcutCallbacks): void {
  const ref = useRef(callbacks);
  ref.current = callbacks;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = DEFAULT_SHORTCUTS.find(
        ({ id, defaultAccelerator }) =>
          callbackById[id] && matches(event, defaultAccelerator, isMac()),
      );
      if (!shortcut) return;
      if (shortcut.id !== "stop-current-run") event.preventDefault();
      const callback = callbackById[shortcut.id];
      if (callback) ref.current[callback]();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
