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
