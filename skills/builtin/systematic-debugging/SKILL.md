---
name: systematic-debugging
description: Use when a bug, failing test, crash, performance regression, build failure, or unexplained behavior needs diagnosis.
---

# Systematic Debugging

Adapted for Evir from Superpowers `systematic-debugging`.

## Core rule

Find evidence for the root cause before changing production behavior. A plausible symptom fix
is not a diagnosis.

## Phase 1: Reproduce and locate

1. Read the full error, stack, exit code, and surrounding warnings.
2. Reproduce with the smallest stable command or user path. If it is intermittent, record the
   conditions instead of guessing.
3. Inspect recent changes, configuration, environment differences, and a working analogue.
4. At each component boundary, compare validated input, output, and state. Log safe metadata,
   never credentials or full private content.
5. Trace the bad value or state backward to its first incorrect origin.

## Phase 2: Form one hypothesis

State: "The root cause is X because evidence Y distinguishes it from alternatives Z." Test one
variable with the smallest reversible experiment. If it fails, discard the hypothesis rather
than stacking another speculative change.

## Phase 3: Fix and prove

1. Add the narrowest regression test or deterministic reproduction.
2. Verify it fails for the expected reason.
3. Implement one root-cause fix without unrelated refactoring.
4. Re-run the focused test, affected suite, and original user path where possible.
5. Report the cause, change, evidence, and any unverified environment.

After three failed fix attempts, stop adding patches and reassess the architecture or missing
observability. Preserve user changes and never disable checks to manufacture a pass.
