import { createElement, lazy, Suspense } from 'react'
import { Entry } from './entry.js'

// Keep the sidebar contribution tiny. The graph editor and its polling code are loaded only
// after the user opens the tool, so a slow verifier chunk cannot delay the main page footer.
const Workbench = lazy(() => import('./workbench.js').then((module) => ({ default: module.Workbench })))

function WorkbenchSlot(props) {
  return createElement(Suspense, { fallback: null }, createElement(Workbench, props))
}

export function apply(ctx) {
  for (const name of ['start', 'direct', 'cancel'])
    ctx.commands.registerEffect({ id: `research.multiagent.${name}`, service: `research.multiagent.${name}` })
  ctx.slots.register('sidebar.footer.action', Entry, { priority: -2 })
  ctx.slots.register('workbench.panel', (props) => createElement(WorkbenchSlot, { ...props, ctx }), {
    priority: -2,
  })
}

export { digest, graphPlan, stable, validateGraph } from './plan.js'
