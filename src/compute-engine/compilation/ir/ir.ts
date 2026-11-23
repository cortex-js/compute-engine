/**
 * The intermediate representation of the slice compiler.
 *
 * A program is a list of functions; the entry function's parameters are the
 * inputs. Every value is defined once and has one type: a scalar lane
 * (`real`, `integer`, `boolean`, `complex`, `color`, `string`; `rows`, the
 * opaque list of lists of rows of different lengths that is the result of
 * a program only, `README.md`, "The rows lane") and a shape
 * (the lengths of the nested lists around the scalars: `[]` for a scalar,
 * `[3]` for a list of three). A length is a number, or an integer VALUE of the program that holds a
 * length known only at run time (`{ v }`): the length parameter of an input,
 * the length operand of a build, the count of a filter. Two lists have one
 * length when their lengths are the same value; the length value dominates
 * every value whose type names it.
 *
 * An `op` applies the IR operation of a row of `operators.ts` to its
 * operands; a row states, per operand, a scalar lane (applied to each
 * element of a list operand when the row threads) or a whole list. A
 * `region` instruction runs the regions that its row in `REGION_ROWS`
 * states (a build, a random frame). Control flow is structured: an `if` has
 * two regions and one result per value that leaves it; a `loop` counts an
 * integer index from `lo` to `hi` and carries values. A value is visible
 * after its definition in its region and in the regions nested there.
 *
 * The representation names no target.
 */

import type { Type } from '../../../common/type/types.js';
import type {
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  Expression,
} from '../../global-types.js';

export type Lane =
  | 'real'
  | 'integer'
  | 'boolean'
  | 'complex'
  | 'color'
  | 'string'
  | 'rows'
  | 'record'
  | 'nothing';

/** The value of a constant of the `complex` lane. */
export type Cx = { readonly re: number; readonly im: number };

/** A value: an index in `Program.types`. */
export type V = number;

/** A static length, or the integer value that holds a run-time length. */
export type Length = number | { readonly v: V };

/** `storage`: a list that the host holds in a storage of that kind (the
 *  option `storage` of `compile()`), set after the passes; it is read only
 *  by `elem` and `at` and passed to calls (`holdStorage()` of `index.ts`).
 *
 *  A value of the lane `record` (shape `[]`) is a record of settled fields
 *  (`README.md`, "Records"): `fields` is the IR type of each field, in
 *  order, `marks` the tuple mark of each (`Lowering.tuples`), `nominal` the
 *  name of the nominal tuple type of the value and `names` its field names
 *  (none for a `Tuple` or a `List` literal of mixed lanes). A field of the
 *  lane `nothing` holds `Nothing`. */
export type IRType = {
  readonly lane: Lane;
  readonly shape: readonly Length[];
  readonly storage?: 'sampler2D';
  readonly fields?: readonly IRType[];
  readonly marks?: readonly (number | undefined)[];
  readonly nominal?: string;
  readonly names?: readonly string[];
  /** A field of the lane `string` whose value is known when the code is
   *  emitted (CE-1652, step 4c; `README.md`, "Records"): two records whose
   *  constant fields differ are two record types. Only in `fields`: the
   *  type of a value never holds it, the lowering keeps the constant of a
   *  value aside (`Lowering.known()`). */
  readonly constant?: string;
};

/** A typed literal. An integer beyond the safe integers is a `bigint`
 *  (`mode: 'bigint'` only); a safe one is always a number. `inexact`
 *  (`mode: 'interval'` only): the value is not the double, which is within
 *  that many ulps of it. `plain` (`mode: 'interval'` only, after the pass
 *  `plain`): the integer is a number of the target, not an interval. */
export type Literal =
  | { readonly lane: 'real'; readonly value: number; readonly inexact?: number }
  | {
      readonly lane: 'integer';
      readonly value: number | bigint;
      readonly plain?: boolean;
    }
  | { readonly lane: 'boolean'; readonly value: boolean }
  | { readonly lane: 'complex'; readonly value: Cx }
  | { readonly lane: 'string'; readonly value: string };

