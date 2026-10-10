import { freezeDeep, sha256 } from './canonical.js'

export type ComparisonPolicy = Readonly<{
  schemaVersion: 1
  numericAbsoluteTolerance: number
  numericRelativeTolerance: number
  maxDifferences: number
}>

export const DEFAULT_COMPARISON_POLICY: ComparisonPolicy = Object.freeze({
  schemaVersion: 1,
  numericAbsoluteTolerance: 0,
  numericRelativeTolerance: 0,
  maxDifferences: 100,
})

export type ComparisonDifference = Readonly<{ path: string; expected: unknown; actual: unknown; reason: 'value' | 'missing' | 'added' | 'type' }>
export type ComparisonReport = Readonly<{
  schemaVersion: 1
  outcome: 'matched' | 'different' | 'unavailable'
  expectedChecksum: string
  actualChecksum: string
  policyChecksum: string
  differences: readonly ComparisonDifference[]
  detailsTruncated: boolean
}>

function sameNumber(expected: number, actual: number, policy: ComparisonPolicy): boolean {
  const absolute = Math.abs(expected - actual)
  const scale = Math.max(Math.abs(expected), Math.abs(actual), 1)
  return absolute <= policy.numericAbsoluteTolerance || absolute / scale <= policy.numericRelativeTolerance
}

function walk(expected: unknown, actual: unknown, path: string, policy: ComparisonPolicy, output: ComparisonDifference[]): void {
  if (output.length >= policy.maxDifferences) return
  if (typeof expected === 'number' && typeof actual === 'number' && Number.isFinite(expected) && Number.isFinite(actual)) {
    if (!sameNumber(expected, actual, policy)) output.push({ path, expected, actual, reason: 'value' })
    return
  }
  if (Object.is(expected, actual)) return
  if (expected === undefined) { output.push({ path, expected, actual, reason: 'added' }); return }
  if (actual === undefined) { output.push({ path, expected, actual, reason: 'missing' }); return }
  if (typeof expected !== typeof actual || expected === null || actual === null) { output.push({ path, expected, actual, reason: 'type' }); return }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length)
    for (let index = 0; index < length; index += 1) walk(expected[index], actual[index], `${path}[${index}]`, policy, output)
    return
  }
  if (typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected as object), ...Object.keys(actual as object)])
    for (const key of [...keys].sort()) walk((expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key], path ? `${path}.${key}` : key, policy, output)
    return
  }
  output.push({ path, expected, actual, reason: 'value' })
}

export function compareOutputs(input: Readonly<{ expected: unknown; actual: unknown; policy?: ComparisonPolicy }>): ComparisonReport {
  const policy = input.policy ?? DEFAULT_COMPARISON_POLICY
  const differences: ComparisonDifference[] = []
  walk(input.expected, input.actual, '$', policy, differences)
  return freezeDeep({
    schemaVersion: 1 as const,
    outcome: differences.length ? 'different' as const : 'matched' as const,
    expectedChecksum: sha256(input.expected),
    actualChecksum: sha256(input.actual),
    policyChecksum: sha256(policy),
    differences,
    detailsTruncated: differences.length >= policy.maxDifferences,
  })
}

export type ReproducibilityRecipe = Readonly<{
  recipeId: string
  inputRefs: readonly string[]
  commandRefs: readonly string[]
  environmentFingerprint: string
  deterministic: boolean
  checksum: string
}>

export function buildReproducibilityRecipe(input: Readonly<Omit<ReproducibilityRecipe, 'checksum' | 'recipeId'> & { recipeId?: string }>): ReproducibilityRecipe {
  const base = {
    recipeId: input.recipeId ?? `recipe:${sha256({ inputRefs: input.inputRefs, commandRefs: input.commandRefs }).slice(-16)}`,
    inputRefs: [...new Set(input.inputRefs)].sort(),
    commandRefs: [...new Set(input.commandRefs)].sort(),
    environmentFingerprint: input.environmentFingerprint,
    deterministic: input.deterministic,
  }
  return freezeDeep({ ...base, checksum: sha256(base) })
}
