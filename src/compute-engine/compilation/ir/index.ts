/**
 * The slice compiler: a table-driven compiler with an SSA representation
 * and two thin printers (JavaScript and GLSL ES 3.00). It is not used by
 * `compile()`. See `README.md`.
 *
 * The pipeline: `lower()` (the one walk, which declines what the slice does
 * not compile) → `verify()` → the warnings of the random frames → the
 * passes (each verified) → the target's profile check → a printer (whose
 * order of effectful instructions is checked against the IR's).
 *
 * The tables (`OPERATORS`, the printers' spellings) are frozen; `extend`
 * adds rows and spellings for one compilation. Nothing persists between
 * two compilations.
 */

import type { Expression } from '../../global-types.js';
import { Decline, hostVarOp, lower } from './lower.js';
import { SliceInternalError, verify } from './verify.js';
import { ALL_PASSES, runPasses, type PassOptions } from './passes.js';
import { JS, printJavaScript, type JavaScriptResult } from './print-js.js';
import { GLSL, printGlsl, type GlslResult } from './print-glsl.js';
import { spellingOf, type Spelling, type Syntax } from './print.js';
import { effects, effectTrace } from './effects.js';
import {
  deepFreeze,
  OPERATORS,
  rowOfOp,
  type OperatorRow,
} from './operators.js';
import {
  entryOf,
  lengthValues,
  outsOf,
  recursiveFunctions,
  regionsOf,
  typeToString,
  type IRType,
  type Lane,
  type Program,
  type Region,
} from './ir.js';

export { Decline } from './lower.js';
export {
  OPERATORS,
  CONSTANTS,
  REDUCTIONS,
  type OperatorRow,
} from './operators.js';
export { verify, SliceInternalError } from './verify.js';
export { lower } from './lower.js';
export { runPasses } from './passes.js';
export type { Program } from './ir.js';
export type { PassOptions } from './passes.js';
export type { JavaScriptResult } from './print-js.js';
export type { GlslResult } from './print-glsl.js';

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
  /** The spellings of the IR operations and of the region rows. */
  readonly syntax: Syntax;
};

