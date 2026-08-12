---
name: github-actions-hardening
description: Review or harden GitHub Actions workflow files for least privilege, untrusted input, dependency integrity, secrets, and release safety.
---

# GitHub Actions Hardening

1. Inventory triggers, jobs, permissions, environments, secrets, artifacts, caches, reusable workflows, and third-party actions.
2. Trace attacker-controlled values from pull requests, issue content, branch names, matrices, outputs, and artifacts into shell or privileged jobs.
3. Apply least privilege at workflow and job level. Separate untrusted build jobs from signing, publishing, deployment, and secret-bearing jobs.
4. Prefer immutable action revisions and reviewed reusable workflows. Flag mutable tags, implicit permissions, unsafe checkout, and artifact substitution risks.
5. Inspect shell interpolation, credential persistence, fork behavior, OIDC audience/scope, environment approvals, and log redaction.
6. Validate YAML and run non-publishing checks before claiming success. Never trigger a release or expose a secret as verification.

Return findings by severity with exact workflow location, exploit path, minimal fix, and safe verification.
