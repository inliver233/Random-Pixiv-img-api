export function generateRandomKey(random: () => number = Math.random): number {
  const value = random();

  if (!Number.isFinite(value)) {
    throw new Error('random_key must be a finite number.');
  }

  if (value < 0 || value >= 1) {
    throw new Error('random_key must be in [0,1).');
  }

  return value;
}

