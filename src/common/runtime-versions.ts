// The versions of the two runtimes that compiled code calls. They live in a
// module with no imports, in the lowest layer, so that the kernel pool, the
// JavaScript runtime and the interval library can all read them. The pool is
// part of the light runtime entry (`src/runtime.ts`), which must not hold the
// interval library.

/**
 * The version of the helper set. Compilation results and runtimes carry it, so
 * a host that stores code and runs it elsewhere can tell that the two ends
 * were built from different releases: compare the strings.
 */
export const RUNTIME_VERSION = '{{SDK_VERSION}}';

/**
 * The version of the interval library that compiled `interval-js` code calls
 * as `_IA`. An `interval-js` compilation result carries it as
 * `runtimeVersion`, so a host that stores the code and rebuilds the function
 * elsewhere (a worker, another page) can tell that the two ends were built
 * from different releases: compare the strings. The placeholder is replaced
 * with the package version by the build (`scripts/build.sh`).
 */
export const INTERVAL_RUNTIME_VERSION = '{{SDK_VERSION}}';
