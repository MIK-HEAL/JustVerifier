import { fileURLToPath } from 'node:url'
// JustVerifier v0.2.0 — demonstrator, not a general-purpose NP-hard solver.
// Only the explicitly listed constraints are checked.
const Kind = Symbol.for('TypeBox.Kind')
const parameters = {
  [Kind]: 'Object', type: 'object',
  properties: {
    schedule_json: { [Kind]: 'String', type: 'string', minLength: 2, maxLength: 20000 }
  },
  required: ['schedule_json'], additionalProperties: false
}
const meta = {
  isReadOnly: true, isDestructive: false, isConcurrencySafe: true,
  isOpenWorld: false, replay: 'safe', costHint: undefined,
  deferLoading: false, requiresApproval: 'never'
}
const SHIFT_CODES = ['M', 'D', 'N']
const VALID_SHIFTS = new Set([...SHIFT_CODES, 'OFF'])

function validObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseAndValidate(data) {
  if (!validObject(data)) throw new Error('排班必须是 JSON 对象')
  const { days, employees, coverage_requirements: coverage = {} } = data
  if (!Array.isArray(days) || days.length < 2 || days.length > 31 ||
      !days.every(d => typeof d === 'string' && d.trim().length > 0) ||
      new Set(days).size !== days.length) {
    throw new Error('days 必须包含 2~31 个非空且不重复的日期')
  }
  if (!Array.isArray(employees) || employees.length < 1 || employees.length > 50) {
    throw new Error('employees 必须包含 1~50 名员工')
  }
  const names = new Set()
  for (const employee of employees) {
    if (!validObject(employee) || typeof employee.name !== 'string' ||
        employee.name.trim().length === 0 || names.has(employee.name)) {
      throw new Error('员工名称不能为空或重复')
    }
    names.add(employee.name)
    if (!Array.isArray(employee.shifts) || employee.shifts.length !== days.length ||
        !employee.shifts.every(s => VALID_SHIFTS.has(s))) {
      throw new Error(`员工 ${employee.name} 的班次格式不合法`)
    }
  }
  if (!validObject(coverage)) throw new Error('coverage_requirements 必须是对象')
  for (const [day, minima] of Object.entries(coverage)) {
    if (!days.includes(day) || !validObject(minima)) {
      throw new Error(`coverage_requirements 日期不合法：${day}`)
    }
    for (const [shift, minimum] of Object.entries(minima)) {
      if (!SHIFT_CODES.includes(shift) || !Number.isSafeInteger(minimum) || minimum < 0 || minimum > 500) {
        throw new Error(`最低班次人数设置不合法：${day}/${shift}`)
      }
    }
  }
  return { days, employees, coverage }
}

export function verifySchedule(data) {
  const { days, employees, coverage } = parseAndValidate(data)
  const violations = []
  for (const employee of employees) {
    for (let i = 1; i < days.length; i++) {
      if (employee.shifts[i - 1] === 'N' && employee.shifts[i] === 'M') {
        violations.push({
          type: 'NIGHT_TO_MORNING', employee: employee.name,
          constraint: '夜班后次日禁止直接安排早班',
          counterexample: [
            { day: days[i - 1], shift: 'N' },
            { day: days[i], shift: 'M' }
          ]
        })
      }
    }
  }
  let checkedCoverage = 0
  for (const [day, minima] of Object.entries(coverage)) {
    const dayIndex = days.indexOf(day)
    for (const [shift, minimum] of Object.entries(minima)) {
      checkedCoverage++
      const actual = employees.filter(e => e.shifts[dayIndex] === shift).length
      if (actual < minimum) {
        violations.push({
          type: 'COVERAGE_SHORTAGE', day, shift,
          constraint: '班次实际人数不得低于最低人数',
          required: minimum, actual, shortfall: minimum - actual
        })
      }
    }
  }
  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    valid: violations.length === 0,
    checked_transitions: employees.length * (days.length - 1),
    checked_coverage: checkedCoverage,
    checked_rules: ['NIGHT_TO_MORNING', 'COVERAGE_SHORTAGE'],
    violations
  }
}

