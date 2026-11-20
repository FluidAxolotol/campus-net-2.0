// 单元测试：只测纯函数，不碰数据库、HTTP、DOM。
// 运行：npm run test:unit

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode, base32Decode, generateTotp, verifyTotp,
  hashPassword, verifyPassword, encryptSecret, decryptSecret,
  generateRecoveryCodes, normalizeRecoveryCode, hashRecoveryCode,
} from '../../src/utils/crypto.js';

test('base32 编解码可往返', () => {
  const buffer = Buffer.from('12345678901234567890', 'ascii');
  const encoded = base32Encode(buffer);
  assert.equal(encoded, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(encoded), buffer);
});

test('TOTP 符合 RFC 6238 测试向量', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII 12345678901234567890
  assert.equal(generateTotp(secret, { timestamp: 59_000, digits: 8 }), '94287082');
  assert.equal(generateTotp(secret, { timestamp: 1_111_111_109_000, digits: 8 }), '07081804');
  assert.equal(generateTotp(secret, { timestamp: 2_000_000_000_000, digits: 8 }), '69279037');
});

test('TOTP 验证允许时间窗口并拒绝错误码', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const timestamp = 1_700_000_000_000;
  const code = generateTotp(secret, { timestamp });
  assert.equal(verifyTotp(secret, code, { timestamp }).valid, true);
  assert.equal(verifyTotp(secret, code, { timestamp: timestamp + 30_000 }).valid, true);
  assert.equal(verifyTotp(secret, '000000', { timestamp }).valid, false);
  assert.equal(verifyTotp(secret, 'abc', { timestamp }).valid, false);
});

test('密码哈希：每次盐不同，校验正确', async () => {
  const hash1 = await hashPassword('Campus123');
  const hash2 = await hashPassword('Campus123');
  assert.notEqual(hash1, hash2); // 随机盐导致结果不同
  assert.equal(await verifyPassword('Campus123', hash1), true);
  assert.equal(await verifyPassword('Campus1234', hash1), false);
  assert.equal(await verifyPassword('Campus123', 'garbage'), false);
});

test('AES-256-GCM：可解密，篡改会失败', () => {
  const payload = encryptSecret('JBSWY3DPEHPK3PXP');
  assert.equal(decryptSecret(payload), 'JBSWY3DPEHPK3PXP');

  const parts = payload.split(':');
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered').toString('base64')].join(':');
  assert.throws(() => decryptSecret(tampered));
});

test('恢复码：格式统一、哈希稳定', () => {
  const codes = generateRecoveryCodes(8);
  assert.equal(codes.length, 8);
  assert.match(codes[0], /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  assert.equal(normalizeRecoveryCode(codes[0]), codes[0].replaceAll('-', ''));
  assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].toLowerCase()));
  assert.notEqual(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[1]));
});
