const { isAllowedImageExt, normalizeImageExtension } = require('./contentType');

const PXIMG_HOST_SUFFIX = '.pximg.net';

function normalizePximgHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return null;
  if (host === 'pximg.net') return host;
  if (host.endsWith(PXIMG_HOST_SUFFIX)) return host;
  return null;
}

/**
 * Parse Pixiv original image URL and extract illust_id/page_index/ext.
 *
 * @param {unknown} inputUrl
 * @returns {{ ok: true, illustId: bigint, pageIndex: number, ext: string } | { ok: false, code: 'invalid_url' | 'unsupported_url', message: string }}
 */
function parsePixivUrl(inputUrl) {
  if (typeof inputUrl !== 'string' || !inputUrl.trim()) {
    return { ok: false, code: 'invalid_url', message: 'url must be a non-empty string' };
  }

  let url;
  try {
    url = new URL(inputUrl.trim());
  } catch {
    return { ok: false, code: 'invalid_url', message: 'invalid url' };
  }

  const host = normalizePximgHost(url.hostname);
  if (!host) {
    return { ok: false, code: 'unsupported_url', message: 'unsupported host' };
  }

  const path = url.pathname;
  const match = /\/(\d+)_p(\d+)(?:_[^/]+)?\.(jpg|jpeg|png|gif|webp)$/i.exec(path);
  if (!match) {
    return { ok: false, code: 'unsupported_url', message: 'unsupported path' };
  }

  const illustIdRaw = match[1];
  const pageIndexRaw = match[2];
  const extRaw = match[3];

  let illustId;
  try {
    illustId = BigInt(illustIdRaw);
  } catch {
    return { ok: false, code: 'unsupported_url', message: 'invalid illust id' };
  }

  const pageIndex = Number(pageIndexRaw);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    return { ok: false, code: 'unsupported_url', message: 'invalid page index' };
  }

  const ext = normalizeImageExtension(extRaw);
  if (!ext || !isAllowedImageExt(ext)) {
    return { ok: false, code: 'unsupported_url', message: 'unsupported extension' };
  }

  return { ok: true, illustId, pageIndex, ext };
}

module.exports = {
  parsePixivUrl,
};
