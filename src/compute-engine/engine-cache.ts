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
import { CancellationError } from '../common/interruptible';

type CacheEntry = {
  value: unknown;
  build: () => unknown;
  purge?: (v: unknown) => unknown;
};

/**
 * MUTABLE-OBJECT DISPOSITION (ruling B3's cache inventory, ruling B12): this
 * is the engine's one GLOBAL, STRONG value retainer — its entries live as long
 * as the engine and are held by name, not weakly — so **no entry may ever hold
 * a `BoxedObject`, directly or nested inside a value**. An object stored here
 * would survive every scope, outliving the program's last reference to it, and
 * an object-derived entry could never be invalidated (a field store advances
 * no engine axis and this store records no dependencies).
 *
 * The rule is upheld by what gets stored, not by machinery: the five named
 * caches built through it hold rule sets and constant tables (simplification
 * rules, univariate-root rules, harmonization rules, the constructible
 * trigonometric-value tables), all built from the standard library and from
 * literals, with no route to a user value. It is pinned adversarially by a
 * test rather than by a guard, because adding a containment scan to a
 * name-keyed store of arbitrary payloads would cost every build a walk to
 * defend against a case no caller can currently produce.
 */
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
        // An interruption (timeout/abort) is not a cache failure: let it
        // propagate, and leave the entry unbuilt so a later call retries.
        // Swallowing it would return `undefined` to the caller and surface as
        // an unrelated TypeError downstream.
        if (e instanceof CancellationError) throw e;
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
