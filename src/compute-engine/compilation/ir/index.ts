/**
 * The slice compiler: a table-driven compiler with an SSA representation
 * and thin printers (JavaScript, GLSL ES 3.00, interval JavaScript);
 * `compile()` reaches it through the adapters. See `README.md`.
 *
 * The pipeline: `lower()` (the one walk, which declines what the slice does
 * not compile) → the warnings of the random frames → the passes →
 * `verify()` → the target's profile check → a printer (whose order of
 * effectful instructions is checked against the IR's). With the checks on
 * (`setPassChecks()`, on in the test suite), the program is also verified
 * after the lowering and after each pass.
 *
 * The tables (`OPERATORS`, the printers' spellings) are frozen; `extend`
 * adds rows and spellings for one compilation. Nothing persists between
 * two compilations.
 */

import type { Expression } from '../../global-types.js';
import { Decline, hostVarOp, lower } from './lower.js';
import { UNSUPPORTED_MODE } from './lower-context.js';
import { TEXT_LIST_MAKERS, TEXT_LIST_READS } from './lower-strings.js';
import { readsVarsObject } from '../vars-inputs.js';
import { passChecksOn, SliceInternalError, verify } from './verify.js';
import {
  ALL_PASSES,
  runPasses,
  SCALARIZE_LIMIT,
  type PassOptions,
} from './passes.js';
import {
  JS,
  JS_BIGINT,
  printJavaScript,
  type JavaScriptResult,
} from './print-js.js';
import {
  GLSL,
  isVectorArray,
  printGlsl,
  type GlslResult,
} from './print-glsl.js';
import {
  INTERVAL_ROWS,
  dropClosedForms,
  JS_INTERVAL,
  printInterval,
  type IntervalPrinted,
} from './print-interval.js';
import { spellingOf, type Spelling, type Syntax } from './print.js';
import { narrow } from './narrow.js';
import { outline, type Outline } from './outline.js';
import { plain } from './plain.js';
import { effects, effectTrace, sameTrace } from './effects.js';
import {
  deepFreeze,
  LIST_LOCAL_OPS,
  OPERATORS,
  regionRow,
  rowOfOp,
  type OperatorRow,
} from './operators.js';
import {
  argsOf,
  entryOf,
  lengthValues,
  outsOf,
  recursiveFunctions,
  regionsOf,
  typeToString,
  useIndex,
  type IRType,
  type Instr,
  type Lane,
  type Program,
  type Region,
  type V,
} from './ir.js';

export { Decline } from './lower.js';
export { OPERATORS } from './operators.js';
export { verify } from './verify.js';
export type { Program } from './ir.js';

export type Target = 'javascript' | 'glsl';

/** What a target can hold and print. The one check before printing,
 *  `admits()`, reads only this. */
export type Profile = {
  readonly lanes: readonly Lane[];
  /** The deepest list. */
  readonly rank: number;
  readonly runtimeLengths: boolean;
  readonly draws: boolean;
  readonly frames: boolean;
  readonly recursion: boolean;
  /** Element-wise operations on lists; without, `scalarize` runs first. */
  readonly elementwise: boolean;
  /** The lanes of which no list is held: on GLSL, a list of colours or of
   *  complex numbers (a `vec3` or a `vec2` has no array of its own here);
   *  on JavaScript, a list of lists of rows. A list of strings is admitted
   *  by the rule of `stringListRefusal()`. */
  readonly scalarLanes: readonly Lane[];
  /** A list of rank 2 is held when its two lengths are constants and its
   *  rows have 2 to 4 elements: on GLSL an array of vectors (`vec2[3]`, a
   *  list of points). */
  readonly vectorArrays?: boolean;
  /** The operations whose value is admitted only as the result of the
   *  entry, each with the cause of a refusal elsewhere: on GLSL a colour is
   *  an OKLCh `vec3` with no tag of its space, so a conversion to another
   *  space is the program's result only; on JavaScript a list of rows of
   *  different lengths (the lane `rows`) is read by no operation. */
  readonly resultOnly?: Readonly<Record<string, string>>;
  /** The spellings of the IR operations and of the region rows. */
  readonly syntax: Syntax;
};

