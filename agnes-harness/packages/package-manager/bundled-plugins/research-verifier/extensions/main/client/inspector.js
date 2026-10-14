import { createElement, useEffect, useState } from 'react'

const statusLabels = {
  completed: '已完成',
  failed: '失败',
  blocked: '已阻塞',
  cancelled: '已取消',
  running: '执行中',
  queued: '排队中',
}
const reportLabels = { pass: '验证通过', warn: '需要注意', fail: '验证失败', unknown: '无法判定' }
const roleLabels = { planner: '规划 Agent', executor: '执行 Agent', reviewer: '审查 Agent', verifier: '验证 Agent' }

function humanStatus(value) {
  return statusLabels[value] ?? value ?? '未知'
}

function artifactLabel(id) {
  const text = String(id ?? '')
  const parts = text.split('/')
  return parts.at(-1) === 'result' ? `${parts.at(-2) ?? '输出'} · 结果` : text
}

function reportExplanation(report) {
  if (!report) return '验证器尚未返回最终报告。'
  if (report.status === 'unknown')
    return 'Agent 已完成任务，但本次运行没有生成可重放的验证证书。系统因此无法确认结论，也不会仅凭 Agent 的文字把它判定为通过。'
  if (report.status === 'fail') return '至少一项必要校验失败，请查看下方的规则详情和校验问题。'
  if (report.status === 'warn') return '验证完成，但有部分证据或假设需要人工注意。'
  return '所有必要校验均已通过。'
}