/** The value of a constant. */
export type Constant = number | bigint | boolean | Cx | string;

/** The key of a constant: equal keys are one value (`-0` is not `0`, a
 *  literal marked `inexact` is not the double). */
export function literalKey({
  lane,
  value,
  inexact,
}: {
  lane: Lane;
  value: Constant;
  inexact?: number;
}): string {
  const n = (x: number | bigint | boolean) =>
    Object.is(x, -0) ? '-0' : String(x);
  const key =
    typeof value === 'string'
      ? `c string ${JSON.stringify(value)}`
      : typeof value === 'object'
        ? `c ${lane} ${n(value.re)} ${n(value.im)}`
        : `c ${lane} ${n(value)}`;
  return inexact === undefined ? key : `${key} ~${inexact}`;
}

export type Region = {
  /** The parameters of a function, the index and the carried values of a
   *  loop body, the index of a build; none for an arm or a frame. */
  readonly params: V[];
  body: Instr[];
  yields: V[];
};

export type Instr =
  | { k: 'const'; out: V; value: Literal }
  | { k: 'op'; out: V; op: string; args: V[] }
  | { k: 'list'; out: V; args: V[] }
  | { k: 'if'; outs: V[]; cond: V; then: Region; else: Region }
  /** `passes`: each pass is a pass of a `Loop`, which the iteration
   *  budget counts. `exit`: the position of a boolean carried value (the
   *  `Break` flag of a `Loop`); no pass runs once it is true. `parallel`:
   *  the loop of a `ParallelLoop`, which `runAsync()` can send to the
   *  worker pool (`outline.ts`). `window`: the loop runs only the passes
   *  `i0 <= i < i1` of its count, the index of pass `i` being `lo + i`, and
   *  `hi` is not read (the loop of a worker program, `outline.ts`). */
  | {
      k: 'loop';
      outs: V[];
      lo: V;
      hi: V;
      init: V[];
      body: Region;
      passes?: boolean;
      exit?: number;
      parallel?: boolean;
      window?: [V, V];
    }
  | { k: 'call'; outs: V[]; fn: string; args: V[] }
  /** The region row `op`; `site` is the source text, for a warning.
   *  `pieces`: the interval mode, the partition of an `integrate`. */
  | {
      k: 'region';
      outs: V[];
      op: string;
      args: V[];
      regions: Region[];
      site?: string;
      pieces?: number;
    };

export type IRFunction = {
  readonly name: string;
  /** The name of the user function this function compiles (absent for the
   *  entry). */
  readonly source?: string;
  /** The name of each parameter, for the host (the inputs of the entry). A
   *  `lengthOf` parameter is the length of the input of that name. */
  readonly paramNames: string[];
  readonly lengthOf: boolean[];
  /** The entry: a parameter with a `partOf` index is the part of that index
   *  of the input of its name, a tuple whose parts have different lanes
   *  (`tupleParts()`, JavaScript only). */
  readonly partOf?: (number | undefined)[];
  /** The first `positional` parameters of the entry are passed by position
   *  (the parameters of a root function literal, with the length of a list
   *  of run-time length before it); the others are inputs. */
  readonly positional?: number;
  /** The entry is a root function literal (also one of no parameter). */
  readonly literal?: boolean;
  /** A user function: its parameters from this index are the inputs that
   *  its body reads (`capture()`). */
  lifted?: number;
  /** The entry returns the array of its results: a root `Tuple` whose
   *  elements are not of one shape, which is no value of the program. */
  readonly tuple?: boolean;
  /** `params` are the parameters, `yields` the results. */
  readonly body: Region;
  readonly results: IRType[];
};

