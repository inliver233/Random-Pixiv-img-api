import { createHmac } from 'node:crypto';

function assertHex(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    const err = new Error(`Invalid ${name}.`);
    (err as any).status = 500;
    (err as any).code = 'IMGPROXY_CONFIG_INVALID';
    throw err;
  }

  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    const err = new Error(`${name} must be a hex string (even length).`);
    (err as any).status = 500;
    (err as any).code = 'IMGPROXY_CONFIG_INVALID';
    throw err;
  }

  return normalized;
}

function hexToBuffer(value: string, name: string): Buffer {
  const hex = assertHex(value, name);
  return Buffer.from(hex, 'hex');
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64url');
}

export function encodeImgproxySourceUrlBase64(sourceUrl: string, chunkSize = 16): string {
  const encoded = Buffer.from(sourceUrl).toString('base64url');
  const size = Number.isFinite(chunkSize) ? Math.trunc(chunkSize) : 16;
  if (size <= 0) return encoded;

  const parts: string[] = [];
  for (let i = 0; i < encoded.length; i += size) {
    parts.push(encoded.slice(i, i + size));
  }
  return parts.join('/');
}

export function signImgproxyPath(params: {
  path: string;
  keyHex: string;
  saltHex: string;
  signatureSize?: number;
}): string {
  const { path, keyHex, saltHex } = params;

  const signatureSize = params.signatureSize ?? 32;
  const size = Number.isFinite(signatureSize) ? Math.trunc(signatureSize) : 32;
  const sliceSize = Math.max(1, Math.min(32, size));

  const key = hexToBuffer(keyHex, 'IMGPROXY_KEY');
  const salt = hexToBuffer(saltHex, 'IMGPROXY_SALT');

  const normalizedPath = String(path || '');
  if (!normalizedPath.startsWith('/')) {
    const err = new Error('path must start with /.');
    (err as any).status = 500;
    (err as any).code = 'IMGPROXY_CONFIG_INVALID';
    throw err;
  }

  const digest = createHmac('sha256', key)
    .update(salt)
    .update(normalizedPath)
    .digest();

  return base64UrlEncode(digest.subarray(0, sliceSize));
}

export function buildSignedImgproxyUrl(params: {
  baseUrl: string;
  keyHex: string;
  saltHex: string;
  processingOptions: string;
  sourceUrl: string;
  extension?: string;
  signatureSize?: number;
  encodedChunkSize?: number;
}): string {
  const baseUrl = String(params.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    const err = new Error('IMGPROXY_URL is required.');
    (err as any).status = 500;
    (err as any).code = 'IMGPROXY_CONFIG_INVALID';
    throw err;
  }

  const processingOptions = String(params.processingOptions || '').trim();
  if (!processingOptions) {
    const err = new Error('processingOptions is required.');
    (err as any).status = 500;
    (err as any).code = 'IMGPROXY_CONFIG_INVALID';
    throw err;
  }

  const sourceUrl = String(params.sourceUrl || '').trim();
  if (!sourceUrl) {
    const err = new Error('sourceUrl is required.');
    (err as any).status = 500;
    (err as any).code = 'IMGPROXY_CONFIG_INVALID';
    throw err;
  }

  const encoded = encodeImgproxySourceUrlBase64(sourceUrl, params.encodedChunkSize ?? 16);
  const ext = params.extension ? String(params.extension).trim().replace(/^\.+/, '') : '';

  const path = ext
    ? `/${processingOptions}/${encoded}.${ext}`
    : `/${processingOptions}/${encoded}`;

  const signature = signImgproxyPath({
    path,
    keyHex: params.keyHex,
    saltHex: params.saltHex,
    signatureSize: params.signatureSize,
  });

  return `${baseUrl}/${signature}${path}`;
}

