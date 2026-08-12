---
name: security-review
description: Use when reviewing code, configuration, dependencies, or data flows for vulnerabilities, secrets exposure, or broken trust boundaries.
---

# Security Review

Adapted for Evir from Awesome Copilot `security-review`. This is a review workflow, not an
authorization to exploit systems, expose secrets, or modify code.

## Review from trust boundaries inward

1. Confirm authorized scope, languages, frameworks, deployment model, identities, assets, and
   trust boundaries.
2. Inspect dependency manifests and lockfiles with the ecosystem's current audit tooling where
   available. Distinguish a known advisory from an old version with no verified vulnerability.
3. Search tracked source and configuration for credential shapes without printing secret values.
4. Trace untrusted inputs across files to sensitive sinks: database queries, HTML, commands,
   paths, network requests, deserialization, authentication, authorization, and cryptography.
5. Check whether framework validation, escaping, middleware, or policy already mitigates each
   candidate.
6. Reproduce safely or provide a minimal data-flow proof. Do not execute destructive payloads.

## Finding standard

Report only actionable findings with:

- Severity and confidence
- Exact file and tight line range
- Attacker-controlled source, path, sink, and missing control
- Concrete impact and prerequisites
- Minimal remediation that fits the current architecture
- Verification method and residual risk

Lead with findings, ordered by severity. Separate confirmed vulnerabilities from hypotheses and
hardening suggestions. Never declare a codebase secure; state the reviewed scope and limitations.
Do not auto-apply patches unless the user separately asks for fixes.
