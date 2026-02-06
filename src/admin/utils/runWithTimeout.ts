export type TimedResultOk<T> = { status: 'ok'; value: T };
export type TimedResultTimeout = { status: 'timeout' };
export type TimedResultError = { status: 'error'; error: string };
export type TimedResult<T> = TimedResultOk<T> | TimedResultTimeout | TimedResultError;

export async function runWithTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<TimedResult<T>> {
  const timeout = Math.max(1, Math.trunc(timeoutMs));

  const timer = new Promise<TimedResultTimeout>((resolve) => {
    setTimeout(() => resolve({ status: 'timeout' }), timeout);
  });

  try {
    const value = await Promise.race([
      work.then((result): TimedResultOk<T> => ({ status: 'ok', value: result })),
      timer,
    ]);
    return value;
  } catch (err: unknown) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

