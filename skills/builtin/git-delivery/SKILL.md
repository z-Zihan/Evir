---
name: git-delivery
description: Use on Desktop when preparing local changes for a clean commit, branch handoff, release note, or pull request description.
---

# Git Delivery

Adapted for Evir from Awesome Copilot `git-commit`.

## Safe workflow

1. Inspect repository root, branch, status, staged/unstaged/untracked files, and recent commit
   conventions.
2. Preserve unrelated user changes. Group only changes that form one coherent outcome.
3. Review the actual diff for secrets, generated artifacts, debug output, accidental binaries,
   and scope creep.
4. Run the verification required by the repository and record its fresh result.
5. Draft a concise commit title and body explaining outcome, reason, important trade-offs, and
   verification. Draft PR text with summary, tests, risks, screenshots or runtime evidence, and
   known gaps.

Do not stage, commit, amend, rebase, push, tag, or open a PR unless the user explicitly requested
that state change. Never rewrite shared history or discard changes. If hooks modify files, inspect
the new diff and re-run affected verification before claiming the handoff is ready.
