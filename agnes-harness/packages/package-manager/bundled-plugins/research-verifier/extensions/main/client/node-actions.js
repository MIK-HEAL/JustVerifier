import { createElement } from 'react'

const PlayIcon = createElement(
  'svg',
  { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
  createElement('path', {
    d: 'M6.2 4.6 L11.4 8 L6.2 11.4 Z',
    fill: 'currentColor',
    stroke: 'currentColor',
    strokeWidth: '1.2',
    strokeLinejoin: 'round',
  }),
)

const CloseIcon = createElement(
  'svg',
  { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
  createElement('path', {
    d: 'M5 5 L11 11 M11 5 L5 11',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.6',
    strokeLinecap: 'round',
  }),
)

function CircleButton({ className, title, label, onClick, children }) {
  return createElement(
    'button',
    {
      className,
      type: 'button',
      title,
      'aria-label': label,
      onClick: (event) => {
        event.stopPropagation()
        onClick()
      },
      onPointerDown: (event) => event.stopPropagation(),
    },
    children,
  )
}

export function NodeActions({ node, onDelete, onRun }) {
  return createElement(
    'div',
    {
      className: 'ma-node-actions',
      onPointerDown: (event) => event.stopPropagation(),
    },
    createElement(CircleButton, {
      className: 'ma-node-action ma-node-action-run',
      title: '直接运行此 Agent',
      label: `直接运行 ${node.label}`,
      onClick: () => onRun(node),
      children: PlayIcon,
    }),
    createElement(CircleButton, {
      className: 'ma-node-action ma-node-action-delete ma-node-delete',
      title: '删除节点',
      label: `删除 ${node.label}`,
      onClick: () => onDelete(node.id),
      children: CloseIcon,
    }),
  )
}
