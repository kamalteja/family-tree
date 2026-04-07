const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 32;
const ITERATIONS = 100_000;

async function decryptRaw(encryptedBase64, password) {
  const raw = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

  const salt = raw.slice(0, SALT_LEN);
  const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ciphertextWithTag = raw.slice(SALT_LEN + IV_LEN);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LEN * 8 },
    false,
    ['decrypt']
  );

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
