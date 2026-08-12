---
name: system-command-planning
description: Plan or review a local command sequence when scope, safety, rollback, platform differences, or verification matter.
---

# System Command Planning

Never treat this Skill as permission to execute. Evir Tool Registry, workspace scope, and approvals remain authoritative.

1. Confirm operating system, shell, exact target, current state, privileges, and acceptable downtime.
2. Prefer read-only discovery before mutation. Resolve paths and targets explicitly; avoid broad globs and unresolved variables.
3. Split the sequence into inspect, change, verify, and recover phases. Explain side effects and expected output for every mutation.
4. Prefer reversible operations, backups, dry runs, and idempotent commands. Identify commands that cannot be rolled back.
5. Never include credentials in argv, logs, or examples. Do not assume elevation, network access, or installed binaries.
6. Stop on changed assumptions or unexpected output; do not chain risky steps blindly.

Return prerequisites, ordered commands as proposals, approval points, verification, rollback, and remaining risks.
