// ============================================================
// 密码哈希、随机令牌、AES 加密与 TOTP
// 全部使用 Node 内置 node:crypto，不引入原生编译依赖。
// ============================================================

import crypto from 'node:crypto';
import { config } from '../config/env.js';

// ---------- 通用哈希 ----------
export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// 恒定时间比较，避免根据比较耗时猜内容
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ---------- 密码：scrypt（单向哈希，不可逆） ----------
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function scryptAsync(password, salt, keylen = KEY_LEN) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt);
  // 格式里带参数，未来调整 N/r/p 也能验证旧密码
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algorithm, n, r, p, saltHex, hashHex] = String(stored).split('$');
    if (algorithm !== 'scrypt') return false;
    if (Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (!salt.length || expected.length === 0) return false;
    const actual = await scryptAsync(password, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------- AES-256-GCM：TOTP 密钥需要可逆加密 ----------
export function encryptSecret(plainText, key = config.totpEncryptionKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(payload, key = config.totpEncryptionKey) {
  const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('TOTP 密钥格式错误');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// ---------- Base32：TOTP 密钥的标准编码 ----------
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const index = BASE32_ALPHABET.indexOf(ch);
    if (index === -1) throw new Error('Base32 字符非法');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ---------- TOTP（RFC 6238）：腾讯身份验证器兼容 ----------
export function generateTotpSecret() {
  // 20 字节 = 160 bit，标准推荐长度
  return base32Encode(crypto.randomBytes(20));
}

export function totpStep(timestampMs = Date.now(), period = 30) {
  return Math.floor(timestampMs / 1000 / period);
}

export function generateTotp(secretBase32, { timestamp = Date.now(), digits = 6, period = 30 } = {}) {
  const counter = totpStep(timestamp, period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * 验证动态码。
 * 允许前后各 1 个时间步（应对时钟偏差）。
 * 返回值里的 step 用于防重放：同一个 step 不能成功两次。
 */
export function verifyTotp(secretBase32, code, { timestamp = Date.now(), window = 1, period = 30 } = {}) {
  const normalized = String(code ?? '').trim();
  if (!/^\d{6}$/.test(normalized)) return { valid: false, step: null };
  const currentStep = totpStep(timestamp, period);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    const expected = generateTotp(secretBase32, { timestamp: step * period * 1000, period });
    if (safeEqual(expected, normalized)) {
      return { valid: true, step };
    }
  }
  return { valid: false, step: null };
}

export function buildOtpAuthUrl(secretBase32, accountName, issuer = '校内网2.0') {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------- 恢复码：只存哈希，一次性使用 ----------
export function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = base32Encode(crypto.randomBytes(10)); // 16 个 Base32 字符
    const grouped = raw.match(/.{1,4}/g).join('-');
    codes.push(grouped);
  }
  return codes;
}

export function normalizeRecoveryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function hashRecoveryCode(code) {
  return sha256Hex(normalizeRecoveryCode(code));
}

// ---------- 生成临时密码（管理员重置用户密码时用） ----------
export function generateTempPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += chars[crypto.randomInt(0, chars.length)];
  }
  return `${output}#9`;
}