export const TARGETS: Readonly<Record<Target, Profile>> = deepFreeze({
  javascript: {
    lanes: ['real', 'integer', 'boolean', 'complex', 'color', 'string', 'rows'],
    rank: Infinity,
    runtimeLengths: true,
    draws: true,
    frames: true,
    recursion: true,
    elementwise: true,
    scalarLanes: ['rows'],
    resultOnly: Object.fromEntries(
      ['rows.chunk', 'rows.partition', 'rows.pair'].map((op) => [
        op,
        'Chunk or Partition with rows of different lengths, other than as the result of the program',
      ])
    ),
    syntax: JS,
  },
  glsl: {
    lanes: ['real', 'integer', 'boolean', 'complex', 'color'],
    rank: 1,
    runtimeLengths: false,
    draws: false,
    frames: false,
    recursion: false,
    elementwise: false,
    scalarLanes: ['color', 'complex'],
    vectorArrays: true,
    resultOnly: Object.fromEntries(
      ['asoklab', 'asrgb', 'ashsv', 'ashsl', 'ashsv.own', 'ashsl.own'].map(
        (op) => [
          op,
          `${rowOfOp(OPERATORS, op)!.row.head} other than as the result of the program (a colour is an OKLCh value with no tag of its space)`,
        ]
      )
    ),
    syntax: GLSL,
  },
});

/** What `profile` cannot hold or print in `p` (the head of the operator
 *  when there is one, the text of the node of a region when it has one,
 *  and the cause), or `undefined`. */
export type Refusal = {
  readonly head?: string;
  readonly site?: string;
  readonly cause: string;
};

export function admits(
  p: Program,
  profile: Profile,
  rows: readonly OperatorRow[] = OPERATORS
): Refusal | undefined {
  const entry = entryOf(p);
  // Read by the `resultOnly` check only.
  let uses: ReturnType<typeof useIndex>['uses'] | undefined;
  const type = (t: IRType, what: string): Refusal | undefined => {
    if (!profile.lanes.includes(t.lane))
      return { cause: `${what}: the lane ${t.lane}` };
    if (profile.scalarLanes.includes(t.lane) && t.shape.length > 0)
      return {
        cause: `${what}: a list of ${t.lane === 'color' ? 'colours' : t.lane === 'string' ? 'strings' : t.lane === 'rows' ? 'lists of rows' : 'complex numbers'}`,
      };
    if (
      t.shape.length > profile.rank &&
      !(profile.vectorArrays === true && isVectorArray(t))
    )
      return { cause: `${what}: a list of rank ${t.shape.length}` };
    const n = lengthValues(t)[0];
    if (n !== undefined && !profile.runtimeLengths) {
      const k = entry.body.params.indexOf(n);
      // A length parameter has the name of its list.
      const f = p.functions.find((f) => f.body.params.includes(n));
      const list =
        k >= 0
          ? entry.paramNames[k]
          : f !== undefined
            ? `parameter ${f.paramNames[f.body.params.indexOf(n)]} of ${f.source ?? f.name}`
            : 'made by the program (a Range or a Filter)';
      return {
        cause: `the list ${list} has a run-time length: it needs a stated length (an input declared list<real^n>)`,
      };
    }
    return undefined;
  };
  const instr = (i: Instr): Refusal | undefined => {
    if (i.k === 'op') {
      if (i.op === 'draw' && !profile.draws)
        return { head: 'Random', cause: 'Random' };
      const head = rowOfOp(rows, i.op)?.row.head;
      // `scalarize` leaves an operation over a longer list element-wise.
      if (
        !profile.elementwise &&
        p.types[i.out].shape.length > 0 &&
        lengthValues(p.types[i.out]).length === 0 &&
        rowOfOp(rows, i.op)?.row.threads === true
      )
        return {
          head,
          cause: `an element-wise ${head ?? i.op} over a list of more than ${SCALARIZE_LIMIT} elements`,
        };
      if (spellingOf(profile.syntax, i.op) === undefined)
        return { head, cause: `${head ?? i.op} (the operation ${i.op})` };
      // An `at` that the passes left: its index can be out of range, where
      // the interpreter gives `Missing` and `_at` the number NaN.
      if (i.op === 'at' && p.types[i.args[0]].lane === 'color')
        return {
          head,
          cause: 'an index that can be out of range, of a list of colours',
        };
      const only = profile.resultOnly?.[i.op];
      if (
        only !== undefined &&
        !(
          entry.body.yields.includes(i.out) &&
          (uses ??= useIndex(p).uses).get(i.out) === 1
        )
      )
        return { head, cause: only };
    }
    if (i.k === 'region') {
      if (i.op === 'seeded' && !profile.frames)
        return {
          head: 'WithRandomSeed',
          site: i.site,
          cause: 'WithRandomSeed',
        };
      if (profile.syntax.regions[i.op] === undefined)
        return {
          site: i.site,
          cause: `the region ${i.op} (a Map, a Filter or a Range)`,
        };
    }
    for (const v of outsOf(i)) {
      const m = type(p.types[v], typeToString(p.types[v]));
      if (m !== undefined) return m;
    }
    for (const r of regionsOf(i)) {
      const m = region(r);
      if (m !== undefined) return m;
    }
    return undefined;
  };
  const region = (r: Region): Refusal | undefined => {
    for (const v of r.params) {
      const m = type(p.types[v], 'a parameter');
      if (m !== undefined) return m;
    }
    for (const i of r.body) {
      const m = instr(i);
      if (m !== undefined) return m;
    }
    return undefined;
  };
  for (const f of p.functions) {
    const m = region(f.body);
    if (m !== undefined) return m;
  }
  if (profile.lanes.includes('string')) {
    const m = stringListRefusal(p);
    if (m !== undefined) return m;
  }
  if (entry.tuple === true && profile.syntax.retTuple === undefined)
    return { head: 'Tuple', cause: 'a Tuple of elements of several shapes' };
  if (!profile.recursion && recursiveFunctions(p.functions).size > 0)
    return {
      cause: `a recursive function (${[...recursiveFunctions(p.functions)].join(', ')})`,
    };
  return undefined;
}

