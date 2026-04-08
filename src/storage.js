export const CACHE_POLICY = {
  'family-tree-password':      { enabled: true },
  'family-tree-propose-pw':    { enabled: true, store: 'session' },
  'family-tree-data':          { enabled: true },
  'family-tree-proposed':      { enabled: true },
  'family-tree-proposer-name': { enabled: true },
  'family-tree-theme':         { enabled: true },
  'family-tree-principal':     { enabled: true },
};

function getStore(key) {
  const policy = CACHE_POLICY[key];
  if (!policy || !policy.enabled) return null;
  return policy.store === 'session' ? sessionStorage : localStorage;
}

export function cacheGet(key) {
  const store = getStore(key);
  return store ? store.getItem(key) : null;
}

export function cacheSet(key, value) {
  const store = getStore(key);
  if (store) store.setItem(key, value);
}

export function cacheRemove(key) {
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}