export type Program = {
  types: IRType[];
  readonly functions: IRFunction[];
  readonly entry: string;
  /** The names whose engine value the program holds as a literal. */
  readonly captures?: readonly string[];
  /** The names read as inputs (of the entry, lifted into a function,
   *  `vars`), in the order the entry first reads them (a name read in a
   *  function body: at the call), each with its engine type: the declared
   *  type of its binding at the entry when it has one
   *  (`declared`), else the type that the lowering gives the input. The
   *  report of the adapters (`inputReport()`) reads it. */
  readonly inputs?: ReadonlyMap<
    string,
    { readonly type: Type; readonly declared: boolean }
  >;
  /** The value kind types that the program reads or makes (the interval
   *  mode: `['enclosure']`, `lower-enclosure.ts`). */
  readonly valueKinds?: readonly string[];
  /** The sign of each input that the range of its declared type bounds
   *  below by 0 (`real<0..5>`, `integer<1..>`): `positive` when the bound
   *  excludes 0. A value outside its declared type gives an unspecified
   *  result, so the printers may read it (`print.ts`, `nonnegative()`). */
  readonly signs?: ReadonlyMap<V, Sign>;
  /** The variables of the engine that a root function literal assigns, in
   *  the order of their parameters: the entry takes the value of each one
   *  after the arguments, and returns the value of the body followed by the
   *  value of each one after the body (`assignedNames()` of `lower.ts`). */
  readonly assigns?: readonly Assigned[];
  /** The functions of the host that the program calls, by index: the
   *  operation `hostCallOp(k)` of `lower.ts` calls the entry `k`
   *  (`hostCall()` of `lower.ts`). */
  readonly hosts?: readonly HostCall[];
};

/** A call of a function that the host declared with an `evaluate`
 *  function (CE-1621): its name, a call of the program (which the code
 *  rebuilds over the values of the arguments, bound to the same
 *  definition), that definition, the lane of each argument, and the lane
 *  of its value, or `nothing` for a value that the code does not read. */
export type HostCall = {
  readonly name: string;
  readonly call: Expression;
  readonly definition: BoxedOperatorDefinition;
  readonly args: readonly Lane[];
  readonly result: Lane | 'nothing';
};

/** A variable of the engine that a root function literal assigns: its name,
 *  the definition that the body reads and writes, and its lane. With
 *  `list`, a list of that lane of a length known at run time, which can
 *  change at each call: the entry takes its length, then the list, and
 *  returns the list. With `rows`, a list of lists of elements of that lane
 *  (CE-1721): the entry takes the host's array of arrays (the lane `rows`)
 *  and returns the list of rank 2 that the body writes. */
export type Assigned = {
  readonly name: string;
  readonly definition: BoxedValueDefinition;
  readonly lane: Lane;
  readonly list?: true;
  readonly rows?: true;
};

/** A sign that the declared type of an input proves. */
export type Sign = 'positive' | 'nonnegative';

export const scalarType = (lane: Lane): IRType => ({ lane, shape: [] });

export function entryOf(p: Program): IRFunction {
  return p.functions.find((f) => f.name === p.entry)!;
}

/** The argument that the positional parameter `k` of `f` reads: a length
 *  parameter reads the list argument after it. */
export function argumentIndex(f: IRFunction, k: number): number {
  return f.lengthOf.slice(0, k).filter((l) => !l).length;
}

export function outsOf(i: Instr): V[] {
  return 'outs' in i ? i.outs : [i.out];
}

/** The values that `i` reads directly (not in its regions). */
export function argsOf(i: Instr): V[] {
  switch (i.k) {
    case 'const':
      return [];
    case 'if':
      return [i.cond];
    case 'loop':
      return [i.lo, i.hi, ...i.init, ...(i.window ?? [])];
    default:
      return i.args;
  }
}

export function regionsOf(i: Instr): Region[] {
  if (i.k === 'if') return [i.then, i.else];
  if (i.k === 'loop') return [i.body];
  return i.k === 'region' ? i.regions : [];
}

/** Replace each value that `i` reads directly with `f(value)`. */
export function mapDirectArgs(i: Instr, f: (v: V) => V): void {
  if (i.k === 'if') i.cond = f(i.cond);
  else if (i.k === 'loop') {
    i.lo = f(i.lo);
    i.hi = f(i.hi);
    i.init = i.init.map(f);
    if (i.window !== undefined) i.window = [f(i.window[0]), f(i.window[1])];
  } else if (i.k !== 'const') i.args = i.args.map(f);
}

