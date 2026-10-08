import test from 'node:test'
import assert from 'node:assert/strict'
import { verifySchedule, repairSchedule, justVerifierPlugin } from '../index.mjs'
const alice = (shifts) => ({ name: 'Alice', shifts })
const bob = (shifts) => ({ name: 'Bob', shifts })
const days = ['Mon', 'Tue', 'Wed']

test('NORMAL: no minimum coverage violations', () => {
  const schedule = {
    days, employees: [alice(['D', 'N', 'OFF']), bob(['OFF', 'D', 'M'])],
    coverage_requirements: { Wed: { M: 1 } }
  }
  assert.equal(verifySchedule(schedule).status, 'PASS')
})

test('FAILURE: missing minimum staff generates counterexample', () => {
  const schedule = {
    days, employees: [alice(['D', 'N', 'OFF']), bob(['OFF', 'D', 'OFF'])],
    coverage_requirements: { Wed: { M: 1 } }
  }
  const result = verifySchedule(schedule)
  assert.equal(result.status, 'FAIL')
  assert.deepEqual(result.violations.map(v => v.type), ['COVERAGE_SHORTAGE'])
  assert.equal(result.violations[0].shortfall, 1)
})

test('REPAIR: preserve coverage by reassigning available worker', () => {
  const schedule = {
    days, employees: [alice(['D', 'N', 'M']), bob(['OFF', 'D', 'OFF'])],
    coverage_requirements: { Wed: { M: 1 } }
  }
  const original = structuredClone(schedule)
  const initial = verifySchedule(schedule)
  assert.equal(initial.status, 'FAIL')
  assert.equal(initial.violations.length, 1)
  const proposal = repairSchedule(schedule)
  assert.equal(proposal.status, 'REPAIR_PROPOSED')
  assert.equal(proposal.changes.length, 2)
  assert.equal(proposal.strategy, 'COVERAGE_PRESERVING_REASSIGNMENT')
  assert.equal(verifySchedule(proposal.repaired_schedule).status, 'PASS')
  assert.deepEqual(schedule, original)
})

test('FAILURE: no local repair is not a proof of infeasibility', () => {
  const schedule = {
    days, employees: [alice(['D', 'N', 'M'])],
    coverage_requirements: { Wed: { M: 1 } }
  }
  const result = repairSchedule(schedule)
  assert.equal(result.status, 'NO_SAFE_LOCAL_REPAIR')
  assert.equal(verifySchedule(result.repaired_schedule).status, 'FAIL')
})

test('ERROR: malformed minimum staff requirements rejected', () => {
  const schedule = {
    days, employees: [alice(['D', 'N', 'OFF'])],
    coverage_requirements: { Wed: { M: -1 } }
  }
  assert.throws(() => verifySchedule(schedule))
})

test('TOOL: both tools declare complete meta and register', async () => {
  const registered = []
  justVerifierPlugin.apply({ extension: () => ({ registerTool(t) { registered.push(t) } }) })
  assert.deepEqual(registered.map(t => t.name), ['verify_schedule', 'repair_schedule'])
  const fields = ['isReadOnly', 'isDestructive', 'isConcurrencySafe', 'isOpenWorld', 'replay', 'costHint', 'deferLoading', 'requiresApproval']
  for (const tool of registered) {
    for (const field of fields) assert.ok(Object.hasOwn(tool.meta, field))
  }
  const output = await registered[0].execute({ schedule_json: JSON.stringify({ days, employees: [alice(['D', 'N', 'M'])] }) })
  assert.equal(output.structured.status, 'FAIL')
})
