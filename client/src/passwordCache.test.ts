/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetHostSecrets,
  forgetPassword,
  isPasswordRemembered,
  loadPassword,
  peekPassword,
  savePassword,
  vaultAccount,
} from './passwordCache'

describe('passwordCache vault', () => {
  beforeEach(() => {
    localStorage.clear()
    // clear in-memory by forgetting known keys
  })

  it('vaultAccount prefixes keys', () => {
    expect(vaultAccount('abc')).toBe('hivenest/ssh/abc')
    expect(vaultAccount('')).toBe('')
  })

  it('peekPassword tolerates empty/undefined keys', () => {
    expect(peekPassword('')).toBe('')
    expect(peekPassword(undefined as unknown as string)).toBe('')
  })

  it('save with remember persists preference and load round-trips (browser vault)', async () => {
    await savePassword('host-1', 's3cret!', true)
    expect(isPasswordRemembered('host-1')).toBe(true)
    expect(peekPassword('host-1')).toBe('s3cret!')
    // wipe memory by forget memory path then reload from durable
    await forgetPassword('host-1')
    expect(isPasswordRemembered('host-1')).toBe(false)
    expect(await loadPassword('host-1')).toBe('')
    // re-save and load from durable vault
    await savePassword('host-1', 's3cret!', true)
    // simulate cold start memory miss: load still works from vault
    const got = await loadPassword('host-1')
    expect(got).toBe('s3cret!')
    // ciphertext must not be plaintext in localStorage
    const raw = localStorage.getItem('hivenest.vault.cipher.v1') || ''
    expect(raw.includes('s3cret!')).toBe(false)
  })

  it('save without remember does not mark remembered', async () => {
    await savePassword('host-2', 'tmp', false)
    expect(isPasswordRemembered('host-2')).toBe(false)
    expect(peekPassword('host-2')).toBe('tmp')
  })

  it('forgetHostSecrets clears host and related jump keys', async () => {
    await savePassword('h9', 'a', true)
    await savePassword('jump:h9', 'b', true)
    await forgetHostSecrets('h9', ['jump:other'])
    expect(isPasswordRemembered('h9')).toBe(false)
    expect(await loadPassword('h9')).toBe('')
  })
})
