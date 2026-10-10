import type {
  ArtifactVersion,
  ComputeExecutionReceipt,
  ExecutionFileEvidenceSummary,
  NotebookRunReceipt,
  ProvenanceActivity,
} from '@agnes/open-science-core'
import type { ResearchActivity, ResearchArtifact, ResearchEvidenceStatus } from './run.js'

const statusFrom = (status: 'recorded' | 'verified' | 'partial' | 'unknown' | 'failed'): ResearchEvidenceStatus => status

/** Converts a portable artifact version into the verifier's path-free artifact reference. */
export function researchArtifactFromOpenScience(
  artifact: ArtifactVersion,
): ResearchArtifact {
  return Object.freeze({
    id: artifact.id,
    version: artifact.version,
    checksum: artifact.checksum,
    role: artifact.role,
    ...(artifact.content_type ? { content_type: artifact.content_type } : {}),
    ...(artifact.size !== undefined ? { size: artifact.size } : {}),
  })
}

function evidenceStatus(summary: ExecutionFileEvidenceSummary | undefined): ResearchEvidenceStatus {
  if (!summary) return 'unknown'
  if (summary.state === 'available' && summary.reasonCodes.length === 0) return 'verified'
  if (summary.state === 'partial') return 'partial'
  if (summary.state === 'unavailable') return 'unknown'
  return 'recorded'
}

/** Maps notebook execution evidence into the common research activity contract. */
export function researchActivityFromNotebookRun(
  receipt: NotebookRunReceipt,
  input: Readonly<{
    activityId?: string
    parentId?: string
    ledgerSeqs?: readonly number[]
    inputArtifactIds?: readonly string[]
    outputArtifactIds?: readonly string[]
  }> = {},
): ResearchActivity {
  const activityId = input.activityId ?? `notebook:${receipt.runId}`
  const status = receipt.status === 'failed' || receipt.status === 'cancelled'
    ? 'failed'
    : receipt.status === 'completed'
      ? evidenceStatus(receipt.fileEvidence)
      : 'unknown'
  return Object.freeze({
    activity_id: activityId,
    ...(input.parentId ? { parent_id: input.parentId } : {}),
    kind: 'run',
    status,
    started_at: receipt.startedAt,
    ...(receipt.endedAt ? { ended_at: receipt.endedAt } : {}),
    input_artifact_ids: input.inputArtifactIds ?? [],
    output_artifact_ids: input.outputArtifactIds ?? [],
    ...(input.ledgerSeqs?.length ? { ledger_seqs: [...input.ledgerSeqs] } : {}),
    replay: status === 'verified' ? 'verified' : receipt.status === 'completed' ? 'available' : 'unavailable',
    ...(receipt.status === 'failed' ? { error: { code: 'notebook-run-failed', message: 'Notebook run failed.' } } : {}),
  })
}

/** Maps local/SSH/Slurm execution receipts into the same activity contract as Notebook runs. */
export function researchActivityFromComputeJob(
  receipt: ComputeExecutionReceipt,
  input: Readonly<{
    parentId?: string
    ledgerSeqs?: readonly number[]
    inputArtifactIds?: readonly string[]
    outputArtifactIds?: readonly string[]
  }> = {},
): ResearchActivity {
  const outputStatus = receipt.output.state === 'available' && receipt.output.reasonCodes.length === 0 ? 'verified' : receipt.output.state === 'partial' ? 'partial' : 'unknown'
  const status: ResearchEvidenceStatus = receipt.status === 'failed' || receipt.status === 'cancelled' ? 'failed' : receipt.status === 'completed' ? outputStatus : 'unknown'
  return Object.freeze({
    activity_id: `compute:${receipt.activityId}`,
    ...(input.parentId ? { parent_id: input.parentId } : {}),
    kind: 'run',
    status,
    started_at: receipt.startedAt ?? receipt.submittedAt ?? '',
    ...(receipt.endedAt ? { ended_at: receipt.endedAt } : {}),
    caller: { agent: `compute:${receipt.providerId}` },
    input_artifact_ids: input.inputArtifactIds ?? [],
    output_artifact_ids: input.outputArtifactIds ?? [],
    ...(input.ledgerSeqs?.length ? { ledger_seqs: [...input.ledgerSeqs] } : {}),
    replay: status === 'verified' ? 'verified' : receipt.status === 'completed' ? 'available' : 'unavailable',
    ...(receipt.status === 'failed' ? { error: { code: 'compute-job-failed', message: 'Compute job failed.' } } : {}),
  })
}

/** Converts a graph activity while preserving its conservative evidence state. */
export function researchActivityFromProvenanceActivity(activity: ProvenanceActivity): ResearchActivity {
  return Object.freeze({
    activity_id: activity.activityId,
    ...(activity.parentActivityId ? { parent_id: activity.parentActivityId } : {}),
    kind: activity.kind === 'artifact-publication' ? 'tool' : 'run',
    status: statusFrom(activity.status),
    started_at: '',
    ...(activity.inputArtifactIds?.length ? { input_artifact_ids: [...activity.inputArtifactIds] } : {}),
    ...(activity.outputArtifactIds?.length ? { output_artifact_ids: [...activity.outputArtifactIds] } : {}),
    ...(activity.evidenceRefs?.length ? { verification_rule_ids: [...activity.evidenceRefs] } : {}),
  })
}
