type PixivIllustDetailResponse = {
  illust: {
    id: number;
    page_count: number;
    image_urls: { square_medium: string };
    meta_single_page: { original_image_url: string } | Record<string, never>;
    meta_pages: Array<{ image_urls: { original: string } }>;
  };
};

type PixivErrorResponse = {
  error: { user_message: string };
};

export function pixivDetailSingle(params: { illustId: number; originalUrl: string }): PixivIllustDetailResponse {
  return {
    illust: {
      id: params.illustId,
      page_count: 1,
      image_urls: { square_medium: 'https://example.invalid/square_medium.jpg' },
      meta_single_page: { original_image_url: params.originalUrl },
      meta_pages: [],
    },
  };
}

export function pixivDetailMulti(params: { illustId: number; originalUrls: string[] }): PixivIllustDetailResponse {
  return {
    illust: {
      id: params.illustId,
      page_count: params.originalUrls.length,
      image_urls: { square_medium: 'https://example.invalid/square_medium.jpg' },
      meta_single_page: {},
      meta_pages: params.originalUrls.map((url) => ({ image_urls: { original: url } })),
    },
  };
}

export function pixivNotFoundError(): PixivErrorResponse {
  return {
    error: { user_message: 'ページが見つかりませんでした' },
  };
}

