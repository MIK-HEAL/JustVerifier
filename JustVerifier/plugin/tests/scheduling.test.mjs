import test from 'node:test'
import assert from 'node:assert/strict'
import { verifySchedule, repairSchedule } from '../index.mjs'

test('NORMAL: 合法排班', () => {
  const data = {
    days: ['Mon', 'Tue', 'Wed'],
    employees: [
      { name: 'Alice', shifts: ['M', 'D', 'OFF'] }
    ]
  }

  assert.equal(verifySchedule(data).status, 'PASS')
})

test('BOUNDARY: 夜班与早班之间有休息日', () => {
  const data = {
    days: ['Mon', 'Tue', 'Wed'],
    employees: [
      { name: 'Alice', shifts: ['N', 'OFF', 'M'] }
    ]
  }

  assert.equal(verifySchedule(data).status, 'PASS')
})

test('FAILURE: 夜班后接早班并自动修复', () => {
  const data = {
    days: ['Mon', 'Tue', 'Wed'],
    employees: [
      { name: 'Alice', shifts: ['D', 'N', 'M'] }
    ]
  }

  const original = JSON.stringify(data)
  const before = verifySchedule(data)

  assert.equal(before.status, 'FAIL')
  assert.equal(before.violations.length, 1)

  const repair = repairSchedule(data)
  const after = verifySchedule(repair.repaired_schedule)

  assert.equal(after.status, 'PASS')
  assert.equal(JSON.stringify(data), original)
})

test('MULTI: 多处违规需要多轮修复', () => {
  const data = {
    days: ['Mon', 'Tue', 'Wed', 'Thu'],
    employees: [
      { name: 'Alice', shifts: ['N', 'M', 'N', 'M'] }
    ]
  }

  assert.equal(verifySchedule(data).violations.length, 2)

  const first = repairSchedule(data)
  assert.equal(first.remaining_violation_count, 1)

  const second = repairSchedule(first.repaired_schedule)
  assert.equal(
    verifySchedule(second.repaired_schedule).status,
    'PASS'
  )
})

test('ERROR: 非法班次必须拒绝', () => {
  assert.throws(() => verifySchedule({
    days: ['Mon', 'Tue'],
    employees: [
      { name: 'Alice', shifts: ['N', 'INVALID'] }
    ]
  }))
})

test('ERROR: 员工名称重复必须拒绝', () => {
  assert.throws(() => verifySchedule({
    days: ['Mon', 'Tue'],
    employees: [
      { name: 'Alice', shifts: ['M', 'D'] },
      { name: 'Alice', shifts: ['D', 'M'] }
    ]
  }))
})
