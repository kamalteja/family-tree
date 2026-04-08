import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cacheGet, cacheSet, cacheRemove, CACHE_POLICY } from './storage.js';

describe('CACHE_POLICY', () => {
  it('has the expected keys and states', () => {
    expect(CACHE_POLICY).toEqual({
      'family-tree-password':      { enabled: true },
      'family-tree-propose-pw':    { enabled: true, store: 'session' },
      'family-tree-data':          { enabled: true },
      'family-tree-proposed':      { enabled: true },
      'family-tree-proposer-name': { enabled: true },
      'family-tree-theme':         { enabled: true },
      'family-tree-principal':     { enabled: true },
    });
  });

  it('propose password is the only session-stored key', () => {
    const session = Object.entries(CACHE_POLICY)
      .filter(([, v]) => v.store === 'session')
      .map(([k]) => k);
    expect(session).toEqual(['family-tree-propose-pw']);
  });
});

describe('cache wrapper — local store', () => {
  const local = {};
  const session = {};

  beforeEach(() => {
    Object.keys(local).forEach(k => delete local[k]);
    Object.keys(session).forEach(k => delete session[k]);

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(k => local[k] ?? null),
      setItem: vi.fn((k, v) => { local[k] = String(v); }),
      removeItem: vi.fn(k => { delete local[k]; }),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(k => session[k] ?? null),
      setItem: vi.fn((k, v) => { session[k] = String(v); }),
      removeItem: vi.fn(k => { delete session[k]; }),
    });
  });

  it('cacheSet stores enabled local keys in localStorage', () => {
    cacheSet('family-tree-password', 'secret');
    expect(local['family-tree-password']).toBe('secret');
    expect(session['family-tree-password']).toBeUndefined();
  });

  it('cacheSet stores session keys in sessionStorage', () => {
    cacheSet('family-tree-propose-pw', 'secret');
    expect(session['family-tree-propose-pw']).toBe('secret');
    expect(local['family-tree-propose-pw']).toBeUndefined();
  });

  it('cacheGet reads session keys from sessionStorage', () => {
    session['family-tree-propose-pw'] = 'secret';
    expect(cacheGet('family-tree-propose-pw')).toBe('secret');
  });

  it('cacheGet reads from the correct store', () => {
    local['family-tree-theme'] = 'dark';
    expect(cacheGet('family-tree-theme')).toBe('dark');
  });

  it('cacheRemove clears from both stores', () => {
    local['family-tree-data'] = '[]';
    session['family-tree-data'] = '[]';
    cacheRemove('family-tree-data');
    expect(local['family-tree-data']).toBeUndefined();
    expect(session['family-tree-data']).toBeUndefined();
  });
});
