#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { readFileSync, statSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(rootDir, "dist");
const outDir = join(rootDir, "docs", "benchmarks");
const outFile = join(outDir, "latest.json");

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function measureDist() {
  const files = walk(distDir);
  let totalSize = 0;
  let jsGzipSize = 0;
  for (const file of files) {
    const size = statSync(file).size;
    totalSize += size;
    if (extname(file) === ".js") {
      const contents = readFileSync(file);
      jsGzipSize += gzipSync(contents).length;
    }
  }
  return {
    fileCount: files.length,
    totalSizeBytes: totalSize,
    jsGzipSizeBytes: jsGzipSize,
    files: files.map((f) => relative(distDir, f)),
  };
}

function measureTestDuration() {
  const localVitest = join(rootDir, "node_modules", ".bin", "vitest");
  const command = existsSync(localVitest) ? `${localVitest} run` : "pnpm test";
  const start = performance.now();
  execSync(command, { cwd: rootDir, stdio: "ignore" });
  const durationMs = performance.now() - start;
  return durationMs;
}

function main() {
  const dist = measureDist();
  const testDurationMs = measureTestDuration();

  const result = {
    timestamp: new Date().toISOString(),
    web: {
      jsGzipSizeBytes: dist.jsGzipSizeBytes,
      jsGzipSizeKB: Math.round((dist.jsGzipSizeBytes / 1024) * 100) / 100,
    },
    dist: {
      fileCount: dist.fileCount,
      totalSizeBytes: dist.totalSizeBytes,
      totalSizeKB: Math.round((dist.totalSizeBytes / 1024) * 100) / 100,
    },
    tests: {
      durationMs: Math.round(testDurationMs),
      durationSec: Math.round(testDurationMs / 10) / 100,
    },
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");

  console.log(JSON.stringify(result, null, 2));
  console.log(`\nBenchmark written to ${relative(rootDir, outFile)}`);
}

main();
