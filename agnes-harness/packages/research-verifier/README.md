# `@agnes/research-verifier`

Deterministic NP-witness verification for research runs. The verifier accepts only structured
instance, certificate, ruleset, artifact, ledger, and replay data. It never calls an LLM, network,
filesystem paths, or the current clock.

```ts
import { verifyCertificate, verificationExitCode } from '@agnes/research-verifier'

const report = verifyCertificate({ certificate, artifacts, ledger, replay })
process.exitCode = verificationExitCode(report.status)
```

Reports are stable for identical inputs and include `rule_id`, `status`, `message`, evidence refs,
observed/expected values, and the blocking flag. `unknown` is preserved as a first-class result.
Schemas are in `schema/certificate.schema.json` and `schema/report.schema.json`.
