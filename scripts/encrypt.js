import { createCipheriv, randomBytes, pbkdf2Sync, createHash } from 'crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, extname, basename } from 'path';
import { fileURLToPath } from 'url';

export const SALT_LEN = 16;
export const IV_LEN = 12;
export const KEY_LEN = 32;
export const ITERATIONS = 100_000;
const DATA_DIR = 'public/data';
const AVATARS_DIR = 'public/avatars';
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const APP_CONFIG_NAME = 'app.json';

export function encrypt(input, password) {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, 'sha256');

  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, encrypted, tag]).toString('base64');
}

function askPassword(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const rl = createInterface({ input: process.stdin, terminal: false });
    process.stdin.setRawMode(true);
    let password = '';
    process.stdin.resume();
    process.stdin.on('data', (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (c === '\u007F' || c === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\u0003') {
        process.exit(0);
      } else {
        password += c;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  const password = process.env.ENCRYPT_PASSWORD || await askPassword('Enter encryption password (view): ');
  if (!password) { console.error('No password provided.'); process.exit(1); }

  const manifest = {};

  function encryptFile(inputPath, outputPath, pw) {
    const content = readFileSync(inputPath);
    const encrypted = encrypt(content, pw);
    writeFileSync(outputPath, encrypted);
    manifest[outputPath] = createHash('sha256').update(encrypted).digest('hex');
    console.log(`Encrypted ${inputPath} -> ${outputPath} (${encrypted.length} bytes)`);
  }

  const dataFiles = readdirSync(DATA_DIR).filter(f => extname(f) === '.json' && f !== APP_CONFIG_NAME);
  if (dataFiles.length === 0) { console.error('No .json files found in ' + DATA_DIR); process.exit(1); }

  for (const file of dataFiles) {
    const input = join(DATA_DIR, file);
    JSON.parse(readFileSync(input, 'utf8'));
    encryptFile(input, join(DATA_DIR, basename(file, '.json') + '.enc'), password);
  }

  if (existsSync(AVATARS_DIR)) {
    const avatarFiles = readdirSync(AVATARS_DIR).filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));
    for (const file of avatarFiles) {
      encryptFile(join(AVATARS_DIR, file), join(AVATARS_DIR, file + '.enc'), password);
    }
  }

  const appConfigPath = join(DATA_DIR, APP_CONFIG_NAME);
  if (existsSync(appConfigPath)) {
    JSON.parse(readFileSync(appConfigPath, 'utf8'));
    const proposePw = process.env.PROPOSE_PASSWORD || await askPassword('Enter propose password: ');
    if (!proposePw) { console.error('No propose password provided.'); process.exit(1); }
    encryptFile(appConfigPath, join(DATA_DIR, 'app.enc'), proposePw);
  }

  writeFileSync(join(DATA_DIR, '.manifest'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${join(DATA_DIR, '.manifest')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
