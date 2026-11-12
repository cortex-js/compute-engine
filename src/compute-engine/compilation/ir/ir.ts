/**
 * The intermediate representation of the slice compiler.
 *
 * A program is a list of functions; the entry function's parameters are the
 * inputs. Every value is defined once and has one type: a scalar lane
 * (`real`, `integer`, `boolean`) and a shape (the lengths of the nested
 * lists around the scalars: `[]` for a scalar, `[3]` for a list of three).
 * A length is a number, or an integer VALUE of the program that holds a
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

export type Lane = 'real' | 'integer' | 'boolean';

/** A value: an index in `Program.types`. */
export type V = number;

/** A static length, or the integer value that holds a run-time length. */
export type Length = number | { readonly v: V };

export type IRType = { readonly lane: Lane; readonly shape: readonly Length[] };
// Room for an aggregate of fields (design only, no lowering): a tuple type
// `{ kind: 'tuple'; elements: IRType[] }` in a union with the type above,
// read by `elem` with a literal index and printed as an array or a struct.

/** A typed literal. A bigint or a complex pair is another member. */
export type Literal =
  | { readonly lane: 'real' | 'integer'; readonly value: number }
  | { readonly lane: 'boolean'; readonly value: boolean };

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
  | { k: 'loop'; outs: V[]; lo: V; hi: V; init: V[]; body: Region }
  | { k: 'call'; outs: V[]; fn: string; args: V[] }
  /** The region row `op`; `site` is the source text, for a warning. */
  | {
      k: 'region';
      outs: V[];
      op: string;
      args: V[];
      regions: Region[];
      site?: string;
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
  /** The first `positional` parameters of the entry are passed by position
   *  (the parameters of a root function literal); the others are inputs. */
  readonly positional?: number;
  /** The entry is a root function literal (also one of no parameter). */
  readonly literal?: boolean;
  /** `params` are the parameters, `yields` the results. */
  readonly body: Region;
  readonly results: IRType[];
};

export type Program = {
  types: IRType[];
  readonly functions: IRFunction[];
  readonly entry: string;
};

export const scalarType = (lane: Lane): IRType => ({ lane, shape: [] });

export function entryOf(p: Program): IRFunction {
  return p.functions.find((f) => f.name === p.entry)!;
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
      return [i.lo, i.hi, ...i.init];
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

export function isSubLane(a: Lane, b: Lane): boolean {
  return a === b || (a === 'integer' && b === 'real');
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
 *  sub-lane. */
export function isSubType(
  a: IRType,
  b: IRType,
  constant?: (v: V) => number | undefined
): boolean {
  return sameShape(a.shape, b.shape, constant) && isSubLane(a.lane, b.lane);
}

/** The type of a value that is either `a` or `b`, or `undefined`. */
export function joinType(a: IRType, b: IRType): IRType | undefined {
  if (!sameShape(a.shape, b.shape)) return undefined;
  if (isSubLane(a.lane, b.lane)) return b;
  return isSubLane(b.lane, a.lane) ? a : undefined;
}

/** The type of an element of a list of type `t`. */
export function elementType(t: IRType): IRType {
  return { lane: t.lane, shape: t.shape.slice(1) };
}

export function typeToString(t: IRType): string {
  return t.shape.reduceRight<string>(
    (s, n) => `list<${s}^${typeof n === 'number' ? n : `v${n.v}`}>`,
    t.lane
  );
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
  readonly constants = new Map<V, number | boolean>();
  readonly functions: IRFunction[] = [];
  private open: Region[] = [];
  private readonly paramNames: string[] = [];
  private readonly lengthOf: boolean[] = [];
  private readonly made = new Map<string, { v: V; region: Region }>();
  /** The number of effectful instructions emitted so far. */
  effects = 0;
  /** The number of positional parameters of the entry. */
  positional = 0;
  /** The entry is a root function literal. */
  literal = false;

  constructor(
    private readonly pure: (op: string) => boolean,
    private readonly effectful: (i: Instr) => boolean
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

  /** The program whose entry body is the region made by `f`. */
  program(f: () => V): Program {
    const body = this.region([], () => [f()]);
    const results = [this.typeOf(body.yields[0])];
    const main: IRFunction = {
      name: 'main',
      paramNames: this.paramNames,
      lengthOf: this.lengthOf,
      positional: this.positional,
      literal: this.literal,
      body,
      results,
    };
    return {
      types: this.types,
      functions: [main, ...this.functions],
      entry: 'main',
    };
  }

  /** The function `fn`, whose body `f` makes with no other region open (a
   *  value of the caller is not visible in it). */
  define(fn: IRFunction, f: () => V[]): void {
    const open = this.open;
    this.open = [fn.body];
    try {
      fn.body.yields = f();
    } finally {
      this.open = open;
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
    this.current().body.push(i);
  }

  /** A parameter of the entry: the input `name`, or its length. */
  param(name: string, type: IRType, lengthOf = false): V {
    const v = this.newValue(type);
    this.open[0].params.push(v);
    this.paramNames.push(name);
    this.lengthOf.push(lengthOf);
    return v;
  }

  /** The value of `key` made by `make()` once while its region is open. */
  private once(key: string, make: () => V): V {
    const m = this.made.get(key);
    if (m !== undefined && this.isOpen(m.region)) return m.v;
    const v = make();
    this.made.set(key, { v, region: this.current() });
    return v;
  }

  constant(value: number | boolean, lane: Lane): V {
    const key = `c ${lane} ${Object.is(value, -0) ? '-0' : String(value)}`;
    return this.once(key, () => {
      const out = this.newValue(scalarType(lane));
      this.constants.set(out, value);
      const literal = { lane, value } as Literal;
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
