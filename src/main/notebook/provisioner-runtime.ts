import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { promisify } from 'node:util'

import { condaActivatedPath } from './runtime-paths'

const execFileAsync = promisify(execFile)

// Merges extra vars over the current process env for a subprocess (used to inject the CA-bundle vars
// so an online provision behind an enterprise TLS proxy verifies HTTPS). Undefined → inherit as-is.
type VerifyExecutableOptions = {
  prefix?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

const executableEnv = ({
  prefix,
  env,
  platform = process.platform
}: VerifyExecutableOptions): NodeJS.ProcessEnv | undefined => {
  if (platform !== 'win32' || !prefix) {
    return env && Object.keys(env).length > 0 ? { ...process.env, ...env } : undefined
  }
  const merged = { ...process.env, ...env }
  return { ...merged, PATH: condaActivatedPath(prefix, merged.PATH, platform) }
}

// Verifies a materialized interpreter actually runs `<bin> --version` (spec §5 step 4 — the arm64 /
// ad-hoc signature verification point). Rejects with the captured stderr on failure.
export const verifyExecutable = async (
  bin: string,
  options: VerifyExecutableOptions = {}
): Promise<void> => {
  try {
    await execFileAsync(bin, ['--version'], {
      timeout: 15_000,
      windowsHide: true,
      env: executableEnv(options)
    })
  } catch (error) {
    throw new Error(`interpreter not executable: ${bin} (${(error as Error).message})`)
  }
}

// Runs a micromamba argv (argv[0] is the binary). Rejects with a stderr summary on non-zero exit so
// provisioning surfaces a solvable error to the UI (spec §12).
export const runMicromamba = (
  argv: string[],
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  // Invoked with the spawned child's PID so the caller can journal it — crash recovery then kills a
  // surviving orphan (a micromamba the dead parent left running) before reconciling its target prefix.
  onChild?: (pid: number) => void,
  timeoutMs = 600_000
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Runtime setup cancelled.'))
      return
    }

    const child = spawn(argv[0], argv.slice(1), {
      windowsHide: true,
      // `runMicromamba` receives the complete app-owned environment. Do not merge process.env back
      // in here: that would reintroduce inherited CONDA_*/MAMBA_* values removed by micromambaSpawnEnv.
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (child.pid !== undefined) onChild?.(child.pid)

    const maxTail = 16 * 1024
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let cancelled = false
    let settled = false
    const appendTail = (current: string, chunk: unknown): string =>
      `${current}${String(chunk)}`.slice(-maxTail)
    child.stdout.on('data', (chunk) => {
      stdout = appendTail(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendTail(stderr, chunk)
    })

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    const onAbort = (): void => {
      cancelled = true
      child.kill()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
    const output = (): string =>
      [stdout && `stdout tail:\n${stdout}`, stderr && `stderr tail:\n${stderr}`]
        .filter(Boolean)
        .join('\n')

    child.once('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`micromamba failed to start (${argv.join(' ')}): ${error.message}`))
    })
    child.once('close', (code, closeSignal) => {
      if (settled) return
      settled = true
      cleanup()
      if (cancelled || signal?.aborted) {
        reject(new Error('Runtime setup cancelled.'))
        return
      }
      const tails = output()
      if (timedOut) {
        reject(
          new Error(
            `micromamba timed out after ${timeoutMs}ms (${argv.join(' ')})${tails ? `:\n${tails}` : ''}`
          )
        )
        return
      }
      if (code === 0) {
        resolve()
        return
      }
      const status = code === null ? `signal ${closeSignal ?? 'unknown'}` : `exit ${code}`
      reject(
        new Error(`micromamba failed (${status}; ${argv.join(' ')})${tails ? `:\n${tails}` : ''}`)
      )
    })
  })

// Runs a micromamba argv and returns its stdout (for `list --explicit --md5` when exporting an env's
// lock during a runtime relocation). Rejects with a stderr summary on non-zero exit.
export const captureMicromamba = async (
  argv: string[],
  env?: NodeJS.ProcessEnv
): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(argv[0], argv.slice(1), {
      timeout: 600_000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      env: env && Object.keys(env).length > 0 ? { ...process.env, ...env } : undefined
    })
    return stdout
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ''
    throw new Error(`micromamba failed (${argv.join(' ')}): ${stderr.slice(0, 400)}`)
  }
}

// Streams a file through md5 and returns the lowercase hex digest (matches the `#<md5>` suffix on
// @EXPLICIT lock lines used to verify downloaded tarballs).
export const md5File = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
