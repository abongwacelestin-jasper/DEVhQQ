/**
 * A minimal in-process async mutex. Serialises read-check-write sequences that
 * span awaits, e.g. "is this the last active Owner? then demote" (W5-07).
 *
 * Process-local on purpose: production runs exactly one backend replica until the
 * remaining per-process collections move to Postgres (lib/redis.ts refuses more).
 * When replicas are allowed, these sequences move into one SQL transaction.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    // Keep the chain alive whatever fn does; callers still see their own error.
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Every change that can reduce the number of active Owners runs under this lock. */
export const ownerChanges = new Mutex();
