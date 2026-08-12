---
name: dependency-update-planning
description: Plan or review dependency updates from manifests, lockfiles, release notes supplied by the user, and local test evidence.
---

# Dependency Update Planning

1. Inventory direct/transitive dependencies, package managers, lockfiles, runtime constraints, native modules, and release targets.
2. Identify why each update is needed: vulnerability, support policy, compatibility, bug fix, or maintenance. Do not infer vulnerability status without an authoritative advisory.
3. Group tightly coupled packages; isolate unrelated major upgrades. Read migration requirements before changing versions.
4. Evaluate provenance, maintainer/ownership changes, install scripts, binary downloads, license changes, and lockfile diffs.
5. Define the smallest validation matrix covering types, tests, builds, package contents, runtime smoke, and rollback.
6. Never auto-merge or publish. Report unavailable advisories or network evidence as unverified.

Return an update table, grouping strategy, risks, ordered implementation, validation, and rollback.