/** The length values that the type `t` names. */
export function lengthValues(t: IRType): V[] {
  return t.shape.flatMap((n) => (typeof n === 'number' ? [] : [n.v]));
}

/** `t` with each length value `v` replaced with `f(v)`. */
export function mapLengths(t: IRType, f: (v: V) => V): IRType {
  if (t.shape.every((n) => typeof n === 'number')) return t;
  return {
    lane: t.lane,
    shape: t.shape.map((n) => (typeof n === 'number' ? n : { v: f(n.v) })),
  };
}

/** A value of the lane `a` is read as is where `b` is read. A real read
 *  as a complex is converted (`widensTo`): the two have other
 *  representations. */
export function isSubLane(a: Lane, b: Lane): boolean {
  return a === b || (a === 'integer' && b === 'real');
}

/** A value of the lane `a` stands where `b` is read, converted to the
 *  complex lane when `b` is complex. */
export function widensTo(a: Lane, b: Lane): boolean {
  return isSubLane(a, b) || (b === 'complex' && isSubLane(a, 'real'));
}

/** Two shapes are one shape: the same numbers and the same length values
 *  (`constant` reads a length value that is a constant as its number). */
export function sameShape(
  a: readonly Length[],
  b: readonly Length[],
  constant: (v: V) => number | undefined = () => undefined
): boolean {
  const n = (x: Length) =>
    typeof x === 'number' ? x : (constant(x.v) ?? `v${x.v}`);
  return a.length === b.length && a.every((x, i) => n(x) === n(b[i]));
}

/** A value of type `a` can stand where `b` is read: the same shape, and a
 *  sub-lane; two records are one record type, or `b` the type of `a` with
 *  fewer constant fields (`sameFields()`). */
export function isSubType(
  a: IRType,
  b: IRType,
  constant?: (v: V) => number | undefined
): boolean {
  return (
    sameShape(a.shape, b.shape, constant) &&
    isSubLane(a.lane, b.lane) &&
    sameFields(a, b, 'sub')
  );
}

/** `a` and `b` are records of one nominal type and the same fields (types,
 *  tuple marks and names), compared field by field, or neither is a
 *  record. The constant of a string field (`IRType.constant`; CE-1652,
 *  step 4c): the same in `a` and `b` (`same`), the same or absent in `b`
 *  (`sub`: a value of type `a` stands where `b` is read), or not compared
 *  (`loose`). */
export function sameFields(
  a: IRType,
  b: IRType,
  constants: 'same' | 'sub' | 'loose' = 'same'
): boolean {
  if (a.lane !== 'record' && b.lane !== 'record') return true;
  const [f, g] = [a.fields ?? [], b.fields ?? []];
  const [m, n] = [a.marks ?? [], b.marks ?? []];
  return (
    a.lane === b.lane &&
    a.nominal === b.nominal &&
    f.length === g.length &&
    a.names?.join('\u0000') === b.names?.join('\u0000') &&
    f.every(
      (x, k) =>
        m[k] === n[k] &&
        x.lane === g[k].lane &&
        sameShape(x.shape, g[k].shape) &&
        (constants === 'loose' ||
          x.constant === g[k].constant ||
          (constants === 'sub' && g[k].constant === undefined)) &&
        sameFields(x, g[k], constants)
    )
  );
}

/** The record type `a` (of the fields of `b`, `sameFields(a, b, 'loose')`)
 *  with the constant of each string field that `b` does not have. */
function commonConstants(a: IRType, b: IRType): IRType {
  if (a.lane !== 'record') {
    if (a.constant === undefined || a.constant === b.constant) return a;
    const { constant: _, ...rest } = a;
    return rest;
  }
  return {
    ...a,
    fields: a.fields?.map((f, k) => commonConstants(f, b.fields![k])),
  };
}

