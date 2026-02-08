export function hasEffectiveFilterValue(value: unknown): boolean {
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): boolean => {
    if (input === undefined || input === null) return false;

    if (typeof input === 'string') return input.trim().length > 0;
    if (typeof input === 'number') return Number.isFinite(input);
    if (typeof input === 'bigint') return true;
    if (typeof input === 'boolean') return true;

    if (input instanceof Date) return Number.isFinite(input.getTime());

    if (Array.isArray(input)) {
      if (input.length === 0) return false;
      return input.some((item) => walk(item, depth + 1));
    }

    if (typeof input !== 'object') return false;
    if (depth > 6) return false;

    if (seen.has(input)) return false;
    seen.add(input);

    const obj = input as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;

    if ('value' in obj) return walk(obj.value, depth + 1);
    if ('id' in obj) return walk(obj.id, depth + 1);

    if ('from' in obj || 'to' in obj) {
      return walk(obj.from, depth + 1) || walk(obj.to, depth + 1);
    }

    return keys.some((key) => walk(obj[key], depth + 1));
  };

  return walk(value, 0);
}
