import fs from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { verifySchedule } from '../plugin/index.mjs'

const [originalFile, resultFile] = process.argv.slice(2)

if (!originalFile || !resultFile) {
  console.error('Usage: node verify_candidate.mjs ORIGINAL RESULT')
  process.exit(2)
}

const original = JSON.parse(fs.readFileSync(originalFile, 'utf8'))
const output = JSON.parse(fs.readFileSync(resultFile, 'utf8'))

if (!['OPTIMAL', 'FEASIBLE'].includes(output.status) ||
    !output.repaired_schedule) {
  console.error('没有可供验证的候选修复方案')
  process.exit(2)
}

const repaired = output.repaired_schedule
const violations = []

// 1. 检查数据结构和原有排班规则
const base = verifySchedule(repaired)
violations.push(...base.violations)

// 2. 检查除班次外，原问题数据是否保持不变
const a = structuredClone(original)
const b = structuredClone(repaired)

for (const e of a.employees) delete e.shifts
for (const e of b.employees) delete e.shifts

if (!isDeepStrictEqual(a, b)) {
  violations.push('PROBLEM_METADATA_CHANGED')
}

// 3. 检查历史排班锁定
for (const day of original.fixed_days ?? []) {
  const d = original.days.indexOf(day)

  if (d < 0) {
    violations.push(`INVALID_FIXED_DAY:${day}`)
    continue
  }

  for (let i = 0; i < original.employees.length; i++) {
    if (original.employees[i].shifts[d] !==
        repaired.employees[i].shifts[d]) {
      violations.push(
        `FIXED_DAY_CHANGED:${original.employees[i].name}:${day}`
      )
    }
  }
}

// 4. 检查员工不可用日期
for (const [name, days] of Object.entries(original.unavailable ?? {})) {
  const employee = repaired.employees.find(e => e.name === name)

  for (const day of days) {
    const d = original.days.indexOf(day)

    if (!employee || d < 0 || employee.shifts[d] !== 'OFF') {
      violations.push(`UNAVAILABLE_VIOLATION:${name}:${day}`)
    }
  }
}

// 5. 检查最长连续工作天数
const maxDays = original.max_consecutive_days

if (maxDays !== undefined) {
  for (const employee of repaired.employees) {
    let consecutive = 0

    for (const shift of employee.shifts) {
      consecutive = shift === 'OFF' ? 0 : consecutive + 1

      if (consecutive > maxDays) {
        violations.push(`CONSECUTIVE_DAYS:${employee.name}`)
        break
      }
    }
  }
}

// 6. 检查最大夜班次数
const maxNights = original.max_night_shifts

if (maxNights !== undefined && maxNights !== null) {
  for (const employee of repaired.employees) {
    const count = employee.shifts.filter(s => s === 'N').length

    if (count > maxNights) {
      violations.push(`NIGHT_LIMIT:${employee.name}`)
    }
  }
}

// 7. 独立统计修改量
let changed = 0

for (let i = 0; i < original.employees.length; i++) {
  for (let d = 0; d < original.days.length; d++) {
    if (original.employees[i].shifts[d] !==
        repaired.employees[i].shifts[d]) {
      changed++
    }
  }
}

if (changed !== output.changed_assignments) {
  violations.push('CHANGE_COUNT_MISMATCH')
}

const report = {
  status: violations.length === 0 ? 'PASS' : 'FAIL',
  checked_rules: [
    'NIGHT_TO_MORNING',
    'COVERAGE_SHORTAGE',
    'PROBLEM_METADATA_UNCHANGED',
    'FIXED_DAYS',
    'UNAVAILABLE',
    'MAX_CONSECUTIVE_DAYS',
    'MAX_NIGHT_SHIFTS',
    'CHANGE_COUNT'
  ],
  changed_assignments: changed,
  violations
}

console.log(JSON.stringify(report, null, 2))

if (violations.length > 0) process.exitCode = 1