function signature(v) {
  return v.type === 'NIGHT_TO_MORNING'
    ? `rest:${v.employee}:${v.counterexample[1].day}`
    : `cover:${v.day}:${v.shift}`
}
function strictlyImprovesWithoutNewViolations(before, after) {
  if (after.violations.length >= before.violations.length) return false
  const original = new Map(before.violations.map(v => [signature(v), v]))
  return after.violations.every(v => {
    const old = original.get(signature(v))
    return old !== undefined &&
      (v.type !== 'COVERAGE_SHORTAGE' || v.shortfall <= old.shortfall)
  })
}

export function repairSchedule(data) {
  const before = verifySchedule(data)
  const original = structuredClone(data)
  if (before.valid) {
    return { status: 'ALREADY_VALID', changes: [], repaired_schedule: original }
  }
  const violation = before.violations.find(v => v.type === 'NIGHT_TO_MORNING')
  if (!violation) {
    return {
      status: 'NO_SAFE_LOCAL_REPAIR', reason: '当前修复器只处理夜班接早班冲突；未搜索其他违规类型',
      changes: [], remaining_violation_count: before.violations.length,
      repaired_schedule: original
    }
  }
  const day = violation.counterexample[1].day
  const dayIndex = original.days.indexOf(day)
  const primary = original.employees.findIndex(e => e.name === violation.employee)
  const attempts = []
  // Option A: single edit. Good when no coverage rule is violated.
  attempts.push([{ employeeIndex: primary, from: 'M', to: 'OFF' }])
  // Option B: replace the offending morning worker with a free worker.
  for (let i = 0; i < original.employees.length; i++) {
    if (i !== primary && original.employees[i].shifts[dayIndex] === 'OFF') {
      attempts.push([
        { employeeIndex: primary, from: 'M', to: 'OFF' },
        { employeeIndex: i, from: 'OFF', to: 'M' }
      ])
    }
  }
  for (const attempt of attempts) {
    const candidate = structuredClone(original)
    for (const change of attempt) {
      candidate.employees[change.employeeIndex].shifts[dayIndex] = change.to
    }
    const after = verifySchedule(candidate)
    if (strictlyImprovesWithoutNewViolations(before, after)) {
      return {
        status: 'REPAIR_PROPOSED', strategy: attempt.length === 1 ? 'SET_OFF' : 'COVERAGE_PRESERVING_REASSIGNMENT',
        changes: attempt.map(c => ({
          employee: original.employees[c.employeeIndex].name, day,
          from: c.from, to: c.to, reason: 'NIGHT_TO_MORNING'
        })),
        original_violation_count: before.violations.length,
        remaining_violation_count: after.violations.length,
        repaired_schedule: candidate
      }
    }
  }
  return {
    status: 'NO_SAFE_LOCAL_REPAIR',
    reason: '在限定的单次休息或同日空闲员工替班策略中未找到不引入新违规的方案；不代表全局无解',
    changes: [], remaining_violation_count: before.violations.length,
    repaired_schedule: original
  }
}
function toolHandler(handler) {
  return async ({ schedule_json }) => {
    try {
      const result = handler(JSON.parse(schedule_json))
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structured: result }
    } catch (error) {
      const result = { status: 'INPUT_ERROR', valid: false, error: String(error.message) }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structured: result, isError: true
      }
    }
  }
}
export const justVerifierPlugin = {
  inject: ['extension'],
  apply(ctx) {
    const agnes = ctx.extension()
    agnes.registerTool({
      name: 'verify_schedule',
      description: 'Deterministically check night-to-morning conflicts and optional minimum staffing coverage. Use the returned violation evidence as ground truth. schedule_json is a JSON-encoded string.',
      parameters, meta, execute: toolHandler(verifySchedule)
    })
    agnes.registerTool({
      name: 'repair_schedule',
      description: 'Propose at most one local night-to-morning repair, preserving optional staffing minima. May return NO_SAFE_LOCAL_REPAIR. Verify the returned schedule again; do not claim optimality or global infeasibility.',
      parameters, meta, execute: toolHandler(repairSchedule)
    })
  }
}

// JustVerifier v0.3.0 - CP-SAT Tool

const cpKind = Symbol.for('TypeBox.Kind')

const cpParameters = {
  [cpKind]: 'Object',
  type: 'object',
  properties: {
    schedule_json: {
      [cpKind]: 'String',
      type: 'string',
      minLength: 2,
      maxLength: 20000
    }
  },
  required: ['schedule_json'],
  additionalProperties: false
}