/**
 * A list of strings (CE-1548, CE-1556) has rank 1; it is made by a `list`
 * instruction, by a region of `TEXT_LIST_MAKERS` (`Characters`, a build or
 * a filter of a list operator), or it is a parameter of the entry; and it is
 * read only as the list operand of `TEXT_LIST_READS` (`StringJoin`, an
 * element, `At`, the order of `Sort`), each of which conditions what it
 * reads, or, when it is not a parameter, it is a result of the entry. An
 * element-wise operation, another order (`Max`, `Ordering`, a `Sort` by a
 * key or a comparator), an arm, a carried value or a call refuses. The
 * passes run before, so a list of constant length whose reads they fold is
 * a `list` of its elements.
 *
 * A value of `text.at` is `undefined` out of range, which no other
 * operation on a string takes: it is used only by `text.isundef`, as the
 * operand 1 of `text.present`, as the yield of the `else` arm of an `if`
 * whose condition is `text.isundef` of it (`Coalesce`), or as a result of
 * the entry. Any other use refuses.
 */
function stringListRefusal(p: Program): Refusal | undefined {
  const entry = entryOf(p);
  const listOf = (v: V) =>
    p.types[v].lane === 'string' && p.types[v].shape.length > 0;
  const refusal: Refusal = {
    cause:
      'a list of strings other than a literal, Characters, a list operation or an input, read by StringJoin, an element read, Sort or as the result',
  };
  const absent: Refusal = {
    head: 'At',
    cause:
      'a string read of a list that can be out of range, other than as the result or in IsMissing, Coalesce or AssertPresent',
  };
  // The values of `text.at`, and the operand of each `text.isundef`.
  const reads = new Set<V>();
  const tested = new Map<V, V>();
  const index = (r: Region): void =>
    r.body.forEach((i) => {
      if (i.k === 'op' && i.op === 'text.at') reads.add(i.out);
      if (i.k === 'op' && i.op === 'text.isundef') tested.set(i.out, i.args[0]);
      regionsOf(i).forEach(index);
    });
  p.functions.forEach((f) => index(f.body));
  const walk = (r: Region, guard?: V): Refusal | undefined => {
    if (r !== entry.body && r.params.some(listOf)) return refusal;
    for (const i of r.body) {
      const made = outsOf(i).filter(listOf);
      if (
        made.some((v) => p.types[v].shape.length !== 1) ||
        (made.length > 0 &&
          i.k !== 'list' &&
          !(i.k === 'region' && TEXT_LIST_MAKERS.includes(i.op)))
      )
        return refusal;
      const read = i.k === 'op' && TEXT_LIST_READS.includes(i.op);
      if (read && !listOf(i.args[0])) {
        const head = i.op.startsWith('text.joinl') ? 'StringJoin' : 'At';
        return { head, cause: `${head} of a list that is not of strings` };
      }
      if (argsOf(i).some((v, k) => listOf(v) && !(read && k === 0)))
        return refusal;
      if (
        argsOf(i).some(
          (v, k) =>
            reads.has(v) &&
            !(i.k === 'op' && i.op === 'text.isundef') &&
            !(i.k === 'op' && i.op === 'text.present' && k === 1)
        )
      )
        return absent;
      const regions = regionsOf(i);
      for (const x of regions) {
        const m = walk(
          x,
          i.k === 'if' && x === i.else ? tested.get(i.cond) : undefined
        );
        if (m !== undefined) return m;
      }
    }
    if (
      r.yields.some(
        (v) => listOf(v) && (r !== entry.body || r.params.includes(v))
      )
    )
      return refusal;
    if (r.yields.some((v) => reads.has(v) && r !== entry.body && v !== guard))
      return absent;
    return undefined;
  };
  for (const f of p.functions) {
    const m = walk(f.body);
    if (m !== undefined) return m;
  }
  return undefined;
}

