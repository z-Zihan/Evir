---
name: code-review
description: Use on Desktop when reviewing a diff, commit, branch, or local code for correctness, regressions, security, performance, and maintainability.
---

# Code Review

Adapted for Evir from Awesome Copilot `review-and-refactor`. This version is review-only unless
the user separately asks for fixes.

## Review contract

1. Resolve the exact scope: working tree, staged diff, commit range, branch, or named files.
2. Read repository instructions and the surrounding implementation, not only the changed lines.
3. Understand the intended behavior and trace each change through callers, state, persistence,
   errors, permissions, cancellation, concurrency, and user-visible output.
4. Run focused read-only checks when they materially improve confidence. Never mutate the tree
   merely to review it.
5. Report only issues the author can act on and that were introduced or exposed by the scope.

## Finding format

For every finding include severity, a tight file/line location, the triggering condition, the
concrete impact, why current tests do not prevent it, and the smallest credible fix. Prioritize
correctness, data loss, security, broken contracts, and regressions over style preferences.

If no actionable findings remain, say so and list residual verification gaps. Do not equate a
clean diff scan with proof that the feature works in its real runtime.
