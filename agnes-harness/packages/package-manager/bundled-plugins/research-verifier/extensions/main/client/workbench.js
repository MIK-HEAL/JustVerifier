import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentPalette } from './agent-palette.js'
import { createNode, nextNodeId } from './agents.js'
import { Canvas } from './canvas.js'
import { Inspector } from './inspector.js'
import { validateGraph } from './plan.js'
import { useVerificationRun } from './use-verification-run.js'

export const OPEN_EVENT = 'agnes:multi-agent-open'
export const CLOSE_EVENT = 'agnes:multi-agent-close'

const Icon = ({ path, className = 'ma-icon' }) => createElement(
  'svg', { className, viewBox: '0 0 20 20', 'aria-hidden': 'true' },
  createElement('path', { d: path, fill: 'currentColor' }),
)

export function Workbench({ sessionId, ctx, embedded = false }) {
  const [open, setOpen] = useState(embedded)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selected, setSelected] = useState(null)
  const [connectFrom, setConnectFrom] = useState(null)
  const [prompt, setPrompt] = useState('请验证这项科研结论，检查数据、统计假设与证据链。')
  const canvasRef = useRef(null)
  const closeRef = useRef(null)
  const selectedNode = selected?.kind === 'node' ? nodes.find((node) => node.id === selected.id) : undefined
  const errors = useMemo(() => validateGraph(nodes, edges), [nodes, edges])
  const { status, statusKind, trace, running, start, startSingleAgent } = useVerificationRun({
    nodes,
    edges,
    prompt,
    sessionId,
    ctx,
    errors,
  })
  const selection =
    selected?.kind === 'node'
      ? { kind: 'node', node: selectedNode }
      : selected?.kind === 'edge'
        ? { kind: 'edge', edge: selected }
        : undefined

  const closeOverlay = useCallback(() => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent(CLOSE_EVENT))
  }, [])

  useEffect(() => {
    if (embedded) return
    const openPanel = () => setOpen(true)
    const closePanel = () => setOpen(false)
    window.addEventListener(OPEN_EVENT, openPanel)
    window.addEventListener(CLOSE_EVENT, closePanel)
    return () => {
      window.removeEventListener(OPEN_EVENT, openPanel)
      window.removeEventListener(CLOSE_EVENT, closePanel)
    }
  }, [embedded])

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

  const updateNodePrompt = useCallback((id, value) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, prompt: value } : node)))
  }, [])

  const addNode = (role, position) => {
    const id = nextNodeId(nodes, role)
    setNodes((current) => [...current, createNode(role, id, position)])
    setSelected({ kind: 'node', id })
  }

  const applyTemplate = (kind) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const center = { x: Math.max(32, (rect?.width ?? 640) / 2 - 78), y: Math.max(32, (rect?.height ?? 400) / 2 - 30) }
    if (kind === 'single') {
      const id = nextNodeId(nodes, 'agnes')
      setNodes([createNode('agnes', id, center)])
      setEdges([])
      setSelected({ kind: 'node', id })
      return
    }
    const roles = ['planner', 'executor', 'reviewer', 'verifier']
    const nextNodes = roles.map((role, index) => createNode(role, `${role}-1`, { x: center.x + (index % 2) * 190, y: center.y + Math.floor(index / 2) * 120 }))
    setNodes(nextNodes)
    setEdges([{ from: 'planner-1', to: 'executor-1' }, { from: 'executor-1', to: 'reviewer-1' }, { from: 'reviewer-1', to: 'verifier-1' }])
    setSelected({ kind: 'node', id: 'planner-1' })
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
      current.some((edge) => edge.from === from && edge.to === to) ? current : [...current, { from, to }],
    )
    setConnectFrom(null)
  }

  useEffect(() => {
    if (!open || embedded) return
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
  }, [embedded, open, connectFrom, selected, deleteNode, deleteEdge, closeOverlay])

  if (!open) return null
  return createElement(
    'section',
    {
      className: embedded ? 'ma-rightbar-workbench' : 'ma-overlay',
      'data-agnes-multi-agent': true,
      role: embedded ? 'region' : 'dialog',
      ...(embedded ? {} : { 'aria-modal': 'true' }),
      'aria-label': '多 Agent 协作验证',
    },
    createElement(
      'div',
      { className: 'ma-layout' },
      createElement('div', { className: 'ma-workspace-head' },
        createElement(
          'header',
          { className: 'ma-overlay-header' },
        createElement('div', { className: 'ma-overlay-heading' },
          createElement('div', { className: 'ma-heading-copy' },
            createElement('h1', { className: 'ma-overlay-title' }, '多 Agent 协作验证'),
          ),
        ),
        createElement(
          'div',
          { className: 'ma-overlay-status', 'data-kind': statusKind, 'data-running': running, title: status, role: 'status' },
          status,
        ),
        createElement(
          'div',
          { className: 'ma-actions' },
          !embedded && createElement(
            'button',
            { ref: closeRef, className: 'ma-button', type: 'button', onClick: closeOverlay },
            Icon({ path: 'M11.5 4.5 8 8l3.5 3.5-1 1L6 8l4.5-4.5 1 1ZM14 3v10h-1.5V3H14Z' }),
            '返回会话',
          ),
          createElement(
            'button',
            {
              className: 'ma-button ma-button-primary',
              type: 'button',
              disabled: running,
              onClick: () => void start(),
            },
            Icon({ path: 'M6 4.5 15 10l-9 5.5v-11Z' }),
            running ? '验证中…' : '开始验证',
          ),
        ),
        ),
        nodes.length > 0 && errors.length > 0 &&
          createElement('div', { className: 'ma-error-bar', role: 'status' }, `校验未通过：${errors.join('；')}`),
      ),
      createElement('div', { className: 'ma-layout-panels' },
        createElement(AgentPalette, { onAdd: paletteAdd, onTemplate: applyTemplate }),
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
          onRunNode: startSingleAgent,
          onDropRole: addNode,
          onConnectFromChange: setConnectFrom,
          onConnectEnd: connect,
          onTemplate: applyTemplate,
        }),
        createElement(Inspector, {
          selection,
          prompt,
          running,
          trace,
          onPromptChange: setPrompt,
          onNodePromptChange: updateNodePrompt,
          onRunSingleAgent: startSingleAgent,
        }),
      ),
    ),
  )
}
