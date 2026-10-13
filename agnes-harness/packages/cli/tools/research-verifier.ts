import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/** Relocated plugins use a bundle of the canonical verifier, never workspace internals. */
export async function prepareResearchVerifier(destination: string): Promise<void> {
  await mkdir(join(destination, 'src'), { recursive: true })
  await build({
    entryPoints: [fileURLToPath(new URL('../../research-verifier/src/index.ts', import.meta.url))],
    outfile: join(destination, 'src', 'verifier.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    minify: true,
    legalComments: 'eof',
    banner: {
      js: '// biome-ignore-all lint: Generated canonical verifier bundle.\n// biome-ignore-all format: Generated canonical verifier bundle.\n// biome-ignore-all assist/source/organizeImports: Generated canonical verifier bundle.',
    },
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prepareResearchVerifier(
    fileURLToPath(new URL('../../package-manager/bundled-plugins/research-verifier/', import.meta.url)),
  )
