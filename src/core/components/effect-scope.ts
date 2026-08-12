import type { ComponentDisposer } from "./types";

function once(disposer: ComponentDisposer): ComponentDisposer {
  let armed = true;
  return () => {
    if (!armed) return;
    armed = false;
    disposer();
  };
}

export class EffectScope {
  private readonly disposers: ComponentDisposer[] = [];
  private disposed = false;

  add(disposer: ComponentDisposer): ComponentDisposer {
    const guarded = once(disposer);
    if (this.disposed) {
      guarded();
      return guarded;
    }
    this.disposers.push(guarded);
    return guarded;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const disposer of this.disposers.reverse()) {
      try {
        disposer();
      } catch (error) {
        errors.push(error);
      }
    }
    this.disposers.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more component effects could not be disposed");
    }
  }
}
