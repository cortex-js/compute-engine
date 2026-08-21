/**
 * One-time warnings and alias normalization for deprecated compile options.
 *
 * This lives in its own module because there are TWO public routes into a
 * compilation and both owe the caller the same warning and option
 * semantics:
 *
 * - the standalone `compile()` export (`compile-expression.ts`), and
 * - a target obtained from `ce._getCompilationTarget(name)` and invoked
 *   through its own `.compile()`, which reaches `BaseCompiler` directly and
 *   never passes through the standalone entry.
 *
 * Normalization lives beside the warnings so both routes interpret aliases
 * identically. This separate module also avoids a dependency cycle between
 * `compile-expression.ts`, the targets, and `BaseCompiler`.
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
 * Warn about whichever deprecated or removed options are PRESENT on
 * `options`.
 *
 * Presence, not truthiness: `complexPromotion: false` and `realOnly: false`
 * are no-ops, but they are still call sites that must be edited, so they get
 * their own (differently worded) warning rather than silence. An absent key —
 * `undefined` — warns nothing.
 *
 * `realOnly` is no longer a typed option and no longer does anything; the
 * warning stays because an untyped JavaScript caller can still pass the key
 * and would otherwise see its result projection disappear in silence.
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
        "compile(): the `realOnly` option has been REMOVED and is now ignored — the result is no longer projected to a real number. A compiled value whose imaginary part is exactly zero is already returned as a plain number, so test `typeof v === 'number'` per sample and map a `{re, im}` to whatever your value boundary needs. `realOnly` never suppressed promotion nor held the real lane — pass `mode: 'strict'` for that."
      );
    } else {
      warnDeprecatedOnce(
        'realOnly:false',
        'compile(): the `realOnly` option has been REMOVED — `false` applied no projection, which is the behaviour without the option, so the key can simply be dropped.'
      );
    }
  }
}

/**
 * Warn about the deprecated pre-`mode` options present on `options`, and
 * return a copy in which the `complexPromotion` alias has been resolved:
 *
 * - `complexPromotion`: when `mode` is absent and the flag is `true`, it
 *   becomes `mode: 'complex'` and `modeFromAlias` is `true`; with an explicit
 *   `mode` the flag loses. Either way the key is cleared to `undefined`, so
 *   it cannot affect promotion independently of the selected mode.
 * - `realOnly`: removed. It was a result projection rather than an arithmetic
 *   discipline, so it never selected a lowering and there is nothing to
 *   normalize; a call site still passing the key gets the warning and no
 *   projection.
 *
 * `supportsComplexMode` is whether the target this compilation will run on
 * offers `mode: 'complex'` (its `supportedModes`). Shader and interval targets
 * do not, so the alias is ignored there instead of producing an unsupported
 * mode. Callers that do not yet know the target use `modeFromAlias` to remove
 * the aliased mode after selecting one that cannot support it.
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
