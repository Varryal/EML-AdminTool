import { computeOptionalModsRevision, type ManifestFile } from './optional-mods'

type PublishedOptionalRevisionFile = Pick<ManifestFile, 'name' | 'path' | 'type' | 'size' | 'sha1' | 'optional' | 'optionalId' | 'title' | 'description' | 'enabledByDefault'>

/**
 * The editor uses the published cache as its optimistic-concurrency snapshot.
 * A live filesystem scan can be ahead of that cache while a cache rebuild is
 * pending, so it must not participate in the editor's revision comparison.
 */
export function computePublishedOptionalModsRevision(files: readonly PublishedOptionalRevisionFile[]): string {
  return computeOptionalModsRevision(files as readonly ManifestFile[])
}

export function matchesPublishedOptionalModsRevision(files: readonly PublishedOptionalRevisionFile[], revision: string): boolean {
  return computePublishedOptionalModsRevision(files) === revision
}
