---
name: technical-spike
description: Run a time-bounded technical investigation when one concrete uncertainty blocks architecture, estimation, or implementation.
---

# Technical Spike

1. State one decision-changing question, current hypotheses, constraints, timebox, and success/failure evidence.
2. Read the smallest relevant surface. Do not turn the spike into production implementation or unrelated refactoring.
3. Design the cheapest experiment that distinguishes the hypotheses. Use fixtures and isolated scratch artifacts where possible.
4. Record environment, inputs, commands, versions, measurements, and unexpected results so another person can reproduce it.
5. Separate observed results from interpretation. Include negative results and threats to validity.
6. Cleanly identify throwaway artifacts versus code worth retaining; do not merge a prototype by default.

Return question, hypotheses, method, evidence, result, limitations, recommendation, discarded options, and follow-up work.
