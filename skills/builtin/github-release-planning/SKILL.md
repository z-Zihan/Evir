---
name: github-release-planning
description: Prepare or review a GitHub release plan from local repository evidence without publishing the release.
---

# GitHub Release Planning

Publishing, tagging, uploading, and signing are external or high-risk actions and always require explicit approval.

1. Confirm version, target commit, supported platforms/architectures, artifact matrix, compatibility, and migration impact.
2. Verify the working tree, branch, tests, builds, package contents, version consistency, licenses, and generated checksums.
3. Separate current evidence from stale artifacts. A previous package or configured workflow is not proof for the target commit.
4. Draft release notes from reviewed changes: highlights, fixes, breaking changes, migration, known issues, and download guidance.
5. Define signing/notarization, provenance, upload, tag, and release steps with approval points.
6. Provide rollback and incident steps for a bad tag, package, updater entry, or partial platform release.

Return a go/no-go table, artifact matrix, notes draft, ordered publication plan, approvals, and unresolved blockers.
