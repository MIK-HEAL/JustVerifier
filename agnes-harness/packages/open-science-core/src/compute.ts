import { freezeDeep, sha256 } from './canonical.js'
import type { EvidenceReason, EvidenceState } from './evidence.js'

export type ComputeBackend = 'local' | 'ssh' | 'slurm'
export type ComputeJobStatus = 'queued' | 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
export type ComputeJobSpec = Readonly<{ jobId: string; backend: ComputeBackend; command: string; workingDirectory: string; environment?: string; timeoutSeconds?: number }>
export type ComputeOutputEvidence = Readonly<{ state: EvidenceState; evidenceId?: string; checksum?: string; storageKey?: string; reasonCodes: readonly EvidenceReason[] }>
export type ComputeExecutionReceipt = Readonly<{
  schemaVersion: 1
  activityId: string
  job: ComputeJobSpec
  status: ComputeJobStatus
  providerId: string
  submittedAt?: string
  startedAt?: string
  endedAt?: string
  exitCode?: number
  output: ComputeOutputEvidence
  checksum: string
}>

const SAFE_RELATIVE = /^(?![\\/])(?!(?:[A-Za-z]:))[A-Za-z0-9._/-]+$/u
export function isSafeRemotePath(value: string): boolean {
  return SAFE_RELATIVE.test(value) && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

export function transitionComputeJob(current: ComputeJobStatus, next: ComputeJobStatus): ComputeJobStatus {
  const allowed: Record<ComputeJobStatus, readonly ComputeJobStatus[]> = {
    queued: ['submitted', 'cancelled', 'failed'], submitted: ['running', 'cancelled', 'failed', 'unknown'], running: ['completed', 'failed', 'cancelled', 'unknown'], completed: [], failed: [], cancelled: [], unknown: ['running', 'completed', 'failed', 'cancelled'],
  }
  if (!allowed[current].includes(next)) throw new Error(`invalid compute transition ${current} -> ${next}`)
  return next
}

export function buildComputeExecutionReceipt(input: Readonly<Omit<ComputeExecutionReceipt, 'schemaVersion' | 'checksum'>>): ComputeExecutionReceipt {
  if (!isSafeRemotePath(input.job.workingDirectory)) throw new Error('workingDirectory must be a safe relative path')
  const base = { schemaVersion: 1 as const, ...input, output: { ...input.output, reasonCodes: [...input.output.reasonCodes].sort() } }
  return freezeDeep({ ...base, checksum: sha256(base) })
}
