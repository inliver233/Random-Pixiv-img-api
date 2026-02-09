import { getDeadLetterQueueName } from '../../queue/queue';
import { getAdminActionQueueNames } from '../../jobs/adminActions';
import { HYDRATION_BACKFILL_JOB } from '../../jobs/hydrationBackfill';
import { HEAL_URL_JOB } from '../../jobs/healUrl';
import { HYDRATE_METADATA_JOB } from '../../jobs/hydrateMetadata';
import { getAdminImportQueueNames } from '../../jobs/importImages';

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getAdminJobsQueueNames(): string[] {
  const baseNamesRaw: unknown[] = [
    ...getAdminActionQueueNames(),
    ...getAdminImportQueueNames(),
    HYDRATE_METADATA_JOB,
    HEAL_URL_JOB,
    HYDRATION_BACKFILL_JOB,
  ];

  const names = new Set<string>();
  for (const item of baseNamesRaw) {
    const name = normalizeName(item);
    if (name) names.add(name);
  }

  for (const baseName of Array.from(names)) {
    const dead = getDeadLetterQueueName(baseName);
    if (dead) names.add(dead);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
