import { createElement } from 'react'
import { AGENTS } from './agents.js'

export function AgentPalette({ onAdd, onTemplate }) {
  return createElement(
    'aside',
    { className: 'ma-panel' },
    createElement('div', { className: 'ma-panel-heading' }, 'Agent 工具箱'),
    createElement(
      'div',
      { className: 'ma-palette' },
      createElement('div', { className: 'ma-palette-section-label' }, '可用 Agent'),
      AGENTS.map((agent) =>
        createElement(
          'div',
          {
            key: agent.role,
            className: 'ma-agent-card',
            'data-role': agent.role,
            draggable: true,
            title: '拖到画布放置，或点击添加',
            onDragStart: (event) => event.dataTransfer.setData('application/x-agnes-agent', agent.role),
            onClick: () => onAdd(agent.role),
          },
          createElement('span', { className: 'ma-agent-dot' }, agent.icon),
          createElement('span', null, agent.label),
        ),
      ),
      createElement('div', { className: 'ma-palette-section-label' }, '快速编排'),
      createElement('button', { className: 'ma-template-card', type: 'button', onClick: () => onTemplate('evidence') }, createElement('strong', null, '证据链验证'), createElement('span', null, '规划 → 执行 → 审查 → 验证')),
      createElement('button', { className: 'ma-template-card', type: 'button', onClick: () => onTemplate('single') }, createElement('strong', null, '当前 Agent 快速验证'), createElement('span', null, '直接使用 Agnes 当前会话 Agent')),
      createElement('button', { className: 'ma-agnes-link', type: 'button', onClick: () => window.dispatchEvent(new CustomEvent('agnes:agents-open')) }, '打开 Agnes Agent 管理页 ↗'),
    ),
  )
}
