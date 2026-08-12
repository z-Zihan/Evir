---
name: project-onboarding
description: Use on Desktop when mapping an unfamiliar local repository, explaining its architecture, or preparing evidence-backed onboarding notes.
---

# Project Onboarding

Adapted for Evir from Awesome Copilot `acquire-codebase-knowledge`. The original bundled scanner
and templates are not assumed; this version is self-contained.

## Evidence-first map

1. Read repository instructions, README, product and architecture specifications before source.
2. Inventory manifests, workspaces, entry points, source/test directories, generated outputs,
   CI, release files, storage, external integrations, and environment examples.
3. Trace one representative user action from presentation through services, ports, adapters, and
   persisted or external effects.
4. Compare stated intent with current implementation. Label verified fact, documented intent,
   inference, unknown, and drift separately.
5. Inspect test layout, quality commands, recent high-churn areas, and known-risk registers.

Produce a concise map of purpose, products, stack, directory responsibilities, runtime data flow,
boundaries, testing, development commands, integrations, risks, and open questions. Cite concrete
paths for non-trivial claims. Ignore generated build directories and never treat historical
documentation as current runtime proof without source corroboration.