const cpMeta = {
  isReadOnly: true,
  isDestructive: false,
  isConcurrencySafe: true,
  isOpenWorld: false,
  replay: 'safe',
  costHint: { wallMs: 10000 },
  deferLoading: false,
  requiresApproval: 'never'
}

function cpResult(value, isError = false) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(value)
    }],
    structured: value,
    isError
  }
}

export const cpSatPlugin = {
  inject: ['extension'],

  apply(ctx) {
    const agnes = ctx.extension()

    agnes.registerTool({
      name: 'cp_sat_repair',
      description:
        'Use OR-Tools CP-SAT to repair a scheduling problem. Supports fixed days, minimum shift coverage, unavailable dates, maximum consecutive workdays and night shift limits. Returns OPTIMAL, FEASIBLE, INFEASIBLE or UNKNOWN. A repaired candidate must be independently verified.',

      parameters: cpParameters,
      meta: cpMeta,

      async execute({ schedule_json }, toolCtx) {
        let normalized

        try {
          const input = JSON.parse(schedule_json)

          if (!input || typeof input !== 'object' ||
              !Array.isArray(input.days) ||
              !Array.isArray(input.employees)) {
            throw new Error('Invalid scheduling JSON')
          }

          normalized = JSON.stringify(input)
        } catch (error) {
          return cpResult({
            status: 'INPUT_ERROR',
            error: String(error.message)
          }, true)
        }

        const root = toolCtx.cwd
        const python = process.env.JUSTVERIFIER_PYTHON || (process.env.HOME + '/.local/share/justverifier/venv/bin/python')
        const script = fileURLToPath(new URL('./solver/cp_sat_repair.py', import.meta.url))

        let execution

        try {
          execution = await toolCtx.exec(
            [python, script, '-'],
            {
              cwd: root,
              stdin: normalized,
              timeoutMs: 10000,
              env: {
                PYTHONDONTWRITEBYTECODE: '1'
              }
            }
          )
        } catch (error) {
          return cpResult({
            status: 'EXEC_REFUSED',
            error: String(error.message)
          }, true)
        }

        if (
          execution.code !== 0 ||
          execution.truncated ||
          execution.timedOut
        ) {
          return cpResult({
            status: execution.timedOut
              ? 'EXEC_TIMEOUT'
              : 'EXEC_ERROR',
            exit_code: execution.code,
            stderr: execution.stderr?.slice(0, 2000)
          }, true)
        }

        try {
          const result = JSON.parse(execution.stdout)

          return cpResult({
            solver: 'OR-Tools CP-SAT',
            ...result
          }, result.status === 'INPUT_ERROR')
        } catch {
          return cpResult({
            status: 'OUTPUT_ERROR',
            error: 'Solver returned invalid JSON'
          }, true)
        }
      }
    })
  }
}

// JustVerifier v0.3.1 - Independent Audit

function canonical(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']'
  }
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(
      k => JSON.stringify(k) + ':' + canonical(value[k])
    ).join(',') + '}'
  }
  return JSON.stringify(value)
}

