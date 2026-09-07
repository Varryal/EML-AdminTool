import assert from 'node:assert/strict'
import test from 'node:test'
import { get } from 'svelte/store'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { interpolate, l } from '../src/lib/stores/language.ts'

test('interpolation substitutes known values without a second formatting pass', () => {
  assert.equal(interpolate('{{selected}} optional groups · {{files}} MOD files', { selected: 3, files: 7 }), '3 optional groups · 7 MOD files')

  const translated = get(l).dashboard.optionalMods({ selected: 3, files: 7 }).count
  assert.equal(translated, '3 optional groups · 7 MOD files')
  assert.doesNotMatch(translated, /\{selected\}|\{files\}/)
})

test('unknown interpolation variables remain double-braced tokens', () => {
  assert.equal(interpolate('Known {{known}}, unknown {{missing}}', { known: 'value' }), 'Known value, unknown {{missing}}')
  assert.equal(get(l).dashboard.optionalMods({ selected: 3 }).count, '3 optional groups · {{files}} MOD files')
})
