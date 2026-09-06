/**
 * The `storage` compile option: a per-name hint that says where a free
 * symbol's values live on a shader target.
 *
 * Today one storage kind exists, `'sampler2D'`: the values of a fixed-length
 * numeric list live in a single-channel float texture that the host uploads,
 * and a positional read (`At(S, i)`) lowers to a texel fetch instead of a
 * uniform-array subscript. The hint changes only the shader-target lowering.
 * On the JavaScript, interval and Python targets it is IGNORED — the caller
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
import type { CompileTarget, StorageHint, StorageKind } from './types.js';
import { BaseCompiler } from './base-compiler.js';

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
  | Readonly<Record<MathJsonSymbol, StorageHint>>
  | undefined {
  if (storage === undefined) return;
  if (storage === null || typeof storage !== 'object' || Array.isArray(storage))
    invalid('expected an object mapping symbol names to storage kinds');
  // `Object.keys`, never `for … in`: the record comes from the caller and may
  // carry an ordinary prototype, and a hint is an OWN entry of it.
  for (const name of Object.keys(storage))
    storageKindOf(name, (storage as Record<string, unknown>)[name]);
}

/**
 * The storage hints of a compilation, validated and normalized to a map from
 * symbol name to storage kind — or `undefined` when the caller gave none.
 *
 * Every hinted name must be a free symbol of (at least one of) `exprs` as the
 * code generator sees them (`BaseCompiler.analyzeReferences`): a symbol the
 * engine has no value for, once bound variables are excluded, plus any
 * `vars`-mapped symbol, and including the free symbols of a user-defined
 * function body the expression calls (`f(x) := At(S, x)` read as `f(k)`
 * reads `S`). A symbol with an assigned value is folded into the generated
 * code and is never read from storage, so a hint on it names nothing; so does
 * a hint on a name that does not occur at all. Both throw, naming the free
 * symbols the hint could have applied to.
 *
 * `target` is the language target the expression will be compiled to
 * (`languageTarget.createTarget()` suffices); `options` are the caller's
 * `vars` and `functions`. The analysis walks a user-defined function body only
 * when the target carries a user-function registry and the caller has not
 * overridden that function's implementation — the same two conditions the
 * real compilation lowers such a call under — so an analysis-only target with
 * those two facts is built here rather than asked of every caller. Callers
 * should invoke this only when `storage` is given: the target construction is
 * not free, and there is nothing to validate otherwise.
 */
export function resolveStorageHints(
  storage: unknown,
  exprs: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  options: {
    vars?: Readonly<Record<string, unknown>>;
    functions?: Readonly<Record<string, unknown>>;
  } = {}
): ReadonlyMap<MathJsonSymbol, StorageKind> | undefined {
  if (storage === undefined) return undefined;
  assertStorageHintsShape(storage);
  const names = Object.keys(storage);
  if (names.length === 0) return undefined;

  const { vars, functions } = options;
  const analysis: CompileTarget<Expression> = {
    ...target,
    userFunctions: target.userFunctions ?? {
      defs: new Map(),
      compiling: new Set(),
    },
    // A head the caller overrides is not a user-function literal to descend
    // into (its body is never compiled), so the analysis must see it as
    // defined. Only definedness is read here; the spelling is immaterial.
    functions: (id) =>
      functions !== undefined && Object.hasOwn(functions, id)
        ? id
        : target.functions?.(id),
  };
  const varsKeys = vars ? new Set(Object.keys(vars)) : undefined;
  const free = new Set<string>();
  for (const expr of exprs)
    for (const s of BaseCompiler.analyzeReferences(expr, analysis, varsKeys)
      .freeSymbols)
      free.add(s);

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
