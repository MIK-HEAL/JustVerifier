import { createElement } from 'react'
import { Entry } from './entry.js'
import { Workbench } from './workbench.js'

export function apply(ctx) {
  ctx.slots.register('sidebar.footer.action', Entry, { priority: -2 })
  ctx.slots.register('workbench.panel', (props) => createElement(Workbench, { ...props, ctx }), {
    priority: -2,
  })
  // Keep the complete verifier workbench available in the host rightbar. The rightbar
  // contribution is embedded in the session surface, while workbench.panel remains the
  // full-page entry opened from the sidebar footer.
  ctx.slots.register(
    'rightbar.session',
    (props) => createElement(Workbench, { ...props, ctx, embedded: true }),
    { priority: -2 },
  )
}

export { digest, graphPlan, stable, validateGraph } from './plan.js'
