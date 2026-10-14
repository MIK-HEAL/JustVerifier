import { useCallback, useEffect, useRef, useState } from 'react'
import { protocolRole } from './agents.js'
import { digest, graphPlan } from './plan.js'

const unwrap = (result) => result?.output ?? result
const terminal = new Set(['completed', 'failed', 'cancelled', 'unknown'])
const labels = {
  queued: '等待会话调度',
  running: '正在协作验证',
  cancelling: '正在取消',
  completed: '执行完成',
  failed: '执行失败',
  cancelled: '已取消',
}

export function useVerificationRun({ nodes, edges, prompt, sessionId, ctx, errors }) {
  const [status, setStatus] = useState('等待编排')
  const [statusKind, setStatusKind] = useState('')
  const [trace, setTrace] = useState([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const scope = useRef(null)
  useEffect(() => {
    const current = { sessionId, busy: false, runId: null, stopped: false }
    scope.current = current
    setRunning(false)
    setResult(null)
    setTrace([])
    setStatus('等待编排')
    setStatusKind('')
    return () => {
      current.stopped = true
      current.wake?.()
    }
  }, [sessionId])

  const launch = useCallback(
    async (service, input) => {
      const current = scope.current
      if (!current || current.busy || current.stopped) return
      const alive = () =>
        !current.stopped && scope.current === current && ctx.session.sessionId === current.sessionId
      if (!current.sessionId || !alive()) return
      current.busy = true
      setRunning(true)
      setResult(null)
      setStatus('正在提交编排…')
      setStatusKind('')
      try {
        const accepted = unwrap(await ctx.commands.execute(service, input))
        current.runId = accepted.run_id
        if (!alive()) return
        if (accepted.status !== 'queued' || !accepted.run_id)
          throw new Error(accepted.reason ?? '编排未进入执行队列')
        // This goes through the ordinary session command admission and tool ledger.
        const dispatched = ctx.session.commands.prompt(
          `调用 research_multiagent_run 执行已授权的不可变编排，参数为 ${JSON.stringify({ run_id: accepted.run_id })}。若返回 running，继续以相同参数调用，直到返回 completed、failed 或 cancelled；以工具返回的报告为准。`,
        )
        let dispatchError
        void dispatched.catch((error) => {
          dispatchError = error
        })
        const deadline = Date.now() + 10 * 60_000
        while (alive()) {
          if (dispatchError) throw dispatchError
          const output = unwrap(
            await ctx.agnes.services.call('research.multiagent.status', { run_id: current.runId }),
          )
          if (!alive()) return
          setResult(output)
          setTrace(
            (output.trace ?? [])
              .map((item) => ({
                message: `${item.kind}${item.attempt?.task_id ? ` · ${item.attempt.task_id}: ${item.attempt.status}` : ''}`,
                kind: item.kind,
                time: '',
              }))
              .reverse(),
          )
          setStatus(
            `${labels[output.status] ?? output.status}${output.report ? ` · 验证：${output.report.status}` : ''}${output.reason ? ` · ${output.reason}` : ''}`,
          )
          setStatusKind(
            output.status === 'failed' || output.status === 'unknown' || output.report?.status === 'fail'
              ? 'error'
              : '',
          )
          if (terminal.has(output.status)) return
          if (Date.now() > deadline) {
            await ctx.commands.execute('research.multiagent.cancel', { run_id: current.runId })
            throw new Error('等待执行超时，已请求取消；可在会话账本检查最终状态')
          }
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 500)
            current.wake = () => {
              clearTimeout(timer)
              resolve()
            }
          })
        }
      } catch (error) {
        if (alive()) {
          if (current.runId)
            await ctx.commands
              .execute('research.multiagent.cancel', { run_id: current.runId })
              .catch(() => undefined)
          if (!alive()) return
          setStatus(`运行未完成：${error?.message ?? 'unknown error'}`)
          setStatusKind('error')
        }
      } finally {
        current.busy = false
        if (alive()) setRunning(false)
      }
    },
    [ctx],
  )

  const start = useCallback(async () => {
    const initiating = scope.current
    if (errors.length || !prompt.trim()) {
      setStatus(errors[0] ?? '请输入验证目标')
      setStatusKind('error')
      return
    }
    try {
      const base = graphPlan(nodes, edges)
      const plan = { ...base, checksum: await digest(base) }
      if (scope.current !== initiating || initiating?.stopped) return
      await launch('research.multiagent.start', {
        prompt,
        plan,
        agent_prompts: Object.fromEntries(
          nodes.filter((node) => node.prompt).map((node) => [node.id, node.prompt]),
        ),
      })
    } catch (error) {
      if (scope.current === initiating && !initiating?.stopped) {
        setStatus(error.message)
        setStatusKind('error')
      }
    }
  }, [edges, errors, nodes, prompt, launch])

  const startSingleAgent = useCallback(
    async (node) => {
      if (!node || !prompt.trim()) return
      await launch('research.multiagent.direct', {
        prompt,
        agent_id: node.id,
        role: protocolRole(node.role),
        revision: 'ui-v1',
        agent_prompt: node.prompt ?? '',
      })
    },
    [launch, prompt],
  )

  const cancel = useCallback(async () => {
    const current = scope.current
    if (!current?.runId || current.stopped || ctx.session.sessionId !== current.sessionId) return
    try {
      await ctx.commands.execute('research.multiagent.cancel', { run_id: current.runId })
      if (!current.stopped) setStatus('已请求取消，正在等待子 Agent 停止…')
    } catch (error) {
      if (!current.stopped) {
        setStatus(`取消失败：${error.message}`)
        setStatusKind('error')
      }
    }
  }, [ctx])

  return { status, statusKind, trace, running, result, start, startSingleAgent, cancel }
}
