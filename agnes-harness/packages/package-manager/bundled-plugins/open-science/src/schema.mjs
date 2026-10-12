const Kind = Symbol.for('TypeBox.Kind')
const Optional = Symbol.for('TypeBox.Optional')
export const string = (maxLength = 4096, minLength = 1) => ({
  [Kind]: 'String',
  type: 'string',
  minLength,
  maxLength,
})
export const integer = (minimum, maximum) => ({ [Kind]: 'Integer', type: 'integer', minimum, maximum })
export const optional = (schema) => ({ ...schema, [Optional]: 'Optional' })
export const enumeration = (...values) => ({
  [Kind]: 'Union',
  anyOf: values.map((value) => ({ [Kind]: 'Literal', type: 'string', const: value })),
})
export const object = (properties) => ({
  [Kind]: 'Object',
  type: 'object',
  properties,
  required: Object.keys(properties).filter((key) => !properties[key][Optional]),
  additionalProperties: false,
})
export const array = (items, maxItems = 100) => ({
  [Kind]: 'Array',
  type: 'array',
  items,
  minItems: 1,
  maxItems,
})
export const result = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structured: value,
})
export const fail = (code, message) => Object.assign(new Error(message), { code, publicMessage: message })
export const sessionKey = (ctx) =>
  JSON.stringify([ctx.session.workspaceRoot, ctx.session.key, ctx.session.lane])

export function tool(name, description, parameters, readOnly, execute) {
  return {
    name: `science_${name}`,
    description,
    parameters,
    meta: {
      isReadOnly: readOnly,
      isDestructive: false,
      isConcurrencySafe: false,
      isOpenWorld: true,
      replay: readOnly ? 'safe' : 'never',
      costHint: {},
      deferLoading: false,
      requiresApproval: readOnly ? 'never' : 'always',
    },
    async execute(args, ctx) {
      try {
        ctx.signal.throwIfAborted()
        return await execute(args, ctx)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        return {
          isError: true,
          ...result({
            code: error.publicMessage ? error.code : 'SCIENCE_OPERATION_FAILED',
            message:
              error.publicMessage ??
              'The operation failed. Check the Agnes runtime diagnostics before retrying.',
          }),
        }
      }
    },
  }
}
