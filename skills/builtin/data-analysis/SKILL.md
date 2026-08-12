---
name: data-analysis
description: Use on Desktop when profiling, cleaning, comparing, or analyzing local CSV, TSV, JSON, or spreadsheet-like data with reproducible evidence.
---

# Local Data Analysis

Adapted for Evir from Anthropic's `xlsx` Skill. This version uses only tools available in the
current Desktop runtime and does not assume a spreadsheet application or Python library exists.

## Analysis contract

1. Confirm the question, unit of analysis, source files, expected grain, key fields, privacy
   constraints, and desired output.
2. Inspect schema, encoding, delimiters, row count, types, missingness, duplicates, invalid values,
   date/time zones, numeric units, and category cardinality before calculating results.
3. Preserve raw inputs. Put transformations in a new file or script and record every filtering,
   coercion, join, aggregation, and exclusion rule.
4. Validate joins for one-to-one, one-to-many, and unmatched rows. Reconcile row counts and totals
   before and after each transformation.
5. Separate observed facts from interpretation. Quantify uncertainty and avoid causal claims from
   descriptive data alone.

Deliver the question, sources, method, quality findings, results, limitations, and exact
reproduction steps. Never install a dependency or send local data to a network service without
explicit permission.
