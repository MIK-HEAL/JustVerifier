import { createElement } from 'react'
import { Entry } from './entry.js'
import { Workbench } from './workbench.js'

export function apply(ctx) {
  ctx.slots.register('sidebar.footer.action', Entry, { priority: -2 })
  ctx.slots.register('workbench.panel', (props) => createElement(Workbench, { ...props, ctx }), {
    priority: -2,
  })
}

export { digest, graphPlan, stable, validateGraph } from './plan.js'
