export type ParsePixivUrlOk = {
  ok: true;
  illustId: bigint;
  pageIndex: number;
  ext: string;
};

export type ParsePixivUrlError = {
  ok: false;
  code: 'invalid_url' | 'unsupported_url';
  message: string;
};

export type ParsePixivUrlResult = ParsePixivUrlOk | ParsePixivUrlError;

type ParsePixivUrlModule = {
  parsePixivUrl: (inputUrl: unknown) => ParsePixivUrlResult;
};

// Use the JS implementation so app.js (CJS) and app.ts (TS build) share behavior.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('./parsePixivUrl.js') as ParsePixivUrlModule;

export const parsePixivUrl = mod.parsePixivUrl;