export type Warning = {
  readonly code: 'seeded-draw-order';
  readonly message: string;
};

/**
 * The warning of each random frame whose draws are not made by one site
 * evaluated once: its values are deterministic, in the compiler's order,
 * and can differ from the interpreter's. A site is an effectful operation;
 * a site under a loop, a build, or a call of an effectful function is not
 * evaluated once. A frame nested in the frame has its own warning.
 */
function seededWarnings(p: Program, rows: readonly OperatorRow[]): Warning[] {
  const fx = effects(p, rows);
  const warnings: Warning[] = [];
  const count = (r: Region, repeated: boolean, why: string[]): number =>
    r.body.reduce((n, i) => {
      if (i.k === 'region' && i.op === 'seeded') {
        frame(i);
        return n;
      }
      if (i.k === 'call' && fx.of(i) === 'effectful')
        why.push(`a call of ${i.fn}`);
      // A draw, or a region that draws by itself (`choice`); not a write
      // of a list local.
      if (
        ((i.k === 'op' && !LIST_LOCAL_OPS.includes(i.op.split('.')[0])) ||
          (i.k === 'region' && regionRow(i.op)?.effect === 'effectful')) &&
        fx.of(i) === 'effectful'
      ) {
        if (repeated) why.push('a draw in a loop or a per-element body');
        n += 1;
      }
      const inner = i.k === 'loop' || (i.k === 'region' && i.op !== 'seeded');
      return (
        n +
        regionsOf(i).reduce((m, x) => m + count(x, repeated || inner, why), 0)
      );
    }, 0);
  const frame = (i: Instr & { k: 'region' }) => {
    const why: string[] = [];
    const n = count(i.regions[0], false, why);
    if (n > 1) why.push(`${n} draw sites`);
    if (why.length > 0)
      warnings.push({
        code: 'seeded-draw-order',
        message: `${i.site ?? 'WithRandomSeed'}: ${why.join(', ')}; the draws are made in the compiler's order, which can differ from the interpreter's`,
      });
  };
  const walk = (r: Region) =>
    r.body.forEach((i) =>
      i.k === 'region' && i.op === 'seeded'
        ? frame(i)
        : regionsOf(i).forEach(walk)
    );
  p.functions.forEach((f) => walk(f.body));
  return warnings;
}

