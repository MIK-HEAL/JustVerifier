import { coreTools } from './src/core.mjs'
import { libraryTools } from './src/library.mjs'
import { NotebookRuntime, notebookTools } from './src/notebook.mjs'

// Preserve the installed export identity for existing package rows.
// Scientific tools execute through Agnes session capabilities, without an external MCP app.
export const openScience = {
  inject: ['extension'],
  apply(ctx) {
    const notebook = new NotebookRuntime()
    ctx.effect(() => () => notebook.close())
    const extension = ctx.extension()
    for (const tool of [...coreTools(), ...notebookTools(notebook), ...libraryTools()])
      extension.registerTool(tool)
  },
}
