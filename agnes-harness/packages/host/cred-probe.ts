import { createCredentialStore, CredentialStoreError } from './src/adapters/credential-store.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

async function main() {
  const home = process.env.AGH_HOME ? join(process.env.AGH_HOME) : join(homedir(), '.agh')
  console.log('home:', home)

  const store = createCredentialStore({ root: home })
  console.log('enforcement:', store.enforcement)

  for (const ref of ['secret://openai/default', 'secret://deepseek/default']) {
    try {
      const v = await store.read(ref)
      console.log(ref, '=>', v ? `${v.kind}/${v.provider}` : null)
    } catch (e) {
      console.log(ref, '=> ERR', e instanceof CredentialStoreError ? `reason=${e.reason}` : (e as Error).message)
    }
  }
}

main()
