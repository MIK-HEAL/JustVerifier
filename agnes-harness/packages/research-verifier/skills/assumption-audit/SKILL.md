---
name: assumption-audit
description: Build an explicit assumption checklist with observable checks, evidence references, severity, and unknown reasons for a research certificate.
---

# Assumption audit

For every assumption required by the instance, create a structured record with:

- `id` and a precise `statement`;
- `required_for` claim IDs;
- `observable_checks` that can be evaluated from the run;
- `status`: `satisfied`, `violated`, `unknown`, or `not-applicable`;
- evidence references and an `unknown_reason` when a check cannot be observed;
- `severity` set to `error` when violation blocks the certificate.

Do not infer satisfaction from prose or from an agent's confidence. A missing check remains `unknown` and is reported by the deterministic verifier.
