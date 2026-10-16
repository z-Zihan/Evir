import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";

const temporary = await mkdtemp(path.join(os.tmpdir(), "evir-cli-smoke-"));

function sendSse(socket) {
  socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n");
  socket.write(
    `data: ${JSON.stringify({ id: "smoke", choices: [{ delta: { content: "Evir" } }] })}\n\n`,
  );
  socket.write(
    `data: ${JSON.stringify({ id: "smoke", choices: [{ delta: { content: " CLI works" }, finish_reason: "stop" }] })}\n\n`,
  );
  socket.write("data: [DONE]\n\n");
  socket.end();
}

function sendChatCompletion(socket) {
  const body = JSON.stringify({
    id: "smoke",
    choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  });
  socket.write(
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.end();
}

// Routes by request body: both `ask` and doctor's provider-connection probe
// POST to /chat/completions, but doctor's testConnection sends `stream:false`
// (expects a plain JSON 200) while `ask` sends `stream:true` (expects SSE).
const server = createServer((socket) => {
  socket.once("data", (chunk) => {
    const request = chunk.toString("utf8");
    const requestLine = request.split("\r\n", 1)[0] ?? "";
    const [method, requestPath] = requestLine.split(" ");
    const isChatCompletions = method === "POST" && requestPath?.endsWith("/chat/completions");
    if (isChatCompletions && /"stream"\s*:\s*false/.test(request)) {
      sendChatCompletion(socket);
    } else {
      sendSse(socket);
    }
  });
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start fixture Provider");
  const configDirectory = path.join(temporary, "config");
  await mkdir(path.join(configDirectory, "evir"), { recursive: true });
  await writeFile(
    path.join(configDirectory, "evir", "providers.json"),
    `${JSON.stringify({ version: 1, providers: [{ id: "fixture", name: "Fixture", protocolId: "openai-compatible-chat", baseUrl: `http://127.0.0.1:${address.port}/v1`, modelId: "fixture", toolCalling: false, enabled: true, isDefault: true, createdAt: 1, updatedAt: 1 }] })}\n`,
  );
  const noKeyConfigDirectory = path.join(temporary, "config-nokey");
  await mkdir(path.join(noKeyConfigDirectory, "evir"), { recursive: true });
  await writeFile(
    path.join(noKeyConfigDirectory, "evir", "providers.json"),
    `${JSON.stringify({ version: 1, providers: [{ id: "fixture-nokey", name: "Fixture No Key", protocolId: "openai-compatible-chat", baseUrl: `http://127.0.0.1:${address.port}/v1`, modelId: "fixture", toolCalling: false, enabled: true, isDefault: true, createdAt: 1, updatedAt: 1 }] })}\n`,
  );
  const executable = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const linkedExecutable = path.join(temporary, "evir");
  if (process.platform !== "win32") await symlink(executable, linkedExecutable);
  const launchPath = process.platform === "win32" ? executable : linkedExecutable;
  const baseEnv = { ...process.env, EVIR_CONFIG_DIR: configDirectory, EVIR_API_KEY: "fixture-key" };

  async function runCli(args, env) {
    const child = spawn(process.execPath, [launchPath, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (errorOutput += chunk.toString()));
    const code = await new Promise((resolve) => child.once("close", resolve));
    return { code, output, errorOutput };
  }

  const askResult = await runCli(["ask", "hello"], baseEnv);
  if (askResult.code !== 0)
    throw new Error(`CLI exited with ${askResult.code}: ${askResult.errorOutput}`);
  if (askResult.output.trim() !== "Evir CLI works")
    throw new Error(`Unexpected CLI output: ${askResult.output}`);
  process.stdout.write(`CLI process smoke passed: ${askResult.output.trim()}\n`);

  const EXPECTED_CHECKS = [
    "configuration",
    "provider",
    "api-key",
    "node-in-path",
    "workspace-boundary",
    "provider-connection",
  ];

  const doctorJsonResult = await runCli(["doctor", "--json", "--lang", "zh"], baseEnv);
  if (doctorJsonResult.code !== 0)
    throw new Error(
      `doctor --json exited with ${doctorJsonResult.code}: ${doctorJsonResult.errorOutput}`,
    );
  let doctorReport;
  try {
    doctorReport = JSON.parse(doctorJsonResult.output);
  } catch {
    throw new Error(`doctor --json produced invalid JSON: ${doctorJsonResult.output}`);
  }
  if (doctorReport.version !== VERSION)
    throw new Error(
      `doctor --json reported unexpected version: ${JSON.stringify(doctorReport.version)}`,
    );
  if (doctorReport.healthy !== true)
    throw new Error(`doctor --json reported unhealthy: ${JSON.stringify(doctorReport)}`);
  const reportedNames = new Set(doctorReport.checks?.map((check) => check.name));
  for (const name of EXPECTED_CHECKS) {
    if (!reportedNames.has(name)) throw new Error(`doctor --json missing check: ${name}`);
  }
  for (const check of doctorReport.checks ?? []) {
    if (check.status !== "ok")
      throw new Error(`doctor --json check ${check.name} was not ok: ${check.detail}`);
  }
  process.stdout.write("CLI doctor --json smoke passed\n");

  const doctorLangResult = await runCli(["doctor", "--lang", "zh"], baseEnv);
  if (doctorLangResult.code !== 0)
    throw new Error(
      `doctor --lang zh exited with ${doctorLangResult.code}: ${doctorLangResult.errorOutput}`,
    );
  if (!doctorLangResult.output.includes("Provider 连接"))
    throw new Error(`doctor --lang zh missing localized label: ${doctorLangResult.output}`);
  if (/\bprovider-connection\b/.test(doctorLangResult.output))
    throw new Error(
      `doctor --lang zh unexpectedly used the English label: ${doctorLangResult.output}`,
    );
  process.stdout.write("CLI doctor --lang zh smoke passed\n");

  const noKeyEnv = { ...baseEnv, EVIR_CONFIG_DIR: noKeyConfigDirectory };
  delete noKeyEnv.EVIR_API_KEY;
  const doctorNoKeyResult = await runCli(["doctor"], noKeyEnv);
  if (doctorNoKeyResult.code !== 2)
    throw new Error(
      `doctor without an API key exited with ${doctorNoKeyResult.code}, expected 2: ${doctorNoKeyResult.errorOutput}`,
    );
  const noKeyText = `${doctorNoKeyResult.output}${doctorNoKeyResult.errorOutput}`;
  if (!noKeyText.includes("EVIR_API_KEY"))
    throw new Error(`doctor without an API key did not mention missing key guidance: ${noKeyText}`);
  process.stdout.write("CLI doctor missing-api-key smoke passed\n");

  const corruptConfigDirectory = path.join(temporary, "config-corrupt");
  await mkdir(path.join(corruptConfigDirectory, "evir"), { recursive: true });
  await writeFile(
    path.join(corruptConfigDirectory, "evir", "providers.json"),
    `${JSON.stringify({ version: 1, providers: [{ id: 123 }] })}\n`,
  );
  const corruptEnv = { ...baseEnv, EVIR_CONFIG_DIR: corruptConfigDirectory };
  const doctorCorruptResult = await runCli(["doctor"], corruptEnv);
  if (doctorCorruptResult.code !== 1)
    throw new Error(
      `doctor with a corrupt config exited with ${doctorCorruptResult.code}, expected 1: ${doctorCorruptResult.errorOutput}`,
    );
  const corruptText = `${doctorCorruptResult.output}${doctorCorruptResult.errorOutput}`;
  if (!corruptText.includes("Invalid provider configuration"))
    throw new Error(`doctor with a corrupt config did not mention the diagnostic: ${corruptText}`);
  if (!corruptText.includes("providers[0].id"))
    throw new Error(
      `doctor with a corrupt config did not mention the offending path: ${corruptText}`,
    );
  if (corruptText.includes('"expected"'))
    throw new Error(`doctor with a corrupt config leaked raw Zod issues JSON: ${corruptText}`);
  process.stdout.write("CLI corrupt-config diagnostics smoke passed\n");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
