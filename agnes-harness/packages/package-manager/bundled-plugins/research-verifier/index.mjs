const Kind = Symbol.for('TypeBox.Kind')
const parameters = {
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: false,
  properties: {},
  required: [],
}

/**
 * Discovery surface for the deterministic verifier package. Verification itself remains in the
 * workspace package and CLI; this row only advertises the governed capability and never invents a
 * pass result when the verifier service is unavailable.
 */
export const researchVerifier = {
  inject: ['extension'],
  apply(ctx) {
    ctx.extension().registerTool({
      name: 'research_verifier_status',
      description: 'Report the installed deterministic research verifier capability and schemas.',
      parameters,
      meta: {
        isReadOnly: true,
        isDestructive: false,
        isConcurrencySafe: true,
        isOpenWorld: false,
        replay: 'safe',
        costHint: {},
        deferLoading: false,
        requiresApproval: 'never',
      },
      async execute() {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                package: '@agnes/research-verifier',
                version: '0.1.0',
                ruleset: 'research-verifier-p0@1',
                status: 'available',
                verification: 'deterministic-local',
                schemas: ['certificate', 'manifest', 'report', 'multi-agent-plan'],
              }),
            },
          ],
        }
      },
    })
  },
}