export const TARGETS: Readonly<Record<Target, Profile>> = deepFreeze({
  javascript: {
    lanes: ['real', 'integer', 'boolean', 'complex'],
    rank: Infinity,
    runtimeLengths: true,
    draws: true,
    frames: true,
    recursion: true,
    elementwise: true,
    syntax: JS,
  },
  glsl: {
    lanes: ['real', 'integer', 'boolean'],
    rank: 1,
    runtimeLengths: false,
    draws: false,
    frames: false,
    recursion: false,
    elementwise: false,
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
  const type = (t: IRType, what: string): Refusal | undefined => {
    if (!profile.lanes.includes(t.lane))
      return { cause: `${what}: the lane ${t.lane}` };
    if (t.shape.length > profile.rank)
      return { cause: `${what}: a list of rank ${t.shape.length}` };
    const n = lengthValues(t)[0];
    if (n !== undefined && !profile.runtimeLengths) {
      const k = entry.body.params.indexOf(n);
      const list =
        k >= 0
          ? entry.paramNames[k]
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
      if (spellingOf(profile.syntax, i.op) === undefined)
        return { head, cause: `${head ?? i.op} (the operation ${i.op})` };
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
  if (!profile.recursion && recursiveFunctions(p.functions).size > 0)
    return {
      cause: `a recursive function (${[...recursiveFunctions(p.functions)].join(', ')})`,
    };
  return undefined;
}

type Instr = Region['body'][number];

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
export function seededWarnings(
  p: Program,
  rows: readonly OperatorRow[]
): Warning[] {
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
      if (i.k === 'op' && fx.of(i) === 'effectful') {
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
   *  complex lane"). Default `'strict'`. */
  readonly mode?: 'strict' | 'complex';
  /** The rule of `compile()`'s option: a `Sum` or a `Product` of more
   *  passes than the budget is NaN; on JavaScript, the passes of all the
   *  `Loop`s of one call of `run()`, nested ones and those of user
   *  functions included, over it throw a `CancellationError` with the cause
   *  `iteration-limit-exceeded`. GLSL counts no `Loop` pass. */
  readonly iterationBudget?: number;
  /** A name read as the host's text, in the scope of the entry, at each
   *  use (an effectful operation): `compile()`'s `vars`. The text has no
   *  `$` followed by a digit. */
  readonly vars?: Readonly<Record<string, string>>;
};

/** The rows and the syntax of one compilation: those of `extend`, and a
 *  row per name of `vars`, of one operation per lane. */
function tables(options: SliceOptions): {
  rows: readonly OperatorRow[];
  syntax: Syntax;
} {
  const lanes = ['real', 'integer', 'boolean'] as const;
  const vars = Object.values(options.vars ?? {});
  const x: Extension = {
    rows: [
      ...(options.extend?.rows ?? []),
      ...vars.map((_, k) => ({
        arity: 0 as const,
        signatures: lanes.map((l) => [[], l, hostVarOp(k, l)] as const),
        threads: false,
        effect: 'effectful' as const,
      })),
    ],
    spellings: {
      ...options.extend?.spellings,
      ...Object.fromEntries(
        vars.flatMap((text, k) =>
          // A newline: a text that ends in a `//` comment keeps the `)`.
          lanes.map((l) => [hostVarOp(k, l), `(${text}\n)`])
        )
      ),
    },
    helpers: options.extend?.helpers,
  };
  const base = TARGETS[options.target].syntax;
  if (options.extend === undefined && vars.length === 0)
    return { rows: OPERATORS, syntax: base };
  return {
    rows: [...OPERATORS, ...(x.rows ?? [])],
    syntax: {
      ...base,
      ops: { ...base.ops, ...x.spellings },
      helpers: { ...base.helpers, ...x.helpers },
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
  const { rows, syntax } = tables(options);
  const p = lower(expr, rows, {
    fold: options.constantFold,
    mode: options.mode,
    iterationBudget: options.iterationBudget,
    vars: Object.keys(options.vars ?? {}),
  });
  verify(p, rows);
  const warnings = seededWarnings(p, rows);
  const passes = options.passes === false ? {} : (options.passes ?? ALL_PASSES);
  runPasses(p, { ...passes, scalarize: !profile.elementwise }, rows);
  const refused = admits(p, { ...profile, syntax }, rows);
  if (refused !== undefined)
    throw new Decline(
      refused.site ?? refused.head ?? 'program',
      `${refused.cause} on ${options.target}`,
      refused.head
    );
  return Object.assign(p, { warnings });
}

export function compileSlice(
  expr: Expression,
  options: SliceOptions & { target: 'javascript' }
): JavaScriptResult & { warnings: Warning[]; program: Program };
export function compileSlice(
  expr: Expression,
  options: SliceOptions & { target: 'glsl' }
): GlslResult & { warnings: Warning[]; program: Program };
export function compileSlice(
  expr: Expression,
  options: SliceOptions
): (JavaScriptResult | GlslResult) & { warnings: Warning[]; program: Program } {
  const p = sliceProgram(expr, options);
  const { rows, syntax } = tables(options);
  const printed =
    options.target === 'javascript'
      ? printJavaScript(
          p,
          rows,
          expr.engine as never,
          syntax,
          options.iterationBudget
        )
      : printGlsl(p, rows, syntax);
  // The printer writes the effectful instructions in the IR's order.
  const trace = effectTrace(p, rows, new Map());
  const order = printed.printed.order;
  if (
    order.length !== trace.length ||
    !order.every(
      (x, k) =>
        x.name === trace[k].name &&
        x.args.join() === trace[k].args.join() &&
        x.outs.join() === trace[k].outs.join()
    )
  )
    throw new SliceInternalError(
      'slice printer: the order of the effectful instructions'
    );
  return { ...printed, warnings: p.warnings, program: p };
}
