---
name: release-readiness
description: Use on Desktop when deciding whether a branch, build, package, or product increment is ready to release or hand off.
---

# Release Readiness

Adapted for Evir from Superpowers `finishing-a-development-branch`.

## Gate by real user closure

1. Resolve the release target, version, supported platforms/architectures, acceptance criteria,
   migration, compatibility, security, privacy, and rollback requirements.
2. Inspect branch state and diff. Confirm version consistency, changelog, licenses, generated
   artifacts, secrets, and dependency changes.
3. Run the full current quality gate and build every required target. Treat skips and warnings as
   evidence to classify, not noise to hide.
4. Distinguish unit/fixture/browser evidence from native host operation, signing/notarization,
   installer launch, upgrade, rollback, and real external-service verification.
5. Verify artifact names, architecture, checksums, contents, installation, startup, update path,
   and removal on each promised platform.

Return **ready**, **conditionally ready**, or **not ready**, followed by the few blockers that
prevent real user closure, passed evidence, residual risks, owners, and rollback instructions.
Never publish, push, tag, sign, or upload unless the user explicitly requested that state change.