export function auditCandidate(original, solverResult) {
  // 先验证原问题的数据结构
  verifySchedule(original)

  if (!['OPTIMAL', 'FEASIBLE'].includes(solverResult?.status)
      || !solverResult.repaired_schedule) {
    return {
      status: 'NO_CANDIDATE',
      solver_status: solverResult?.status ?? 'UNKNOWN',
      violations: ['NO_REPAIR_CANDIDATE']
    }
  }

  const repaired = solverResult.repaired_schedule
  const base = verifySchedule(repaired)
  const violations = base.violations.map(
    v => `${v.type}:${v.employee ?? v.day ?? 'unknown'}`
  )

  // 原问题的约束和人员信息不允许被修复器修改
  const a = structuredClone(original)
  const b = structuredClone(repaired)

  for (const e of a.employees) delete e.shifts
  for (const e of b.employees) delete e.shifts

  if (canonical(a) !== canonical(b)) {
    violations.push('PROBLEM_METADATA_CHANGED')
  }

  const days = original.days
  const repairedByName = new Map(
    repaired.employees.map(e => [e.name, e])
  )
  let changes = 0

  for (const employee of original.employees) {
    const after = repairedByName.get(employee.name)

    if (!after) {
      violations.push(`MISSING_EMPLOYEE:${employee.name}`)
      continue
    }

    for (let d = 0; d < days.length; d++) {
      if (employee.shifts[d] !== after.shifts[d]) changes++
    }
  }

  // 历史排班锁定
  const fixed = original.fixed_days ?? []
  if (!Array.isArray(fixed)) {
    violations.push('INVALID_FIXED_DAYS')
  } else {
    for (const day of fixed) {
      const d = days.indexOf(day)
      if (d < 0) {
        violations.push(`UNKNOWN_FIXED_DAY:${day}`)
        continue
      }
      for (const employee of original.employees) {
        const after = repairedByName.get(employee.name)
        if (after && employee.shifts[d] !== after.shifts[d]) {
          violations.push(`FIXED_DAY_CHANGED:${employee.name}:${day}`)
        }
      }
    }
  }

  // 员工不可用日期
  for (const [name, blocked] of Object.entries(
    original.unavailable ?? {}
  )) {
    const employee = repairedByName.get(name)
    if (!employee || !Array.isArray(blocked)) {
      violations.push(`INVALID_UNAVAILABLE:${name}`)
      continue
    }
    for (const day of blocked) {
      const d = days.indexOf(day)
      if (d < 0 || employee.shifts[d] !== 'OFF') {
        violations.push(`UNAVAILABLE_VIOLATION:${name}:${day}`)
      }
    }
  }

  // 最大连续工作天数
  const maxDays = original.max_consecutive_days
  if (maxDays !== undefined) {
    if (!Number.isInteger(maxDays) || maxDays < 0 ||
        maxDays > days.length) {
      violations.push('INVALID_MAX_CONSECUTIVE_DAYS')
    } else {
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
  }

  // 最大夜班次数
  const maxNights = original.max_night_shifts
  if (maxNights !== undefined && maxNights !== null) {
    if (!Number.isInteger(maxNights) || maxNights < 0) {
      violations.push('INVALID_MAX_NIGHT_SHIFTS')
    } else {
      for (const employee of repaired.employees) {
        const count = employee.shifts.filter(s => s === 'N').length
        if (count > maxNights) {
          violations.push(`NIGHT_LIMIT:${employee.name}`)
        }
      }
    }
  }

  // 独立检查修改数量
  if (changes !== solverResult.changed_assignments) {
    violations.push('CHANGE_COUNT_MISMATCH')
  }

  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    solver_status: solverResult.status,
    changed_assignments: changes,
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
    optimality_independently_proven: false,
    violations
  }
}

const auditKind = Symbol.for('TypeBox.Kind')

const auditParameters = {
  [auditKind]: 'Object',
  type: 'object',
  properties: {
    original_json: {
      [auditKind]: 'String',
      type: 'string',
      minLength: 2,
      maxLength: 50000
    },
    solver_result_json: {
      [auditKind]: 'String',
      type: 'string',
      minLength: 2,
      maxLength: 150000
    }
  },
  required: ['original_json', 'solver_result_json'],
  additionalProperties: false
}

const auditMeta = {
  isReadOnly: true,
  isDestructive: false,
  isConcurrencySafe: true,
  isOpenWorld: false,
  replay: 'safe',
  costHint: undefined,
  deferLoading: false,
  requiresApproval: 'never'
}

export const auditPlugin = {
  inject: ['extension'],

  apply(ctx) {
    ctx.extension().registerTool({
      name: 'audit_schedule',
      description:
        'Independently audit a CP-SAT repaired scheduling candidate against the original problem. Check scheduling constraints, locked days, metadata, unavailable dates, work limits and modification count. Return PASS or FAIL with concrete violations. Does not independently prove global optimality.',
      parameters: auditParameters,
      meta: auditMeta,

      async execute({ original_json, solver_result_json }) {
        try {
          const result = auditCandidate(
            JSON.parse(original_json),
            JSON.parse(solver_result_json)
          )

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result)
            }],
            structured: result
          }
        } catch (error) {
          const result = {
            status: 'INPUT_ERROR',
            error: String(error.message)
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result)
            }],
            structured: result,
            isError: true
          }
        }
      }
    })
  }
}
