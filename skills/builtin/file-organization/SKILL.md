---
name: file-organization
description: Use on Desktop when safely classifying, renaming, moving, deduplicating, or organizing files inside an authorized workspace.
---

# File Organization

Adapted for Evir from Awesome Copilot `batch-files`.

## Plan before mutation

1. Confirm the authorized root, intended organization rule, naming convention, exclusions, and
   whether hidden files or symlinks are in scope.
2. Inventory metadata first. Read contents only when classification requires it; do not expose
   private file bodies in logs or summaries.
3. Produce a deterministic old-path to new-path plan. Detect collisions, case-only renames,
   duplicate targets, broken references, unsupported characters, and workspace escapes.
4. Preview counts and representative examples before a large batch.
5. Apply reversible moves or renames in small batches and verify existence, counts, and hashes
   where identity matters.

Default to no deletion. Treat duplicates as candidates until content hashes and user intent prove
they are safe to remove. Deletion, overwrite, archive replacement, and workspace-external moves
require explicit approval. End with changed paths, skipped conflicts, verification, and rollback
information.
