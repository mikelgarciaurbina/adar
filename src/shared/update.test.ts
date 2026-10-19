import { describe, expect, it } from 'vitest'
import { bundleMismatch, compareVersions, isAllowedDownloadUrl, parseAssetDigest, pickAssets, releasePageUrl } from './update'

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

describe('update verification helpers', () => {
  const hex = 'ab'.repeat(32)

  it('reads the SHA-256 from the release API asset digest', () => {
    expect(parseAssetDigest(`sha256:${hex.toUpperCase()}`)).toBe(hex)
    expect(parseAssetDigest(null)).toBeNull()
    expect(parseAssetDigest('sha512:' + 'a'.repeat(128))).toBeNull()
    expect(parseAssetDigest('sha256:abc')).toBeNull()
    const picked = pickAssets(
      [
        { name: 'Adar-1.0.0-arm64.zip', browser_download_url: 'https://x/a.zip', size: 5, digest: `sha256:${hex}`, state: 'uploaded' },
        { name: 'Adar-1.0.0-arm64.dmg', browser_download_url: 'https://x/a.dmg', size: 7, digest: null }
      ],
      'arm64'
    )
    expect(picked.zip).toEqual({ name: 'Adar-1.0.0-arm64.zip', url: 'https://x/a.zip', size: 5, sha256: hex })
    expect(picked.dmg).toEqual({ name: 'Adar-1.0.0-arm64.dmg', url: 'https://x/a.dmg', size: 7 })
    // An upload still in progress is never offered.
    expect(pickAssets([{ name: 'Adar-1.0.0-arm64.zip', browser_download_url: 'https://x/a.zip', size: 5, state: 'open' }], 'arm64').zip).toBeNull()
  })

  it('downloads only from GitHub release hosts over https (loopback http only for test feeds)', () => {
    expect(isAllowedDownloadUrl('https://github.com/mikelgarciaurbina/adar/releases/download/v1.0.0/Adar-1.0.0-arm64.zip')).toBe(true)
    expect(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r')).toBe(true)
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/x')).toBe(true)
    expect(isAllowedDownloadUrl('https://github.com/someone/else/releases/download/v1/Adar.zip')).toBe(false)
    expect(isAllowedDownloadUrl('http://github.com/mikelgarciaurbina/adar/releases/download/v1/a.zip')).toBe(false)
    expect(isAllowedDownloadUrl('https://github.com.evil.example/mikelgarciaurbina/adar/releases/download/v1/a.zip')).toBe(false)
    expect(isAllowedDownloadUrl('https://raw.githubusercontent.com/x/y/main/Adar.zip')).toBe(false)
    expect(isAllowedDownloadUrl('https://user:pw@objects.githubusercontent.com/x')).toBe(false)
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com:8443/x')).toBe(false)
    expect(isAllowedDownloadUrl('file:///tmp/Adar.zip')).toBe(false)
    expect(isAllowedDownloadUrl('not a url')).toBe(false)
    expect(isAllowedDownloadUrl('http://127.0.0.1:58999/Adar.zip')).toBe(false)
    expect(isAllowedDownloadUrl('http://127.0.0.1:58999/Adar.zip', { allowLoopbackHttp: true })).toBe(true)
    expect(isAllowedDownloadUrl('http://localhost:58999/Adar.zip', { allowLoopbackHttp: true })).toBe(false)
  })

  it('opens only GitHub release pages', () => {
    expect(releasePageUrl('https://github.com/mikelgarciaurbina/adar/releases/tag/v1.0.0')).toBe('https://github.com/mikelgarciaurbina/adar/releases/tag/v1.0.0')
    expect(releasePageUrl('file:///Applications/Calculator.app')).toBe('https://github.com/mikelgarciaurbina/adar/releases')
    expect(releasePageUrl('https://example.invalid')).toBe('https://github.com/mikelgarciaurbina/adar/releases')
    expect(releasePageUrl(undefined)).toBe('https://github.com/mikelgarciaurbina/adar/releases')
  })

  it('accepts only the same app at the advertised, newer version', () => {
    const expected = { id: 'dev.adar.gitclient', version: '0.3.0', currentVersion: '0.2.0' }
    expect(bundleMismatch({ id: 'dev.adar.gitclient', version: '0.3.0' }, expected)).toBeNull()
    expect(bundleMismatch({ id: 'com.evil.app', version: '0.3.0' }, expected)).toMatch(/different app/)
    expect(bundleMismatch({ id: null, version: '0.3.0' }, expected)).toMatch(/different app/)
    expect(bundleMismatch({ id: 'dev.adar.gitclient', version: '0.2.5' }, expected)).toMatch(/expected 0\.3\.0/)
    // A feed advertising an older version as "latest" cannot downgrade the app.
    expect(bundleMismatch({ id: 'dev.adar.gitclient', version: '0.1.0' }, { ...expected, version: '0.1.0' })).toMatch(/not newer/)
    expect(bundleMismatch({ id: 'dev.adar.gitclient', version: '0.2.0' }, { ...expected, version: '0.2.0' })).toMatch(/not newer/)
  })
})
