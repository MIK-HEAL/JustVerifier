# Bundled scientific tools

This package ships scientific tools that run through Agnes session capabilities. They use Agnes process, file, artifact, plan, and network policy directly; no external MCP endpoint or desktop runtime is required.

The bundled Skill files are redistributed under the Apache-2.0 license from Open Science 0.35.1. See `LICENSE`. The Agnes adapter has its own package version; the upstream source version is unchanged.

Migration coverage: standalone Python/JavaScript/platform-shell execution, artifact publication, Agnes plans, uploaded document reading, Skill import preparation, and public JSON literature queries. Execution uses fresh processes, not a persistent notebook. Python and Node must already be available in the deployment. The upstream desktop's persistent kernels, `host.*` APIs, personal library, PDF element index, citation-document preparation, runtime/package management, memory store, and parent-chat messaging are not implemented by this adapter and are not registered as working tools. Skill text that refers to those desktop APIs must not be interpreted as an available Agnes capability.
