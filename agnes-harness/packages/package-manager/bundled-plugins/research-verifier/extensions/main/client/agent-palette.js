import { createElement } from 'react'
import { AGENTS } from './agents.js'

const descriptions = {
  planner: '拆解问题，制定验证计划',
  executor: '执行分析，收集研究证据',
  reviewer: '审查方法，识别潜在偏差',
  verifier: '核对结论，检验证据链',
  agnes: '使用当前会话的 Agent',
  synthesizer: '汇总发现，形成综合结论',
}

export function AgentPalette({ onAdd, onTemplate }) {
  return createElement(
    'aside',
    { className: 'ma-panel ma-palette-panel' },
    createElement('div', { className: 'ma-panel-heading' },
      createElement('span', null, 'Agent 工具箱'),
      createElement('span', { className: 'ma-count' }, AGENTS.length),
    ),
    createElement(
      'div',
      { className: 'ma-palette' },
      createElement('div', { className: 'ma-palette-section-label' }, '可用 Agent'),
      AGENTS.map((agent) =>
        createElement(
          'button',
          {
            key: agent.role,
            className: 'ma-agent-card',
            'data-role': agent.role,
            draggable: true,
            title: '拖到画布放置，或点击添加',
            onDragStart: (event) => event.dataTransfer.setData('application/x-agnes-agent', agent.role),
            onClick: () => onAdd(agent.role),
            type: 'button',
            'aria-label': `添加 ${agent.label}`,
          },
          createElement('span', { className: 'ma-agent-dot' }, agent.icon),
          createElement('span', { className: 'ma-agent-copy' },
            createElement('strong', null, agent.label),
            createElement('small', null, descriptions[agent.role]),
          ),
          createElement('span', { className: 'ma-agent-add', 'aria-hidden': 'true' }, '+'),
        ),
      ),
      createElement('div', { className: 'ma-palette-section-label' }, '快速编排'),
      createElement('button', { className: 'ma-template-card', type: 'button', onClick: () => onTemplate('evidence') }, createElement('strong', null, '证据链验证', createElement('span', { className: 'ma-template-arrow', 'aria-hidden': 'true' }, '↗')), createElement('span', null, '规划 → 执行 → 审查 → 验证')),
      createElement('button', { className: 'ma-template-card', type: 'button', onClick: () => onTemplate('single') }, createElement('strong', null, '当前 Agent 快速验证', createElement('span', { className: 'ma-template-arrow', 'aria-hidden': 'true' }, '↗')), createElement('span', null, '直接使用当前会话 Agent')),
      createElement('button', { className: 'ma-agnes-link', type: 'button', onClick: () => window.dispatchEvent(new CustomEvent('agnes:agents-open')) }, '打开 Agnes Agent 管理页 ↗'),
    ),
  )
}
