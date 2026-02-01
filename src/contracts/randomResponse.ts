export const STABLE_IMAGE_MAX_AGE_SECONDS = 31536000;

export type RandomOrientation = 'portrait' | 'landscape' | 'square' | 'unknown';

export type RandomJsonResponse = {
  id: number;
  illust_id: number;
  page_index: number;
  r18: boolean;
  width: number | null;
  height: number | null;
  orientation: RandomOrientation;
  tags: string[];
  author: {
    user_id: number | null;
    name: string | null;
  };
  urls: {
    proxy: string;
    origin: string;
    imgproxy?: string;
  };
  cache: {
    max_age: number;
  };
  debug: {
    picked_by: 'random_key' | 'tablesample';
    attempt: number;
  };
};

function bigintToSafeNumber(value: bigint, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    const err = new Error('Integer out of safe range.');
    (err as any).status = 500;
    (err as any).code = code;
    throw err;
  }
  return n;
}

function bigintLikeToSafeNumber(value: unknown, code: string): number {
  if (typeof value === 'bigint') return bigintToSafeNumber(value, code);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      const err = new Error('Integer out of safe range.');
      (err as any).status = 500;
      (err as any).code = code;
      throw err;
    }
    return value;
  }

  const err = new Error('Invalid integer.');
  (err as any).status = 500;
  (err as any).code = code;
  throw err;
}

function orientationToString(value: unknown): RandomOrientation {
  const n = typeof value === 'number' ? value : value === null || value === undefined ? null : Number(value);

  if (n === 1) return 'portrait';
  if (n === 2) return 'landscape';
  if (n === 3) return 'square';
  return 'unknown';
}

function normalizePickedBy(value: unknown): 'random_key' | 'tablesample' {
  if (value === 'tablesample') return 'tablesample';
  return 'random_key';
}

export function buildRandomJsonResponse(input: {
  image: any;
  tags: string[];
  proxyUrl: string;
  originUrl: string;
  imgproxyUrl?: string;
  attempt: number;
  pickedBy?: unknown;
}): RandomJsonResponse {
  const image = input.image;

  const id = bigintLikeToSafeNumber(image?.id, 'IMAGE_ID_OUT_OF_RANGE');
  const illustId = bigintLikeToSafeNumber(image?.illustId, 'ILLUST_ID_OUT_OF_RANGE');
  const pageIndex = typeof image?.pageIndex === 'number' ? image.pageIndex : Number(image?.pageIndex ?? 0);

  const xRestrict = typeof image?.xRestrict === 'number' ? image.xRestrict : Number(image?.xRestrict ?? 0);

  const userIdRaw = image?.userId;
  const userId = userIdRaw === null || userIdRaw === undefined ? null : bigintLikeToSafeNumber(userIdRaw, 'USER_ID_OUT_OF_RANGE');

  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.filter((t) => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()))].sort()
    : [];

  const width = typeof image?.width === 'number' ? image.width : null;
  const height = typeof image?.height === 'number' ? image.height : null;

  return {
    id,
    illust_id: illustId,
    page_index: pageIndex,
    r18: Number.isFinite(xRestrict) && xRestrict > 0,
    width,
    height,
    orientation: orientationToString(image?.orientation),
    tags,
    author: {
      user_id: userId,
      name: typeof image?.userName === 'string' ? image.userName : image?.userName ?? null,
    },
    urls: {
      proxy: input.proxyUrl,
      origin: input.originUrl,
      ...(typeof input.imgproxyUrl === 'string' && input.imgproxyUrl.trim() !== '' ? { imgproxy: input.imgproxyUrl } : {}),
    },
    cache: {
      max_age: STABLE_IMAGE_MAX_AGE_SECONDS,
    },
    debug: {
      picked_by: normalizePickedBy(input.pickedBy),
      attempt: input.attempt,
    },
  };
}
