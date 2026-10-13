import { createElement } from 'react'
import { Entry } from './entry.js'
import { Workbench } from './workbench.js'

export function apply(ctx) {
  for (const name of ['start', 'direct', 'cancel'])
    ctx.commands.registerEffect({ id: `research.multiagent.${name}`, service: `research.multiagent.${name}` })
  ctx.slots.register('sidebar.footer.action', Entry, { priority: -2 })
  ctx.slots.register('workbench.panel', (props) => createElement(Workbench, { ...props, ctx }), {
    priority: -2,
  })
}

export { digest, graphPlan, stable, validateGraph } from './plan.js'
