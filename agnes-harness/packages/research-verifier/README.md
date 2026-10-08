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
Schemas are in `schema/certificate.schema.json`, `schema/manifest.schema.json`, and
`schema/report.schema.json`. The package also provides a path-free execution manifest, a
claim-to-evidence graph projection, and a JSON CLI:

```sh
pnpm --filter @agnes/research-verifier verify -- verify run.json --graph
```

The two portable Skills in `skills/` are `research-run` and `assumption-audit`. They propose
structured run fields and assumption checks; only the deterministic verifier can issue a report.

The run contract also exposes `buildResearchRunManifest`, `researchEvent`, and
`exportResearchRunPackage`. Packages contain only JSON/text bytes supplied by the caller and are
checked with `verifyResearchRunPackage` before offline replay. `compareResearchReplay` reports
input, artifact, Skill, MCP schema, command, and activity differences by field; an unavailable or
failed receipt remains `unknown`/`failed` through `evidenceStatusFromVerification`.

Multi-agent research runs use the same contracts instead of a second event log. `buildMultiAgentPlan`
normalizes and checks planner/executor/reviewer declarations, `readyMultiAgentTasks` resolves the
dependency DAG, and `queueAgentAttempt` gives each delegate an explicit attempt and artifact
namespace. Delegates can submit `AgentFinding` records, but `aggregateMultiAgentFindings` is the
only function that issues a final status and it always marks the issuer as `harness`. Use
`buildMultiAgentResearchManifest` to project the attempts into the existing parent/child Trace
activities. Reviewer attempts can use `createReviewerSnapshot` and `submitAgentFinding` to keep
their evidence read-only and bounded to a frozen snapshot. The plan contract is described by
`schema/multi-agent-plan.schema.json`.
