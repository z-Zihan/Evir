import type { PermissionContext } from "../security/permission-profiles";

/**
 * Single source of truth for the active workspace root and run permission
 * context.
 *
 * Resolution order:
 *   1. Run overrides — agent runs (and approval continuations) capture the
 *      root and permission context at start and push them for the whole run,
 *      so switching projects in the sidebar can never leak into an active run.
 *   2. Root resolver — installed by the app shell; resolves the current
 *      project's root (or the legacy global workspace during migration).
 */
type RootResolver = () => string | null;

const LEGACY_WORKSPACE_KEY = "evir-workspace-current";

function legacyRoot(): string | null {
  const stored = globalThis.localStorage?.getItem(LEGACY_WORKSPACE_KEY) ?? null;
  return stored !== null && stored.trim().length > 0 ? stored : null;
}

let resolver: RootResolver = () => legacyRoot();

interface RunScope {
  root: string | null;
  permissionContext: PermissionContext | null;
}

const runScopes: RunScope[] = [];

export function setRootResolver(next: RootResolver): void {
  resolver = next;
}

export function pushRunRoot(
  root: string | null,
  permissionContext: PermissionContext | null = null,
): void {
  runScopes.push({ root, permissionContext });
}

export function popRunRoot(): void {
  runScopes.pop();
}

export function getActiveWorkspaceRoot(): string | null {
  if (runScopes.length > 0) return runScopes[runScopes.length - 1]?.root ?? null;
  return resolver();
}

export function getActivePermissionContext(): PermissionContext | null {
  if (runScopes.length > 0) return runScopes[runScopes.length - 1]?.permissionContext ?? null;
  return null;
}
