/**
 * The `storage` compile option: a per-name hint that says where a free
 * symbol's values live on a shader target.
 *
 * One storage kind exists. With `'sampler2D'`, the values of a fixed-length
 * numeric list live in a single-channel float texture that the host uploads,
 * and a positional read (`At(S, i)`) lowers to a texel fetch instead of a
 * uniform-array subscript. The hint changes only the shader-target lowering.
 * On the JavaScript and interval targets it is IGNORED — the caller
 * compiles one expression to several targets from one options bag, and the
 * hint describes the shader lane only.
 *
 * What is NOT ignored anywhere is the validation, and that is the point of
 * this module: the hint is silent off the shader targets, so a typo in a kind
 * or in a name would otherwise pass without a trace. So on EVERY target an
 * unknown kind is an error, and a hint naming something that is not a free
 * symbol of the expression being compiled is an error. Both are option
 * contract violations (raised before compilation starts, never converted into
 * an interpreter fallback), like an unknown `mode`.
 *
 * Design record: `docs/plans/2026-09-05-sampler-backed-positional-access.md`.
 */

import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Expression } from '../global-types.js';
import type { StorageHint, StorageKind } from './types.js';
import { inputNamesRead } from './interpreter-fallback.js';

/** The storage kinds a hint may name, in the order diagnostics list them. */
export const STORAGE_KINDS: ReadonlyArray<StorageKind> = ['sampler2D'];

function invalid(detail: string): never {
  throw new Error(`Invalid compilation option "storage": ${detail}`);
}

/**
 * The storage kind a hint value names. A bare kind string is the shorthand
 * for the object form `{ kind }`; both spell the same hint. Throws on
 * anything else — an unknown kind, or a value of the wrong shape.
 */
function storageKindOf(name: string, value: unknown): StorageKind {
  const kind =
    typeof value === 'string'
      ? value
      : value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.hasOwn(value, 'kind')
        ? (value as { kind: unknown }).kind
        : undefined;
  if (typeof kind !== 'string')
    invalid(
      `the hint for "${name}" must be a storage kind (a string such as ` +
        `"sampler2D") or an object with a \`kind\` field naming one`
    );
  if (!(STORAGE_KINDS as ReadonlyArray<string>).includes(kind))
    invalid(
      `"${name}" names the storage kind "${kind}", which is not one this ` +
        `version knows — the storage kinds are: ${STORAGE_KINDS.join(', ')}`
    );
  return kind as StorageKind;
}

/**
 * Check the SHAPE of a `storage` option: an object whose every value names a
 * known storage kind. Throws an option-contract error otherwise. This half
 * needs no expression, so the options-contract check of the standalone
 * `compile()` entry can run it before a target is chosen.
 */
export function assertStorageHintsShape(
  storage: unknown
): asserts storage is
  Readonly<Record<MathJsonSymbol, StorageHint>> | undefined {
  if (storage === undefined) return;
  if (storage === null || typeof storage !== 'object' || Array.isArray(storage))
    invalid('expected an object mapping symbol names to storage kinds');
  // `Object.keys`, never `for … in`: the record comes from the caller and may
  // carry an ordinary prototype, and a hint is an OWN entry of it.
  for (const name of Object.keys(storage))
    storageKindOf(name, (storage as Record<string, unknown>)[name]);
}

/**
 * The storage hints `storage`, validated and normalized to a map from symbol
 * name to storage kind — or `undefined` when the caller gave none.
 *
 * Every hinted name must be one of the free symbols that `freeSymbols()`
 * gives (called only when a hint is given). A name that is not throws,
 * naming the free symbols the hint could have applied to.
 */
export function storageHintsOf(
  storage: unknown,
  freeSymbols: () => Iterable<string>
): ReadonlyMap<MathJsonSymbol, StorageKind> | undefined {
  if (storage === undefined) return undefined;
  assertStorageHintsShape(storage);
  const names = Object.keys(storage);
  if (names.length === 0) return undefined;

  const free = new Set<string>(freeSymbols());

  const hints = new Map<MathJsonSymbol, StorageKind>();
  for (const name of names) {
    if (!free.has(name)) {
      const listed =
        free.size === 0
          ? 'the expression has no free symbol'
          : `the free symbols are: ${[...free].join(', ')}`;
      invalid(
        `"${name}" is not a free symbol of the expression being compiled ` +
          `(${listed}), so the hint applies to nothing. A hint names a symbol ` +
          `the caller supplies at run time; a symbol with an assigned value ` +
          `is folded into the generated code, not read from storage`
      );
    }
    hints.set(name, storageKindOf(name, storage[name]));
  }
  return hints;
}

/**
 * The storage hints of a compilation of `expr`, validated and normalized
 * (`storageHintsOf()`), with no compiler: every hinted name must be a name
 * that the run of `expr` takes from its inputs (`inputNamesRead()`): a
 * symbol with no value, once bound variables are excluded, plus any
 * `vars`-mapped symbol that the expression reads, and including the names
 * read by the value of a symbol it reads and by the body of a user function
 * it calls (`f(x) := At(S, x)` read as `f(k)` reads `S`), unless the caller
 * implements that function with its `functions` option. A symbol with an
 * assigned value is folded into the generated code and is never read from
 * storage, so a hint on it names nothing; so does a hint on a name that
 * does not occur at all. The existing targets validate with their own
 * reference analysis (`resolveStorageHints()`, `compile-references.ts`).
 */
export function resolveStorageHintsOfInputs(
  storage: unknown,
  expr: Expression,
  options: {
    vars?: Readonly<Record<string, unknown>>;
    functions?: Readonly<Record<string, unknown>>;
  } = {}
): ReadonlyMap<MathJsonSymbol, StorageKind> | undefined {
  const { vars, functions } = options;
  return storageHintsOf(storage, () =>
    inputNamesRead(
      expr,
      vars ? new Set(Object.keys(vars)) : undefined,
      functions === undefined
        ? undefined
        : (name) => Object.hasOwn(functions, name)
    )
  );
}
