import { coreTools } from './src/core.mjs'
import { libraryTools } from './src/library.mjs'
import { LiteratureStore, registerLiterature } from './src/literature-store.mjs'
import { NotebookRuntime, notebookTools } from './src/notebook.mjs'

// Bundled Agnes plugin entry point. Scientific tools execute through Agnes session capabilities,
// without an external MCP app at runtime.
export const agnesScience = {
  inject: ['extension'],
  apply(ctx) {
    const notebook = new NotebookRuntime()
    ctx.effect(() => () => notebook.close())
    const extension = ctx.extension()
    registerLiterature(ctx, new LiteratureStore())
    for (const tool of [...coreTools(), ...notebookTools(notebook), ...libraryTools()])
      extension.registerTool(tool)
  },
}
