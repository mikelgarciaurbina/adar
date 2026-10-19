import { describe, expect, it } from 'vitest'
import { compareVersions, pickAssets } from './update'

describe('compareVersions', () => {
  it('orders numerically', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0', '1.0.1')).toBe(-1)
  })
  it('treats prereleases as older than the release', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
  })
})

describe('pickAssets', () => {
  const asset = (name: string) => ({ name, browser_download_url: `https://x/${name}`, size: 1 })
  const assets = [
    asset('Adar-0.2.0-arm64.dmg'),
    asset('Adar-0.2.0-arm64.dmg.blockmap'),
    asset('Adar-0.2.0-x64.dmg'),
    asset('Adar-0.2.0-arm64.zip'),
    asset('Adar-0.2.0-x64.zip')
  ]
  it('prefers the matching architecture', () => {
    expect(pickAssets(assets, 'arm64')).toEqual({ zip: assets[3] && { name: 'Adar-0.2.0-arm64.zip', url: 'https://x/Adar-0.2.0-arm64.zip', size: 1 }, dmg: { name: 'Adar-0.2.0-arm64.dmg', url: 'https://x/Adar-0.2.0-arm64.dmg', size: 1 } })
    expect(pickAssets(assets, 'x64').zip?.name).toBe('Adar-0.2.0-x64.zip')
  })
  it('never picks the other architecture', () => {
    expect(pickAssets([asset('Adar-0.2.0-x64.zip')], 'arm64').zip).toBeNull()
    expect(pickAssets([asset('Adar-0.2.0-universal.zip')], 'arm64').zip?.name).toBe('Adar-0.2.0-universal.zip')
  })
})
