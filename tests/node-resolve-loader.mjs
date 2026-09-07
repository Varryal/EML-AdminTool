import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveLocalFile(candidate) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  for (const extension of ['.ts', '.js', '.mjs']) {
    const withExtension = `${candidate}${extension}`
    if (fs.existsSync(withExtension) && fs.statSync(withExtension).isFile()) return withExtension
  }
  return undefined
}

export async function resolve(specifier, context, defaultResolve) {
  let candidate
  if (specifier.startsWith('$lib/')) {
    candidate = path.join(projectRoot, 'src', 'lib', specifier.slice('$lib/'.length))
  } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
  }

  if (candidate) {
    const resolved = resolveLocalFile(candidate)
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true }
  }

  return defaultResolve(specifier, context, defaultResolve)
}