/** Rows and spellings for one compilation (the tests add operators). */
export type Extension = {
  readonly rows?: readonly OperatorRow[];
  readonly spellings?: Readonly<Record<string, Spelling>>;
  readonly helpers?: Readonly<Record<string, string>>;
};

export type SliceOptions = {
  readonly target: Target;
  /** The passes to run. Default: all of them. `false`: none (`scalarize`
   *  still runs for a target that needs it). */
  readonly passes?: PassOptions | false;
  readonly extend?: Extension;
  /** `false`: the lowering evaluates no closed sub-expression with `N()`
   *  (the `fold` pass is a separate switch of `passes`). */
  readonly constantFold?: boolean;
  /** `'complex'`: a row that can leave the reals takes its complex
   *  signature unless its operands prove a real value (README, "The
   *  complex lane"). `'bigint'` (JavaScript only): every number is an
   *  integer, a JavaScript `bigint` (README, "The `bigint` mode").
   *  `'interval'` (JavaScript only): every operation is the `_IA` kernel
   *  that encloses it (README, "The interval mode"). Default `'strict'`. */
  readonly mode?: 'strict' | 'complex' | 'bigint' | 'interval';
  /** The rule of `compile()`'s option: a `Sum` or a `Product` of more
   *  passes than the budget is NaN; on JavaScript, the passes of all the
   *  `Loop`s of one call of `run()`, nested ones and those of user
   *  functions included, over it throw a `CancellationError` with the cause
   *  `iteration-limit-exceeded`. GLSL counts no `Loop` pass. */
  readonly iterationBudget?: number;
  /** A name read as the host's text, in the scope of the entry, at each
   *  use (an effectful operation): `compile()`'s `vars`. The text has no
   *  `$` or `$#` followed by a digit (a placeholder of a spelling). */
  readonly vars?: Readonly<Record<string, string>>;
  /** GLSL: an input is spelled by its name, which the host declares
   *  (`compile()`'s profile), or by its text in the map (`compile()`'s
   *  `vars` on GLSL); default `in<k>_<name>`. */
  readonly bareInputs?: boolean | Readonly<Record<string, string>>;
  /** GLSL: the list inputs that the host holds in a `sampler2D`
   *  (`compile()`'s `storage`; `holdStorage()`). */
  readonly storage?: readonly string[];
  /** JavaScript: a `Sum` or a `Product` of constant bounds of at most
   *  `MAX_UNROLLED_SUM` passes is written out (`LowerOptions.unrollSums`).
   *  Default: on, except in the bigint and complex modes; never on GLSL,
   *  whose compiler unrolls a constant loop itself. `false` (a test of a
   *  loop of constant bounds) also gives the pass `inline` the rule
   *  `'loop'` outside the interval mode. Not an option of `compile()`.
   *  @internal */
  readonly unrollSums?: boolean;
  /** Called at each attempt to write a sum or a short list out (a test of
   *  the attempts of a nest). @internal */
  readonly attempted?: () => void;
};

/** The most passes of a `Sum` or a `Product` written out. */
const MAX_UNROLLED_SUM = 100;

/** The longest list of a constant length that JavaScript writes out
 *  (README, "Lists", the short lists). */
const MAX_UNROLLED_LIST = 16;

/**
 * Mark the inputs `names` and the parameters of the functions they are
 * passed to (to a fixed point) as lists in a `sampler2D`, which have no
 * value of the target: each read must be the list operand of `elem` or
 * `at`, or an argument of a call whose parameter is such a list in every
 * call. Returns the refusal, or `undefined`.
 */
