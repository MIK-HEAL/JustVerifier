export const AGENTS = [
  { role: 'planner', label: '规划 Agent', icon: '⌘', capability: 'research.plan' },
  { role: 'executor', label: '执行 Agent', icon: '▶', capability: 'research.execute' },
  { role: 'reviewer', label: '审查 Agent', icon: '✓', capability: 'research.review' },
  { role: 'verifier', label: '验证 Agent', icon: '∴', capability: 'research.verify' },
  { role: 'agnes', label: '当前 Agnes Agent', icon: '✦', capability: 'agnes.current' },
  { role: 'synthesizer', label: '综合 Agent', icon: '⊕', capability: 'research.synthesize' },
]

export const roleInfo = (role) => AGENTS.find((agent) => agent.role === role) ?? AGENTS[3]

export function nextNodeId(nodes, role) {
  let suffix = nodes.filter((node) => node.role === role).length + 1
  const used = new Set(nodes.map((node) => node.id))
  while (used.has(`${role}-${suffix}`)) suffix += 1
  return `${role}-${suffix}`
}

export function createNode(role, id, position) {
  return { id, role, label: roleInfo(role).label, prompt: '', x: position.x, y: position.y }
}
