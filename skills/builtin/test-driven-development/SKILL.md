---
name: test-driven-development
description: Use when implementing a behavior change, bug fix, or refactor that can be expressed through automated tests.
---

# Test-Driven Development

Adapted for Evir from Superpowers `test-driven-development`.

## Red, green, refactor

### Red

Write one minimal test describing observable behavior. Prefer real collaborators over mocks;
mock only boundaries that are unavailable, slow, destructive, or nondeterministic. Run the
focused test and confirm it fails because the behavior is missing, not because the test is
broken.

### Green

Implement the smallest production change that makes the test pass. Do not add speculative
options, adjacent cleanup, or a second behavior. Run the focused test, then the affected suite.

### Refactor

Only after green, improve names and remove duplication without changing behavior. Keep tests
green after every meaningful edit.

## Test quality

- Name the behavior and condition, not the implementation method.
- Assert public output, state transition, persisted data, emitted event, or visible UI.
- Include the failure or boundary case that motivated the change.
- Avoid snapshots for logic and avoid tests that merely restate mocks.
- A passing new test without an observed red state is weaker evidence; report that limitation.

## Exceptions

For generated files, dependency metadata, exploratory prototypes, or environments with no
viable test harness, use the strongest deterministic check available and explain why a red-green
cycle was not practical. Never delete or weaken existing tests to reach green.
