/**
 * The verifier of the slice IR, run after the lowering and after each pass.
 *
 * It checks that each value is defined once, that each use is dominated by
 * its definition (earlier in the same region, or in a region that encloses
 * it), that every type is well formed and names only length values that
 * are visible, and that the types agree: an operation by the signature of
 * its row in the operator table, a region instruction by its region row,
 * an `if` and a `loop` by their results and parameters, a call by the
 * function it calls.
 */

import {
  argsOf,
  isSubLane,
  isSubType,
  lengthValues,
  mapLengths,
  outsOf,
  regionsOf,
  sameShape,
  scalarType,
  typeToString,
  type IRFunction,
  type IRType,
  type Instr,
  type Program,
  type Region,
  type V,
} from './ir.js';
import {
  irArity,
  regionRow,
  resultType,
  rowOfOp,
  type OperatorRow,
} from './operators.js';

/** A defect of the slice compiler (a failed verification, a pass that
 *  changed the effectful instructions), not a property of the program. */
export class SliceInternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SliceInternalError';
  }
}

export function verify(p: Program, rows: readonly OperatorRow[]): void {
  const defined = new Set<V>();
  const constants = new Map<V, number>();
  const fail = (what: string): never => {
    throw new SliceInternalError(`IR verifier: ${what}`);
  };
  const type = (v: V): IRType => p.types[v] ?? fail(`v${v} has no type`);
  const constant = (v: V) => constants.get(v);
  const same = (a: IRType['shape'], b: IRType['shape']) =>
    sameShape(a, b, constant);
  const sub = (a: V, t: IRType, where: string) => {
    if (!isSubType(type(a), t, constant))
      fail(
        `${where}: v${a} is ${typeToString(type(a))}, not ${typeToString(t)}`
      );
  };
  const equal = (a: IRType, b: IRType) =>
    isSubType(a, b, constant) && isSubType(b, a, constant);
  const fn = (name: string): IRFunction =>
    p.functions.find((f) => f.name === name) ?? fail(`no function ${name}`);

  const region = (r: Region, visible: Set<V>) => {
    const scope = new Set(visible);
    const define = (v: V) => {
      const t = type(v);
      if (!['real', 'integer', 'boolean', 'complex', 'color'].includes(t.lane))
        fail(`v${v}: lane ${t.lane}`);
      for (const n of t.shape)
        if (typeof n === 'number' ? !(Number.isInteger(n) && n > 0) : false)
          fail(`v${v}: shape ${JSON.stringify(t.shape)}`);
      for (const n of lengthValues(t)) {
        if (!scope.has(n)) fail(`v${v}: the length v${n} is not visible`);
        sub(n, scalarType('integer'), `the length of v${v}`);
      }
      if (defined.has(v)) fail(`v${v} is defined twice`);
      defined.add(v);
      scope.add(v);
    };
    r.params.forEach(define);
    for (const i of r.body) {
      for (const v of argsOf(i))
        if (!scope.has(v)) fail(`${i.k}: v${v} is not defined before its use`);
      instr(i);
      for (const inner of regionsOf(i)) region(inner, scope);
      outsOf(i).forEach(define);
    }
    for (const v of r.yields)
      if (!scope.has(v)) fail(`yield: v${v} is not defined`);
  };

  const instr = (i: Instr) => {
    switch (i.k) {
      case 'const': {
        const t = type(i.out);
        const { lane, value } = i.value;
        const ok =
          t.shape.length === 0 &&
          t.lane === lane &&
          (lane === 'boolean'
            ? typeof value === 'boolean'
            : lane === 'complex'
              ? typeof value === 'object' &&
                typeof value.re === 'number' &&
                typeof value.im === 'number'
              : typeof value === 'bigint'
                ? lane === 'integer'
                : typeof value === 'number' &&
                  // A folded integer operation can give NaN (`Mod(1, 0)`).
                  (lane === 'real' ||
                    !Number.isFinite(value) ||
                    Number.isInteger(value)));
        if (!ok)
          fail(`const v${i.out}: ${String(value)} is not a ${typeToString(t)}`);
        if (typeof value === 'number') constants.set(i.out, value);
        return;
      }
      case 'op': {
        const found =
          rowOfOp(rows, i.op) ?? fail(`no row for the operation ${i.op}`);
        const [operands] = found.signature;
        if (i.args.length !== irArity(found.row))
          fail(`${i.op} has ${i.args.length} operands`);
        i.args.forEach((a, k) => {
          const o = operands.length === 1 ? operands[0] : operands[k];
          const t = type(a);
          const ok =
            o === 'list'
              ? t.shape.length > 0
              : isSubLane(t.lane, o) &&
                (t.shape.length === 0 || found.row.threads);
          if (!ok) fail(`${i.op}: operand ${k} is ${typeToString(t)}`);
        });
        const r =
          resultType(found.signature, i.args.map(type), same) ??
          fail(`${i.op}: lists of two shapes`);
        if (!equal(type(i.out), r))
          fail(`${i.op} v${i.out}: the result is not ${typeToString(r)}`);
        return;
      }
      case 'list': {
        const t = type(i.out);
        const element = { lane: t.lane, shape: t.shape.slice(1) };
        if (t.shape[0] !== i.args.length)
          fail(`list v${i.out}: length ${JSON.stringify(t.shape[0])}`);
        return i.args.forEach((a) => sub(a, element, 'list'));
      }
      case 'if':
        sub(i.cond, scalarType('boolean'), 'if');
        for (const r of [i.then, i.else]) {
          if (r.params.length !== 0 || r.yields.length !== i.outs.length)
            fail(`if: ${r.yields.length} yields for ${i.outs.length} results`);
          r.yields.forEach((y, j) => sub(y, type(i.outs[j]), 'if yield'));
        }
        return;
      case 'loop': {
        sub(i.lo, scalarType('integer'), 'loop');
        sub(i.hi, scalarType('integer'), 'loop');
        const { params, yields } = i.body;
        if (
          params.length !== i.init.length + 1 ||
          yields.length !== i.init.length
        )
          fail('loop: the parameters, initial values and yields disagree');
        if (i.outs.length !== i.init.length)
          fail('loop: one result per carried value');
        sub(params[0], scalarType('integer'), 'loop index');
        i.init.forEach((v, j) => {
          const t = type(params[j + 1]);
          sub(v, t, 'loop init');
          sub(yields[j], t, 'loop yield');
          if (!equal(type(i.outs[j]), t))
            fail('loop: a result of another type than its carried value');
        });
        return;
      }
      case 'region': {
        const row = regionRow(i.op) ?? fail(`no region row ${i.op}`);
        // An `integrate` of the interval mode has a second region, its
        // closed form: no parameter, one real yield.
        const closed = i.op === 'integrate' ? i.regions[1] : undefined;
        if (
          i.args.length !== row.args.length ||
          i.regions.length !== (closed === undefined ? 1 : 2)
        )
          fail(`${i.op}: ${i.args.length} operands`);
        if (
          closed !== undefined &&
          (closed.params.length > 0 ||
            closed.yields.length !== 1 ||
            !isSubLane(type(closed.yields[0]).lane, 'real') ||
            type(closed.yields[0]).shape.length > 0)
        )
          fail(`${i.op}: its closed form`);
        i.args.forEach((a, k) => sub(a, scalarType(row.args[k]), i.op));
        const [r] = i.regions;
        if (r.params.length !== row.params.length)
          fail(`${i.op}: the parameters of its region`);
        r.params.forEach((v, k) => sub(v, scalarType(row.params[k]), i.op));
        const expected =
          row.results(i.args, r.yields.map(type), i.outs, r.yields) ??
          fail(`${i.op}: its yields`);
        if (expected.length !== i.outs.length) fail(`${i.op}: its yields`);
        i.outs.forEach((o, k) => {
          if (!equal(type(o), expected[k]))
            fail(`${i.op} v${o}: not ${typeToString(expected[k])}`);
        });
        return;
      }
      case 'call': {
        const f = fn(i.fn);
        if (i.args.length !== f.body.params.length)
          fail(`call ${i.fn}: ${i.args.length} arguments`);
        // A length parameter is the length of the argument after it.
        const lengths = new Map(
          f.body.params.map((q, k) => [q, f.lengthOf[k] ? i.args[k] : q])
        );
        i.args.forEach((a, k) =>
          sub(
            a,
            mapLengths(type(f.body.params[k]), (v) => lengths.get(v) ?? v),
            `call ${i.fn}`
          )
        );
        // A list result of a run-time length has its length before it,
        // which the type of the list names.
        const [r] = f.results;
        const n = lengthValues(r).length > 0 ? i.outs[0] : undefined;
        if (
          f.results.length !== 1 ||
          i.outs.length !== (n === undefined ? 1 : 2)
        )
          fail(`call ${i.fn}: ${i.outs.length} results`);
        if (n !== undefined) sub(n, scalarType('integer'), `call ${i.fn}`);
        const out = i.outs[i.outs.length - 1];
        if (
          !isSubType(
            mapLengths(r, () => n!),
            type(out),
            constant
          )
        )
          fail(`call ${i.fn}: its result`);
      }
    }
  };

  if (p.functions.filter((f) => f.name === p.entry).length !== 1)
    fail('no entry function');
  for (const f of p.functions) {
    if (f.paramNames.length !== f.body.params.length)
      fail(`${f.name}: parameter names`);
    region(f.body, new Set());
    if (f.body.yields.length !== f.results.length) fail(`${f.name}: results`);
    f.body.yields.forEach((y, k) => sub(y, f.results[k], `${f.name} result`));
  }
}
