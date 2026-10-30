import type { Expression, RoundingTies } from '../global-types.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import { compileWithAutoEscalation } from './auto-escalation.js';
import { withVarsValuesHidden } from './vars-inputs.js';
import { resolveStorageHints } from './storage-hints.js';

import type {
  CompileMode,
  CompileTarget,
  CompiledOperators,
  CompiledFunction,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  NamingContext,
} from './types.js';
import {
  CompileDeclineError,
  compileDiagnosticOf,
  compileSubject,
} from './diagnostics.js';
import type { ConditionDialect, ConditionNode } from './base-compiler.js';
import {
  BaseCompiler,
  couldBeCollectionParticipant,
  isFlatAllStringComparisonParticipant,
  isMixedStringOrderingParticipants,
  isNumericTupleParticipant,
  isProvablyCharacterOperand,
  isProvablyStringComparisonParticipant,
  isProvablyStringOperand,
  isProvablyTupleParticipant,
  shapeOperandRefusal,
  statementBodyHead,
  isTailAssignmentBlock,
  unfaithfulComparisonAggregate,
} from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import {
  assertAccumulatorFitsStep,
  elementsMayBeCollections,
  inPlaceUpdateChains,
  isDefinitelyCollectionType,
} from './in-place-update.js';
import { unrollFixedWidthCollections } from './fixed-width-unroll.js';
import { isLibraryFoldCombiner } from './builtin-callback.js';
import { tryGetConstant } from './constant-folding.js';
import {
  COINCIDENCE_BUDGET,
  realPowerReconstructionDigits,
} from '../boxed-expression/arithmetic-power.js';
import {
  isBeyondSafeInteger,
  TRIG_POLE_ARGUMENT_CAP,
  TRIG_POLE_EPSILON,
} from '../numerics/numeric.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import {
  absentBaseReadIsNumeric,
  tupleSlotReadType,
} from './absent-tuple-read.js';
import {
  isPointListValue,
  isTuple,
  leafwardElementType,
} from '../collection-utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import {
  collectionElementType,
  containsBroadcastableType,
  indexElementType,
  functionResult,
  isPointElementType,
  // The compiled lanes read the open form of a broadcast over an operand
  // of type `unknown` as `broadcastable<R>` (`resolveTypeForCompiledLanes`).
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import type { Type, TypeReference } from '../../common/type/types.js';
import { typeToString } from '../../common/type/serialize.js';
import { declarationOf } from '../../common/type/reference.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import {
  RANGE_COUNT_TOLERANCE,
  RANGE_COUNT_TOLERANCE_CAP,
} from '../numerics/range-count.js';
import {
  couldBeStringOperand,
  isNonFiniteBound,
  requirePrimitiveElements,
  refuseKleeneQuantifier,
  collectionMayHoldAbsentCell,
  PREDICATE_RESULT_MODES,
  predicateResultCheck,
  stringRefusedEntryType,
  countMayBeNaN,
} from './javascript-target.js';

/**
 * The boolean literals, which Python spells exactly as MathJSON does.
 *
 * Deliberately NOT part of `PYTHON_CONSTANTS`: that table backs the target's
 * `var` resolver, and a `var` answer is what licenses the constant folder to
 * replace an expression with its folded value. Adding the booleans there let
 * `Equal([1, 2], [3, 4])` fold to the literal `False` instead of lowering to
 * the `_ce_eqcoll` runtime helper, which also bypassed the fail-closed gate
 * that makes `compileLambda` decline a helper-dependent body. That is a
 * codegen change on its own merits, not a side effect this table should
 * cause.
 *
 * What IS true, and all the reference analysis needs, is that a boolean
 * literal costs the caller nothing: an unmapped symbol falls through to a
 * bare identifier, and for `True`/`False` that bare identifier is already
 * Python's own literal. So they are inlined in the observable sense — never
 * read from the variables object — even though they are not folded.
 *
 * Null-prototype so a lookup answers only for a key the table actually
 * declares. A plain object literal inherits `Object.prototype`, so indexing it
 * with an ordinary symbol named `toString`, `constructor` or `valueOf` returns
 * an inherited function rather than `undefined` — which the reference analysis
 * would read as "the target inlines this" and drop a genuine input from
 * `freeSymbols`.
 */
const PYTHON_BOOLEANS: Record<string, string> = {
  __proto__: null as never,
  True: 'True',
  False: 'False',
};

/**
 * The Python keywords (`keyword.kwlist`, Python 3.12). A name in this set
 * cannot be a Python identifier: `x + np.sin(in)` is a syntax error. The soft
 * keywords (`match`, `case`, `_`) are valid identifiers and are not listed.
 * Neither are the value keywords `True` and `False`: the engine's `True` and
 * `False` reach the bare-identifier emission and are the Python literals of
 * the same name. The value keyword `None` is listed: the engine has no
 * symbol that is emitted as a bare `None`, so a symbol named `None` is a
 * user symbol, and emitting its name would read the Python null value.
 */
const PYTHON_KEYWORDS: ReadonlySet<string> = new Set([
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'None',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

/**
 * Fail closed when `id`, emitted as a bare Python identifier, is a Python
 * keyword, or is not a Python identifier at all (`a b`, `1x`), which would
 * not parse. Returns `id` unchanged otherwise. Applied to a free symbol's name
 * (`mangleId`) and to a `vars` mapping whose source is a bare identifier.
 * The syntax test is the one `pythonCheckBindingName()` uses.
 */
function pythonCheckIdentifier(id: string): string {
  if (PYTHON_KEYWORDS.has(id))
    throw new Error(
      `"${id}" is a reserved word in python and cannot be used as a variable name. Rename it, or map it to another name with \`vars\`, before compiling to Python (fail closed, D6).`
    );
  if (!PYTHON_IDENTIFIER.test(id))
    throw new Error(
      `"${id}" is not a Python identifier and cannot be used as a variable name. Rename it, or map it to another name with \`vars\`, before compiling to Python (fail closed, D6).`
    );
  return id;
}

/**
 * Fail closed when `id`, emitted as a name that the generated code BINDS (a
 * function name, a parameter, a loop or summation index), is a Python keyword.
 * Returns `id` unchanged otherwise. Unlike `pythonCheckIdentifier()`, this
 * also rejects the value keywords `True` and `False`: a READ of those names
 * is emitted as the Python boolean literal of the same name, but a binding
 * of them (`def True():`, `lambda False: 1`) is a syntax error.
 *
 * A name that is not a Python identifier at all (`a b`, `1x`) also fails
 * closed: `def a b(1x):` does not parse. A Python identifier is a character
 * with the Unicode property `XID_Start`, or `_`, followed by characters with
 * the property `XID_Continue`, so `αβ` and `名前` are accepted, as Python
 * accepts them.
 */
function pythonCheckBindingName(id: string): string {
  if (PYTHON_KEYWORDS.has(id) || id in PYTHON_BOOLEANS)
    throw new Error(
      `"${id}" is a reserved word in python and cannot be used as a function, parameter or index name. Rename it before compiling to Python (fail closed, D6).`
    );
  if (!PYTHON_IDENTIFIER.test(id))
    throw new Error(
      `"${id}" is not a Python identifier and cannot be used as a function, parameter or index name. Rename it before compiling to Python (fail closed, D6).`
    );
  return id;
}

/** The syntax of a Python identifier (see `pythonCheckBindingName`). */
const PYTHON_IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;

/**
 * The identifier that the Python code uses for the identifier `id`.
 *
 * Python reads each identifier in its NFKC normal form, so two identifiers
 * with the same NFKC form are one name: `ﬁ` (the ligature U+FB01) and `fi`
 * are the same variable. An identifier that NFKC changes is therefore
 * written with each character that NFKC changes replaced by `_u<hex>_`, the
 * hexadecimal code point of the character: `ﬁ` is written `_uFB01_`. When
 * the result is still changed by NFKC (a letter followed by a combining mark
 * that NFKC composes), every character that is not ASCII is replaced. The
 * result is then made of characters that NFKC does not change. An
 * identifier that NFKC does not change is returned unchanged.
 */
function pythonNfkcSafeName(id: string): string {
  if (id.normalize('NFKC') === id) return id;
  const escape = (c: string): string =>
    `_u${c.codePointAt(0)!.toString(16).toUpperCase()}_`;
  let out = '';
  for (const c of id) out += c.normalize('NFKC') === c ? c : escape(c);
  if (out.normalize('NFKC') === out) return out;
  out = '';
  for (const c of id) out += c.codePointAt(0)! < 0x80 ? c : escape(c);
  return out;
}

/**
 * The string literals of the Python source `code` (double-quoted, as this
 * target writes a string value, or single-quoted, as some lowerings write a
 * constant string) alternate with the other parts of the source. Returns
 * the parts: an even index is source, an odd index is a string literal.
 */
function pythonSplitStringLiterals(code: string): string[] {
  return code.split(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/);
}

/** The identifier tokens of a Python source without string literals. */
const PYTHON_IDENTIFIER_TOKEN = /[\p{XID_Start}_]\p{XID_Continue}*/gu;

/**
 * Write the Python source `body` so that two different identifiers stay
 * two different names in Python.
 *
 * Python reads each identifier in its NFKC normal form, so two identifiers
 * with the same NFKC form are one variable: the symbols `ﬁ` (the ligature
 * U+FB01) and `fi` of `ﬁ + fi` were the same name in the compiled code. An
 * identifier whose NFKC form no other identifier of the code has is kept as
 * it is written (`𝑥 + 1` stays `𝑥 + 1`, which Python reads as `x + 1`), so
 * the names that the result reports (`freeSymbols`) are the names that the
 * code reads.
 *
 * In a group of two or more identifiers with the same NFKC form, one is
 * kept and each other one is renamed: to `pythonNfkcSafeName()` of it, with
 * a suffix `_1`, `_2`, … when that name has the NFKC form of another
 * identifier of the code. The kept identifier is the one that the host
 * refers to by its name, when there is one (`hostNames()`: a free symbol,
 * which the host gives as a global, the name of the function), else the
 * one that NFKC does not change. A bound name (a parameter, a local, an
 * index) can be renamed, because the host does not refer to it by name.
 * The compilation fails when two identifiers of a group are host names: the
 * host cannot give them two values. The tokens of the `vars` sources of the
 * caller (`callerSources`) are host names too, kept as the caller wrote
 * them.
 *
 * `outside` are the identifiers that the caller of this function writes
 * outside `body` (a parameter, the name of a function): the returned
 * `name()` gives the identifier to write for each of them.
 *
 * `hostNames()` is called only when there is a group.
 */
function pythonDistinctIdentifiers(
  body: string,
  options: {
    outside?: ReadonlyArray<string>;
    callerSources?: ReadonlyArray<string>;
    hostNames: () => Iterable<string>;
  }
): { body: string; name: (id: string) => string } {
  const parts = pythonSplitStringLiterals(body);
  const tokens = new Set<string>(options.outside ?? []);
  for (let i = 0; i < parts.length; i += 2)
    for (const t of parts[i].match(PYTHON_IDENTIFIER_TOKEN) ?? [])
      tokens.add(t);
  const byForm = new Map<string, string[]>();
  for (const t of tokens) {
    const form = t.normalize('NFKC');
    const group = byForm.get(form);
    if (group === undefined) byForm.set(form, [t]);
    else group.push(t);
  }
  const groups = [...byForm].filter(([, group]) => group.length > 1);
  const renamed = new Map<string, string>();
  const name = (id: string): string => renamed.get(id) ?? id;
  if (groups.length === 0) return { body, name };
  const host = new Set<string>(options.hostNames());
  for (const source of options.callerSources ?? [])
    for (const part of pythonSplitStringLiterals(source).filter(
      (_, i) => i % 2 === 0
    ))
      for (const t of part.match(PYTHON_IDENTIFIER_TOKEN) ?? []) host.add(t);
  const usedForms = new Set(byForm.keys());
  for (const [form, group] of groups) {
    const hosted = group.filter((t) => host.has(t));
    if (hosted.length > 1)
      throw new Error(
        `Could not compile to Python: the inputs "${hosted[0]}" and ` +
          `"${hosted[1]}" are the same name for Python ("${form}"), because ` +
          `Python reads each identifier in its NFKC normal form, so the host ` +
          `cannot give them two values. Rename one of them, or map it to ` +
          `another name with \`vars\` (fail closed, D6).`
      );
    const kept = hosted[0] ?? group.find((t) => t === form) ?? group[0];
    for (const t of group) {
      if (t === kept) continue;
      const base = pythonNfkcSafeName(t);
      let written = base;
      for (let k = 1; usedForms.has(written.normalize('NFKC')); k++)
        written = `${base}_${k}`;
      usedForms.add(written.normalize('NFKC'));
      renamed.set(t, written);
    }
  }
  for (let i = 0; i < parts.length; i += 2)
    parts[i] = parts[i].replace(PYTHON_IDENTIFIER_TOKEN, name);
  return { body: parts.join(''), name };
}

/**
 * The names of the Python builtins (Python 3.14, without `True`, `False` and
 * `None`, which are keywords), and the module names that the generated code
 * reads (`np`, `math`, `cmath`, `scipy`). See
 * `pythonAssertNoShadowedBuiltin()`.
 */
const PYTHON_BUILTIN_NAMES: ReadonlySet<string> = new Set(
  (
    'ArithmeticError AssertionError AttributeError BaseException ' +
    'BaseExceptionGroup BlockingIOError BrokenPipeError BufferError ' +
    'BytesWarning ChildProcessError ConnectionAbortedError ConnectionError ' +
    'ConnectionRefusedError ConnectionResetError DeprecationWarning EOFError ' +
    'Ellipsis EncodingWarning EnvironmentError Exception ExceptionGroup ' +
    'FileExistsError FileNotFoundError FloatingPointError FutureWarning ' +
    'GeneratorExit IOError ImportError ImportWarning IndentationError ' +
    'IndexError InterruptedError IsADirectoryError KeyError ' +
    'KeyboardInterrupt LookupError MemoryError ModuleNotFoundError NameError ' +
    'NotADirectoryError NotImplemented NotImplementedError OSError ' +
    'OverflowError PendingDeprecationWarning PermissionError ' +
    'ProcessLookupError PythonFinalizationError RecursionError ' +
    'ReferenceError ResourceWarning RuntimeError RuntimeWarning ' +
    'StopAsyncIteration StopIteration SyntaxError SyntaxWarning SystemError ' +
    'SystemExit TabError TimeoutError TypeError UnboundLocalError ' +
    'UnicodeDecodeError UnicodeEncodeError UnicodeError ' +
    'UnicodeTranslateError UnicodeWarning UserWarning ValueError Warning ' +
    'ZeroDivisionError __import__ abs aiter all anext any ascii bin bool ' +
    'breakpoint bytearray bytes callable chr classmethod compile complex ' +
    'copyright credits delattr dict dir divmod enumerate eval exec exit ' +
    'filter float format frozenset getattr globals hasattr hash help hex id ' +
    'input int isinstance issubclass iter len license list locals map max ' +
    'memoryview min next object oct open ord pow print property quit range ' +
    'repr reversed round set setattr slice sorted staticmethod str sum super ' +
    'tuple type vars zip np math cmath scipy'
  ).split(' ')
);

/**
 * The names that the Python source `code` uses as a builtin or as a module:
 * a name that is called (`len(`), whose attribute is read (`np.`), that is a
 * class argument of `isinstance` (the `str` of `isinstance(x, str)`), or that
 * an `except` clause names. A name after a `.` is an attribute, not a name of
 * the scope, and is not included. The names are in their NFKC form, the form
 * in which Python reads an identifier.
 */
function pythonBuiltinRoleNames(code: string): Set<string> {
  const source = pythonSplitStringLiterals(code)
    .map((part, i) => (i % 2 === 0 ? part : '""'))
    .join('');
  const result = new Set<string>();
  const tokens = [...source.matchAll(PYTHON_IDENTIFIER_TOKEN)];
  // The source between `start` and the parenthesis that closes the one
  // that opens just before `start`.
  const closingParenthesis = (start: number): number => {
    let depth = 1;
    for (let i = start; i < source.length; i++) {
      if ('([{'.includes(source[i])) depth += 1;
      else if (')]}'.includes(source[i]) && --depth === 0) return i;
    }
    return source.length;
  };
  const classRanges: Array<[number, number]> = [];
  for (const m of tokens) {
    const start = m.index!;
    const end = start + m[0].length;
    if (source[start - 1] === '.') continue;
    const next = source.slice(end).match(/^\s*(\S)/)?.[1];
    const inClassRange = classRanges.some(([a, b]) => start >= a && end <= b);
    if (next === '(' || next === '.' || inClassRange)
      result.add(m[0].normalize('NFKC'));
    if (m[0] === 'isinstance' && next === '(') {
      // The class argument: after the first comma at the top level of the
      // call.
      const open = source.indexOf('(', end) + 1;
      const close = closingParenthesis(open);
      let depth = 0;
      for (let i = open; i < close; i++) {
        if ('([{'.includes(source[i])) depth += 1;
        else if (')]}'.includes(source[i])) depth -= 1;
        else if (source[i] === ',' && depth === 0) {
          classRanges.push([i, close]);
          break;
        }
      }
    }
    if (m[0] === 'except') {
      const colon = source.indexOf(':', end);
      classRanges.push([end, colon < 0 ? source.length : colon]);
    }
  }
  return result;
}

/**
 * Fail closed when a name of the user (a parameter, a local, an index, a
 * free symbol, the name of the function) has, in its NFKC form, the name of
 * a Python builtin or of a module that the generated code `code` uses as a
 * builtin or as a module (`pythonBuiltinRoleNames()`).
 *
 * The generated code calls builtins by their names (`len(xs)`,
 * `float('nan')`, `isinstance(b, (bool, np.bool_))`), and these names are
 * valid names for a parameter, a local or a module global. A parameter named
 * `bool` that holds a boolean made `isinstance(bool, (bool, np.bool_))`
 * receive the boolean as its second argument and raise `TypeError`, and a
 * parameter named `len` made each emitted `len(…)` call the argument. The
 * code cannot tell such a builtin from the user's name, so the compilation
 * fails, with a message that asks to rename the symbol. A user name that
 * the code uses only as a value (a list parameter named `str` that is only
 * read) is accepted: the string test of a parameter does not call
 * `isinstance` or `str` by these names (`pythonIsStringTest`).
 */
function pythonAssertNoShadowedBuiltin(
  code: string,
  userNames: Iterable<string>
): void {
  let roles: Set<string> | undefined;
  for (const name of userNames) {
    const form = name.normalize('NFKC');
    if (!PYTHON_BUILTIN_NAMES.has(form) && !form.startsWith('_ce_')) continue;
    roles ??= pythonBuiltinRoleNames(code);
    if (roles.has(form))
      throw new Error(
        `"${name}" is the name of a Python builtin or module ("${form}") that the compiled Python code uses, and cannot be used as a symbol, parameter or function name. Rename it before compiling to Python (fail closed).`
      );
  }
}

/** The `vars` sources of the caller that are spliced into the code. */
function pythonVarsSources(
  vars: Record<string, unknown> | undefined
): string[] {
  return Object.values(vars ?? {}).filter(
    (v): v is string => typeof v === 'string'
  );
}

/**
 * Python mathematical constants, keyed by MathJSON symbol.
 *
 * Referenced both by the target's `var` resolver and — so an assigned value is
 * folded, matching the JavaScript target and `evaluate()` — by `compile()`.
 */
const PYTHON_CONSTANTS: Record<string, string> = {
  __proto__: null as never,
  Pi: 'np.pi',
  ExponentialE: 'np.e',
  ImaginaryUnit: '1j',
  Infinity: 'np.inf',
  NaN: 'np.nan',
  // The exact indeterminate form has only the IEEE `NaN` as a machine value.
  Indeterminate: 'np.nan',
  GoldenRatio: '((1 + np.sqrt(5)) / 2)',
  CatalanConstant: '0.915965594177219015054603514932384110774',
  EulerGamma: '0.5772156649015328606065120900824024310421',
};

/**
 * Python source for the element count of the arithmetic range `a, a + s, …`
 * up to `b`, the same value as `rangeCount()` (`numerics/range-count.ts`,
 * which the interpreter uses). `a`, `b` and `s` must be plain Python names
 * (lambda parameters): each one is read more than once. `s` must not be 0;
 * the caller tests for a zero step first.
 *
 * The quotient `(b − a) / s` is a float, and an end point that lies on the
 * step grid in exact arithmetic can fall one rounding error short of it
 * (`0.3 / 0.1` is `2.9999999999999996`). A tolerance of `1e-12 · (1 + |q|)`
 * absorbs that rounding, so the end point is counted. When `a`, `b` and `s`
 * are all integral the quotient has no rounding error to absorb, and the
 * tolerance is 0.
 *
 * The floor is Python's floor division `// 1`, not `np.floor`, so the
 * emitted code needs no import (the `Loop` lowering relies on that).
 */
function pyRangeCount(a: string, b: string, s: string): string {
  return (
    `(lambda _q: max(0, int((_q + (0 if float(${a}).is_integer() and float(${b}).is_integer() and float(${s}).is_integer() else min(${RANGE_COUNT_TOLERANCE} * (1 + abs(_q)), ${RANGE_COUNT_TOLERANCE_CAP}))) // 1) + 1))` +
    `((${b} - ${a}) / ${s})`
  );
}

/**
 * A `Tabulate`/`Fill` dimension: non-negative and ROUNDED, the interpreter's
 * `toInteger` count contract (`Math.round` semantics, i.e. `floor(x + 0.5)`).
 * The previous emissions used Python's `round()`, which rounds half to EVEN.
 * A compile-time-constant count is normalized now and emitted as a bare
 * literal (`range(3)`); only a runtime count pays the emitted guard.
 */
function pyClampedCount(
  count: Expression,
  compile: (expr: Expression) => string
): string {
  const n = tryGetConstant(count);
  if (n !== undefined) return `${Math.max(0, Math.round(n))}`;
  return `max(0, ${pyRoundedCount(count, compile)})`;
}

/** A count ROUNDED with `Math.round` semantics, `floor(x + 0.5)`. */
function pyRoundedCount(
  count: Expression,
  compile: (expr: Expression) => string
): string {
  return `int(np.floor((${compile(count)}) + 0.5))`;
}

/**
 * The slice for `Take(coll, count)` or `Drop(coll, count)` over the compiled
 * sequence `coll`. The count is ROUNDED, the interpreter's `toInteger` count
 * contract (`Take([…], 2.5)` keeps 3 elements). A negative count counts from
 * the end, and a count past the length is clamped, as in the interpreter:
 *
 * - `Take`: a count `n ≥ 0` is `coll[:n]`, a count `n < 0` is `coll[n:]` (the
 *   last `|n|` elements; Python clamps `|n|` past the length to the whole
 *   sequence). A bare `coll[n:]` is not enough: `coll[0:]` is the whole
 *   sequence, where `Take(xs, 0)` is empty.
 * - `Drop`: a count `n ≥ 0` is `coll[n:]`, a count `n < 0` is `coll[:n]` (all
 *   but the last `|n|` elements; empty when `|n|` is past the length).
 *
 * A compile-time-constant count is normalized now and the slice is chosen at
 * compile time (`xs[:10]`, `xs[-2:]`); a runtime count is evaluated once and
 * the slice is chosen at run time.
 *
 * A count whose magnitude is past every length (`10^20`, `±∞`) is clamped as
 * in the interpreter: `Take` gives the whole sequence and `Drop` gives the
 * empty sequence, for both signs. A constant count of that size is not
 * written as a slice bound (`xs[:Infinity]` and `xs[:1e+21]` are not valid
 * Python). A runtime count is clipped to ±(2^53 − 1) before `int()`, because
 * `int()` of an infinite float raises `OverflowError`; no sequence is that
 * long, so the clip does not change the slice. A `NaN` count has no value in
 * the interpreter (`Take([1, 2, 3], NaN)` stays unevaluated), so the
 * run-time branch gives `None`, the Python value of a list with no value,
 * before `int()` (which raises `ValueError` for `NaN`). A count that cannot
 * be `NaN` (`countMayBeNaN`, `javascript-target.ts`) keeps the emission
 * with no test.
 */
function pyTakeDropSlice(
  op: 'Take' | 'Drop',
  coll: string,
  count: Expression,
  compile: (expr: Expression) => string
): string {
  const n = tryGetConstant(count);
  if (n !== undefined) {
    const k = Math.round(n);
    if (Math.abs(k) > Number.MAX_SAFE_INTEGER)
      return op === 'Take' ? `${coll}[:]` : `${coll}[:0]`;
    if (op === 'Take') return k < 0 ? `${coll}[${k}:]` : `${coll}[:${k}]`;
    return k < 0 ? `${coll}[:${k}]` : `${coll}[${k}:]`;
  }
  const body =
    op === 'Take'
      ? '_l[_n:] if _n < 0 else _l[:_n]'
      : '_l[:_n] if _n < 0 else _l[_n:]';
  const limit = Number.MAX_SAFE_INTEGER;
  if (countMayBeNaN(count))
    return (
      `(lambda _l, _c: None if _c != _c else (lambda _n: ${body})` +
      `(int(np.clip(np.floor(_c + 0.5), -${limit}, ${limit}))))` +
      `(${coll}, ${compile(count)})`
    );
  const rounded = `int(np.clip(np.floor((${compile(count)}) + 0.5), -${limit}, ${limit}))`;
  return `(lambda _l, _n: ${body})(${coll}, ${rounded})`;
}

/**
 * Fail closed when any participant is — or is a collection of — a
 * CHARACTER.
 *
 * A character is one UAX #29 grapheme cluster. Python's stdlib cannot segment
 * a string into them, order two of them by code-point sequence with any
 * guarantee of matching the interpreter's `compare.ts` rule, or re-assemble
 * them, so the whole `character` row of the compile matrix is closed on this
 * target for v1. Python's SCALAR string support is untouched: this asks about
 * `character` evidence only, and `character` and `string` are disjoint types.
 * (`docs/STRING_ROADMAP.md`, decision D13.)
 */
function assertPyNoCharacterOperand(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  const isCharacterish = (a: Expression): boolean => {
    if (isProvablyCharacterOperand(a)) return true;
    // A STRING's own element type IS `character` (it is an indexed collection
    // of its grapheme clusters), so the element walk below would report every
    // string as characterish and close the SCALAR string support this target
    // already ships — string equality and all-string orderings. A string
    // operand is answered by the string gates instead
    // (`assertPyNoStringOperand`, `pyCollArg`), never here.
    if (isProvablyStringOperand(a)) return false;
    const elt = collectionElementType(resolveTypeForCompilation(a.type.type));
    return (
      elt !== undefined &&
      elt !== 'never' &&
      isSubtype(resolveTypeForCompilation(elt), 'character')
    );
  };
  if (args.some(isCharacterish))
    throw new Error(
      `Could not compile \`${kind}\`: a character participant. A character is one ` +
        `UAX #29 grapheme cluster, and this target has no stdlib grapheme ` +
        `segmentation or code-point-sequence ordering to reproduce the ` +
        `interpreter's character semantics. The interpreter evaluates it instead.`
    );
}

/**
 * Fail closed when a COMPARISON participant is an aggregate whose
 * whole-value comparison none of this target's kernels reproduces — a
 * `dictionary`, a `record`, or a `tuple` at participant level
 * (`unfaithfulComparisonAggregate`). Mirrors `assertComparableAggregate` on the
 * JavaScript target; the hazards are the same, with NumPy in place of the JS
 * coercion rules:
 *
 *  - a `dictionary`/`record` has no positional lowering at all, so the scalar
 *    equality form compares two distinct mappings (`==` on dicts is
 *    content equality in Python, which is not the interpreter's whole-value
 *    comparison of a record with nested collections) and the infix `<` of
 *    an ordering compares Python dicts (a `TypeError` too, or worse a
 *    lexicographic answer for another mapping type);
 *  - a `tuple` lowers to a Python tuple, which `np.less` maps over ELEMENT-WISE
 *    (`Less(Tuple(1,2), Tuple(3,4))` → `[True, True]`) and the infix `<`
 *    compares lexicographically, where the interpreter leaves the ordering
 *    symbolic — a point binds atomically.
 *
 * ONE carve-out, applied by the caller and not here: a BINARY `Equal`/
 * `NotEqual` whose EVERY participant is provably tuple-typed skips this gate —
 * see `compilePythonEquality`. The orderings never take it.
 */
function assertPyComparableAggregate(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  for (const a of args) {
    const aggregate = unfaithfulComparisonAggregate(a);
    if (aggregate === null) continue;
    throw new Error(
      `Could not compile \`${kind}\`: a ${aggregate} participant. The interpreter ` +
        `compares it as ONE value, whereas the emitted Python looks inside it: ` +
        `a dictionary or record has no positional lowering, and a tuple is ` +
        `mapped over element-wise by ` +
        `\`np.less\` (\`Equal(Tuple(1, 2), List(1, 2))\` answered \`True\`) ` +
        `where a point binds atomically. The interpreter evaluates it instead.`
    );
  }
}

/**
 * True when a comparison participant carries `tuple` evidence BELOW its own
 * level — a point LIST (`list<tuple<number, number>>`), or a union/nesting
 * reaching one.
 *
 * This is exactly the case `unfaithfulComparisonAggregate` deliberately does
 * NOT report (its tuple search stops at participant level), because the
 * point-list lowering must keep compiling for the EQUALITY family, whose
 * `_ce_eqcoll` compares each point as one value. The ORDERINGS have no such
 * kernel: `np.less([(1,2)], [(3,4)])` looks INSIDE each point and answers
 * `[[True, True]]`, whereas the interpreter broadcasts to an INERT point
 * comparison (`[(1, 2) < (3, 4)]`). So this predicate gates the orderings only
 * — see `compilePythonRelation`.
 *
 * The walk mirrors `unfaithfulComparisonAggregate`'s structure: a union stays at
 * the SAME level (each member is an alternative value of the participant, not an
 * element of it), a collection peels one level, and a `reference` unfolds to its
 * definition behind the repo's standard per-path cycle guard so a recursive
 * alias (`type pts = list<pts> | tuple<number, number>`) terminates.
 */
function hasNestedTupleEvidence(x: Expression): boolean {
  const walk = (
    t: Type,
    top: boolean,
    visited?: ReadonlySet<TypeReference>
  ): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    if (typeof r === 'string') return !top && r === 'tuple';
    if (r.kind === 'tuple') return !top;
    if (r.kind === 'union') return r.types.some((m) => walk(m, top, visited));
    // `leafwardElementType`, not `collectionElementType`: the element type
    // of a `tensor<U>` (and of a `broadcastable<U>`) is `U | tensor<U>`, so
    // the walk met the tensor again and overflowed the stack (`B < 0` for
    // `B: broadcastable<number>`). The cells `U` are the next level.
    const elt = leafwardElementType(r);
    if (elt === undefined) return false;
    return walk(elt, false, visited);
  };
  return walk(x.type.type, true);
}

/**
 * Fail closed when an ORDERING participant is a point list (nested tuple
 * evidence) — see `hasNestedTupleEvidence`. EQUALITY does not take this gate.
 */
function assertPyNoNestedTupleOrdering(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.some(hasNestedTupleEvidence))
    throw new Error(
      `Could not compile \`${kind}\`: a participant whose ELEMENTS are tuples (a ` +
        `point list). \`np.less([(1, 2)], [(3, 4)])\` looks inside each point ` +
        `and answers \`[[True, True]]\`, whereas the interpreter broadcasts to ` +
        `an inert point comparison (\`[(1, 2) < (3, 4)]\`). Only the EQUALITY ` +
        `family admits point lists (whole-value \`_ce_eqcoll\`). The interpreter evaluates it instead.`
    );
}

/**
 * Fail closed when numeric equality has a provably string-valued participant.
 *
 * The scalar lowering is numeric — a raw `==` — which on Python `str` is a
 * content comparison without the conditioning (NFC, well-formed surrogates)
 * the interpreter applies before it compares text, and the earlier tolerance
 * lowering (`abs((a) - (b)) <= tol`) raised `TypeError` on strings, so
 * `Equal("a", "a")` never answered the interpreter's `True` by design.
 * Evidence is tested per PARTICIPANT, not per operand, exactly as on the
 * JavaScript target.
 *
 * Orderings are governed by the narrower `assertPyNoMixedStringOrdering`:
 * all-string orderings agree with interpretation and keep compiling.
 */
function assertPyNoStringOperand(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.some(isProvablyStringComparisonParticipant))
    throw new Error(
      `Could not compile \`${kind}\`: string-valued operands are not supported by ` +
        `this target (the lowering is numeric: a raw \`==\` that skips the ` +
        `interpreter's text conditioning). The interpreter evaluates it instead.`
    );
}

/**
 * Whether binary scalar string equality can use Python `==`. This mirrors the
 * JavaScript target's `isStringScalarEquality` admission.
 *
 * Python's `==` on `str` is exact structural comparison, which is the
 * interpreter's string semantics (`compare.ts`: `a.string === b.string`, no
 * tolerance) — including the numeric-string trap (`"1" == 1.0` is `False` in
 * Python, matching the interpreter). Cross-sort equality is total in the
 * interpreter (`Equal("a", 1)`
 * → `False`) and Python's `==` agrees, so a participant of unknown type opposite
 * a provable string is admitted; a provably numeric one is not, nor is anything
 * that may be a collection or an unfaithful aggregate.
 *
 * The interpreter normalizes strings during boxing, while emitted `==` compares
 * raw caller input; that remains a boundary difference for non-NFC inputs.
 *
 * The collection disqualifier pairs `isPyCollectionOperand` (the SUBTYPE test,
 * which also decides the `_ce_eqcoll` routing below) with the union-aware
 * `couldBeCollectionParticipant`: a general union such as `string |
 * list<string>` is not a subtype of `list`, so the subtype test alone admitted
 * it and would emit scalar `==` where the interpreter broadcasts element-wise.
 * Such a participant declines in `assertPyNoStringOperand`.
 */
function isPyStringScalarEquality(args: ReadonlyArray<Expression>): boolean {
  if (args.length !== 2) return false;
  if (!args.some(isProvablyStringOperand)) return false;
  if (
    args.some((a) => {
      const t = resolveTypeForCompilation(a.type.type);
      return t !== 'never' && isSubtype(t, 'number');
    })
  )
    return false;
  if (args.some((a) => unfaithfulComparisonAggregate(a) !== null)) return false;
  return !args.some(
    (a) => isPyCollectionOperand(a) || couldBeCollectionParticipant(a)
  );
}

/**
 * Fail closed when an ordering (`Less`/`LessEqual`/`Greater`/`GreaterEqual`)
 * mixes string evidence with a participant that is not provably flat text
 * (`isMixedStringOrderingParticipants`, shared with the base
 * compiler's infix diverts).
 *
 * All-string is sound and keeps compiling against
 * interpretation: the scalar infix `"a" < "b"` and `np.less(["a","c"],
 * ["b","b"])` / `np.less(["a","c"], "b")` all agree with the interpreter's
 * code-unit string comparison (`compare.ts`), chains included.
 *
 * A mixed case may coerce numbers to strings or raise depending on shape and
 * NumPy version, so it is gated at compile time on static type evidence.
 *
 * One boundary difference remains: the interpreter orders UTF-16 code units,
 * while Python orders code points. They disagree only when an
 * astral-plane character (≥ U+10000) is ordered against a BMP character in
 * U+E000–U+FFFF. Closing that gap would require a code-unit comparator or
 * declining every string ordering.
 */
function assertPyNoMixedStringOrdering(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (isMixedStringOrderingParticipants(args))
    throw new Error(
      `Could not compile \`${kind}\`: an ordering that mixes a string operand with ` +
        `an operand that is not provably a string. The interpreter leaves such ` +
        `a comparison symbolic (\`Less("a", 1)\` stays inert), whereas NumPy ` +
        `coerces the number to a string and answers a plausible-looking ` +
        `boolean (\`np.less(["a", 10], ["b", 9])\` → \`[True, True]\`). An ` +
        `ordering whose operands are ALL provably strings does compile — the ` +
        `interpreter compares strings the same way. The interpreter evaluates it instead.`
    );
}

/**
 * Operator heads whose Python lowering always produces a NUMBER (a `nan`
 * included) and never the absent value `None`: arithmetic on `None` raises
 * in Python, so the lowering of these heads never returns it — the mirror
 * of `JS_ALWAYS_NUMBER_HEADS` on the JavaScript target. `compilePythonEquality`
 * uses it to decide whether an exact `==` needs the `is not None` guard.
 */
const PY_ALWAYS_NUMBER_HEADS = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Root',
  'Abs',
  'Floor',
  'Ceil',
  'Round',
  'Sign',
  'Mod',
  'Min',
  'Max',
  'Sum',
  'Product',
  'Length',
  'Exp',
  'Ln',
  'Log',
  'Sin',
  'Cos',
  'Tan',
  'Arctan',
  'Arctan2',
  'Arcsin',
  'Arccos',
  'Sinh',
  'Cosh',
  'Tanh',
  'Dot',
  'Norm',
  'Hypot',
  'Gamma',
  'Factorial',
  'Random',
  'RandomInteger',
]);

/**
 * Emit a Python equality test. Compiled `Equal`/`NotEqual` on numeric
 * operands is EXACT (`==`/`!=`), the IEEE 754 comparison, as on the
 * JavaScript target (`compileJSEquality`): `0.1 + 0.2 == 0.3` compiles to
 * `False`, matching infinities are equal, `nan` equals nothing. The
 * interpreter compares within `engine.tolerance`; the compiled lanes do not
 * (user ruling of 2026-09-09, `docs/COMPILATION-MODEL.md`). `NotEqual` is the
 * NEGATION of the `Equal` test, which is `True` on a `nan` operand as the
 * interpreter answers. Chained (N-ary) forms are conjoined pairwise with
 * `and`.
 *
 * Collection operands follow the interpreter's gate (see the `Equal`/`NotEqual`
 * evaluate handlers in `library/relational-operator.ts`), which switches on how
 * many operands are collections:
 *
 * - two or more collection operands: whole-collection equality, a scalar
 *   boolean (`Equal([1,2],[3,4],[5,6])` → `False`). Lowered to the
 *   `_ce_eqcoll` runtime helper, which compares exactly element-wise but
 *   folds to one `bool` — a length/shape mismatch is `False`, not an error.
 *   The scalar form cannot represent this shape.
 * - exactly one collection operand: the interpreter broadcasts, returning a
 *   *list* of booleans (`Equal([1,2],5)` → `["False","False"]`). When that
 *   operand is an ordered list of numbers and every other operand is provably
 *   a number, it is lowered to a list comprehension whose element test is the
 *   same exact `==`/`!=` (`[(_tv1) == (5) for _tv1 in L]`). Every other shape
 *   declines: a nested list or a list of non-numbers (the interpreter
 *   recurses into it), a set (no order), and a companion that may itself be a
 *   collection.
 *
 * An operand whose type does not statically pin it as a collection is treated
 * as scalar (today's emission), as everywhere else on this target.
 */
function compilePythonEquality(
  kind: 'Equal' | 'NotEqual',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (args.length < 2)
    throw new Error(
      `Could not compile \`${kind}\`: expected at least two arguments`
    );
  const collCount = args.filter(isPyCollectionOperand).length;
  // Ahead of every lowering below (the scalar `abs` form, `_ce_eqcoll`, and
  // both chain forms) — see `assertPyComparableAggregate` /
  // `assertPyNoStringOperand`.
  //
  // The one carve-out in the aggregate gate: a BINARY equality whose EVERY
  // participant is provably tuple-typed with provably NUMERIC components keeps
  // the `_ce_eqcoll` lowering it had before the gate existed. That helper's
  // list-vs-list branch is whole-value equality — exactly the interpreter's
  // atomic point comparison, at equal and at unequal arity (a length mismatch
  // is `False`, and so is the interpreter's answer). Only the MIXED shapes were
  // wrong (`Equal(Tuple(1, 2), List(1, 2))` answered `True` against the
  // interpreter's `False`), and those still decline: one non-tuple participant
  // and `every` fails. The numeric-component requirement
  // (`isNumericTupleParticipant`) closes Python's own `==` coercion: a boolean
  // component made `Equal(Tuple(True), Tuple(1))` answer `True` (`True == 1`)
  // where the interpreter answers `False`.
  //
  // Gate ORDER is load-bearing, as on the JavaScript target: the string gate
  // runs AFTER the tuple carve-out, so a tuple with a string component
  // (`Equal(Tuple(1, "a"), Tuple(1, "a"))`) still declines on string evidence.
  //
  // DELIBERATE DIVERGENCE from the JavaScript target, which fails closed on ANY
  // string evidence: ONE class of string equality is admitted here, because on
  // this target it is FAITHFUL rather than wrong. Where every participant is a
  // provably FLAT all-string collection and the emission is therefore
  // `_ce_eqcoll` (not the numeric `abs` form), the helper compares strings with
  // Python's own structural `==` — including the numeric-string trap it was
  // written for (`Equal(["1"], ["1.0"])` → `False`, matching the interpreter,
  // where `np.asarray(..., dtype=float)` would have parsed both to 1.0). That
  // class is pinned by EXECUTED parity in `compile-python-parity.test.ts`
  // (`eq_coll_strings_equal`, `eq_coll_strings_unequal`,
  // `eq_coll_numeric_strings`, `eq_coll_numeric_strings_same`). Everything else
  // with string evidence declines: the scalar form raises `TypeError`, and the
  // admission side is the narrow `isFlatAllStringComparisonParticipant` so a
  // mixed participant (`list<string | number>`) fails closed even though
  // `_ce_eqcoll` was probed faithful on it. A tensor of strings is admitted
  // (ROADMAP CE-219; `eq_coll_strings_nested_equal`).
  const tupleEquality =
    args.length === 2 &&
    args.every(isProvablyTupleParticipant) &&
    args.every(isNumericTupleParticipant);
  if (!tupleEquality) assertPyComparableAggregate(kind, args);
  assertPyNoCharacterOperand(kind, args);
  const stringScalarEquality = isPyStringScalarEquality(args);
  const stringCollectionEquality =
    collCount >= 2 && args.every(isFlatAllStringComparisonParticipant);
  if (!stringScalarEquality && !stringCollectionEquality)
    assertPyNoStringOperand(kind, args);
  if (stringScalarEquality) {
    // Structural content equality — see `isPyStringScalarEquality`.
    const op = kind === 'Equal' ? '==' : '!=';
    return `((${compile(args[0])}) ${op} (${compile(args[1])}))`;
  }
  if (collCount === 1) {
    // The element-wise broadcast of the interpreter, as a list comprehension
    // with the scalar test below as its element test. Only an ordered list of
    // numbers is a source, and every other operand must be a number, so no
    // operand of the element test can be `None` and the test needs no guard.
    // A scalar operand is compiled inside the comprehension, so it is
    // evaluated once per element. That is only safe while this target has no
    // impure lowering (`Random` and friends decline today). CE-281.1.
    const index = args.findIndex(isPyCollectionOperand);
    const isNumberType = (t: Type): boolean => {
      const r = resolveTypeForCompilation(t);
      return r !== 'never' && isSubtype(r, 'number');
    };
    const source = args[index];
    const elt = source.type.matches('list<any>')
      ? collectionElementType(resolveTypeForCompilation(source.type.type))
      : undefined;
    if (
      elt === undefined ||
      !isNumberType(elt) ||
      !args.every((a, i) => i === index || isNumberType(a.type.type))
    )
      throw new Error(
        `Could not compile \`${kind}\`: a single collection operand broadcasts element-wise in the ` +
          `interpreter (a list of booleans, not a boolean). The Python target ` +
          `compiles that shape only for an ordered list of numbers whose other ` +
          `operands are numbers.`
      );
    const v = BaseCompiler.tempVar(target);
    const codes = args.map((a, i) => (i === index ? v : compile(a)));
    const op = kind === 'Equal' ? '==' : '!=';
    const tests: string[] = [];
    for (let i = 0; i < args.length - 1; i++)
      tests.push(`((${codes[i]}) ${op} (${codes[i + 1]}))`);
    const test = tests.length === 1 ? tests[0] : `(${tests.join(' and ')})`;
    return `[${test} for ${v} in ${compile(source)}]`;
  }
  if (collCount >= 2) {
    // Whole-collection equality per adjacent pair, folded with the scalar
    // `and` — every pair is a Python `bool` here, so the chain is well-formed.
    const collPair = (a: Expression, b: Expression): string => {
      const eq = `_ce_eqcoll(${compile(a)}, ${compile(b)})`;
      return kind === 'Equal' ? eq : `(not ${eq})`;
    };
    if (args.length === 2) return collPair(args[0], args[1]);
    const collParts: string[] = [];
    // NOTE: a shared middle operand is compiled TWICE (as pair i's `b` and pair
    // i+1's `a`); that is only safe while this target has no impure lowering
    // (`Random` and friends decline today) — emit a temporary if that changes.
    for (let i = 0; i < args.length - 1; i++)
      collParts.push(collPair(args[i], args[i + 1]));
    return `(${collParts.join(' and ')})`;
  }
  // An absent operand is the Python object `None`: `None == None` is `True`,
  // where the interpreter answers `Missing` (never `True`) for
  // `Equal(Missing, Missing)`. So when BOTH operands may be absent — neither
  // is a numeric literal nor an arithmetic result, which is a number (`nan`
  // at worst) — the left one is tested for `None` in front of the comparison,
  // and an absent pair makes `Equal` false and `NotEqual` true, as the
  // JavaScript target answers for `undefined`. A pair with a literal or an
  // arithmetic result on either side needs no guard: `None == 5` is `False`.
  //
  // A guarded left operand is spliced TWICE (the `None` test and the
  // comparison). That is only safe while this target has no impure lowering
  // (`Random` and friends decline today) — bind it to a temporary if that
  // changes, so that it is evaluated once as the interpreter evaluates it
  // once. The JavaScript target already does that (`multiSpliced`).
  const mayBeNone = (e: Expression): boolean =>
    !isNumber(e) &&
    !(
      isFunction(e) &&
      typeof e.operator === 'string' &&
      PY_ALWAYS_NUMBER_HEADS.has(e.operator)
    );
  const pair = (a: Expression, b: Expression): string => {
    const ca = compile(a);
    const cb = compile(b);
    const guard =
      mayBeNone(a) && mayBeNone(b) ? `(${ca}) is not None and ` : '';
    if (guard === '')
      return `((${ca}) ${kind === 'Equal' ? '==' : '!='} (${cb}))`;
    const equal = `(${guard}(${ca}) == (${cb}))`;
    return kind === 'Equal' ? equal : `(not ${equal})`;
  };
  if (args.length === 2) return pair(args[0], args[1]);
  const parts: string[] = [];
  // A shared middle operand is spliced by the two pairs that straddle it, on
  // top of the two splices inside each pair — the same purity caveat.
  for (let i = 0; i < args.length - 1; i++)
    parts.push(pair(args[i], args[i + 1]));
  return `(${parts.join(' and ')})`;
}

/**
 * Compile a Sum/Product bound. An integer constant is emitted as the literal;
 * anything else is compiled as an expression (symbolic bounds resolve at
 * runtime — a Python `range` needs the value to be an `int`).
 */
function compilePythonBound(
  expr: Expression,
  target: CompileTarget<Expression>,
  /** The bound of a `Sum`/`Product`, floored at run time (see below). A
   * `Loop` over a `Range` reads its bounds as they are: it walks a range
   * with a fractional start bound in floats. */
  floor = false
): string {
  if (isNumber(expr) && !expr.isComplex && Number.isFinite(expr.re))
    return String(Math.floor(expr.re));
  const code = BaseCompiler.compile(expr, target);
  if (!floor) return code;
  // The interpreter walks the integers from the floor of the lower bound to
  // the floor of the upper bound, and a bound that is not typed `integer`
  // can hold a float at run time (`x = 0.7`), which `range` refuses with a
  // `TypeError`. Such a bound is floored with Python's floor division
  // `// 1`, which needs no import, and converted to an `int`. A bound of
  // unknown type (an undeclared `n`) is converted too: it can hold a float
  // at run time as well. Only a bound typed `integer` is kept as written.
  if (expr.type.matches('integer')) return code;
  return `int((${code}) // 1)`;
}

/**
 * Compile a Sum/Product upper bound *plus one* — the engine's upper bound is
 * inclusive, Python `range(a, b)` is exclusive. A literal integer folds the
 * `+ 1` into the number (`range(1, 11)`); a symbolic bound stays `<b> + 1`.
 */
function compilePythonUpperBound(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  if (isNumber(expr) && !expr.isComplex && Number.isFinite(expr.re))
    return String(Math.floor(expr.re) + 1);
  return `${compilePythonBound(expr, target, true)} + 1`;
}

/**
 * Compile a `Sum`/`Product` to a single Python generator expression:
 *   `sum(<body> for i in range(<lo>, <hi> + 1))`
 *   `math.prod(<body> for i in range(<lo>, <hi> + 1))`
 *
 * Being a single expression (not a statement block), it composes everywhere —
 * lambda body, operand position, or a `compileFunction` single-line return.
 * The engine's inclusive upper bound maps to Python's exclusive `range` upper
 * (`<hi> + 1`); an empty/reversed range yields an empty `range`, so builtin
 * `sum` returns 0 and `math.prod` returns 1 — matching the interpreter.
 *
 * Multi-index forms (`Sum(body, Limits(i,…), Limits(j,…), …)`) are emitted as
 * nested generator clauses (`… for i in … for j in …`) — the natural, trivial
 * Python idiom — so every indexing set is honored (cf. the JS target, which
 * nests single-index loops; GPU targets fail closed instead).
 *
 * A body that is a statement or a block of statements has no generator
 * form; it takes the loop form (`compilePythonSumProductLoop`) where the
 * `Sum` is the value of a statement, and declines elsewhere.
 */
function compilePythonSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`Could not compile \`${kind}\`: no body`);
  if (!args[1])
    throw new Error(`Could not compile \`${kind}\`: no indexing set`);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): `sum(generator)`/`math.prod(...)`
  // over arrays would silently produce a wrong value. Reached only for the
  // indexed form (the `!args[1]` guard above rules out the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  const body = args[0];

  // The body is the element of a generator expression, which takes an
  // EXPRESSION. A body that is an assignment or a declaration
  // (`statementBodyHead`), or a block of several statements (a block with a
  // local: `Block(t ≔ t + k; t)`), has no form there: it gave
  // `sum(t = k + t ⏎ return t for k in …)`, a Python syntax error. Such a
  // body takes the loop form (`compilePythonSumProductLoop`) where the `Sum`
  // is the value of a statement; elsewhere the compilation fails.
  const statementError = (): Error =>
    new Error(
      `Could not compile \`${kind}\`: the body is a statement or a block of ` +
        `statements, and the Python lowering of \`${kind}\` is a generator ` +
        `expression, whose element is an expression. The loop form of ` +
        `\`${kind}\` is written only where the \`${kind}\` is the value of a ` +
        `statement (a function body, a statement of a block, or the right ` +
        `side of an assignment there).`
    );
  if (
    statementBodyHead(body) !== undefined ||
    (isFunction(body, 'Block') && body.nops > 1)
  ) {
    const loop = compilePythonSumProductLoop(kind, args, target);
    if (loop !== undefined) return loop;
    throw statementError();
  }

  const { forClauses, idxTarget } = compilePythonSumProductClauses(
    kind,
    args.slice(1),
    target
  );
  const reduce = (gen: string): string =>
    kind === 'Sum' ? `sum(${gen})` : `math.prod(${gen})`;

  // A subexpression of the body that does not read the index has the same
  // value at each iteration. When it is costly (it builds a collection, or
  // it reads a whole collection, as `Max(L)` does), it is computed once,
  // before the generator, and the body reads a temporary
  // (`BaseCompiler.hoistLoopInvariants`). The temporaries are bound with the
  // sequential binding comprehension of this target (`cseBind`):
  //
  //     [sum(i * x + np.sin(_tv1) for i in range(1, 4)) for _tv1 in [np.max(L)]][0]
  //
  // The generator alone evaluates such a subexpression only when the range
  // is not empty, so the temporaries must be computed only then: an error
  // that the subexpression raises (`np.max` of an empty array) must not
  // become an error of an empty sum. This is decided at compile time when
  // both bounds are number literals. When a bound is a symbol, the bounds are
  // compared at run time, which reads each bound once more and has no other
  // effect. Any other bound keeps the generator as it is. Only a sum with
  // one indexing set hoists: with several, an inner range can be empty for
  // some values of an outer index. (CE-339.2)
  const clause = args.length === 2 ? args[1] : undefined;
  if (
    target.cseBind !== undefined &&
    isFunction(clause, 'Limits') &&
    isSymbol(clause.ops[0])
  ) {
    const [, lower, upper] = clause.ops;
    const literal = (e: Expression | undefined): number | undefined =>
      isNumber(e) && !e.isComplex && Number.isFinite(e.re)
        ? Math.floor(e.re)
        : undefined;
    const lo = literal(lower);
    const hi = literal(upper);
    const simple = (e: Expression | undefined): boolean =>
      literal(e) !== undefined || isSymbol(e);
    const decided = lo !== undefined && hi !== undefined;
    if ((decided && lo <= hi) || (!decided && simple(lower) && simple(upper))) {
      const { bindings, result: bodyCode } = BaseCompiler.hoistLoopInvariants(
        body,
        [clause.ops[0].symbol],
        target,
        () => BaseCompiler.compile(body, idxTarget)
      );
      if (bodyCode.includes('\n')) throw statementError();
      const value = reduce(`${bodyCode} ${forClauses.join(' ')}`);
      if (bindings.length > 0) {
        const bound = target.cseBind(
          bindings.map(([name, code]) => [name, code]),
          value
        );
        if (decided) return bound;
        const guard = `${compilePythonBound(lower!, target, true)} <= ${compilePythonBound(upper!, target, true)}`;
        return `(${bound} if ${guard} else ${kind === 'Sum' ? '0' : '1'})`;
      }
      return value;
    }
  }

  const bodyCode = BaseCompiler.compile(body, idxTarget);
  if (bodyCode.includes('\n')) throw statementError();
  return reduce(`${bodyCode} ${forClauses.join(' ')}`);
}

/**
 * The `for` clauses of a Python `Sum`/`Product` (`for k in range(1, 4)`),
 * one for each `Limits` clause, and the target in which the body resolves
 * each index to its Python name. `indexName` gives the Python name of an
 * index; by default it is the name of the index.
 */
function compilePythonSumProductClauses(
  kind: 'Sum' | 'Product',
  clauses: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  indexName?: (index: string) => string
): { forClauses: string[]; idxTarget: CompileTarget<Expression> } {
  const forClauses: string[] = [];
  // `idxTarget` binds every index seen so far, so an inner clause's bounds and
  // the body resolve the outer indices as bare identifiers.
  let idxTarget = target;
  for (const clause of clauses) {
    if (!isFunction(clause, 'Limits'))
      throw new Error(
        `Could not compile \`${kind}\`: expected a Limits indexing set`
      );
    const ops = clause.ops;
    const indexExpr = ops[0];
    if (!isSymbol(indexExpr))
      throw new Error(`Could not compile \`${kind}\`: index must be a symbol`);
    // The index is emitted as a bare Python identifier.
    const name = pythonCheckBindingName(indexExpr.symbol);
    const index = indexName?.(name) ?? name;

    const lowerExpr = ops[1];
    const upperExpr = ops[2];
    // A Python `range` needs finite bounds — reject an unbounded Sum/Product
    // (fail closed) rather than emit `range(1, inf + 1)`.
    if (
      lowerExpr === undefined ||
      upperExpr === undefined ||
      isSymbol(upperExpr, 'Nothing') ||
      upperExpr.isInfinity ||
      lowerExpr.isInfinity
    )
      throw new Error(
        `Could not compile \`${kind}\`: an unbounded range is not supported`
      );
    // The interpreter answers `out-of-range` for a bound above 2^53 − 1, so
    // the compile declines too, although a Python `range` could count there.
    BaseCompiler.assertSafeBigOpBounds(kind, [lowerExpr, upperExpr], idxTarget);

    const lowerCode = compilePythonBound(lowerExpr, idxTarget, true);
    const upperCode = compilePythonUpperBound(upperExpr, idxTarget);
    forClauses.push(`for ${index} in range(${lowerCode}, ${upperCode})`);

    const prev = idxTarget;
    idxTarget = {
      ...prev,
      var: (id) => (id === name ? index : prev.var(id)),
      ...BaseCompiler.withBoundScope(prev, [name]),
    };
  }

  return { forClauses, idxTarget };
}

/**
 * Compile `expr` as the body of a Python function (`compile()`,
 * `compileFunction()`), with a statement sink (`CompileTarget.hoist`) for the
 * statements that a lowering writes ahead of the body's value: the loop of a
 * `Sum` with a statement body (`compilePythonSumProductLoop`). With no such
 * statement, the code is the code of `compileCseRoot`, a single expression
 * or a block of statements that ends with a `return`. With such statements,
 * the code is those statements followed by the value, which gets a `return`
 * when it is a single expression, and not when it is a root assignment.
 */
function compilePythonRoot(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  const sink: NonNullable<CompileTarget<Expression>['hoist']> = {
    stmts: [],
    boundVars: target.boundVars,
    unit: expr,
  };
  const code = BaseCompiler.compileCseRoot(expr, { ...target, hoist: sink });
  if (sink.stmts.length === 0) return code;
  // A root assignment (`s ≔ Sum(…)`) is a statement, as it is with no
  // hoisted statement: `return s = _tv1` does not parse. The convention of
  // the `block` hook detects it: no Python expression starts with a token
  // free of spaces and brackets followed by ` = `.
  const statement =
    code.includes('\n') ||
    /^return\b/.test(code) ||
    /^[^\s()[\]{}'"=,:]+ = /.test(code);
  return [...sink.stmts, statement ? code : `return ${code}`].join('\n');
}

/**
 * A `Sum`/`Product` whose body is a statement or a block of statements, as a
 * Python `for` loop with an accumulator. The loop is written ahead of the
 * statement that holds the `Sum`, in the statement sink of that statement
 * (`CompileTarget.hoist`), and the `Sum` is then the name of the
 * accumulator:
 *
 *     _tv2 = 0
 *     for _tv3 in range(1, 4):
 *         u = u + _tv3
 *         _tv2 += u
 *
 * The body is compiled as the body of a function is, a block with its own
 * locals. The value of an iteration is the value of the last statement of
 * the body; when that statement assigns a name, its value is the assigned
 * name, as for the interpreter. A last statement with no value (a loop), and
 * a `Return`, or a `Break` or `Continue` outside a loop of the body, have no
 * loop form.
 *
 * The loop is written only where the `Sum` is the value of the statement that
 * owns the sink: the statement itself, the right side of an `Assign` or of a
 * `Declare`, or the value of a `Return`. There the value is computed before
 * anything else of the statement runs, so the loop can run first. In any
 * other position (an operand, a conditional arm, the body of a lambda or of a
 * generator), the loop would run before the expression around it, and it
 * would run even when the expression does not evaluate the `Sum`; the answer
 * is then `undefined` and the `Sum` declines.
 *
 * The indices are fresh names: a Python `for` binds its variable in the
 * scope of the whole function, so `for k in …` changed a `k` of the enclosing
 * code, where the generator expression does not. The loop is compiled
 * without common-subexpression elimination: this target binds a temporary
 * around an expression (`cseBind`), and the loop is not in that expression.
 */
function compilePythonSumProductLoop(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string | undefined {
  if (!BaseCompiler.canHoist(target)) return undefined;
  const unit = target.hoist!.unit;
  const isThis = (e: Expression | undefined): boolean =>
    isFunction(e, kind) &&
    e.nops === args.length &&
    e.ops.every((op, i) => op === args[i]);
  const direct =
    isThis(unit) ||
    (isFunction(unit, 'Assign') && isThis(unit.ops[1])) ||
    (isFunction(unit, 'Declare') &&
      isThis(BaseCompiler.declareValueOperand(unit.ops))) ||
    (isFunction(unit, 'Return') && isThis(unit.ops[0]));
  if (!direct) return undefined;

  const body = args[0];
  // A `Return` leaves the function, and a `Break` or a `Continue` outside a
  // loop of the body would act on the loop of the `Sum`: none of them has a
  // meaning that the interpreter gives a `Sum`, so the loop form declines.
  const jumps = (e: Expression, inLoop: boolean): boolean => {
    if (!isFunction(e) || e.operator === 'Function') return false;
    const h = e.operator;
    if (h === 'Return') return true;
    if ((h === 'Break' || h === 'Continue') && !inLoop) return true;
    return e.ops.some((x) => jumps(x, inLoop || h === 'Loop'));
  };
  if (jumps(body, false)) return undefined;

  const acc = BaseCompiler.tempVar(target);
  const plain: CompileTarget<Expression> = { ...target, cse: undefined };
  const { forClauses, idxTarget } = compilePythonSumProductClauses(
    kind,
    args.slice(1),
    plain,
    () => BaseCompiler.tempVar(target)
  );
  // The body is compiled as the body of a function would be: a block with its
  // locals, whose last line returns its value (the `block` hook), or a single
  // line. The body has a statement sink of its own, so a `Sum` with a
  // statement body that is the value of a statement of the body writes its
  // loop inside the loop of this `Sum`, ahead of that statement.
  const sink: NonNullable<CompileTarget<Expression>['hoist']> = {
    stmts: [],
    boundVars: idxTarget.boundVars,
    unit: body,
  };
  // The statements of the body run in the scope of the enclosing function,
  // where a local `t` of the body would write a parameter or a local `t` of
  // the enclosing code. Each local of a block of the body is spelled with a
  // fresh name (`withFreshBlockLocals`), as the indices are.
  const code = BaseCompiler.withFreshBlockLocals(() =>
    BaseCompiler.compile(body, { ...idxTarget, hoist: sink })
  );
  const lines = [...sink.stmts, ...code.split('\n')];
  // The value of an iteration: the value the last line returns, or the
  // name that a last line which is an assignment writes (the convention of
  // the `block` hook: no Python expression starts with a token free of
  // spaces and brackets followed by ` = `), or the single line itself.
  const lastLine = lines.pop()!;
  const returned = /^return (.+)$/.exec(lastLine);
  const assigned = /^([^\s()[\]{}'"=,:]+) = /.exec(lastLine);
  let value: string;
  // A block that ends with a loop returns `None` (the `block` hook), which
  // is not a term.
  if (returned !== null && returned[1] !== 'None') value = returned[1];
  else if (returned === null && assigned !== null) {
    lines.push(lastLine);
    value = assigned[1];
  } else if (lines.length === 0 && !/^(?:if|for|while)\b/.test(lastLine))
    value = lastLine;
  else return undefined;
  lines.push(`${acc} ${kind === 'Sum' ? '+=' : '*='} ${value}`);
  let loop = lines.join('\n');
  for (let i = forClauses.length - 1; i >= 0; i--)
    loop = `${forClauses[i]}:\n${indentPythonStatements(loop)}`;
  BaseCompiler.hoistStatement(
    target,
    `${acc} = ${kind === 'Sum' ? '0' : '1'}`,
    loop
  );
  return acc;
}

/**
 * Indent every line of a (possibly multi-line) statement block by one Python
 * level (4 spaces). An empty block becomes `pass` (a valid non-empty suite).
 */
function indentPythonStatements(code: string): string {
  const body = code.trim() === '' ? 'pass' : code;
  return body
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

/**
 * Compile an expression as Python *statements* — evaluated for effect, no value
 * collected. Mirrors `BaseCompiler.compileLoopBody` (the statement dispatch the
 * JS target uses inside loop bodies) but emits Python:
 *
 * - `Nothing` → '' (a no-op; filtered out by the `Block` join).
 * - `Break` → `break`, `Continue` → `continue`, `Return(v)` → `return <v>`.
 * - `If(cond, then[, else])` → a Python `if`/`else` *statement* (not the
 *   expression-If's `(then) if (cond) else (else)`), recursing into each branch
 *   so nested control flow composes. An empty branch becomes `pass`.
 * - `Block` → its statements newline-joined (no trailing `return` — a loop /
 *   branch body is for effect).
 * - `Loop` → a nested statement loop (via `compilePythonLoop`).
 * - anything else → `BaseCompiler.compile` (an expression evaluated for effect,
 *   or an `Assign`).
 *
 * NOTE: statement-form `If` is reached ONLY here — inside a loop body — exactly
 * as the JS target statement-forms `If` only inside `compileLoopBody`. An `If`
 * anywhere else (e.g. a plain function-body `Block`) stays the expression
 * conditional emitted by the `If` function handler.
 */
function compilePythonStatements(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  if (isSymbol(expr, 'Nothing')) return '';
  if (!isFunction(expr)) return BaseCompiler.compile(expr, target);

  const h = expr.operator;

  if (h === 'Break') return 'break';
  if (h === 'Continue') return 'continue';
  if (h === 'Return')
    return `return ${BaseCompiler.compileOp(expr, 0, target, 0, expr.ops[0])}`;

  // The Python target's comparisons already emit real Python booleans, so —
  // unlike the JS `compileLoopBody`, whose interval-JS targets need a
  // `scalarConditionTarget` to avoid comparison *objects* — the condition is
  // compiled directly. The condition is a value expression (its own bindable
  // region); each branch is a statement list again (design §5.1(c)).
  if (h === 'If') return compilePythonIfStatement(expr.ops, target, expr);

  if (h === 'Block') {
    // As in `BaseCompiler.compileLoopBody`: a statement list is where a
    // destructuring assign (`(a, b) := (b, a + b)`) lowers to temporaries +
    // writes. Its value is discarded here, which is what makes the rewrite
    // safe (see `desugarPatternAssign`).
    // A bare assignment of a name that nothing outside the block binds
    // makes a local of the block, as in `compileBlock`
    // (`withImplicitLocalDeclares`).
    const stmts = BaseCompiler.withImplicitLocalDeclares(
      expr.ops.flatMap(
        (s) => BaseCompiler.desugarPatternAssign(s, target) ?? [s]
      ),
      target,
      expr
    );
    const declared = stmts.flatMap((s) =>
      isFunction(s, 'Declare') && isSymbol(s.ops[0]) ? [s.ops[0].symbol] : []
    );
    // The checks of `compileBlock` on the order of the statements.
    BaseCompiler.assertNoUseBeforeDeclare(stmts);
    BaseCompiler.assertLocalsAssignedBeforeRead(stmts, declared);
    // A read with no assignment on any path before it is refused here
    // (`classifyLocalReads`).
    const readClasses = BaseCompiler.classifyLocalReads(
      stmts,
      declared,
      expr,
      target
    );
    // Python has no block scope: the statements of the block run in the
    // scope of the enclosing function. Two things keep a local of the block
    // apart from the other variables of the function:
    // - Each local is spelled with a fresh name, so that a write of it does
    //   not change a variable of the same name outside the block (a
    //   parameter, a loop index, an input, a local of an enclosing block, or
    //   a name that the code after the block reads). The scopes of the
    //   expression cannot tell all of these: the interpreter changes them
    //   when it evaluates the expression.
    // - Each `Declare` sets the local. A local is a new variable at each run
    //   of the block, so a value from a previous pass of a loop, or from
    //   another block that declares the same name, must not be read.
    //   A `Declare` with a value emits `t = <value>`. The `declare` hook of
    //   this target emits nothing for a `Declare`, so without this
    //   assignment the value was lost and a read of `t` raised `NameError`.
    //   A `Declare` with no value emits `t = _ce_unset('t')`
    //   (`PYTHON_UNSET_HELPER`) when a read can find the local with no
    //   value, for example after an assignment in one branch of an `If`
    //   only (`BaseCompiler.needsStartValue`). The start value makes a use
    //   of the local raise `UnboundLocalError` when that branch did not
    //   run, instead of reading the value of a previous pass of a loop.
    const compileStatements = (
      spelled?: ReadonlyMap<string, string>
    ): string => {
      // `loopBodyTempTarget` binds the locals to their own names, so the
      // fresh names are put on top of it.
      const scoped = BaseCompiler.loopBodyTempTarget(stmts, target);
      const bodyTarget: CompileTarget<Expression> =
        spelled === undefined
          ? scoped
          : { ...scoped, var: (id) => spelled.get(id) ?? scoped.var(id) };
      const declareStatement = (
        s: Expression,
        ops: ReadonlyArray<Expression>,
        name: string,
        i: number
      ): string => {
        const local = bodyTarget.var(name) ?? name;
        const value = BaseCompiler.declareValueOperand(ops);
        if (value === undefined)
          return BaseCompiler.needsStartValue(stmts, i, readClasses)
            ? `${local} = _ce_unset(${JSON.stringify(name)})`
            : '';
        // A value that reads the declared name is refused before this
        // point (`assertLocalsAssignedBeforeRead`), so the value never reads
        // the local that this statement sets. The value may not be an
        // operand of `s` (it can come from a trailing attributes
        // dictionary), and `-1` is the whole-node region sentinel, so such
        // a value compiles plainly.
        const valueIndex = ops.indexOf(value);
        const code =
          valueIndex < 0
            ? BaseCompiler.compile(value, bodyTarget)
            : BaseCompiler.compileOp(s, valueIndex, bodyTarget, 0, value);
        // A value that is not one expression is refused, as for `Assign`.
        BaseCompiler.assertExpressionValue(code, bodyTarget, 'Declare', name);
        return `${local} = ${code}`;
      };
      return BaseCompiler.withCseScope(expr, -1, bodyTarget, () =>
        stmts
          .map((s, i) =>
            isFunction(s, 'Declare') && isSymbol(s.ops[0])
              ? declareStatement(s, s.ops, s.ops[0].symbol, i)
              : compilePythonStatements(s, bodyTarget)
          )
          .filter((s) => s !== '')
          .join('\n')
      );
    };
    if (declared.length === 0) return compileStatements();
    return BaseCompiler.withFreshBlockLocals(() =>
      compileStatements(
        new Map(
          declared.map((name) => [
            name,
            BaseCompiler.freshBlockLocalName(target),
          ])
        )
      )
    );
  }

  // …and the same statement as a bare (unwrapped) loop body.
  if (h === 'Assign' && isFunction(expr.ops[0], 'Tuple')) {
    const stmts = BaseCompiler.desugarPatternAssign(expr, target);
    if (stmts !== null) {
      const bodyTarget = BaseCompiler.loopBodyTempTarget(stmts, target);
      return stmts
        .map((s) => compilePythonStatements(s, bodyTarget))
        .filter((s) => s !== '')
        .join('\n');
    }
  }

  if (h === 'Loop') return compilePythonLoop(expr.ops, target, expr);

  // A bare expression statement is its own bindable region (keyed
  // `(statement, -1)`); every other statement head reaches its value edges
  // from `compileExpr` (an `Assign` RHS, …).
  return BaseCompiler.compileOp(expr, -1, target, 0, expr);
}

/**
 * The Python iterable a loop's `Element` clause runs over, for the source
 * `coll`, compiled in `target` (which already binds the outer clauses'
 * names).
 *
 * A `Range` with INTEGER LITERAL bounds (and an integer literal step, when
 * one is written) becomes a native `range`, with the engine's inclusive
 * upper bound mapped to Python's exclusive one in the step's direction:
 * `Range(1, 10)` → `range(1, 11)`, `Range(10, 1)` → `range(10, 0, -1)`,
 * `Range(1, 10, 3)` → `range(1, 11, 3)`, `Range(10, 1, -3)` →
 * `range(10, 0, -3)`. A two-bound `Range` with a symbolic bound picks its
 * direction at run time from the sign of `hi - lo`, as the interpreter does,
 * and reads its bounds at run time too: the `Range` signature types a bound
 * `number`, so a Python caller may pass a float where the interpreter walks
 * the range from the start bound in unit steps (`Range(2.5, 1)` is 2.5, 1.5)
 * — a native `range` would raise `TypeError`. Any other `Range` — a
 * fractional literal bound, a symbolic step — and any other collection
 * compile as a VALUE, and the loop iterates the materialized list, whose
 * elements then carry the value lowering's float representation. A string,
 * or a collection of characters, declines: its elements are grapheme
 * clusters this target cannot produce.
 */
function pythonElementSource(
  coll: Expression,
  target: CompileTarget<Expression>
): string {
  if (isFunction(coll, 'Range') && coll.nops >= 2 && coll.nops <= 3) {
    const [lo, hi, step] = coll.ops;
    // Safe integers only: a larger magnitude stringifies in exponent form
    // (`1e+21`), which Python reads as a float and `range` refuses.
    const literalInteger = (x: Expression | undefined): number | undefined =>
      x !== undefined &&
      isNumber(x) &&
      !x.isComplex &&
      Number.isSafeInteger(x.re)
        ? x.re
        : undefined;
    const l = literalInteger(lo);
    const h = literalInteger(hi);
    const st = step === undefined ? undefined : literalInteger(step);
    if (
      l !== undefined &&
      h !== undefined &&
      (step === undefined || st !== undefined)
    ) {
      const s = st ?? (h >= l ? 1 : -1);
      if (s === 0) return '[]';
      if (s === 1) return `range(${l}, ${h + 1})`;
      return s > 0
        ? `range(${l}, ${h + 1}, ${s})`
        : `range(${l}, ${h - 1}, ${s})`;
    }
    // A bound is fit for the run-time header below when it is a safe integer
    // literal (`l`/`h` above) or not a literal at all. A number literal that
    // `literalInteger` declines — a fractional bound, a magnitude past 2^53,
    // a complex literal — takes the value lowering below, which walks the
    // range in floats as the interpreter does. `compilePythonBound` FLOORS a
    // literal (it serves `Sum`/`Product`, whose limits are integral), so
    // routing `Range(5.5, 1)` through the run-time header read 5, 4, 3, 2, 1
    // where the interpreter has 5.5, 4.5, 3.5, 2.5, 1.5.
    const runTimeBound = (x: Expression, literal: number | undefined) =>
      literal !== undefined || !isNumber(x);
    if (step === undefined && runTimeBound(lo, l) && runTimeBound(hi, h)) {
      // The direction is the run-time sign of `hi - lo`, as the interpreter
      // reads it; the bounds are bound once so an impure bound is evaluated
      // once. A Python `range` needs `int` arguments, and a symbolic bound
      // may hold a float at run time. An integral value (`5.0`) takes the
      // native `range` as an int — the interpreter has no integral float, so
      // `Range(5.0, 1)` is 5, 4, 3, 2, 1. A fractional value walks the range
      // from the start bound in unit steps, in the direction of the stop
      // bound, as the interpreter does (`Range(2.5, 1)` is 2.5, 1.5;
      // `Range(1, 2.5)` is 1, 2). The count is `pyRangeCount`, which needs
      // no `math` or NumPy import.
      const l = compilePythonBound(lo, target);
      const h = compilePythonBound(hi, target);
      return `(lambda _a, _b: (range(int(_a), int(_b) + 1) if _b >= _a else range(int(_a), int(_b) - 1, -1)) if float(_a).is_integer() and float(_b).is_integer() else (lambda _s: [_a + _s * _i for _i in range(${pyRangeCount('_a', '_b', '_s')})])(1 if _b >= _a else -1))(${l}, ${h})`;
    }
  }
  // A STRING iterates its grapheme clusters in the interpreter, and a
  // collection of characters holds one cluster per element; Python's `for`
  // walks code points and has no stdlib segmentation, so both decline — the
  // rule `pyCollArg` applies to every other collection operand.
  if (coll.type.matches('string'))
    throw new Error(
      'Could not compile `Loop`: cannot iterate a string on this target — its elements are ' +
        'UAX #29 grapheme clusters and Python has no stdlib grapheme ' +
        'segmentation, so the emitted loop would walk code points instead. The interpreter evaluates it.'
    );
  assertPyNoCharacterOperand('Loop', [coll]);
  return BaseCompiler.compile(coll, target);
}

/**
 * The names that the expression compiled from a root boundary (`compile`,
 * `compileToSource`, `compileFunction`, `compileLambda`) reads with no
 * binding (`Expression.unknowns`), by the naming context of that
 * compilation. The naming context is one object shared by every target
 * derived from the root target, so a nested lowering finds the set of its
 * compilation. See `pythonLoopIndexCollides`.
 */
const PYTHON_ROOT_FREE_NAMES = new WeakMap<
  NamingContext,
  ReadonlySet<string>
>();

/**
 * The naming context of a root compilation boundary
 * (`BaseCompiler.newNamingContext`), with the names that the compiled code
 * reads from outside recorded in `PYTHON_ROOT_FREE_NAMES`:
 * - the free names of `expr`;
 * - the free names of the values of the symbols that `expr` reaches, at
 *   any depth: the compiled code reads a symbol with a value as its value,
 *   so with `a` holding `k + 1`, a read of `a` reads the Python
 *   variable `k`;
 * - each identifier of the code in `sources` (the preamble and the code of
 *   each entry of the caller's `vars` mapping), with the Unicode rule of
 *   Python identifiers: with `vars: { y: 'α' }`, a read of `y` reads the
 *   Python variable `α`.
 * A loop over one of these names must not overwrite it.
 */
function pythonRootNaming(
  expr: Expression,
  sources?: ReadonlyArray<string | undefined>,
  extra?: ReadonlyArray<string>
): NamingContext {
  const naming = BaseCompiler.newNamingContext(expr, sources, extra);
  const names = new Set(expr.unknowns);
  const seen = new Set<string>();
  const pending = [...expr.symbols];
  while (pending.length > 0) {
    const s = pending.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    const value = expr.engine._getSymbolValue(s);
    if (value === undefined) continue;
    for (const u of value.unknowns) names.add(u);
    pending.push(...value.symbols);
  }
  for (const source of sources ?? [])
    // A `vars` entry can also be a value that is not code.
    if (typeof source === 'string')
      for (const id of source.match(PYTHON_IDENTIFIER_TOKEN) ?? [])
        names.add(id);
  PYTHON_ROOT_FREE_NAMES.set(naming, names);
  return naming;
}

/**
 * True when the index `name` of a `Loop` clause, emitted as the variable of
 * a Python `for` statement, would overwrite another variable of the
 * compiled function.
 *
 * Python has no block scope: a `for` statement assigns its variable in the
 * scope of the whole function, and the variable keeps the last value after
 * the loop. In the interpreter the index of a `Loop` is a variable of the
 * loop only. So an index with the name of a variable bound outside the loop
 * (an index of an enclosing loop, a local of an enclosing block, a
 * parameter, a `vars` entry: `target.var` resolves the name) changed that
 * variable: with an inner loop over `i` in a loop over `i`, the outer body
 * read the last value of the inner index. An index with the name of a free
 * symbol of the compiled expression made that name a local of the function,
 * so a read of the module global before the loop raised `UnboundLocalError`
 * and a read after the loop gave the last index. Such an index is given a
 * fresh name (`pythonElementHeaders`). A comprehension has its own scope
 * and keeps the name.
 */
function pythonLoopIndexCollides(
  name: string,
  target: CompileTarget<Expression>
): boolean {
  if (target.var(name) !== undefined) return true;
  const naming = target.naming;
  return (
    naming !== undefined &&
    PYTHON_ROOT_FREE_NAMES.get(naming)?.has(name) === true
  );
}

/**
 * The nested `for` headers of a loop's `Element` clauses, outermost first,
 * and the target that binds every clause's names for the body. Each clause's
 * source compiles under the names of the clauses before it, so an inner
 * source may mention an outer binder. The binders are the ones
 * `BaseCompiler.elementClauseBinders` validated — a name, or a destructuring
 * tuple pattern spelled `(a, _, (b, c))`.
 */
function pythonElementHeaders(
  elements: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  freshIndices = false
): {
  headers: string[];
  bodyTarget: CompileTarget<Expression>;
  /** The fresh names given to indices (`pythonLoopIndexCollides`). */
  renamed: string[];
} {
  const binders = BaseCompiler.elementClauseBinders(elements, target);
  // A Python comprehension is ONE scope: every `for` target is a local of the
  // whole comprehension, so a guard that names a binder of a LATER clause
  // would read that local before its `for` assigns it (an unbound local),
  // where the interpreter reads the ENCLOSING variable of that name. The
  // JavaScript loops nest block scopes and read the parameter; Python has no
  // spelling for it here, so the shape declines.
  binders.forEach((b, i) => {
    const guard = b.clause.ops[2];
    if (guard === undefined || isSymbol(guard, 'Nothing')) return;
    for (let j = i + 1; j < binders.length; j++)
      for (const name of binders[j].names)
        if (guard.has(name))
          throw new Error(
            `Could not compile \`Comprehension\`: the guard of clause ${i + 1} names \`${name}\`, ` +
              `which a later clause binds; in a Python comprehension that name is the later ` +
              `loop's variable, unassigned at that point, where the interpreter reads the enclosing one. ` +
              `The interpreter evaluates it instead.`
          );
  });
  const headers: string[] = [];
  const renamed: string[] = [];
  let scope = target;
  for (const b of binders) {
    const source = pythonElementSource(b.clause.ops[1], scope);
    // The clause's names are emitted as bare Python identifiers.
    for (const name of b.names) pythonCheckBindingName(name);
    const prev = scope;
    const bound = new Set(b.names);
    // The spelling of each name of the clause: the name, or a fresh name
    // for the index of a `for` statement that would overwrite another
    // variable of the function (`pythonLoopIndexCollides`).
    const spelled = new Map<string, string>();
    if (freshIndices)
      for (const name of b.names)
        if (pythonLoopIndexCollides(name, prev)) {
          const fresh = BaseCompiler.tempVar(prev);
          spelled.set(name, fresh);
          renamed.push(fresh);
        }
    scope = {
      ...prev,
      var: (id) => (bound.has(id) ? (spelled.get(id) ?? id) : prev.var(id)),
      ...BaseCompiler.withBoundScope(prev, b.names),
    };
    // A pattern is names, `_tvN` placeholders, parentheses and commas.
    const pattern =
      spelled.size === 0
        ? b.pyPattern
        : b.pyPattern.replace(/[^\s(),]+/g, (t) => spelled.get(t) ?? t);
    // A GUARDED clause, `Element(x, xs, cond)`, is the `if` of a Python
    // comprehension clause, `for x in xs if cond`. The guard reads the
    // clause's own binding, so it compiles under the scope that binds it.
    // The test is the DECIDED-TRUE test of the three-valued condition
    // lowering, as the interpreter keeps an element only when the guard
    // evaluates to exactly `True` (`compileGuardTest`). The statement-form
    // loop cannot carry this header (`compilePythonLoop` declines a guarded
    // clause before coming here).
    const guard = b.clause.ops[2];
    const guardCode =
      guard !== undefined && !isSymbol(guard, 'Nothing')
        ? ` if ${BaseCompiler.compileGuardTest(guard, scope, PYTHON_CONDITION_DIALECT)}`
        : '';
    headers.push(`for ${pattern} in ${source}${guardCode}:`);
  }
  return { headers, bodyTarget: scope, renamed };
}

/** Whether an `Element` clause carries a guard (a third operand): the
 * `for x in xs if cond` of a comprehension. */
function hasGuardedClause(elements: ReadonlyArray<Expression>): boolean {
  return elements.some(
    (e) =>
      isFunction(e, 'Element') && e.nops >= 3 && !isSymbol(e.ops[2], 'Nothing')
  );
}

/**
 * Compile a `Loop` — imperative control flow, for effect (evaluates to
 * `Nothing`). Emits a Python statement loop (not a JS IIFE):
 *
 * - `Loop(body)` → `while True:` with the body indented beneath it.
 * - `Loop(body, Element(i, coll), …)` → one `for` header per `Element`
 *   clause, each nested one level under the previous, with the body
 *   indented beneath the innermost (`pythonElementHeaders`; a `Range`
 *   source with integer literal bounds is a native `range`, see
 *   `pythonElementSource`).
 *
 * The body is compiled as *statements* — a `Block` body is joined by newlines
 * WITHOUT the block hook's trailing `return` (a loop body has no return value),
 * then indented one level under the loop header.
 */
function compilePythonLoop(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** The `Loop` node, when the caller has it: its body is a statement-list
   * region (design §5.1(c)). */
  node?: Expression
): string {
  if (!args[0]) throw new Error('Could not compile `Loop`: no body');
  const body = args[0];
  const elements = args.slice(1);

  let headers: string[];
  let bodyTarget = target;
  let renamed: string[] = [];
  if (elements.length === 0) headers = ['while True:'];
  else {
    // A `for` statement header has no `if` clause in Python; the guard of a
    // comprehension clause has no place here.
    if (hasGuardedClause(elements))
      throw new Error(
        'Could not compile `Loop`: a guarded `Element` clause has no Python statement form. The interpreter evaluates it instead.'
      );
    BaseCompiler.assertBreakLeavesWholeLoop(elements, body);
    // A `for` statement binds its index in the scope of the whole function
    // (`pythonLoopIndexCollides`), unlike a comprehension.
    ({ headers, bodyTarget, renamed } = pythonElementHeaders(
      elements,
      target,
      true
    ));
  }

  // Compile the body as statements — statement-form control flow
  // (`If`/`Break`/`Continue`/`Return`), a flattened `Block`, and nested `Loop`s
  // all compose, for effect (no trailing `return`). An index with a fresh
  // name stays a variable that the body can assign, as with its own name.
  let code = indentPythonStatements(
    BaseCompiler.withWritableLoopIndices(renamed, () =>
      BaseCompiler.withCseScope(node, 0, bodyTarget, () =>
        compilePythonStatements(body, bodyTarget)
      )
    )
  );
  for (let i = headers.length - 1; i >= 0; i--)
    code =
      i === headers.length - 1
        ? `${headers[i]}\n${code}`
        : `${headers[i]}\n${indentPythonStatements(code)}`;
  return code;
}

/**
 * Compile a `Comprehension` — the value-producing loop — to a Python list
 * comprehension: `Comprehension(body, Element(x, c1), Element(y, c2))` →
 * `[<body> for x in <c1> for y in <c2>]`, the clauses in source order so an
 * inner source may mention an outer binder, exactly as the interpreter
 * nests them.
 *
 * The body must be a single EXPRESSION: a list comprehension has no
 * statement slot, so a body that is a `Block` of several statements fails
 * closed (a one-statement `Block` unwraps, as a lambda body does). Without
 * this lowering the shared `Comprehension` emission produced the JavaScript
 * IIFE and reported success — wrong code, not a decline.
 */
function compilePythonComprehension(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node?: Expression
): string {
  if (!args[0]) throw new Error('Could not compile `Comprehension`: no body');
  if (!args[1])
    throw new Error('Could not compile `Comprehension`: no indexing set');
  let body = args[0];
  if (isFunction(body, 'Block')) {
    if (body.nops !== 1)
      throw new Error(
        'Could not compile `Comprehension`: a multi-statement body has no Python list-comprehension form.'
      );
    body = body.ops[0];
  }
  // The slot takes an EXPRESSION: an assignment, a declaration, `break`,
  // `continue`, `return`, a loop, or a statement-form `If` has no place in
  // it (`pythonArmIsStatement` is the classifier the statement lowerings
  // share; a declaration is caught by the expression-body assertion).
  if (pythonArmIsStatement(body))
    throw new Error(
      'Could not compile `Comprehension`: the body is a statement, which has no place in a Python list comprehension.'
    );
  pythonAssertExpressionBody('Comprehension', body);
  const { headers, bodyTarget } = pythonElementHeaders(args.slice(1), target);
  const bodyCode = BaseCompiler.withCseScope(node, 0, bodyTarget, () =>
    BaseCompiler.compile(body, bodyTarget)
  );
  // A header reads `for x in src:`; the comprehension clause drops the colon.
  const clauses = headers.map((h) => h.slice(0, -1)).join(' ');
  return `[${bodyCode} ${clauses}]`;
}

/**
 * Python operator mappings
 *
 * Python uses similar operators to JavaScript, but with ** for exponentiation.
 * NumPy arrays support element-wise operations with these operators.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.

/**
 * Compile the search of `Contains`, `IndexOf` or `Element` for the searched
 * value `needle`. The search is STRUCTURAL, as in the interpreter: a marker is
 * found where the same marker sits, `IndexOf([1, NaN], NaN)` is `2` (user
 * decision 2026-09-26, `SEARCHED_VALUE_POLICY` in `library/collections.ts`).
 * The element test is `_ce_same` (see `PYTHON_INDEXOF_HELPER`), whose float
 * leaf reads `nan` as the same as `nan`; Python's own `in` finds a `nan` only
 * by object identity, so the lowerings never use it. `search(v)` emits the
 * search for the compiled value `v`.
 *
 * This target fails closed on a needle that may be the OBJECT-domain absence,
 * `Missing` or `Undefined`: a written absence symbol lowers to `math.nan` here
 * (`docs/ERROR-MODEL.md` §3, since numpy raises on `None`), so the compiled
 * search would find it where a `NaN` cell sits, while the interpreter keeps
 * the two markers apart (`IndexOf([1, NaN], Missing)` is `0`). The JavaScript
 * target has an object null, `undefined`, for the written symbol and refuses
 * only a COMPUTED absence (`compileSearchedValue`).
 *
 * The same spelling makes the COLLECTION side ambiguous: a cell that is
 * `Missing` or `Undefined` is `nan` here too, so a numeric needle that is
 * `NaN` at run time would be found where an absent cell sits
 * (`IndexOf([1, Missing], NaN)` is `0` in the interpreter). A needle that may
 * be a number is therefore refused when the collection's element type has a
 * `missing` arm.
 */
function pySearchedValue(
  operator: string,
  needle: Expression,
  collection: Expression | undefined,
  compile: (expr: Expression) => string,
  search: (v: string) => string
): string {
  // A needle whose present arms are not numeric (`character | missing`) is
  // never confused with a `nan` element and compiles, as on JavaScript.
  const t = resolveTypeForCompilation(needle.type.type);
  if (
    couldMatch(stripMissingFromType(t), 'number') &&
    collectionMayHoldAbsentCell(collection)
  )
    throw new Error(
      `Could not compile \`${operator}\`: an element of the collection may be absent, which this ` +
        `target spells as \`nan\`, and the searched value may be a number, which could be \`NaN\`; ` +
        `the interpreter keeps the two apart. The interpreter evaluates it instead.`
    );
  if (
    isSymbol(needle, 'Missing') ||
    isSymbol(needle, 'Undefined') ||
    (typeContainsMissing(t) && couldMatch(stripMissingFromType(t), 'number'))
  )
    throw new Error(
      `Could not compile \`${operator}\`: the searched value may be the absent value \`Missing\`, ` +
        `which this target spells as \`nan\` and could not tell from a \`NaN\` element. ` +
        `The interpreter evaluates it instead.`
    );
  return search(compile(needle));
}
const PYTHON_OPERATORS: CompiledOperators = {
  __proto__: null as never,
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11], // Subtract canonicalizes to Add+Negate; kept as fallback
  Multiply: ['*', 12],
  Divide: ['/', 13],
  // Python exponentiation. A literal `0^0` is folded to NaN at canonicalization
  // (matching the interpreter) before it reaches here, and `x^0` folds to 1
  // (as the interpreter simplifies). The residual divergence is a *runtime*
  // dynamic `0**0` (both operands 0 only at run time): Python yields 1, the
  // interpreter NaN. Aligning that would require routing every power through a
  // helper — disproportionate churn (breaks `**` right-associativity) for a
  // rare edge — so it is left as a documented divergence. The JS target aligns
  // it via `_SYS.pow`. See finding CO-P2-24.
  Power: ['**', 15],
  // Equal / NotEqual are NOT operators: they need the string, aggregate and
  // collection gates and the `None` guard of `compilePythonEquality`, which
  // emits the exact `==`/`!=` for the scalar pairs that pass them.
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['and', 4],
  Or: ['or', 3],
  Not: ['not', 14], // Unary operator
};

/**
 * Compile an operand whose code IS the whole lowering of its parent head — an
 * IDENTITY passthrough, such as `Identity(x)` or a one-operand `Max`.
 *
 * The shared compiler splices the emission of a function head into its parent
 * WITHOUT parentheses of its own, because a head normally emits a CALL, and a
 * call binds tighter than every Python operator. An identity lowering breaks
 * that assumption: it hands the parent the OPERAND's code, so when the operand
 * is itself an infix or prefix expression the parent's operator regroups it.
 * `2·Identity(x + 1)` emitted `2 * x + 1`, which is `2x + 1`, and
 * `Identity(-x)^2` would emit `-x ** 2`, which is `-(x²)`.
 *
 * The operand is therefore parenthesized whenever its head has an operator
 * spelling on this target, and also whenever its code opens with a sign. A
 * NEGATIVE number literal is not a primary in Python: `**` binds tighter than
 * unary minus, so an unparenthesized `-2` under a power emits `-2 ** 2`, which
 * is −4. A symbol, a non-negative number literal or a call is a primary
 * already and stays bare, so those emissions are unchanged.
 */
function pyIdentityPassthrough(
  x: Expression,
  code: string,
  target: CompileTarget<Expression> | undefined
): string {
  const trimmed = code.trim();
  if (trimmed.startsWith('-') || trimmed.startsWith('+')) return `(${code})`;
  if (!isFunction(x)) return code;
  const op = target?.operators?.(x.operator) ?? PYTHON_OPERATORS[x.operator];
  return op === undefined ? code : `(${code})`;
}

/** Whether an operand compiles to a NumPy array at run time — a concrete
 * collection or a statically list/collection-typed value. Mirrors the JS
 * target's `isIndexedCollectionOperand`. */
function isPyCollectionOperand(e: Expression): boolean {
  const t = e.type;
  // A STRING matches `indexed_collection` in the type lattice (its elements
  // are its grapheme clusters) but is not a NumPy array, and Python has no
  // stdlib grapheme segmentation — `len()` counts code points — so string
  // collection operations do not compile to Python at all and must FAIL
  // CLOSED here rather than lower as if the string were an array.
  if (t.matches('string')) return false;
  // Shape question — asked against the explicit family tops (since 0.160.0
  // the bare names admit the same values); a `list<any>` operand is still a
  // NumPy array.
  return t.matches('list<any>') || t.matches('indexed_collection<any>');
}

/**
 * The statically-known tensor RANK of an operand, or `undefined` when its type
 * does not pin one down.
 *
 * `.rank` is the engine's static rank — the length of the `dimensions` read off
 * the type (`matrix` → 2, `vector<3>` → 1) — but it answers `0` both for a
 * scalar and for a dimension-less list. A list type whose element types nest
 * down to a number type through lists that each carry `dimensions` or hold a
 * list type still has a provable rank: `list<matrix<real>>` is rank 3 (one
 * axis for the outer list, two for the `matrix` dimensions) and
 * `list<vector<real>>` is rank 2. These cases are recovered here.
 *
 * A plain list is read by its elements: `list<number>` is rank 1 (its
 * elements are numbers, so there is no deeper level), `list<list<number>>`
 * is rank 2. A tensor of unknown rank (the `tensor` spelling, whose
 * `dimensions` is `null`) has NO statically known rank: a matrix and every
 * higher tensor conform to it, and the caller tests the rank when the code
 * runs.
 */
function pyStaticRank(e: Expression): number | undefined {
  const rank = e.rank;
  if (rank > 0) return rank;
  return pyListTypeRank(e.type.type);
}

/**
 * The number of axes of a list type whose nested element types end in a
 * NUMBER type, or `undefined` when the type does not fix it. A list with a
 * dimension list contributes one axis per dimension. A plain list
 * contributes one axis: a plain list of numbers is rank 1, a plain list of
 * lists one more than its rows. A tensor of unknown rank (`dimensions` is
 * `null`) fixes no rank, so the answer is `undefined`.
 */
function pyListTypeRank(type: Type): number | undefined {
  // A type reference answers layout questions as its definition (§4.6 step 1).
  const t = resolveTypeForCompilation(type);
  if (typeof t !== 'object' || t.kind !== 'list') return undefined;
  if (t.dimensions === null) return undefined;
  const own = t.dimensions?.length ?? 1;
  if (isSubtype(t.elements, 'number')) return own;
  const inner = pyListTypeRank(t.elements);
  return inner === undefined ? undefined : own + inner;
}

/**
 * Fail closed when a `Norm` whose order is NOT the entry-wise Frobenius
 * one is taken over an operand of statically known rank 3 or more.
 *
 * Above rank 2 the interpreter (`library/linear-algebra.ts`) computes only the
 * Frobenius norm — the entry-wise `√(Σ|xᵢ|²)` over the flattened cells, which
 * is the order 2, the default and the `"Frobenius"` spelling. Every other
 * order is an OPERATOR norm, defined through a matrix acting on vectors, and
 * the handler stays symbolic for it. NumPy has no reading for those either:
 * `np.linalg.norm` raises `ValueError: Improper number of dimensions to norm`
 * for any explicit `ord` on an input with more than two axes. Emitting the
 * call would report `success: true` for code that raises when it runs.
 *
 * A rank that is not statically known is not this guard's business — the
 * callers decide that case for themselves.
 */
function assertPythonNormRankAtMost2(rank: number | undefined): void {
  if (rank === undefined || rank <= 2) return;
  throw new Error(
    `Could not compile \`Norm\`: above rank 2 the interpreter computes only the Frobenius norm ` +
      `(the order 2, which is also the default), and \`np.linalg.norm\` ` +
      `raises for any explicit order on an input with more than two axes.`
  );
}

/**
 * True when every entry of `expr`, through every level of nesting, is typed
 * as a finite number (`finite_number`: `integer`, `real`, `complex`, and
 * their subtypes). Such an operand cannot hold a NaN or an infinite entry, so
 * its norm needs no guard (`pyNorm`). A declared type is a promise the host
 * makes, and the compiled code relies on it.
 */
function pyFiniteEntries(expr: Expression): boolean {
  let t: Type | undefined = expr.type.type;
  for (let depth = 0; t !== undefined && depth < 16; depth++) {
    if (isSubtype(t, 'finite_number')) return true;
    // Toward the entries (`leafwardElementType`): the element of a tensor
    // of unknown rank is `U | tensor<U>`, a union this walk could not
    // descend, where its cells `U` are the entries.
    t = leafwardElementType(t);
  }
  return false;
}

/**
 * What the entries of a `Norm` operand are typed as: `'integer'` when every
 * entry, through every level of nesting, is typed as an integer,
 * `'finite'` when every entry is typed as a finite number (see
 * `pyFiniteEntries`), and `'any'` otherwise.
 */
type PyNormEntries = 'integer' | 'finite' | 'any';

function pyNormEntries(expr: Expression): PyNormEntries {
  let t: Type | undefined = expr.type.type;
  for (let depth = 0; t !== undefined && depth < 16; depth++) {
    if (isSubtype(t, 'integer')) return 'integer';
    t = leafwardElementType(t);
  }
  return pyFiniteEntries(expr) ? 'finite' : 'any';
}

/**
 * The Python source of `np.linalg.norm(x, ord)` (no `ord` argument when `ord`
 * is `undefined`) with the interpreter's rule for non-finite entries. An
 * infinite entry (a complex entry with an infinite part included) makes every
 * norm `+∞`, a NaN entry included: `|±∞|` dominates every sum and every
 * maximum. Otherwise a NaN entry makes the norm NaN. numpy does not follow
 * this rule: `np.linalg.norm([inf, nan])` is `nan`, and the spectral norm
 * (`ord=2` on a matrix) raises `LinAlgError` for a matrix with a NaN or
 * infinite entry, because its SVD does not converge. The JavaScript target
 * applies the same rule in its `norm` helper.
 *
 * The test applies only to an array of floating-point or complex entries
 * (numpy dtype kinds `f` and `c`): other arrays cannot hold a NaN or an
 * infinity, and `np.isinf` raises for an array of objects. The source is one
 * expression and needs no module-level helper, so `compileLambda` accepts it.
 * Call it only after the order is accepted: the guard answers `+∞` for any
 * order.
 *
 * When `entries` is not `'any'` (the operand's entries are typed as finite
 * numbers, see `pyNormEntries`), no entry can be NaN or infinite and the
 * guard is left out.
 *
 * The default order, the order 2, `'fro'` and a run-time order `_p` compute
 * the squares (or other powers) of the entries: numpy computes
 * `√(Σ|xᵢ|²)` with no scaling, so `np.linalg.norm([3e200, 4e200])` is `inf`
 * and `np.linalg.norm([3e-200, 4e-200])` is `0`, where the interpreter and
 * the JavaScript target answer `5e200` and `5e-200`. For these orders, when
 * the largest absolute entry `_m` is below `2⁻⁵⁰⁰` or above `2⁵⁰⁰`, the
 * emitted code computes the norm of the array multiplied by `2⁶⁰⁰` or
 * `2⁻⁶⁰⁰`, and multiplies the result by the inverse factor. Each norm is
 * absolutely homogeneous (`‖s·x‖ = |s|·‖x‖`), and a multiplication by a
 * power of 2 is exact for a normal result, so this is the norm of `x` (an
 * entry that the factor `2⁻⁶⁰⁰` makes subnormal or 0 is less than
 * `_m·2⁻⁹²²`, which does not change the norm). The squares of the largest
 * scaled entries are normal doubles. When `_m` is in
 * `[2⁻⁵⁰⁰, 2⁵⁰⁰]`, the source is the unscaled call, as before. An operand
 * whose entries are typed as integers is not scaled: its entries cannot be
 * small, and numpy computes the norm of an integer array in floating point,
 * where the square of an `int64` value cannot overflow. The orders 1 and
 * `np.inf` form no power. A literal order other than 1, 2 and `np.inf` (a
 * p-norm) is not scaled: its powers `|xᵢ|ᵖ` can also overflow or underflow
 * for entries in `[2⁻⁵⁰⁰, 2⁵⁰⁰]` (for example `|xᵢ|³` for `|xᵢ|` above
 * about `5.6·10¹⁰²`), so this scaling does not correct it.
 */
function pyNorm(
  x: string,
  ord: string | undefined,
  entries: PyNormEntries
): string {
  const o = ord === undefined ? '' : `, ${ord}`;
  const scaled =
    entries !== 'integer' &&
    (ord === undefined || ord === '2' || ord === "'fro'" || ord === '_p');
  const call = scaled
    ? `(lambda _m: np.linalg.norm(_a * 2.0**600${o}) * 2.0**-600 if 0 < _m < 2.0**-500 ` +
      `else np.linalg.norm(_a * 2.0**-600${o}) * 2.0**600 if _m > 2.0**500 ` +
      `else np.linalg.norm(_a${o}))(np.max(np.abs(_a), initial=0))`
    : `np.linalg.norm(${entries === 'any' ? '_a' : x}${o})`;
  if (entries !== 'any')
    return scaled ? `(lambda _a: ${call})(np.asarray(${x}))` : call;
  const float = `_a.dtype.kind in 'fc'`;
  return (
    `(lambda _a: float('inf') if ${float} and np.isinf(_a).any() else ` +
    `(float('nan') if ${float} and np.isnan(_a).any() else ${call}))` +
    `(np.asarray(${x}))`
  );
}

/**
 * The Python source of `Norm(x, p)` for a LITERAL positive order `p` over an
 * operand whose rank is not statically known: a lambda that tests the rank
 * with `np.ndim` when it runs, and answers the value the interpreter
 * (`library/linear-algebra.ts`) computes for that rank, or NaN where the
 * interpreter leaves the application unevaluated.
 *
 * - Rank 0 (a scalar): its absolute value, for every positive order.
 *   `np.linalg.norm` raises for a 0-d input with an explicit order, so the
 *   emitted code calls `np.abs` instead.
 * - Rank 1 (a vector): the p-norm, which `np.linalg.norm(v, p)` computes for
 *   every positive order (and the maximum absolute entry for `np.inf`).
 * - Rank 2 (a matrix): the interpreter computes only the orders 1 (maximum
 *   absolute column sum), 2 (the spectral norm, the largest singular value)
 *   and +Infinity (maximum absolute row sum). `np.linalg.norm(m, p)` computes
 *   the same three norms for those orders, and raises for the others.
 * - Rank 3 or more: the interpreter computes only the order 2, as the
 *   entry-wise Frobenius norm over the flattened cells. That is
 *   `np.linalg.norm(t)` with NO `ord` argument, which flattens the input;
 *   `np.linalg.norm(t, p)` raises for every explicit order above rank 2.
 *
 * `orders` names the ranks at which the order `p` has a value: `'vector'`
 * for an order that only a vector computes (every positive order other than
 * 1, 2 and +Infinity), `'matrix'` for 1 and +Infinity (a vector or a
 * matrix), and `'two'` for the order 2 (every rank). For `'matrix'` and
 * `'two'`, rank 1 and rank 2 share the one `np.linalg.norm(_x, p)` call.
 */
function pythonNormRankTest(
  x: string,
  p: string,
  orders: 'vector' | 'matrix' | 'two',
  entries: PyNormEntries
): string {
  const nan = "float('nan')";
  const body =
    orders === 'vector'
      ? `${pyNorm('_x', p, entries)} if np.ndim(_x) == 1 else ${nan}`
      : `${pyNorm('_x', p, entries)} if np.ndim(_x) <= 2 else ${orders === 'two' ? pyNorm('_x', undefined, entries) : nan}`;
  return `(lambda _x: np.abs(_x) if np.ndim(_x) == 0 else ${body})(${x})`;
}

/**
 * The Python source of `Norm(x, p)` for an order `p` known only at RUN time,
 * over an operand whose rank is not statically known. The emitted lambda
 * tests the rank with `np.ndim` and then the order, and answers what the
 * interpreter (`library/linear-algebra.ts`) computes, or NaN where the
 * interpreter has no value:
 *
 * - rank 0: the absolute value when `p > 0` (`np.linalg.norm` raises for a
 *   0-d input with an explicit order);
 * - rank 1: `np.linalg.norm(v, p)` when `p > 0` (numpy also answers values for
 *   `p = 0` and negative orders, which the interpreter refuses);
 * - rank 2: `np.linalg.norm(m, p)` when `p` is 1, 2 (the spectral norm) or
 *   `np.inf` — numpy raises for any other positive order on a matrix;
 * - rank 3 or more: the entry-wise Frobenius norm `np.linalg.norm(t)` (no
 *   `ord`, so numpy flattens the input) when `p == 2`; numpy raises for any
 *   explicit order on an input with more than two axes.
 *
 * `pType` is the type of the order; see `pythonNormRuntimeOrder` for the
 * string orders.
 */
function pythonNormRuntimeRankTest(
  x: string,
  p: string,
  pType: Type,
  entries: PyNormEntries
): string {
  const nan = "float('nan')";
  return pythonNormRuntimeOrder(
    x,
    p,
    pType,
    (fro) =>
      `(np.abs(_x) if _p > 0 else ${nan}) if np.ndim(_x) == 0 else ` +
      `(${pyNorm('_x', '_p', entries)} if _p > 0 else ${nan}) if np.ndim(_x) == 1 else ` +
      `(${pythonMatrixRuntimeNorm(fro, entries)}) if np.ndim(_x) == 2 else ` +
      `(${pyNorm('_x', undefined, entries)} if _p == 2 else ${nan})`
  );
}

/**
 * The Python source of a matrix norm `_x` for a run-time order `_p`: the
 * orders 1, 2 (the spectral norm) and `np.inf` have the same meaning in the
 * interpreter and in `np.linalg.norm`, and every other order answers NaN.
 * `fro` is the Python test for the `"Frobenius"` string order, when the order
 * can be a string: on a matrix that order is the Frobenius norm, which is not
 * the spectral norm of the order 2, so it is spelled `'fro'`.
 */
function pythonMatrixRuntimeNorm(
  fro: string | undefined,
  entries: PyNormEntries
): string {
  const nan = "float('nan')";
  const numeric = `${pyNorm('_x', '_p', entries)} if _p == 1 or _p == 2 or _p == np.inf else ${nan}`;
  return fro === undefined
    ? numeric
    : `${pyNorm('_x', "'fro'", entries)} if ${fro} else ${numeric}`;
}

/**
 * Wrap the Python source `body` of a norm with a run-time order in a lambda
 * that binds the operand to `_x` and the order to `_p`.
 *
 * The signature of `Norm` admits a STRING order: `"Infinity"` (the order
 * +Infinity) and `"Frobenius"` (the entry-wise L2 norm, which is the order 2
 * at every rank except rank 2). When the type of the order admits a string,
 * the order is normalized before `body` compares it with numbers: a Python
 * `str` would otherwise raise a `TypeError` at `_p > 0`. `"Infinity"` becomes
 * `np.inf`, `"Frobenius"` becomes `2`, and any other string becomes NaN, for
 * which every comparison is false, so `body` answers NaN (the interpreter
 * leaves `Norm` unevaluated for an order it does not know). `body` receives
 * the Python test for the `"Frobenius"` string, so that its matrix branch can
 * spell that norm as `'fro'`. When the type of the order admits no string,
 * `body` receives `undefined` and the order is passed through unchanged.
 */
function pythonNormRuntimeOrder(
  x: string,
  p: string,
  pType: Type,
  body: (fro: string | undefined) => string
): string {
  if (isSubtype(pType, 'number') || !couldMatch(pType, 'string'))
    return `(lambda _x, _p: ${body(undefined)})(${x}, ${p})`;
  const ord =
    `({'Infinity': np.inf, 'Frobenius': 2}.get(_q, float('nan')) ` +
    `if isinstance(_q, str) else _q)`;
  const fro = `(isinstance(_q, str) and _q == 'Frobenius')`;
  return `(lambda _x, _q: (lambda _p: ${body(fro)})(${ord}))(${x}, ${p})`;
}

/**
 * The complex-discipline helpers (`CompileTarget.complexLift` /
 * `complexIsReal` / `complexReal`): the idempotent number → complex lift that
 * leaves a non-number (a bool, a string, a list held by a wide binding)
 * untouched, the exact realness test, and the real projection. A Python
 * `bool` is a subclass of `int`, so it is excluded explicitly.
 * `_ce_creal_elems` is the element-wise projection
 * (`CompileTarget.complexRealElements`): a list, tuple or NumPy array —
 * nested ones recursed — with every exactly-real element replaced by its real
 * part and every other element by `nan`; a scalar takes the same rule whole.
 * The element-wise form of the D2/D6 runtime rule runs a real-only head over
 * this projection so a complex element yields `nan` at its own position.
 *
 * A NumPy complex scalar (a `complex64` value, for example) is not a subclass
 * of the built-in `complex`, so the realness test and the real projection
 * accept `np.complexfloating` too. A 0-dimensional NumPy array is also not a
 * scalar, so `_ce_creal_elems` unwraps it with `item()` and then applies the
 * scalar rule to the value it holds.
 */
const PYTHON_COMPLEX_HELPERS = `def _ce_cplx(_v):
    return complex(_v) if isinstance(_v, (int, float)) and not isinstance(_v, bool) else _v
def _ce_cisreal(_v):
    return _v.imag == 0 if isinstance(_v, (complex, np.complexfloating)) else True
def _ce_creal(_v):
    return _v.real if isinstance(_v, (complex, np.complexfloating)) else _v
def _ce_creal_elems(_v):
    if isinstance(_v, (list, tuple)):
        return [_ce_creal_elems(_x) for _x in _v]
    if hasattr(_v, 'ndim') and _v.ndim > 0:
        return np.asarray([_ce_creal_elems(_x) for _x in _v])
    if hasattr(_v, 'ndim') and _v.ndim == 0:
        _v = _v.item()
    return _ce_creal(_v) if _ce_cisreal(_v) else float('nan')`;

/**
 * Runtime broadcasting for `ElementMax`, `ElementMin`, and `Clamp`. Scalars
 * lift over arrays; equal shapes use NumPy directly; mismatched outer lengths
 * and empty collections become `nan`, matching the interpreter's numeric error
 * projection. Unequal inner shapes recurse by position so NumPy cannot silently
 * recycle a dimension.
 *
 * This helper is keyed to a fixed set of NumPy operations. General arithmetic
 * takes the other route: a head with exactly ONE collection operand fans out
 * into a list comprehension (`tryCompilePythonElementwise`), and a head with
 * two or more of them still declines, because the interpreter answers an
 * `incompatible-dimensions` error on a length disagreement and neither NumPy
 * (which recycles a length-1 axis) nor `zip` (which truncates) reproduces it.
 */
const PYTHON_BCAST_HELPER = `def _ce_bcast_apply(_op, _arrs):
    if _op == 'clip':
        return np.clip(_arrs[0], _arrs[1], _arrs[2])
    if _op == 'smoothstep':
        return _ce_smoothstep(_arrs[0], _arrs[1], _arrs[2])
    _pair = np.maximum if _op == 'max' else np.minimum
    _r = _arrs[0]
    for _a in _arrs[1:]:
        _r = _pair(_r, _a)
    return _r

def _ce_bcast(_op, *args):
    _arrs = [np.asarray(a) for a in args]
    _cols = [a for a in _arrs if a.ndim > 0]
    if not _cols:
        return np.asarray(_ce_bcast_apply(_op, _arrs))
    _n = _cols[0].shape[0]
    if any(a.shape[0] != _n for a in _cols) or _n == 0:
        return np.asarray(float('nan'))
    if all(a.shape == _cols[0].shape for a in _cols):
        return np.asarray(_ce_bcast_apply(_op, _arrs))
    return np.asarray([
        _ce_bcast(_op, *[(a[_i] if a.ndim > 0 else a) for a in _arrs])
        for _i in range(_n)
    ])
`;

/**
 * Reduced row echelon form (Gauss–Jordan with partial pivoting), the runtime
 * side of the `RowReduce` lowering — NumPy has no built-in RREF. Mirrors the JS
 * target's `_SYS.rref`; matches the interpreter's `RowReduce` on well-scaled
 * inputs (float pivots, exact-zero test — the same convention as `np.linalg`).
 */
const PYTHON_RREF_HELPER = `def _ce_rref(_m):
    _a = np.asarray(_m, dtype=float).copy()
    _rows, _cols = _a.shape
    _r = 0
    for _c in range(_cols):
        if _r >= _rows:
            break
        _piv = _r + int(np.argmax(np.abs(_a[_r:, _c])))
        if _a[_piv, _c] == 0:
            continue
        _a[[_piv, _r]] = _a[[_r, _piv]]
        _a[_r] = _a[_r] / _a[_r, _c]
        for _k in range(_rows):
            if _k != _r:
                _a[_k] = _a[_k] - _a[_k, _c] * _a[_r]
        _r += 1
    return _a
`;

/**
 * Whole-collection equality, exact per element — the runtime side of the
 * `Equal`/`NotEqual` lowering when two or more operands are collections. The
 * interpreter returns a SCALAR boolean there (see `compilePythonEquality`), so
 * this folds to one Python `bool`.
 *
 * Semantics reproduced (each verified against `.evaluate()`):
 * - a collection compared to a scalar (at any nesting depth) is `False` —
 *   never an exception;
 * - a length or shape mismatch is `False` (`Equal([1,2],[1,2,3])` → `False`),
 *   including ragged inner rows;
 * - numbers compare within the baked engine tolerance, element-wise and
 *   recursively (`Equal([[1,2]],[[1,2+1e-13]])` → `True`);
 * - two empty collections are `True`;
 * - a NON-numeric element (a `list<string>` operand also routes here) compares
 *   with `==`, since tolerance is meaningless there — and, crucially, must not
 *   raise;
 * - two MATCHING infinities are equal (`Equal([Infinity],[Infinity])` → `True`,
 *   opposite signs → `False`) while `NaN` is equal to nothing, itself included
 *   (`Equal([NaN],[NaN])` → `False`).
 *
 * The vectorized `np.asarray` path is a fast path for the common rectangular
 * numeric case, and is taken ONLY when BOTH operands coerce to a genuinely
 * numeric dtype (`kind` in `iuf`). It must not coerce with `dtype=float`:
 * numpy happily parses numeric-looking STRINGS, so `Equal(["1"],["1.0"])` would
 * answer `True` where the interpreter compares the strings and answers `False`.
 * Anything else — strings, mixed or `object` dtype (ragged input), complex —
 * falls through to the recursive element-wise comparison.
 *
 * On both the vectorized and the scalar path the comparison is the exact
 * `==`, as the scalar `Equal` lowering emits: matching infinities are equal,
 * `nan` equals nothing.
 */
const PYTHON_EQCOLL_HELPER = `def _ce_eqcoll(_a, _b):
    _al = isinstance(_a, (list, tuple, np.ndarray))
    _bl = isinstance(_b, (list, tuple, np.ndarray))
    if _al != _bl:
        return False
    if not _al:
        try:
            return bool(_a == _b)
        except TypeError:
            return False
    try:
        _x = np.asarray(_a)
        _y = np.asarray(_b)
        if _x.dtype.kind in 'iuf' and _y.dtype.kind in 'iuf':
            if _x.shape != _y.shape:
                return False
            with np.errstate(invalid='ignore'):
                return bool(np.all(_x == _y))
    except (ValueError, TypeError):
        pass
    if len(_a) != len(_b):
        return False
    return all(_ce_eqcoll(_x, _y) for _x, _y in zip(_a, _b))
`;

/**
 * `_ce_indexof` — the runtime element test for `IndexOf`, plus its `_ce_same`
 * leaf comparison. This is NOT `_ce_eqcoll`: `IndexOf` compares like the
 * interpreter's `.isSame()`, which is STRUCTURAL and **EXACT** — type-sensitive
 * about bool-ness, container kind and NaN, with NO tolerance on numbers
 * (`IndexOf([0], 5e-11)` answers 0, and
 * `IndexOf([0.30000000000000004], 0.3)` answers 0 — both probe-verified).
 *
 * An earlier version of this helper compared numbers within the engine
 * tolerance, on the belief that the interpreter tolerated float noise. That
 * belief was a PROBE ARTIFACT: the probe was `IndexOf([0.3], 0.1 + 0.2)`, and
 * `Add(0.1, 0.2)` EVALUATES to exactly `0.3` by the engine's exact decimal
 * folding, so the comparison leaf never saw a near-miss float at all. Beware
 * this trap when probing: a needle written as a computed sum tells you nothing
 * about the element test.
 *
 * Python's `in`/`.index` would be close, except for one crack: `True == 1`
 * and `False == 0` are True in Python, so a boolean needle was found in a
 * numeric haystack (and a numeric needle in a boolean one), where the
 * interpreter answers 0. `_ce_same` therefore compares BOOL-ness first and
 * reports unequal when it differs.
 *
 * The rest, on purpose:
 *  - numeric pairs compare with the plain `==` leaf, which is exact but still
 *    crosses int/float (`1 == 1.0` is True — the interpreter agrees);
 *  - a tuple and a list of the same values are NOT the same (mixed container
 *    kinds fall through to `_a == _b`, which is False in Python), which keeps
 *    the `Equal`-family tuple/list distinction and finds a TUPLE needle in a
 *    point list. That distinction applies to NATIVE containers only: an
 *    `np.ndarray` on either side is normalized with `np.asarray(x).tolist()`
 *    and recursed on, so a caller-supplied `(n, 2)` point matrix works (each
 *    row is a 1-D array, which `_a == _b` would have turned into an array and
 *    an ambiguous-truth-value error). An ndarray row is therefore LIST-like,
 *    and a compiled tuple needle matches it — a deliberate choice, matching how
 *    the engine lowers `Matrix` rows (as nested lists / an ndarray);
 *  - strings are unchanged. A needle that may be the object-domain absence
 *    (`Missing`, `Undefined`) does not reach this helper: `pySearchedValue`
 *    refuses it at compile time, since this target spells it as `nan`.
 *
 * The one other departure from Python equality is NaN: `nan == nan` is False,
 * where the interpreter's structural `.isSame()` compares two `NaN` as the
 * same. A `NaN` needle reaches this helper and IS found where `nan` sits
 * (`IndexOf([1, NaN], NaN)` is `2`, the structural search of
 * `SEARCHED_VALUE_POLICY` in `library/collections.ts`), and so is a `NaN`
 * component of a tuple needle. The both-NaN case is guarded to float scalars so an
 * ndarray element cannot reach it (`_a != _a` on an array is an array, and
 * `and` would raise an ambiguous-truth-value error); `np.float64` subclasses
 * `float`, and `np.floating` covers the narrower numpy float scalars.
 *
 * ACCEPTED RESIDUAL (exactness loss, unclosable): a needle COMPUTED at runtime
 * to a near-miss f64 — Python's `0.1 + 0.2` → `0.30000000000000004` — is not
 * found in a `[0.3]` haystack, where the interpreter folds `Add(0.1, 0.2)`
 * exactly to `0.3` and finds it. That is the ordinary exactness loss of
 * compiling to f64 arithmetic, not a defect of the element test: no element
 * test can recover the exact sum, and a tolerance leaf would only trade this
 * residual for wrong answers on genuinely distinct nearby numbers.
 */
const PYTHON_INDEXOF_HELPER = `def _ce_same(_a, _b):
    if isinstance(_a, np.ndarray) or isinstance(_b, np.ndarray):
        return _ce_same(np.asarray(_a).tolist(), np.asarray(_b).tolist())
    if isinstance(_a, (bool, np.bool_)) != isinstance(_b, (bool, np.bool_)):
        return False
    if isinstance(_a, tuple) and isinstance(_b, tuple):
        return len(_a) == len(_b) and all(_ce_same(_x, _y) for _x, _y in zip(_a, _b))
    if isinstance(_a, list) and isinstance(_b, list):
        return len(_a) == len(_b) and all(_ce_same(_x, _y) for _x, _y in zip(_a, _b))
    if isinstance(_a, (float, np.floating)) and isinstance(_b, (float, np.floating)) and _a != _a and _b != _b:
        return True
    return bool(_a == _b)

def _ce_indexof(_l, _v):
    for _i, _x in enumerate(_l):
        if _ce_same(_x, _v):
            return _i + 1
    return 0
`;

/**
 * `_ce_ord` — the shape guard the ORDERING ufuncs (`np.less`, `np.less_equal`,
 * `np.greater`, `np.greater_equal`) are emitted through by
 * `compilePythonRelation`.
 *
 * The interpreter refuses an element-wise ordering of two collections of
 * DIFFERENT lengths: `Less([1,2,3], [1,2])` and `Less([1], [1,2])` both
 * evaluate to `Error("incompatible-dimensions", …)`. NumPy only half agrees —
 * it raises loudly on 3-vs-2, but SILENTLY BROADCASTS 1-vs-n
 * (`np.less([1], [1, 2])` → `[False, True]`), a wrong answer behind a
 * `success: true`. The guard raises on any list-like-vs-list-like length
 * mismatch, the 1-vs-n case included, before applying the ufunc.
 *
 * Scalar-vs-collection broadcasting stays ALLOWED: the interpreter broadcasts a
 * scalar over a collection (`Less(["a","c"], "b")` → `["True","False"]`, pinned
 * in `compile-python-string-fail-closed.test.ts`). A `str` is not list-like in
 * Python's `isinstance` sense, so a string scalar takes the broadcast path as
 * intended. A 0-dimensional ndarray is treated as a scalar too (`len()` on one
 * raises `TypeError`).
 */
/**
 * The pole rule of `Tan`, `Cot`, `Sec` and `Csc`: when the argument `x` is
 * within its rounding error of a pole, that is when the value `y` is
 * infinite or `|y|·min(|x|, 2⁴⁰)·100·2⁻⁵³ ≥ 1`, the value becomes `np.inf`, the
 * value that stands for the unsigned pole `~oo`. This is the rule of the
 * interpreter (`isMachineTrigPole`, `numerics/numeric.ts`), with the same
 * constant and the same order of operations; without it `np.tan` of a float
 * near `π/2` gives a large finite number. `np.where` applies the rule to each
 * element of an array, and `[()]` makes the result of a scalar argument a
 * scalar again. The argument and the value are bound to the parameters of
 * inline lambdas, so each is computed once, and the code needs no
 * module-level helper (a bare lambda from `compileLambda` cannot carry one).
 * `value` is the Python code of the value, in terms of `_x`.
 */
function pythonPole(arg: string, value: string): string {
  // An infinite value at a nonzero angle below `π/2` in magnitude is not a
  // pole but an overflow of `csc` or `cot` of a tiny angle, and it keeps
  // its sign (`-np.inf` stands for `-oo`), as the JavaScript helper
  // `trigPole` (`numerics/numeric.ts`) and the interpreter do.
  return (
    `(lambda _x: (lambda _y: np.where(np.isinf(_y) & (_x != 0) & ` +
    `(np.abs(_x) < ${Math.PI / 2}), _y, np.where(np.isinf(_y) | ` +
    `(np.abs(_y) * np.minimum(np.abs(_x), ${TRIG_POLE_ARGUMENT_CAP}.0) * ` +
    `${TRIG_POLE_EPSILON} >= 1), ` +
    `np.inf, _y))[()])(${value}))(${arg})`
  );
}

/**
 * `cos(πu)`, `sin(πu)`, `tan(πu)` or `e^{iπu}` of the Python code `u`, with
 * the angle `u` in half-turns reduced exactly before the multiplication by
 * π, as `cosSinPi()` (`numerics/numeric-complex.ts`) does: `u` is written
 * `t + q/2` with `|t| ≤ 1/4`, both steps exact in floating point, so the
 * value at an integer or a half-integer `u` has an exact zero part
 * (`sin(πx)` at `x = 2` is `0`, where `np.sin(np.pi * 2)` is `−2.4e-16`).
 * An inline expression of NumPy calls, for a scalar or an array `u`, so a
 * bare lambda can carry it. `tan` at a half-integer is `np.inf`, the value of
 * the pole rule of `Tan` (`pythonPole`). A zero part is `+0.0` (adding
 * `0.0` turns `-0.0` into `0.0`), as in compiled JavaScript: `1/sin(πx)` at
 * `x = 1` is `inf`, not `-inf`. See `BaseCompiler.piMultiple`.
 */
function pythonPiTrig(u: string, head: 'sin' | 'cos' | 'tan' | 'exp'): string {
  const value =
    head === 'cos'
      ? '_pc'
      : head === 'sin'
        ? '_ps'
        : head === 'tan'
          ? '(np.where(_pc == 0, np.inf, _ps / np.where(_pc == 0, 1.0, _pc)) + 0.0)[()]'
          : '(_pc + 1j * _ps)';
  return pythonHalfTurns(u, value);
}

/**
 * The Python code `value`, which reads `_pc = cos(πu)` and `_ps = sin(πu)`
 * of the Python code `u`, with the angle reduced exactly as `pythonPiTrig`
 * describes.
 */
function pythonHalfTurns(u: string, value: string): string {
  return (
    `(lambda _pu: (lambda _pr: (lambda _pq: (lambda _pt, _pk: ` +
    `(lambda _c0, _s0: (lambda _pc, _ps: ${value})(` +
    `(np.select([_pk == 0, _pk == 1, _pk == 2], [_c0, -_s0, -_c0], _s0) + 0.0)[()], ` +
    `(np.select([_pk == 0, _pk == 1, _pk == 2], [_s0, _c0, -_s0], -_c0) + 0.0)[()]))(` +
    `np.cos(np.pi * _pt), np.sin(np.pi * _pt)))(` +
    `_pr - _pq / 2, (_pq + 4) % 4))(np.floor(2 * _pr + 0.5)))(` +
    `_pu - 2 * np.floor(_pu / 2 + 0.5)))(${u})`
  );
}

/**
 * `sinh`, `cosh`, `tanh`, `csch`, `sech` or `coth` of `iπu`, for the Python
 * code `u` of a real value, with the angle `u` in half-turns reduced exactly
 * (`pythonHalfTurns`): `sinh(iθ) = i·sin θ`, `cosh(iθ) = cos θ`,
 * `tanh(iθ) = i·tan θ`, `csch(iθ) = −i/sin θ`, `sech(iθ) = 1/cos θ` and
 * `coth(iθ) = −i·cot θ`. A zero is exact, and a pole is the unsigned pole
 * `complex(inf, inf)`, the compiled spelling of the interpreter's `~oo`:
 * `csch(iπx)` at `x = 1` is the pole, where `1 / np.sinh(1j * np.pi)` is a
 * large finite value. The value is complex, for a scalar or an array `u`.
 * Adding `0.0` turns a `-0.0` part into `0.0`. See
 * `BaseCompiler.imaginaryPiMultiple`.
 */
function pythonPiHyperbolic(
  u: string,
  head: 'Sinh' | 'Cosh' | 'Tanh' | 'Csch' | 'Sech' | 'Coth'
): string {
  const pole = 'complex(np.inf, np.inf)';
  /** `1j * num / den`, or the pole where `den` is zero. */
  const ratio = (num: string, den: string): string =>
    `(np.where(${den} == 0, ${pole}, 1j * ${num} / np.where(${den} == 0, 1.0, ${den})) + 0.0)[()]`;
  const value = {
    Sinh: '(1j * _ps + 0.0)',
    Cosh: '(_pc + 0j)',
    Tanh: ratio('_ps', '_pc'),
    Csch: ratio('-1.0', '_ps'),
    Sech: `(np.where(_pc == 0, ${pole}, 1.0 / np.where(_pc == 0, 1.0, _pc) + 0j))[()]`,
    Coth: ratio('-_pc', '_ps'),
  }[head];
  return pythonHalfTurns(u, value);
}

/** A Python float literal, with `float('inf')`, `-float('inf')` and
 * `float('nan')` for a value that is not finite. */
function pythonFloatLiteral(x: number): string {
  if (x === Infinity) return "float('inf')";
  if (x === -Infinity) return "-float('inf')";
  if (Number.isNaN(x)) return "float('nan')";
  return String(x);
}

/**
 * `_ce_pow(x, y, f)`: the power `x^y` with the real root of a NEGATIVE base
 * that the interpreter gives for a float exponent (see
 * `BaseCompiler.negativeBaseFloatPower`). `_ce_pow_branch` is a transcription
 * of `realPowerBranchTerms()` (`boxed-expression/arithmetic-power.ts`) and of
 * `rationalize()` (`numerics/rationals.ts`), in floats as in JavaScript, so
 * the two decide the same `p/q` for a double. `digits` is the number of
 * significant digits the interpreter reads the exponent to when the code is
 * generated (`realPowerReconstructionDigits()`). Where the rule does not give
 * a real root, a negative real scalar base takes the principal value
 * `|x|^y·(cos πy + i·sin πy)` with the angle reduced exactly
 * (`_ce_cos_sin_pi`, a transcription of `cosSinPi()`,
 * `numerics/numeric-complex.ts`), so `(−1)^{0.5}` is exactly `i`, as in the
 * interpreter; Python's own power leaves `6.1e-17` in the real part. Any
 * other pair takes `f(x, y)`, or `x ** y` when `f` is `None`: the power the
 * lowering used before. A complex part that is zero is read as a real value,
 * as the interpreter does. For an array operand, only the elements that have
 * a real root are replaced, one by one. The helper imports `math`.
 */
/**
 * True while `compileLambda` compiles its body: a bare lambda has no place
 * for a module helper, so the `Power` lowering does not use `_ce_pow` then.
 */
let pythonLambdaBody = false;

function pythonPowHelper(): string {
  const digits = realPowerReconstructionDigits();
  return `import math
def _ce_pow_branch(_e):
    if not math.isfinite(_e) or _e == math.floor(_e):
        return None
    _tol = max(5e-324, abs(_e) * 4 * 2.220446049250313e-16, abs(_e) * 10.0 ** (1 - ${digits}))
    _x = _e
    _a = float(math.floor(_x))
    _h1, _k1, _h, _k = 1.0, 0.0, _a, 1.0
    if not abs(_h / _k - _e) <= _tol:
        while _x - _a > 1e-15 * _k * _k:
            _x = 1 / (_x - _a)
            _a = float(math.floor(_x))
            _h, _h1 = _h1 + _a * _h, _h
            _k, _k1 = _k1 + _a * _k, _k
            if abs(_h / _k - _e) <= _tol:
                break
    if not (math.isfinite(_h) and math.isfinite(_k)) or _k == 0:
        return None
    if abs(_h / _k - _e) > _tol:
        return None
    if (12 / math.pi ** 2) * _k * _k * _tol > ${COINCIDENCE_BUDGET}:
        return None
    return (_h, _k)
def _ce_pow_real(_x, _y):
    if not (math.isfinite(_x) and _x < 0 and math.isfinite(_y)):
        return None
    _t = _ce_pow_branch(_y)
    if _t is None or _t[1] % 2 == 0:
        return None
    _m = float(np.power(-_x, _y))
    if not math.isfinite(_m):
        return None
    return -_m if _t[0] % 2 != 0 else _m
def _ce_cos_sin_pi(_v):
    _r = _v - 2 * math.floor(_v / 2 + 0.5)
    _q = math.floor(2 * _r + 0.5)
    _t = _r - _q / 2
    _c = math.cos(math.pi * _t)
    _s = 0.0 if _t == 0 else math.sin(math.pi * _t)
    return [(_c, _s), (-_s, _c), (-_c, -_s), (_s, -_c)][(_q + 4) % 4]
def _ce_pow_real_part(_v):
    if isinstance(_v, complex):
        return _v.real if _v.imag == 0 else None
    return float(_v)
def _ce_pow(_x, _y, _f=None):
    if np.ndim(_x) == 0 and np.ndim(_y) == 0:
        _xr = _ce_pow_real_part(_x)
        _yr = _ce_pow_real_part(_y)
        if _xr is not None and _yr is not None:
            _r = _ce_pow_real(_xr, _yr)
            if _r is not None:
                return _r
            if _xr < 0 and math.isfinite(_xr) and math.isfinite(_yr) and _yr != math.floor(_yr):
                _m = float(np.power(-_xr, _yr))
                _c, _s = _ce_cos_sin_pi(_yr)
                return complex(0.0 if _c == 0 else _m * _c, 0.0 if _s == 0 else _m * _s)
        return _x ** _y if _f is None else _f(_x, _y)
    _xa, _ya = np.broadcast_arrays(np.asarray(_x), np.asarray(_y))
    _r = np.array(_xa ** _ya if _f is None else _f(_xa, _ya), copy=True)
    _m = (np.real(_xa) < 0) & (np.imag(_xa) == 0) & (np.imag(_ya) == 0)
    for _i in zip(*np.nonzero(_m)):
        _v = _ce_pow_real(float(np.real(_xa[_i])), float(np.real(_ya[_i])))
        if _v is not None:
            _r[_i] = _v
    return _r
`;
}

/**
 * The Python code of `Floor`, `Ceil` or `Truncate` (`round` is `np.floor`,
 * `np.ceil` or `np.trunc`), with or without a step.
 *
 * The step form `Floor(x, step)` is `round(q) * k` with `k = |step|` and
 * `q = x / k`, where `q` is taken to the nearest integer (the nearest
 * half-integer for `Round`, whose `round` is a function) when it is within
 * 4 ulps of it: the double of a decimal step is not the decimal, and
 * `0.3 / 0.1` is `2.9999999999999996`, while the interpreter, which divides
 * the decimals, finds `3` (`_SYS.floorStep` in the JavaScript runtime does
 * the same).
 *
 * The code is an immediately applied lambda, so it is valid in the body of
 * `compileLambda` too, which has no place for a module-level helper. The
 * operand and the step are its ARGUMENTS: they are evaluated once each, in
 * the caller's scope (a caller variable named like a parameter of the lambda
 * is not captured), and in the order written, also for a zero step, whose
 * result is `NaN`. The operand goes through `np.asarray`, so a plain Python
 * list is divided elementwise.
 */
function pythonRoundToStep(
  name: string,
  round: string | ((q: string) => string),
  args: ReadonlyArray<Expression | null>,
  compile: (expr: Expression) => string,
  unit: 1 | 0.5 = 1
): string {
  const [x, step] = args;
  const apply = (q: string) =>
    typeof round === 'string' ? `${round}(${q})` : round(q);
  if (x === null || x === undefined)
    throw new Error(`Could not compile \`${name}\`: no argument`);
  if (step === null || step === undefined) return apply(compile(x));
  // `unit` is the distance between two jumps of the quotient: 1 for
  // `Floor`, `Ceil` and `Truncate`, 0.5 for `Round`. A quotient within 4
  // ulps of a jump is taken to be at the jump when the quotient of the
  // shortest decimals of `x` and the step is exactly at it, as the
  // interpreter reads a float (`fractions.Fraction(repr(x))` is that
  // decimal, exactly); the test runs only when some element is near a jump.
  // The tolerance is relative to the quotient only, so a non-zero quotient
  // is never taken to be `0`. A non-zero quotient that underflows to `0`
  // (with a finite step) keeps the sign of `x` as the smallest double
  // (`Ceil(1e-300, 1e300)` is `1e300`), and when the quotient overflows, `x`
  // is the nearest double to the multiple (`_SYS.floorStep` in the
  // JavaScript runtime does the same).
  const near = unit === 1 ? '_ce_q' : '(_ce_q * 2)';
  const jump = unit === 1 ? 'np.round(_ce_q)' : '(np.round(_ce_q * 2) / 2)';
  const fraction = "__import__('fractions').Fraction";
  const exact =
    `np.vectorize(lambda _ce_a, _ce_b, _ce_r: ` +
    `${fraction}(repr(float(_ce_a))) == ` +
    `${fraction}(float(_ce_r)) * ${fraction}(repr(float(_ce_b))), ` +
    `otypes=[bool])(_ce_x, _ce_k, ${jump})`;
  const snapped =
    `(lambda _ce_q: (lambda _ce_n: np.where(_ce_n & (${exact} ` +
    `if np.any(_ce_n) else False), ${jump}, _ce_q))` +
    `(np.isfinite(_ce_q) & (np.abs(${near} - np.round(${near})) <= ` +
    `8.881784197001252e-16 * np.abs(${near}))))` +
    `(np.where((_ce_x / _ce_k == 0) & (_ce_x != 0) & np.isfinite(_ce_k), ` +
    `np.sign(_ce_x) * 5e-324, _ce_x / _ce_k))`;
  return (
    `(lambda _ce_x, _ce_k: np.where(np.isinf(_ce_x / _ce_k) & ` +
    `np.isfinite(_ce_x) & (_ce_k != 0), _ce_x, ${apply(snapped)} * _ce_k))` +
    `(np.asarray(${compile(x)}, dtype=float), np.abs(${compile(step)}))`
  );
}

/**
 * `Smoothstep(e0, e1, x)` over numbers or NumPy arrays: t²(3 − 2t) with
 * t = clip((x − e0)/(e1 − e0), 0, 1). With e0 = e1, the step function (0
 * when x < e0, else 1), as the interpreter gives; a NaN operand gives NaN.
 * The division by zero of that case is computed and then not selected, so
 * its warning is silenced.
 */
const PYTHON_SMOOTHSTEP_HELPER = `def _ce_smoothstep(_e0, _e1, _x):
    _e0 = np.asarray(_e0, dtype=float)
    _e1 = np.asarray(_e1, dtype=float)
    _x = np.asarray(_x, dtype=float)
    with np.errstate(divide='ignore', invalid='ignore'):
        _t = np.clip((_x - _e0) / (_e1 - _e0), 0.0, 1.0)
    _r = np.where(_e0 == _e1, np.where(_x < _e0, 0.0, 1.0), _t * _t * (3.0 - 2.0 * _t))
    _r = np.where(np.isnan(_e0) | np.isnan(_e1) | np.isnan(_x), np.nan, _r)
    return _r[()]`;

/**
 * Round to an integer, elementwise, with a value halfway between two
 * integers rounded with the rule `_ties` (a `RoundingTies` name). See
 * `pythonRoundToInteger()`.
 *
 * The distance `_d` of the magnitude to its floor is exact, so a tie is
 * found exactly. The form `floor(|x| + 0.5)` is not exact: `|x| + 0.5` is
 * rounded when `|x| ≥ 2⁵²`, and `floor(2⁵² + 1 + 0.5)` is `2⁵² + 2`.
 */
const PYTHON_ROUND_HELPER = `def _ce_round(_x, _ties):
    _a = np.abs(_x)
    _m = np.floor(_a)
    _d = _a - _m
    if _ties == 'away-from-zero':
        _away = True
    elif _ties == 'toward-zero':
        _away = False
    elif _ties == 'toward-positive-infinity':
        _away = np.greater(_x, 0)
    else:
        _away = np.less(_x, 0)
    return np.sign(_x) * (_m + np.logical_or(_d > 0.5, np.logical_and(_d == 0.5, _away)))
`;

/**
 * The start value of a `Block` local that its `Declare` gives no value:
 * `_ce_unset('t')`.
 *
 * Python has no declaration, so without a start value a read of the local
 * in a loop found the value of the previous pass.
 *
 * Each use of the value raises `UnboundLocalError`: a comparison, a test of
 * truth, a conversion to a number or an array, an arithmetic operator, a
 * NumPy function, an index or an iteration. The interpreter keeps such a
 * use symbolic, which compiled code cannot represent. `None` or
 * `float('nan')` as the start value would not raise: a comparison with NaN
 * is decided, and `None` is the absent value of an input.
 *
 * A read that only passes the value on (`s ≔ t`) does not raise there: the
 * variable `s` then holds the `_ce_unset_type` object. A later operator on
 * `s` raises, and each `return` of the compiled code passes its value
 * through `_ce_checked(v)`, which raises when the value is the object, or
 * a list, a tuple, a dict or a NumPy array of `dtype=object` that holds it
 * at any depth (`pythonCheckedReturns`). So the object never leaves the
 * function in its result. A NumPy array of another `dtype` cannot hold the
 * object, so it is not walked.
 *
 * The names start with `_ce_`, so a symbol, a parameter or a function with
 * one of these names fails to compile when the code uses the helper
 * (`pythonAssertNoShadowedBuiltin`). A function named like the class would
 * otherwise replace the class at module level.
 */
const PYTHON_UNSET_HELPER = `class _ce_unset_type:
    __slots__ = ('_name',)
    def __init__(self, _name):
        self._name = _name
    def __repr__(self):
        return '<no value: %s>' % self._name
    def _ce_fail(self, *_args, **_kwargs):
        raise UnboundLocalError('read-before-declaration: "%s" is read before its first assignment' % self._name)
    __eq__ = __ne__ = __lt__ = __le__ = __gt__ = __ge__ = _ce_fail
    __bool__ = __float__ = __int__ = __index__ = __complex__ = _ce_fail
    __len__ = __iter__ = __getitem__ = __contains__ = __array__ = _ce_fail
    __array_ufunc__ = __array_function__ = _ce_fail
    __neg__ = __pos__ = __abs__ = __invert__ = __round__ = _ce_fail
    __add__ = __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = _ce_fail
    __truediv__ = __rtruediv__ = __floordiv__ = __rfloordiv__ = _ce_fail
    __mod__ = __rmod__ = __pow__ = __rpow__ = __matmul__ = __rmatmul__ = _ce_fail
    __and__ = __rand__ = __or__ = __ror__ = __xor__ = __rxor__ = _ce_fail
def _ce_unset(_name):
    return _ce_unset_type(_name)
def _ce_checked(_v):
    if isinstance(_v, _ce_unset_type):
        _v._ce_fail()
    if isinstance(_v, (list, tuple)):
        for _e in _v:
            _ce_checked(_e)
    elif isinstance(_v, dict):
        for _e in _v.values():
            _ce_checked(_e)
    elif getattr(_v, 'dtype', None) == object and hasattr(_v, 'flat'):
        for _e in _v.flat:
            _ce_checked(_e)
    return _v
`;

/**
 * Pass the value of each `return` statement of the Python code `code`
 * through `_ce_checked(…)` (`PYTHON_UNSET_HELPER`), when the code uses
 * the start value `_ce_unset(…)`: a result that is the start value of a
 * block local raises `UnboundLocalError`, as any other use of it does.
 *
 * The body of each lambda in parentheses is passed through
 * `_ce_checked(…)` too (`pythonCheckedLambdas`): a `Function` literal
 * compiles to a lambda, and `_ce_checked` returns a lambda unchanged, so a
 * lambda that returns the start value when it is called would let the
 * object out of the function.
 *
 * Called on the code before the helper definitions are put in front of
 * it, so the `return` statements of the helpers are not changed. A
 * `return` whose value does not end on its line, or that is a tuple with
 * no brackets (`return a, b`), is left as it is.
 */
function pythonCheckedReturns(code: string): string {
  if (!code.includes('_ce_unset(')) return code;
  return pythonCheckedLambdas(code).replace(
    /^(\s*)return (.+)$/gm,
    (line, indent: string, value: string) =>
      pythonIsOneExpression(value)
        ? `${indent}return _ce_checked(${value})`
        : line
  );
}

/**
 * Pass the body of each lambda after a parenthesis of the Python code `code`,
 * `(lambda p: body)`, through `_ce_checked(…)`: `(lambda p:
 * _ce_checked(body))`. The internal lambdas of the target, which are
 * applied at once, are changed too, which keeps their values. A lambda
 * whose closing parenthesis is not found is left as it is. Characters
 * inside a string literal are skipped.
 */
function pythonCheckedLambdas(code: string): string {
  const start = /\(lambda(?=[\s:])/g;
  let out = '';
  let from = 0;
  for (let m = start.exec(code); m !== null; m = start.exec(code)) {
    if (m.index < from) continue;
    // The colon that ends the parameters, and the end of the body: the
    // parenthesis that closes the lambda, at the depth of the lambda.
    let depth = 0;
    let quote: string | undefined;
    let colon = -1;
    let close = -1;
    for (let i = m.index + 1; i < code.length; i++) {
      const c = code[i];
      if (quote !== undefined) {
        if (c === '\\') i += 1;
        else if (c === quote) quote = undefined;
        continue;
      }
      if (c === "'" || c === '"') quote = c;
      else if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) {
          close = i;
          break;
        }
        depth -= 1;
      } else if (c === ':' && depth === 0 && colon < 0) colon = i;
      // After the parameters, a comma at the depth of the lambda ends its
      // body: `f(lambda a: a + 1, b)`.
      else if (c === ',' && depth === 0 && colon >= 0) {
        close = i;
        break;
      }
    }
    if (colon < 0 || close < 0) continue;
    const body = code.slice(colon + 1, close).trim();
    out +=
      code.slice(from, colon + 1) +
      ` _ce_checked(${pythonCheckedLambdas(body)})`;
    from = close;
    start.lastIndex = close;
  }
  return out + code.slice(from);
}

/**
 * True when the Python source `s` has balanced brackets and no comma
 * outside brackets. Characters inside a string literal are skipped.
 */
function pythonIsOneExpression(s: string): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote !== undefined) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth < 0) return false;
    } else if (c === ',' && depth === 0) return false;
  }
  return depth === 0 && quote === undefined;
}

/**
 * The Python code that rounds `c` to an integer, with a value halfway
 * between two integers rounded with the rule `ties`. `np.round` rounds a tie
 * to even and is exact at every magnitude, so it is used for `to-even`; the
 * other rules call the `_ce_round` helper (`PYTHON_ROUND_HELPER`), which
 * writes the operand once.
 *
 * A body of `compileLambda` has no place for a module-level helper
 * (`pythonLambdaBody`), so there the helper's computation is written inline,
 * in nested lambdas that bind the operand, its magnitude and the floor of
 * the magnitude once each.
 */
function pythonRoundToInteger(c: string, ties: RoundingTies): string {
  if (ties === 'to-even') return `np.round(${c})`;
  if (!pythonLambdaBody) return `_ce_round(${c}, '${ties}')`;
  const away = {
    'away-from-zero': 'True',
    'toward-zero': 'False',
    'toward-positive-infinity': 'np.greater(_x, 0)',
    'toward-negative-infinity': 'np.less(_x, 0)',
  }[ties];
  return (
    `(lambda _x: (lambda _a: (lambda _m: np.sign(_x) * (_m + ` +
    `np.logical_or(_a - _m > 0.5, np.logical_and(_a - _m == 0.5, ${away}))))` +
    `(np.floor(_a)))(np.abs(_x)))(${c})`
  );
}

/**
 * The run-time check of the operands of `Mod` and `Remainder`, the Python
 * spelling of the JavaScript runtime's `integerOperand`
 * (`javascript-runtime.ts`): an operand beyond the safe integer range
 * `±(2^53 − 1)`, or infinite, raises a `ValueError` that names the operation
 * and the value.
 *
 * A FLOAT beyond that range is the rounding of the value that produced it,
 * so its remainder is a different number from the interpreter's, not a less
 * precise one (`np.mod(2.0**60 + 1, 10)` is `6.0`, the exact answer is `7`),
 * and `np.mod` of an infinity is `nan`. A Python or NumPy INTEGER is exact
 * at any magnitude, and `np.mod` computes on two integers exactly (or raises
 * an `OverflowError` past 64 bits). But `np.mod` converts an integer to a
 * float when the other operand is a float, so for `Mod` the operands are
 * checked when one of them is a float (`_all` is `False`). The `Remainder`
 * formula divides, which converts an integer to a float, so for `Remainder`
 * the operands are always checked (`_all` is `True`).
 *
 * The test compares the operand with both limits. It does not take the
 * absolute value: `np.abs` of the minimum int64, `-2^63`, overflows and stays
 * negative. `nan` passes and propagates. An array operand is tested element
 * by element.
 */
const PYTHON_SAFE_INTEGER_LIMIT = '9007199254740991.0';

/** The Python test that `x` (a name) has an element beyond the safe integer
 * range, or infinite. */
function pythonBeyondSafeInteger(x: string): string {
  return (
    `(np.any(np.asarray(${x}) > ${PYTHON_SAFE_INTEGER_LIMIT}) or ` +
    `np.any(np.asarray(${x}) < -${PYTHON_SAFE_INTEGER_LIMIT}))`
  );
}

/** The Python test that `np.mod` computes on floats. Two integer dtypes
 * can also promote to a float, such as `int64` combined with `uint64`. */
const PYTHON_FLOAT_OPERANDS =
  "np.asarray(_a).dtype.kind == 'f' or np.asarray(_b).dtype.kind == 'f' or " +
  'np.result_type(_a if np.isscalar(_a) else np.asarray(_a), ' +
  "_b if np.isscalar(_b) else np.asarray(_b)).kind == 'f'";

/** The message of the `ValueError` for the operand `x` (a name) of `op` (a
 * Python expression). */
function pythonIntOperandMessage(op: string, x: string): string {
  return (
    `${op} + ': ' + str(${x}) + ' is beyond the safe integer range of ` +
    'compiled code (+/-9007199254740991); evaluate with the interpreter ' +
    "for the exact result'"
  );
}

/**
 * `_ce_int_operands` checks the two operands of `op` and returns them as a
 * tuple. `Mod` spreads the tuple into `np.mod`. `_ce_remainder` is
 * `a - b·round(a/b)`, with each operand checked and computed once. The
 * quotient is rounded with a tie toward `+∞`, as JavaScript `Math.round`
 * does in the interpreter: this is the computation of
 * `_ce_round(_q, 'toward-positive-infinity')` (`PYTHON_ROUND_HELPER`), not
 * the `Round` tie rule of the engine.
 */
const PYTHON_INT_OPERAND_HELPER = `def _ce_int_operands(_op, _all, _a, _b):
    _all = _all or ${PYTHON_FLOAT_OPERANDS}
    for _x in (_a, _b):
        if _all and ${pythonBeyondSafeInteger('_x')}:
            raise ValueError(${pythonIntOperandMessage('_op', '_x')})
    return (_a, _b)
def _ce_remainder(_a, _b):
    _ce_int_operands('Remainder', True, _a, _b)
    _q = _a / _b
    _m = np.floor(np.abs(_q))
    _d = np.abs(_q) - _m
    return _a - _b * (np.sign(_q) * (_m + np.logical_or(_d > 0.5, np.logical_and(_d == 0.5, np.greater(_q, 0)))))`;

/**
 * The code of `Mod` or `Remainder` of `a` and `b`, with the operands checked
 * (`PYTHON_INT_OPERAND_HELPER`). When both operands are number literals
 * inside the safe integer range, `Mod` needs no check.
 *
 * A bare lambda has no place for a module helper (`pythonLambdaBody`), so
 * there the check is written inline: a lambda binds the two operands once,
 * and the generator `throw` idiom raises the error.
 */
function pythonIntegerOperands(
  op: 'Mod' | 'Remainder',
  a: Expression,
  b: Expression,
  compile: (expr: Expression) => string
): string {
  const ca = compile(a);
  const cb = compile(b);
  const isSafeLiteral = (x: Expression) =>
    isNumber(x) && !x.isComplex && !isBeyondSafeInteger(x.re);
  if (op === 'Mod' && isSafeLiteral(a) && isSafeLiteral(b))
    return `np.mod(${ca}, ${cb})`;
  if (!pythonLambdaBody) {
    if (op === 'Mod')
      return `np.mod(*_ce_int_operands('Mod', False, ${ca}, ${cb}))`;
    return `_ce_remainder(${ca}, ${cb})`;
  }
  const raise = (x: string) =>
    `(_ for _ in ()).throw(ValueError(${pythonIntOperandMessage(`'${op}'`, x)}))`;
  const beyond = (x: string) =>
    op === 'Mod'
      ? `_f and ${pythonBeyondSafeInteger(x)}`
      : pythonBeyondSafeInteger(x);
  const result =
    op === 'Mod'
      ? 'np.mod(_a, _b)'
      : `(_a - _b * ${pythonRoundToInteger('_a / _b', 'toward-positive-infinity')})`;
  const checked =
    `${raise('_a')} if ${beyond('_a')} else ` +
    `${raise('_b')} if ${beyond('_b')} else ${result}`;
  const body =
    op === 'Mod'
      ? `(lambda _f: ${checked})(${PYTHON_FLOAT_OPERANDS})`
      : checked;
  return `(lambda _a, _b: ${body})(${ca}, ${cb})`;
}

const PYTHON_ORD_HELPER = `def _ce_ord(_f, _a, _b):
    def _ce_ord_len(_x):
        if isinstance(_x, np.ndarray):
            return len(_x) if _x.ndim > 0 else None
        if isinstance(_x, (list, tuple)):
            return len(_x)
        return None
    _la = _ce_ord_len(_a)
    _lb = _ce_ord_len(_b)
    if _la is not None and _lb is not None and _la != _lb:
        raise ValueError('incompatible dimensions')
    return _f(_a, _b)
`;

/**
 * Run-time helpers for the compiled `ReplaceAt`, `DeleteAt` and `Insert`.
 * Each returns a NEW list and leaves its operand unchanged, as the
 * interpreter does. `_ce_listpos` applies the interpreter's index rules: the
 * index is 1-based, a negative index counts from the end, and `Insert` uses
 * the n + 1 gaps of the list. The interpreter leaves the expression
 * unevaluated for a zero or out-of-range index and rejects a non-integer
 * index, so these helpers raise an `IndexError` in both cases. A boolean is
 * not an index, although Python counts it as an `int`. A string operand is
 * refused at compile time when it is provably a string (`pyCollArg`); one that
 * is a string only at run time raises a `TypeError` (`_ce_listcopy`), because
 * Python has no standard grapheme segmentation and the interpreter walks a
 * string by characters. The JavaScript target
 * has the same helpers (`_SYS.replaceAt`, `listPosition` in
 * `javascript-target.ts`).
 *
 * `_ce_replaceat_inplace` and `_ce_owned_copy` serve a fold that updates its
 * accumulator in place (`inPlaceUpdateChains`, `in-place-update.ts`). The
 * first writes a chain of updates, innermost first, into the list it is
 * given: every index and value was computed before the call, from the list as
 * it was at the start of the step. The second copies the seed once into a new
 * list (a tuple, a range or a NumPy array becomes a list, as the first
 * `ReplaceAt` would make it), so the caller's value is never changed. A string
 * seed is returned as it is, so that a fold with no update answers the string,
 * as the interpreter does; the first update of a string raises the
 * `TypeError` of `_ce_listcopy`.
 */
const PYTHON_LIST_UPDATE_HELPER = `def _ce_listpos(_op, _n, _i):
    if isinstance(_i, (bool, np.bool_)) or not isinstance(_i, (int, float, np.integer, np.floating)) or not float(_i).is_integer():
        raise IndexError(_op + ': the index is not an integer at run time')
    _k = int(_i)
    if _k == 0 or _k > _n or _k < -_n:
        raise IndexError(_op + ': the index ' + str(_k) + ' is not a position of the list at run time')
    return _k - 1 if _k > 0 else _n + _k
def _ce_listcopy(_op, _l):
    if isinstance(_l, str):
        raise TypeError(_op + ': the operand is a string at run time, and this target cannot split a string into characters')
    return list(_l)
def _ce_replaceat(_l, _i, _v):
    _o = _ce_listcopy('ReplaceAt', _l)
    _o[_ce_listpos('ReplaceAt', len(_o), _i)] = _v
    return _o
def _ce_deleteat(_l, _i):
    _o = _ce_listcopy('DeleteAt', _l)
    del _o[_ce_listpos('DeleteAt', len(_o), _i)]
    return _o
def _ce_insert(_l, _i, _v):
    _o = _ce_listcopy('Insert', _l)
    _o.insert(_ce_listpos('Insert', len(_o) + 1, _i), _v)
    return _o
def _ce_replaceat_inplace(_l, *_u):
    if isinstance(_l, str):
        _l = _ce_listcopy('ReplaceAt', _l)
    for _k in range(0, len(_u), 2):
        _l[_ce_listpos('ReplaceAt', len(_l), _u[_k])] = _u[_k + 1]
    return _l
def _ce_owned_copy(_x):
    return _x if isinstance(_x, str) else _ce_listcopy('Fold', _x)
`;

/**
 * The operand arrays (`Expression.ops`) of the `ReplaceAt` nodes that compile
 * to an in-place update, for the time the `Reduce` lowering compiles a step
 * that `inPlaceUpdateChains` accepts. The key is the node's own array, so a
 * `ReplaceAt` in another function whose parameter has the same name keeps
 * the copying form. The JavaScript target has the same set
 * (`IN_PLACE_UPDATE_OPS`).
 */
const PY_IN_PLACE_UPDATE_OPS = new WeakSet<ReadonlyArray<Expression>>();

/**
 * `_ce_predicate(f, kind, mode)`: the predicate `f` of `kind`, checked at each
 * call (`pyFnArg`), with the modes of `PREDICATE_RESULT_MODES`
 * (`javascript-target.ts`, where `_SYS.predicateResult` does the same). A
 * `bool` or a `np.bool_` passes. An absent value is `None` (a `When` whose
 * condition fails) or a float `nan` (this target spells `Missing` as
 * `math.nan`, and a guarded branch answers `nan` for a `NaN` element). A
 * `nan` can also be a numeric `NaN`, which the interpreter does not read as
 * absent, so `pyFnArg` refuses a selecting predicate whose result type
 * admits `NaN`. For
 * `select`, an absent value does not select the element, as `Missing` does
 * not in the interpreter, and any other value raises a `TypeError`. For
 * `quantify`, an absent value and any other value raise a `TypeError`: the
 * interpreter answers `Missing` or leaves `Any`/`All` unevaluated, which
 * `any`/`all` cannot give. For `prefix`, any value that is not a boolean
 * ends the prefix.
 */
const PYTHON_PREDICATE_HELPER = `def _ce_predicate(_f, _kind, _mode):
    def _p(_x):
        _v = _f(_x)
        if isinstance(_v, (bool, np.bool_)):
            return bool(_v)
        if _mode == 'prefix':
            return False
        _absent = _v is None or (isinstance(_v, (float, np.floating)) and _v != _v)
        if _mode == 'select' and _absent:
            return False
        if _absent:
            raise TypeError(_kind + ' predicate returned an absent value, which the interpreter combines by Kleene logic')
        raise TypeError(_kind + ' predicate must return "True" or "False"')
    return _p
`;

/**
 * `_ce_ugamma(s, z, reg)`: the upper incomplete gamma Γ(s, z) when `reg` is
 * `False`, and the regularized one Q(s, z) = Γ(s, z)/Γ(s) when `reg` is
 * `True`, for real `s` and `z`, elementwise over NumPy broadcasting. A
 * scalar pair gives a NumPy scalar. The kernel is real-only: an element
 * with a nonzero imaginary part gives `nan`, as the runtime guard of a
 * real-only head does (`BaseCompiler.realOperandGuard`), and an element
 * whose imaginary part is 0 is read as its real part.
 *
 * `scipy.special.gammaincc` is Q for `s > 0` only: it is `nan` for every
 * `s < 0` and for `s = −1`, while the interpreter has a value there
 * (Q(−1.5, 0.001) = 8894.8…, Γ(−1, 2) = 0.01876…), and it loses digits
 * for `0 < s < 1e-20` (all of them for a subnormal `s`). So the elements
 * with a finite `s ≥ 1e-20` use `gammaincc` (times `gamma(s)` for Γ), and
 * the other elements use the scalar kernel `_ce_ug1`. For Γ, an element
 * with `s ≥ 1e-20` also uses the kernel when `gamma(s)` overflows
 * (`s > 171.6`) or when Q is below 1e-300, where `gammaincc` loses digits
 * to underflow: Γ(150, 1500) = 6.9e-179 is finite while Q underflows to 0.
 *
 * The kernel computes `h = Γ(s, z)·z^(−s)·e^z`, which stays near
 * `1/(z + 1 − s)` and never overflows:
 *
 *  - for `z ≥ 1`, or `s > ½`, or `s < −4096`, `h` is the Legendre continued
 *    fraction (DLMF 8.9.2, modified Lentz, `_ce_ug_cf`), which converges for
 *    every real `s` and `z > 0` and is accurate for `z ≥ 1`. It ends after
 *    three consecutive factors within 4 ulp of 1, and is `nan` after 5000
 *    iterations;
 *  - for `0 < z < 1` and `s ≤ ½`, `s = a − m` with `m` the integer nearest
 *    to `−s`, so `−½ ≤ a ≤ ½`. `Γ(a, z)` comes from
 *    `Γ(a, z)·z^(−a) = (Γ(1 + a)·z^(−a) − 1)/a − Σ_{k≥1} (−z)^k/(k!·(a + k))`
 *    (DLMF 8.7.3 with the pole of `Γ(a)` and of the `k = 0` term combined).
 *    The bracket is `expm1(lnΓ(1 + a) − a·ln z)/a`, with `lnΓ(1 + a)` from
 *    its Taylor series in `a` (DLMF 5.7.3, with the terms of `ln(1 + a)`
 *    taken out so that the coefficients `(ζ(k) − 1)/k` fall as `2^(−k)`).
 *    This has no cancellation when `a` is near 0, where `Γ(a)` is a pole:
 *    `s = −1.000001` is as accurate as `s = −1.5`. For `|a| < 1e-200`
 *    (`a = 0` included), `h` is `E₁(z)·e^z` (`scipy.special.exp1`): the
 *    difference is far below the double precision, and the bracket would
 *    divide by a subnormal `a`. Then `m` steps of the recurrence
 *    `Γ(a − 1, z) = (Γ(a, z) − z^(a−1)·e^(−z))/(a − 1)` (DLMF 8.8.2),
 *    which for `h` is `h ← (1 − z·h)/(1 − a)`. For `z < 1` the subtracted
 *    term is the larger one, so the recurrence has no cancellation.
 *
 * Then `Γ(s, z) = h·z^s·e^(−z)` and `Q(s, z) = Γ(s, z)/Γ(s)`. When one of
 * these values is outside the range of normal doubles, the logarithms are
 * used instead: `ln Γ(s, z) = s·ln z − z + ln h`, and Q has the sign of
 * `Γ(s)` (`gammasgn`) and the magnitude `exp(ln Γ(s, z) − ln|Γ(s)|)`, where
 * `ln|Γ(s)|` is `−ln|s|` for `|s| ≤ 1e-300` (`gammaln` is `inf` for a
 * subnormal `s`, and `ln|Γ(s)| = −ln|s| − γs + O(s²)` there). A
 * value beyond the double range is then `±inf` with the sign of the exact
 * value, and a value below it is 0, as the real part of the interpreter's
 * value is.
 *
 * The special values are those of the interpreter: for a non-positive
 * integer `s`, Q is 0 for `z > 0` (`1/Γ(s)` is 0) and `nan` at `z = 0`, and
 * Γ(s, 0) is `+inf` (the limit as `z → 0⁺`); for another `s`, Γ(s, 0) is
 * `Γ(s)` and Q(s, 0) is 1 for `s > 0` and `±inf`, with the sign of `Γ(s)`,
 * for `s < 0`. Q(s, +inf) is a zero with the sign of `Γ(s)` (−0.0 for
 * `s = −½`), the sign the logarithm route gives near it. A negative `z`
 * gives `nan`: the value is complex there.
 *
 * An infinite order follows the interpreter's limits
 * (`incompleteGammaValueAtInfinity()` in `library/arithmetic.ts` and
 * `gammaRegularizedValueAtInfinity()` in `library/distributions.ts`): two
 * infinite operands give `nan`; Γ(+inf, z) is `+inf` for a finite `z ≥ 0`;
 * Γ(−inf, z) is `+inf` for `0 < z < 1`, 0 for a finite `z ≥ 1`, and `nan`
 * for `z ≤ 0`; Q(+inf, z) is 1 for every finite `z`; Q(−inf, z) is `nan`.
 *
 * Measured against mpmath (1180 points, `s` from −5000.5 to 500 and `z`
 * from 1e-300 to 1500, including `s` within 1e-12 of a non-positive
 * integer): where the value is a normal double, the relative error is below
 * 1.5e-13 for `s ≤ 0`, and below 3e-13 for `s > 0`, where it is the error
 * of `gammaincc`. It is 2e-12 at Q(−5000.5, 1500), the ratio of two values
 * far beyond the double range, where the error of the logarithms (about
 * 37 600 for `ln|Γ(−5000.5)|`) dominates. Every special value and every
 * value outside the double range matches.
 */
const PYTHON_UPPER_GAMMA_HELPER = `import math
import scipy.special
_ce_ug_zc = [float(scipy.special.zetac(_k)) / _k for _k in range(2, 48)]
def _ce_ug_cf(_s, _z):
    _b = _z + 1 - _s
    _c = 1e300
    _d = 1 / _b
    _h = _d
    _n = 0
    for _i in range(1, 5001):
        _an = -_i * (_i - _s)
        _b += 2
        _d = _an * _d + _b
        if abs(_d) < 1e-300:
            _d = 1e-300
        _c = _b + _an / _c
        if abs(_c) < 1e-300:
            _c = 1e-300
        _d = 1 / _d
        _e = _d * _c
        _h *= _e
        _n = _n + 1 if abs(_e - 1) < 8.881784197001252e-16 else 0
        if _n >= 3:
            return _h
    return math.nan
def _ce_ug_h(_s, _z):
    if _z >= 1 or _s > 0.5 or _s < -4096:
        return _ce_ug_cf(_s, _z)
    _m = round(-_s)
    _a = _s + _m
    if abs(_a) < 1e-200:
        _h = float(scipy.special.exp1(_z)) * math.exp(_z)
    else:
        _l = -0.5772156649015329 * _a + (_a - math.log1p(_a))
        _p = -_a
        for _c in _ce_ug_zc:
            _p *= -_a
            _l += _c * _p
        _t = 1.0
        _sum = 0.0
        for _k in range(1, 200):
            _t *= -_z / _k
            _d = _t / (_a + _k)
            _sum += _d
            if abs(_d) < 1e-17 * abs(_sum):
                break
        _h = math.exp(_z) * (math.expm1(_l - _a * math.log(_z)) / _a - _sum)
    for _k in range(_m):
        _h = (1 - _z * _h) / (1 - _a)
        _a -= 1
    return _h
def _ce_ug1(_s, _z, _reg):
    if math.isnan(_s) or math.isnan(_z):
        return math.nan
    if math.isinf(_s):
        if math.isinf(_z) or (_s < 0 and (_reg or _z <= 0)):
            return math.nan
        if _reg:
            return 1.0
        if _z < 0:
            return math.nan
        return math.inf if _s > 0 or _z < 1 else 0.0
    if _z < 0:
        return math.nan
    _int = _s <= 0 and _s == math.floor(_s)
    if _reg and _int:
        return 0.0 if _z > 0 else math.nan
    if _z == 0:
        if _s > 0:
            return 1.0 if _reg else float(scipy.special.gamma(_s))
        if _reg:
            return math.copysign(math.inf, scipy.special.gammasgn(_s))
        return math.inf if _int else float(scipy.special.gamma(_s))
    if _z == math.inf:
        return math.copysign(0.0, scipy.special.gammasgn(_s)) if _reg else 0.0
    if _s > 0.5 and not _reg:
        _q = float(scipy.special.gammaincc(_s, _z))
        if _q > 1e-300 and _z < _s + 1:
            return float(np.exp(scipy.special.gammaln(_s) + math.log(_q)))
    _h = _ce_ug_h(_s, _z)
    if not _h > 0:
        return math.nan
    _lg = _s * math.log(_z) - _z + math.log(_h)
    _g = float(_h * np.power(_z, _s) * np.exp(-_z))
    if not 2.2250738585072014e-308 <= _g < math.inf:
        _g = math.nan
    if not _reg:
        return _g if _g == _g else float(np.exp(_lg))
    _G = float(scipy.special.gamma(_s))
    if _g == _g and 2.2250738585072014e-308 <= abs(_G) < math.inf:
        return _g / _G
    _lG = scipy.special.gammaln(_s) if abs(_s) > 1e-300 else -math.log(abs(_s))
    return float(scipy.special.gammasgn(_s) * np.exp(_lg - _lG))
def _ce_ugamma(_s, _z, _reg):
    _s = np.asarray(_s)
    _z = np.asarray(_z)
    _nr = (np.imag(_s) != 0) | (np.imag(_z) != 0)
    with np.errstate(all='ignore'):
        _s, _z = np.broadcast_arrays(np.asarray(np.real(_s), dtype=float), np.asarray(np.real(_z), dtype=float))
        _nr = np.broadcast_to(_nr, _s.shape)
        _q = scipy.special.gammaincc(_s, _z)
        _r = np.array(_q if _reg else _q * scipy.special.gamma(_s), dtype=float)
        _slow = ~(_s >= 1e-20) | np.isinf(_s)
        if not _reg:
            _slow = _slow | ((_z > 0) & ~((_q > 1e-300) & (np.abs(_r) < np.inf)))
        for _i in np.flatnonzero(_slow & ~_nr):
            _r.flat[_i] = _ce_ug1(float(_s.flat[_i]), float(_z.flat[_i]), _reg)
        _r[_nr] = np.nan
    return _r[()]
`;

/** Prepend any referenced runtime helper definitions to the compiled `code`.
 * Idempotent per emission unit; a redefinition (if two units are concatenated)
 * is harmless in Python. */
function withPythonHelpers(code: string): string {
  let out = pythonCheckedReturns(code);
  if (
    out.includes('_ce_cplx(') ||
    out.includes('_ce_cisreal(') ||
    out.includes('_ce_creal(') ||
    out.includes('_ce_creal_elems(')
  )
    out = `${PYTHON_COMPLEX_HELPERS}\n${out}`;
  if (out.includes('_ce_rref(')) out = `${PYTHON_RREF_HELPER}\n${out}`;
  if (out.includes('_ce_bcast(')) out = `${PYTHON_BCAST_HELPER}\n${out}`;
  if (out.includes('_ce_eqcoll(')) out = `${PYTHON_EQCOLL_HELPER}\n${out}`;
  if (out.includes('_ce_indexof(')) out = `${PYTHON_INDEXOF_HELPER}\n${out}`;
  if (out.includes('_ce_ord(')) out = `${PYTHON_ORD_HELPER}\n${out}`;
  if (out.includes('_ce_round(')) out = `${PYTHON_ROUND_HELPER}\n${out}`;
  if (out.includes('_ce_unset(')) out = `${PYTHON_UNSET_HELPER}\n${out}`;
  if (out.includes('_ce_smoothstep(') || out.includes("_ce_bcast('smoothstep'"))
    out = `${PYTHON_SMOOTHSTEP_HELPER}\n${out}`;
  if (out.includes('_ce_int_operands(') || out.includes('_ce_remainder('))
    out = `${PYTHON_INT_OPERAND_HELPER}\n${out}`;
  if (out.includes('_ce_pow(')) out = `${pythonPowHelper()}\n${out}`;
  if (
    /_ce_(replaceat|replaceat_inplace|owned_copy|deleteat|insert)\(/.test(out)
  )
    out = `${PYTHON_LIST_UPDATE_HELPER}\n${out}`;
  if (out.includes('_ce_predicate('))
    out = `${PYTHON_PREDICATE_HELPER}\n${out}`;
  if (out.includes('_ce_ugamma(')) out = `${PYTHON_UPPER_GAMMA_HELPER}\n${out}`;
  return out;
}

/**
 * Fail closed when `code`, produced by the **expression-only**
 * `compileToSource()` route, is not a single Python expression.
 *
 * `compileToSource()` answers with a bare expression string, and every consumer
 * splices it into an expression position (`_value = (<code>)` in the pyexec
 * harness, a `lambda` body, an f-string). Python `return`, `for` and `while`
 * are STATEMENTS with no expression form, and Python has no expression-level
 * block to wrap a statement sequence in — so a body that lowers to statements
 * (a multi-statement `Block`, a statement-form `Loop`) has no honest emission
 * here. Before this gate the route handed the statements back verbatim behind
 * the string contract: `Block(s ≔ x; s)` returned `"s = x\nreturn s"`, and
 * `Block(Declare s; s ≔ x; Return s)` returned `"s = x\nreturn return s"` —
 * neither of which Python parses.
 *
 * Python does have expression-level binding forms — the immediately-applied
 * `lambda` and the flat comprehension this target already uses for chained
 * relations and CSE — so a general statement→expression lowering is
 * conceivable. That is a FEATURE, not a gate: this declines and points at
 * `compileFunction()`, the statement-capable route (it emits a `def`, and
 * already special-cases a multi-line block body).
 *
 * Run on the code BEFORE `withPythonHelpers`/`withImports`: both legitimately
 * prepend module-level `def`/`import` lines, which are this route's own
 * documented preamble, not the body's shape.
 *
 * A token scan on the source about to be emitted, deliberately — the same
 * technique (and the same two signals) as the GPU targets'
 * `gpuAssertExpressionOnly` and `BaseCompiler.compileValueOperand`'s
 * `bareStatementBlocks` gate. One Python-specific step: unlike the shader
 * languages this target emits STRING literals (`string: JSON.stringify`), and
 * a string whose content is `return` is an expression, so the `return` scan
 * runs with the literals blanked out. The multi-line signal needs no such step
 * — `JSON.stringify` escapes newlines.
 */
function pythonAssertExpressionOnly(subject: string, code: string): void {
  const multiStatement = code.includes('\n');
  if (
    !multiStatement &&
    !/\breturn\b/.test(code.replace(/"(?:[^"\\]|\\.)*"/g, '""'))
  )
    return;
  const excerpt = (multiStatement ? code.split('\n')[0] : code).trim();
  throw new Error(
    `Could not compile ${compileSubject(subject)}: this route emits a single Python EXPRESSION, but the body ` +
      `lowers to ${
        multiStatement ? 'a statement sequence' : 'a bare `return` statement'
      } (\`${excerpt}${multiStatement ? '…' : ''}\`). Python has no ` +
      `expression-level block, and \`return\`/\`for\`/\`while\` are ` +
      `statements, so there is no valid emission for this position. Compile a ` +
      `statement body with compileFunction() instead — that route emits a ` +
      `\`def\`.`
  );
}

/**
 * Fail closed on a Python **expression-only** route (`compileToSource()`,
 * `compileLambda()`) whose body is STRUCTURALLY a statement.
 *
 * The companion to `pythonAssertExpressionOnly`, which scans the EMITTED source
 * for a newline or a `return` token. Two body shapes leave neither signal, so
 * they went out behind the expression contract:
 *
 * - `Assign(s, x)` (and `Block(s ≔ x)`, which unwraps to it) emits the single
 *   line `s = x`. Python assignment is a STATEMENT: `compileToSource()`
 *   returned `"s = x"` and `compileLambda()` returned `"lambda x: s = x"`,
 *   neither of which parses. This target does not emit the walrus operator,
 *   the only expression-level binding form that could carry an assignment here
 *   — and `:=` is not a drop-in for `=` (different precedence, and it is
 *   rejected at statement level and for attribute/subscript targets).
 * - A root `Declare(s, 'number', x)` emits the EMPTY string — Python has no
 *   declaration statement, so the target emits nothing for it, silently
 *   dropping the declared name AND its initializer. `compileToSource()`
 *   returned `""` and `compileLambda()` returned `"lambda x: "`.
 *
 * Structural, on the body BEFORE it is compiled — see `statementBodyHead` for
 * why a textual `=` scan cannot do this job.
 */
function pythonAssertExpressionBody(subject: string, expr: Expression): void {
  const head = statementBodyHead(expr);
  if (head === undefined) return;
  throw new Error(
    `Could not compile ${compileSubject(subject)}: this route emits a single Python EXPRESSION, but the body ` +
      (head === 'Assign'
        ? 'is an assignment. Python assignment is a STATEMENT (this target ' +
          'does not emit the walrus operator), so the emitted `s = x` is not ' +
          'valid in an expression position.'
        : 'is a declaration. Python has no declaration statement, so this ' +
          'target emits the EMPTY string for it — the declared name and its ' +
          'initializer would be silently DROPPED.') +
      ` Give the block a VALUE statement (\`Block(s ≔ x; s)\`) and compile it ` +
      `with compileFunction() instead — that route emits a \`def\`.`
  );
}

/**
 * Whether the first line of the Python statement list `body` that names
 * `name` is an assignment of `name` at the top level of the list (not in a
 * loop or a branch, so it always runs), whose value does not read `name`.
 * Then no statement reads `name` before it has a value. Any other first
 * occurrence (a read, a write in an indented block, a mention in a string)
 * gives `false`.
 */
function pythonWrittenFirst(body: string, name: string): boolean {
  const word = new RegExp(`(?<![\\w.])${name}(?!\\w)`);
  for (const line of body.split('\n')) {
    if (!word.test(line)) continue;
    if (!line.startsWith(`${name} = `)) return false;
    return !word.test(line.slice(name.length + 3));
  }
  return false;
}

/**
 * Fail closed when `compileFunction()`'s body is STRUCTURALLY a statement.
 *
 * `compileFunction()` is the statement-capable route the rest of this class
 * points at, but neither of its two branches can carry a body whose VALUE
 * statement is an assignment or a declaration:
 *
 * - The single-line branch wraps the body in `return`, so `Block(s ≔ x)` came
 *   out as `def f(x):\n    return s = x\n` — invalid Python. So did the
 *   `Declare` shapes (`return `, dropping the initializer; `return return s =
 *   x` when block-wrapped).
 * - The multi-line branch cannot take over: it emits the body verbatim under
 *   the `def` and adds no `return` of its own — it relies on the block hook
 *   having placed one on a VALUE statement. Routing `s = x` through it would
 *   emit `def f(x):\n    s = x\n`, a `def` returning `None`, where the
 *   interpreter gives the block the assigned value. And the branch has the
 *   same hole at its own last line: `Block(s ≔ x; t ≔ s)` emitted
 *   `    return t = s`.
 *
 * The fix is on the caller's side and the message says so: a block whose value
 * statement is an EXPRESSION already compiles correctly through the multi-line
 * branch (`Block(s ≔ x; s)` → `def f(x):\n    s = x\n    return s\n`).
 *
 * A `Block` whose last statement is an assignment to a name, or a `Declare`
 * with an initializer (`isTailAssignmentBlock`), is not declined here. The
 * block hook emits such a last statement as the assignment followed by
 * `return <name>` (`Block(s ≔ x; t ≔ s)` → `s = x`, `t = s`, `return t`), so
 * the multi-line branch carries it, as `compile()` does for the same body.
 * `compileFunction()` checks the emitted body after compiling it instead
 * (`pythonAssertReturnedBlock`): a single-statement block with no local is
 * unwrapped to the single line `s = x`, which stays declined.
 */
function pythonAssertReturnableBody(subject: string, expr: Expression): void {
  pythonAssertReturnableSelection(subject, expr);
  if (isTailAssignmentBlock(expr)) return;
  const head = statementBodyHead(expr);
  if (head === undefined) return;
  throw pythonStatementBodyError(subject, head);
}

/**
 * Fail closed when the value statement of a body is a selection whose arms
 * are statements. Used by `compileFunction()` (`pythonAssertReturnableBody`)
 * and by `compile()`, where the emitted `if:`/`else:` block has no `return`
 * either: `If(x > 0, Block(s ≔ x; s + 1), 0)` gave a body that ran to `None`
 * where the interpreter gives `4` at `x = 3`.
 *
 * With `valueArmsOnly` (the `compile()` route), only a statement arm that
 * has a value — a block that ends with a value, or an assignment — declines.
 * An arm that is a `Break`, a `Continue` or a `Loop` keeps the statement
 * form on that route.
 */
function pythonAssertReturnableSelection(
  subject: string,
  expr: Expression,
  valueArmsOnly = false
): void {
  const declines = valueArmsOnly ? pythonArmCarriesValue : pythonArmIsStatement;
  // The third shape, which `statementBodyHead` does not report: a selection
  // whose arms are statements (`If(c, r ≔ 1, r ≔ 2)`) lowers to an
  // `if:`/`else:` BLOCK (`compilePythonIfStatement`), and a block cannot be
  // returned any more than an assignment can — the emission would be
  // `return if …:`. Nor may the `return` simply be dropped: the block's value
  // is the selection's, so a `def` that fell through would answer `None` where
  // the interpreter answers the assigned value.
  let value = expr;
  while (isFunction(value, 'Block') && value.ops.length > 0)
    value = value.ops[value.ops.length - 1];
  // A `Return` in a branch is not a statement there: in this tail position
  // it gives the value of the branch (`BaseCompiler.tailValue`), so
  // `If(c, Return(1), Return(5))` compiles as the conditional `1 if c else 5`.
  value = BaseCompiler.tailValue(value, true);
  if (
    isFunction(value, 'If') &&
    (declines(value.ops[1]) || declines(value.ops[2]))
  )
    throw new Error(
      `Could not compile ${compileSubject(subject)}: the body's value statement is a selection whose branches ` +
        `are statements, which Python writes as an \`if:\`/\`else:\` block — ` +
        `and a block cannot be returned, so this route would emit ` +
        `\`return if …:\`. Give the block a VALUE statement ` +
        `(\`Block(If(c, r ≔ 1, r ≔ 2); r)\`), which compiles to the \`if\` ` +
        `block followed by \`return r\`.`
    );
  // On the `compile()` route, a selection with a `Break`, a `Continue` or a
  // `Loop` branch keeps the statement form. A statement has no value, so the
  // value of the other branch is lost: `If(x > 0, Break, 1)` emitted
  // `if 0 < x: break else: 1`, where the value `1` is computed and dropped.
  // A selection that mixes the two kinds of branch is refused, and the
  // expression runs through the interpreter. A `Return` in a branch is a
  // value here (`tailValue` above replaced it with its value).
  if (valueArmsOnly && isFunction(value, 'If')) {
    const kinds = pythonArmResultKinds(value);
    if (kinds.has('control') && kinds.has('value'))
      throw new Error(
        `Could not compile ${compileSubject(subject)}: the body's value statement is a selection that ` +
          `mixes a control-flow branch (\`Break\`, \`Continue\` or a loop) ` +
          `with a value branch. Python writes such a selection as an ` +
          `\`if:\`/\`else:\` block, which has no value, so the value of the ` +
          `other branch would be lost.`
      );
  }
}

/**
 * Fail closed when `compileFunction()` was given a block whose last statement
 * is an assignment (`isTailAssignmentBlock`, which `pythonAssertReturnableBody`
 * lets through) and the emitted body is not a statement sequence that ends
 * with `return <name>`. A single-statement block with no local is unwrapped to
 * its statement and emits the single line `s = x`, which the single-line
 * branch of `compileFunction()` would turn into `return s = x`.
 *
 * The body is accepted only when its last line is `return <name>` and the
 * line before it is the assignment `<name> = …`. A last line that only starts
 * with `return` is not enough: when the block hook does not recognize the
 * assignment target, it puts `return` in front of the whole assignment
 * (`return a[0] = x`), which does not parse; and a last assignment whose
 * value is a nested block can emit a `return` of that block before
 * `return <name>`.
 */
function pythonAssertReturnedBlock(
  subject: string,
  expr: Expression,
  body: string
): void {
  if (!isTailAssignmentBlock(expr)) return;
  const lines = body.split('\n');
  const returned = /^return\s+([^\s;]+);?$/.exec(lines[lines.length - 1]);
  if (
    lines.length > 1 &&
    returned !== null &&
    lines[lines.length - 2].startsWith(`${returned[1]} = `)
  )
    return;
  throw pythonStatementBodyError(subject, statementBodyHead(expr) ?? 'Assign');
}

/**
 * The error of a `compileFunction()` body whose value statement is an
 * assignment or a declaration that this route cannot return.
 */
function pythonStatementBodyError(
  subject: string,
  head: 'Assign' | 'Declare'
): Error {
  return new Error(
    `Could not compile ${compileSubject(subject)}: the body's value statement is ` +
      (head === 'Assign'
        ? 'an assignment'
        : 'a declaration (which this target emits as nothing at all)') +
      `, and a Python statement cannot be returned — this route would emit ` +
      `\`return ${head === 'Assign' ? 's = x' : ''}\`, which does not parse. ` +
      `Give the block a VALUE statement (\`Block(s ≔ x; s)\`), which compiles ` +
      `to \`def f(x):\\n    s = x\\n    return s\`.`
  );
}

/**
 * Compile `Max`/`Min`, which **reduce** (fold every operand — including a
 * collection's elements — to a single extremum). A collection operand is
 * reduced with `np.max`/`np.min`; the per-operand results are then combined
 * with the element-wise `np.maximum`/`np.minimum`, which keeps scalar/array
 * operands (the plot variable) vectorized. `np.maximum`/`np.minimum` are
 * strictly binary, so an n-ary fold is emitted. Passing one list directly to
 * the element-wise function is both the wrong operation and a runtime error.
 */
function compilePythonExtremum(
  reduce: 'np.max' | 'np.min',
  pairwise: 'np.maximum' | 'np.minimum',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  // An operand that is not provably a collection but may be one
  // (`broadcastable<number>`, `matrix | missing`, `list<vector<2>> | missing`)
  // is reduced too: NumPy reduces a number to itself and a list to its
  // extremum. Read as a scalar, the whole list was the answer. An absent
  // value (`None`) gives `NaN`, as the interpreter's extremum of an absent
  // collection does. An empty list (`np.max([])` raises) gives `NaN` alone,
  // as `Max([])` does. Beside other operands, an empty list is skipped
  // (`None`), as `Max([], 5)` ignores it (`5`), and the answer is `NaN`
  // when every operand is skipped (`Max([], [])`), as in the interpreter.
  const empty = args.length === 1 ? "float('nan')" : 'None';
  let mayBeEmpty = false;
  const parts = args.map((a) => {
    if (isPyCollectionOperand(a)) return `${reduce}(${compile(a)})`;
    if (
      pyCouldBeIndexedCollectionOperand(a) ||
      containsBroadcastableType(a.type.type)
    ) {
      mayBeEmpty = true;
      return `(lambda _v: float('nan') if _v is None else (${empty} if np.size(_v) == 0 else ${reduce}(_v)))(${compile(a)})`;
    }
    return compile(a);
  });
  if (parts.length === 0) return reduce === 'np.max' ? '-np.inf' : 'np.inf';
  if (parts.length > 1 && mayBeEmpty)
    return `(lambda _ys: float('nan') if len(_ys) == 0 else ${reduce}(_ys))([_y for _y in (${parts.join(', ')}) if _y is not None])`;
  // ONE scalar operand emits no call at all — the lowering is the operand's
  // own code — so it is parenthesized on the identity-passthrough rule (see
  // `pyIdentityPassthrough`): `2·max(x + 1)` emitted `2 * x + 1`, which is
  // `2x + 1`. A collection operand already carries its `np.max(…)` call.
  if (parts.length === 1 && !isPyCollectionOperand(args[0]))
    return pyIdentityPassthrough(args[0], parts[0], target);
  let result = parts[0];
  for (let i = 1; i < parts.length; i++)
    result = `${pairwise}(${result}, ${parts[i]})`;
  return result;
}

/**
 * Compile `Transpose`/`ConjugateTranspose`, optionally wrapping the operand in
 * `wrap` (`np.conjugate`).
 *
 * The interpreter honors the explicit axes ONLY in the three-operand form
 * (`ops.length === 3`); with one or two operands it swaps the last two axes and
 * IGNORES a lone `axis1` — so dropping that operand here matches the
 * interpreter. In the three-operand form, `np.swapaxes` is the exact analogue
 * of the 1-based axis pair; `np.transpose` expects a whole permutation instead.
 */
function compilePythonTranspose(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  wrap?: string
): string {
  if (args[0] == null)
    throw new Error('Could not compile `Transpose`: missing argument');
  const x = wrap ? `${wrap}(${compile(args[0])})` : compile(args[0]);
  if (args.length < 3) return `np.transpose(${x})`;
  if (args.length > 3 || args[1] == null || args[2] == null)
    throw new Error(
      `Could not compile \`Transpose\`: only the (value) and (value, axis1, axis2) forms compile.`
    );
  return `np.swapaxes(${x}, int(${compile(args[1])}) - 1, int(${compile(
    args[2]
  )}) - 1)`;
}

/**
 * Compile a statistic over the interpreter's flattened SAMPLE. `Mean`, `Median`,
 * `Variance` and `StandardDeviation` are variadic
 * (`((collection|number|distribution)+) -> number`) and the interpreter
 * flattens EVERY operand into a single sample (`Mean([2,3],[5,7])` is 4.25,
 * `Mean(2,3,7)` is 4). The bare `'np.mean'`/… string mappings emitted
 * `np.mean(a, b, …)`, whose second and third positional parameters are numpy's
 * `axis` and `dtype` — a runtime TypeError, or a silently different reduction.
 * More than one operand is therefore spliced into one list.
 */
/**
 * Fail closed for a built-in `Add`/`Multiply`/`Min`/`Max` fold (`Reduce`,
 * `Scan`) whose elements are collections. Python's `+` joins two lists
 * (`Scan([[1, 2], [3, 5]], Add)` gave `[[1, 2], [1, 2, 3, 5]]`) and `sum`
 * raises, while the interpreter adds rows element by element. This target
 * has no element-wise fold, so the interpreter answers.
 */
function pyRefuseBuiltinFoldOverCollections(
  operator: string,
  coll: Expression | undefined
): void {
  // Elements that may be numbers or collections (`number | vector<2>`), and
  // the elements of an operand with a `missing` arm, are read by
  // `elementsMayBeCollections`. This target has no rule of its own for a
  // tensor of unknown rank or a `broadcastable<T>` (whose elements may be
  // rows), so such an operand is refused too (`false`).
  if (
    coll !== undefined &&
    (isDefinitelyCollectionType(BaseCompiler.collectionElementTypeOf(coll)) ||
      elementsMayBeCollections(coll.type.type, false))
  )
    throw new Error(
      `Could not compile \`${operator}\`: a built-in fold over elements that are collections. ` +
        `The interpreter evaluates it instead.`
    );
}

/** The operator each NumPy statistic of `compilePythonSample` compiles, for
 * its error messages. */
const PY_SAMPLE_OPERATOR: Record<string, string> = {
  'np.mean': 'Mean',
  'np.median': 'Median',
  'np.var': 'Variance',
  'np.std': 'StandardDeviation',
};

function compilePythonSample(
  fn: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  kwargs = ''
): string {
  if (args.length === 0 || args[0] == null)
    throw new Error(`Could not compile \`${fn}\`: no argument`);
  // One operand that is a tensor of unknown rank or a `broadcastable<T>`
  // (refused only by the `false` reading below): a number or a list of
  // numbers is a sample NumPy reads as the interpreter does, and a matrix is
  // an `incompatible-type` error in the interpreter. The emitted code checks
  // the rank when it runs.
  const single = args.length === 1 ? args[0] : undefined;
  if (
    single !== undefined &&
    !isDefinitelyCollectionType(
      collectionElementType(resolveTypeForCompilation(single.type.type))
    ) &&
    !elementsMayBeCollections(single.type.type, true) &&
    elementsMayBeCollections(single.type.type, false)
  ) {
    const name = PY_SAMPLE_OPERATOR[fn] ?? fn;
    return `(lambda _d: ${fn}(_d${kwargs}) if np.ndim(_d) <= 1 else (_ for _ in ()).throw(TypeError('${name}: an element of the data is a list at run time')))(${compile(single)})`;
  }
  // A list operand whose elements are collections (a list of lists): NumPy
  // computes over every number in it, while the interpreter answers an
  // `incompatible-type` error (`Mean([[1, 2], [3, 5]])`). Refusing lets the
  // interpreter answer. Several list operands are flattened one level below,
  // as the interpreter does.
  // Elements that may be numbers or collections (`number | vector<2>`), and
  // the elements of an operand with a `missing` arm, are read by
  // `elementsMayBeCollections`: `np.mean` of `[[3, 4], [5, 6]]` is 4.5. A
  // tensor of unknown rank and a `broadcastable<T>` are refused too
  // (`false`): this target has no rule of its own for them.
  if (
    args.some(
      (a) =>
        isDefinitelyCollectionType(
          collectionElementType(resolveTypeForCompilation(a.type.type))
        ) || elementsMayBeCollections(a.type.type, false)
    )
  )
    throw new Error(
      `Could not compile \`${PY_SAMPLE_OPERATOR[fn] ?? fn}\`: an element of the data is a collection ` +
        `(a list, a string, a set or a dictionary). The interpreter evaluates it instead.`
    );
  if (args.length === 1) return `${fn}(${compile(args[0])}${kwargs})`;
  const parts = args.map((a) =>
    isPyCollectionOperand(a) ? `*${compile(a)}` : compile(a)
  );
  return `${fn}([${parts.join(', ')}]${kwargs})`;
}

/**
 * Compile the FUNCTION form of a chained relation (`Less(a, b, c)`) — reached
 * when an operand is a collection; the scalar case goes through the infix
 * operator route and its `chainOp`.
 *
 * `np.less`/`np.greater_equal`/… are strictly BINARY ufuncs whose third
 * positional parameter is `out`, so the bare string mappings turned
 * `Less(a, b, c)` into `np.less(a, b, c)`: a TypeError on lists and, on
 * ndarrays, `a < b` written INTO `c` — the chain's third operand silently
 * dropped AND clobbered. Chain pairwise with `np.logical_and` instead, matching
 * the interpreter's element-wise `Less([1,9],[3,4],[5,6]) → [True, False]`. The
 * shared middle operands are bound once in an immediately-applied lambda, so
 * each is evaluated exactly once (as the infix route does through `bindExpr`).
 *
 * Every ufunc application — the binary form and each pair of a chain — is
 * emitted through the `_ce_ord` shape guard, because NumPy silently BROADCASTS
 * a 1-element operand over an n-element one where the interpreter reports
 * `incompatible-dimensions`. See `PYTHON_ORD_HELPER`.
 */
function compilePythonRelation(
  fn: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  kind: string
): string {
  if (args.length < 2)
    throw new Error(
      `Could not compile \`${fn}\`: expected at least two operands`
    );
  // The comparison gates. All are reached HERE for every ordering the infix
  // route declines as well: the base compiler diverts a mixed-string,
  // aggregate, or collection-TYPED ordering off the infix `<` so the head falls
  // through to this codegen, which fails closed. No tuple carve-out — the
  // orderings never take one (the interpreter leaves `Less(Tuple, Tuple)`
  // symbolic), and the point-list shape the aggregate gate admits for equality
  // is closed here by `assertPyNoNestedTupleOrdering`.
  assertPyComparableAggregate(kind, args);
  assertPyNoCharacterOperand(kind, args);
  assertPyNoNestedTupleOrdering(kind, args);
  assertPyNoMixedStringOrdering(kind, args);
  if (args.length === 2)
    return `_ce_ord(${fn}, ${compile(args[0])}, ${compile(args[1])})`;
  const names = args.map((_, i) => `_r${i}`);
  let body = `_ce_ord(${fn}, ${names[0]}, ${names[1]})`;
  for (let i = 1; i < args.length - 1; i++)
    body = `np.logical_and(${body}, _ce_ord(${fn}, ${names[i]}, ${names[i + 1]}))`;
  return `(lambda ${names.join(', ')}: ${body})(${args
    .map((a) => compile(a))
    .join(', ')})`;
}

/**
 * Compile the FUNCTION form of `And`/`Or` (reached for a collection operand).
 * `np.logical_and`/`np.logical_or` are binary ufuncs whose third positional
 * parameter is `out` — see `compilePythonRelation`. These are associative, so a
 * plain pairwise fold suffices (no operand is shared between pairs).
 *
 * Each pair goes through the `_ce_ord` shape guard, because NumPy recycles a
 * one-element list over a longer one where the interpreter answers
 * `incompatible-dimensions` (`And([True], [True, False])`). The operands are
 * checked first (`assertPyBroadcastableConnective`).
 */
function compilePythonLogical(
  head: 'And' | 'Or',
  fn: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  if (args.length === 0 || args[0] == null)
    throw new Error(`Could not compile \`${fn}\`: no operand`);
  assertPyBroadcastableConnective(head, args, 'list<boolean>');
  let result = compile(args[0]);
  for (let i = 1; i < args.length; i++)
    result = `_ce_ord(${fn}, ${result}, ${compile(args[i])})`;
  return result;
}

/** The heads whose Python codegen receives a collection operand whole
 * (`CompileTarget.collectionAwareHeads`). */
const PYTHON_COLLECTION_AWARE_HEADS: ReadonlySet<string> = new Set([
  'Not',
  'Argument',
]);

/**
 * The operand rule of the function form of a connective (`And`, `Or`, `Not`).
 * The base compiler sends a connective to this form when an operand is, or
 * may be, a collection, since the infix `and`/`or`/`not` would read the
 * truthiness of a Python list. NumPy's `np.logical_*` agrees with the
 * interpreter's element-wise broadcast only when every operand is a boolean
 * or a collection of booleans of the type `collectionType`:
 *
 * - an operand that is only POSSIBLY a collection (`broadcastable<boolean>`,
 *   a value of unknown type) can be a scalar at run time, and the result is
 *   then a NumPy boolean, not the Python `bool` that the scalar lowering
 *   gives;
 * - a collection that may hold an absent element (`list<boolean | missing>`)
 *   or a non-boolean is read by truthiness: NumPy answers `True` for a `nan`
 *   element where the interpreter keeps it absent;
 * - for `And`/`Or`, a nested collection is refused (`collectionType` is
 *   `list<boolean>`), because `_ce_ord` checks the length of the outer axis
 *   only and NumPy recycles a one-element inner axis.
 *
 * Every other shape fails closed, and the interpreter evaluates it. CE-278.
 */
function assertPyBroadcastableConnective(
  head: string,
  args: ReadonlyArray<Expression>,
  collectionType: string
): void {
  args.forEach((a, i) => {
    // `isSubtype`, not `.matches`: a value of unknown type matches `boolean`,
    // but it is no evidence that the operand is a boolean.
    const t = resolveTypeForCompilation(a.type.type);
    if (t !== 'never' && isSubtype(t, 'boolean')) return;
    if (
      t !== 'never' &&
      !isProvablyStringOperand(a) &&
      isSubtype(t, collectionType)
    )
      return;
    throw new Error(
      `Could not compile \`${head}\`: operand ${i + 1} has the type ` +
        `\`${a.type.toString()}\`. A logical connective over a collection ` +
        `compiles only when every operand is a boolean or a collection of ` +
        `the type \`${collectionType}\`. The interpreter evaluates it instead.`
    );
  });
}

/**
 * Python/NumPy function implementations
 *
 * Maps mathematical functions to their NumPy equivalents.
 * Most functions are available in the numpy module with np. prefix.
 */
/**
 * Compile a `Join`, or a `ListJoin` (the list literal with a spread), as a
 * Python list of the elements of its operands.
 */
function compilePyJoin(
  head: 'Join' | 'ListJoin',
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  if (args.length === 0) return '[]';
  // An absent operand (`Missing`, `Undefined`) is an absent collection, and
  // the interpreter answers `Missing` for the whole join (user decision
  // 2026-09-26). The scalar arm below compiled it as one `nan` element
  // (`[math.nan, 3]`), so the call fails closed.
  const absent = args.findIndex(
    (a) => isSymbol(a, 'Missing') || isSymbol(a, 'Undefined')
  );
  if (absent >= 0)
    throw new Error(
      `Could not compile \`${head}\`: operand ${absent + 1} is absent, and the ` +
        `interpreter answers \`Missing\` for the whole join. The interpreter ` +
        `evaluates it instead.`
    );
  // A tuple (through an alias or an all-tuple union:
  // `isProvablyTupleParticipant`), or a scalar whose type proves it is not
  // a collection, is one ELEMENT, as the interpreter's `isAtomicJoinOperand`
  // reads it (`Join([1, 2], 3)` is `[1, 2, 3]`); only a collection is
  // unpacked.
  const atomic = (a: Expression): boolean =>
    isProvablyTupleParticipant(a) ||
    !couldMatch(resolveTypeForCompilation(a.type.type), COLLECTION_SHAPE_TYPE);
  return `[${args
    .map((a, i) =>
      atomic(a) ? compile(a) : `*${pyCollArg(head, a, compile, i + 1)}`
    )
    .join(', ')}]`;
}

/**
 * Compile a collection operand, failing closed if it is not an indexed
 * collection (list/vector/range) — the Python analog of the JavaScript
 * target's `collArg`. (Local copy of `isIndexedCollectionOperand` to avoid
 * a cross-target import of a 2-line predicate.)
 */
function pyCollArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position?: number
): string {
  // A STRING is an indexed collection of its GRAPHEME CLUSTERS, and this
  // target cannot produce them: Python's stdlib has no UAX #29 segmentation,
  // so `len(s)` counts code points and `s[i]` selects one — both diverging from
  // the interpreter on a combining sequence, a ZWJ emoji family or a
  // regional-indicator flag. Named separately from the generic diagnostic
  // below, so the reason is the target capability rather than a shape
  // mismatch (the shape now MATCHES).
  // (`docs/STRING_ROADMAP.md`, decision D13.)
  if (arg && arg.type.matches('string'))
    throw new Error(
      `Could not compile \`${kind}\`: a string collection — a ` +
        `string's elements are UAX #29 grapheme clusters and Python has no ` +
        `stdlib grapheme segmentation, so the emitted code would walk code ` +
        `points instead. The interpreter evaluates it.`
    );
  // A collection of CHARACTERS is closed for the same capability reason: an
  // element is one grapheme cluster this target cannot order or re-segment.
  if (arg) assertPyNoCharacterOperand(kind, [arg]);
  // An operand that may be one string at run time without being provably a
  // string (`string | list<string>`, `broadcastable<string>`) matches
  // `indexed_collection<any>` below, through its string arm. The emitted
  // code would then read a string by code point: `First(p)` gave `_l[0]`.
  // It is closed for the same reason as a string.
  if (arg && couldBeStringOperand(arg))
    throw new Error(
      `Could not compile \`${kind}\`: ${position !== undefined ? `operand ${position}` : 'the operand'} ` +
        `may be text at run time (type \`${arg.type.toString()}\`), and ` +
        `Python has no stdlib grapheme segmentation. The interpreter ` +
        `evaluates it.`
    );
  if (
    !arg ||
    !(
      arg.type.matches('list<any>') ||
      arg.type.matches('indexed_collection<any>')
    )
  )
    throw new Error(
      `Could not compile \`${kind}\`: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `is not an indexed collection (list/vector/range).`
    );
  return compile(arg);
}

/**
 * The Python expression of the absence marker for an element read of the
 * collection `coll` that selects no element: an out-of-range position, or a
 * collection that is absent as a whole (`None` at run time, the value of a
 * restriction whose condition is false). The interpreter answers the marker
 * of the element domain (user decision of 2026-09-26, `docs/ERROR-MODEL.md`
 * §2, and `absenceMarker()` in `library/collections.ts`):
 *
 * - `float('nan')` when the element type, less its `missing` arm, is a
 *   number;
 * - `None` (the Python spelling of `Missing`) when it is a settled type that
 *   is not a number: a row, a point, a string;
 * - when the element type is not known (`unknown`, `any`), a test at run
 *   time, as the interpreter looks at the cells: `float('nan')` when the
 *   first 10 cells that are not `None` are all numbers and there is at least
 *   one, `None` otherwise (and for an absent collection). The emitted test
 *   reads the sequence through the name `_l`, which every caller binds.
 *
 * The element type is read from the collection type with its `missing` arm
 * removed: a restricted collection is typed `missing | list<…>`, and its
 * element domain is that of the list.
 */
function pyAbsenceMarker(coll: Expression): string {
  const collT = stripMissingFromType(resolveTypeForCompilation(coll.type.type));
  // What an index returns (`indexElementType`): for a `broadcastable<T>`
  // whose `T` can hold a list, the elements of `T` too.
  return pyAbsenceMarkerOfElementType(indexElementType(collT));
}

/**
 * The Python expression of the absence marker for a read whose type is
 * `eltT` (see `pyAbsenceMarker`). `undefined` is a type that is not known.
 */
function pyAbsenceMarkerOfElementType(eltT: Type | undefined): string {
  const present =
    eltT === undefined
      ? undefined
      : stripMissingFromType(resolveTypeForCompilation(eltT));
  // An element type with an arm that may be a number beside other arms
  // (`number | vector<2>`, `list<unknown> | unknown`) does not decide the
  // marker: the run-time reading below picks it from the value, as the
  // interpreter does.
  const mixed =
    present !== undefined &&
    typeof present !== 'string' &&
    present.kind === 'union' &&
    !isSubtype(present, 'number') &&
    present.types.some((arm) => {
      const a = resolveTypeForCompilation(arm);
      return a === 'unknown' || a === 'any' || isSubtype(a, 'number');
    });
  if (
    present !== undefined &&
    !mixed &&
    present !== 'unknown' &&
    present !== 'any' &&
    present !== 'never'
  )
    return isSubtype(present, 'number') ? "float('nan')" : 'None';
  // An element type that is not known reads the first 10 elements, as the
  // interpreter's probe does (`MAX_ABSENCE_MARKER_PROBE`). A mixed element
  // type reads every element: the interpreter then picks the marker from
  // the type of the whole value, so a list of 10 numbers and one list is
  // read as a list of lists.
  const probe = mixed ? 'list(_l)' : 'list(_l)[:10]';
  return `((lambda _c: float('nan') if len(_c) > 0 and all(isinstance(_x, (int, float, complex, np.number)) and not isinstance(_x, (bool, np.bool_)) for _x in _c) else None)([_x for _x in ${probe} if _x is not None]) if isinstance(_l, (list, tuple, np.ndarray)) else None)`;
}

/**
 * The two absence markers of the element read at the 1-based `position` (a
 * negative position counts from the end; `undefined` when the position is
 * not a literal integer) of `coll`:
 * - `absent`, when `coll` is absent at run time (`None`);
 * - `outOfRange`, when the position selects no element.
 *
 * Both are the marker of the element domain (`pyAbsenceMarker`), except
 * for a base typed by a tuple, where the interpreter reads the type of one
 * slot, not the join of all the slots:
 * - a position outside the tuple of a value takes the marker from the
 *   slot type (`tupleSlotReadType`): `tuple<unknown, number>` has an
 *   `unknown` slot, so the marker is picked from the cells of the value
 *   (`Missing` for `("s", 2)`, `NaN` for `(3, 2)`), not `NaN` from the join;
 * - an absent base gives `float('nan')` when the read is a number and
 *   `None` otherwise (`absentBaseReadIsNumeric`). So with
 *   `b: list<tuple<number, string>>` and `b = []`, `At(At(b, 1), 1)` is
 *   `NaN` and `At(At(b, 1), 2)` is `Missing`, as in the interpreter. Before,
 *   both were `None`.
 *
 * The JavaScript target applies the same rule (`absent-tuple-read.ts`).
 */
function pyReadMarkers(
  coll: Expression,
  position: number | undefined
): { absent: string; outOfRange: string } {
  const marker = pyAbsenceMarker(coll);
  if (position === undefined || !Number.isInteger(position) || position === 0)
    return { absent: marker, outOfRange: marker };
  const collT = resolveTypeForCompilation(coll.type.type);
  const slotT = tupleSlotReadType(collT, position);
  const outOfRange =
    slotT === undefined ? marker : pyAbsenceMarkerOfElementType(slotT);
  const present = resolveTypeForCompilation(stripMissingFromType(collT));
  const isTuple = typeof present !== 'string' && present.kind === 'tuple';
  const absent = absentBaseReadIsNumeric(coll, position)
    ? "float('nan')"
    : isTuple
      ? 'None'
      : marker;
  return { absent, outOfRange };
}

/**
 * The element at 0-based position `k` of `arg` (`-1` is the last), for the
 * compiled `First`/`Second`/`Third`/`Last`. A position past the end, and an
 * operand that is absent as a whole, answer the absence marker of the
 * element domain (`pyAbsenceMarker`).
 *
 * An operand that can be absent as a whole (a restriction, typed
 * `missing | list<…>`) is admitted when its present type is an indexed
 * collection, as in the interpreter; it is `None` at run time when absent.
 * Any other operand goes through `pyCollArg`, which refuses a string and an
 * operand that is not an indexed collection.
 */
function pyNthElement(
  kind: string,
  arg: Expression | undefined,
  k: number,
  compile: (expr: Expression) => string
): string {
  let code: string;
  if (arg !== undefined && typeContainsMissing(arg.type.type)) {
    const present = stripMissingFromType(
      resolveTypeForCompilation(arg.type.type)
    );
    if (
      present === 'never' ||
      isSubtype(present, 'string') ||
      !isSubtype(present, INDEXED_COLLECTION_SHAPE_TYPE) ||
      couldBeStringOperand(arg)
    )
      code = pyCollArg(kind, arg, compile);
    else {
      assertPyNoCharacterOperand(kind, [arg]);
      code = compile(arg);
    }
  } else code = pyCollArg(kind, arg, compile);
  const { absent, outOfRange } = pyReadMarkers(arg!, k < 0 ? k : k + 1);
  const read =
    k < 0 ? `_l[${k}] if len(_l) >= ${-k}` : `_l[${k}] if len(_l) > ${k}`;
  return `(lambda _l: ${absent} if _l is None else (${read} else ${outOfRange}))(${code})`;
}

/**
 * The Python analogs of the JavaScript target's `couldBeIndexedCollectionOperand`
 * / `isNumericIndexOperand` (kept local, like `pyCollArg`, to avoid a
 * cross-target import): a base whose static type merely ADMITS an indexed
 * collection — a union with an indexed arm, the shape a lambda parameter
 * indexed in its body carries (`dictionary | indexed_collection`) — is admitted
 * on the RUNTIME-projection rule, but only with a provably numeric index, since
 * the other arm is a dictionary and a keyed lookup has no compiled equivalent.
 * A top type is not admitted: that is "nothing is known", not "a collection is
 * possible".
 */
function pyCouldBeIndexedCollectionOperand(e: Expression): boolean {
  const t = resolveTypeForCompilation(e.type.type);
  if (t === 'unknown' || t === 'any' || t === 'value') return false;
  // A string is not an array-shaped operand — see `isPyCollectionOperand`.
  if (t === 'string') return false;
  if (typeof t === 'object' && t.kind === 'union')
    return t.types.some((m) => isSubtype(m, INDEXED_COLLECTION_SHAPE_TYPE));
  return isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE);
}

function pyIsNumericIndexOperand(e: Expression): boolean {
  return isSubtype(resolveTypeForCompilation(e.type.type), 'number');
}

/**
 * Compile a mapping/predicate operand for the Python target. A `Function`
 * literal compiles through the target's lambda handler; a bare binary
 * arithmetic operator symbol lowers to a Python lambda. Anything else —
 * notably a user-defined function symbol, which the shared user-function
 * registry would emit as *JavaScript* source — fails closed: without
 * this guard the base compiler emits a JS arrow function inside otherwise
 * valid Python.
 */
function pyFnArg(
  kind: string,
  op: Expression | undefined,
  compile: (expr: Expression) => string,
  argTypes: ReadonlyArray<Type | undefined> = []
): string {
  // A parameter ANNOTATION the emitted lambda cannot enforce fails closed
  // (D6), exactly as on the JavaScript target — see
  // `BaseCompiler.assertCallbackAnnotations`. Callers pass the provable type
  // of the value each parameter position receives; an empty list means
  // nothing is provable, so any annotation declines.
  BaseCompiler.assertCallbackAnnotations(kind, op, argTypes);
  // The predicate of `Filter`, `Any`, `TakeWhile` and the other operators
  // of `PREDICATE_RESULT_MODES` is checked at each call when its result type
  // does not prove a boolean, and refused when it cannot be one
  // (`predicateResultCheck`, shared with the JavaScript target). The
  // lowerings test the result with the truthiness of Python, so `1` selected
  // an element, and so did `nan`, the spelling of `Missing` on this target.
  const mode = PREDICATE_RESULT_MODES[kind];
  if (
    mode !== undefined &&
    op !== undefined &&
    predicateResultCheck(kind, op)
  ) {
    // This target spells `Missing` as a float `nan`, so `_ce_predicate` reads
    // a `nan` result as an absent value, and a selecting predicate skips the
    // element. A numeric `NaN` result is not absent: the interpreter reports
    // it as a predicate result that is not a boolean. A Python `nan` cannot
    // tell the two apart, so a selecting predicate whose result type admits
    // `NaN` is refused here, and a `nan` at run time is then always the
    // spelling of `Missing`. A prefix predicate ends the prefix on both
    // values, and a quantifier raises on both, so these need no refusal.
    if (mode === 'select') {
      const result = functionResult(resolveTypeForCompilation(op.type.type));
      if (result === undefined || couldMatch(result, 'nan'))
        throw new Error(
          `Could not compile \`${kind}\` to Python: the predicate may return ` +
            `\`NaN\`` +
            (result === undefined
              ? ''
              : ` (its result type is \`${typeToString(result)}\`)`) +
            `, which this target cannot tell apart from the absent value ` +
            `\`Missing\`. The interpreter reports \`NaN\` as a predicate ` +
            `result that is not a boolean, and skips \`Missing\`. The ` +
            `interpreter evaluates it instead.`
        );
    }
    return `_ce_predicate(${pyCallbackArg(kind, op, compile)}, '${kind}', '${mode}')`;
  }
  return pyCallbackArg(kind, op, compile);
}

/** `pyFnArg` without the check of a predicate's result. */
function pyCallbackArg(
  kind: string,
  op: Expression | undefined,
  compile: (expr: Expression) => string
): string {
  if (op && isFunction(op, 'Function')) return compile(op);
  if (op && isSymbol(op)) {
    const glyph = { Add: '+', Subtract: '-', Multiply: '*', Divide: '/' }[
      op.symbol
    ];
    if (glyph !== undefined) return `(lambda _a, _b: _a ${glyph} _b)`;
  }
  throw new Error(
    `Could not compile \`${kind}\`: the function operand has no Python form ` +
      `(only function literals and binary arithmetic operator symbols ` +
      `lower to a Python lambda).`
  );
}

// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
/**
 * Python’s way of asking whether a fragment holds a value a comparison can
 * decide — that is, whether it is not NaN. `x == x` is false for exactly one
 * value in Python, as `x === x` is in JavaScript.
 */
const PYTHON_DECIDED_NUMBER = (x: string): string => `${x} == ${x}`;

/** `code`, parenthesized unless it is a primary expression
 * (`BaseCompiler.isAtomicSource`), for an operand of a binary operator. */
const pyOperand = (code: string): string =>
  BaseCompiler.isAtomicSource(code) ? code : `(${code})`;

/** A fragment that is already a name or a constant, so naming it again costs
 * nothing and evaluates nothing. The base compiler applies the same test. */
const PYTHON_ATOM = /^[\w.]+$/;

/**
 * A complete Python real number literal, with an optional sign: `9`, `-9`,
 * `2.5`, `.5`, `1e-3`, `1_000`. The whole string must match, so an
 * expression that starts with a digit (`0 or None`) does not.
 */
const PYTHON_NUMBER_LITERAL =
  /^[-+]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d[\d_]*)?$/;

/**
 * Python’s test that a branch condition’s value is exactly a boolean.
 *
 * `is True` alone would be wrong: a comparison compiles to a NumPy call, whose
 * result is a `np.bool_` rather than the Python singleton. `== True` would be
 * wrong the other way, because `1 == True` is true in Python, and a value of
 * `1` must decide nothing.
 */
const pythonIsBoolean = (x: string): string =>
  `isinstance(${x}, (bool, np.bool_))`;

/**
 * Python’s spellings of the pieces a branch condition’s decidedness test is
 * built from. The tests themselves, and the way a connective combines its
 * operands’, are the compiler’s shared analysis
 * (`BaseCompiler.conditionDecidability`); only the wording is this target’s.
 *
 * `not` is a word, so it carries its own trailing space: the fragment it
 * precedes is a name or a parenthesized expression, and `notx` would be an
 * identifier.
 */
const PYTHON_CONDITION_DIALECT: ConditionDialect = {
  decidedNumber: PYTHON_DECIDED_NUMBER,
  and: 'and',
  not: 'not ',
  // `None` is the undecided value. Every three-valued fragment this lowering
  // builds is a `bool`, a `np.bool_` or `None`, so `is None` decides it
  // exactly — where `== None` and `is True` would not (`np.True_ is True` is
  // false, and `1 == True` is true).
  undecided: 'None',
  trueValue: 'True',
  falseValue: 'False',
  isTrue: (x) => `${x} is not None and ${x}`,
  isFalse: (x) => `${x} is not None and not ${x}`,
  isUndecided: (x) => `${x} is None`,
  kleeneOfValue: (x, negate) =>
    `((${negate ? `not ${x}` : x}) if ${pythonIsBoolean(x)} else None)`,
  ternary: (test, then, otherwise) => `(${then} if ${test} else ${otherwise})`,
  bind: (params, body, args) =>
    `(lambda ${params.join(', ')}: ${body})(${args.join(', ')})`,
};

// The value-position lowering of a comparison with an absent operand builds
// a three-valued condition itself (`BaseCompiler.compileAbsentRelation`), so
// it needs this target's spellings of the condition pieces.
BaseCompiler.conditionDialects.set('python', PYTHON_CONDITION_DIALECT);

/**
 * True when `expr` can lower to the Python absence value `None`: a
 * restriction (`When`), or any operand whose type holds a `missing` arm at
 * any depth (a `Which` with no default clause, a symbol declared with a
 * `missing` arm, a point with an absent coordinate). numpy functions such as
 * `np.dot` raise for `None`, where the interpreter answers an absence marker.
 */
function pythonMayBeAbsent(expr: Expression): boolean {
  return isFunction(expr, 'When') || typeContainsMissing(expr.type.type);
}

/**
 * The Python literal for an absent selection value over arms of the given
 * types: `None` when every arm is provably not a number (a string, a list),
 * `float('nan')` otherwise — an unknown type included. The rule is the base
 * compiler's (`BaseCompiler.absenceKind`), which the JavaScript lowering
 * follows with `undefined` and `NaN`, so the two targets answer absence the
 * same way and a compiled `IsMissing` agrees with the interpreter's
 * `Missing` in every domain.
 */
function pythonAbsent(
  arms: ReadonlyArray<Expression | undefined>,
  target: CompileTarget<Expression>
): string {
  // A written `Missing` arm does not decide the domain: `If(c, (x, y),
  // Missing)` is a point that may be absent, and its absence literal is
  // `None`, as for the else-less `If(c, (x, y))`. The arm's own type
  // (`missing`) would make it `float('nan')`.
  const present = arms.filter(
    (a) => a !== undefined && !pythonIsWrittenAbsence(a, target)
  );
  const types = (present.length > 0 ? present : arms).flatMap((a) =>
    a === undefined ? [] : [a.type.type]
  );
  return BaseCompiler.absenceKind(types, target) === 'object'
    ? 'None'
    : "float('nan')";
}

/**
 * True when `e` is a written absence symbol, `Missing` or `Undefined`, and
 * not a variable of that name (a bound name or a key of the caller's
 * `vars`, which keep their meaning, as in `BaseCompiler._compileInner`).
 */
function pythonIsWrittenAbsence(
  e: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (!isSymbol(e, 'Missing') && !isSymbol(e, 'Undefined')) return false;
  return (
    target.boundVars?.has(e.symbol) !== true &&
    target.varsKeys?.has(e.symbol) !== true
  );
}

/**
 * The code of the value arm `arm` of a selection whose absence literal is
 * `absent` (`pythonAbsent`). A written `Missing` (or `Undefined`) arm is that
 * literal: beside a point or a list it is `None`, the value the else-less
 * `If(c, (x, y))` and `When((x, y), c)` give, where the written symbol alone
 * compiles to `math.nan` on this target (`writtenSymbol: 'numeric'`). Any
 * other arm is compiled as it stands.
 */
function pythonSelectionArm(
  arm: Expression,
  code: () => string,
  absent: string,
  target: CompileTarget<Expression>
): string {
  return absent === 'None' && pythonIsWrittenAbsence(arm, target)
    ? 'None'
    : code();
}

/**
 * Does the branch condition `node` read a sub-expression by its VALUE (a
 * boolean input, a call, any condition that is not a relation)? Such a
 * value can be something other than a boolean at run time, which Python
 * truthiness would read as a decision.
 */
function conditionReadsAValue(node: ConditionNode): boolean {
  const t = node.test;
  if (t.kind === 'value') return true;
  if (t.kind === 'connective') return t.operands.some(conditionReadsAValue);
  return false;
}

/**
 * Produce a Python conditional expression that takes an arm only when its
 * condition is exactly `True` or `False` when the function runs. A condition
 * that is anything else takes neither arm and the value is the absence
 * literal of the arms' domain (`pythonAbsent`): `float('nan')` for a number.
 * The JavaScript target applies the same rule.
 *
 * The analysis behind it is the compiler’s, shared with the JavaScript code
 * (`BaseCompiler.conditionDecidability`), and so is the reason for it: a
 * comparison against NaN gives an ordinary `False` in Python exactly as it
 * does in JavaScript, so a condition that cannot be decided looks the same as
 * one decided to be false, and the difference has to be read off the
 * comparison’s operands. Only the wording of the tests is Python’s
 * (`PYTHON_CONDITION_DIALECT`).
 *
 * A condition built from `and`/`or`/`not` is decided by the same three-valued
 * (Kleene) tables the JavaScript target uses: an `and` is decided when one
 * operand is decided `False` — that operand settles the result whatever its
 * siblings hold — or when every operand is decided, and an `or` is the mirror
 * image. Python’s `and`/`or` short circuit and return an operand, exactly as
 * JavaScript’s `&&`/`||` do, so the connective’s ordinary emitted source is
 * the correct VALUE wherever that test holds.
 *
 * One case does not arise in Python. A compiled JavaScript function reads its
 * free symbols out of an object, where a missing entry is `undefined` and
 * every comparison against it is `false`, so the JavaScript tests include an
 * extra `!== undefined`. A compiled Python function takes its free symbols as
 * parameters, so a caller who omits one gets a `TypeError` at the call and no
 * value ever reaches a comparison. There is nothing to test, and the base
 * compiler adds no such test because this target has no such object.
 *
 * `thenCode` and `elseCode` arrive already parenthesized by the caller.
 */
function compilePythonBranch(
  cond: Expression,
  thenCode: string,
  elseCode: string,
  compileCond: (c: Expression) => string,
  target: CompileTarget<Expression>,
  // The value of an undecided condition: the absence literal of the arms'
  // domain (`pythonAbsent`). Defaults to the numeric spelling.
  absent: string = "float('nan')"
): string {
  const decidability = BaseCompiler.conditionDecidability(
    cond,
    target.bindExpr !== undefined,
    target
  );
  // The condition is decidable by construction, so it needs no extra test.
  if (decidability === null)
    return `((${thenCode}) if (${compileCond(cond)}) else (${elseCode}))`;

  if (
    decidability.test.kind === 'value' ||
    decidability.test.kind === 'connective'
  ) {
    // `Not` is applied by exchanging the two constants the tests compare
    // against, never by emitting `np.logical_not`: negating a value that is
    // not a boolean would produce a confident answer from no evidence.
    //
    // A condition that reaches a connective is compiled to its three-valued
    // value — `True`, `False` or `None` — and inspected the same way. The
    // negation, and the lazy bindings the lowering needs, are inside that
    // value, so nothing is exchanged here.
    const connective = decidability.test.kind === 'connective';
    const { expr, negate } = connective
      ? { expr: cond, negate: false }
      : BaseCompiler.peelNegations(cond);
    const code = connective
      ? BaseCompiler.kleeneCondition(
          decidability,
          target,
          PYTHON_CONDITION_DIALECT
        )
      : compileCond(expr);
    // The value is inspected twice (once for its kind, once for its truth), so
    // anything that is not already a name is bound to a lambda parameter and
    // evaluated once. Both arms stay inside the lambda, so an unselected arm
    // still never runs.
    const body = (v: string): string =>
      `((${thenCode}) if (${pythonIsBoolean(v)} and ${
        negate ? `not ${v}` : v
      }) else ((${elseCode}) if ${pythonIsBoolean(v)} else ${absent}))`;
    if (PYTHON_ATOM.test(code)) return body(code);
    return `(lambda _CND: ${body('_CND')})(${code})`;
  }

  // A comparison always produces a real boolean, so whether it could be
  // decided has to be read off its operands. An operand that costs something
  // to compute is bound to a name, which the condition then reads: the
  // condition contains the operand once and the tests name it twice more.
  const { value, bindings } = BaseCompiler.withConditionOperands(
    decidability.test.operands,
    target,
    target.bindExpr !== undefined,
    (conjuncts) => {
      const code = compileCond(cond);
      if (conjuncts.length === 0)
        return `((${thenCode}) if (${code}) else (${elseCode}))`;
      return `(((${thenCode}) if (${code}) else (${elseCode})) if (${conjuncts.join(
        ' and '
      )}) else ${absent})`;
    },
    PYTHON_CONDITION_DIALECT
  );
  return bindings.length === 0 ? value : target.bindExpr!(bindings, value);
}

/**
 * True when `arm` lowers to Python STATEMENTS, so an `If` that selects it has
 * no conditional-EXPRESSION emission and must be written as an `if:`/`else:`
 * statement block instead.
 *
 * Python assignment is a statement, not an expression (this target does not
 * emit the walrus operator), and so are `break`, `continue`, `return`, a loop
 * and a multi-statement sequence. JavaScript has no such split — `(s = -1)` is
 * an ordinary JavaScript expression — which is why the JavaScript target keeps
 * its ternary in this position and only Python needs the statement form:
 * `If(x > 0, r ≔ 1, r ≔ 2)` as a statement of a `Block` came out as
 * `((r = 1) if (0 < x) else (r = 2))`, which Python does not parse.
 *
 * The heads listed here are the ones `compilePythonStatements` lowers itself;
 * everything else it hands to `BaseCompiler.compile`, which produces an
 * expression. A `Block` of exactly one statement is that statement, so it is
 * read through. `Declare` is deliberately absent: this target emits nothing at
 * all for a declaration, so an `If` arm that is one has no honest statement
 * form either and keeps failing on the expression route.
 */
function pythonArmIsStatement(arm: Expression | undefined): boolean {
  if (arm === undefined) return false;
  // Unwraps a `Block` tail, so `Block(s ≔ 1)` and a nested one answer too.
  if (statementBodyHead(arm) === 'Assign') return true;
  if (!isFunction(arm)) return false;
  const h = arm.operator;
  if (h === 'Break' || h === 'Continue' || h === 'Return' || h === 'Loop')
    return true;
  // A `Block` of one statement IS that statement, so read it through: the
  // `Assign` unwrap above answers only for an assignment tail, and
  // `Block(break)` must reach the statement form the same way a bare `break`
  // does. Any other `Block` (empty, or a sequence) has no expression form.
  if (h === 'Block')
    return arm.ops.length !== 1 || pythonArmIsStatement(arm.ops[0]);
  // A nested selection is a statement exactly when one of ITS arms is.
  if (h === 'If')
    return pythonArmIsStatement(arm.ops[1]) || pythonArmIsStatement(arm.ops[2]);
  return false;
}

/**
 * Whether `arm` of a selection is a statement (`pythonArmIsStatement`) that
 * has a value: its last statement, read through nested blocks and
 * selections, is not a `Break`, a `Continue`, a `Return` or a `Loop`.
 */
function pythonArmCarriesValue(arm: Expression | undefined): boolean {
  if (!pythonArmIsStatement(arm)) return false;
  let tail = arm!;
  while (isFunction(tail, 'Block') && tail.ops.length > 0)
    tail = tail.ops[tail.ops.length - 1];
  if (isFunction(tail, 'If'))
    return (
      pythonArmCarriesValue(tail.ops[1]) || pythonArmCarriesValue(tail.ops[2])
    );
  return !(
    isFunction(tail) &&
    ['Break', 'Continue', 'Return', 'Loop'].includes(tail.operator)
  );
}

/**
 * The kinds of result the arms of a selection give, read through nested
 * blocks (the last statement of a block gives its result) and nested
 * selections: `'control'` for an arm that ends with a `Break`, a `Continue`
 * or a `Loop`, and `'value'` for any other arm that gives a value. An absent
 * arm and `Nothing` give neither kind.
 */
function pythonArmResultKinds(
  arm: Expression | undefined,
  kinds: Set<'control' | 'value'> = new Set()
): Set<'control' | 'value'> {
  if (arm === undefined || isSymbol(arm, 'Nothing')) return kinds;
  if (isFunction(arm, 'Block')) {
    if (arm.ops.length > 0)
      pythonArmResultKinds(arm.ops[arm.ops.length - 1], kinds);
    return kinds;
  }
  if (isFunction(arm, 'If')) {
    pythonArmResultKinds(arm.ops[1], kinds);
    pythonArmResultKinds(arm.ops[2], kinds);
    return kinds;
  }
  if (isFunction(arm) && ['Break', 'Continue', 'Loop'].includes(arm.operator))
    kinds.add('control');
  else kinds.add('value');
  return kinds;
}

/**
 * Compile an `If` in STATEMENT position — a statement of a `Block`, or of a
 * loop body — to a Python `if:`/`else:` statement block.
 *
 * A statement has no value, so a branch cannot be spliced into the conditional
 * expression `compilePythonBranch` builds: see `pythonArmIsStatement` for what
 * has no expression form in Python and why JavaScript needs none of this.
 *
 * The condition takes the SAME decidedness test the conditional expression
 * takes, read the statement way: a condition that is not exactly `True` or
 * `False` when the compiled function runs takes NEITHER branch, and execution
 * continues with the next statement. That is the interpreter's own inertness —
 * it holds an undecidable `If` rather than choosing an arm, so no assignment
 * inside it happens and no `break` under it fires — and it is what the
 * JavaScript statement form does (`BaseCompiler.compileLoopBody`). The
 * analysis is the compiler's shared one (`BaseCompiler.conditionDecidability`);
 * only the wording is this target's (`PYTHON_CONDITION_DIALECT`).
 *
 * A temporary the test needs is emitted as an assignment statement BEFORE the
 * `if`, where the JavaScript form wraps the whole thing in a block with a
 * `const`: Python has no block scope, so there is nothing to wrap, and the
 * name is drawn from the compilation's naming context so it cannot collide.
 */
function compilePythonIfStatement(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** The `If` node, when the caller has it: the CSE regions of the condition
   * and of each branch are keyed by the `(node, operandIndex)` edge. Omitting
   * it costs only the optimization. */
  node: Expression | undefined
): string {
  const cond = args[0];
  if (cond === undefined || args[1] === undefined)
    throw new Error('Could not compile `If`: wrong number of arguments');

  /** One branch, compiled as statements inside its own CSE region. */
  const branch = (i: number): string =>
    BaseCompiler.withCseScope(node, i, target, () =>
      compilePythonStatements(args[i], target)
    );
  const compileCond = (c: Expression): string =>
    BaseCompiler.compileOp(node, 0, target, 0, c);
  /** A `head:` line with `body` indented beneath it (`pass` when empty). */
  const suite = (head: string, body: string): string =>
    `${head}\n${indentPythonStatements(body)}`;
  const hasElse = args.length > 2 && args[2] !== undefined;

  const decidability = BaseCompiler.conditionDecidability(cond, true, target);

  // Decided by construction: the plain `if`/`else` needs no extra test.
  if (decidability === null) {
    const code = suite(`if ${compileCond(cond)}:`, branch(1));
    return hasElse ? `${code}\n${suite('else:', branch(2))}` : code;
  }

  const kind = decidability.test.kind;
  if (kind === 'value' || kind === 'connective') {
    // `Not` is applied by exchanging the two constants the tests compare
    // against, never by an emitted negation: negating a value that is not a
    // boolean would produce a confident answer from no evidence. A condition
    // that reaches a connective is compiled to its three-valued value and
    // carries its own negation, so nothing is exchanged for it.
    const connective = kind === 'connective';
    const { expr: condExpr, negate } = connective
      ? { expr: cond, negate: false }
      : BaseCompiler.peelNegations(cond);
    const code = connective
      ? BaseCompiler.withCseOperand(node, 0, target, () =>
          BaseCompiler.kleeneCondition(
            decidability,
            target,
            PYTHON_CONDITION_DIALECT
          )
        )
      : compileCond(condExpr);
    // The value is inspected twice — once for its kind, once for its truth —
    // so anything that is not already a name is computed into a temporary
    // first.
    let prelude = '';
    let name = code;
    if (!PYTHON_ATOM.test(code)) {
      name = BaseCompiler.tempVar(target);
      prelude = `${name} = ${code}\n`;
    }
    const isBool = pythonIsBoolean(name);
    let out = suite(
      `if ${isBool} and ${negate ? `not ${name}` : name}:`,
      branch(1)
    );
    // The else arm repeats the boolean test rather than being a bare `else:`,
    // so a value that is neither `True` nor `False` reaches no branch at all.
    if (hasElse) out += `\n${suite(`elif ${isBool}:`, branch(2))}`;
    return prelude + out;
  }

  // A comparison always produces a real boolean, so whether it could be
  // decided has to be read off its operands. An operand that costs something
  // to compute is bound to a name, which the condition then reads.
  const { value, bindings } = BaseCompiler.withConditionOperands(
    decidability.test.operands,
    target,
    true,
    (conjuncts) => {
      const code = compileCond(cond);
      if (hasElse) {
        const inner = `${suite(`if ${code}:`, branch(1))}\n${suite(
          'else:',
          branch(2)
        )}`;
        // With an else branch the decidedness test has to guard BOTH arms, so
        // it is a second `if` wrapped around the selection.
        return conjuncts.length === 0
          ? inner
          : suite(`if ${conjuncts.join(' and ')}:`, inner);
      }
      // With no else branch the two tests guard the same statement, so they
      // join one `if`. The condition is parenthesized when it joins the test,
      // because `and` binds tighter than the `or` a condition may contain.
      const test =
        conjuncts.length === 0
          ? code
          : [...conjuncts, `(${code})`].join(' and ');
      return suite(`if ${test}:`, branch(1));
    },
    PYTHON_CONDITION_DIALECT
  );
  if (bindings.length === 0) return value;
  return `${bindings.map(([n, c]) => `${n} = ${c}`).join('\n')}\n${value}`;
}

/**
 * The lowering of the two-operand `Gamma(s, z)`, the upper incomplete gamma
 * Γ(s, z) (`regularized` is `false`), and of `GammaRegularized(s, z)`, the
 * regularized upper incomplete gamma Q(s, z) = Γ(s, z)/Γ(s) (`regularized`
 * is `true`).
 *
 * The helper `_ce_ugamma` (`PYTHON_UPPER_GAMMA_HELPER`) computes both for
 * every real `s`, with the interpreter's values for `s ≤ 0`, where
 * `scipy.special.gammaincc` is `nan` or has no meaning.
 *
 * When `s` is a constant of at least 1e-20, Q is
 * `scipy.special.gammaincc(s, z)` itself, with no helper: measured against
 * mpmath, its relative error there is below 1e-13 wherever Q is a normal
 * double, while for a smaller `s` it loses digits (all of them for a
 * subnormal `s`). For Γ the helper is used for every `s`, because
 * `gammaincc(s, z)·gamma(s)` is `inf` when `gamma(s)` overflows
 * (`s > 171.6`), and loses digits when Q is subnormal or 0 while Γ(s, z) =
 * Q·Γ(s) is a normal double, which happens near the underflow threshold
 * when Γ(s) is large. A bare lambda (`compileLambda`) has no place for the
 * module helper, so there Γ keeps that product only for a constant `s` from
 * 2.5e-4 to 7.5, where Γ(s) ≤ 4096: a subnormal Q then still has 40 bits,
 * and the product's relative error, measured against mpmath for z from 0
 * to 1100, is below 2e-13 (at `s = 10` and at `s = 1e-5` it is 1, near
 * z = 765 and z = 700). Any other `s` makes `compileLambda` fail closed
 * with the message that names the helper.
 *
 * The helper is real-only: like the runtime guard of the real-only heads
 * (`BaseCompiler.realOperandGuard`), it gives `nan` for each element with a
 * nonzero imaginary part. For `GammaRegularized` the base compiler applies
 * that guard itself (`PYTHON_REAL_ONLY_FUNCTION_LOWERINGS`); `Gamma` is not
 * real-only, because its one-operand form takes a complex argument, so an
 * operand of `Gamma(s, z)` that is certainly not real fails closed here, as
 * the base compiler does for a real-only head.
 */
function pyUpperGamma(
  [s, z]: ReadonlyArray<Expression | null>,
  compile: (expr: Expression) => string,
  regularized: boolean
): string {
  const head = regularized ? 'GammaRegularized' : 'Gamma';
  if (s == null || z == null)
    throw new Error(`Could not compile \`${head}\`: missing argument`);
  if (!regularized) {
    const nonReal = [s, z].find((x) => BaseCompiler.isProvablyNonReal(x));
    if (nonReal !== undefined)
      throw new CompileDeclineError({
        code: 'non-real-operand',
        kind: 'capability',
        message:
          `Could not compile \`Gamma\`: the operand \`${nonReal.toString()}\` is ` +
          `certainly not a real number, and this target's lowering of the ` +
          `upper incomplete gamma is real-only.`,
      });
  }
  const cs = compile(s);
  const cz = compile(z);
  const sConst = tryGetConstant(s);
  if (sConst !== undefined) {
    if (regularized && sConst >= 1e-20)
      return `scipy.special.gammaincc(${cs}, ${cz})`;
    if (!regularized && pythonLambdaBody && sConst >= 2.5e-4 && sConst <= 7.5)
      return `(scipy.special.gammaincc(${cs}, ${cz}) * scipy.special.gamma(${cs}))`;
  }
  return `_ce_ugamma(${cs}, ${cz}, ${regularized ? 'True' : 'False'})`;
}

/**
 * The lowering of a head whose NumPy routine is real-only on this target for
 * some complex values: `np.sign`.
 *
 * An operand that is real lowers to the routine itself. An operand that may be
 * complex is bound once, and:
 *
 *  - a value that is exactly real (imaginary part `0`) takes the routine of
 *    its real part;
 *  - any other value takes `nonReal(v)`, the value the interpreter computes
 *    for a non-real `v`.
 *
 * An ARRAY operand whose elements may be complex keeps the element-wise real
 * projection (`_ce_creal_elems`: each exactly-real element as its real part,
 * every other element as `nan`), as the other real-only heads do.
 */
function pyComplexScalarLowering(
  routine: string,
  arg: Expression,
  nonReal: (v: string) => string,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const isArray =
    arg.isCollection === true || arg.type.matches('collection<any>');
  if (
    isArray
      ? arg.type.matches('collection<real>')
      : !BaseCompiler.isComplexValued(arg)
  )
    return `${routine}(${compile(arg)})`;
  const v = BaseCompiler.tempVar(target);
  if (isArray)
    return `(lambda ${v}: ${routine}(_ce_creal_elems(${v})))(${compile(arg)})`;
  return `(lambda ${v}: (${routine}(_ce_creal(${v})) if _ce_cisreal(${v}) else ${nonReal(v)}))(${compile(arg)})`;
}

/**
 * The inverse trigonometric and inverse hyperbolic functions of a complex
 * scalar, through `cmath`.
 *
 * `cmath` is accurate for a large and a small argument, but it picks the
 * side of a branch cut from the sign of a zero part (IEEE 754):
 * `cmath.asin(complex(2, 0.0))` is `π/2 + 1.317i` and
 * `cmath.asin(complex(2, -0.0))` is `π/2 − 1.317i`. The engine has no signed
 * zero, and the interpreter always takes the same side of each cut
 * (`complexAsin()` and the others, `numerics/numeric-complex.ts`). So the
 * compiled code first replaces a zero part of the argument with the zero
 * whose sign selects the interpreter's side:
 *
 *  - `asin`, `acos`, `atanh` (cut: the real axis beyond ±1): a zero
 *    imaginary part becomes `-0.0` when the real part is positive (the side
 *    below the axis) and `0.0` otherwise (`asin 2` is `π/2 − 1.317i`);
 *  - `acosh` (cut: the real axis below 1): a zero imaginary part becomes
 *    `0.0` (the side above the axis, `acosh(−2)` is `1.317 + πi`);
 *  - `asinh` (cut: the imaginary axis beyond ±i): a zero real part becomes
 *    `-0.0` when the imaginary part is negative and `0.0` otherwise
 *    (`asinh(−2i)` is `−1.317 − (π/2)i`);
 *  - `atan` (cut: the imaginary axis beyond ±i): a zero real part becomes
 *    `-0.0` when the imaginary part is negative and `0.0` otherwise, as for
 *    `asinh` (`atan(−2i)` is `−π/2 − 0.549i`, `atan(2i)` is
 *    `π/2 + 0.549i`).
 *
 * A reciprocal function is the function at `w = 1/z`, with the same rule
 * applied to `w` (`arccsc 0.5` is `asin 2`), as in the interpreter. Two
 * exceptions: `arccot` of a real value is `atan2(1, x)`, in `(0, π)`, as
 * the interpreter gives it, and `z = 0`, where Python raises
 * `ZeroDivisionError` for `1/z`, takes the interpreter's value there (`nan`
 * for `arccsc`, `arcsec` and `arcsch`, `+∞` for `arsech`, `(π/2)i` for
 * `arcoth`).
 *
 * `cmath.atan` and `cmath.atanh` raise `ValueError` at their poles
 * (`atan(±i)`, `atanh(±1)`), so these points answer the infinite values of
 * the compiled JavaScript: `atanh(±1)` is `±∞`, and `atan(±i)` is the
 * unsigned infinity `~oo` of the interpreter, which a compiled complex value
 * holds as `∞ + ∞i` (`complexPole()` in `javascript-target.ts`).
 */
const PY_INVERSE_TRIG: Record<
  string,
  { fn: string; cut: 'real' | 'above' | 'asinh' | 'atan'; at0?: string }
> = {
  __proto__: null as never,
  Arcsin: { fn: 'asin', cut: 'real' },
  Arccos: { fn: 'acos', cut: 'real' },
  Arctan: { fn: 'atan', cut: 'atan' },
  Arsinh: { fn: 'asinh', cut: 'asinh' },
  Arcosh: { fn: 'acosh', cut: 'above' },
  Artanh: { fn: 'atanh', cut: 'real' },
  Arccsc: {
    fn: 'asin',
    cut: 'real',
    at0: "complex(float('nan'), float('nan'))",
  },
  Arcsec: {
    fn: 'acos',
    cut: 'real',
    at0: "complex(float('nan'), float('nan'))",
  },
  Arccot: { fn: 'atan', cut: 'atan' },
  Arcsch: {
    fn: 'asinh',
    cut: 'asinh',
    at0: "complex(float('nan'), float('nan'))",
  },
  Arsech: { fn: 'acosh', cut: 'above', at0: "complex(float('inf'), 0.0)" },
  Arcoth: { fn: 'atanh', cut: 'real', at0: 'complex(0.0, np.pi / 2)' },
};

/**
 * The lowering of the inverse trigonometric or inverse hyperbolic `head`
 * (see `PY_INVERSE_TRIG`). A complex scalar operand takes `cmath` with the
 * interpreter's side of each branch cut. An array operand whose elements may
 * be complex takes the same scalar code on each element (`np.vectorize`,
 * which keeps the shape of a nested list): the NumPy routines pick the side
 * of a cut from the sign of a zero part, as `cmath` does, and `Arccot`'s
 * real lowering `π/2 − atan(z)` is not `atan(1/z)` off the real axis when
 * the real part is negative. Every other operand (a real one, or an array
 * of real elements) takes `realLowering`, the real lowering of the head.
 */
function pyInverseTrig(
  head: string,
  realLowering: CompiledFunction<Expression>
): CompiledFunction<Expression> {
  return (args, compile, target) => {
    const arg = args[0];
    if (arg === null || arg === undefined)
      throw new Error(`Could not compile \`${head}\`: no argument`);
    const isArray =
      arg.isCollection === true || arg.type.matches('collection<any>');
    if (
      isArray
        ? arg.type.matches('collection<real>')
        : !BaseCompiler.isComplexValued(arg)
    ) {
      if (typeof realLowering === 'string')
        return `${realLowering}(${compile(arg)})`;
      return realLowering(args, compile, target);
    }
    const { fn, cut, at0 } = PY_INVERSE_TRIG[head];
    const reciprocal = at0 !== undefined || head === 'Arccot';
    // `w` is the argument of the `cmath` function. `z` is the value whose
    // zero parts are the zero parts of `w`: `w` itself, or the operand `v`
    // when `w = 1/v`. For a reciprocal, a part of `1/v` can underflow to a
    // zero whose sign Python keeps (`1/complex(1e200, 1e-12)` is
    // `1e-200 - 0j`), and that sign picks the side of the cut, as in the
    // interpreter; only a part that is zero in `v` takes the rule above.
    const call = (w: string, z: string): string => {
      const adjusted =
        cut === 'real'
          ? `(complex(${w}.real, -0.0 if ${w}.real > 0 else 0.0) if ${z}.imag == 0 else ${w})`
          : cut === 'above'
            ? `(complex(${w}.real, 0.0) if ${z}.imag == 0 else ${w})`
            : `(complex(-0.0 if ${w}.imag < 0 else 0.0, ${w}.imag) if ${z}.real == 0 else ${w})`;
      const value = `cmath.${fn}(${adjusted})`;
      if (fn === 'atanh')
        return `(complex(${w}.real * float('inf'), 0.0) if ${w}.imag == 0 and abs(${w}.real) == 1 else ${value})`;
      if (fn === 'atan')
        return `(complex(float('inf'), float('inf')) if ${w}.real == 0 and abs(${w}.imag) == 1 else ${value})`;
      return value;
    };
    const v = BaseCompiler.tempVar(target);
    let fnCode: string;
    if (!reciprocal) fnCode = `lambda ${v}: ${call(v, v)}`;
    else {
      const w = BaseCompiler.tempVar(target);
      const inverse = `(lambda ${w}: ${call(w, v)})(1 / ${v})`;
      const special =
        head === 'Arccot'
          ? `complex(cmath.phase(complex(${v}.real, 1.0)), 0.0) if ${v}.imag == 0`
          : `${at0} if ${v} == 0`;
      fnCode = `lambda ${v}: ${special} else ${inverse}`;
    }
    if (isArray)
      return `np.vectorize(${fnCode}, otypes=[complex])(${compile(arg)})`;
    return `(${fnCode})(${compile(arg)})`;
  };
}

const PYTHON_FUNCTIONS: CompiledFunctions<Expression> = {
  __proto__: null as never,
  // Basic arithmetic (for when they're called as functions)
  Add: (args, compile) => {
    if (args.length === 0) return '0';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' + ');
  },
  // The function lowerings of `Multiply` and `Power` are reached when the
  // infix path declines, chiefly for a complex operand. The operand compiler
  // emits an operand without outer parentheses, as for `Divide` below, so an
  // operand that is not a primary expression is parenthesized: without this,
  // `2(x + z)` over a complex `z` emitted `2 * x + z`.
  Multiply: (args, compile) => {
    if (args.length === 0) return '1';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => pyOperand(compile(x))).join(' * ');
  },
  // `Negate` lowers through the prefix `-` operator for a scalar operand; this
  // handler covers the paths the operator mapping declines — chiefly an
  // element-wise broadcast over a collection (`Negate([1,2,3])`), where it
  // supplies the SCALAR ELEMENT lowering that `broadcastUnary` fans out into a
  // comprehension. Without it the head has no function codegen and the fan-out
  // is unreachable. The operand is parenthesized unconditionally: Python's
  // unary `-` binds tighter than `+`, and the function-codegen path these
  // operands come back through is precedence-blind (`Add` joins with ' + '),
  // so `Negate(z + 1)` would otherwise emit `-z + 1`.
  Negate: (args, compile) => `(-(${compile(args[0])}))`,
  // No Subtract handler — canonicalizes to Add+Negate before compilation.
  Divide: (args, compile) => {
    if (args.length === 0) return '1';
    if (args.length === 1) return compile(args[0]);
    // `compile()` emits sub-expressions without outer parentheses — wrap
    // before splicing next to `/`.
    if (args.length === 2)
      return `(${compile(args[0])}) / (${compile(args[1])})`;
    // For more than 2 args, fold left
    let result = `(${compile(args[0])})`;
    for (let i = 1; i < args.length; i++) {
      result = `${result} / (${compile(args[i])})`;
    }
    return result;
  },

  // Trigonometric functions (with complex dispatch via cmath)
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sin(${compile(args[0])})`;
    const u = BaseCompiler.piMultiple(args[0]);
    if (u !== undefined) return pythonPiTrig(compile(u), 'sin');
    return `np.sin(${compile(args[0])})`;
  },
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.cos(${compile(args[0])})`;
    const u = BaseCompiler.piMultiple(args[0]);
    if (u !== undefined) return pythonPiTrig(compile(u), 'cos');
    return `np.cos(${compile(args[0])})`;
  },
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.tan(${compile(args[0])})`;
    const u = BaseCompiler.piMultiple(args[0]);
    if (u !== undefined) return pythonPiTrig(compile(u), 'tan');
    return pythonPole(compile(args[0]), 'np.tan(_x)');
  },
  // A complex operand: `pyInverseTrig` (`cmath`, with the interpreter's side
  // of each branch cut).
  Arcsin: pyInverseTrig('Arcsin', 'np.arcsin'),
  // A complex operand: `pyInverseTrig` (`cmath`, with the interpreter's side
  // of each branch cut).
  Arccos: pyInverseTrig('Arccos', 'np.arccos'),
  // A complex operand: `pyInverseTrig` (`cmath`, with the interpreter's side
  // of each branch cut).
  Arctan: pyInverseTrig('Arctan', 'np.arctan'),
  Arctan2: 'np.arctan2',
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const u = BaseCompiler.imaginaryPiMultiple(args[0]);
      if (u !== undefined) return pythonPiHyperbolic(compile(u), 'Sinh');
      return `cmath.sinh(${compile(args[0])})`;
    }
    return `np.sinh(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const u = BaseCompiler.imaginaryPiMultiple(args[0]);
      if (u !== undefined) return pythonPiHyperbolic(compile(u), 'Cosh');
      return `cmath.cosh(${compile(args[0])})`;
    }
    return `np.cosh(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const u = BaseCompiler.imaginaryPiMultiple(args[0]);
      if (u !== undefined) return pythonPiHyperbolic(compile(u), 'Tanh');
      return `cmath.tanh(${compile(args[0])})`;
    }
    return `np.tanh(${compile(args[0])})`;
  },
  // NumPy's `np.arcsinh`, `np.arccosh` and `np.arctanh` take a complex
  // argument, but they pick the side of a branch cut from the sign of a zero
  // part (`np.arctanh(complex(2, 0))` is `0.5493 + 1.5708i`, the interpreter
  // gives `0.5493 − 1.5708i`), so a complex operand takes `pyInverseTrig`.
  Arsinh: pyInverseTrig('Arsinh', 'np.arcsinh'),
  Arcosh: pyInverseTrig('Arcosh', 'np.arccosh'),
  Artanh: pyInverseTrig('Artanh', 'np.arctanh'),

  // Reciprocal trigonometric functions. A real argument gets the pole rule of
  // `pythonPole`; a complex argument does not, as in the interpreter, whose
  // complex kernels keep a large finite value.
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Cot`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return `(np.cos(${compile(x)}) / np.sin(${compile(x)}))`;
    return pythonPole(compile(x), '1 / np.tan(_x)');
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Csc`: no argument');
    if (BaseCompiler.isComplexValued(x)) return `(1 / np.sin(${compile(x)}))`;
    return pythonPole(compile(x), '1 / np.sin(_x)');
  },
  Sec: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Sec`: no argument');
    if (BaseCompiler.isComplexValued(x)) return `(1 / np.cos(${compile(x)}))`;
    return pythonPole(compile(x), '1 / np.cos(_x)');
  },

  // Degrees → radians. Only reached in radian mode: in the other angular
  // units `rewriteAngularUnit` replaces the `Degrees` node before codegen.
  Degrees: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Degrees`: no argument');
    return `(${pyOperand(compile(x))} * np.pi / 180)`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: pyInverseTrig('Arccot', ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arccot`: no argument');
    // `np.arctan(1/x)` returns the wrong branch for x < 0. `π/2 - arctan(x)` is
    // branch-free and matches the interpreter's (0, π) range for all real x.
    return `(np.pi / 2 - np.arctan(${compile(x)}))`;
  }),
  Arccsc: pyInverseTrig('Arccsc', ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arccsc`: no argument');
    return `np.arcsin(1 / (${compile(x)}))`;
  }),
  Arcsec: pyInverseTrig('Arcsec', ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arcsec`: no argument');
    return `np.arccos(1 / (${compile(x)}))`;
  }),

  // Reciprocal hyperbolic functions
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Coth`: no argument');
    const u = BaseCompiler.isComplexValued(x)
      ? BaseCompiler.imaginaryPiMultiple(x)
      : undefined;
    if (u !== undefined) return pythonPiHyperbolic(compile(u), 'Coth');
    return `(np.cosh(${compile(x)}) / np.sinh(${compile(x)}))`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Csch`: no argument');
    const u = BaseCompiler.isComplexValued(x)
      ? BaseCompiler.imaginaryPiMultiple(x)
      : undefined;
    if (u !== undefined) return pythonPiHyperbolic(compile(u), 'Csch');
    return `(1 / np.sinh(${compile(x)}))`;
  },
  Sech: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Sech`: no argument');
    const u = BaseCompiler.isComplexValued(x)
      ? BaseCompiler.imaginaryPiMultiple(x)
      : undefined;
    if (u !== undefined) return pythonPiHyperbolic(compile(u), 'Sech');
    return `(1 / np.cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic (reciprocal)
  Arcoth: pyInverseTrig('Arcoth', ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arcoth`: no argument');
    return `np.arctanh(1 / (${compile(x)}))`;
  }),
  Arcsch: pyInverseTrig('Arcsch', ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arcsch`: no argument');
    return `np.arcsinh(1 / (${compile(x)}))`;
  }),
  Arsech: pyInverseTrig('Arsech', ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arsech`: no argument');
    return `np.arccosh(1 / (${compile(x)}))`;
  }),

  // Elementary
  Lb: 'np.log2',
  Square: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Square`: no argument');
    return `np.square(${compile(x)})`;
  },
  Fract: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Fract`: no argument');
    return `np.modf(${compile(x)})[0]`;
  },

  // Exponential and logarithmic
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.exp(${compile(args[0])})`;
    return `np.exp(${compile(args[0])})`;
  },
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      BaseCompiler.recordPromotion('Ln', args);
      return `cmath.log(${compile(args[0])})`;
    }
    // Promotion (the `auto` and `complex` modes): an operand of unknown sign
    // takes the complex lane so the compiled value matches the interpreter's
    // promotion. Uses the SAME predicate `BaseCompiler.isComplexValued`
    // reports to the enclosing node, or the parent reads a real where a
    // complex is returned.
    //
    // `np.emath.log`, not `cmath.log`: the operand here is a REAL of unknown
    // sign, so zero is in range, and `cmath.log(0)` raises `ValueError` where
    // the interpreter answers `-∞` (and the unpromoted `np.log(0)` yields
    // `-inf`). `np.emath` is numpy's domain-relaxed variant — complex for a
    // negative input, `-inf` at zero — which is exactly the promotion's
    // semantics, and it accepts arrays as the rest of this target does.
    if (BaseCompiler.promotesRadicalToComplex('Ln', args))
      return `np.emath.log(${compile(args[0])})`;
    return `np.log(${compile(args[0])})`;
  },
  Log: (args, compile) => {
    // Log with base: log(x, base). In a promoting mode (`auto`, `complex`)
    // an operand of unknown sign — value OR base, since a negative base
    // makes the quotient complex too — routes through `np.emath`, numpy's
    // domain-relaxed variant (complex for a negative input, `-inf` at zero).
    // See `Ln` above for why `cmath` is the wrong helper for a REAL operand:
    // `cmath.log(0)` raises where the interpreter answers `-∞`.
    const promoted = BaseCompiler.promotesRadicalToComplex('Log', args);
    // Base 10 (the one-argument form) and base 2 take numpy's dedicated
    // kernel, which is what the interpreter's constant fold uses too;
    // `log(x) / log(2)` is one ulp off it at the powers of two (Tycho item
    // 240).
    const base = BaseCompiler.fixedLogBase(args);
    if (base !== undefined)
      return promoted
        ? `np.emath.log${base}(${compile(args[0])})`
        : `np.log${base}(${compile(args[0])})`;
    if (args.length === 2) {
      const fn = promoted ? 'np.emath.log' : 'np.log';
      return `(${fn}(${compile(args[0])}) / ${fn}(${compile(args[1])}))`;
    }
    return 'np.log10';
  },
  Log10: 'np.log10',
  Log2: 'np.log2',
  Exp2: 'np.exp2',

  // Power and roots
  Power: (args, compile, target) => {
    if (args.length !== 2) return 'np.power';
    // A base that may be negative under an exponent that may be a float
    // takes the real root that the interpreter gives (`_ce_pow`, see
    // `BaseCompiler.negativeBaseFloatPower`). A bare lambda
    // (`compileLambda`) has no place for the module helper `_ce_pow`, so
    // there the lowerings that need it keep the power of Python (`x ** y`),
    // which gives the principal value, or NaN for an array, for a negative
    // base under a variable float exponent: `compileFunction` follows the
    // interpreter, `compileLambda` does not.
    const negativeBase = BaseCompiler.negativeBaseFloatPower(args);
    const withHelper = !pythonLambdaBody;
    // `e^{a + iπu}` with real `a` and `u`: the angle in half-turns, reduced
    // exactly (`pythonPiTrig`), so `e^{iπx}` at `x = 1` is `−1` and
    // `e^{x + iπ}` is `−e^x`.
    if (isSymbol(args[0], 'ExponentialE')) {
      const split = BaseCompiler.eulerPiSplit(args[1]);
      if (split !== undefined) {
        const unit = pythonPiTrig(compile(split.u), 'exp');
        return split.a === undefined
          ? unit
          : `(np.exp(${compile(split.a)}) * ${unit})`;
      }
    }
    if (
      BaseCompiler.isComplexValued(args[0]) ||
      BaseCompiler.isComplexValued(args[1])
    ) {
      // Recorded for the `promoted` report when the base is complex only by
      // wideness (see `promotesRadicalToComplex`; a no-op otherwise).
      BaseCompiler.recordPromotion('Power', args);
      return negativeBase !== undefined && withHelper
        ? `_ce_pow(${compile(args[0])}, ${compile(args[1])})`
        : `(${pyOperand(compile(args[0]))} ** ${pyOperand(compile(args[1]))})`;
    }
    const realPower =
      BaseCompiler.realPowerExponent(args) ??
      (typeof negativeBase === 'object' ? negativeBase : undefined);
    if (realPower !== undefined) {
      const value = BaseCompiler.tempVar(target);
      const magnitude = `np.power(np.abs(${value}), ${realPower.value})`;
      const result = realPower.oddNumerator
        ? `(np.where(${value} < 0, -1.0, 1.0) * ${magnitude})`
        : magnitude;
      return `(lambda ${value}: ${result})(${compile(args[0])})`;
    }
    // PROMOTION (the `auto`/`complex` disciplines): an unknown-sign base with
    // a provably non-integer exponent — `np.emath.power` returns the complex
    // principal value for a negative base (the same helper family the
    // promoted `Sqrt`/`Ln`/`Log` use), agreeing with `isComplexValued`'s
    // report to the parent (`promotesRadicalToComplex`).
    if (BaseCompiler.promotesRadicalToComplex('Power', args))
      return negativeBase === 'runtime' && withHelper
        ? `_ce_pow(${compile(args[0])}, ${compile(args[1])}, np.emath.power)`
        : `np.emath.power(${compile(args[0])}, ${compile(args[1])})`;
    if (negativeBase === 'runtime')
      return withHelper
        ? `_ce_pow(${compile(args[0])}, ${compile(args[1])})`
        : `(${pyOperand(compile(args[0]))} ** ${pyOperand(compile(args[1]))})`;
    return `np.power(${compile(args[0])}, ${compile(args[1])})`;
  },
  Sqrt: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // Recorded for the `promoted` report when the operand is complex only
      // by wideness (see `promotesRadicalToComplex`).
      BaseCompiler.recordPromotion('Sqrt', args);
      return `cmath.sqrt(${compile(args[0])})`;
    }
    // Promotion of an unknown-sign operand — see `Ln` above. `np.emath.sqrt`
    // rather than `cmath.sqrt` for the same two reasons that matter across all
    // three promoted heads: the operand is a REAL of unknown sign (so the
    // whole real line, zero included, is in range) and `cmath` accepts only
    // Python scalars, raising `TypeError` on the numpy arrays this target
    // otherwise supports throughout.
    if (BaseCompiler.promotesRadicalToComplex('Sqrt', args))
      return `np.emath.sqrt(${compile(args[0])})`;
    return `np.sqrt(${compile(args[0])})`;
  },
  Root: (args, compile) => {
    // Root(x, n) = x^(1/n)
    if (args.length !== 2) return 'np.power';
    const [x, n] = args;
    // A COMPLEX radicand or degree. The real lowerings below are wrong for
    // it: `np.sign(z)` of a complex `z` is `z / |z|`, and `np.abs(z)` drops
    // the argument of `z`. A radicand whose imaginary part is exactly zero,
    // under an odd integer degree, has the REAL root the interpreter answers
    // (`Root(-8, 3)` is `-2`); any other pair takes the principal value
    // `z ** (1 / n)`, as the interpreter does. The parity test runs when the
    // code runs because the value of the radicand is only known then.
    if (BaseCompiler.isComplexValued(x) || BaseCompiler.isComplexValued(n)) {
      // Recorded for the `promoted` report when the radicand is complex only
      // by wideness (see `promotesRadicalToComplex`; a no-op otherwise).
      BaseCompiler.recordPromotion('Root', args);
      return `(lambda _z, _n: complex(np.sign(_z.real) * np.power(abs(_z.real), 1.0 / _n.real)) if _z.imag == 0 and _n.imag == 0 and _n.real % 2 == 1 else _z ** (1.0 / _n))(complex(${compile(x)}), complex(${compile(n)}))`;
    }
    const nConst = tryGetConstant(n);
    // Odd integer degree: `np.power` is NaN for a negative base, but the real
    // root exists (interpreter convention, e.g. Root(-8, 3) = -2). Emit the
    // sign-corrected form `sign(x)·|x|^(1/n)`. A noninteger degree that the
    // interpreter reads as a rational exponent with an odd denominator
    // (`BaseCompiler.realRootDegreeTerms`) has a real root too: with an odd
    // numerator (`\sqrt[2.2]{x}`, read as `x^{5/11}`) it is the same signed
    // form, with an even numerator (`\sqrt[2.5]{x}`, read as `x^{2/5}`) it
    // is the magnitude `|x|^(1/n)`.
    const realRoot = BaseCompiler.realRootDegreeTerms(n);
    if (
      nConst !== undefined &&
      ((Number.isInteger(nConst) && nConst % 2 !== 0) ||
        realRoot?.oddNumerator === true)
    ) {
      const c = compile(x);
      return `(np.sign(${c}) * np.power(np.abs(${c}), 1.0 / ${compile(n)}))`;
    }
    if (nConst !== undefined && realRoot !== undefined)
      return `np.power(np.abs(${compile(x)}), 1.0 / ${compile(n)})`;
    // An EVEN degree over an operand of unknown sign, under a promoting
    // discipline: `np.power` is `NaN` for a negative base where the
    // interpreter answers the principal complex root. `np.emath.power`
    // returns that root, and it is the same predicate the enclosing
    // expression's analysis asks — see the `Sqrt` entry above, which
    // promotes for the same reason.
    if (BaseCompiler.promotesRadicalToComplex('Root', args))
      return `np.emath.power(${compile(x)}, 1.0 / ${compile(n)})`;
    return `np.power(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Rounding and absolute value
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `abs(${compile(args[0])})`;
    return `np.abs(${compile(args[0])})`;
  },
  // The sign of a complex value is `z / |z|`, as the interpreter computes it.
  // It is written out, not left to `np.sign`: NumPy 2 answers `z / |z|`, but
  // NumPy 1 answered `sign(Re z) + 0j`. A non-real value is never `0`, so
  // the division is safe.
  Sign: (args, compile, target) =>
    pyComplexScalarLowering(
      'np.sign',
      args[0],
      (v) => `${v} / abs(${v})`,
      compile,
      target
    ),
  Floor: (args, compile) =>
    pythonRoundToStep('Floor', 'np.floor', args, compile),
  Ceil: (args, compile) => pythonRoundToStep('Ceil', 'np.ceil', args, compile),
  // A value halfway between two integers is rounded with the rule of
  // `ce.roundingTies` at compile time, as the interpreter does
  // (`pythonRoundToInteger()`).
  Round: (args, compile) => {
    const x = args[0];
    if (x == null) throw new Error('Could not compile `Round`: no argument');
    const ties = x.engine.roundingTies;
    if (args.length < 2) return pythonRoundToInteger(compile(x), ties);
    // `Round(x, step)`: the multiple of the step nearest to `x`. The
    // quotient is snapped to the nearest HALF-integer, where `Round` jumps,
    // so that a tie is found, and the tie is rounded with the rule `ties`.
    return pythonRoundToStep(
      'Round',
      (q) => pythonRoundToInteger(q, ties),
      args,
      compile,
      0.5
    );
  },
  Truncate: (args, compile) =>
    pythonRoundToStep('Truncate', 'np.trunc', args, compile),

  // Min/Max — REDUCTIONS: fold every operand (a collection to its own extremum)
  // to a single value. `np.maximum`/`np.minimum` are element-wise and strictly
  // binary, so a bare mapping mis-handled a collection operand (element-wise
  // instead of reduced) and errored on 1 or 3+ arguments.
  Min: (args, compile, target) =>
    compilePythonExtremum('np.min', 'np.minimum', args, compile, target),
  Max: (args, compile, target) =>
    compilePythonExtremum('np.max', 'np.maximum', args, compile, target),
  // Element-wise max/min and clamp, matching the interpreter's broadcasting.
  //
  // When every operand is a scalar (statically), a length mismatch is
  // impossible, so we keep the direct `np.maximum`/`np.minimum`/`np.clip` fast
  // path (element-wise and broadcasting) — the common plotting shape and
  // unchanged output. When any operand is a collection, we route through the
  // injected `_ce_bcast` runtime helper (see PYTHON_BCAST_HELPER), which
  // zip-to-shortest trims the arrays before applying the vectorized NumPy op —
  // reproducing `broadcastOverIndexedCollections` (`ElementMax([1,2,3],[4,5]) →
  // [4,5]`; a length-1 result stays a one-element array, `[3]`, matching the
  // interpreter) instead of NumPy's own broadcasting, which raises `ValueError`
  // on a non-(1-vs-N) length mismatch.
  ElementMax: (args, compile) => {
    if (!args.some(isPyCollectionOperand)) {
      // With one operand (only from non-canonical input) the result is that
      // operand, spliced into the parent: a compound operand is grouped, or
      // `3·ElementMax(x + 1)` compiled to `3 * x + 1`.
      if (args.length === 1)
        return isFunction(args[0]) ? `(${compile(args[0])})` : compile(args[0]);
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++)
        result = `np.maximum(${result}, ${compile(args[i])})`;
      return result;
    }
    return `_ce_bcast('max', ${args.map((a) => compile(a)).join(', ')})`;
  },
  ElementMin: (args, compile) => {
    if (!args.some(isPyCollectionOperand)) {
      // With one operand (only from non-canonical input) the result is that
      // operand, spliced into the parent: a compound operand is grouped, or
      // `3·ElementMin(x + 1)` compiled to `3 * x + 1`.
      if (args.length === 1)
        return isFunction(args[0]) ? `(${compile(args[0])})` : compile(args[0]);
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++)
        result = `np.minimum(${result}, ${compile(args[i])})`;
      return result;
    }
    return `_ce_bcast('min', ${args.map((a) => compile(a)).join(', ')})`;
  },
  // A collection operand goes through the positional broadcast
  // (`_ce_bcast`), as for `Clamp`: NumPy would recycle a list of length 1
  // where the interpreter reports `incompatible-dimensions`.
  Smoothstep: (args, compile) =>
    args.some(isPyCollectionOperand)
      ? `_ce_bcast('smoothstep', ${args.map((a) => compile(a)).join(', ')})`
      : `_ce_smoothstep(${args.map((a) => compile(a)).join(', ')})`,
  Clamp: (args, compile) => {
    if (!args.some(isPyCollectionOperand))
      return `np.clip(${compile(args[0])}, ${compile(args[1])}, ${compile(
        args[2]
      )})`;
    return `_ce_bcast('clip', ${compile(args[0])}, ${compile(
      args[1]
    )}, ${compile(args[2])})`;
  },

  // Modulo. `np.mod` is floored (matches the interpreter and D1). `Remainder`
  // uses the interpreter's truncated/round-to-nearest-quotient semantics, NOT
  // `np.remainder` (which is a floored modulo): mirror the JS target's
  // `a - b·round(a/b)`. The quotient is rounded with a tie toward `+∞`, as
  // JavaScript `Math.round` does in the interpreter (`Remainder(5, 2)` is
  // `-1`), not with `np.round`, which rounds a tie to even.
  //
  // Both check their operands (`pythonIntegerOperands`): a float operand beyond
  // the safe integer range, or infinite, raises, because the remainder of the
  // rounded float is a different number. `Mod` by the literal `1` is not
  // checked: the remainder of a float beyond that range by `1` is `0`, which
  // is also the exact answer, as on the JavaScript target.
  Mod: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Mod`: missing argument');
    if (isNumber(b) && b.re === 1 && !b.isComplex)
      return `np.mod(${compile(a)}, ${compile(b)})`;
    return pythonIntegerOperands('Mod', a, b, compile);
  },
  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Remainder`: missing argument');
    return pythonIntegerOperands('Remainder', a, b, compile);
  },

  // Complex numbers
  Real: 'np.real',
  Imaginary: 'np.imag',
  // `np.add(z, 0)` makes a zero part `+0`. A product with a negative factor
  // gives `-0` for a zero factor (`complex(0, -1) * y` at `y = 0` is `-0j`),
  // and `np.angle(-3 - 0j)` is `-π`, where the interpreter, which has no
  // signed zero, answers `π`. `np.add` and not `+`, because the operand may
  // be a Python list. CE-262.
  Argument: (args, compile) => {
    if (args.length !== 1)
      throw new Error('Could not compile `Argument`: expected one operand');
    return `np.angle(np.add(${compile(args[0])}, 0))`;
  },
  Conjugate: 'np.conj',

  // Array/Vector operations
  // Indexed Sum/Product compile to Python generator expressions (single
  // expressions, so they compose everywhere). The `Limits` clause carried by an
  // indexed Sum/Product would throw under a plain `np.sum(...)` string mapping.
  Sum: (args, _compile, target) => compilePythonSumProduct('Sum', args, target),
  Product: (args, _compile, target) =>
    compilePythonSumProduct('Product', args, target),
  // Mean/Median/Variance/StandardDeviation are VARIADIC and reduce over the
  // flattened sample — see `compilePythonSample`.
  Mean: (args, compile) => compilePythonSample('np.mean', args, compile),
  Median: (args, compile) => compilePythonSample('np.median', args, compile),
  // CE `Variance`/`StandardDeviation` are the SAMPLE statistics (there are
  // separate `PopulationVariance`/`PopulationStandardDeviation` heads), so the
  // numpy calls need `ddof=1`: the default `ddof=0` is the population form and
  // was a silent wrong value (`Variance([2,3,7])` is 7, `np.var` gives 14/3).
  Variance: (args, compile) =>
    compilePythonSample('np.var', args, compile, ', ddof=1'),
  StandardDeviation: (args, compile) =>
    compilePythonSample('np.std', args, compile, ', ddof=1'),
  // Covariance/Correlation: two-collection form only. numpy `np.cov` defaults
  // to ddof=1 (sample) and returns the 2×2 covariance matrix — the off-diagonal
  // entry [0][1] is Cov(x, y). `np.corrcoef` returns the correlation matrix.
  // `== null`, not `=== null`: the SECOND operand is optional in the signature,
  // so a one-operand `Covariance([1,2])` arrives as `undefined` — which slipped
  // past a `=== null` guard and emitted `np.cov([1, 2], )`, a Python
  // SyntaxError reported as a successful compilation.
  Covariance: ([x, y], compile) => {
    if (x == null || y == null)
      throw new Error(
        'Could not compile `Covariance`: expected two collection arguments'
      );
    return `np.cov(${compile(x)}, ${compile(y)})[0][1]`;
  },
  PopulationCovariance: ([x, y], compile) => {
    if (x == null || y == null)
      throw new Error(
        'Could not compile `PopulationCovariance`: expected two collection arguments'
      );
    return `np.cov(${compile(x)}, ${compile(y)}, ddof=0)[0][1]`;
  },
  Correlation: ([x, y], compile) => {
    if (x == null || y == null)
      throw new Error(
        'Could not compile `Correlation`: expected two collection arguments'
      );
    return `np.corrcoef(${compile(x)}, ${compile(y)})[0][1]`;
  },

  // Linear algebra
  // A LIST of points is one inner product PER POINT in the interpreter (user
  // ruling of 2026-09-22). `np.dot` spells that contraction for a list of
  // points on the LEFT only: `np.dot(q, P)` is the row-vector product and
  // `np.dot(P, Q)` is the matrix product, both of which answer something
  // else. Fail closed rather than emit a wrong answer behind `success: true`,
  // as the `Norm` handler below does for the same shape.
  Dot: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `Dot`: missing argument');
    // A TUPLE is a point even when its coordinates are points, and the
    // interpreter leaves `Dot(((1, 2), (3, 4)), (5, 6))` unevaluated, where
    // `np.dot` would contract the nested tuple as a matrix: the compilation
    // declines (`BaseCompiler.isTupleOfTuples`). Only a non-tuple
    // collection of points is a list here.
    if (args.some((a) => BaseCompiler.isTupleOfTuples(a)))
      throw new Error(
        'Could not compile `Dot`: a tuple of tuples is one point with ' +
          'nested coordinates, which the interpreter does not contract; ' +
          'write a list of points or a matrix.'
      );
    if (args.some((a) => !isTuple(a) && isPointListValue(a)))
      throw new Error(
        'Could not compile `Dot`: a list of points has no single numpy spelling — `np.dot` ' +
          'contracts it as a matrix, but the interpreter answers one inner ' +
          'product per point.'
      );
    // A RESTRICTED operand (`P {c}`, `L {c}`) lowers to `(…) if c else
    // None`, and `np.dot` raises a `TypeError` for `None`, where the
    // interpreter answers the absence marker (`NaN` for the product of two
    // points, `Missing` for a list of points). Fail closed. Any other operand
    // whose type admits absence (a `Which` with no default clause, a symbol
    // with a `missing` arm, a point with an absent coordinate) can also
    // lower to `None`, so the same test applies to its type.
    if (args.some((a) => pythonMayBeAbsent(a)))
      throw new Error(
        'Could not compile `Dot`: a restricted operand is absent when its ' +
          'condition is false, and `np.dot` has no answer for an absent ' +
          'operand where the interpreter answers the absence marker.'
      );
    return `np.dot(${compile(args[0])}, ${compile(args[1])})`;
  },
  Cross: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `Cross`: missing argument');
    // A RESTRICTED operand (`P {c}`) lowers to `(…) if c else None`, and
    // `np.cross` raises for `None`, where the interpreter answers the
    // absence marker. Fail closed, as `Dot` does, also for any other operand
    // whose type admits absence.
    if (args.some((a) => pythonMayBeAbsent(a)))
      throw new Error(
        'Could not compile `Cross`: a restricted operand is absent when its ' +
          'condition is false, and `np.cross` has no answer for an absent ' +
          'operand where the interpreter answers the absence marker.'
      );
    return `np.cross(${compile(args[0])}, ${compile(args[1])})`;
  },
  // A STRING norm type (`Norm(v, "Infinity")`, `Norm(m, "Frobenius")`) is
  // spelled differently by numpy — `np.linalg.norm(v, "Infinity")` is a
  // ValueError. Map the two spellings the interpreter recognizes; anything else
  // fails closed. (The `Infinity` SYMBOL already folds to `np.inf`.)
  Norm: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Norm`: missing argument');
    // A LIST of points is one norm PER POINT in the interpreter (a point binds
    // atomically — Tycho item 138), which `np.linalg.norm` does not spell
    // without an explicit `axis`. Fail closed rather than emit the flattened
    // scalar behind `success: true`.
    if (isPointListValue(args[0]))
      throw new Error(
        'Could not compile `Norm`: a list of points has no numpy spelling — `np.linalg.norm` ' +
          'flattens it into one scalar, but the interpreter answers one norm ' +
          'per point.'
      );
    // The same holds for a list of points read through its absence arms: a
    // restricted list of points (`L {c}` lowers to `(…) if c else None`), or
    // a list that holds an absent or restricted point. `isPointListValue`
    // does not see it as a list of points, and `np.linalg.norm` flattened it
    // into one scalar where the interpreter answers one norm per point.
    const t = args[0].type.type;
    if (typeContainsMissing(t)) {
      const elt = collectionElementType(
        resolveTypeForCompilation(stripMissingFromType(t))
      );
      if (elt !== undefined && isPointElementType(elt))
        throw new Error(
          'Could not compile `Norm`: a list of points that may hold absent ' +
            'points has no numpy spelling — `np.linalg.norm` flattens it ' +
            'into one scalar, but the interpreter answers one norm per point.'
        );
    }
    const entries = pyNormEntries(args[0]);
    if (args.length < 2) return pyNorm(compile(args[0]), undefined, entries);
    const p = args[1];
    const rank = pyStaticRank(args[0]);
    if (isString(p)) {
      const ord: string | undefined = {
        Infinity: 'np.inf',
        Frobenius: "'fro'",
      }[p.string];
      if (ord === undefined)
        throw new Error(
          `Could not compile \`Norm\`: the norm type "${p.string}" has no numpy spelling.`
        );
      // The Frobenius norm is the entry-wise `√(Σ|xᵢ|²)` at EVERY rank — the
      // definition sums over every cell and does not mention the rank — which
      // is exactly `np.linalg.norm`'s default order: with no `ord` argument
      // numpy flattens the array and takes the entry-wise L2 norm. So a
      // statically known rank other than 2 drops the order argument instead
      // of failing closed. The interpreter answers the same value at rank 1
      // (`vectorNorm`) and at rank ≥ 3 (the `flatten()` branch), and so does
      // the JavaScript target.
      //
      // The numpy SPELLING `'fro'` is nevertheless matrix-only:
      // `np.linalg.norm(v, 'fro')` raises a ValueError on anything but a 2-D
      // input, so it is emitted only for a statically rank-2 operand. An
      // operand whose rank is not statically known also takes the default
      // order, which needs no run-time rank test: with no `ord` argument
      // `np.linalg.norm` flattens the input at every rank, including a 0-d
      // scalar (whose norm is then its absolute value, as in the
      // interpreter).
      if (p.string === 'Frobenius' && rank !== 2)
        return pyNorm(compile(args[0]), undefined, entries);
      // The `"Infinity"` norm type is the order +Infinity. Over an operand
      // whose rank is not statically known, the emitted code tests the rank
      // when it runs (`pythonNormRankTest`). A scalar answers its absolute
      // value: `np.linalg.norm(x, np.inf)` raises for a 0-d input.
      if (rank === undefined)
        return args[0].type.matches('number')
          ? `np.abs(${compile(args[0])})`
          : pythonNormRankTest(compile(args[0]), ord, 'matrix', entries);
      assertPythonNormRankAtMost2(rank);
      return pyNorm(compile(args[0]), ord, entries);
    }
    // The order 2 is the Euclidean norm on a vector and the SPECTRAL norm
    // (the largest singular value) on a matrix, in the interpreter
    // (`library/linear-algebra.ts`) and in `np.linalg.norm` alike, so a
    // statically rank-1 or rank-2 operand keeps `ord=2`. Above rank 2 the
    // interpreter reads the order 2 as the entry-wise Frobenius norm over the
    // flattened cells, which is numpy's DEFAULT order (no `ord` argument) —
    // `np.linalg.norm(t, 2)` raises on a 3-D input instead. When the rank is
    // not statically known, the emitted code tests the rank when it runs
    // (`pythonNormRankTest`).
    //
    // A scalar operand has no static rank (`pyStaticRank`), and the
    // interpreter answers its absolute value for every positive order.
    const scalar = rank === undefined && args[0].type.matches('number');
    if (p.isSame(2)) {
      if (rank !== undefined && rank >= 3)
        return pyNorm(compile(args[0]), undefined, entries);
      if (scalar) return `np.abs(${compile(args[0])})`;
      if (rank === undefined)
        return pythonNormRankTest(compile(args[0]), compile(p), 'two', entries);
    } else if (!isNumber(p) && !p.isInfinity) {
      // The order is only known at RUN time. A scalar answers its absolute
      // value for a positive order and has no value for any other one, as
      // below. When the rank is not statically known, the emitted code tests
      // both the rank and the order when it runs.
      //
      // The order can be a STRING at run time (`"Infinity"`,
      // `"Frobenius"`) when its type admits one; `pythonNormRuntimeOrder`
      // maps it to a number before the comparisons below.
      const pType = p.type.type;
      if (scalar)
        return pythonNormRuntimeOrder(
          compile(args[0]),
          compile(p),
          pType,
          () => `np.abs(_x) if _p > 0 else float('nan')`
        );
      if (rank === undefined)
        return pythonNormRuntimeRankTest(
          compile(args[0]),
          compile(p),
          pType,
          entries
        );
      // Above rank 2 the interpreter computes only the order 2, as the
      // entry-wise Frobenius norm, which is `np.linalg.norm(t)` with no `ord`
      // argument (numpy raises for an explicit order on more than two axes).
      if (rank >= 3)
        return pythonNormRuntimeOrder(
          compile(args[0]),
          compile(p),
          pType,
          () =>
            `${pyNorm('_x', undefined, entries)} if _p == 2 else float('nan')`
        );
      // The interpreter (`library/linear-algebra.ts`) computes a vector norm
      // only for an order `p > 0` (the p-norms, and L∞ for `+∞`), and a
      // matrix norm only for the orders 1, 2 and `+∞`. Each of these orders
      // has the same meaning in `np.linalg.norm`. For every other order the
      // interpreter leaves the application unevaluated, but numpy answers a
      // value (`ord=-1`, `ord=0` on a vector, `ord=-inf`) or raises
      // (`ord=3` on a matrix). So the emitted code tests the order when it
      // runs and answers NaN for an order the interpreter does not compute.
      return pythonNormRuntimeOrder(
        compile(args[0]),
        compile(p),
        pType,
        (fro) =>
          rank === 1
            ? `${pyNorm('_x', '_p', entries)} if _p > 0 else float('nan')`
            : pythonMatrixRuntimeNorm(fro, entries)
      );
    }
    // A literal numeric order that is not positive (`0`, `-1`, `-∞`) has no
    // value in the interpreter at any rank: the `requires` precondition of
    // `Norm` refuses it. But numpy answers a value for it (`ord=0` on a
    // vector counts the nonzero entries), so fail closed.
    if (isNumber(p) && !(p.re > 0))
      throw new Error(
        `Could not compile \`Norm\`: the interpreter defines norms only for a positive order, ` +
          `but \`np.linalg.norm\` answers a value for this order.`
      );
    // A literal numeric order on a statically rank-2 operand: the
    // interpreter's matrix branch (`library/linear-algebra.ts`) defines only
    // orders 1 (max column sum), 2 (spectral, handled above) and +Infinity
    // (max row sum) — 1 and +Infinity verified against numpy's matrix
    // semantics (probed 2026-07-31: both agree). Any OTHER literal
    // order stays SYMBOLIC in the interpreter, while numpy either raises
    // (`ord=3` on a matrix is a ValueError) or computes a norm the
    // interpreter does not define (`-inf`), so fail closed.
    if (
      rank === 2 &&
      isNumber(p) &&
      !p.isSame(1) &&
      !p.isSame(2) &&
      !(p.isInfinity && p.isPositive === true)
    )
      throw new Error(
        `Could not compile \`Norm\`: the interpreter defines matrix norms only for orders 1, ` +
          `2 and +Infinity — \`np.linalg.norm\` would raise or ` +
          `diverge for this order.`
      );
    // A literal positive order (not 2, which is decided above) on an operand
    // whose rank is not statically known. The interpreter answers the
    // absolute value of a scalar for every such order, but
    // `np.linalg.norm(x, p)` raises for a scalar, for an input with more than
    // two axes, and for a matrix when `p` is not 1, 2 or `inf`. So the
    // emitted code tests the rank when it runs (`pythonNormRankTest`).
    if (rank === undefined) {
      if (scalar) return `np.abs(${compile(args[0])})`;
      const matrixOrder =
        p.isSame(1) || (p.isInfinity === true && p.isPositive === true);
      return pythonNormRankTest(
        compile(args[0]),
        compile(p),
        matrixOrder ? 'matrix' : 'vector',
        entries
      );
    }
    assertPythonNormRankAtMost2(rank);
    return pyNorm(compile(args[0]), compile(p), entries);
  },
  Determinant: 'np.linalg.det',
  Inverse: 'np.linalg.inv',
  Transpose: (args, compile) => compilePythonTranspose(args, compile),
  MatrixMultiply: 'np.matmul',
  // Conjugate transpose: conjugate then transpose (a vector conjugates in
  // place, matching the interpreter and `np.transpose`).
  ConjugateTranspose: (args, compile) =>
    compilePythonTranspose(args, compile, 'np.conjugate'),
  // `np.diag` is rank-dispatched exactly like the interpreter's `Diagonal`: a
  // matrix → its main-diagonal vector; a vector → the diagonal matrix.
  Diagonal: 'np.diag',
  // Integer matrix power (`M^0` identity, negative → inverse), like the
  // interpreter's `MatrixPower`.
  MatrixPower: 'np.linalg.matrix_power',
  // CE `Rank` is the TENSOR rank (number of axes), NOT the linear-algebra rank
  // — `np.ndim` matches (scalar 0, vector 1, matrix 2, …). An operand that can
  // be a set has no shape in the interpreter, so the compilation declines for
  // it (`shapeOperandRefusal`).
  Rank: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Rank`: missing argument');
    const refusal = shapeOperandRefusal(args[0]);
    if (refusal !== undefined)
      throw new Error(`Could not compile \`Rank\`: the operand ${refusal}.`);
    return `np.ndim(${compile(args[0])})`;
  },
  // Reduced row echelon form — NumPy has no built-in, so route through the
  // injected `_ce_rref` runtime helper (Gauss–Jordan with partial pivoting).
  RowReduce: (args, compile) => `_ce_rref(${compile(args[0])})`,

  // Comparison — tolerance-aware equality (see compilePythonEquality). The
  // `abs(a - b) <= tol` form is SCALAR-ONLY: it raises `TypeError` on a plain
  // Python list, and while it would be element-wise on ndarrays, the
  // interpreter's collection equality is a whole-collection *scalar* boolean,
  // not an element-wise one — so a collection operand routes to the
  // `_ce_eqcoll` helper instead. Less/Greater stay as the infix relational
  // operators from PYTHON_OPERATORS; their function forms below serve the
  // collection path.
  Equal: (args, compile, target) =>
    compilePythonEquality('Equal', args, compile, target),
  NotEqual: (args, compile, target) =>
    compilePythonEquality('NotEqual', args, compile, target),
  // Chained (3+ operand) forms fold pairwise — a bare `np.less(a, b, c)` would
  // consume the third operand as numpy's `out`. See `compilePythonRelation`.
  Less: (args, compile) =>
    compilePythonRelation('np.less', args, compile, 'Less'),
  LessEqual: (args, compile) =>
    compilePythonRelation('np.less_equal', args, compile, 'LessEqual'),
  Greater: (args, compile) =>
    compilePythonRelation('np.greater', args, compile, 'Greater'),
  GreaterEqual: (args, compile) =>
    compilePythonRelation('np.greater_equal', args, compile, 'GreaterEqual'),
  And: (args, compile) =>
    compilePythonLogical('And', 'np.logical_and', args, compile),
  Or: (args, compile) =>
    compilePythonLogical('Or', 'np.logical_or', args, compile),
  Not: (args, compile) => {
    if (args.length !== 1)
      throw new Error('Could not compile `Not`: expected one operand');
    assertPyBroadcastableConnective('Not', args, 'tensor<boolean>');
    return `np.logical_not(${compile(args[0])})`;
  },

  // Control flow — the base compiler's default emits JS ternaries and a bare
  // `NaN`, both of which are Python SyntaxErrors. Emit Python conditional
  // expressions (`a if cond else b`) and `float('nan')`.
  If: (args, compile, target) => {
    if (args.length !== 3)
      throw new Error('Could not compile `If`: wrong number of arguments');
    // An arm with no Python EXPRESSION form — an assignment, a loop, a
    // multi-statement block — makes the whole selection a statement: emit the
    // `if:`/`else:` block instead of a conditional expression. In an
    // expression position that block is a multi-line fragment, which the
    // target's own statement gates (`bareStatementBlocks`,
    // `pythonAssertExpressionOnly`) then refuse — where the conditional
    // expression used to hand back `((r = 1) if … else (r = 2))` behind
    // `success: true`.
    if (pythonArmIsStatement(args[1]) || pythonArmIsStatement(args[2]))
      return compilePythonIfStatement(
        args,
        target,
        BaseCompiler.cseParentNode()
      );
    // Both arms are conditionally evaluated: their operand indices go to the
    // compile callback, which opens the matching CSE region (`OperandCompiler`).
    // A condition that is not exactly `True` or `False` takes neither arm and
    // the value is the absence literal of the arms' domain — see
    // `compilePythonBranch` and `pythonAbsent`.
    const absent = pythonAbsent([args[1], args[2]], target);
    return compilePythonBranch(
      args[0],
      pythonSelectionArm(args[1], () => compile(args[1], 1), absent, target),
      pythonSelectionArm(args[2], () => compile(args[2], 2), absent, target),
      (c) => compile(c),
      target,
      absent
    );
  },
  // `When` tests its condition for truth rather than for being a boolean,
  // because it has only one arm to withhold. A condition that is not a boolean
  // takes the else path and the value is the absence literal of the value's
  // domain (`pythonAbsent`) — `float('nan')` for a number — which is the same
  // answer a two-armed selection gives when it takes neither arm.
  When: (args, compile, target) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `When`: expected exactly 2 arguments (expr, cond)'
      );
    // A provably collection-valued condition must fail closed: a non-empty
    // Python list is TRUTHY, so the conditional expression below would
    // silently take the value branch for every element instead of selecting.
    // A condition that MAY be a list at run time is refused too (`target`).
    BaseCompiler.assertScalarCondition(args[1], target);
    // The VALUE is the conditional position (operand 0); the condition is
    // eager — see the `When` entry of the lazy-operand inventory.
    if (isSymbol(args[1], 'True')) return `(${compile(args[0], 0)})`;
    const absent = pythonAbsent([args[0]], target);
    if (isSymbol(args[1], 'False')) return absent;
    // The condition compiles first, the order of the CSE harvest walk
    // (`operandEmissionOrder`, `cse.ts`), so the value can read a temporary
    // that the condition binds.
    //
    // A condition read by its VALUE (a boolean input, a call, or a connective
    // with such an operand) can hold something that is not a boolean, and
    // Python truthiness would then take the value branch from no evidence:
    // `c = 1` selected the value. The value is selected only when the
    // condition is a boolean `True`, as in `If` (`compilePythonBranch`); the
    // interpreter has no value for such a condition either (ROADMAP CE-569).
    // A relation, and a connective of relations, is a genuine boolean and
    // keeps the plain conditional expression.
    const decidability = BaseCompiler.conditionDecidability(
      args[1],
      target.bindExpr !== undefined,
      target
    );
    if (decidability === null || !conditionReadsAValue(decidability)) {
      const cond = compile(args[1]);
      return `((${compile(args[0], 0)}) if (${cond}) else ${absent})`;
    }
    const connective = decidability.test.kind === 'connective';
    const { expr, negate } = connective
      ? { expr: args[1], negate: false }
      : BaseCompiler.peelNegations(args[1]);
    const code = connective
      ? BaseCompiler.kleeneCondition(
          decidability,
          target,
          PYTHON_CONDITION_DIALECT
        )
      : compile(expr);
    const value = compile(args[0], 0);
    const body = (v: string): string =>
      `((${value}) if (${pythonIsBoolean(v)} and ${
        negate ? `not ${v}` : v
      }) else ${absent})`;
    if (PYTHON_ATOM.test(code)) return body(code);
    // A generated name, so the parameter cannot hide a variable of the
    // value that has the same name.
    const v = BaseCompiler.tempVar(target);
    return `(lambda ${v}: ${body(v)})(${code})`;
  },
  Which: (args, compile, target) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error(
        'Could not compile `Which`: expected condition/value pairs'
      );
    // This handler bypasses the base compiler's per-condition
    // `guardCondition` assert, and Python truthiness would turn a collection
    // condition into a silent whole-expression pick.
    for (let i = 0; i < args.length; i += 2)
      BaseCompiler.assertScalarCondition(args[i], target);
    // A position no clause matched, and a position whose condition is
    // undecided, answer the same thing: the absence literal of the arms'
    // domain (`pythonAbsent`).
    const absent = pythonAbsent(
      args.filter((_, i) => i % 2 === 1),
      target
    );
    // Every value arm, and every condition after the first, is conditionally
    // evaluated — pass its operand index so the CSE pass opens its region.
    const build = (i: number): string => {
      if (i >= args.length) return absent;
      const cond = args[i];
      const val = args[i + 1];
      const value = (): string =>
        pythonSelectionArm(val, () => compile(val, i + 1), absent, target);
      // `True` marks the default (else) branch.
      if (isSymbol(cond, 'True')) return `(${value()})`;
      // A clause whose condition cannot be decided selects no clause and ends
      // the search, with the same value as a search that matched nothing.
      return compilePythonBranch(
        cond,
        value(),
        build(i + 2),
        (c) => (i === 0 ? compile(c) : compile(c, i)),
        target,
        absent
      );
    };
    return build(0);
  },

  // Epsil `Match`: structural pattern matching. Not supported by the Python
  // target in v1 (a chained conditional lowering is a possible future bonus, not
  // required — design §5). Fail closed.
  Match: () => {
    throw new Error(
      'Could not compile `Match`: pattern matching is not supported by the Python compile target in v1.'
    );
  },

  // Loop — a Python statement loop (`while True:` / `for … in range(…):`), not
  // the base compiler's JS `for`-IIFE (a Python SyntaxError). See
  // compilePythonLoop for the supported shapes.
  Loop: (args, _compile, target) =>
    compilePythonLoop(args, target, BaseCompiler.cseParentNode()),
  Comprehension: (args, _compile, target) =>
    compilePythonComprehension(args, target, BaseCompiler.cseParentNode()),

  // Special functions
  Erf: 'scipy.special.erf',
  Erfc: 'scipy.special.erfc',
  // `Gamma(z)` is the complete Γ; the TWO-operand `Gamma(s, z)` is the UPPER
  // INCOMPLETE gamma `∫_z^∞ tˢ⁻¹e⁻ᵗ dt` — a different function, not a variant
  // (Γ(5, 2) = 22.736…, Γ(5) = 24). The bare `'scipy.special.gamma'` mapping
  // passed the second operand to a one-argument routine, a runtime TypeError
  // reported as a successful compilation. scipy has no direct upper incomplete
  // gamma, but `gammaincc` is the REGULARIZED one, Q(s, z) = Γ(s, z)/Γ(s), so
  // for `s > 0` `gammaincc(s, z)·gamma(s)` recovers it (verified against the
  // interpreter: Γ(5, 2) → 22.736327583750935). `gammaincc` is `nan` for
  // `s < 0` and `gamma(s)` is a pole at the non-positive integers, where the
  // interpreter has a finite value (Γ(-1, 2) = 0.01876…), so the lowering
  // goes through the `_ce_ugamma` helper (`pyUpperGamma`).
  Gamma: (args, compile) => {
    const s = args[0];
    if (s == null) throw new Error('Could not compile `Gamma`: no argument');
    if (args.length < 2) return `scipy.special.gamma(${compile(s)})`;
    return pyUpperGamma(args, compile, false);
  },
  // On the real axis the interpreter's `GammaLn` is ln|Γ(x)|, which is
  // `scipy.special.gammaln`: at −2.5 both answer −0.0562, while
  // `scipy.special.loggamma` of a real float answers `nan` for x < 0.
  //
  // Off the real axis `scipy.special.loggamma` is the analytic continuation of
  // ln Γ, not the principal logarithm of Γ that the interpreter computes: at
  // `−2.5 + 1e−9i` the interpreter answers `−0.0562 − 3.1416i`, and the
  // imaginary parts differ by a multiple of 2π. No SciPy routine computes the
  // interpreter's value, so a complex value fails closed and never becomes a
  // silent `nan`:
  //
  //  - a value that is certainly not real (`t + i`) declines at compile time;
  //  - a value that may be complex (a `complex`-typed `z`, `√t`) is tested
  //    when the code runs, as `Artanh` is (`pyComplexScalarLowering`): the
  //    real routine runs on the real part when the imaginary part is exactly
  //    zero, and otherwise the code raises `ValueError`, since there is no
  //    complex routine to run instead. An array operand is tested whole.
  //    In strict mode the operand declines at compile time instead, as a
  //    maybe-complex operand of every real-only head does there.
  GammaLn: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `GammaLn`: no argument');
    const reason =
      'Could not compile `GammaLn`: scipy.special.loggamma takes another ' +
      'branch than the interpreter off the real axis; the compiled value ' +
      'would differ';
    const decline = () =>
      new CompileDeclineError({
        code: 'non-real-operand',
        kind: 'capability',
        message: `${reason}.`,
      });
    if (BaseCompiler.isProvablyNonReal(x)) throw decline();
    const isArray =
      x.isCollection === true || x.type.matches('collection<any>');
    if (
      isArray
        ? x.type.matches('collection<real>')
        : !BaseCompiler.isComplexValued(x)
    )
      return `scipy.special.gammaln(${compile(x)})`;
    if (!BaseCompiler.runtimeRealGuards) throw decline();
    // `raise` is a statement; throwing into an empty generator raises from
    // inside an expression.
    const raise = `(_ for _ in ()).throw(ValueError('${reason}'))`;
    const v = BaseCompiler.tempVar(target);
    if (isArray)
      return `(lambda ${v}: scipy.special.gammaln(_ce_creal_elems(${v})) if np.all(np.isreal(${v})) else ${raise})(${compile(x)})`;
    return `(lambda ${v}: scipy.special.gammaln(_ce_creal(${v})) if _ce_cisreal(${v}) else ${raise})(${compile(x)})`;
  },
  // `x! = Γ(x+1)`, matching the interpreter and the JavaScript target.
  // `scipy.special.factorial` is integer-only — it returns 0 for a negative or
  // non-integer argument — so `(-1/2)!` came out 0 instead of Γ(1/2) = √π
  // (Tycho item 99). `scipy.special.gamma` agrees with `factorial` on the
  // non-negative integers (both go through Γ for `exact=False`).
  Factorial: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `Factorial`: no argument');
    return `scipy.special.gamma((${compile(x)}) + 1)`;
  },
  // Regularized upper incomplete gamma Q(a, z); scipy's argument order matches
  // ours directly. `scipy.special.gammaincc` is `nan` for `a < 0` and for
  // `a = −1`, where the interpreter has a value, so an order that is not
  // known to be positive goes through the `_ce_ugamma` helper
  // (`pyUpperGamma`).
  GammaRegularized: (args, compile) => pyUpperGamma(args, compile, true),
  // Regularized incomplete beta I_x(a, b); scipy.special.betainc(a, b, x)
  // takes a DIFFERENT argument order than ours (x, a, b) — reorder here.
  BetaRegularized: ([x, a, b], compile) => {
    if (x === null || a === null || b === null)
      throw new Error('Could not compile `BetaRegularized`: missing argument');
    return `scipy.special.betainc(${compile(a)}, ${compile(b)}, ${compile(x)})`;
  },

  // Common patterns
  List: (args, compile) => {
    // Python list notation
    return `[${args.map((x) => compile(x)).join(', ')}]`;
  },
  // Matrix wraps List(List(...), ...) — compile as np.array for proper matrix ops
  Matrix: (args, compile) => `np.array(${compile(args[0])})`,
  // Tuple compiles to a Python tuple. The ARITY-1 form needs the trailing
  // comma: `(True)` is a parenthesized SCALAR, not a 1-tuple, so `len(...)`
  // raises and `_ce_eqcoll` would see a scalar where the interpreter has a
  // point. `()` is already the empty tuple.
  Tuple: (args, compile) => {
    const parts = args.map((x) => compile(x));
    if (parts.length === 1) return `(${parts[0]},)`;
    return `(${parts.join(', ')})`;
  },
  Sequence: (args, compile) => {
    // NumPy array
    return `np.array([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Range: (args, compile) => {
    // CE `Range` is INCLUSIVE of both endpoints, `Range(n)` is 1..n, and a
    // range with no explicit step auto-descends when stop < start
    // (`Range(5, 1)` → [5,4,3,2,1]). (Previously emitted a bare `np.arange`,
    // which excludes the stop, is 0-based in the one-argument form, and
    // never descends — silently diverging from the interpreter.) The count
    // is the interpreter's `rangeCount` (`pyRangeCount`): `⌊(stop −
    // start)/step⌋ + 1` with a small tolerance for the float rounding of the
    // quotient, computed explicitly so a fractional step never overshoots
    // the endpoint; a zero step yields [].
    if (args.length === 0) return '[]';
    // A non-finite bound never materializes: `int(np.floor(inf))` raises an
    // OverflowError at run time. Fail closed at compile time instead (the JS
    // target's `Range` guard; the Python target has no lazy-stream lowering,
    // so even a `Take`-bounded infinite range fails closed here — a
    // documented divergence from the JS target).
    if (args.some((a) => a != null && isNonFiniteBound(a)))
      throw new Error(
        `Could not compile \`Range\`: a non-finite bound does not materialize.`
      );
    const start = args.length === 1 ? '1' : compile(args[0]);
    const stop = args.length === 1 ? compile(args[0]) : compile(args[1]);
    if (args.length <= 2)
      return `(lambda _a, _b: (lambda _s: [float(_a + _s * _i) for _i in range(${pyRangeCount('_a', '_b', '_s')})])(1 if _b >= _a else -1))(${start}, ${stop})`;
    return `(lambda _a, _b, _s: [] if _s == 0 else [float(_a + _s * _i) for _i in range(${pyRangeCount('_a', '_b', '_s')})])(${start}, ${stop}, ${compile(args[2])})`;
  },

  // --- Function literals ---------------------------------------------------
  // A `Function` literal compiles to a Python lambda. Without this handler
  // the base compiler emits a JavaScript arrow function — invalid Python.
  // A lambda body must be a single expression, so a statement-shaped body
  // (`Block`) fails closed.
  Function: (args, compile, target) => {
    if (args[0] == null)
      throw new Error('Could not compile `Function`: missing body');
    // Function-literal bodies canonicalize wrapped in a `Block`; a
    // single-expression Block unwraps into the lambda body. A genuine
    // multi-statement body fails closed — a Python lambda is
    // expression-only.
    let body = args[0];
    while (isFunction(body, 'Block') && body.nops === 1) body = body.ops[0];
    if (isFunction(body, 'Block'))
      throw new Error(
        `Could not compile \`Function\`: a multi-statement (Block) body has no Python lambda form.`
      );
    BaseCompiler.assertNoDestructuringParams(args.slice(1));
    BaseCompiler.assertNoRestParams(args.slice(1));
    // The parameters are emitted as bare Python identifiers.
    const params = args
      .slice(1)
      .map((x) =>
        pythonCheckBindingName(functionLiteralParameterName(x) || '_')
      );
    // A lambda body runs when the lambda is called, so a call of a sibling
    // block-local function resolves against the whole enclosing statement
    // list (`CompileTarget.lexicalFunctions`), as on the JavaScript target:
    // a Python closure reads the sibling's binding at call time. The
    // parameters still shadow those siblings (`withBoundScope`).
    const scope: CompileTarget<Expression> = {
      ...target,
      localFunctions: target.lexicalFunctions ?? target.localFunctions,
    };
    const bodyCode = BaseCompiler.compile(body.canonical, {
      ...scope,
      var: (id) => (params.includes(id) ? id : target.var(id)),
      ...BaseCompiler.withBoundScope(scope, params),
    });
    return `(lambda ${params.join(', ')}: ${bodyCode})`;
  },

  // --- List-shaped collection operators -------------------------------------
  // Same fail-closed discipline and interpreter-verified semantics as
  // the JavaScript target: 1-based indexes, `Nothing` → nan, counts clamped.
  Length: (args, compile) => `len(${pyCollArg('Length', args[0], compile)})`,
  // Only the 1-arg cardinality form. `Count(xs, v)` counts the elements equal
  // to `v` and `Count(xs, p)` the elements satisfying the predicate `p`
  // (`library/collections.ts`); `len` answers neither, so compiling the 2-arg
  // forms this way returned the whole size and diverged from the interpreter
  // with no diagnostic. Decline instead, as `At` does below for its
  // multi-index form: the interpreted fallback still evaluates them.
  Count: (args, compile) => {
    if (args.length !== 1)
      throw new Error(
        `Could not compile \`Count\`: only the single-argument cardinality form compiles; the ` +
          `value and predicate forms (\`Count(xs, v)\`, \`Count(xs, p)\`) are ` +
          `not supported.`
      );
    return `len(${pyCollArg('Count', args[0], compile)})`;
  },
  IsEmpty: (args, compile) =>
    `(len(${pyCollArg('IsEmpty', args[0], compile)}) == 0)`,
  At: (args, compile) => {
    const base = args[0];
    const index = args[1];
    if (base == null || index == null || args.length !== 2)
      throw new Error(
        `Could not compile \`At\`: only the single-index form compiles.`
      );
    // A base that may be one string at run time (`string | list<string>`,
    // `broadcastable<string>`) is admitted below through its string arm, and
    // the emitted code answers `nan` for a string, where the interpreter
    // answers the character at that index. See `pyCollArg`.
    if (couldBeStringOperand(base))
      throw new Error(
        `Could not compile \`At\`: the first operand may be text at run time ` +
          `(type \`${base.type.toString()}\`), and Python has no stdlib ` +
          `grapheme segmentation. The interpreter evaluates it.`
      );
    // Admission mirrors the JavaScript target: provably an indexed collection,
    // or a union that merely ADMITS one (the `dictionary | indexed_collection`
    // an indexed lambda parameter carries) — the latter only with a provably
    // numeric index, since the other arm is a dictionary and a keyed lookup has
    // no compiled equivalent.
    const provablyIndexed =
      !base.type.matches('string') &&
      (base.type.matches('list<any>') ||
        base.type.matches('indexed_collection<any>'));
    if (!provablyIndexed) {
      if (!pyCouldBeIndexedCollectionOperand(base))
        throw new Error(
          `Could not compile \`At\`: operand is not an indexed collection (list/vector/range).`
        );
      if (!pyIsNumericIndexOperand(index))
        throw new Error(
          `Could not compile \`At\`: the first operand is not provably an indexed collection (type ` +
            `\`${base.type.toString()}\`) and the index is not provably ` +
            `numeric, so a keyed (dictionary) access cannot be ruled out.`
        );
    }
    // 1-based; negative counts from the end. An index that selects no
    // element (0, out of range) and an absent base (`None`, a restricted
    // collection whose condition is false) answer the absence marker of the
    // element domain (`pyAbsenceMarker`): `float('nan')` for numbers, `None`
    // otherwise. Any other base that is not a sequence at run time (the
    // dictionary arm of an admitted union) projects to nan, mirroring the
    // JavaScript `_SYS.at` runtime dispatch.
    // A base typed by a tuple reads the slot type at a literal position
    // (`pyReadMarkers`).
    const { absent, outOfRange } = pyReadMarkers(
      base,
      isNumber(index) && Number.isInteger(index.re) ? index.re : undefined
    );
    return `(lambda _l, _i: (${absent} if _l is None else float('nan')) if not isinstance(_l, (list, tuple, np.ndarray)) else (_l[int(_i) - 1] if 1 <= _i <= len(_l) else (_l[int(_i)] if -len(_l) <= _i <= -1 else ${outOfRange})))(${compile(base)}, ${compile(index)})`;
  },
  First: (args, compile) => pyNthElement('First', args[0], 0, compile),
  Second: (args, compile) => pyNthElement('Second', args[0], 1, compile),
  Third: (args, compile) => pyNthElement('Third', args[0], 2, compile),
  Last: (args, compile) => pyNthElement('Last', args[0], -1, compile),
  Rest: (args, compile) => `${pyCollArg('Rest', args[0], compile)}[1:]`,
  Most: (args, compile) => `${pyCollArg('Most', args[0], compile)}[:-1]`,
  Take: (args, compile) => {
    const coll = pyCollArg('Take', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Take`: missing count');
    return pyTakeDropSlice('Take', coll, args[1], compile);
  },
  Drop: (args, compile) => {
    const coll = pyCollArg('Drop', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Drop`: missing count');
    return pyTakeDropSlice('Drop', coll, args[1], compile);
  },
  Reverse: (args, compile) => `${pyCollArg('Reverse', args[0], compile)}[::-1]`,
  Sort: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Sort\`: a custom comparator is not supported; only the default ascending numeric sort is.`
      );
    return `sorted(${pyCollArg('Sort', args[0], compile)})`;
  },
  // 1-based indexes that sort ascending; `sorted` is stable, like the
  // interpreter.
  Ordering: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Ordering\`: a custom ordering function is not supported.`
      );
    return `(lambda _l: [_i + 1 for _i in sorted(range(len(_l)), key=lambda _j: _l[_j])])(${pyCollArg('Ordering', args[0], compile)})`;
  },
  Join: (args, compile) => compilePyJoin('Join', args, compile),
  // The list literal with a spread, `[...xs, v]`: compiled as `Join`, whose
  // compiled value is a Python list whatever its operands are.
  ListJoin: (args, compile) => compilePyJoin('ListJoin', args, compile),
  // Variadic, like the interpreter and the JavaScript target
  // (`docs/COLLECTIONS-MODEL.md`, Change 2).
  Append: (args, compile) => {
    const coll = pyCollArg('Append', args[0], compile);
    // No trailing values: the 1-ary identity form (valid in non-strict mode).
    const values = args.slice(1).map((a) => compile(a));
    return `[*${coll}${values.map((v) => `, ${v}`).join('')}]`;
  },
  // A copy with one element replaced, removed or inserted
  // (`PYTHON_LIST_UPDATE_HELPER`). A string source fails closed in
  // `pyCollArg`: this target cannot segment a string into characters.
  ReplaceAt: (args, compile) => {
    if (args[1] == null || args[2] == null)
      throw new Error('Could not compile `ReplaceAt`: missing argument');
    if (PY_IN_PLACE_UPDATE_OPS.has(args)) {
      // A chain accepted by `inPlaceUpdateChains`: one call, with the index
      // and the value of each level listed innermost first.
      const updates: string[] = [];
      let node: ReadonlyArray<Expression> = args;
      for (;;) {
        updates.unshift(compile(node[1]), compile(node[2]));
        if (!isFunction(node[0], 'ReplaceAt')) break;
        node = node[0].ops;
      }
      return `_ce_replaceat_inplace(${compile(node[0])}, ${updates.join(', ')})`;
    }
    const coll = pyCollArg('ReplaceAt', args[0], compile);
    return `_ce_replaceat(${coll}, ${compile(args[1])}, ${compile(args[2])})`;
  },
  DeleteAt: (args, compile) => {
    if (args[1] == null)
      throw new Error('Could not compile `DeleteAt`: missing index');
    const coll = pyCollArg('DeleteAt', args[0], compile);
    return `_ce_deleteat(${coll}, ${compile(args[1])})`;
  },
  Insert: (args, compile) => {
    if (args[1] == null || args[2] == null)
      throw new Error('Could not compile `Insert`: missing argument');
    const coll = pyCollArg('Insert', args[0], compile);
    return `_ce_insert(${coll}, ${compile(args[1])}, ${compile(args[2])})`;
  },
  // DELIBERATE DIVERGENCE from the JavaScript target, which fails closed on a
  // string (or tuple) needle because its element test is the numeric tolerance
  // test. This lowering is not numeric: the `_ce_indexof` adapter is Python's
  // own structural equality, so a string needle, a string haystack and a TUPLE
  // needle in a point list are all faithful — probe-verified against the
  // interpreter (`IndexOf([(1,2),(3,4)], Tuple(3,4))` → 2, a `NaN` value → its
  // position).
  // Nothing to GATE here (ruled 2026-08-08: adapter over gate) — but the
  // faithfulness now holds BECAUSE of the adapter: bare `in`/`.index` had one
  // crack, Python's `True == 1`, which found a boolean needle in a numeric
  // haystack where the interpreter answers 0. `_ce_same` compares bool-ness
  // first, and its number leaf is EXACT (no tolerance — see
  // PYTHON_INDEXOF_HELPER). Pinned in
  // `compile-python-string-fail-closed.test.ts`.
  IndexOf: (args, compile) => {
    const coll = pyCollArg('IndexOf', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `IndexOf`: missing value');
    return pySearchedValue(
      'IndexOf',
      args[1],
      args[0],
      compile,
      (v) => `_ce_indexof(${coll}, ${v})`
    );
  },
  Contains: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Contains', args[0]);
    const coll = pyCollArg('Contains', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Contains`: missing value');
    // `_ce_indexof`, not `in`: Python's `in` finds a `nan` only by object
    // identity, and the search is structural (`pySearchedValue`).
    return pySearchedValue(
      'Contains',
      args[1],
      args[0],
      compile,
      (v) => `(_ce_indexof(${coll}, ${v}) > 0)`
    );
  },
  // First-occurrence order (`dict.fromkeys` preserves insertion order).
  Unique: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Unique', args[0]);
    return `list(dict.fromkeys(${pyCollArg('Unique', args[0], compile)}))`;
  },
  Zip: (args, compile) => {
    if (args.length === 0) return '[]';
    BaseCompiler.assertLockstepSourcesPure('Zip', args, 1);
    const colls = args.map((a, i) => pyCollArg('Zip', a, compile, i + 1));
    return `[list(_t) for _t in zip(${colls.join(', ')})]`;
  },
  // Both endpoints included (native np.linspace); count truncated and
  // clamped ≥ 0; defaults mirror the interpreter (start 1, count 50).
  Linspace: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Linspace`: missing argument');
    const start = args[1] == null ? '1' : compile(args[0]);
    const end = args[1] == null ? compile(args[0]) : compile(args[1]);
    const count = args[2] == null ? '50' : compile(args[2]);
    return `[float(_v) for _v in np.linspace(${start}, ${end}, max(0, int(${count})))]`;
  },
  // --- Higher-order collection operators ------------------------------------
  Map: (args, compile) => {
    if (args[1] == null)
      throw new Error('Could not compile `Map`: missing source collection');
    // The multi-collection (zipWith) form: one element from each source per
    // call, as long as the shortest source — which is what Python's `zip`
    // does. Parameter `i` is checked against source `i`'s element type, as
    // on the JavaScript target (`zipFnArg` there).
    if (args.length > 2) {
      const sources = args.slice(1);
      // The mapping is operand 1, so the first source is operand 2. The
      // gates are the JavaScript target's: every source pure (the compiled
      // code materializes all of them, the interpreter stops at the
      // shortest), every source's elements provably real scalars (the
      // lambda's parameters are bare), and a bare binary operator symbol
      // only over exactly two sources (it lowers to a two-argument lambda,
      // which Python would reject at run time with a `TypeError`).
      BaseCompiler.assertLockstepSourcesPure('Map', sources, 2);
      const colls = sources.map((a, i) => pyCollArg('Map', a, compile, i + 2));
      if (
        isSymbol(args[0]) &&
        BaseCompiler.isBinaryInfixValueOperator(args[0].symbol) &&
        sources.length !== 2
      )
        throw new Error(
          `Could not compile \`Map\`: the operator symbol '${args[0].symbol}' used as the ` +
            `mapping compiles to a two-argument function, and ` +
            `${sources.length} collections supply ${sources.length} ` +
            `arguments per call. The interpreter evaluates it instead.`
        );
      const fn = pyFnArg(
        'Map',
        args[0],
        compile,
        BaseCompiler.zipCallbackArgTypes('Map', sources, 2)
      );
      return `(lambda _f, *_ls: [_f(*_t) for _t in zip(*_ls)])(${fn}, ${colls.join(', ')})`;
    }
    const coll = pyCollArg('Map', args[1], compile);
    const fn = pyFnArg('Map', args[0], compile, [
      BaseCompiler.collectionElementTypeOf(args[1]),
    ]);
    return `(lambda _f: [_f(_x) for _x in ${coll}])(${fn})`;
  },
  Filter: (args, compile) => {
    const coll = pyCollArg('Filter', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Filter`: missing predicate');
    const fn = pyFnArg('Filter', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: [_x for _x in ${coll} if _f(_x)])(${fn})`;
  },
  CountIf: (args, compile) => {
    const coll = pyCollArg('CountIf', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `CountIf`: missing predicate');
    const fn = pyFnArg('CountIf', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: sum(1 for _x in ${coll} if _f(_x)))(${fn})`;
  },
  Find: (args, compile) => {
    const coll = pyCollArg('Find', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Find`: missing predicate');
    const fn = pyFnArg('Find', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: next((_x for _x in ${coll} if _f(_x)), float('nan')))(${fn})`;
  },
  IndexWhere: (args, compile) => {
    const coll = pyCollArg('IndexWhere', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `IndexWhere`: missing predicate');
    const fn = pyFnArg('IndexWhere', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: next((_i + 1 for _i, _x in enumerate(${coll}) if _f(_x)), 0))(${fn})`;
  },
  Position: (args, compile) => {
    const coll = pyCollArg('Position', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Position`: missing predicate');
    const fn = pyFnArg('Position', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: [_i + 1 for _i, _x in enumerate(${coll}) if _f(_x)])(${fn})`;
  },
  Any: (args, compile) => {
    const coll = pyCollArg('Any', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Could not compile \`Any\`: only the predicate form compiles.`
      );
    // An absent element makes the interpreter's answer `Missing` (Kleene),
    // which `any` cannot express: fail closed (`refuseKleeneQuantifier`).
    refuseKleeneQuantifier('Any', args[0], args[1]);
    const fn = pyFnArg('Any', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: any(_f(_x) for _x in ${coll}))(${fn})`;
  },
  All: (args, compile) => {
    const coll = pyCollArg('All', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Could not compile \`All\`: only the predicate form compiles.`
      );
    refuseKleeneQuantifier('All', args[0], args[1]);
    const fn = pyFnArg('All', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f: all(_f(_x) for _x in ${coll}))(${fn})`;
  },
  TakeWhile: (args, compile) => {
    const coll = pyCollArg('TakeWhile', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `TakeWhile`: missing predicate');
    const fn = pyFnArg('TakeWhile', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f, _l: _l[:next((_i for _i, _x in enumerate(_l) if not _f(_x)), len(_l))])(${fn}, ${coll})`;
  },
  DropWhile: (args, compile) => {
    const coll = pyCollArg('DropWhile', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `DropWhile`: missing predicate');
    const fn = pyFnArg('DropWhile', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f, _l: _l[next((_i for _i, _x in enumerate(_l) if not _f(_x)), len(_l)):])(${fn}, ${coll})`;
  },
  // A collection-valued mapping is spliced; a scalar result is kept as-is.
  FlatMap: (args, compile) => {
    const coll = pyCollArg('FlatMap', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `FlatMap`: missing mapping function');
    const fn = pyFnArg('FlatMap', args[1], compile, [
      BaseCompiler.collectionElementTypeOf(args[0]),
    ]);
    return `(lambda _f, _l: [_y for _x in _l for _y in (lambda _r: _r if isinstance(_r, list) else [_r])(_f(_x))])(${fn}, ${coll})`;
  },
  // Fold. Built-in combiners use the native reductions; an empty collection
  // with no initial value yields nan (the interpreter's `Nothing`). A custom
  // combiner must be a binary `Function` literal and requires an explicit
  // initial value (same rule as the JavaScript target).
  Reduce: (args, compile, target) => {
    const coll = pyCollArg('Reduce', args[0], compile);
    const op = args[1];
    const init = args[2];
    if (op == null)
      throw new Error('Could not compile `Reduce`: missing combiner');
    // The reduction the name spells is used only for the library operator
    // (`isLibraryFoldCombiner` in `builtin-callback.ts`): a user definition
    // named `Max` can be binary and not associative, and `max` would compute
    // another value.
    const builtin =
      isSymbol(op) && isLibraryFoldCombiner(op, target)
        ? {
            Add: 'sum(_l)',
            Multiply: '__import__("math").prod(_l)',
            Min: 'min(_l)',
            Max: 'max(_l)',
          }[op.symbol]
        : undefined;
    if (builtin !== undefined) {
      pyRefuseBuiltinFoldOverCollections('Reduce', args[0]);
      if (init !== undefined && init !== null) {
        const seeded = {
          'sum(_l)': `sum(_l, ${compile(init)})`,
          '__import__("math").prod(_l)': `__import__("math").prod(_l, start=${compile(init)})`,
          'min(_l)': `min([${compile(init)}, *_l])`,
          'max(_l)': `max([${compile(init)}, *_l])`,
        }[builtin]!;
        return `(lambda _l: ${seeded})(${coll})`;
      }
      return `(lambda _l: float('nan') if len(_l) == 0 else ${builtin})(${coll})`;
    }
    if ((isFunction(op, 'Function') && op.nops - 1 === 2) || isSymbol(op)) {
      if (init === undefined || init === null)
        throw new Error(
          `Could not compile \`Reduce\`: a custom combiner compiles only with an explicit ` +
            `initial value.`
        );
      // The combiner is `(accumulator, element)`: the accumulator receives
      // the seed, then the combiner's own result
      // (`BaseCompiler.foldAccumulatorArgType`), the element the source's
      // element type.
      assertAccumulatorFitsStep('Reduce', op, init);
      // An accumulator that only the fold can see is updated in place when
      // the step allows it (`inPlaceUpdateChains`); the seed is then copied
      // once. See `PY_IN_PLACE_UPDATE_OPS`.
      const chains = inPlaceUpdateChains(op);
      for (const ops of chains ?? []) PY_IN_PLACE_UPDATE_OPS.add(ops);
      let fn: string;
      try {
        fn = pyFnArg('Reduce', op, compile, [
          BaseCompiler.foldAccumulatorArgType(args[0]!, op, init),
          BaseCompiler.collectionElementTypeOf(args[0]),
        ]);
      } finally {
        for (const ops of chains ?? []) PY_IN_PLACE_UPDATE_OPS.delete(ops);
      }
      const seed =
        chains !== undefined
          ? `_ce_owned_copy(${compile(init)})`
          : compile(init);
      return `__import__('functools').reduce(${fn}, ${coll}, ${seed})`;
    }
    throw new Error(
      `Could not compile \`Reduce\`: the combiner has no compiled function form on the Python ` +
        `target.`
    );
  },
  // Running fold: `itertools.accumulate`. With an initial value the
  // accumulated seed is not emitted (slice it off, matching the
  // interpreter); without one the first element seeds and is emitted as-is.
  Scan: (args, compile, target) => {
    const coll = pyCollArg('Scan', args[0], compile);
    const op = args[1];
    const init = args[2];
    if (op == null)
      throw new Error('Could not compile `Scan`: missing combiner');
    const builtin =
      isSymbol(op) && isLibraryFoldCombiner(op, target)
        ? {
            Add: '(lambda _a, _b: _a + _b)',
            Multiply: '(lambda _a, _b: _a * _b)',
            Min: '(lambda _a, _b: min(_a, _b))',
            Max: '(lambda _a, _b: max(_a, _b))',
          }[op.symbol]
        : undefined;
    if (builtin !== undefined)
      pyRefuseBuiltinFoldOverCollections('Scan', args[0]);
    else assertAccumulatorFitsStep('Scan', op, init);
    const fn =
      builtin ??
      ((isFunction(op, 'Function') && op.nops - 1 === 2) || isSymbol(op)
        ? pyFnArg('Scan', op, compile, [
            BaseCompiler.foldAccumulatorArgType(args[0]!, op, init),
            BaseCompiler.collectionElementTypeOf(args[0]),
          ])
        : undefined);
    if (fn === undefined)
      throw new Error(
        `Could not compile \`Scan\`: the combiner has no compiled function form on the Python ` +
          `target.`
      );
    if (init !== undefined && init !== null)
      return `list(__import__('itertools').accumulate(${coll}, ${fn}, initial=${compile(init)}))[1:]`;
    return `list(__import__('itertools').accumulate(${coll}, ${fn}))`;
  },
  // Apply the function to 1-based indexes; a statically non-positive
  // dimension, which gives the constant `[]` in the interpreter, fails closed
  // as on the JavaScript target (see the comment of its `Tabulate` handler).
  Tabulate: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `Tabulate`: missing argument');
    if (args.length > 3)
      throw new Error(
        `Could not compile \`Tabulate\`: only the 1-D and 2-D forms compile.`
      );
    for (let i = 1; i < args.length; i++) {
      const dim = tryGetConstant(args[i]!);
      if (dim !== undefined && Math.round(dim) <= 0)
        throw new Error(
          `Could not compile \`Tabulate\`: a statically non-positive dimension (${dim}) gives ` +
            `a constant empty list.`
        );
    }
    const f = pyFnArg('Tabulate', args[0], compile, ['integer', 'integer']);
    const n = pyClampedCount(args[1]!, compile);
    if (args.length === 2)
      return `(lambda _f: [_f(_i + 1) for _i in range(${n})])(${f})`;
    const m = pyClampedCount(args[2]!, compile);
    return `(lambda _f: [[_f(_i + 1, _j + 1) for _j in range(${m})] for _i in range(${n})])(${f})`;
  },
  Fill: (args, compile) => {
    const dims = args[1];
    if (args[0] == null || dims == null)
      throw new Error('Could not compile `Fill`: missing argument');
    if (!isFunction(dims) || dims.ops.length !== 2)
      throw new Error(
        `Could not compile \`Fill\`: only the (function, (rows, cols)) form compiles.`
      );
    const f = pyFnArg('Fill', args[0], compile, ['integer', 'integer']);
    const rows = pyClampedCount(dims.ops[0], compile);
    const cols = pyClampedCount(dims.ops[1], compile);
    return `(lambda _f: [[_f(_i + 1, _j + 1) for _j in range(${cols})] for _i in range(${rows})])(${f})`;
  },
  // --- Core scalar operators -------------------------------------------------
  Boole: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Boole`: missing argument');
    if (!BaseCompiler.isBooleanValued(args[0]))
      throw new Error(
        `Could not compile \`Boole\`: the argument is not provably boolean.`
      );
    return `(1 if ${compile(args[0])} else 0)`;
  },
  // δ: 1 when all arguments are equal — a single argument compares to 0 —
  // else 0. The comparison is EXACT (`==`), as compiled `Equal` is (see
  // `compilePythonEquality`): a `nan` argument answers 0.
  //
  // The variadic form tests the first argument for absence before comparing.
  // An absent value reads as `None` on the object axis of this target, and
  // `None == None` is true, so two absent arguments would otherwise answer 1
  // — where the interpreter answers `Missing` and a compiled `Equal` of the
  // same two operands answers false. Numeric absence is `nan`, which already
  // fails the comparison against itself and so needs no test of its own.
  KroneckerDelta: (args, compile) => {
    if (args.length === 0 || args[0] == null)
      throw new Error('Could not compile `KroneckerDelta`: missing argument');
    if (args.length === 1) return `(1 if ${compile(args[0])} == 0 else 0)`;
    return `(lambda *_v: 1 if _v[0] is not None and all(_x == _v[0] for _x in _v) else 0)(${args.map((a) => compile(a)).join(', ')})`;
  },
  Element: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `Element`: missing argument');
    requirePrimitiveElements('Element', args[1]);
    const coll = pyCollArg('Element', args[1], compile);
    // An absent value is an element where the same marker sits; the test is
    // `_ce_indexof`, not `in`, for the reason `pySearchedValue` states.
    return pySearchedValue(
      'Element',
      args[0],
      args[1],
      compile,
      (v) => `(_ce_indexof(${coll}, ${v}) > 0)`
    );
  },
  Identity: (args, compile, target) => {
    if (args[0] == null)
      throw new Error('Could not compile `Identity`: missing argument');
    return pyIdentityPassthrough(args[0], compile(args[0]), target);
  },
  Apply: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Apply`: missing function');
    return `(${compile(args[0])})(${args
      .slice(1)
      .map((a) => compile(a))
      .join(', ')})`;
  },
  // --- Linear algebra (numpy; regular arrays only) ---------------------------
  Flatten: (args, compile) => {
    if (args[1] != null)
      throw new Error(
        `Could not compile \`Flatten\`: an explicit depth is not supported on the Python target.`
      );
    // Recursive self-passing lambda: flattens ragged (non-rectangular)
    // nested lists, which np.asarray(...).ravel() rejects.
    return `(lambda _l: (lambda _f: _f(_f, _l))(lambda _f, _x: [_y for _e in _x for _y in (_f(_f, _e) if isinstance(_e, list) else [_e])]))(${pyCollArg('Flatten', args[0], compile)})`;
  },
  Shape: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Shape`: missing argument');
    const refusal = shapeOperandRefusal(args[0]);
    if (refusal !== undefined)
      throw new Error(`Could not compile \`Shape\`: the operand ${refusal}.`);
    return `list(np.shape(${compile(args[0])}))`;
  },
  // Cyclic padding (np.resize repeats the source), like the interpreter.
  Reshape: (args, compile) => {
    const coll = pyCollArg('Reshape', args[0], compile);
    const dims = args[1];
    if (dims == null)
      throw new Error('Could not compile `Reshape`: missing shape');
    if (!isFunction(dims) || dims.ops.length === 0 || dims.ops.length > 2)
      throw new Error(
        `Could not compile \`Reshape\`: only a 1-D or 2-D target shape compiles.`
      );
    return `np.resize(np.asarray(${coll}), (${dims.ops.map((d) => compile(d)).join(', ')},)).tolist()`;
  },
  Trace: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Trace\`: explicit axes do not compile.`
      );
    // `float()` of a complex trace drops its imaginary part, so a complex
    // lane (`BaseCompiler.linearAlgebraLane`, the answer a parent reads for
    // the value of the node) converts with `complex()`.
    const convert =
      BaseCompiler.linearAlgebraLane([args[0]]) === 'complex'
        ? 'complex'
        : 'float';
    return `${convert}(np.trace(np.asarray(${pyCollArg('Trace', args[0], compile)})))`;
  },
};

// `ApplyWhole` (engine-internal, `library/core.ts`) applies a function to
// arguments bound whole, which is what the `Apply` lowering emits: the call
// `(fn)(args)` binds each argument as given. The lazy `Map` of a declared
// `broadcastable<T>` map builds its per-element call with it.
PYTHON_FUNCTIONS.ApplyWhole = PYTHON_FUNCTIONS.Apply;

/**
 * Python/NumPy language target implementation
 *
 * Generates Python code that uses NumPy for mathematical operations.
 * The generated code is compatible with NumPy arrays and supports
 * vectorized operations.
 */
/**
 * The compile modes the Python target offers (`CompileMode`): all three. Its
 * emitters implement the complex lowering (native `complex`, `cmath`), so
 * `'complex'` and `'auto'` are deliverable; the effective default is `'auto'`.
 */
const PYTHON_SUPPORTED_MODES: readonly CompileMode[] = [
  'strict',
  'complex',
  'auto',
];

/**
 * The heads this target maps to a helper name that takes a complex argument.
 * A helper name is real-only by default (`BaseCompiler.stringHelperIsRealOnly`),
 * but these NumPy and `scipy.special` routines compute the complex value that
 * the interpreter computes, so a complex operand reaches them as it is
 * instead of taking the run-time realness rule (which answered NaN):
 *
 *  - `scipy.special.erf` and `erfc`;
 *  - `np.emath.log2` (`Lb`, `Log2`), `np.emath.log10` and `np.exp2`;
 *  - `np.linalg.det`, `np.linalg.inv`, `np.matmul`,
 *    `np.linalg.matrix_power`, `np.cross` and `np.diag`, which compute with
 *    complex entries without conjugation, as the interpreter does.
 *
 * The special functions were compared with the interpreter at `x + yi` for
 * `x` in {−3, −2.5, −1, −0.5, 0, 0.5, 1, 2, 3} and `y` in {0, ±1e−9, ±1},
 * and at `x` in {0, ±1e−9} for `y` in {±0.5, ±2}: on the real axis, on both
 * sides of the branch cuts, and at 0. `scipy.special.loggamma` takes a
 * different branch than the interpreter, so `GammaLn` is a function lowering
 * that fails closed on a complex value (see its entry in `PYTHON_FUNCTIONS`):
 * it is the analytic continuation of log Γ, not the principal logarithm of Γ.
 * At `−2.5 + 0i` it answers `−0.0562 − 9.4248i`, the interpreter `−0.0562`,
 * and off the axis the imaginary parts differ by a multiple of 2π.
 *
 * The inverse trigonometric and inverse hyperbolic functions are function
 * lowerings (`pyInverseTrig`): `cmath` and NumPy pick the side of a branch
 * cut from the sign of a zero part, which the interpreter does not have.
 * `Sign` is a function lowering (`pyComplexScalarLowering`): `np.sign` of a
 * complex value depends on the NumPy version. `np.arctan2` and `scipy.special.gammaincc`
 * take real arguments only. `GammaRegularized` is a function lowering
 * (`pyUpperGamma`) that computes with real numbers only, so it is listed in
 * `PYTHON_REAL_ONLY_FUNCTION_LOWERINGS`.
 *
 * `Gamma` and `Factorial` are function lowerings through
 * `scipy.special.gamma`, which takes a complex argument too, and are not
 * real-only on this target.
 */
const PYTHON_COMPLEX_CAPABLE_HELPERS: ReadonlySet<string> = new Set([
  'Erf',
  'Erfc',
  'Lb',
  'Log2',
  'Log10',
  'Exp2',
  'Determinant',
  'Inverse',
  'MatrixMultiply',
  'MatrixPower',
  'Cross',
  'Diagonal',
]);

/** The heads with a function lowering that computes with real numbers
 * only. A head mapped to a helper name is real-only by that mapping
 * (`BaseCompiler.stringHelperIsRealOnly`); a function lowering is not, so
 * these heads are listed here. */
const PYTHON_REAL_ONLY_FUNCTION_LOWERINGS: ReadonlySet<string> = new Set([
  'GammaRegularized',
]);

/** `CompileTarget.isRealOnlyLowering` of this target. */
function pythonIsRealOnlyLowering(
  head: string,
  lowering: CompiledFunction<Expression> | undefined
): boolean {
  if (BaseCompiler.REAL_ONLY_BY_DEFINITION.has(head)) return true;
  if (PYTHON_REAL_ONLY_FUNCTION_LOWERINGS.has(head)) return true;
  return (
    BaseCompiler.stringHelperIsRealOnly(head, lowering) &&
    !PYTHON_COMPLEX_CAPABLE_HELPERS.has(head)
  );
}

/**
 * The parameters of a compiled Python function that must refuse a string
 * argument, each with the message of the `TypeError` it raises.
 *
 * The compiled code reads a parameter of a collection type as a Python
 * sequence, and Python reads a string as a sequence of code points: `len` of
 * `"e" + U+0301 + "x"` is 3, where the interpreter counts 2 characters
 * (grapheme clusters), and `s[0]` is a part of a character. A parameter
 * refuses a string when the JavaScript target refuses one for the same
 * declared type (`stringRefusedEntryType`, javascript-target.ts): every type
 * whose members are lists, indexed collections or collections, bare or with
 * an element type, except a type that a string inhabits as text
 * (`indexed_collection<character>`, `string | list<number>`), whose
 * collection lowerings fail closed at compile time instead. CE-231.
 *
 * `name` gives the Python identifier of a parameter. Each entry is the
 * Python condition that is true for a string argument, and the message.
 *
 * The condition and the raise reach `isinstance`, `str` and `TypeError`
 * through `__import__("builtins")`, because these three names are valid
 * names for a parameter or a local: with a list parameter named `str`, the
 * bare test `isinstance(str, str)` received the list as its second argument
 * and raised `TypeError` for a valid list. A user name `__import__` fails
 * closed (`pythonAssertNoShadowedBuiltin()`).
 */
function pythonStringEntryRefusals(
  expr: Expression,
  parameters: ReadonlyArray<string>,
  name: (p: string) => string
): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const p of parameters) {
    const t = expr.engine.symbol(p).type?.type;
    if (t === undefined || !stringRefusedEntryType(t)) continue;
    result.push([
      name(p),
      `"${p}" (type \`${BaseCompiler.declaredTypeText(t)}\`) is compiled as a ` +
        `Python sequence, and compiled code does not accept a string for it: ` +
        `it would read the string as code points, not as characters. Pass a ` +
        `list, or declare the parameter \`string\` to compile text.`,
    ]);
  }
  return result;
}

/** The Python test that is true when `p` holds a string (see above). */
const pythonIsStringTest = (p: string): string =>
  `__import__("builtins").isinstance(${p}, __import__("builtins").str)`;

/** The Python expression of a `TypeError` with this message (see above). */
const pythonTypeError = (message: string): string =>
  `__import__("builtins").TypeError(${JSON.stringify(message)})`;

export class PythonTarget implements LanguageTarget<Expression> {
  /** Whether to include 'import numpy as np' in generated code */
  private includeImports: boolean;

  /** Whether to use scipy.special for advanced functions */
  private useScipy: boolean;

  constructor(options: { includeImports?: boolean; useScipy?: boolean } = {}) {
    this.includeImports = options.includeImports ?? false;
    this.useScipy = options.useScipy ?? false;
  }

  getOperators(): CompiledOperators {
    return PYTHON_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return PYTHON_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'python',
      isRealOnlyLowering: pythonIsRealOnlyLowering,
      // The compile modes this target offers (`CompileMode`) and the two
      // lowering hooks the complex discipline is emitted through: Python's
      // own `complex()` is the idempotent lift, and `.imag == 0` the exact
      // realness test. See `CompileTarget.supportedModes`.
      supportedModes: PYTHON_SUPPORTED_MODES,
      // The three helpers are Python functions declared by `withPythonHelpers`
      // when referenced: a bare `complex(x)` would RAISE on a list or a string
      // and numericize a boolean, where the discipline requires a non-number
      // held by a wide binding to pass through untouched.
      complexLift: (code) => `_ce_cplx(${code})`,
      complexIsReal: (code) => `_ce_cisreal(${code})`,
      complexReal: (code) => `_ce_creal(${code})`,
      complexRealElements: (code) => `_ce_creal_elems(${code})`,
      realGuard: (guards, body, kind) =>
        guards.length === 0
          ? `(${body})`
          : `((${body}) if (${guards.join(' and ')}) else ${
              kind === 'boolean'
                ? 'False'
                : // `'color'` cannot reach here: this target lowers no color
                  // head, so a color expression declines before a real-only
                  // guard is built around it. A color lowering added to Python
                  // must give this arm a non-finite color of its own.
                  "float('nan')"
            })`,
      // Chained relations join with Python's `and`, not `&&`.
      chainOp: 'and',
      // Evaluate a shared middle operand of a chained relation exactly once
      // (matching the interpreter) by binding it in an immediately-applied
      // `lambda` — Python's expression-position value binding.
      bindExpr: (bindings, body) =>
        `(lambda ${bindings.map((b) => b[0]).join(', ')}: ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      // Dependency-ordered CSE temporaries: a FLAT sequential binding
      // comprehension, `[body for _cse1 in [rhs1] for _cse2 in [rhs2]][0]`.
      // Later `for` clauses see earlier names, each right-hand side evaluates
      // exactly once, and the nesting depth is CONSTANT — nested lambdas would
      // grow with the candidate count and could break a previously-compilable
      // expression (design §6.2, §7.5).
      cseBind: (bindings, body) =>
        `[${body} ${bindings
          .map(([name, code]) => `for ${name} in [${code}]`)
          .join(' ')}][0]`,
      // A repeated bare-symbol square (`x^2` twice) is NOT bound: `x ** 2`
      // is one operation, and the comprehension above allocates a list and
      // runs a loop to bind it — more than it saves. Larger repeats are
      // still bound under the ordinary size and benefit thresholds.
      shareSymbolSquares: false,
      // The `If` that ends a function body keeps the statement-form harvest
      // (`CompileTarget.valueTailSelections`): this target may write it, or
      // the block around it, as an if-statement.
      valueTailSelections: false,
      // A `broadcastable` head over its single collection operand
      // (`Sin([1,2,3])`, `1 + L`) fans out as a LIST COMPREHENSION — always
      // valid Python, and it preserves the element-wise semantics exactly,
      // without assuming the caller bound a NumPy array (`np.sin` of a plain
      // list happens to work, but `-L` negates only an ndarray, and `2 * L`
      // REPEATS a list; the comprehension is uniform for a list, a tuple and
      // an ndarray alike, and for a head with no NumPy vectorization at all).
      // Any scalar operand is spliced into the body by `lowering.element`, so
      // the arity of the head does not change the spelling.
      broadcastUnary: (_head, _operand, lowering, bcTarget) => {
        const v = BaseCompiler.tempVar(bcTarget);
        return `[${lowering.element(v)} for ${v} in ${lowering.collection()}]`;
      },
      // `Not` and `Argument` take their collection operand whole: NumPy's
      // `np.logical_not` and `np.angle` are element-wise. The codegen of
      // `Not` checks that the operand is a collection of booleans
      // (`assertPyBroadcastableConnective`), and a fan-out would hand that
      // check one element of unknown type instead.
      collectionAwareHeads: PYTHON_COLLECTION_AWARE_HEADS,
      operators: (op) => PYTHON_OPERATORS[op],
      functions: (id) => PYTHON_FUNCTIONS[id],
      // Resolve a mathematical constant; otherwise return `undefined` so
      // BaseCompiler folds an assigned value / declared constant into the code
      // (matching `evaluate()` and the JavaScript target) and falls back to the
      // bare identifier — a Python parameter name — only for a genuinely free
      // symbol.
      var: (id) => PYTHON_CONSTANTS[id],
      // A free symbol is emitted as a bare identifier, which must not be a
      // Python keyword.
      mangleId: pythonCheckIdentifier,
      constant: (id) => PYTHON_CONSTANTS[id] ?? PYTHON_BOOLEANS[id],
      // A non-finite part is spelled `float('inf')` or `float('nan')`: the
      // JavaScript spelling `Infinity` is not a Python name (the complex pole
      // `{re: ∞, im: ∞}` is a folded constant, see `tryConstantFold`).
      complex: (re, im) =>
        `complex(${pythonFloatLiteral(re)}, ${pythonFloatLiteral(im)})`,
      string: (str) => JSON.stringify(str),
      number: (n) => {
        // Python number literals
        if (!isFinite(n)) {
          if (n === Infinity) return 'np.inf';
          if (n === -Infinity) return '-np.inf';
          return 'np.nan';
        }
        return n.toString();
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      // Absence capability (§3.F): numeric absence is `math.nan`; the object
      // axis is `None`. Consumed by `IsMissing`/`Coalesce`/Kleene `Equal` (P3).
      //
      // The numeric test reads `None` as absent as well as `math.nan`
      // (2026-09-22). A WRITTEN absence symbol (`Missing`, `Undefined`) lowers
      // to the object null `None` — see the absence-symbol branch of
      // `BaseCompiler._compileInner` — and `math.isnan(None)` raises a
      // `TypeError`, so the `is None` test comes first and short-circuits. The
      // operand is bound to a lambda parameter so it is evaluated once.
      absence: {
        numeric: {
          make: () => 'math.nan',
          isAbsent: (x) => `(lambda _c: _c is None or math.isnan(_c))(${x})`,
          coalesce: (x, d) =>
            `(lambda _c: ${d} if (_c is None or math.isnan(_c)) else _c)(${x})`,
          // A caller passes `None` for an absent input, and `None + 1` and
          // `np.sin(None)` raise a `TypeError`, where the interpreter answers
          // `NaN`. The read gives `float('nan')` for `None` and passes any
          // other value (a NumPy array too) through unchanged. A read that is
          // not a name is bound to a lambda parameter, so it is evaluated
          // once. A complete number literal (a `vars` source such as `'9'`,
          // `'-2.5e3'` or `'.5'`) cannot be `None`, and `9 is None` makes
          // Python print a `SyntaxWarning`, so it is returned unchanged. Only
          // the WHOLE source is tested: an expression that starts with a
          // digit (`'0 or None'`, `'2*p'`) can be `None` and keeps the read.
          readInput: (x) =>
            PYTHON_NUMBER_LITERAL.test(x)
              ? x
              : PYTHON_ATOM.test(x)
                ? `(float('nan') if ${x} is None else ${x})`
                : `(lambda _c: float('nan') if _c is None else _c)(${x})`,
        },
        object: {
          nullLiteral: 'None',
          isAbsent: (x) => `(${x} is None)`,
          // The operand is bound to a lambda parameter so it is evaluated
          // once, as on the numeric axis: an operand with an effect or a
          // random value must not run twice.
          coalesce: (x, d) => `(lambda _c: ${d} if _c is None else _c)(${x})`,
        },
        // A raised `ValueError`, as an expression: the generator-throw
        // idiom this target already uses for its integer-operand checks
        // (`pythonIntegerDivisionLike`). `AssertPresent` (`x?!`) uses it
        // for the absent branch.
        raise: (message) => `(_ for _ in ()).throw(ValueError(${message}))`,
        // A written `Missing` is `math.nan` here, not `None`: numpy raises
        // on `None` (`np.cos(None)`, `np.median([1, None, 3])`) where the
        // interpreter answers `NaN`, and the collection-equality helper of
        // this target is a strict boolean either way (decided 2026-09-22).
        writtenSymbol: 'numeric',
      },
      // A Python Block is a bare statement sequence (like GLSL/WGSL), never a
      // JS IIFE. Fail closed if such a block is spliced as a sub-operand.
      bareStatementBlocks: true,
      // Python has no declaration keyword; a `Declare`'s value rides on the
      // separate `name = value` assignment compileBlock emits. Ignore the GPU
      // type-hint argument (`vec2` etc. is meaningless here).
      declare: (_name) => '',
      // Return-prefix the last statement and newline-join. No semicolons.
      block: (stmts) => {
        if (stmts.length === 0) return '';
        const last = stmts.length - 1;
        // A `Loop` (or any for-effect statement) as the block's last element
        // compiles to a `for`/`while` statement — return-prefixing it would
        // produce `return for …:` (a SyntaxError). Emit it as-is and make the
        // block evaluate to `None` (the Loop's `Nothing` value).
        if (/^(for|while)\b/.test(stmts[last])) stmts.push('return None');
        // A selection whose branches are statements lowers to an `if:`/`else:`
        // block (`compilePythonIfStatement`), which cannot be returned either —
        // and unlike a `Loop` it HAS a value (the branch's), so falling through
        // to `None` would be a silent wrong answer rather than the right one.
        // The root-body route says the same thing with a fuller message
        // (`pythonAssertReturnableBody`); this catches a nested block.
        else if (/^if\b/.test(stmts[last]))
          throw new Error(
            `Could not compile \`Block\`: the block's value statement is a selection whose branches ` +
              `are statements, which Python writes as an \`if:\`/\`else:\` ` +
              `block — a block cannot be returned, and its value is not ` +
              `\`None\`. Give the block a VALUE statement after the ` +
              `selection.`
          );
        // A last statement that is a `Return` is already the `return`
        // statement of the block: another `return` in front of it gave
        // `return return x`, which does not parse.
        // A last statement of several lines whose last line is a `return`
        // (a nested block, which this hook already gave its `return`) is
        // kept as it is.
        else if (
          !/^return\b/.test(stmts[last]) &&
          !/\nreturn\b[^\n]*$/.test(stmts[last])
        ) {
          // A last statement that is an assignment (`Assign(s, x)`, or a
          // `Declare` with an initializer, which this target emits as the
          // same `s = x`) is a Python STATEMENT, so `return s = x` does not
          // parse. The value of the block is the assigned value, so keep the
          // assignment as a statement and return the name it wrote: the
          // written name has the same spelling as every read of that name,
          // so the `return` reads the value just stored. The pattern cannot
          // match an expression statement: no Python expression starts with
          // a token free of spaces and brackets followed by a single ` = `.
          const assigned = /^([^\s()[\]{}'"=,:]+) = /.exec(stmts[last]);
          if (assigned !== null) stmts.push(`return ${assigned[1]}`);
          else stmts[last] = `return ${stmts[last]}`;
        }
        return stmts.join('\n');
      },
      // Per-compilation naming state for generated temporaries (see the
      // JavaScript target).
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
  }

  /**
   * Build a `var` resolver honoring, in order: shadowed parameters (kept bare),
   * an explicit `vars` mapping (which always wins over folding — a per-call
   * substitution), mathematical constants, then `undefined` so BaseCompiler
   * folds an assigned value / emits the bare identifier for a free symbol.
   */
  private makeVarResolver(
    vars?: Record<string, string>,
    shadowed?: ReadonlyArray<string>
  ): (id: string) => string | undefined {
    return (id: string) => {
      if (shadowed?.includes(id)) return id;
      // A string `vars` value is source spliced in as-is (the live-path
      // contract); a non-string value is a constant to bake.
      // Own-property test — see the `vars` lookup in `javascript-target.ts`:
      // `in` finds `Object.prototype` members on a caller-supplied map.
      if (vars && Object.hasOwn(vars, id)) {
        const v = vars[id];
        if (typeof v !== 'string') return JSON.stringify(v);
        // A mapping to a bare identifier is checked like a free symbol's own
        // name (`mangleId`); other source (`p["a"]`) is spliced in unchanged.
        if (/^[A-Za-z_]\w*$/.test(v)) pythonCheckIdentifier(v);
        return v;
      }
      return PYTHON_CONSTANTS[id];
    };
  }

  /**
   * Compile to Python source code (not executable in JavaScript)
   *
   * Returns Python code as a string. To execute it, use Python runtime.
   */
  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'python'> {
    // The `storage` hints are shader-only and ignored by this target, but
    // validated on every target (see `javascript-target.ts`).
    if (options.storage !== undefined)
      resolveStorageHints(options.storage, [expr], this.createTarget(), {
        vars: options.vars,
        functions: options.functions,
      });
    const requestedMode = options.mode;
    try {
      // Under `auto` — requested, or this target's default — a lane mismatch
      // in the strict attempt redoes the compilation under the complex
      // discipline. Shared with the standalone `compile()` route, which
      // reaches the escalation through this method rather than owning a copy
      // of it (`auto-escalation.ts`); `compileOrThrow` throws on a decline, so
      // the mismatch reaches the retry instead of the fallback built below,
      // and each attempt builds its own target.
      // A `vars`-mapped symbol is compiled as the valueless input of its
      // declared type (`withVarsValuesHidden`).
      return withVarsValuesHidden(expr, options.vars, () =>
        compileWithAutoEscalation(requestedMode, PYTHON_SUPPORTED_MODES, (m) =>
          this.compileOrThrow(
            expr,
            m === requestedMode ? options : { ...options, mode: m }
          )
        )
      );
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
      // A cancellation that is not a timeout (an abort, an iteration or
      // recursion limit), or a timeout of an expired enclosing span, belongs
      // to the caller: it is thrown again, not changed into a fallback
      // (docs/TIMEOUT-MODEL.md §2).
      throwIfCallerCancellation(e, expr.engine._deadlineFrame);
      if (options.fallback !== true) throw e;
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: python): ${error}`
      );
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        'python',
        this.createTarget(),
        options.vars ? new Set(Object.keys(options.vars)) : undefined,
        compileDiagnosticOf(e, error)
      );
    }
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {},
    writtenInputs?: ReadonlyArray<string>
  ): CompilationResult<'python'> {
    const source = expr;
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
    // Turn a collection whose WIDTH is known at compile time into straight-line
    // scalar code, so this target sees the shape the interpreter computes
    // rather than a runtime array (`fixed-width-unroll.ts`). No head is
    // withheld from the pass here: this target has no `functions`/`operators`
    // override channel, so no caller implementation can be handed operands the
    // pass changed.
    expr = unrollFixedWidthCollections(expr, {
      iterationBudget: options.iterationBudget,
      readsLiveSource: (name) => typeof options.vars?.[name] === 'string',
    });
    const vars = options.vars as Record<string, string> | undefined;
    const resolveVar = this.makeVarResolver(vars);
    // The local copy of each input that the body writes (the second
    // compilation, see below).
    const inputLocals = new Map<string, string>();
    // Root compilation boundary: fresh, deterministic numbering for the
    // generated temporaries, seeded with the names this compilation must not
    // reuse (see `NamingContext`).
    const target = this.createTarget({
      var: (id) => inputLocals.get(id) ?? resolveVar(id),
      // See `CompileTarget.inputWrites`.
      inputWrites: new Set<string>(),
      inputLocals,
      // A `vars`-mapped symbol is a live runtime input: the constant folder
      // must never fold a subtree that mentions one, even when the symbol
      // has an engine value (`CompileTarget.varsKeys`).
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      constantFold: options.constantFold,
      // The caller's requested compile mode; validated against
      // `supportedModes` and latched by `BaseCompiler.compile` at depth 0.
      mode: options.mode,
      naming: pythonRootNaming(expr, [
        options.preamble,
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // Common-subexpression elimination (design §4.2). This target has no
    // `functions`/`operators` override channel, so the only G1b provenance to
    // record is the string-valued `vars` keys.
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) =>
        vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name),
    });
    for (const name of writtenInputs ?? [])
      inputLocals.set(name, BaseCompiler.tempVar(target));
    pythonAssertReturnableSelection('compile()', expr, true);
    let body = compilePythonRoot(expr, target);
    // The body assigns an input (`u ≔ u + 1`, when an engine scope binds
    // `u`). The code has no `def`, and a host runs it in a context that this
    // target does not know: at the top level of a module, or in a function
    // that the host writes around it. In a function, an assignment of `u`
    // makes `u` a local of the whole function, so a read of `u` before the
    // write raised `UnboundLocalError` when `u` is a global of the host. A
    // write also changed the value that the host gave. The expression is
    // compiled again, with each written input read and written as a local
    // copy that starts with the value of the input (`_tv1 = u`). The copy
    // reads `u` in each of these contexts: a global, a parameter of the
    // host's function, or a variable of an enclosing function. The
    // initialization is not emitted when the first statement that names the
    // copy is a write that always runs (`pythonWrittenFirst`). The Python
    // target spells a free symbol with its own name (`pythonCheckIdentifier`),
    // so a recorded spelling is the name of the symbol.
    if (writtenInputs === undefined && target.inputWrites!.size > 0)
      return this.compileOrThrow(source, options, [...target.inputWrites!]);
    const initializations = [...inputLocals]
      .filter(([, local]) => !pythonWrittenFirst(body, local))
      .map(([name, local]) => `${local} = ${resolveVar(name) ?? name}`);
    if (initializations.length > 0)
      body = [...initializations, body].join('\n');
    body = pythonDistinctIdentifiers(body, {
      callerSources: pythonVarsSources(vars),
      hostNames: () =>
        BaseCompiler.analyzeReferences(
          expr,
          target,
          vars ? new Set(Object.keys(vars)) : undefined
        ).freeSymbols,
    }).body;
    let code = withPythonHelpers(body);
    pythonAssertNoShadowedBuiltin(
      code,
      expr.symbols.filter((s) => typeof vars?.[s] !== 'string')
    );
    if (this.includeImports) code = this.withImports(code);

    const result: CompilationResult<'python'> = {
      target: 'python',
      success: true,
      code,
    };
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }

  /** Prepend the numpy / cmath / scipy imports when `includeImports` is set. */
  private withImports(code: string): string {
    let imports = 'import numpy as np\n';
    imports += 'import cmath\n';
    if (this.useScipy) imports += 'import scipy.special\n';
    // `math.prod` (from a compiled Product) needs `import math`. The `\b`
    // anchor avoids a false match on `cmath.` (no word boundary before `math`).
    if (/\bmath\./.test(code)) imports += 'import math\n';
    return `${imports}\n${code}`;
  }

  /**
   * Compile an expression to Python source code
   *
   * Returns the Python code as a string. Honors `options.vars` (per-call
   * substitution) and folds assigned symbols.
   */
  compileToSource(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): string {
    // The single-line statements the emitted-source scan below cannot see: an
    // assignment body emits `s = x` and a root `Declare` emits the empty
    // string. Checked structurally, before the body is compiled (D6).
    pythonAssertExpressionBody('compileToSource()', expr);
    // The engine's angular unit, in radian-based code, as `compile()` does
    // at its entry: in degree mode `sin(x)` is the sine of `x` degrees.
    expr = rewriteAngularUnit(expr);
    const vars = options.vars as Record<string, string> | undefined;
    // Root compilation boundary (see `compile`). `varsKeys`/`constantFold`:
    // same constant-folder contract as `compileOrThrow` above.
    const target = this.createTarget({
      var: this.makeVarResolver(vars),
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      constantFold: options.constantFold,
      // The caller's requested compile mode; validated against
      // `supportedModes` and latched by `BaseCompiler.compile` at depth 0.
      mode: options.mode,
      naming: pythonRootNaming(expr, [
        options.preamble,
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // A `vars`-mapped symbol is compiled as the valueless input of its
    // declared type (`withVarsValuesHidden`).
    const body = withVarsValuesHidden(expr, vars, () => {
      BaseCompiler.openCseSession(expr, target, {
        enabled: options.cse,
        isStringVar: (name) =>
          vars !== undefined && typeof vars[name] === 'string',
        isVarsKey: (name) =>
          vars !== undefined &&
          Object.prototype.hasOwnProperty.call(vars, name),
      });
      return BaseCompiler.compileCseRoot(expr, target);
    });
    // The contract of this route is an EXPRESSION. A body that lowers to
    // statements has no emission here (D6). Checked on the BODY, before the
    // helper/import preamble — those lines are the route's own, not the
    // body's.
    pythonAssertExpressionOnly('compileToSource()', body);
    const code = withPythonHelpers(
      pythonDistinctIdentifiers(body, {
        callerSources: pythonVarsSources(vars),
        hostNames: () =>
          BaseCompiler.analyzeReferences(
            expr,
            target,
            vars ? new Set(Object.keys(vars)) : undefined
          ).freeSymbols,
      }).body
    );
    pythonAssertNoShadowedBuiltin(
      code,
      expr.symbols.filter((s) => typeof vars?.[s] !== 'string')
    );
    return this.includeImports ? this.withImports(code) : code;
  }

  /**
   * Create a complete Python function from an expression
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the Python function
   * @param parameters - Parameter names (e.g., ['x', 'y', 'z'])
   * @param docstring - Optional docstring for the function
   * @param options - `cse: false` disables common-subexpression elimination
   */
  compileFunction(
    expr: Expression,
    functionName: string,
    parameters: string[],
    docstring?: string,
    options?: { cse?: boolean; constantFold?: boolean }
  ): string {
    // Both branches below put the body in a position that requires a VALUE: the
    // single-line one wraps it in `return`, the multi-line one relies on the
    // block hook having done so. A root that is an assignment or a declaration
    // has neither emission (D6). A block whose last statement is an
    // assignment (`isTailAssignmentBlock`) takes the multi-line branch, since
    // the block hook emits the assignment followed by `return <name>`; the
    // emitted body is checked after it is compiled (`pythonAssertReturnedBlock`).
    pythonAssertReturnableBody('compileFunction()', expr);
    // The function name and the declared parameters are emitted as bare
    // Python identifiers, so a Python keyword fails closed, as it does for a
    // free symbol (`def f(lambda):` is a syntax error).
    pythonCheckBindingName(functionName);
    for (const p of parameters) pythonCheckBindingName(p);
    // The engine's angular unit, in radian-based code, as `compile()` does
    // at its entry.
    expr = rewriteAngularUnit(expr);
    // Shadow the declared parameters so they stay bare identifiers (never
    // folded to an assigned engine value).
    // Root compilation boundary (see `compile`). The declared parameters are
    // emitted bare, so they join the collision inventory.
    const target = this.createTarget({
      var: this.makeVarResolver(undefined, parameters),
      constantFold: options?.constantFold,
      naming: pythonRootNaming(expr, undefined, parameters),
      inputWrites: new Set<string>(),
    });
    // CSE is default-enabled; `options.cse` is the opt-out.
    BaseCompiler.openCseSession(expr, target, { enabled: options?.cse });
    let body = compilePythonRoot(expr, target);
    pythonAssertReturnedBlock('compileFunction()', expr, body);
    // Two different names stay two different Python identifiers
    // (`pythonDistinctIdentifiers`). The function name and the parameters
    // are written outside the body, with the same replacement. The host
    // refers to the function and to the module globals by name, not to the
    // parameters.
    const ids = pythonDistinctIdentifiers(body, {
      outside: [functionName, ...parameters],
      hostNames: () => [
        functionName,
        ...BaseCompiler.analyzeReferences(expr, target).freeSymbols.filter(
          (s) => !parameters.includes(s)
        ),
      ],
    });
    body = ids.body;
    // A free symbol that is not a parameter is read as a module global. When
    // the body also assigns it (an input that an engine scope binds, as in
    // `u ≔ u + 1`), Python makes the name a local of the whole function, and
    // a read before the first write raised `UnboundLocalError`. The local
    // is initialized from the module global instead (`None` when there is
    // none), so the read gives the value of the global, and the write does
    // not change the global. The initialization is not necessary when the
    // first statement that names the symbol is a write that always runs (an
    // assignment at the top level of the body whose value does not read the
    // symbol), and it is then not emitted.
    //
    // The initialization reads the module globals with the builtin
    // `globals()` through `__import__("builtins")`, because `globals` is a
    // valid name for a parameter, a local or a free symbol: a parameter named
    // `globals` made the bare call `globals()` raise `TypeError`, and a
    // written input named `globals` raised `UnboundLocalError`. The name
    // `__import__` itself is refused (fail closed) when the expression or the
    // parameters use it.
    const writtenGlobals = [...target.inputWrites!].filter(
      (name) =>
        !parameters.includes(name) && !pythonWrittenFirst(body, ids.name(name))
    );
    if (writtenGlobals.length > 0) {
      if (
        parameters.includes('__import__') ||
        expr.symbols.includes('__import__')
      )
        throw new Error(
          `"__import__" cannot be used as a symbol or parameter name in a Python function that assigns a module global. Rename it before compiling to Python (fail closed).`
        );
      // Python stores a global under the NFKC form of its name (`ﬁ = 1`
      // stores `fi`), so the key of the lookup is that form.
      body = [
        ...writtenGlobals.map(
          (name) =>
            `${ids.name(name)} = __import__("builtins").globals().get(${JSON.stringify(ids.name(name).normalize('NFKC'))})`
        ),
        /^return\b/.test(body) || body.includes('\n') ? body : `return ${body}`,
      ].join('\n');
    }

    // A result that is the start value of a block local raises.
    body = pythonCheckedReturns(body);
    const params = parameters.map(ids.name).join(', ');
    let code = '';

    if (this.includeImports) {
      code += 'import numpy as np\n';
      code += 'import cmath\n';
      if (this.useScipy) {
        code += 'import scipy.special\n';
      }
      // `math.prod` (from a compiled Product) needs `import math`.
      if (/\bmath\./.test(body)) code += 'import math\n';
      code += '\n';
    }

    // Emit the runtime helpers (once, at module level) when the body routed
    // through them.
    if (
      body.includes('_ce_cplx(') ||
      body.includes('_ce_cisreal(') ||
      body.includes('_ce_creal(') ||
      body.includes('_ce_creal_elems(')
    )
      code += `${PYTHON_COMPLEX_HELPERS}\n`;
    if (body.includes('_ce_rref(')) code += `${PYTHON_RREF_HELPER}\n`;
    if (body.includes('_ce_bcast(')) code += `${PYTHON_BCAST_HELPER}\n`;
    if (body.includes('_ce_eqcoll(')) code += `${PYTHON_EQCOLL_HELPER}\n`;
    if (body.includes('_ce_indexof(')) code += `${PYTHON_INDEXOF_HELPER}\n`;
    if (body.includes('_ce_ord(')) code += `${PYTHON_ORD_HELPER}\n`;
    if (
      body.includes('_ce_smoothstep(') ||
      body.includes("_ce_bcast('smoothstep'")
    )
      code += `${PYTHON_SMOOTHSTEP_HELPER}\n`;
    if (body.includes('_ce_round(')) code += `${PYTHON_ROUND_HELPER}\n`;
    if (body.includes('_ce_unset(')) code += `${PYTHON_UNSET_HELPER}\n`;
    if (body.includes('_ce_int_operands(') || body.includes('_ce_remainder('))
      code += `${PYTHON_INT_OPERAND_HELPER}\n`;
    if (body.includes('_ce_pow(')) code += `${pythonPowHelper()}\n`;
    if (
      /_ce_(replaceat|replaceat_inplace|owned_copy|deleteat|insert)\(/.test(
        body
      )
    )
      code += `${PYTHON_LIST_UPDATE_HELPER}\n`;
    if (body.includes('_ce_predicate(')) code += `${PYTHON_PREDICATE_HELPER}\n`;
    if (body.includes('_ce_ugamma(')) code += `${PYTHON_UPPER_GAMMA_HELPER}\n`;

    code += `def ${ids.name(functionName)}(${params}):\n`;

    if (docstring) {
      code += `    r"""${docstring}"""\n`;
    }

    // A string argument for a parameter that the body reads as a sequence is
    // refused before the body runs (`pythonStringEntryRefusals`).
    for (const [p, message] of pythonStringEntryRefusals(
      expr,
      parameters,
      ids.name
    ))
      code += `    if ${pythonIsStringTest(p)}:\n        raise ${pythonTypeError(message)}\n`;

    if (body.includes('\n')) {
      // Block body — the block hook already put `return` on the last line.
      // Indent each statement under the `def`; do not wrap in `return`.
      const indented = body
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n');
      code += `${indented}\n`;
    } else if (/^return\b/.test(body)) {
      // A body that is a `Return` (`Return(x)`, `Block(Return(x))`) is
      // already a `return` statement.
      code += `    ${body}\n`;
    } else {
      code += `    return ${body}\n`;
    }

    pythonAssertNoShadowedBuiltin(
      code,
      [functionName, ...parameters, ...expr.symbols].map(ids.name)
    );
    return code;
  }

  /**
   * Create a vectorized NumPy function from an expression
   *
   * The generated function will work with both scalar values and NumPy arrays.
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the Python function
   * @param parameters - Parameter names
   * @param docstring - Optional docstring
   * @param options - `cse: false` disables common-subexpression elimination
   */
  compileVectorized(
    expr: Expression,
    functionName: string,
    parameters: string[],
    docstring?: string,
    options?: { cse?: boolean; constantFold?: boolean }
  ): string {
    // `functionName` is bound below as a bare Python name. The checks of
    // `compileFunction()` see only the `_<name>_scalar` spelling, which is a
    // valid identifier even for a keyword, so check the name itself here.
    pythonCheckBindingName(functionName);
    const baseFunction = this.compileFunction(
      expr,
      `_${functionName}_scalar`,
      parameters,
      docstring,
      options
    );

    let code = baseFunction + '\n';

    code += `# Vectorized version\n`;
    code += `${functionName} = np.vectorize(_${functionName}_scalar)\n`;

    pythonAssertNoShadowedBuiltin(code, [functionName]);
    return code;
  }

  /**
   * Create a lambda function from an expression
   *
   * @param expr - The expression to compile
   * @param parameters - Parameter names
   * @param options - `cse: false` disables common-subexpression elimination
   */
  compileLambda(
    expr: Expression,
    parameters: string[],
    options?: { cse?: boolean; constantFold?: boolean }
  ): string {
    // A lambda body is an EXPRESSION position, so the same two single-line
    // statement shapes `compileToSource()` declines have no emission here
    // either — the `\n` check below is blind to both (D6).
    pythonAssertExpressionBody('compileLambda()', expr);
    // The declared parameters are emitted as bare Python identifiers, so a
    // Python keyword fails closed, as it does for a free symbol.
    for (const p of parameters) pythonCheckBindingName(p);
    // The engine's angular unit, in radian-based code, as `compile()` does
    // at its entry.
    expr = rewriteAngularUnit(expr);
    // Root compilation boundary (see `compile` and `compileFunction`).
    const target = this.createTarget({
      var: this.makeVarResolver(undefined, parameters),
      constantFold: options?.constantFold,
      naming: pythonRootNaming(expr, undefined, parameters),
    });
    // Default-enabled, like `compileFunction`; `options.cse` is the opt-out.
    BaseCompiler.openCseSession(expr, target, { enabled: options?.cse });
    let body: string;
    const savedLambdaBody = pythonLambdaBody;
    pythonLambdaBody = true;
    try {
      body = BaseCompiler.compileCseRoot(expr, target);
    } finally {
      pythonLambdaBody = savedLambdaBody;
    }
    // A multi-statement construct (loop-form Sum/Product, Loop, Block) can
    // never be a Python lambda body. This path bypasses the D6 value-operand
    // guard, so check explicitly.
    if (body.includes('\n'))
      throw new Error(
        'Could not compile `compileLambda`: a multi-statement construct (loop-form Sum/Product, ' +
          'Loop, or Block) cannot be a Python lambda body — use ' +
          'compileFunction instead.'
      );
    // Any lowering that routes through a module-level `_ce_*` runtime helper
    // cannot ride along a bare lambda, which has no place to define it. Fail
    // closed rather than emit a reference to an undefined name. (`_ce_bcast` is
    // the collection-operand ElementMax/ElementMin/Clamp lowering; `_ce_indexof`
    // is IndexOf's element test; `_ce_eqcoll` is collection/tuple equality;
    // `_ce_ord` is the ordering shape guard; `_ce_rref` is RowReduce's
    // elimination; `_ce_cplx`, `_ce_cisreal`, `_ce_creal` and
    // `_ce_creal_elems` are the complex-value helpers of the complex modes;
    // `_ce_pow` is the power with the real root of a negative base, which the
    // `Power` lowering does not use in a lambda body: listed as a guard;
    // `_ce_round` is the rounding of `Round`, which
    // `pythonRoundToInteger()` writes inline in a lambda body: also a guard;
    // `_ce_predicate` is the check of a predicate's result, `pyFnArg`;
    // `_ce_ugamma` is the upper incomplete gamma of `Gamma(s, z)` and
    // `GammaRegularized`, `pyUpperGamma`.)
    for (const [helper, what] of [
      ['_ce_bcast(', 'ElementMax/ElementMin/Clamp over a collection operand'],
      ['_ce_rref(', 'RowReduce'],
      ['_ce_indexof(', 'IndexOf'],
      ['_ce_eqcoll(', 'equality over a collection or tuple operand'],
      ['_ce_ord(', 'an ordering over a collection operand'],
      ['_ce_pow(', 'a power whose base may be negative'],
      ['_ce_round(', 'Round'],
      ['_ce_unset(', 'a block local declared with no value'],
      ['_ce_predicate(', 'a predicate whose result is not provably a boolean'],
      [
        '_ce_ugamma(',
        'an upper incomplete gamma whose order is not known to be positive',
      ],
      ['_ce_cplx(', 'the complex lift of the complex modes'],
      ['_ce_cisreal(', 'the realness test of the complex modes'],
      ['_ce_creal(', 'the real projection of the complex modes'],
      [
        '_ce_creal_elems(',
        'the element-wise real projection of the complex modes',
      ],
    ] as const)
      if (body.includes(helper))
        throw new Error(
          `Could not compile \`compileLambda\`: ${what} needs the module-level ` +
            `${helper.slice(0, -1)} helper, which cannot ride along a bare ` +
            `lambda — use compileFunction instead.`
        );

    // Two different names stay two different Python identifiers
    // (`pythonDistinctIdentifiers`).
    const ids = pythonDistinctIdentifiers(body, {
      outside: parameters,
      hostNames: () =>
        BaseCompiler.analyzeReferences(expr, target).freeSymbols.filter(
          (s) => !parameters.includes(s)
        ),
    });
    const params = parameters.map(ids.name).join(', ');
    // The string refusal of `compileFunction()`, as an expression: a lambda
    // body cannot hold a `raise` statement, and the `throw()` of a new
    // generator raises its argument at once.
    let lambdaBody = ids.body;
    const refusals = pythonStringEntryRefusals(expr, parameters, ids.name);
    if (refusals.length > 0)
      lambdaBody = `${refusals
        .map(
          ([p, message]) =>
            `(_ for _ in ()).throw(${pythonTypeError(message)}) if ${pythonIsStringTest(p)} else `
        )
        .join('')}(${lambdaBody})`;
    const code = `lambda ${params}: ${lambdaBody}`;
    pythonAssertNoShadowedBuiltin(
      code,
      [...parameters, ...expr.symbols].map(ids.name)
    );
    return code;
  }
}
