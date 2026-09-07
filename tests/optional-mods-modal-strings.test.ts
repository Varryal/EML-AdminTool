import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import en from '../src/lib/locales/en.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import fr from '../src/lib/locales/fr.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import da from '../src/lib/locales/da.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import de from '../src/lib/locales/de.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import it from '../src/lib/locales/it.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import ja from '../src/lib/locales/ja.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { fileCountTranslationKey } from '../src/lib/utils/optional-mods-ui.ts'
// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { interpolate } from '../src/lib/stores/language.ts'

const locales = { en, fr, da, de, it, ja }
const templatedKeys = ['count', 'invalidGroupId', 'duplicateGroupId', 'invalidTitle', 'descriptionTooLong', 'fileCountFew', 'fileCountMany', 'assignedTo'] as const

test('every supported locale has the complete optional-mod panel vocabulary', () => {
  for (const [language, locale] of Object.entries(locales)) {
    const optionalMods = (locale.dashboard as any).optionalMods
    assert.ok(optionalMods, `${language} is missing dashboard.optionalMods`)
    for (const key of ['title', 'count', 'fileCountOne', 'fileCountFew', 'fileCountMany', 'enabledByDefault', 'identityWarning', 'conflict', 'refreshConflict']) {
      assert.equal(typeof optionalMods[key], 'string', `${language}.${key}`)
    }
  }
})

test('panel templates render concrete values for aggregate, file counts, and validation errors', () => {
  for (const locale of Object.values(locales)) {
    const optionalMods = (locale.dashboard as any).optionalMods
    for (const key of templatedKeys) {
      const rendered = interpolate(optionalMods[key], { selected: 2, files: 3, count: 3, id: 'sodium', title: 'Sodium' })
      assert.doesNotMatch(rendered, /\{\{\w+\}\}/, key)
    }
    assert.match(interpolate(optionalMods.invalidGroupId, { id: 'bad id' }), /bad id/)
    assert.match(interpolate(optionalMods.assignedTo, { id: 'sodium', title: 'Sodium' }), /Sodium/)
  }
})

test('Russian plural selection has one, few, and many forms', () => {
  assert.equal(fileCountTranslationKey('ru', 1), 'fileCountOne')
  assert.equal(fileCountTranslationKey('ru', 21), 'fileCountOne')
  assert.equal(fileCountTranslationKey('ru', 2), 'fileCountFew')
  assert.equal(fileCountTranslationKey('ru', 4), 'fileCountFew')
  assert.equal(fileCountTranslationKey('ru', 22), 'fileCountFew')
  assert.equal(fileCountTranslationKey('ru', 5), 'fileCountMany')
  assert.equal(fileCountTranslationKey('ru', 11), 'fileCountMany')
  assert.equal(fileCountTranslationKey('ru', 14), 'fileCountMany')
})
