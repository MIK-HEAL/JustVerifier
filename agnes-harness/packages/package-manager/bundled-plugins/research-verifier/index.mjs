import { registerResearchRuns } from './src/runs.mjs'
import * as verifier from './src/verifier.mjs'

export const researchVerifier = {
  inject: ['extension'],
  apply(ctx) {
    registerResearchRuns(ctx, verifier)
  },
}
