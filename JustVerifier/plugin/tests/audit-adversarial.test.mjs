import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { auditCandidate } from '../index.mjs'

const root = fileURLToPath(new URL('../../solver/', import.meta.url))

const original = JSON.parse(
  fs.readFileSync(root + 'demo.json', 'utf8')
)

const solution = JSON.parse(
  fs.readFileSync(root + 'demo-result.json', 'utf8')
)

const copy = structuredClone

function withConstraint(key, value) {
  const a = copy(original)
  const b = copy(solution)
  a[key] = copy(value)
  b.repaired_schedule[key] = copy(value)
  return [a, b]
}

function mustReject(a, b, reason) {
  const result = auditCandidate(a, b)
  assert.equal(result.status, 'FAIL')
  assert.ok(
    result.violations.some(v => v.startsWith(reason)),
    JSON.stringify(result.violations)
  )
}

test('正常候选解必须 PASS', () => {
  assert.equal(
    auditCandidate(original, solution).status,
    'PASS'
  )
})

test('篡改历史排班必须拒绝', () => {
  const bad = copy(solution)
  bad.repaired_schedule.employees[0].shifts[0] = 'M'
  mustReject(original, bad, 'FIXED_DAY_CHANGED')
})

test('破坏最低班次覆盖必须拒绝', () => {
  const bad = copy(solution)
  bad.repaired_schedule.employees[1].shifts[2] = 'OFF'
  mustReject(original, bad, 'COVERAGE_SHORTAGE')
})

test('违反员工不可用日期必须拒绝', () => {
  const [a, b] = withConstraint(
    'unavailable', { Bob: ['Wed'] }
  )
  mustReject(a, b, 'UNAVAILABLE_VIOLATION')
})

test('违反连续工作上限必须拒绝', () => {
  const [a, b] = withConstraint(
    'max_consecutive_days', 1
  )
  mustReject(a, b, 'CONSECUTIVE_DAYS')
})

test('违反夜班上限必须拒绝', () => {
  const [a, b] = withConstraint(
    'max_night_shifts', 0
  )
  mustReject(a, b, 'NIGHT_LIMIT')
})

test('篡改问题元数据必须拒绝', () => {
  const bad = copy(solution)
  bad.repaired_schedule.coverage_requirements.Wed.M = 0
  mustReject(original, bad, 'PROBLEM_METADATA_CHANGED')
})

test('伪造修改数量必须拒绝', () => {
  const bad = copy(solution)
  bad.changed_assignments = 1
  mustReject(original, bad, 'CHANGE_COUNT_MISMATCH')
})

test('没有候选解不能伪称通过', () => {
  const bad = copy(solution)
  bad.status = 'INFEASIBLE'
  bad.repaired_schedule = null

  assert.equal(
    auditCandidate(original, bad).status,
    'NO_CANDIDATE'
  )
})
