---
name: research-run
description: Create a structured single-agent research run with immutable input, code, execution, output, environment, and evidence references for deterministic verification.
---

# Research run

Use this Skill to turn a research request into a structured run. Keep the run local and single-agent.

1. Create an `instance` with dataset and analysis specification checksums and explicit assumption IDs.
2. Record each step as an immutable artifact or ledger event. Use opaque `id@version` references; never use a machine path as identity.
3. Produce a `witness` containing source code version, execution ID, input and output version IDs, environment fingerprint, and typed result fields.
4. Add evidence references for the ledger events, artifact versions, and receipts that support the run.
5. Leave unverifiable fields as `unknown` and preserve partial evidence coverage.

The Skill proposes run fields and ordered steps. The deterministic `@agnes/research-verifier` package owns the verification result.
