---
name: skill-creator
description: Use when creating, adapting, evaluating, or improving an Agent Skill and its trigger description.
---

# Skill Creator

Adapted for Evir from Superpowers `writing-skills`.

## Define the behavior first

Capture the user task, triggering phrases and contexts, expected output, non-goals, tools,
platform restrictions, risk, and objective success evidence. A Skill teaches judgment or a
reusable method; deterministic constraints belong in code, schemas, or tests.

## Authoring rules

- Use a lowercase hyphenated identifier and a concrete name.
- Make the description answer only "when should this load?" with real symptoms and synonyms.
- Keep the main file focused; every referenced resource must be bundled and loadable by the
  target runtime.
- Use imperative steps, decision points, recovery paths, and a verifiable output contract.
- State required and optional capabilities accurately. A Skill never grants tools or bypasses
  mode, workspace, network, or approval policy.
- Remove platform-specific paths, commands, sub-agent assumptions, and dependencies that the
  target runtime does not provide.
- Record upstream author, repository, license, path, immutable revision, and whether content was
  modified.

## Evaluate

Create representative positive, negative, and ambiguous prompts. Verify that the Skill triggers
when useful, stays inactive when irrelevant, improves the result over baseline, respects safety
boundaries, and does not require missing files. Review token cost and trim repeated instructions.

Before bundling third-party content, verify its license and retain required notices. Default new
Skills to disabled so users opt into context and behavior changes.
