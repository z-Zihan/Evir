---
name: cli-design
description: Design or review a CLI command, argument model, terminal output, exit codes, cancellation, and automation contract.
---

# CLI Design

1. Identify interactive users, scripts, supported platforms, input sources, and stable outputs.
2. Make commands and flags composable. Reject ambiguous positional arguments, silent coercion, and undocumented precedence.
3. Keep machine output on stdout and progress/errors on stderr. Define stable exit codes and `--json` schemas when automation needs them.
4. Use safe defaults. Destructive or external actions need explicit scope, preview, confirmation, and non-interactive refusal rules.
5. Specify cancellation, timeouts, partial results, no-color mode, narrow terminals, and localization boundaries.
6. Test help, missing values, unknown flags, conflicting flags, pipes, non-TTY execution, Ctrl+C, and platform path differences.

Return the command grammar, examples, output contract, error matrix, safety rules, and acceptance tests.
