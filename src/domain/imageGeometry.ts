export const ORIENTATION_PORTRAIT = 1;
export const ORIENTATION_LANDSCAPE = 2;
export const ORIENTATION_SQUARE = 3;

export type ImageGeometry = {
  width: number | null;
  height: number | null;
  orientation: number | null;
  aspectRatio: number | null;
};

export function normalizePositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (!Number.isSafeInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

export function computeOrientation(width: number, height: number): number {
  if (width === height) return ORIENTATION_SQUARE;
  if (height > width) return ORIENTATION_PORTRAIT;
  return ORIENTATION_LANDSCAPE;
}

export function computeAspectRatio(width: number, height: number): number {
  return width / height;
}

export function computeGeometryFromWidthHeight(width: number | null, height: number | null): ImageGeometry {
  if (width === null || height === null) {
    return { width, height, orientation: null, aspectRatio: null };
  }

  return {
    width,
    height,
    orientation: computeOrientation(width, height),
    aspectRatio: computeAspectRatio(width, height),
  };
}

