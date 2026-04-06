export function humanizeToken(token) {
  if (!token) return ''
  return token.replace(/^row_/, '').replace(/^total_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function humanizeColumn(col) {
  if (!col || col === 'UNRESOLVED' || col === 'LATER_SELECTED') return col
  if (col.startsWith('PARAM:')) return col.replace('PARAM:', 'Parameter: ')
  const parts = col.split('.')
  const table = parts.length > 1 ? parts[0].replace(/^neuract__/, '') : ''
  const column = parts[parts.length - 1].replace(/_/g, ' ')
  return table ? `${column} (${table})` : column
}

export const PROGRESS_STEPS = [
  'Preparing mapping...', 'Building contract...', 'Running validation gates...', 'Generating assets...', 'Finalizing...',
]
