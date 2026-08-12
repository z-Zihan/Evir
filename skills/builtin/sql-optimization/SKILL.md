---
name: sql-optimization
description: Investigate a slow SQL query from query text, schema, execution plan, statistics, and workload evidence.
---

# SQL Optimization

1. Establish the database engine/version, query, parameters, data volume, latency baseline, concurrency, and correctness constraints.
2. Require an execution plan or clearly label all conclusions as hypotheses. Do not optimize from formatting or intuition alone.
3. Locate the dominant cost: scans, joins, sorts, spills, row-estimate error, contention, network transfer, or repeated execution.
4. Consider query shape, index design, statistics, partitioning, batching, caching, and application access patterns in that order.
5. Evaluate write cost, storage, lock behavior, plan stability, and rollback for every index or schema proposal.
6. Compare before/after with identical parameters and workload conditions; verify result equivalence.

Return baseline, ranked hypotheses, smallest safe experiment, expected tradeoffs, verification commands, and rollback.
