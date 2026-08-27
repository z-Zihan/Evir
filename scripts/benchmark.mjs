#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const KIB = 1024;
const MIB = 1024 * KIB;
const WEB_INITIAL_JS_GZIP_BUDGET = 350 * KIB;
const DESKTOP_FRONTEND_TOTAL_BUDGET = 15 * MIB;
const DESKTOP_INSTALLER_TARGET = 120 * MIB;
const DESKTOP_INSTALLER_WARNING = 180 * MIB;

const rootDir = join(fileURLToPath(import.meta.url), "..", "..");
const distRoot = join(rootDir, "dist");
const srcDir = join(rootDir, "src");
const outDir = join(rootDir, "docs", "benchmarks");
const outFile = join(outDir, "latest.json");

function walk(dir) {
  if (!existsSync(dir)) return [];
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

function roundKib(bytes) {
  return Math.round((bytes / KIB) * 100) / 100;
}

function initialJavaScriptFiles(distDir) {
  const indexPath = join(distDir, "index.html");
  const indexHtml = readFileSync(indexPath, "utf8");
  const assetPaths = [...indexHtml.matchAll(/(?:src|href)=["']([^"']+\.js)["']/g)].map((match) =>
    match[1].replace(/^\//, ""),
  );
  return [...new Set(assetPaths.map((assetPath) => join(distDir, assetPath)))];
}

function measureDist(target, expectedSkillChunks) {
  const distDir = join(distRoot, target);
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error(
      `Missing ${relative(rootDir, distDir)}. Run pnpm build:${target === "web" ? "web" : "desktop:frontend"} first.`,
    );
  }

  const files = walk(distDir);
  const jsFiles = files.filter((file) => extname(file) === ".js");
  const cssFiles = files.filter((file) => extname(file) === ".css");
  const skillChunks = jsFiles.filter((file) => /^SKILL-.*\.js$/.test(file.split("/").at(-1) ?? ""));
  const initialJsFiles = initialJavaScriptFiles(distDir);

  const totalSizeBytes = files.reduce((total, file) => total + statSync(file).size, 0);
  const jsSizeBytes = jsFiles.reduce((total, file) => total + statSync(file).size, 0);
  const jsGzipSizeBytes = jsFiles.reduce(
    (total, file) => total + gzipSync(readFileSync(file)).length,
    0,
  );
  const initialJsGzipSizeBytes = initialJsFiles.reduce(
    (total, file) => total + gzipSync(readFileSync(file)).length,
    0,
  );
  const cssGzipSizeBytes = cssFiles.reduce(
    (total, file) => total + gzipSync(readFileSync(file)).length,
    0,
  );

  return {
    fileCount: files.length,
    files: files.map((file) => relative(distDir, file)),
    totalSizeBytes,
    totalSizeKB: roundKib(totalSizeBytes),
    jsSizeBytes,
    jsSizeKB: roundKib(jsSizeBytes),
    jsGzipSizeBytes,
    jsGzipSizeKB: roundKib(jsGzipSizeBytes),
    initialJsGzipSizeBytes,
    initialJsGzipSizeKB: roundKib(initialJsGzipSizeBytes),
    initialJsFiles: initialJsFiles.map((file) => relative(distDir, file)),
    cssGzipSizeBytes,
    cssGzipSizeKB: roundKib(cssGzipSizeBytes),
    skillChunkCount: skillChunks.length,
    expectedSkillChunkCount: expectedSkillChunks,
    skillChunkStatus: skillChunks.length === expectedSkillChunks ? "pass" : "fail",
  };
}

function measureInstallerArtifacts() {
  const targetDir = join(rootDir, "src-tauri", "target");
  const installerInputs = [
    ...walk(join(rootDir, "src")),
    ...walk(join(rootDir, "skills")),
    ...walk(join(rootDir, "src-tauri", "src")),
    join(rootDir, "package.json"),
    join(rootDir, "vite.config.ts"),
    join(rootDir, "src-tauri", "tauri.conf.json"),
    join(rootDir, "src-tauri", "Cargo.toml"),
  ].filter(existsSync);
  const newestInputMtimeMs = Math.max(0, ...installerInputs.map((file) => statSync(file).mtimeMs));
  const artifacts = walk(targetDir).filter((file) => {
    const normalized = file.replaceAll("\\", "/");
    return (
      normalized.includes("/release/bundle/") &&
      (/\.(?:dmg|msi|exe|deb|AppImage)$/.test(file) || /\.app\.tar\.gz$/.test(file))
    );
  });

  return artifacts.map((file) => {
    const fileStat = statSync(file);
    const sizeBytes = fileStat.size;
    const status =
      sizeBytes <= DESKTOP_INSTALLER_TARGET
        ? "within-target"
        : sizeBytes <= DESKTOP_INSTALLER_WARNING
          ? "within-warning"
          : "exceeds-warning";
    return {
      path: relative(rootDir, file),
      sizeBytes,
      sizeMB: Math.round((sizeBytes / MIB) * 100) / 100,
      modifiedAt: fileStat.mtime.toISOString(),
      currentForInputs: fileStat.mtimeMs >= newestInputMtimeMs,
      status,
    };
  });
}

function measureSourceFiles() {
  const files = walk(srcDir).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const testFiles = files.filter((file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"));
  return { tsFileCount: files.length, testFileCount: testFiles.length };
}

function measureTests() {
  const localVitest = join(rootDir, "node_modules", ".bin", "vitest");
  const jsonOutFile = join(tmpdir(), `evir-vitest-${process.pid}.json`);
  const executable = existsSync(localVitest) ? localVitest : "pnpm";
  const args = existsSync(localVitest)
    ? ["run", "src", "--reporter=json", `--outputFile=${jsonOutFile}`]
    : ["exec", "vitest", "run", "src", "--reporter=json", `--outputFile=${jsonOutFile}`];

  const start = performance.now();
  execFileSync(executable, args, { cwd: rootDir, stdio: "ignore" });
  const durationMs = performance.now() - start;
  const report = JSON.parse(readFileSync(jsonOutFile, "utf8"));
  rmSync(jsonOutFile, { force: true });

  return {
    durationMs: Math.round(durationMs),
    durationSec: Math.round(durationMs / 10) / 100,
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
  const web = measureDist("web", 10);
  const desktopFrontend = measureDist("desktop", 36);
  const installerArtifacts = measureInstallerArtifacts();
  const result = {
    timestamp: new Date().toISOString(),
    budgets: {
      webInitialJsGzipBytes: WEB_INITIAL_JS_GZIP_BUDGET,
      desktopFrontendTotalBytes: DESKTOP_FRONTEND_TOTAL_BUDGET,
      desktopInstallerTargetBytes: DESKTOP_INSTALLER_TARGET,
      desktopInstallerWarningBytes: DESKTOP_INSTALLER_WARNING,
    },
    web: {
      ...web,
      budgetStatus: web.initialJsGzipSizeBytes <= WEB_INITIAL_JS_GZIP_BUDGET ? "pass" : "fail",
    },
    desktop: {
      frontend: {
        ...desktopFrontend,
        budgetStatus:
          desktopFrontend.totalSizeBytes <= DESKTOP_FRONTEND_TOTAL_BUDGET ? "pass" : "fail",
      },
      installers: {
        status:
          installerArtifacts.length === 0
            ? "not-measured"
            : installerArtifacts.every((artifact) => artifact.currentForInputs)
              ? "measured-current"
              : "stale-artifacts",
        artifacts: installerArtifacts,
      },
    },
    source: measureSourceFiles(),
    tests: measureTests(),
    dependencies: measureDependencies(),
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nBenchmark written to ${relative(rootDir, outFile)}`);

  const hardFailures = [
    result.web.budgetStatus === "fail" && "Web initial JavaScript exceeds 350 KiB gzip",
    result.web.skillChunkStatus === "fail" && "Web Skill chunk count is not 10",
    result.desktop.frontend.budgetStatus === "fail" && "Desktop frontend resources exceed 15 MiB",
    result.desktop.frontend.skillChunkStatus === "fail" && "Desktop Skill chunk count is not 36",
    installerArtifacts.some((artifact) => artifact.status === "exceeds-warning") &&
      "A Desktop installer exceeds the 180 MiB warning ceiling",
  ].filter(Boolean);

  if (hardFailures.length > 0) {
    for (const failure of hardFailures) console.error(`Benchmark failure: ${failure}`);
    process.exitCode = 1;
  }
}

main();
