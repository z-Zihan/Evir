import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const temporary = await mkdtemp(path.join(os.tmpdir(), "evir-cli-smoke-"));
const server = createServer((socket) => {
  socket.once("data", () => {
    socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n");
    socket.write(
      `data: ${JSON.stringify({ id: "smoke", choices: [{ delta: { content: "Evir" } }] })}\n\n`,
    );
    socket.write(
      `data: ${JSON.stringify({ id: "smoke", choices: [{ delta: { content: " CLI works" }, finish_reason: "stop" }] })}\n\n`,
    );
    socket.write("data: [DONE]\n\n");
    socket.end();
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
  const executable = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const linkedExecutable = path.join(temporary, "evir");
  if (process.platform !== "win32") await symlink(executable, linkedExecutable);
  const launchPath = process.platform === "win32" ? executable : linkedExecutable;
  const child = spawn(process.execPath, [launchPath, "ask", "hello"], {
    env: { ...process.env, EVIR_CONFIG_DIR: configDirectory, EVIR_API_KEY: "fixture-key" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errorOutput = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (errorOutput += chunk.toString()));
  const code = await new Promise((resolve) => child.once("close", resolve));
  if (code !== 0) throw new Error(`CLI exited with ${code}: ${errorOutput}`);
  if (output.trim() !== "Evir CLI works") throw new Error(`Unexpected CLI output: ${output}`);
  process.stdout.write(`CLI process smoke passed: ${output.trim()}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