function holdStorage(p: Program, names: readonly string[]): string | undefined {
  const entry = entryOf(p);
  const fns = new Map(p.functions.map((f) => [f.name, f]));
  const held = new Set<V>();
  const hold = (v: V): void => {
    held.add(v);
    p.types[v] = { ...p.types[v], storage: 'sampler2D' };
  };
  for (const name of names) {
    // An input that the program does not read has no parameter.
    const v = entry.body.params[entry.paramNames.indexOf(name)];
    if (v === undefined) continue;
    if (p.types[v].lane === 'boolean' || p.types[v].shape.length !== 1)
      return `the storage of ${name}, which is not a list of numbers`;
    hold(v);
  }
  let refusal: string | undefined;
  /** Marks the parameters that a held argument reaches; `last`: checks
   *  that no call passes a value that is not held for a held one. */
  const walk = (r: Region, last: boolean): boolean => {
    let changed = false;
    if (r.yields.some((y) => held.has(y)))
      refusal ??= 'a list in storage as a value';
    for (const i of r.body) {
      argsOf(i).forEach((a, k) => {
        if (i.k === 'call') {
          const param = fns.get(i.fn)!.body.params[k];
          if (held.has(a) && !held.has(param)) {
            changed = true;
            hold(param);
          }
          if (last && held.has(param) && !held.has(a))
            refusal ??= `a call of ${i.fn} with a list in storage and one not`;
        } else if (
          held.has(a) &&
          (i.k !== 'op' || (i.op !== 'elem' && i.op !== 'at') || k > 0)
        ) {
          const what = i.k === 'op' ? rowOfOp(OPERATORS, i.op)?.row.head : i.k;
          refusal ??= `a read of a list in storage by ${what ?? i.k} (only At reads it)`;
        }
      });
      for (const x of regionsOf(i)) changed = walk(x, last) || changed;
    }
    return changed;
  };
  while (p.functions.map((f) => walk(f.body, false)).some((c) => c));
  p.functions.forEach((f) => walk(f.body, true));
  return refusal;
}

/** The rows and the syntax of one compilation: those of `extend`, and a
 *  row per name of `vars`, of one operation per lane. */
function tables(options: SliceOptions): {
  rows: readonly OperatorRow[];
  syntax: Syntax;
} {
  const lanes = ['real', 'integer', 'boolean'] as const;
  const vars = Object.values(options.vars ?? {});
  const { extend } = options;
  const interval = options.mode === 'interval';
  const base =
    options.mode === 'bigint'
      ? JS_BIGINT
      : interval
        ? JS_INTERVAL
        : TARGETS[options.target].syntax;
  const own = interval ? INTERVAL_ROWS : OPERATORS;
  if (extend === undefined && vars.length === 0)
    return { rows: own, syntax: base };
  return {
    rows: [
      ...own,
      ...(extend?.rows ?? []),
      ...vars.map((_, k) => ({
        arity: 0 as const,
        signatures: lanes.map((l) => [[], l, hostVarOp(k, l)] as const),
        threads: false,
        effect: 'effectful' as const,
      })),
    ],
    syntax: {
      ...base,
      ops: {
        ...base.ops,
        ...extend?.spellings,
        ...Object.fromEntries(
          vars.flatMap((text, k) =>
            // A newline: a text that ends in a `//` comment keeps the `)`.
            lanes.map((l) => [hostVarOp(k, l), `(${text}\n)`])
          )
        ),
      },
      helpers: { ...base.helpers, ...extend?.helpers },
    },
  };
}

/** The verified IR of `expr` for `options.target`, after the passes, and
 *  the warnings. Throws a `Decline` for a program that the slice or the
 *  target does not compile, a `SliceInternalError` for a defect of the
 *  slice. */
