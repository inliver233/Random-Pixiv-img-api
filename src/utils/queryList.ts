type ParseStringListOptions = {
  paramName: string;
  separators?: RegExp;
};

function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v ?? ''));
  return [String(value ?? '')];
}

export function parseStringListQueryParam(value: unknown, options: ParseStringListOptions): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  const separators = options.separators ?? /[|,]/;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of toStringArray(value)) {
    const normalized = raw.trim();
    if (!normalized) continue;

    for (const part of normalized.split(separators)) {
      const token = part.trim();
      if (!token) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }

  if (out.length === 0) {
    const err = new Error(`Invalid ${options.paramName}.`);
    (err as any).status = 400;
    throw err;
  }

  return out;
}

