---
name: code-tour
description: Explain a local feature, request path, module, or architecture by tracing real files and symbols in execution order.
---

# Code Tour

1. Read repository instructions before code. Define the user action or entry point the tour follows.
2. Trace real symbols and calls from boundary to outcome. Do not infer a path from filenames alone.
3. For each stop, record file, symbol, responsibility, input, output, and the next transition.
4. Separate current behavior from historical rationale and speculation. Use Git evidence only when it materially clarifies the design.
5. Highlight state ownership, error handling, permissions, persistence, and tests along the path.
6. Verify links and line references against the current working tree.

Return a short overview, ordered tour stops, a data/control-flow summary, extension points, risks, and suggested first changes for a newcomer.