function ResultDialog({ result, onClose }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const report = result?.report
  return createElement(
    'div',
    { className: 'ma-result-backdrop', role: 'presentation', onMouseDown: (event) => event.target === event.currentTarget && onClose() },
    createElement(
      'section',
      { className: 'ma-result-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '完整验证结果' },
      createElement(
        'header',
        { className: 'ma-result-header' },
        createElement('div', null, createElement('h2', null, '完整验证结果'), createElement('p', null, `运行状态：${humanStatus(result.status)}`)),
        createElement('button', { className: 'ma-button', type: 'button', onClick: onClose, 'aria-label': '关闭结果' }, '关闭'),
      ),
      createElement(
        'div',
        { className: 'ma-result-body' },
        report &&
          createElement(
            'section',
            { className: 'ma-result-section ma-result-summary' },
            createElement('div', { className: 'ma-result-section-title' }, '验证结论'),
            createElement('div', { className: 'ma-result-status', 'data-status': report.status }, reportLabels[report.status] ?? report.status),
            createElement('p', null, reportExplanation(report)),
          ),
        createElement(
          'section',
          { className: 'ma-result-section' },
          createElement('div', { className: 'ma-result-section-title' }, `Agent 执行（${result.attempts?.length ?? 0}）`),
          ...(result.attempts ?? []).map((attempt) =>
            createElement(
              'article',
              { key: attempt.attempt_id, className: 'ma-result-attempt' },
              createElement('div', { className: 'ma-result-attempt-head' }, createElement('strong', null, attempt.task_id), createElement('span', { 'data-status': attempt.status }, humanStatus(attempt.status))),
              createElement('div', { className: 'ma-result-meta' }, `${roleLabels[attempt.agent_id] ?? attempt.agent_id} · ${attempt.attempt_id}`),
              attempt.error && createElement('p', { className: 'ma-result-error' }, `${attempt.error.code}：${attempt.error.message}`),
              attempt.output_artifact_ids?.length ? createElement('div', { className: 'ma-result-meta' }, `输出：${attempt.output_artifact_ids.map(artifactLabel).join('、')}`) : null,
            ),
          ),
        ),
        report?.verification?.results?.length
          ? createElement(
              'section',
              { className: 'ma-result-section' },
              createElement('div', { className: 'ma-result-section-title' }, '校验规则详情'),
              ...report.verification.results.map((rule) =>
                createElement(
                  'article',
                  { key: rule.rule_id, className: 'ma-result-rule' },
                  createElement('div', { className: 'ma-result-rule-head' }, createElement('strong', null, rule.rule_id), createElement('span', { 'data-status': rule.status }, reportLabels[rule.status] ?? rule.status)),
                  createElement('p', null, rule.message),
                ),
              ),
            )
          : null,
        createElement(
          'section',
          { className: 'ma-result-section' },
          createElement('div', { className: 'ma-result-section-title' }, `证据与校验和（${result.artifacts?.length ?? 0}）`),
          ...(result.artifacts ?? []).map((artifact) =>
            createElement(
              'details',
              { key: `${artifact.id}@${artifact.version}`, className: 'ma-result-artifact' },
              createElement('summary', null, artifactLabel(artifact.id)),
              createElement('code', null, `${artifact.id}@${artifact.version}\n${artifact.checksum}`),
              artifact.preview ? createElement('pre', { className: 'ma-result-preview' }, artifact.preview) : createElement('p', { className: 'ma-result-meta' }, '没有可显示的 Agent 输出正文。'),
            ),
          ),
        ),
        report?.validation_errors?.length
          ? createElement('section', { className: 'ma-result-section ma-result-errors' }, createElement('div', { className: 'ma-result-section-title' }, '校验问题'), createElement('ul', null, ...report.validation_errors.map((error) => createElement('li', { key: error }, error))))
          : null,
      ),
    ),
  )
}

function TraceItem({ item }) {
  return createElement(
    'div',
    { className: 'ma-trace-item', 'data-kind': item.kind ?? '' },
    createElement('div', { className: 'ma-trace-message' }, item.message),
    createElement('div', { className: 'ma-trace-time' }, item.time),
  )
}

const PlayIcon = createElement(
  'svg',
  { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
  createElement('path', { d: 'M6 4.5 11.5 8 6 11.5Z', fill: 'currentColor' }),
)

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
  result,
  onPromptChange,
  onNodePromptChange,
  onRunSingleAgent,
}) {
  const [resultOpen, setResultOpen] = useState(false)
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
          : createElement(
              'div',
              { className: 'ma-selection-hint' },
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
    result &&
      createElement(
        'div',
        { className: 'ma-inspector' },
        createElement('strong', null, `执行结果 · ${humanStatus(result.status)}`),
        result.report &&
          createElement(
            'p',
            null,
            `验证结论：${reportLabels[result.report.status] ?? result.report.status}。${reportExplanation(result.report)}`,
          ),
        createElement('button', { className: 'ma-button ma-result-open', type: 'button', onClick: () => setResultOpen(true) }, '查看完整结果'),
        ...(result.attempts ?? []).slice(0, 3).map((attempt) =>
          createElement(
            'div',
            { key: attempt.attempt_id, className: 'ma-status' },
            `${attempt.task_id} · ${attempt.status}${attempt.error ? ` · ${attempt.error.code}` : ''}`,
          ),
        ),
        ...(result.artifacts ?? []).slice(0, 2).map((artifact) =>
          createElement(
            'details',
            { key: artifact.id },
            createElement('summary', null, artifact.id),
            createElement('code', null, artifact.checksum),
          ),
        ),
      ),
    resultOpen && result && createElement(ResultDialog, { result, onClose: () => setResultOpen(false) }),
    createElement(
      'div',
      { className: 'ma-panel-heading' },
      createElement('span', null, '过程留痕'),
      createElement('span', { className: 'ma-count' }, trace.length),
    ),
    createElement(
      'div',
      { className: 'ma-trace' },
      trace.length
        ? trace.map((item, index) => createElement(TraceItem, { key: `${item.time}-${index}`, item }))
        : createElement(
            'div',
            { className: 'ma-trace-empty' },
            createElement('span', { className: 'ma-trace-empty-icon', 'aria-hidden': 'true' }, '≡'),
            createElement('strong', null, '验证过程将在这里记录'),
            createElement('p', null, '开始验证后，查看每一步的计划、执行与证据事件。'),
          ),
    ),
  )
}
