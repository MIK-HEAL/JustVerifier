import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type VerificationInput, verificationExitCode, verifyCertificate } from './index.js'
import { projectEvidenceGraph } from './projection.js'

export async function verifyJsonFile(
  path: string,
): Promise<{ report: ReturnType<typeof verifyCertificate>; graph: ReturnType<typeof projectEvidenceGraph> }> {
  const input = JSON.parse(await readFile(path, 'utf8')) as VerificationInput
  const report = verifyCertificate(input)
  return { report, graph: projectEvidenceGraph(input.certificate, report) }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv[0] !== 'verify' || !argv[1]) {
    process.stderr.write('Usage: research-verifier verify <input.json> [--graph]\n')
    return 64
  }
  try {
    const result = await verifyJsonFile(argv[1])
    process.stdout.write(`${JSON.stringify(argv.includes('--graph') ? result : result.report, null, 2)}\n`)
    return verificationExitCode(result.report.status)
  } catch (error) {
    process.stderr.write(`research-verifier: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  process.exitCode = await main()
