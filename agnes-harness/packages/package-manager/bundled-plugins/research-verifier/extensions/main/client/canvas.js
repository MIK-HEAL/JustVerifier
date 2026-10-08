import { createElement, useRef, useState } from 'react'
import { roleInfo } from './agents.js'

export function Canvas({
  nodes,
  edges,
  selected,
  connectFrom,
  canvasRef,
  onSelect,
  onMoveNode,
  onDeleteNode,
  onDeleteEdge,
  onDropRole,
  onConnectFromChange,
  onConnectEnd,
}) {
  const [cursor, setCursor] = useState(null)
  const dragRef = useRef(null)
  const nodeRefs = useRef(new Map())

  const setNodeRef = (id) => (element) => {
    if (element) nodeRefs.current.set(id, element)
    else nodeRefs.current.delete(id)
  }

  const canvasPoint = (event) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  const anchor = (node, side) => {
    const element = nodeRefs.current.get(node.id)
    const width = element?.offsetWidth ?? 156
    const height = element?.offsetHeight ?? 64
    return side === 'out'
      ? { x: node.x + width, y: node.y + height / 2 }
      : { x: node.x, y: node.y + height / 2 }
  }

  const edgeGeometry = (edge) => {
    const from = nodes.find((node) => node.id === edge.from)
    const to = nodes.find((node) => node.id === edge.to)
    if (!from || !to) return undefined
    const start = anchor(from, 'out')
    const end = anchor(to, 'in')
    const bend = Math.max(36, Math.abs(end.x - start.x) / 2)
    return { start, end, bend, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }
  }

  const curve = ({ start, end, bend }) =>
    `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`

  const startNodeDrag = (event, node) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = canvasRef.current?.getBoundingClientRect()
    dragRef.current = {
      id: node.id,
      dx: event.clientX - (rect?.left ?? 0) - node.x,
      dy: event.clientY - (rect?.top ?? 0) - node.y,
    }
    onSelect({ kind: 'node', id: node.id })
  }

  const moveNodeDrag = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const rect = canvasRef.current?.getBoundingClientRect()
    onMoveNode(
      drag.id,
      Math.max(12, event.clientX - (rect?.left ?? 0) - drag.dx),
      Math.max(12, event.clientY - (rect?.top ?? 0) - drag.dy),
    )
  }

  const endNodeDrag = () => {
    dragRef.current = null
  }

  const startConnection = (event, node) => {
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    onConnectFromChange(node.id)
    setCursor(canvasPoint(event))
  }

  const moveConnection = (event) => {
    if (!connectFrom) return
    setCursor(canvasPoint(event))
  }

  const endConnection = (event) => {
    if (!connectFrom) return
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const target = element?.closest?.('[data-node-id]')
    onConnectEnd(connectFrom, target?.dataset.nodeId ?? null)
  }

  const onCanvasPointerDown = (event) => {
    if (event.target === event.currentTarget) onSelect(null)
  }

  const onCanvasDrop = (event) => {
    event.preventDefault()
    const role = event.dataTransfer.getData('application/x-agnes-agent')
    if (!role) return
    const rect = event.currentTarget.getBoundingClientRect()
    onDropRole(role, {
      x: Math.max(12, event.clientX - rect.left - 78),
      y: Math.max(12, event.clientY - rect.top - 30),
    })
  }

  let preview = null
  if (connectFrom && cursor) {
    const from = nodes.find((node) => node.id === connectFrom)
    if (from) {
      const start = anchor(from, 'out')
      const bend = Math.max(36, Math.abs(cursor.x - start.x) / 2)
      preview = curve({ start, end: cursor, bend })
    }
  }

  return createElement(
    'main',
    {
      ref: canvasRef,
      className: 'ma-panel ma-canvas',
      'aria-label': '编排画布',
      onPointerDown: onCanvasPointerDown,
      onDragOver: (event) => event.preventDefault(),
      onDrop: onCanvasDrop,
    },
    createElement(
      'svg',
      { className: 'ma-edge-layer', 'aria-hidden': 'true' },
      createElement(
        'defs',
        null,
        createElement(
          'marker',
          {
            id: 'ma-arrow',
            viewBox: '0 0 10 10',
            refX: '9',
            refY: '5',
            markerWidth: '5',
            markerHeight: '5',
            orient: 'auto-start-reverse',
          },
          createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor' }),
        ),
      ),
      edges.map((edge) => {
        const geometry = edgeGeometry(edge)
        if (!geometry) return null
        const isSelected =
          selected?.kind === 'edge' && selected.from === edge.from && selected.to === edge.to
        return createElement(
          'g',
          { key: `${edge.from}>${edge.to}` },
          createElement('path', {
            className: 'ma-edge',
            d: curve(geometry),
            'data-selected': isSelected,
            markerEnd: 'url(#ma-arrow)',
          }),
          createElement('path', {
            className: 'ma-edge-hit',
            d: curve(geometry),
            onClick: () => onSelect({ kind: 'edge', from: edge.from, to: edge.to }),
          }),
          isSelected &&
            createElement(
              'g',
              {
                className: 'ma-edge-delete',
                transform: `translate(${geometry.mid.x}, ${geometry.mid.y})`,
                onClick: (event) => {
                  event.stopPropagation()
                  onDeleteEdge(edge.from, edge.to)
                },
              },
              createElement('circle', { r: 8 }),
              createElement('path', { d: 'M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5' }),
            ),
        )
      }),
      preview && createElement('path', { className: 'ma-edge-preview', d: preview }),
    ),
    !nodes.length &&
      createElement('div', { className: 'ma-canvas-hint' }, '把左侧 Agent 拖到这里，或点击卡片添加'),
    nodes.map((node) => {
      const info = roleInfo(node.role)
      const isSelected = selected?.kind === 'node' && selected.id === node.id
      const connectTarget = Boolean(connectFrom) && connectFrom !== node.id
      return createElement(
        'article',
        {
          key: node.id,
          ref: setNodeRef(node.id),
          className: 'ma-node',
          'data-node-id': node.id,
          'data-role': node.role,
          'data-selected': isSelected,
          'data-connect-target': connectTarget,
          style: { left: node.x, top: node.y },
          onPointerDown: (event) => startNodeDrag(event, node),
          onPointerMove: moveNodeDrag,
          onPointerUp: endNodeDrag,
          onPointerCancel: endNodeDrag,
        },
        createElement(
          'button',
          {
            className: 'ma-node-delete',
            type: 'button',
            title: '删除节点',
            'aria-label': `删除 ${node.label}`,
            onPointerDown: (event) => event.stopPropagation(),
            onClick: (event) => {
              event.stopPropagation()
              onDeleteNode(node.id)
            },
          },
          '×',
        ),
        createElement(
          'div',
          { className: 'ma-node-head' },
          createElement('span', { className: 'ma-agent-dot' }, info.icon),
          createElement('span', { className: 'ma-node-label' }, node.label),
        ),
        createElement('div', { className: 'ma-node-role' }, node.id),
        createElement('span', { className: 'ma-node-port ma-node-port-in', title: '输入端口' }),
        createElement('span', {
          className: 'ma-node-port ma-node-port-out',
          title: '从此 Agent 连出',
          onPointerDown: (event) => startConnection(event, node),
          onPointerMove: moveConnection,
          onPointerUp: endConnection,
          onPointerCancel: () => onConnectFromChange(null),
        }),
      )
    }),
  )
}
