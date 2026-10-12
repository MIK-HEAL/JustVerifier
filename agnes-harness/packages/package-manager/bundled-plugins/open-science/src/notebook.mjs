import { randomUUID } from 'node:crypto'
import { enumeration, fail, integer, object, optional, result, string, tool } from './schema.mjs'

const codeSchema = object({
  code: string(32768),
  language: optional(enumeration('javascript', 'python', 'shell')),
  timeoutMs: optional(integer(1, 120000)),
})

export class NotebookRuntime {
  #closed = false
  close() {
    this.#closed = true
  }
  get state() {
    return this.#closed ? 'closed' : 'ready'
  }
  async run(args, ctx) {
    if (this.#closed) throw fail('SCIENCE_NOTEBOOK_CLOSED', 'The Agnes notebook runtime is closed.')
    const language = args.language ?? 'python'
    // argv is passed directly to the Host executor. JSON strings are not shell escaping.
    const argv =
      language === 'shell'
        ? ['$SHELL', args.code]
        : language === 'python'
          ? ['python', '-u', '-c', args.code]
          : ['node', '--input-type=module', '-e', args.code]
    const resultValue = await ctx.exec(argv, {
      cwd: ctx.cwd,
      timeoutMs: Math.max(1, Math.min(args.timeoutMs ?? ctx.timeoutMs, ctx.timeoutMs, 120000)),
    })
    ctx.signal.throwIfAborted()
    return {
      ...result({
        runId: randomUUID(),
        state: 'stateless',
        language,
        code: resultValue.code,
        stdout: resultValue.stdout,
        stderr: resultValue.stderr,
        truncated: resultValue.truncated,
        timedOut: resultValue.timedOut ?? false,
      }),
      ...(resultValue.code !== 0 || resultValue.timedOut ? { isError: true } : {}),
    }
  }
}

export function notebookTools(runtime) {
  return [
    tool(
      'notebook_execute',
      'Execute a standalone Python (default), JavaScript, or platform-shell cell through Agnes process policy. Each call starts a fresh process; variables do not persist. Python/node must already be installed. No desktop notebook kernel or host.* API is provided.',
      codeSchema,
      false,
      (args, ctx) => runtime.run(args, ctx),
    ),
    tool(
      'repl_execute',
      'Execute a standalone JavaScript module through Agnes process policy. Variables do not persist between calls; host.* desktop APIs are unavailable.',
      object({ code: string(32768), timeoutMs: optional(integer(1, 120000)) }),
      false,
      (args, ctx) => runtime.run({ ...args, language: 'javascript' }, ctx),
    ),
    tool(
      'bash_execute',
      'Execute a command using the Agnes platform shell (PowerShell on Windows, POSIX shell elsewhere), with native approval and cancellation. This does not force Bash on Windows.',
      object({ command: string(32768), timeoutMs: optional(integer(1, 120000)) }),
      false,
      (args, ctx) => runtime.run({ code: args.command, language: 'shell', timeoutMs: args.timeoutMs }, ctx),
    ),
    tool(
      'notebook_state',
      'Return the state of the Agnes local notebook runtime.',
      object({}),
      true,
      async () =>
        result({
          state: runtime.state,
          persistence: 'stateless',
          languages: ['python', 'javascript', 'shell'],
        }),
    ),
  ]
}
