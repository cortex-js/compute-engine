/**
 * One-time console warnings — and the alias normalization they describe — for
 * the deprecated pre-`mode` compile options (design §5,
 * `docs/plans/2026-08-16-compile-complex-mode.md`).
 *
 * This lives in its own module because there are TWO public routes into a
 * compilation and both owe the caller the same warning AND the same option
 * semantics:
 *
 * - the standalone `compile()` export (`compile-expression.ts`), and
 * - a target obtained from `ce.getCompilationTarget(name)` and invoked
 *   through its own `.compile()`, which reaches `BaseCompiler` directly and
 *   never passes through the standalone entry.
 *
 * Warning without normalizing made the message a lie on the second route: it
 * announces that `complexPromotion` "now maps to `mode: 'complex'`" and is
 * "ignored when `mode` is given", but an un-normalized `complexPromotion:
 * true` reaches `BaseCompiler`'s legacy promotion latch, which is consulted
 * independently of the mode — so under an explicit `mode: 'strict'` the flag
 * was still honored and the compile promoted unknown-sign radicals. The
 * normalization therefore lives here, next to the wording it justifies, and
 * both routes call it.
 *
 * Before this module existed the warnings were private to
 * `compile-expression.ts`, so the target-level route was silent: the
 * deprecated options kept working there (each target reads `realOnly` itself,
 * and `complexPromotion` reached the promotion latch un-normalized) but no
 * consumer on that path was ever told the clock was running. That route is the one an integration takes once it needs
 * a specific target — i.e. exactly the consumers with the most call sites to
 * migrate. Reported by the Tycho consumer as item 202, 2026-08-17, with all
 * twelve of their production `realOnly: true` sites on the silent path.
 *
 * `base-compiler.ts` cannot import from `compile-expression.ts` (that module
 * imports the targets, which import `BaseCompiler`), so the shared text is
 * extracted here rather than re-exported — the standard fix for this repo's
 * zero-circular-dependency budget (`docs/architecture/ZERO-CYCLES-PLAN.md`).
 */

/** The deprecated options already warned about, once per process each. */
const deprecationWarned = new Set<string>();

/**
 * Emit `message` the first time `key` is seen in this process, and never
 * again. Idempotent by design: one compilation can reach the warnings several
 * times — the standalone `compile()` export normalizes the options and then
 * calls into the target, whose own `compile()` normalizes again, and the
 * `auto` discipline compiles a second time after a `LaneMismatch` — and the
 * caller must see one warning, not four.
 */
function warnDeprecatedOnce(key: string, message: string): void {
  if (deprecationWarned.has(key)) return;
  deprecationWarned.add(key);
  console.warn(message);
}

/**
 * Forget which keys have already warned.
 *
 * "Once per process" is the right behaviour for a consumer — a deprecation
 * should not spam a render loop — but it makes any TEST of the warnings
 * order-dependent: the first case to touch a key consumes it, and every later
 * assertion on that key sees silence and reads it as a regression. Call this
 * in a `beforeEach` so each case starts from a known state rather than from
 * whatever ran before it.
 *
 * Exported for tests only; nothing in the engine calls it.
 */
export function resetDeprecationWarnings(): void {
  deprecationWarned.clear();
}

/**
 * Warn about whichever deprecated options are PRESENT on `options`.
 *
 * Presence, not truthiness: `complexPromotion: false` and `realOnly: false`
 * are no-ops today, but they are still call sites that must be edited before
 * the options are removed, so they get their own (differently worded) warning
 * rather than silence. An absent key — `undefined` — warns nothing.
 */
function warnDeprecatedCompileOptions(options: {
  complexPromotion?: boolean;
  realOnly?: boolean;
  mode?: string;
}): void {
  if (options.complexPromotion !== undefined) {
    if (options.mode !== undefined) {
      warnDeprecatedOnce(
        'complexPromotion+mode',
        'compile(): the deprecated `complexPromotion` option is ignored when `mode` is given.'
      );
    } else if (options.complexPromotion === true) {
      warnDeprecatedOnce(
        'complexPromotion',
        "compile(): the `complexPromotion` option is deprecated — it now maps to `mode: 'complex'` (ignored on a target that does not offer complex mode); pass `mode` instead."
      );
    } else {
      warnDeprecatedOnce(
        'complexPromotion:false',
        "compile(): the `complexPromotion` option is deprecated — `false` suppresses nothing (the default `mode: 'auto'` still promotes where it must), so the option can simply be dropped; pass `mode: 'strict'` to forbid promotion or `mode: 'complex'` to force it."
      );
    }
  }
  if (options.realOnly !== undefined) {
    if (options.realOnly === true) {
      warnDeprecatedOnce(
        'realOnly',
        "compile(): the `realOnly` option is deprecated — a compiled value whose imaginary part is exactly zero is already returned as a plain number; test `typeof v === 'number'` instead. The projection is kept for one release."
      );
    } else {
      warnDeprecatedOnce(
        'realOnly:false',
        'compile(): the `realOnly` option is deprecated — `false` applies no projection, which is already the behaviour without the option, so it can simply be dropped.'
      );
    }
  }
}

/**
 * Warn about the deprecated pre-`mode` options present on `options`, and
 * return a copy in which the `complexPromotion` alias has been resolved:
 *
 * - `complexPromotion` — when `mode` is absent and the flag is `true`, it
 *   becomes `mode: 'complex'` and `modeFromAlias` is `true`; with an explicit
 *   `mode` the flag loses. Either way the key is cleared to `undefined`, so
 *   it cannot re-enter through `BaseCompiler`'s legacy promotion latch, which
 *   is read independently of the mode and would otherwise promote
 *   unknown-sign radicals under an explicit `mode: 'strict'`.
 * - `realOnly` — NOT normalized. It is a RESULT projection (`{re, im}` →
 *   `NaN` unless the imaginary part is at roundoff scale, boolean → `NaN`)
 *   rather than an arithmetic discipline, and is kept working for one
 *   release; only the warning applies.
 *
 * `supportsComplexMode` is whether the target this compilation will run on
 * offers `mode: 'complex'` (its `supportedModes`). When it does not — the
 * shader and interval targets declare `['strict']` — the aliased mode is NOT
 * set: `complexPromotion` was documented as ignored there, so mapping it onto
 * a mode the target must reject would turn a compile that used to succeed
 * into an `unsupported-mode` decline. Callers that do not yet know the target
 * leave it at its default and drop the aliased mode themselves once they do,
 * using the returned `modeFromAlias`.
 */
export function normalizeDeprecatedCompileOptions<
  T extends { complexPromotion?: boolean; realOnly?: boolean; mode?: string },
>(
  options: T,
  supportsComplexMode = true
): { options: T; modeFromAlias: boolean } {
  warnDeprecatedCompileOptions(options);
  let out = options;
  let modeFromAlias = false;
  if (options.complexPromotion !== undefined) {
    if (
      options.mode === undefined &&
      options.complexPromotion === true &&
      supportsComplexMode
    ) {
      out = { ...out, mode: 'complex' } as T;
      modeFromAlias = true;
    }
    out = { ...out, complexPromotion: undefined } as T;
  }
  return { options: out, modeFromAlias };
}
