import {
  HARNESS_MIDDLEWARE_ORDER,
  type HarnessEvent,
  type HarnessMiddleware,
  type HarnessMiddlewareId,
  type HarnessMiddlewareInspection,
  type HarnessMiddlewareRegistryPort,
  type HarnessEventOf,
} from "./types";

interface RegisteredMiddleware {
  middleware: HarnessMiddleware;
  ownerId: string;
  protected: boolean;
}

const orderIndex = new Map(HARNESS_MIDDLEWARE_ORDER.map((id, index) => [id, index]));

export class HarnessMiddlewareRegistry implements HarnessMiddlewareRegistryPort {
  private readonly entries = new Map<HarnessMiddlewareId, RegisteredMiddleware>();

  register(middleware: HarnessMiddleware, ownerId: string): () => void {
    this.validateRegistration(middleware, ownerId);
    this.entries.set(middleware.id, { middleware, ownerId, protected: false });
    return () => {
      const current = this.entries.get(middleware.id);
      if (current?.ownerId === ownerId && !current.protected) this.entries.delete(middleware.id);
    };
  }

  registerProtected(middleware: HarnessMiddleware, ownerId: string): void {
    this.validateRegistration(middleware, ownerId);
    this.entries.set(middleware.id, { middleware, ownerId, protected: true });
  }

  async dispatch<TType extends HarnessEvent["type"]>(
    event: HarnessEventOf<TType>,
  ): Promise<HarnessEventOf<TType>> {
    const middleware = this.orderedEntries();
    const invoke = async (index: number, current: HarnessEvent): Promise<HarnessEvent> => {
      const entry = middleware[index];
      if (!entry) return current;
      let called = false;
      return entry.middleware.execute(current, async (nextEvent) => {
        if (called)
          throw new Error(`Harness middleware called next() twice: ${entry.middleware.id}`);
        called = true;
        return invoke(index + 1, nextEvent);
      });
    };
    return (await invoke(0, event)) as HarnessEventOf<TType>;
  }

  inspect(): readonly HarnessMiddlewareInspection[] {
    return this.orderedEntries().map(({ middleware, ownerId, protected: isProtected }) => ({
      id: middleware.id,
      version: middleware.version,
      ownerId,
      protected: isProtected,
    }));
  }

  private orderedEntries(): RegisteredMiddleware[] {
    return [...this.entries.values()].sort(
      (left, right) =>
        (orderIndex.get(left.middleware.id) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(right.middleware.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.middleware.id.localeCompare(right.middleware.id),
    );
  }

  private validateRegistration(middleware: HarnessMiddleware, ownerId: string): void {
    if (!orderIndex.has(middleware.id))
      throw new Error(`Unknown harness middleware: ${middleware.id}`);
    if (!middleware.version.trim())
      throw new Error(`Harness middleware has no version: ${middleware.id}`);
    if (!ownerId.trim()) throw new Error(`Harness middleware has no owner: ${middleware.id}`);
    const existing = this.entries.get(middleware.id);
    if (existing) {
      const kind = existing.protected ? "protected harness middleware" : "harness middleware";
      throw new Error(`Cannot replace ${kind}: ${middleware.id}`);
    }
  }
}
