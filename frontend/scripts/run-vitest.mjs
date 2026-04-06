import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const vitestPath = path.resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const args = process.argv.slice(2)
const storageFile = path.resolve(process.cwd(), '.vitest-localstorage.sqlite')

if (fs.existsSync(storageFile)) {
  fs.unlinkSync(storageFile)
}

const rawNodeOptions = process.env.NODE_OPTIONS || ''
const parts = rawNodeOptions.split(/\s+/).filter(Boolean)

const cleaned = []
for (const part of parts) {
  if (part.startsWith('--localstorage-file')) {
    continue
  }
  cleaned.push(part)
}

cleaned.push(`--localstorage-file=${storageFile}`)

const env = {
  ...process.env,
  NODE_OPTIONS: cleaned.join(' '),
  // Ensure React development build is used (required for React.act)
  NODE_ENV: 'development',
}

const child = spawn(process.execPath, [vitestPath, ...args], {
  stdio: 'inherit',
  env,
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
