import { createElement, useEffect, useMemo, useState } from 'react'

const OPEN_EVENT = 'agnes:multi-agent-open'
const AGENTS = [
  { role: 'planner', label: '规划 Agent', icon: '⌘', capability: 'research.plan' },
  { role: 'executor', label: '执行 Agent', icon: '▶', capability: 'research.execute' },
  { role: 'reviewer', label: '审查 Agent', icon: '✓', capability: 'research.review' },
  { role: 'verifier', label: '验证 Agent', icon: '∴', capability: 'research.verify' },
]

const roleInfo = (role) => AGENTS.find((agent) => agent.role === role) ?? AGENTS[3]

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

async function digest(value) {
  const source = new TextEncoder().encode(stable(value))
  if (globalThis.crypto?.subtle) {
    const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', source))
    return `sha256:${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  let hash = 2166136261
  for (const byte of source) hash = Math.imul(hash ^ byte, 16777619)
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function newNode(role, index) {
  const id = `${role}-${index + 1}`
  return { id, role, label: roleInfo(role).label, prompt: '', x: 32 + (index % 3) * 190, y: 40 + Math.floor(index / 3) * 120 }
}

function graphPlan(nodes, edges) {
  const agents = nodes.map((node) => ({
    agent_id: node.id,
    role: node.role,
    revision: 'ui-v1',
    capabilities: [roleInfo(node.role).capability],
    trust: 'trusted',
  }))
  const incoming = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) incoming.get(edge.to)?.push(`task-${edge.from}`)
  const tasks = nodes.map((node) => ({
    task_id: `task-${node.id}`,
    agent_id: node.id,
    mode: 'serial',
    ...(incoming.get(node.id)?.length ? { depends_on: [...new Set(incoming.get(node.id))].sort() } : {}),
    output_namespace: `${node.id}/output`,
  }))
  const planner = nodes.find((node) => node.role === 'planner') ?? nodes[0]
  return {
    schema_version: 1,
    plan_id: `plan-${Date.now().toString(36)}`,
    run_id: `draft-${Date.now().toString(36)}`,
    root_agent_id: planner?.id ?? '',
    agents,
    tasks,
  }
}

function validateGraph(nodes, edges) {
  const errors = []
  if (!nodes.length) errors.push('至少拖入一个 Agent')
  if (!nodes.some((node) => node.role === 'planner')) errors.push('需要一个规划 Agent 作为根节点')
  const ids = new Set(nodes.map((node) => node.id))
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push('连线引用了不存在的节点')
    if (edge.from === edge.to) errors.push('不能连接节点自身')
  }
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  const outgoing = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to)
  const queue = [...nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id)]
  let visited = 0
  while (queue.length) {
    const id = queue.shift()
    visited += 1
    for (const next of outgoing.get(id) ?? []) {
      incoming.set(next, (incoming.get(next) ?? 0) - 1)
      if (incoming.get(next) === 0) queue.push(next)
    }
  }
  if (visited !== nodes.length) errors.push('编排图存在循环依赖')
  return [...new Set(errors)]
}

function Entry() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const open = () => setActive(true)
    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [])
  return createElement(
    'button',
    {
      className: 'ma-entry',
      'data-active': active,
      title: '打开多 Agent 协作验证',
      onClick: () => window.dispatchEvent(new CustomEvent(OPEN_EVENT)),
    },
    createElement('span', { className: 'ma-entry-icon', 'aria-hidden': 'true' }, '✦'),
    createElement('span', { className: 'ma-entry-copy' },
      createElement('span', { className: 'ma-entry-title' }, '多 Agent 协作验证'),
      createElement('span', { className: 'ma-entry-subtitle' }, '可视化编排与验证链路'),
    ),
  )
}

function TraceItem({ item }) {
  return createElement('div', { className: 'ma-trace-item' },
    createElement('div', null, item.message),
    createElement('div', { className: 'ma-trace-time' }, item.time),
  )
}

function Workbench({ sessionId, ctx }) {
  const [open, setOpen] = useState(false)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selected, setSelected] = useState(null)
  const [prompt, setPrompt] = useState('请验证这项科研结论，检查数据、统计假设与证据链。')
  const [connection, setConnection] = useState(null)
  const [status, setStatus] = useState('等待编排')
  const [statusKind, setStatusKind] = useState('')
  const [trace, setTrace] = useState([])
  const [running, setRunning] = useState(false)
  const selectedNode = nodes.find((node) => node.id === selected)
  const errors = useMemo(() => validateGraph(nodes, edges), [nodes, edges])

  useEffect(() => {
    const openPanel = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, openPanel)
    return () => window.removeEventListener(OPEN_EVENT, openPanel)
  }, [])

  const addNode = (role, position) => {
    setNodes((current) => {
      const index = current.filter((node) => node.role === role).length
      const used = new Set(current.map((node) => node.id))
      let suffix = index + 1
      while (used.has(`${role}-${suffix}`)) suffix += 1
      const node = { ...newNode(role, suffix - 1), id: `${role}-${suffix}`, ...position }
      setSelected(node.id)
      return [...current, node]
    })
  }

  const drop = (event) => {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/x-agnes-agent')
    const nodeId = event.dataTransfer.getData('application/x-agnes-node')
    const rect = event.currentTarget.getBoundingClientRect()
    const position = { x: Math.max(12, event.clientX - rect.left - 78), y: Math.max(12, event.clientY - rect.top - 30) }
    if (type) addNode(type, position)
    if (nodeId) setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, ...position } : node))
  }

  const connect = (target) => {
    if (!connection || connection === target) return setConnection(null)
    setEdges((current) => current.some((edge) => edge.from === connection && edge.to === target)
      ? current
      : [...current, { from: connection, to: target }])
    setConnection(null)
  }

  const start = async () => {
    if (errors.length) { setStatus(errors[0]); setStatusKind('error'); return }
    setRunning(true)
    setStatus('正在生成不可变编排快照…')
    setStatusKind('')
    const base = graphPlan(nodes, edges)
    const plan = { ...base, checksum: await digest(base) }
    const now = new Date().toLocaleTimeString()
    setTrace((current) => [{ message: `plan.created · ${plan.checksum}`, time: now }, ...current])
    try {
      const agent_prompts = Object.fromEntries(nodes.filter((node) => node.prompt).map((node) => [node.id, node.prompt]))
      const result = await ctx.agnes.services.call('research.multiagent.start', { prompt, plan, agent_prompts, session_id: sessionId })
      const output = result?.output ?? result
      const resultTrace = Array.isArray(output?.trace) ? output.trace : []
      setTrace((current) => [
        ...resultTrace.map((item) => ({ message: item.kind ?? 'verification.queued', time: new Date().toLocaleTimeString() })),
        ...current,
      ])
      setStatus(`已排队（尚无执行器） · ${output?.run_id ?? 'run pending'}`)
      setStatusKind('success')
    } catch (error) {
      const code = error?.code ?? error?.cause?.code
      const invalidPlan = code === 'INVALID_MULTI_AGENT_PLAN'
      setStatus(invalidPlan
        ? `编排计划非法：${error?.message ?? '请检查节点和依赖关系'}`
        : `后端编排服务不可用：${error?.message ?? 'unknown error'}`)
      setStatusKind('error')
      setTrace((current) => [{ message: invalidPlan ? 'verification.blocked · invalid plan' : 'verification.blocked · service unavailable', time: new Date().toLocaleTimeString() }, ...current])
    } finally { setRunning(false) }
  }

  if (!open) return null
  return createElement('section', { className: 'ma-workbench', 'data-agnes-multi-agent': true, 'aria-label': '多 Agent 协作验证' },
    createElement('header', { className: 'ma-workbench-header' },
      createElement('div', null,
        createElement('h1', { className: 'ma-workbench-title' }, '多 Agent 协作验证'),
        createElement('p', { className: 'ma-workbench-subtitle' }, '拖入 Agent，连接依赖，查看完整验证链路与可复现证据。'),
      ),
      createElement('div', { className: 'ma-actions' },
        createElement('button', { className: 'ma-button', onClick: () => setOpen(false) }, '返回会话'),
        createElement('button', { className: 'ma-button ma-button-primary', disabled: running, onClick: start }, running ? '验证中…' : '开始验证'),
      ),
    ),
    createElement('div', { className: 'ma-layout' },
      createElement('aside', { className: 'ma-panel' },
        createElement('div', { className: 'ma-panel-heading' }, 'Agent 工具箱'),
        createElement('div', { className: 'ma-palette' }, AGENTS.map((agent) => createElement('div', {
          key: agent.role, className: 'ma-agent-card', draggable: true,
          onDragStart: (event) => event.dataTransfer.setData('application/x-agnes-agent', agent.role),
        }, createElement('span', { className: 'ma-agent-dot' }, agent.icon), agent.label))),
      ),
      createElement('main', { className: 'ma-panel ma-canvas', onDragOver: (event) => event.preventDefault(), onDrop: drop },
        createElement('svg', { className: 'ma-edge-layer', 'aria-hidden': 'true' },
          createElement('defs', null, createElement('marker', { id: 'ma-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' }, createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor' }))),
          edges.map((edge) => { const from = nodes.find((node) => node.id === edge.from); const to = nodes.find((node) => node.id === edge.to); if (!from || !to) return null; return createElement('path', { key: `${edge.from}-${edge.to}`, className: 'ma-edge', d: `M ${from.x + 156} ${from.y + 40} C ${from.x + 205} ${from.y + 40}, ${to.x - 45} ${to.y + 40}, ${to.x} ${to.y + 40}` }) }),
        ),
        !nodes.length && createElement('div', { className: 'ma-canvas-hint' }, '把左侧 Agent 拖到这里开始编排'),
        nodes.map((node) => { const info = roleInfo(node.role); return createElement('article', {
          key: node.id, className: 'ma-node', draggable: true, 'data-selected': selected === node.id,
          style: { left: node.x, top: node.y },
          onDragStart: (event) => { event.stopPropagation(); event.dataTransfer.setData('application/x-agnes-node', node.id) },
          onClick: () => setSelected(node.id),
        },
          createElement('div', { className: 'ma-node-head' }, createElement('span', { className: 'ma-agent-dot' }, info.icon), node.label),
          createElement('div', { className: 'ma-node-role' }, node.id),
          createElement('button', { className: 'ma-node-port ma-node-port-in', title: '连接到此 Agent', onClick: (event) => { event.stopPropagation(); connect(node.id) } }),
          createElement('button', { className: 'ma-node-port', title: connection ? '选择下游 Agent' : '选择连线起点', onClick: (event) => { event.stopPropagation(); connection ? connect(node.id) : setConnection(node.id) } }),
        ) }),
      ),
      createElement('aside', { className: 'ma-panel' },
        createElement('div', { className: 'ma-panel-heading' }, '配置与 Trace'),
        createElement('div', { className: 'ma-inspector' },
          selectedNode ? createElement('div', { className: 'ma-field' }, '当前 Agent', createElement('input', { value: selectedNode.label, readOnly: true }), createElement('textarea', {
            value: selectedNode.prompt,
            placeholder: '给这个 Agent 的专属指令…',
            onChange: (event) => setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, prompt: event.target.value } : node)),
          }), createElement('button', { className: 'ma-button', disabled: running, onClick: () => { setTrace((current) => [{ message: `agent.message · ${selectedNode.id}`, time: new Date().toLocaleTimeString() }, ...current]); void start() } }, '发送并开始')) : createElement('div', { className: 'ma-status' }, '点击节点查看配置'),
          createElement('label', { className: 'ma-field' }, '验证任务', createElement('textarea', { value: prompt, onChange: (event) => setPrompt(event.target.value), placeholder: '描述需要验证的科研内容…' })),
          createElement('div', { className: 'ma-status', 'data-kind': statusKind }, status),
        ),
        createElement('div', { className: 'ma-panel-heading' }, '过程留痕'),
        createElement('div', { className: 'ma-trace' }, trace.length ? trace.map((item, index) => createElement(TraceItem, { key: `${item.time}-${index}`, item })) : createElement('div', { className: 'ma-status' }, '启动后将在这里显示计划、执行与证据事件。')),
      ),
    ),
  )
}

export function apply(ctx) {
  ctx.slots.register('sidebar.workspaces', Entry, { priority: -2 })
  ctx.slots.register('workbench.panel', (props) => createElement(Workbench, { ...props, ctx }), { priority: -2 })
}

export { graphPlan, validateGraph }
