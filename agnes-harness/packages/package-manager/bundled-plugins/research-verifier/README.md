# Research verifier

This governed plugin publishes the deterministic research verifier capability and its versioned
certificate, run manifest, report, and multi-agent plan schemas. The canonical verifier
implementation lives in the `@agnes/research-verifier` workspace package and is also available
through its CLI. Delegate findings are advisory; only the Harness can issue a final report. A
missing or unavailable verifier must remain `unknown`; this plugin never fabricates a successful
result.
