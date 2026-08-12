---
name: requirements-discovery
description: Use when a feature, workflow, or behavior change is underspecified and multiple materially different solutions are plausible.
---

# Requirements Discovery

Adapted for Evir from Superpowers `brainstorming`. It keeps the discovery discipline while
respecting direct user requests to execute and never creates mandatory process gates.

## Outcome

Turn an ambiguous request into a small, testable solution before implementation expands its
scope. Prefer evidence from the current project over questions the project can answer.

## Workflow

1. Inspect the relevant product rules, existing behavior, code, and recent changes.
2. State known facts, user-provided facts, assumptions, and unresolved decisions separately.
3. Identify the user's job, the current obstacle, the desired result, and non-goals.
4. Produce two or three structurally different approaches. For each, explain user flow,
   failure modes, cost, risk, and why it might not work.
5. Recommend the smallest approach that satisfies the outcome and preserves existing product
   constraints.
6. Define normal, empty, loading, partial, error, denied, timeout, cancel, and recovery states
   that actually apply.
7. Write measurable acceptance criteria and verification evidence.

## Interaction rule

Ask only when a missing choice would materially change the result and cannot be discovered.
For a direct implementation request, make safe assumptions explicit and continue. Do not force
the user through a ceremony for a small or reversible change.

## Output

- Problem and user outcome
- Facts and assumptions
- Options and recommendation
- Main flow and relevant edge states
- Scope and non-goals
- Acceptance criteria
- Risks and open decisions
