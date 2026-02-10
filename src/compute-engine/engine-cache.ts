/**
 * Internal cache storage used by ComputeEngine.
 *
 * Preserves current cache semantics:
 * - cache entries are lazily built once
 * - purge only touches truthy values
 * - entries without a purge callback are dropped on purge
 *
 * @internal
 */
type CacheEntry = {
  value: unknown;
  build: () => unknown;
  purge?: (v: unknown) => unknown;
};

export class EngineCacheStore {
  private _entries: Record<string, CacheEntry> = {};

  getOrBuild<T>(
    cacheName: string,
    build: () => T,
    purge?: (t: T) => T | undefined
  ): T {
    if (this._entries[cacheName] === undefined) {
      try {
        this._entries[cacheName] = {
          build: build as () => unknown,
          purge: purge as ((v: unknown) => unknown) | undefined,
          value: build(),
        };
      } catch (e) {
        console.error(`Fatal error building cache "${cacheName}":\n\t ${e}`);
      }
    }

    return this._entries[cacheName]?.value as T;
  }

  invalidate(cacheName: string): void {
    delete this._entries[cacheName];
  }

  purgeValues(): void {
    for (const key of Object.keys(this._entries)) {
      const entry = this._entries[key];
      if (entry.value) {
        if (!entry.purge) delete this._entries[key];
        else entry.value = entry.purge(entry.value);
      }
    }
  }
}

