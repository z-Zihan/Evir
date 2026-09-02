// jsdom lacks URL.createObjectURL/revokeObjectURL; preview renderers rely on it.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:mock-${Math.random().toString(36).slice(2)}`,
  });
}
if (typeof URL.revokeObjectURL !== "function") {
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
}

// jsdom lacks matchMedia; Base UI popups, sonner, and react-resizable-panels
// (reached through the src/components/ui barrel) query it at import/render time.
// Guarded: this setup also runs for node-environment suites where window doesn't exist.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  const query = (queryString: string): MediaQueryList => ({
    matches: false,
    media: queryString,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: query,
  });
}
