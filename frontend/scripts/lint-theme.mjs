#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import process from 'node:process'
import { globby } from 'globby'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const patterns = ['src/**/*.{js,jsx}']

const colorPattern = /\b(color|backgroundColor|borderColor)\s*[:=]\s*['"]\s*(#|rgb|hsl)/i
const fontPattern = /\bfontSize\s*[:=]\s*['"]\s*\d+(px|em|rem)/i

const files = await globby(patterns, { cwd: root })
const violations = []

for (const relativePath of files) {
  const fullPath = path.join(root, relativePath)
  const content = await fs.readFile(fullPath, 'utf8')
  const lines = content.split(/\r?\n/)

  lines.forEach((line, index) => {
    if (line.includes('palette.') || line.includes('typography')) return
    if (colorPattern.test(line) || fontPattern.test(line)) {
      violations.push({
        file: relativePath,
        line: index + 1,
        snippet: line.trim(),
      })
    }
  })
}

if (violations.length) {
  console.error('Theme lint detected hardcoded tokens:')
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.snippet}`)
  }
  process.exitCode = 1
} else {
  console.log('No hardcoded theme tokens found.')
}
