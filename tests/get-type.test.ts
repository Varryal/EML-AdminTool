import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { getFileTypeFromPath } from '../src/lib/utils/utils.ts'

test('getFileTypeFromPath classifies exact path segments', () => {
  const cases = [
    ['mods/a.jar', 'MOD'],
    ['mods/sub/a.jar', 'MOD'],
    ['C:\\files\\mods\\a.jar', 'MOD'],
    ['modsomething/a.jar', 'OTHER'],
    ['configs-old/a.txt', 'OTHER'],
    ['assetsx/a.png', 'OTHER'],
    ['libx/a.jar', 'OTHER']
  ] as const

  for (const [filePath, expected] of cases) {
    assert.equal(getFileTypeFromPath(filePath), expected, filePath)
  }
})
