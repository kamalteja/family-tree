import { describe, it, expect } from 'vitest';
import {
  SALT_LEN as BROWSER_SALT_LEN,
  IV_LEN as BROWSER_IV_LEN,
  KEY_LEN as BROWSER_KEY_LEN,
  ITERATIONS as BROWSER_ITERATIONS,
  encryptData,
  decryptFamilyData,
  sha256Hex,
} from './crypto.js';
import {
  SALT_LEN as NODE_SALT_LEN,
  IV_LEN as NODE_IV_LEN,
  KEY_LEN as NODE_KEY_LEN,
  ITERATIONS as NODE_ITERATIONS,
  encrypt as nodeEncrypt,
} from '../scripts/encrypt.js';

const TEST_PASSWORD = 'test-password-xyz';
const TEST_PLAINTEXT = '{"name":"test","value":42}';

describe('encryption compatibility — browser ↔ Node', () => {
  it('constants match between browser and Node implementations', () => {
    expect(BROWSER_SALT_LEN).toBe(NODE_SALT_LEN);
    expect(BROWSER_IV_LEN).toBe(NODE_IV_LEN);
    expect(BROWSER_KEY_LEN).toBe(NODE_KEY_LEN);
    expect(BROWSER_ITERATIONS).toBe(NODE_ITERATIONS);
  });

  it('Node encrypt → browser decrypt round-trip', async () => {
    const encrypted = nodeEncrypt(TEST_PLAINTEXT, TEST_PASSWORD);
    const decrypted = await decryptFamilyData(encrypted, TEST_PASSWORD);
    expect(decrypted).toBe(TEST_PLAINTEXT);
  });

  it('browser encrypt → browser decrypt round-trip', async () => {
    const encrypted = await encryptData(TEST_PLAINTEXT, TEST_PASSWORD);
    const decrypted = await decryptFamilyData(encrypted, TEST_PASSWORD);
    expect(decrypted).toBe(TEST_PLAINTEXT);
  });

  it('Node-encrypted output has correct wire format', () => {
    const encrypted = nodeEncrypt(TEST_PLAINTEXT, TEST_PASSWORD);
    const raw = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));

    expect(raw.length).toBeGreaterThan(NODE_SALT_LEN + NODE_IV_LEN + 16);

    const payloadLen = raw.length - NODE_SALT_LEN - NODE_IV_LEN;
    // AES-GCM tag is 16 bytes, ciphertext is at least 1 byte
    expect(payloadLen).toBeGreaterThanOrEqual(17);
  });

  it('browser-encrypted output has correct wire format', async () => {
    const encrypted = await encryptData(TEST_PLAINTEXT, TEST_PASSWORD);
    const raw = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));

    expect(raw.length).toBeGreaterThan(BROWSER_SALT_LEN + BROWSER_IV_LEN + 16);

    const payloadLen = raw.length - BROWSER_SALT_LEN - BROWSER_IV_LEN;
    expect(payloadLen).toBeGreaterThanOrEqual(17);
  });

  it('sha256Hex produces correct hex digest', async () => {
    const input = 'hello world';
    const hash = await sha256Hex(input);
    // known SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('wrong password fails to decrypt', async () => {
    const encrypted = nodeEncrypt(TEST_PLAINTEXT, TEST_PASSWORD);
    await expect(decryptFamilyData(encrypted, 'wrong-password')).rejects.toThrow();
  });
});