/** The type of a value that is either `a` or `b` (converted to the
 *  complex lane when the other is complex), or `undefined`. Two records
 *  join only when they are one record type, but for their constant
 *  fields: a field whose constants differ is a string (CE-1652, step 4c). */
export function joinType(a: IRType, b: IRType): IRType | undefined {
  if (!sameShape(a.shape, b.shape)) return undefined;
  if (a.lane === 'record' || b.lane === 'record')
    return sameFields(a, b, 'loose') ? commonConstants(a, b) : undefined;
  if (widensTo(a.lane, b.lane)) return b;
  return widensTo(b.lane, a.lane) ? a : undefined;
}

/** The index from 0 of the element `k` (from 1, or from the end when
 *  negative) of a list of the length `n`, when `n` is stated and `k` is an
 *  integer in range; else `undefined`. */
export function elementIndex(
  n: Length | undefined,
  k: Constant | undefined
): number | undefined {
  if (
    typeof n !== 'number' ||
    typeof k !== 'number' ||
    !Number.isInteger(k) ||
    k === 0 ||
    Math.abs(k) > n
  )
    return undefined;
  return k > 0 ? k - 1 : n + k;
}

/** The type of an element of a list of type `t`. */
export function elementType(t: IRType): IRType {
  return { lane: t.lane, shape: t.shape.slice(1) };
}

export function typeToString(
  t: IRType,
  /** For a message to the user: the axis of the tuple mark of the value
   *  (`tuple<real, real>`) or -1, and a run-time length without its value. */
  axis: number | false = false
): string {
  // A string field of a known value (CE-1652, step 4c).
  if (t.constant !== undefined) return JSON.stringify(t.constant);
  // A record: its fields, named or not.
  if (t.lane === 'record')
    return `${t.nominal ?? 'record'}(${(t.fields ?? [])
      .map(
        (f, j) =>
          `${t.names === undefined ? '' : `${t.names[j]}: `}${typeToString(f, t.marks?.[j] ?? (axis === false ? false : -1))}`
      )
      .join(', ')})`;
  // The tuple mark's axis is the number of list axes outside the tuple.
  const k = axis === false ? -1 : axis;
  return t.shape.reduceRight<string>(
    (s, n, i) =>
      i === k && typeof n === 'number'
        ? `tuple<${Array(n).fill(s).join(', ')}>`
        : `list<${s}${typeof n === 'number' ? `^${n}` : axis === false ? `^v${n.v}` : ''}>`,
    t.lane
  );
}

/** A bound of the passes of every loop (`Loop`, `Sum`, `Product`, a
 *  reduction) of one evaluation of the program, at compile time: a
 *  constant count is itself, a run-time count is `budget` (JavaScript: the
 *  count of a `Sum` or a `Product`, which the lowering tests against it;
 *  GLSL, which counts no pass at run time, passes 1: a run-time count is
 *  not multiplied in), multiplied down the nesting and through the calls
 *  (both arms of an `if` are added). `unbounded`: the run-time count of a
 *  `Loop` (`passes`), which no test bounds on JavaScript. */
export function loopPasses(
  p: Program,
  budget: number,
  def: ReadonlyMap<number, Instr>,
  unbounded = budget
): number {
  const memo = new Map<Region, number>();
  const passes = (r: Region): number => {
    const known = memo.get(r);
    if (known !== undefined) return known;
    const total = r.body.reduce((n, i) => {
      const inner =
        i.k === 'call'
          ? passes(p.functions.find((f) => f.name === i.fn)!.body)
          : regionsOf(i).reduce((m, x) => m + passes(x), 0);
      // A region other than `seeded` runs its body once per element or
      // sample: with a pass in it, the bound of JavaScript is `unbounded`.
      if (
        i.k === 'region' &&
        i.op !== 'seeded' &&
        inner > 0 &&
        unbounded !== budget
      )
        return n + unbounded;
      if (i.k !== 'loop') return n + inner;
      const [lo, hi] = [i.lo, i.hi].map((v) => def.get(v));
      const count =
        lo?.k === 'const' && hi?.k === 'const'
          ? Math.max(0, Number(hi.value.value) - Number(lo.value.value) + 1)
          : i.passes === true
            ? unbounded
            : budget;
      return n + (count === 0 ? 0 : count * (1 + inner));
    }, 0);
    memo.set(r, total);
    return total;
  };
  return passes(entryOf(p).body);
}

