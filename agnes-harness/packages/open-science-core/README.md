# `@agnes/open-science-core`

Portable research contracts extracted from Open-Science for the Agnes Harness. The package keeps
scientific semantics out of the core execution loop while making them available to verifier and
plugin authors through stable exports:

- immutable artifact versions and root-independent locators;
- provenance graphs with conservative completeness and reason codes;
- bounded execution-file evidence parsing;
- deterministic output comparison and replay recipes;
- DOI/PMID/PMCID/arXiv normalization and CSL projections;
- Notebook and local/SSH/Slurm execution receipts;
- Skill frontmatter, safe references and content provenance.

The package never reads the workspace, contacts a network, executes a Notebook or submits a job.
It only validates and derives records supplied by an owning adapter. `@agnes/research-verifier`
re-exports the package under its `openScience` namespace.

The contracts are adapted from the Apache-2.0 Open-Science project in `../open-science` and keep
the same fail-closed states (`partial`, `unavailable`, `unknown`) where evidence is incomplete.
