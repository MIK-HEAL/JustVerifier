import { roleInfo } from './agents.js'

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export async function digest(value) {
  const source = new TextEncoder().encode(stable(value))
  if (globalThis.crypto?.subtle) {
    const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', source))
    return `sha256:${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  let hash = 2166136261
  for (const byte of source) hash = Math.imul(hash ^ byte, 16777619)
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function graphPlan(nodes, edges) {
  const agents = nodes.map((node) => ({
    agent_id: node.id,
    role: node.role,
    revision: 'ui-v1',
    capabilities: [roleInfo(node.role).capability],
    trust: 'trusted',
  }))
  const incoming = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) incoming.get(edge.to)?.push(`task-${edge.from}`)
  const tasks = nodes.map((node) => ({
    task_id: `task-${node.id}`,
    agent_id: node.id,
    mode: 'serial',
    ...(incoming.get(node.id)?.length ? { depends_on: [...new Set(incoming.get(node.id))].sort() } : {}),
    output_namespace: `${node.id}/output`,
  }))
  const planner = nodes.find((node) => node.role === 'planner') ?? nodes[0]
  return {
    schema_version: 1,
    plan_id: `plan-${Date.now().toString(36)}`,
    run_id: `draft-${Date.now().toString(36)}`,
    root_agent_id: planner?.id ?? '',
    agents,
    tasks,
  }
}

export function validateGraph(nodes, edges) {
  const errors = []
  if (!nodes.length) errors.push('至少拖入一个 Agent')
  if (!nodes.some((node) => node.role === 'planner')) errors.push('需要一个规划 Agent 作为根节点')
  const ids = new Set(nodes.map((node) => node.id))
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push('连线引用了不存在的节点')
    if (edge.from === edge.to) errors.push('不能连接节点自身')
  }
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  const outgoing = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to)
  const queue = [...nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id)]
  let visited = 0
  while (queue.length) {
    const id = queue.shift()
    visited += 1
    for (const next of outgoing.get(id) ?? []) {
      incoming.set(next, (incoming.get(next) ?? 0) - 1)
      if (incoming.get(next) === 0) queue.push(next)
    }
  }
  if (visited !== nodes.length) errors.push('编排图存在循环依赖')
  return [...new Set(errors)]
}
