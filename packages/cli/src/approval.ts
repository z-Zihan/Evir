import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export async function requestApproval(
  message: string,
  input: Readable = process.stdin,
  output: Writable = process.stderr,
): Promise<boolean> {
  if (!(input as NodeJS.ReadStream).isTTY) {
    throw new Error("Refusing a write or command without an interactive terminal approval");
  }
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(`\nApproval required\n${message}\nAllow once? [y/N] `);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}