export function sliceProgram(
  expr: Expression,
  options: SliceOptions
): Program & { warnings: Warning[] } {
  const profile = TARGETS[options.target];
  const bigint = options.mode === 'bigint';
  const interval = options.mode === 'interval';
  if ((bigint || interval) && options.target !== 'javascript')
    throw new Decline(
      'program',
      `the ${options.mode} mode on ${options.target}`,
      undefined,
      UNSUPPORTED_MODE
    );
  const { rows, syntax } = tables(options);
  // Sums and short lists written out: JavaScript, the interval mode
  // included, not the bigint and complex modes (README, "Lists").
  let unroll =
    options.target === 'javascript' && !bigint && options.mode !== 'complex';
  let sums = unroll && (options.unrollSums ?? true);
  let attempted = false;
  const lowering = {
    fold: options.constantFold,
    mode: options.mode,
    // The interval mode writes no NaN test of the budget (NaN reads as
    // `empty`, no value): a loop of more passes refuses to start
    // (`printInterval()`).
    iterationBudget: interval ? undefined : options.iterationBudget,
    runtimeLengths: profile.runtimeLengths,
    javascript: options.target === 'javascript' && !interval,
    // Not past the `iterationBudget`: such a loop is NaN, or refuses to
    // start in the interval mode. Not in the complex mode, where a real
    // term of a constant index is in a loop a complex one.
    unrollSums: sums
      ? Math.min(
          MAX_UNROLLED_SUM,
          Math.floor(options.iterationBudget ?? Infinity)
        )
      : 0,
    unrollBuilds: unroll ? MAX_UNROLLED_LIST : 0,
    vars: Object.keys(options.vars ?? {}),
    objectVars: Object.keys(options.vars ?? {}).filter((n) =>
      readsVarsObject(options.vars![n])
    ),
    varsTexts: options.vars,
    attempted: () => {
      attempted = true;
      options.attempted?.();
    },
  };
  // A lowering that attempted to write a sum or a list out can decline
  // where the loops do not (a term at a constant index that the loop's
  // kernel computes, a limit of the nodes): the lowering of the loops is
  // then the program's, and its decline the one reported.
  let p: Program;
  try {
    p = lower(expr, rows, lowering);
  } catch (error) {
    if (!(error instanceof Decline) || !attempted) throw error;
    unroll = sums = false;
    p = lower(expr, rows, { ...lowering, unrollSums: 0, unrollBuilds: 0 });
  }
  // The checks of the lowering and of each pass (`setPassChecks()`); the
  // program after the passes is verified in any case, below.
  const checks = passChecksOn();
  if (checks) verify(p, rows);
  // The interval mode draws nothing: a frame has no warning.
  const warnings = interval ? [] : seededWarnings(p, rows);
  if (interval) {
    narrow(p);
    if (checks) verify(p, rows);
  }
  const passes = options.passes === false ? {} : (options.passes ?? ALL_PASSES);
  // The passes that the bigint mode (README, "The `bigint` mode") and the
  // interval mode (README, "The interval mode", and "Effects" for
  // `listLoops`) turn off.
  runPasses(
    p,
    {
      ...passes,
      scalarize: !profile.elementwise,
      ...(bigint
        ? { fold: false, hoist: false, inline: false, invariants: false }
        : {}),
      ...(interval
        ? { fold: passes.fold && 'lists', hoist: false, strength: false }
        : {}),
      // Where sums are written out, a call made twice by its caller is also
      // copied (README, "User functions").
      ...(unroll
        ? {
            inline: passes.inline && (interval || sums ? 'repeated' : 'loop'),
            unrollBuilds: options.passes === false ? 0 : MAX_UNROLLED_LIST,
          }
        : {}),
      ...(interval && Math.floor(options.iterationBudget ?? Infinity) < 2 ** 32
        ? { listLoops: false }
        : {}),
    },
    rows
  );
  // A function that no call reaches from the entry (each of its calls is a
  // copy, the pass `inline`) leaves the program: no call passes it a list in
  // storage, so `holdStorage()` would leave its parameter an array. Its name
  // stays a dependency of the code, in `captures`.
  const reached = new Set([p.entry]);
  const reach = (r: Region): void =>
    r.body.forEach((i) => {
      if (i.k === 'call') reached.add(i.fn);
      regionsOf(i).forEach(reach);
    });
  for (const name of reached)
    reach(p.functions.find((f) => f.name === name)!.body);
  const dropped = p.functions.filter((f) => !reached.has(f.name));
  if (dropped.length > 0) {
    p.functions.splice(
      0,
      Infinity,
      ...p.functions.filter((f) => reached.has(f.name))
    );
    Object.assign(p, {
      captures: [...(p.captures ?? []), ...dropped.map((f) => f.source!)],
    });
  }
  if (interval) {
    const refused = plain(p);
    if (refused !== undefined)
      throw new Decline('program', `${refused} on interval-js`);
  }
  verify(p, rows);
  const lanes: Lane[] = bigint
    ? ['integer', 'boolean']
    : interval
      ? ['real', 'integer', 'boolean']
      : [...profile.lanes];
  // A decline of the interval mode names its public target.
  const where = interval
    ? 'interval-js'
    : `${options.target}${bigint ? ' in the bigint mode' : ''}`;
  const checked: Profile = { ...profile, lanes, syntax };
  // The interval mode: a closed form that the mode does not print leaves
  // the enclosure alone.
  if (interval)
    dropClosedForms(
      p,
      (r) =>
        admits(
          { ...p, functions: [{ ...entryOf(p), body: { ...r, params: [] } }] },
          checked,
          rows
        ) === undefined
    );
  const refused = admits(p, checked, rows);
  if (refused !== undefined)
    throw new Decline(
      refused.site ?? refused.head ?? 'program',
      `${refused.cause} on ${where}`,
      refused.head
    );
  return Object.assign(p, { warnings });
}

