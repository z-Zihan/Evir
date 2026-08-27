import { describe, expect, it } from "vitest";

import { FileLogSink, type FileLogSinkFsOps } from "../file-log-sink";

interface FakeFileSystem {
  files: Map<string, { contents: string; bytes: number }>;
  mkdirCalls: number;
}

function fakeFs(files: string[] = []): FakeFileSystem & { fsOps: FileLogSinkFsOps } {
  const state: FakeFileSystem = { files: new Map(), mkdirCalls: 0 };
  for (const name of files) state.files.set(name, { contents: "", bytes: 0 });
  const resolve = (path: string) => path.replace(/^\/logs\/?/, "");
  return {
    files: state.files,
    get mkdirCalls() {
      return state.mkdirCalls;
    },
    fsOps: {
      mkdir: () => {
        state.mkdirCalls += 1;
        return Promise.resolve();
      },
      appendFile: (path: string, contents: string) => {
        const key = resolve(path);
        const existing = state.files.get(key) ?? { contents: "", bytes: 0 };
        state.files.set(key, {
          contents: existing.contents + contents,
          bytes: existing.bytes + contents.length,
        });
        return Promise.resolve();
      },
      readDir: () => Promise.resolve([...state.files.keys()]),
      removeFile: (path: string) => {
        state.files.delete(resolve(path));
        return Promise.resolve();
      },
      statSize: (path: string) => Promise.resolve(state.files.get(resolve(path))?.bytes ?? 0),
    },
  };
}

const NOW = new Date(2026, 7, 27, 10, 30, 0);

describe("FileLogSink", () => {
  it("appends newline-terminated JSONL per category and day", async () => {
    const fs = fakeFs();
    const sink = new FileLogSink({
      directory: "/logs",
      fsOps: fs.fsOps,
      now: () => NOW,
    });

    await sink.append("app", '{"event":"a"}');
    await sink.append("audit", '{"event":"b"}');
    await sink.append("performance", '{"event":"c"}');
    await sink.append("app", '{"event":"d"}');

    expect(fs.files.get("app-2026-08-27.jsonl")?.contents).toBe('{"event":"a"}\n{"event":"d"}\n');
    expect(fs.files.get("audit-2026-08-27.jsonl")?.contents).toBe('{"event":"b"}\n');
    expect(fs.files.get("performance-2026-08-27.jsonl")?.contents).toBe('{"event":"c"}\n');
    expect(fs.mkdirCalls).toBe(1);
  });

  it("rotates to a numbered suffix once the daily file exceeds the size cap", async () => {
    const fs = fakeFs(["app-2026-08-27.jsonl"]);
    fs.files.set("app-2026-08-27.jsonl", { contents: "x".repeat(100), bytes: 100 });
    const sink = new FileLogSink({
      directory: "/logs",
      fsOps: fs.fsOps,
      now: () => NOW,
      maxFileBytes: 100,
    });

    await sink.append("app", '{"event":"next"}');

    expect(fs.files.get("app-2026-08-27.jsonl")?.contents).toBe("x".repeat(100));
    expect(fs.files.get("app-2026-08-27.1.jsonl")?.contents).toBe('{"event":"next"}\n');
  });

  it("deletes expired files during initialization but keeps recent ones", async () => {
    const fs = fakeFs([
      "app-2026-08-01.jsonl",
      "app-2026-08-26.jsonl",
      "not-a-log.txt",
      "audit-2026-08-20.jsonl",
    ]);
    fs.files.set("app-2026-08-01.jsonl", { contents: "old", bytes: 3 });
    fs.files.set("app-2026-08-26.jsonl", { contents: "new", bytes: 3 });
    fs.files.set("audit-2026-08-20.jsonl", { contents: "keep", bytes: 4 });
    const sink = new FileLogSink({
      directory: "/logs",
      fsOps: fs.fsOps,
      now: () => NOW,
    });

    await sink.append("app", '{"event":"a"}');

    expect(fs.files.has("app-2026-08-01.jsonl")).toBe(false);
    expect(fs.files.has("app-2026-08-26.jsonl")).toBe(true);
    expect(fs.files.has("audit-2026-08-20.jsonl")).toBe(true);
    expect(fs.files.has("not-a-log.txt")).toBe(true);
  });

  it("removes the oldest files first when the total budget is exceeded", async () => {
    const fs = fakeFs(["app-2026-08-20.jsonl", "app-2026-08-21.jsonl", "app-2026-08-22.jsonl"]);
    fs.files.set("app-2026-08-20.jsonl", { contents: "a".repeat(50), bytes: 50 });
    fs.files.set("app-2026-08-21.jsonl", { contents: "b".repeat(50), bytes: 50 });
    fs.files.set("app-2026-08-22.jsonl", { contents: "c".repeat(50), bytes: 50 });
    const sink = new FileLogSink({
      directory: "/logs",
      fsOps: fs.fsOps,
      now: () => NOW,
      totalBudgetBytes: 100,
    });

    await sink.append("app", '{"event":"a"}');

    expect(fs.files.has("app-2026-08-20.jsonl")).toBe(false);
    expect(fs.files.has("app-2026-08-21.jsonl")).toBe(true);
    expect(fs.files.has("app-2026-08-22.jsonl")).toBe(true);
  });

  it("propagates directory creation failures so the logger can disable the sink", async () => {
    const failingOps: FileLogSinkFsOps = {
      mkdir: () => Promise.reject(new Error("readonly filesystem")),
      appendFile: () => Promise.resolve(),
    };
    const sink = new FileLogSink({ directory: "/logs", fsOps: failingOps, now: () => NOW });
    await expect(sink.append("app", "{}")).rejects.toThrow("readonly filesystem");
    // Initialization failure is not cached: a later attempt may succeed.
    const fs = fakeFs();
    const recovering = new FileLogSink({ directory: "/logs", fsOps: fs.fsOps, now: () => NOW });
    await expect(recovering.append("app", "{}")).resolves.toBeUndefined();
  });
});
