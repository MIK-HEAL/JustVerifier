import { useCallback, useState } from 'react'
import { protocolRole } from './agents.js'
import { digest, graphPlan } from './plan.js'

const START_SERVICE = 'research.multiagent.start'
const DIRECT_SERVICE = 'research.multiagent.direct'

function now() {
  return new Date().toLocaleTimeString()
}

function traceFromResult(output, fallbackKind) {
  const resultTrace = Array.isArray(output?.trace) ? output.trace : []
  return resultTrace.map((item) => ({
    message: item.kind ?? fallbackKind,
    kind: item.kind,
    time: now(),
  }))
}

export function useVerificationRun({ nodes, edges, prompt, sessionId, ctx, errors }) {
  const [status, setStatus] = useState('等待编排')
  const [statusKind, setStatusKind] = useState('')
  const [trace, setTrace] = useState([])
  const [running, setRunning] = useState(false)

  const start = useCallback(async () => {
    if (errors.length) {
      setStatus(errors[0])
      setStatusKind('error')
      return
    }
    setRunning(true)
    setStatus('正在生成不可变编排快照…')
    setStatusKind('')
    try {
      const base = graphPlan(nodes, edges)
      const plan = { ...base, checksum: await digest(base) }
      setTrace((current) => [{ message: `plan.created · ${plan.checksum}`, time: now() }, ...current])
      const agent_prompts = Object.fromEntries(
        nodes.filter((node) => node.prompt).map((node) => [node.id, node.prompt]),
      )
      const result = await ctx.agnes.services.call(START_SERVICE, {
        prompt,
        plan,
        agent_prompts,
        session_id: sessionId,
      })
      const output = result?.output ?? result
      setTrace((current) => [...traceFromResult(output, 'verification.blocked'), ...current])
      setStatus(`编排已阻塞：执行器不可用 · ${output?.run_id ?? 'run pending'}`)
      setStatusKind('error')
    } catch (error) {
      const code = error?.code ?? error?.cause?.code
      const invalidPlan = code === 'INVALID_MULTI_AGENT_PLAN'
      setStatus(
        invalidPlan
          ? `编排计划非法：${error?.message ?? '请检查节点和依赖关系'}`
          : `后端编排服务不可用：${error?.message ?? 'unknown error'}`,
      )
      setStatusKind('error')
      setTrace((current) => [
        {
          message: invalidPlan
            ? 'verification.blocked · invalid plan'
            : 'verification.blocked · service unavailable',
          kind: 'verification.blocked',
          time: now(),
        },
        ...current,
      ])
    } finally {
      setRunning(false)
    }
  }, [ctx, edges, errors, nodes, prompt, sessionId])

  const startSingleAgent = useCallback(
    async (node) => {
      if (!node) return
      setRunning(true)
      setStatus(`正在单独运行 ${node.label}…`)
      setStatusKind('')
      setTrace((current) => [
        { message: `agent.direct.request · ${node.id}`, kind: 'agent.direct.request', time: now() },
        ...current,
      ])
      try {
        const result = await ctx.agnes.services.call(DIRECT_SERVICE, {
          prompt,
          agent_id: node.role === 'agnes' ? 'current-session-agent' : node.id,
          role: protocolRole(node.role),
          revision: 'ui-v1',
          session_id: sessionId,
          agent_prompt: node.prompt,
        })
        const output = result?.output ?? result
        setTrace((current) => [...traceFromResult(output, 'agent.direct.blocked'), ...current])
        setStatus(`单 Agent 已阻塞：执行器不可用 · ${output?.run_id ?? 'run pending'}`)
        setStatusKind('error')
      } catch (error) {
        setStatus(`单 Agent 运行失败：${error?.message ?? 'unknown error'}`)
        setStatusKind('error')
        setTrace((current) => [
          {
            message: 'agent.direct.blocked · service unavailable',
            kind: 'agent.direct.blocked',
            time: now(),
          },
          ...current,
        ])
      } finally {
        setRunning(false)
      }
    },
    [ctx, prompt, sessionId],
  )

  return { status, statusKind, trace, running, start, startSingleAgent }
}
