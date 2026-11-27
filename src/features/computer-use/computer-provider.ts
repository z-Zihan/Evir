/**
 * Desktop computer-use bridge: the only place that touches Tauri for the
 * `computer_*` commands, so `core/tools/builtin/computer-tools` stays
 * runtime-agnostic and testable with a plain mock.
 */
export async function invokeComputerCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { tauriInvoke } = await import("../../runtime/tauri-ipc");
  return tauriInvoke<T>(command, args);
}
