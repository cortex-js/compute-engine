/**
 * CE-1911: compiled JavaScript and a call that passes a function value to a
 * host function, or a call of a function with a dictionary parameter.
 *
 * Run: npx tsx scripts/repros/2026-11-27-ce1911-compiled-function-arguments.mts
 *
 * Each case runs a program with `executeEpsil`, compiles the value of
 * `frame` to JavaScript, runs it with `t = 3`, and prints whether it
 * compiled, the values that the host function `hostApply` gave from the
 * compiled code and from the interpreter, or the decline reason.
 * `hostApply(a, f)` records `Apply(f, 41)` and the first cell of `a`.
 * The last line is READY when every case marked `compile` compiles and
 * gives the interpreter's values and every case marked `decline` declines
 * (a function value that the compiled code would have to call or read, a
 * lambda that reads a parameter of the compiled function).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { compile } from '../../src/compile';
import { isMutableArray } from '../../src/compute-engine/boxed-expression/type-guards';

const PRELUDE = `
let cells = arrayFrom([0, 0, 0, 0], "integer<0..255>")
type Box = tuple<cells: array<integer<0..255>>>
protocol Ops {
  function touch(self: Self) -> nothing
  function apply(self: Self, f: any) -> nothing
}
type Box is Ops {
  function touch(self: Box) -> nothing { hostApply(self.cells, 0) }
  function apply(self: Box, f: any) -> nothing { hostApply(self.cells, f) }
}
let box = Box(cells)
let inc = (i: integer) => i + 1
let k0 = 5
let addK = (i: integer) => i + k0
let next = (i: integer) => do { let s = 0; for j in 1..3 { s = s + j + k0 }; s + inc(i) }
function withOpts(n: integer, opts: dictionary = {->}) { n + 1 }
function styled(n: integer, opts: dictionary = {->}) -> nothing { hostApply(cells, opts) }
function plain(n: integer) { n + 1 }
let withOptsL = (n: integer, opts: dictionary = {->}) => n + 1
function callsF(f: any) { f(3) }
function addsF(f: any) { f + 1 }
`;

type Expect = 'compile' | 'decline';
const cases: Array<{ label: string; program: string; expect: Expect }> = [
  {
    label: 'box.touch() (control)',
    program: `let frame = (t: integer) => box.touch()`,
    expect: 'compile',
  },
  {
    label: 'box.apply(inc)',
    program: `let frame = (t: integer) => box.apply(inc)`,
    expect: 'compile',
  },
  {
    label: 'box.apply(addK), a captured variable',
    program: `let frame = (t: integer) => box.apply(addK)`,
    expect: 'compile',
  },
  {
    label: 'k0 = t, then hostApply(cells, addK)',
    program: `let frame = (t: integer) => do { k0 = t; hostApply(cells, addK); k0 }`,
    expect: 'compile',
  },
  {
    label: 'box.apply(next), a local, a loop and a call in the function',
    program: `let frame = (t: integer) => do { for k in 1..2 { box.apply(next) }; 0 }`,
    expect: 'compile',
  },
  {
    label: 'box.apply(lambda)',
    program: `let frame = (t: integer) => box.apply((i: integer) => i + 1)`,
    expect: 'compile',
  },
  {
    label: 'box.apply(lambda reading the parameter t)',
    program: `let frame = (t: integer) => box.apply((i: integer) => i + t)`,
    expect: 'decline',
  },
  {
    label: 'hostApply(box.cells, inc)',
    program: `let frame = (t: integer) => hostApply(box.cells, inc)`,
    expect: 'compile',
  },
  {
    label: 'loop with box.touch() (control)',
    program: `let frame = (t: integer) => do { for k in 1..4 { box.cells[k] = k; box.touch() }; 0 }`,
    expect: 'compile',
  },
  {
    label: 'loop with box.apply(inc)',
    program: `let frame = (t: integer) => do { for k in 1..4 { box.cells[k] = k; box.apply(inc) }; 0 }`,
    expect: 'compile',
  },
  {
    label: 'if with box.apply(inc)',
    program: `let frame = (t: integer) => do { if t > 2 { box.apply(inc) }; 0 }`,
    expect: 'compile',
  },
  {
    label: 'callsF(inc), a call of the function value',
    program: `let frame = (t: integer) => callsF(inc)`,
    expect: 'decline',
  },
  {
    label: 'addsF(inc), arithmetic on the function value',
    program: `let frame = (t: integer) => addsF(inc)`,
    expect: 'decline',
  },
  {
    label: 'plain(t) (control)',
    program: `let frame = (t: integer) => plain(t)`,
    expect: 'compile',
  },
  {
    label: 'withOpts(t)',
    program: `let frame = (t: integer) => withOpts(t)`,
    expect: 'compile',
  },
  {
    label: 'withOptsL(t), a function literal bound to a name, its default',
    program: `let frame = (t: integer) => withOptsL(t)`,
    expect: 'compile',
  },
  {
    label: 'withOpts(t, {smooth -> true})',
    program: `let frame = (t: integer) => withOpts(t, {smooth -> true})`,
    expect: 'compile',
  },
  {
    label: 'styled(t), the default passed to the host',
    program: `let frame = (t: integer) => styled(t)`,
    expect: 'compile',
  },
  {
    label: 'styled(t, {smooth -> true}) passed to the host',
    program: `let frame = (t: integer) => styled(t, {smooth -> true})`,
    expect: 'compile',
  },
];

function engine() {
  const ce = new ComputeEngine();
  const calls: string[] = [];
  ce.declare('hostApply', {
    signature: '(any, any) -> nothing',
    pure: false,
    evaluate: (ops: any[]) => {
      const a = ops[0];
      const first = isMutableArray(a) ? (a.cells as ArrayLike<number>)[0] : '?';
      const f = ops[1];
      const v =
        f.isFunctionExpression || f.operator === 'Function' || f.symbol
          ? ce.expr(['Apply', f, 41]).evaluate().json
          : f.json;
      calls.push(`${JSON.stringify(v)}@${first}`);
      return ce.Nothing;
    },
  } as any);
  const diags = executeEpsil(ce, PRELUDE).diagnostics.filter(
    (d) => d.severity === 'error'
  );
  if (diags.length > 0) throw new Error(diags.map((d) => d.message).join('; '));
  return { ce, calls };
}

let ready = true;
for (const c of cases) {
  let out = '';
  let compiled = false;
  try {
    const a = engine();
    executeEpsil(a.ce, c.program);
    const r = compile(a.ce.expr('frame').evaluate(), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    compiled = true;
    const value = r.run(3);
    const b = engine();
    executeEpsil(b.ce, c.program);
    const expected = b.ce.expr(['frame', 3]).evaluate();
    const same =
      // A `Nothing` result is NaN in compiled code (the caveats).
      JSON.stringify(Number.isNaN(value) ? 'Nothing' : value) ===
        JSON.stringify(expected.json) &&
      a.calls.join(' ') === b.calls.join(' ') &&
      JSON.stringify(a.ce.expr('k0').evaluate().json) ===
        JSON.stringify(b.ce.expr('k0').evaluate().json);
    if (!same) ready = false;
    out = `compiles, value ${JSON.stringify(value)} (interpreter ${JSON.stringify(expected.json)}), host ${a.calls.join(' ')} (interpreter ${b.calls.join(' ')})${same ? '' : '  MISMATCH'}`;
  } catch (e) {
    // A throw of the compiled run, after a compilation, is a failure.
    if (compiled) ready = false;
    out = `${compiled ? 'THROWS' : 'DECLINE'} ${(e as Error).message.split('\n')[0]}`;
  }
  if (compiled !== (c.expect === 'compile')) {
    ready = false;
    out += `  (expected: ${c.expect})`;
  }
  console.log(`${c.label}: ${out}`);
}
console.log(ready ? 'READY' : 'NOT READY');
