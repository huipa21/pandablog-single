const ANALYTICS_TABLES = [
  'analytics_daily',
  'analytics_daily_page',
  'analytics_session',
  'pageview'
]

export function isMissingAnalyticsTableError(error: unknown, tables = ANALYTICS_TABLES) {
  const message = errorMessage(error).toLowerCase()
  if (!message.includes('does not exist')) {
    return false
  }

  return tables.some((table) => {
    const normalizedTable = table.toLowerCase()
    return message.includes(`'${normalizedTable}'`) || message.includes(`"${normalizedTable}"`) || message.includes(` ${normalizedTable} `)
  })
}

function errorMessage(error: unknown): string {
  const value = error as { message?: unknown, statusMessage?: unknown, cause?: { message?: unknown } }
  return [value?.message, value?.statusMessage, value?.cause?.message]
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .join(' ')
}