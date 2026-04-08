export const SALT_LEN = 16;
export const IV_LEN = 12;
export const KEY_LEN = 32;
export const ITERATIONS = 100_000;

async function deriveKey(password, salt, usages) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LEN * 8 },
    false,
    usages
  );
}

async function decryptRaw(encryptedBase64, password) {
  const raw = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

  const salt = raw.slice(0, SALT_LEN);
  const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ciphertextWithTag = raw.slice(SALT_LEN + IV_LEN);

  const key = await deriveKey(password, salt, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextWithTag);
}

export async function decryptFamilyData(encryptedBase64, password) {
  const decrypted = await decryptRaw(encryptedBase64, password);
  return new TextDecoder().decode(decrypted);
}

export async function decryptToBlob(encryptedBase64, password, mimeType) {
  const decrypted = await decryptRaw(encryptedBase64, password);
  return URL.createObjectURL(new Blob([decrypted], { type: mimeType }));
}

export async function encryptData(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt, ['encrypt']);

  const encoded = typeof plaintext === 'string'
    ? new TextEncoder().encode(plaintext)
    : plaintext;

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  const result = new Uint8Array(SALT_LEN + IV_LEN + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, SALT_LEN);
  result.set(new Uint8Array(encrypted), SALT_LEN + IV_LEN);

  return btoa(String.fromCharCode(...result));
}

export async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
