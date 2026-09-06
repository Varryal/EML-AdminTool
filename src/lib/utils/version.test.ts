import { describe, expect, it } from 'vitest'
import { formatVersionLabel, resolveVersionMetadata } from './version'

describe('version metadata', () => {
  it('uses PROD defaults from the Varryal version', () => {
    expect(resolveVersionMetadata('2.7.0-varryal.1')).toEqual({
      channel: 'prod',
      varryalVersion: '2.7.0-varryal.1',
      buildId: 'release-2.7.0-varryal.1'
    })
  })

  it('accepts PREPROD runtime metadata', () => {
    expect(
      resolveVersionMetadata('2.7.0-varryal.1', {
        VARRYAL_CHANNEL: 'preprod',
        VARRYAL_VERSION: '2.7.0-varryal.1',
        VARRYAL_BUILD_ID: 'main-a1b2c3d'
      })
    ).toEqual({
      channel: 'preprod',
      varryalVersion: '2.7.0-varryal.1',
      buildId: 'main-a1b2c3d'
    })
  })

  it('omits the build ID from the PROD label', () => {
    expect(
      formatVersionLabel({
        channel: 'prod',
        varryalVersion: '2.7.0-varryal.1',
        buildId: 'release-2.7.0-varryal.1'
      })
    ).toBe('EML AdminTool 2.7.0-varryal.1 · PROD')
  })

  it('keeps the build ID in the PREPROD label', () => {
    expect(
      formatVersionLabel({
        channel: 'preprod',
        varryalVersion: '2.7.0-varryal.1',
        buildId: 'main-a1b2c3d'
      })
    ).toBe('EML AdminTool 2.7.0-varryal.1 · PREPROD · main-a1b2c3d')
  })

  it('rejects unsupported channels', () => {
    expect(() =>
      resolveVersionMetadata('2.7.0-varryal.1', {
        VARRYAL_CHANNEL: 'dev'
      })
    ).toThrow('VARRYAL_CHANNEL must be either prod or preprod')
  })

  it('rejects unsafe metadata values', () => {
    expect(() =>
      resolveVersionMetadata('2.7.0-varryal.1', {
        VARRYAL_BUILD_ID: 'main/a1b2c3d'
      })
    ).toThrow('VARRYAL_BUILD_ID must contain only letters, digits, dots, underscores, and hyphens')
  })
})