/** The functions of `p` that are in a cycle of the call graph: one walk
 *  from each function, each function visited once per walk. */
export function recursiveFunctions(
  functions: readonly IRFunction[]
): Set<string> {
  const callees = new Map<string, string[]>();
  const calls = (r: Region): string[] =>
    r.body.flatMap((i) => [
      ...(i.k === 'call' ? [i.fn] : []),
      ...regionsOf(i).flatMap(calls),
    ]);
  for (const f of functions) callees.set(f.name, calls(f.body));
  const cyclic = new Set<string>();
  for (const f of functions) {
    const seen = new Set<string>();
    const pending = [...callees.get(f.name)!];
    while (pending.length > 0) {
      const g = pending.pop()!;
      if (g === f.name) cyclic.add(g);
      if (seen.has(g)) continue;
      seen.add(g);
      pending.push(...(callees.get(g) ?? []));
    }
  }
  return cyclic;
}

/**
 * Makes a program: the entry, whose parameters are added as the lowering
 * reads the inputs, and the functions of `define()`. A region is open while
 * its instructions are emitted: `emit()` appends to the innermost open
 * region. A constant, and a pure operation on the same operands, is made
 * once while its region is open (`Range(1, n) + Range(1, n)` has one
 * length).
 */
export class Builder {
  readonly types: IRType[] = [];
  /** The value of each constant. */
  readonly constants = new Map<V, Constant>();
  /** The names whose engine value is a literal of the program. */
  readonly captures = new Set<string>();
  /** The instruction of each `op` value. */
  readonly defs = new Map<V, Instr & { k: 'op' }>();
  /** The sign of each input that its declared type proves (`Program`). */
  readonly signs = new Map<V, Sign>();
  readonly functions: IRFunction[] = [];
  private open: Region[] = [];
  private readonly paramNames: string[] = [];
  private readonly lengthOf: boolean[] = [];
  private readonly partOf: (number | undefined)[] = [];
  private readonly made = new Map<string, { v: V; region: Region }>();
  /** The number of effectful instructions emitted so far. */
  effects = 0;
  /** The instructions emitted so far that are not pure (that can throw,
   *  not terminate or have an effect), in the order of their emission. */
  readonly impure: Instr[] = [];
  /** The number of positional parameters of the entry. */
  positional = 0;
  /** The entry is a root function literal. */
  literal = false;

  constructor(
    private readonly pure: (op: string) => boolean,
    private readonly effectful: (i: Instr) => boolean,
    private readonly notPure: (i: Instr) => boolean = () => false
  ) {}

  newValue(type: IRType): V {
    this.types.push(type);
    return this.types.length - 1;
  }

  typeOf(v: V): IRType {
    return this.types[v];
  }

  current(): Region {
    return this.open[this.open.length - 1];
  }

  isOpen(r: Region): boolean {
    return this.open.includes(r);
  }

  /** The program whose entry body is the region made by `f`; when `f`
   *  gives several values, the entry returns the array of them (`tuple`). */
  program(f: () => V | V[]): Program {
    let tuple = false;
    const body = this.region([], () => {
      const v = f();
      tuple = Array.isArray(v);
      return Array.isArray(v) ? v : [v];
    });
    const results = body.yields.map((y) => this.typeOf(y));
    const main: IRFunction = {
      name: 'main',
      paramNames: this.paramNames,
      lengthOf: this.lengthOf,
      ...(this.partOf.some((j) => j !== undefined)
        ? { partOf: this.partOf }
        : {}),
      positional: this.positional,
      literal: this.literal,
      ...(tuple ? { tuple } : {}),
      body,
      results,
    };
    return {
      types: this.types,
      functions: [main, ...this.functions],
      entry: 'main',
      captures: [...this.captures],
      ...(this.signs.size > 0 ? { signs: this.signs } : {}),
    };
  }

