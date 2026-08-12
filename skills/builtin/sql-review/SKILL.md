---
name: sql-review
description: Review SQL files or snippets for correctness, safety, data assumptions, portability, and maintainability without executing against production.
---

# SQL Review

1. Identify the database dialect, schema evidence, expected cardinality, null behavior, transaction boundary, and read/write intent.
2. Trace joins, filters, grouping, windows, and set operations for duplicate rows or accidental data loss.
3. Treat dynamic SQL, unbounded changes, missing predicates, privilege changes, and destructive DDL as high risk.
4. Check parameterization, identifier handling, transaction safety, locking, retry behavior, and migration reversibility.
5. Separate confirmed defects from questions that require schema or data statistics.
6. Do not run against production or claim performance from syntax alone.

Return findings ordered by risk with query location, failure scenario, evidence, proposed correction, and a verification query or test.
