import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { cliStrings, type CliStrings } from "./messages";

export async function requestApproval(
  message: string,
  input: Readable = process.stdin,
  output: Writable = process.stderr,
  strings: CliStrings = cliStrings(),
): Promise<boolean> {
  if (!(input as NodeJS.ReadStream).isTTY) {
    // CLI-2: non-TTY defaults to refusing writes/execution.
    throw new Error(strings.nonInteractiveRefusal);
  }
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(
      `\n${strings.approvalTitle}\n${message}\n${strings.approvalAllowOnce}`,
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}
