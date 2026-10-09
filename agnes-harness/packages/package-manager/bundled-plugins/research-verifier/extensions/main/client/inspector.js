import { createElement } from 'react'

function TraceItem({ item }) {
  return createElement(
    'div',
    { className: 'ma-trace-item', 'data-kind': item.kind ?? '' },
    createElement('div', { className: 'ma-trace-message' }, item.message),
    createElement('div', { className: 'ma-trace-time' }, item.time),
  )
}

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
    { className: 'ma-panel' },
    createElement('div', { className: 'ma-panel-heading' }, '配置与 Trace'),
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
          : createElement('div', { className: 'ma-status' }, '点击节点查看配置'),
      createElement(
        'label',
        { className: 'ma-field' },
        createElement('span', { className: 'ma-field-label' }, '验证任务'),
        createElement('textarea', {
          value: prompt,
          onChange: (event) => onPromptChange(event.target.value),
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
  )
}
