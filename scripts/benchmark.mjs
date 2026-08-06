#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { readFileSync, statSync, readdirSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const rootDir = join(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(rootDir, "dist");
const srcDir = join(rootDir, "src");
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
  let cssGzipSize = 0;
  for (const file of files) {
    const size = statSync(file).size;
    totalSize += size;
    if (extname(file) === ".js") {
      const contents = readFileSync(file);
      jsGzipSize += gzipSync(contents).length;
    } else if (extname(file) === ".css") {
      const contents = readFileSync(file);
      cssGzipSize += gzipSync(contents).length;
    }
  }
  return {
    fileCount: files.length,
    totalSizeBytes: totalSize,
    jsGzipSizeBytes: jsGzipSize,
    cssGzipSizeBytes: cssGzipSize,
    files: files.map((f) => relative(distDir, f)),
  };
}

function measureSourceFiles() {
  const files = walk(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const testFiles = files.filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"));
  return {
    tsFileCount: files.length,
    testFileCount: testFiles.length,
  };
}

function measureTests() {
  const localVitest = join(rootDir, "node_modules", ".bin", "vitest");
  const jsonOutFile = join(tmpdir(), `evir-vitest-${process.pid}.json`);
  const command = existsSync(localVitest)
    ? `${localVitest} run --reporter=json --outputFile=${jsonOutFile}`
    : `pnpm test -- --reporter=json --outputFile=${jsonOutFile}`;

  const start = performance.now();
  execSync(command, { cwd: rootDir, stdio: "ignore" });
  const durationMs = performance.now() - start;

  const report = JSON.parse(readFileSync(jsonOutFile, "utf8"));
  rmSync(jsonOutFile, { force: true });

  return {
    durationMs,
    testSuiteCount: report.numTotalTestSuites,
    testCount: report.numTotalTests,
    passedCount: report.numPassedTests,
    failedCount: report.numFailedTests,
  };
}

function measureDependencies() {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  return {
    dependencyCount: Object.keys(pkg.dependencies ?? {}).length,
    devDependencyCount: Object.keys(pkg.devDependencies ?? {}).length,
  };
}

function main() {
  const dist = measureDist();
  const source = measureSourceFiles();
  const tests = measureTests();
  const deps = measureDependencies();

  const result = {
    timestamp: new Date().toISOString(),
    web: {
      jsGzipSizeBytes: dist.jsGzipSizeBytes,
      jsGzipSizeKB: Math.round((dist.jsGzipSizeBytes / 1024) * 100) / 100,
      cssGzipSizeBytes: dist.cssGzipSizeBytes,
      cssGzipSizeKB: Math.round((dist.cssGzipSizeBytes / 1024) * 100) / 100,
    },
    dist: {
      fileCount: dist.fileCount,
      totalSizeBytes: dist.totalSizeBytes,
      totalSizeKB: Math.round((dist.totalSizeBytes / 1024) * 100) / 100,
    },
    source: {
      tsFileCount: source.tsFileCount,
      testFileCount: source.testFileCount,
    },
    tests: {
      durationMs: Math.round(tests.durationMs),
      durationSec: Math.round(tests.durationMs / 10) / 100,
      testSuiteCount: tests.testSuiteCount,
      testCount: tests.testCount,
      passedCount: tests.passedCount,
      failedCount: tests.failedCount,
    },
    dependencies: {
      dependencyCount: deps.dependencyCount,
      devDependencyCount: deps.devDependencyCount,
    },
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");

  console.log(JSON.stringify(result, null, 2));
  console.log(`\nBenchmark written to ${relative(rootDir, outFile)}`);
}

main();