  /** The function `fn`, whose body `f` makes with no other region open (a
   *  value of the caller is not visible in it). The instructions of the
   *  body are not counted in `effects` and `impure`: they are not the
   *  caller's, which counts the call by the function's effect. */
  define(fn: IRFunction, f: () => V[]): void {
    const [open, effects, impure] = [
      this.open,
      this.effects,
      this.impure.length,
    ];
    this.open = [fn.body];
    try {
      fn.body.yields = f();
    } finally {
      this.open = open;
      this.effects = effects;
      this.impure.length = impure;
    }
    this.functions.push(fn);
  }

  /** Run `f` with a new open region; `f` returns the region's yields. */
  region(params: V[], f: () => V[]): Region {
    const r: Region = { params, body: [], yields: [] };
    this.open.push(r);
    try {
      r.yields = f();
    } finally {
      this.open.pop();
    }
    return r;
  }

  emit(i: Instr): void {
    if (this.effectful(i)) this.effects++;
    if (this.notPure(i)) this.impure.push(i);
    if (i.k === 'op') this.defs.set(i.out, i);
    this.current().body.push(i);
  }

  /** A parameter of the entry: the input `name`, its length, or its part
   *  of the index `part`. */
  param(name: string, type: IRType, lengthOf = false, part?: number): V {
    const v = this.newValue(type);
    this.open[0].params.push(v);
    this.paramNames.push(name);
    this.lengthOf.push(lengthOf);
    this.partOf.push(part);
    return v;
  }

  /** The operation `op` in the entry body, before the instruction being
   *  made: the read of an input (`text.in`), which every later read uses.
   *  Not counted in `effects` and `impure`. */
  entryOp(op: string, args: V[], type: IRType): V {
    const out = this.newValue(type);
    const i: Instr & { k: 'op' } = { k: 'op', out, op, args };
    this.defs.set(out, i);
    this.open[0].body.push(i);
    return out;
  }

  /** The value of `key` made by `make()` once while its region is open. */
  private once(key: string, make: () => V): V {
    const m = this.made.get(key);
    if (m !== undefined && this.isOpen(m.region)) return m.v;
    const v = make();
    this.made.set(key, { v, region: this.current() });
    return v;
  }

  /** `inexact`: the mark of a real literal (`Literal`). */
  constant(value: Constant, lane: Lane, inexact?: number): V {
    return this.once(literalKey({ lane, value, inexact }), () => {
      const out = this.newValue(scalarType(lane));
      this.constants.set(out, value);
      const literal = (
        inexact === undefined ? { lane, value } : { lane, value, inexact }
      ) as Literal;
      this.emit({ k: 'const', out, value: literal });
      return out;
    });
  }

  op(op: string, args: V[], type: IRType): V {
    const make = () => {
      const out = this.newValue(type);
      this.emit({ k: 'op', out, op, args });
      return out;
    };
    return this.pure(op) ? this.once(`o ${op} ${args}`, make) : make();
  }

  list(args: V[], type: IRType): V {
    const out = this.newValue(type);
    this.emit({ k: 'list', out, args });
    return out;
  }
}

//
// The def-use index, shared by the passes and the printers
//

export type UseIndex = {
  /** The number of reads of each value, yields included. */
  readonly uses: Map<V, number>;
  /** The instruction that defines each value (absent for a parameter). */
  readonly def: Map<V, Instr>;
};

export function useIndex(p: Program): UseIndex {
  const uses = new Map<V, number>();
  const def = new Map<V, Instr>();
  const count = (v: V) => uses.set(v, (uses.get(v) ?? 0) + 1);
  const walk = (r: Region) => {
    for (const i of r.body) {
      for (const o of outsOf(i)) def.set(o, i);
      argsOf(i).forEach(count);
      regionsOf(i).forEach(walk);
    }
    r.yields.forEach(count);
  };
  for (const f of p.functions) walk(f.body);
  return { uses, def };
}
