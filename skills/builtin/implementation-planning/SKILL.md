---
name: implementation-planning
description: Use when a defined change spans multiple files, layers, migrations, or independently verifiable delivery steps.
---

# Implementation Planning

Adapted for Evir from Superpowers `writing-plans`. Project instructions determine whether a
plan is written to disk, executed immediately, reviewed, or committed.

## Build the plan from evidence

1. Read the governing specifications and map the current implementation.
2. List files to create, modify, and test, with one responsibility per file.
3. Check dependency direction, public interfaces, data migration, permissions, cancellation,
   performance, logging, and compatibility.
4. Split work into the smallest independently testable deliverables. Do not create separate
   tasks for scaffolding that has no user-visible or reviewable result.
5. For behavior changes, place a failing test before the implementation step.
6. Give exact verification commands and expected evidence. Never use placeholders such as
   "add tests" or "handle errors."

## Task template

For each task record:

- Goal and acceptance criterion
- Files and interfaces
- Test that proves the behavior
- Minimal implementation
- Failure, cancellation, and recovery handling where relevant
- Focused verification command
- Integration or documentation updates

## Self-review

Before execution, compare every requirement with a task, scan for ambiguous names and missing
interfaces, and confirm later tasks use types produced by earlier tasks. Keep unrelated cleanup
out of scope. If the user asked for implementation, proceed after this internal check instead of
stopping merely to present the plan.
