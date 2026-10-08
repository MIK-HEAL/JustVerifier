import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AGENTS, createNode, nextNodeId } from './agents.js'
import { digest, graphPlan, validateGraph } from './plan.js'
import { Canvas } from './canvas.js'

export const OPEN_EVENT = 'agnes:multi-agent-open'
export const CLOSE_EVENT = 'agnes:multi-agent-close'

function TraceItem({ item }) {
  return createElement(
    'div',
    { className: 'ma-trace-item', 'data-kind': item.kind ?? '' },
    createElement('div', { className: 'ma-trace-message' }, item.message),
    createElement('div', { className: 'ma-trace-time' }, item.time),
  )
}

export function Workbench({ sessionId, ctx }) {
  const [open, setOpen] = useState(false)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selected, setSelected] = useState(null)
  const [connectFrom, setConnectFrom] = useState(null)
  const [prompt, setPrompt] = useState('请验证这项科研结论，检查数据、统计假设与证据链。')
  const [status, setStatus] = useState('等待编排')
  const [statusKind, setStatusKind] = useState('')
  const [trace, setTrace] = useState([])
  const [running, setRunning] = useState(false)
  const canvasRef = useRef(null)
  const closeRef = useRef(null)
  const selectedNode =
    selected?.kind === 'node' ? nodes.find((node) => node.id === selected.id) : undefined
  const errors = useMemo(() => validateGraph(nodes, edges), [nodes, edges])

  const now = () => new Date().toLocaleTimeString()
  const closeOverlay = useCallback(() => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent(CLOSE_EVENT))
  }, [])

  useEffect(() => {
    const openPanel = () => setOpen(true)
    const closePanel = () => setOpen(false)
    window.addEventListener(OPEN_EVENT, openPanel)
    window.addEventListener(CLOSE_EVENT, closePanel)
    return () => {
      window.removeEventListener(OPEN_EVENT, openPanel)
      window.removeEventListener(CLOSE_EVENT, closePanel)
    }
  }, [])

  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  const deleteNode = useCallback((id) => {
    setNodes((current) => current.filter((node) => node.id !== id))
    setEdges((current) => current.filter((edge) => edge.from !== id && edge.to !== id))
    setSelected(null)
    setConnectFrom(null)
  }, [])

  const deleteEdge = useCallback((from, to) => {
    setEdges((current) => current.filter((edge) => edge.from !== from || edge.to !== to))
    setSelected(null)
  }, [])

  const addNode = (role, position) => {
    const id = nextNodeId(nodes, role)
    setNodes((current) => [...current, createNode(role, id, position)])
    setSelected({ kind: 'node', id })
  }

  const paletteAdd = (role) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 640
    const height = rect?.height ?? 400
    addNode(role, {
      x: Math.max(12, width / 2 - 78 + (nodes.length % 3) * 40),
      y: Math.max(12, height / 2 - 30 + Math.floor(nodes.length / 3) * 36),
    })
  }

  const connect = (from, to) => {
    if (!to || to === from) {
      setConnectFrom(null)
      return
    }
    setEdges((current) =>
      current.some((edge) => edge.from === from && edge.to === to)
        ? current
        : [...current, { from, to }],
    )
    setConnectFrom(null)
  }

  const start = async () => {
    if (errors.length) {
      setStatus(errors[0])
      setStatusKind('error')
      return
    }
    setRunning(true)
    setStatus('正在生成不可变编排快照…')
    setStatusKind('')
    const base = graphPlan(nodes, edges)
    const plan = { ...base, checksum: await digest(base) }
    setTrace((current) => [{ message: `plan.created · ${plan.checksum}`, time: now() }, ...current])
    try {
      const agent_prompts = Object.fromEntries(
        nodes.filter((node) => node.prompt).map((node) => [node.id, node.prompt]),
      )
      const result = await ctx.agnes.services.call('research.multiagent.start', {
        prompt,
        plan,
        agent_prompts,
        session_id: sessionId,
      })
      const output = result?.output ?? result
      const resultTrace = Array.isArray(output?.trace) ? output.trace : []
      setTrace((current) => [
        ...resultTrace.map((item) => ({
          message: item.kind ?? 'verification.queued',
          kind: item.kind,
          time: now(),
        })),
        ...current,
      ])
      setStatus(`已排队（尚无执行器） · ${output?.run_id ?? 'run pending'}`)
      setStatusKind('success')
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
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (connectFrom) {
          setConnectFrom(null)
          return
        }
        closeOverlay()
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        const active = document.activeElement
        if (
          active instanceof HTMLElement &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
        )
          return
        if (selected.kind === 'node') deleteNode(selected.id)
        else deleteEdge(selected.from, selected.to)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, connectFrom, selected, deleteNode, deleteEdge, closeOverlay])

  if (!open) return null
  return createElement(
    'section',
    {
      className: 'ma-overlay',
      'data-agnes-multi-agent': true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '多 Agent 协作验证',
    },
    createElement(
      'header',
      { className: 'ma-overlay-header' },
      createElement(
        'div',
        { className: 'ma-overlay-heading' },
        createElement('h1', { className: 'ma-overlay-title' }, '多 Agent 协作验证'),
        createElement(
          'p',
          { className: 'ma-overlay-subtitle' },
          '拖入 Agent，连接依赖，查看完整验证链路与可复现证据。',
        ),
      ),
      createElement(
        'div',
        { className: 'ma-overlay-status', 'data-kind': statusKind, title: status },
        status,
      ),
      createElement(
        'div',
        { className: 'ma-actions' },
        createElement(
          'button',
          { ref: closeRef, className: 'ma-button', type: 'button', onClick: closeOverlay },
          '返回会话',
        ),
        createElement(
          'button',
          {
            className: 'ma-button ma-button-primary',
            type: 'button',
            disabled: running,
            onClick: start,
          },
          running ? '验证中…' : '开始验证',
        ),
      ),
    ),
    errors.length > 0 &&
      createElement('div', { className: 'ma-error-bar', role: 'status' }, `校验未通过：${errors.join('；')}`),
    createElement(
      'div',
      { className: 'ma-layout' },
      createElement(
        'aside',
        { className: 'ma-panel' },
        createElement('div', { className: 'ma-panel-heading' }, 'Agent 工具箱'),
        createElement(
          'div',
          { className: 'ma-palette' },
          AGENTS.map((agent) =>
            createElement(
              'div',
              {
                key: agent.role,
                className: 'ma-agent-card',
                'data-role': agent.role,
                draggable: true,
                title: '拖到画布放置，或点击添加',
                onDragStart: (event) =>
                  event.dataTransfer.setData('application/x-agnes-agent', agent.role),
                onClick: () => paletteAdd(agent.role),
              },
              createElement('span', { className: 'ma-agent-dot' }, agent.icon),
              createElement('span', null, agent.label),
            ),
          ),
        ),
      ),
      createElement(Canvas, {
        nodes,
        edges,
        selected,
        connectFrom,
        canvasRef,
        onSelect: setSelected,
        onMoveNode: (id, x, y) =>
          setNodes((current) => current.map((node) => (node.id === id ? { ...node, x, y } : node))),
        onDeleteNode: deleteNode,
        onDeleteEdge: deleteEdge,
        onDropRole: addNode,
        onConnectFromChange: setConnectFrom,
        onConnectEnd: connect,
      }),
      createElement(
        'aside',
        { className: 'ma-panel' },
        createElement('div', { className: 'ma-panel-heading' }, '配置与 Trace'),
        createElement(
          'div',
          { className: 'ma-inspector' },
          selectedNode
            ? createElement(
                'div',
                { className: 'ma-fieldset' },
                createElement(
                  'div',
                  { className: 'ma-field' },
                  createElement('span', { className: 'ma-field-label' }, '当前 Agent'),
                  createElement('input', { value: selectedNode.label, readOnly: true }),
                ),
                createElement(
                  'label',
                  { className: 'ma-field' },
                  createElement('span', { className: 'ma-field-label' }, '专属指令'),
                  createElement('textarea', {
                    value: selectedNode.prompt,
                    placeholder: '给这个 Agent 的专属指令…',
                    onChange: (event) =>
                      setNodes((current) =>
                        current.map((node) =>
                          node.id === selectedNode.id ? { ...node, prompt: event.target.value } : node,
                        ),
                      ),
                  }),
                ),
                createElement(
                  'button',
                  {
                    className: 'ma-button',
                    type: 'button',
                    disabled: running,
                    onClick: () => {
                      setTrace((current) => [
                        { message: `agent.message · ${selectedNode.id}`, time: now() },
                        ...current,
                      ])
                      void start()
                    },
                  },
                  '发送并开始',
                ),
              )
            : selected?.kind === 'edge'
              ? createElement(
                  'div',
                  { className: 'ma-status' },
                  `选中连线：${selected.from} → ${selected.to}（按 Delete 删除）`,
                )
              : createElement('div', { className: 'ma-status' }, '点击节点查看配置'),
          createElement(
            'label',
            { className: 'ma-field' },
            createElement('span', { className: 'ma-field-label' }, '验证任务'),
            createElement('textarea', {
              value: prompt,
              onChange: (event) => setPrompt(event.target.value),
              placeholder: '描述需要验证的科研内容…',
            }),
          ),
        ),
        createElement('div', { className: 'ma-panel-heading' }, '过程留痕'),
        createElement(
          'div',
          { className: 'ma-trace' },
          trace.length
            ? trace.map((item, index) => createElement(TraceItem, { key: `${item.time}-${index}`, item }))
            : createElement('div', { className: 'ma-status' }, '启动后将在这里显示计划、执行与证据事件。'),
        ),
      ),
    ),
  )
}
