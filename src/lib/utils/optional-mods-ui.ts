export function optionalModTitleFromFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '')
  const withoutLoader = stem.replace(/[-_.](?:neoforge|forge|fabric|quilt|vanilla)(?:[-_.].*)?$/i, '')
  const withoutVersion = withoutLoader.replace(/[-_.]\d[\w.-]*$/, '')
  return (withoutVersion || stem).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function optionalModIdFromFilename(name: string): string {
  return optionalModTitleFromFilename(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'mod'
}
