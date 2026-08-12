---
name: verification-before-completion
description: Use before claiming that work is complete, fixed, passing, secure, deployed, or ready to merge.
---

# Verification Before Completion

Adapted for Evir from Superpowers `verification-before-completion`.

## Evidence gate

Before making a success claim:

1. Translate the claim into observable evidence.
2. Run the current, complete verification command or user path.
3. Read the full result, exit status, failure count, skipped checks, and warnings.
4. Compare the result with every acceptance criterion.
5. State the proven result and separately list anything not tested.

## Evidence mapping

| Claim                | Required evidence                                              |
| -------------------- | -------------------------------------------------------------- |
| Tests pass           | Fresh test output with zero relevant failures                  |
| Build works          | Target build exits successfully                                |
| Bug fixed            | Original reproduction no longer fails plus regression coverage |
| UI works             | Rendered interaction in relevant viewport/runtime              |
| Agent task completed | Runtime evidence, resulting state, and verifier output         |
| Ready to merge       | Requirements, diff, quality gates, and known-risk review       |

Passing one layer does not prove another: typecheck is not runtime behavior, browser simulation
is not a native desktop run, a fixture is not a real Provider, and a package build is not a
signed installation.

If verification is blocked, report the blocker and the strongest completed evidence without
using completion language. Never infer success from model text, stale output, or another
agent's report.
