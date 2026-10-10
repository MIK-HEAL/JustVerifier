import { freezeDeep, sha256 } from './canonical.js'
import type { EvidenceCoverage, ExecutionFileEvidenceSummary } from './evidence.js'

export type NotebookKernelKind = 'python' | 'r'
export type NotebookCell = Readonly<{ id: string; source: string; language: NotebookKernelKind; executionCount?: number }>
export type NotebookDocument = Readonly<{ id: string; version: string; cells: readonly NotebookCell[]; checksum: string }>
export type NotebookEnvironment = Readonly<{ name: string; kernel: NotebookKernelKind; runtimeVersion?: string; packages: readonly string[]; lockChecksum?: string }>
export type NotebookRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type NotebookOutput = Readonly<{ kind: 'text' | 'table' | 'error' | 'media'; summary: string; checksum?: string }>
export type NotebookRunReceipt = Readonly<{
  schemaVersion: 1
  runId: string
  notebookId: string
  environment: NotebookEnvironment
  status: NotebookRunStatus
  startedAt: string
  endedAt?: string
  cells: readonly string[]
  outputs: readonly NotebookOutput[]
  fileEvidence?: ExecutionFileEvidenceSummary
  evidenceCoverage: EvidenceCoverage
  checksum: string
}>

export function buildNotebookDocument(input: Readonly<{ id: string; version: string; cells: readonly NotebookCell[] }>): NotebookDocument {
  const base = { id: input.id, version: input.version, cells: input.cells.map((cell) => ({ ...cell })) }
  return freezeDeep({ ...base, checksum: sha256(base) })
}

export function buildNotebookRunReceipt(input: Readonly<Omit<NotebookRunReceipt, 'schemaVersion' | 'checksum'>>): NotebookRunReceipt {
  const base = { schemaVersion: 1 as const, ...input, cells: [...input.cells], outputs: input.outputs.map((output) => ({ ...output })) }
  return freezeDeep({ ...base, checksum: sha256(base) })
}

export function notebookRunReplayable(receipt: NotebookRunReceipt): boolean {
  return receipt.status === 'completed' && receipt.evidenceCoverage === 'complete' && !!receipt.environment.lockChecksum && receipt.outputs.every((output) => !!output.checksum)
}