export function compileSlice(
  expr: Expression,
  options: SliceOptions & { target: 'javascript'; mode: 'interval' }
): IntervalPrinted & { warnings: Warning[]; program: Program };
export function compileSlice(
  expr: Expression,
  options: SliceOptions & {
    target: 'javascript';
    mode?: Exclude<SliceOptions['mode'], 'interval'>;
  }
): JavaScriptResult & {
  warnings: Warning[];
  program: Program;
  /** The loops that `runAsync()` can send to the worker pool (`outline()`). */
  pool?: Outline;
};
export function compileSlice(
  expr: Expression,
  options: SliceOptions & { target: 'glsl' }
): GlslResult & { warnings: Warning[]; program: Program };
export function compileSlice(
  expr: Expression,
  options: SliceOptions
): (JavaScriptResult | GlslResult | IntervalPrinted) & {
  warnings: Warning[];
  program: Program;
} {
  const p = sliceProgram(expr, options);
  const held = options.storage && holdStorage(p, options.storage);
  if (held) throw new Decline('program', `${held} on ${options.target}`);
  const { rows, syntax } = tables(options);
  // The `parallel for` loops that `runAsync()` can send to the worker pool:
  // JavaScript in the default mode, with no `iterationBudget` (one count of
  // passes for a call, which workers cannot share), for an expression (a
  // root function literal has no `runAsync()`). `run()` does not change.
  const pool =
    options.target === 'javascript' &&
    (options.mode ?? 'strict') === 'strict' &&
    options.iterationBudget === undefined &&
    entryOf(p).literal !== true
      ? outline(p, rows, syntax, expr.engine as never)
      : undefined;
  const printed =
    options.mode === 'interval'
      ? printInterval(
          p,
          rows,
          syntax,
          expr.engine.precision,
          options.iterationBudget
        )
      : options.target === 'javascript'
        ? printJavaScript(
            p,
            rows,
            expr.engine as never,
            syntax,
            options.iterationBudget,
            pool
          )
        : printGlsl(
            p,
            rows,
            options.bareInputs
              ? {
                  ...syntax,
                  input: (name) =>
                    typeof options.bareInputs === 'object' &&
                    Object.hasOwn(options.bareInputs, name)
                      ? options.bareInputs[name]
                      : name,
                }
              : syntax
          );
  // The printer writes the effectful instructions in the IR's order.
  if (!sameTrace(printed.printed.order, effectTrace(p, rows, new Map())))
    throw new SliceInternalError(
      'slice printer: the order of the effectful instructions'
    );
  return {
    ...printed,
    warnings: p.warnings,
    program: p,
    ...(pool === undefined ? {} : { pool }),
  };
}
