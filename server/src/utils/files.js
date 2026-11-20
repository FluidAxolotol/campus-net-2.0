// ============================================================
// 文件校验、落盘与下发
// 关键原则：
//   1. 只看扩展名不安全，必须读文件头魔数；
//   2. 存储名用 UUID，原始文件名只入库；
//   3. 文件目录在 web/ 之外，下载必须先过鉴权。
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from './errors.js';

const TYPES = [
  {
    mime: 'application/pdf',
    ext: 'pdf',
    match: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    match: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    match: (buffer) => buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  },
];

export function detectFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  return TYPES.find((type) => type.match(buffer)) ?? null;
}

export function sanitizeOriginalName(name) {
  const base = path.basename(String(name || 'file')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 200) || 'file';
}

export async function ensureUploadDir() {
  await fs.mkdir(config.uploadDir, { recursive: true });
}

/**
 * 接收 multer 的 memoryStorage 文件，校验后落盘。
 * 返回的数据可直接写 files 表。
 */
export async function saveUploadedFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new AppError(422, 'FILE_REQUIRED', '请选择要上传的文件');
  }
  if (file.size > config.maxFileSize) {
    throw new AppError(413, 'FILE_TOO_LARGE', '文件超过 20MB 限制');
  }

  const type = detectFileType(file.buffer);
  if (!type) {
    throw new AppError(422, 'FILE_TYPE_INVALID', '只支持 PDF / JPG / PNG 文件');
  }

  await ensureUploadDir();
  const storageKey = `${crypto.randomUUID()}.${type.ext}`;
  const absolutePath = path.join(config.uploadDir, storageKey);
  await fs.writeFile(absolutePath, file.buffer);

  return {
    storageKey,
    originalName: sanitizeOriginalName(file.originalname),
    mimeType: type.mime,
    sizeBytes: file.size,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    absolutePath,
  };
}

export async function removeStoredFile(storageKey) {
  if (!storageKey) return;
  try {
    await fs.unlink(path.join(config.uploadDir, storageKey));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const SAFE_STORAGE_KEY = /^[0-9a-f-]{36}\.(pdf|jpg|png)$/;

/**
 * 下发文件：
 *   本地：Express sendFile；
 *   生产：返回 X-Accel-Redirect，让 Nginx 的 internal 路径发货。
 */
export function sendStoredFile(res, fileRow) {
  if (!SAFE_STORAGE_KEY.test(fileRow.storage_key)) {
    throw new AppError(500, 'FILE_KEY_INVALID', '文件存储标识异常');
  }

  res.setHeader('Content-Type', fileRow.mime_type);
  res.setHeader('Content-Disposition', contentDisposition(fileRow.original_name));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (config.useXAccel) {
    // 只给 Nginx 内部重定向使用，外部直接访问 /__files/ 会被拒绝
    res.setHeader('X-Accel-Redirect', `/__files/${fileRow.storage_key}`);
    return res.status(200).end();
  }

  const absolutePath = path.join(config.uploadDir, fileRow.storage_key);
  return res.sendFile(absolutePath, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({
        error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被移除' },
      });
    }
  });
}
