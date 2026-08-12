---
name: architecture-decision-record
description: Use when a consequential technical choice needs a durable record of context, alternatives, trade-offs, and follow-up evidence.
---

# Architecture Decision Record

Adapted for Evir from Awesome Copilot `create-architectural-decision-record`.

## Before writing

Inspect existing ADR naming, status, directory, and template conventions. Gather the decision
driver, constraints, stakeholders, alternatives, reversibility, rollout, and validation. Do not
invent rationale that decision makers did not provide; mark unknown intent explicitly.

## Record structure

1. **Title and status** — proposed, accepted, rejected, superseded, or deprecated.
2. **Date and owners** — use known roles or names only.
3. **Context** — the problem, forces, evidence, and constraints that make a choice necessary.
4. **Decision** — the selected option and why it best satisfies those forces.
5. **Consequences** — positive outcomes, costs, operational burden, risks, and future limits.
6. **Alternatives** — serious options considered and the evidence-based reason each was not
   chosen.
7. **Implementation and validation** — migration, rollback, compatibility, monitoring, success
   criteria, and review date.
8. **References** — related ADRs, issues, specifications, benchmarks, or authoritative sources.

Use precise, stable language. Separate current facts from forecasts. If the decision changes,
supersede the record with a linked ADR rather than rewriting history. Follow project conventions
for filenames; if none exist, propose `docs/adr/NNNN-short-title.md` without silently creating a
new documentation system.
