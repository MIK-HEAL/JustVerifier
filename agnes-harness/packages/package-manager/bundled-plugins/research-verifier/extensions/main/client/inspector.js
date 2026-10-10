import { createElement } from 'react'

function TraceItem({ item }) {
  return createElement(
    'div',
    { className: 'ma-trace-item', 'data-kind': item.kind ?? '' },
    createElement('div', { className: 'ma-trace-message' }, item.message),
    createElement('div', { className: 'ma-trace-time' }, item.time),
  )
}

const PlayIcon = createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
  createElement('path', { d: 'M6 4.5 11.5 8 6 11.5Z', fill: 'currentColor' }))

function AgentFields({ node, running, onNodePromptChange, onRunSingleAgent }) {
  return createElement(
    'div',
    { className: 'ma-fieldset' },
    createElement(
      'div',
      { className: 'ma-field' },
      createElement('span', { className: 'ma-field-label' }, '当前 Agent'),
      createElement('input', { value: node.label, readOnly: true }),
    ),
    createElement(
      'label',
      { className: 'ma-field' },
      createElement('span', { className: 'ma-field-label' }, '专属指令'),
      createElement('textarea', {
        value: node.prompt,
        placeholder: '给这个 Agent 的专属指令…',
        onChange: (event) => onNodePromptChange(node.id, event.target.value),
      }),
    ),
    createElement(
      'button',
      {
        className: 'ma-button',
        type: 'button',
        disabled: running,
        onClick: () => onRunSingleAgent(node),
      },
      PlayIcon,
      '单独运行此 Agent',
    ),
  )
}

export function Inspector({
  selection,
  prompt,
  running,
  trace,
  onPromptChange,
  onNodePromptChange,
  onRunSingleAgent,
}) {
  const selectedNode = selection?.kind === 'node' ? selection.node : undefined
  const selectedEdge = selection?.kind === 'edge' ? selection.edge : undefined
  return createElement(
    'aside',
    { className: 'ma-panel ma-inspector-panel' },
    createElement('div', { className: 'ma-panel-heading' }, '任务配置'),
    createElement(
      'div',
      { className: 'ma-inspector' },
      selectedNode
        ? createElement(AgentFields, {
            node: selectedNode,
            running,
            onNodePromptChange,
            onRunSingleAgent,
          })
        : selectedEdge
          ? createElement(
              'div',
              { className: 'ma-status' },
              `选中连线：${selectedEdge.from} → ${selectedEdge.to}（按 Delete 删除）`,
            )
          : createElement('div', { className: 'ma-selection-hint' },
              createElement('strong', null, '先定义你的研究问题'),
              createElement('span', null, '选中画布中的 Agent，可进一步设置专属指令。'),
            ),
      createElement(
        'label',
        { className: 'ma-field' },
        createElement('span', { className: 'ma-field-label' }, '验证任务'),
        createElement('span', { className: 'ma-field-help' }, '描述需要核对的结论、数据或统计假设。'),
        createElement('textarea', {
          value: prompt,
          onChange: (event) => onPromptChange(event.target.value),
          placeholder: '描述需要验证的科研内容…',
        }),
      ),
    ),
    createElement('div', { className: 'ma-panel-heading' },
      createElement('span', null, '过程留痕'),
      createElement('span', { className: 'ma-count' }, trace.length),
    ),
    createElement(
      'div',
      { className: 'ma-trace' },
      trace.length
        ? trace.map((item, index) => createElement(TraceItem, { key: `${item.time}-${index}`, item }))
        : createElement('div', { className: 'ma-trace-empty' },
            createElement('span', { className: 'ma-trace-empty-icon', 'aria-hidden': 'true' }, '≡'),
            createElement('strong', null, '验证过程将在这里记录'),
            createElement('p', null, '开始验证后，查看每一步的计划、执行与证据事件。'),
          ),
    ),
  )
}
