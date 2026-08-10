import { realpath } from "node:fs/promises";
import path from "node:path";

export function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveWorkspace(workspace: string): Promise<string> {
  return realpath(path.resolve(workspace));
}

export async function resolveExistingWorkspacePath(root: string, relativePath: string) {
  const candidate = path.resolve(root, relativePath);
  if (!pathIsInside(root, candidate)) throw new Error("Path escapes the workspace");
  const resolved = await realpath(candidate);
  if (!pathIsInside(root, resolved))
    throw new Error("Path escapes the workspace through a symbolic link");
  return resolved;
}

export async function resolveWritableWorkspacePath(root: string, relativePath: string) {
  const candidate = path.resolve(root, relativePath);
  if (!pathIsInside(root, candidate)) throw new Error("Path escapes the workspace");
  let ancestor = path.dirname(candidate);
  while (true) {
    try {
      const resolved = await realpath(ancestor);
      if (!pathIsInside(root, resolved)) {
        throw new Error("Path escapes the workspace through a symbolic link");
      }
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = path.dirname(ancestor);
      if (next === ancestor) throw error;
      ancestor = next;
    }
  }
}
