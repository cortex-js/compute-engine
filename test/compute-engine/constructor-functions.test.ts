import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';

//
// User-defined constructor functions (nominal-types design §4.5/§4.5b,
// D12–D15): a function definition sharing a declared NOMINAL type's name, in
// the same scope, after the type declaration, is that type's constructor.
// The body computes the PAYLOAD; the engine checks it against the type's
// definition body and tags it. The minted operator is an overload set: the
// user arm(s) plus the automatic raw-injection arm (D12/D14), and the tagged
// value serializes as the raw-injection spelling so round-trips close.
//

/** The canonical record-body example: `type circle = record<…>` +
 * `function circle(x, y, r) { {x -> x, y -> y, r -> r} }`. */
function circleEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('circle', 'record<x: number, y: number, r: number>');
  ce.assign(
    'circle',
    ce.box([
      'Function',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'x' }, 'x'],
        ['KeyValuePair', { str: 'y' }, 'y'],
        ['KeyValuePair', { str: 'r' }, 'r'],
      ],
      'x',
      'y',
      'r',
    ])
  );
  return ce;
}

describe('record-body constructor function (host route)', () => {
  test('constructs a payload-tagged value whose type is the nominal reference', () => {
    const ce = circleEngine();
    const c = ce.box(['circle', 1, 2, 3]).evaluate();
    expect(c.json).toEqual(['circle', { dict: { x: 1, y: 2, r: 3 } }]);
    expect(c.type.toString()).toBe('circle');
  });

  test('route parity: ce.function agrees with ce.box', () => {
    const ce = circleEngine();
    const a = ce
      .function('circle', [ce.number(1), ce.number(2), ce.number(3)])
      .evaluate();
    const b = ce.box(['circle', 1, 2, 3]).evaluate();
    expect(a.isSame(b)).toBe(true);
  });

  test('D12: serialization emits the raw-injection spelling and round-trips', () => {
    const ce = circleEngine();
    const c = ce.box(['circle', 1, 2, 3]).evaluate();
    const rt = ce.box(c.json).evaluate();
    expect(rt.json).toEqual(c.json);
    expect(rt.isEqual(c)).toBe(true);
  });

  test('the raw-injection arm tags a valid payload without running the body', () => {
    const ce = circleEngine();
    const c = ce
      .box([
        'circle',
        [
          'Dictionary',
          ['KeyValuePair', { str: 'x' }, 1],
          ['KeyValuePair', { str: 'y' }, 2],
          ['KeyValuePair', { str: 'r' }, 3],
        ],
      ])
      .evaluate();
    expect(c.json).toEqual(['circle', { dict: { x: 1, y: 2, r: 3 } }]);
    expect(c.type.toString()).toBe('circle');
  });

  test('D14b: a payload with an EXTRA key is rejected (width subtyping must not admit it)', () => {
    const ce = circleEngine();
    const c = ce
      .box([
        'circle',
        [
          'Dictionary',
          ['KeyValuePair', { str: 'x' }, 1],
          ['KeyValuePair', { str: 'y' }, 2],
          ['KeyValuePair', { str: 'r' }, 3],
          ['KeyValuePair', { str: 'z' }, 4],
        ],
      ])
      .evaluate();
    expect(c.operator).toBe('Error');
  });

  test('wrong arity errors through the standard path', () => {
    const ce = circleEngine();
    expect(ce.box(['circle', 1]).evaluate().operator).toBe('Error');
  });

  test('DECLARED symbolic operands construct a symbolic payload', () => {
    // `a` is declared `number`: the payload is well-typed even though it is
    // symbolic, so construction proceeds and the tag wraps the symbolic
    // payload.
    const ce = circleEngine();
    ce.declare('a', 'number');
    const c = ce.box(['circle', 'a', 2, 3]).evaluate();
    expect(c.json).toEqual([
      'circle',
      { dict: { x: { sym: 'a' }, y: 2, r: 3 } },
    ]);
    expect(c.type.toString()).toBe('circle');
  });

  test('UNDECLARED symbolic operands stay inert (membership undecidable)', () => {
    const ce = circleEngine();
    const c = ce.box(['circle', 'q', 2, 3]).evaluate();
    expect(c.operator).toBe('circle');
    expect(c.ops!.length).toBe(3);
    expect(c.type.toString()).toBe('circle');
  });

  test('opacity (D3): the tagged value is not a collection', () => {
    const ce = circleEngine();
    const c = ce.box(['circle', 1, 2, 3]).evaluate();
    expect(ce.function('First', [c]).evaluate().operator).toBe('Error');
  });

  test('the constructor is pure', () => {
    const ce = circleEngine();
    expect(ce.box(['circle', 1, 2, 3]).isPure).toBe(true);
  });
});

describe('D9 equality over constructed values', () => {
  test('a normalizing constructor produces EQUAL values from equal inputs', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      `type frac = record<n: integer, d: integer>
function frac(n: integer, d: integer) { {n -> n / GCD(n, d), d -> d / GCD(n, d)} }
frac(2, 4) == frac(1, 2)`
    );
    expect(r.value!.toString()).toBe('"True"');
  });

  test('same tag, different payloads compare unequal', () => {
    const ce = circleEngine();
    const a = ce.box(['circle', 1, 2, 3]).evaluate();
    const b = ce.box(['circle', 1, 2, 9]).evaluate();
    expect(a.isEqual(b)).toBe(false);
  });
});

describe('D14a — arm overlap is rejected at install', () => {
  test('a same-arity numeric arm over a tuple body overlaps the raw arm', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    expect(() =>
      ce.assign(
        'point',
        ce.box([
          'Function',
          ['Tuple', 'r', 'theta'],
          ['Typed', 'r', { str: 'number' }],
          ['Typed', 'theta', { str: 'number' }],
        ])
      )
    ).toThrow(/overlaps the type's raw-injection constructor/);
    // The auto-minted constructor survives the rejected install.
    expect(ce.box(['point', 1, 2]).evaluate().toString()).toBe('point(1, 2)');
  });

  test('an UNANNOTATED unary arm over a scalar body counts as overlap', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    expect(() =>
      ce.assign('meters', ce.box(['Function', ['Multiply', 'x', 2], 'x']))
    ).toThrow(/overlaps the type's raw-injection constructor/);
  });

  test('a position-disjoint same-arity arm is accepted', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    // (boolean) -> meters is disjoint from the raw (number) -> meters arm.
    ce.assign(
      'meters',
      ce.box([
        'Function',
        ['If', 'b', 1, 0],
        ['Typed', 'b', { str: 'boolean' }],
      ])
    );
    const m = ce.box(['meters', 'True']).evaluate();
    expect(m.json).toEqual(['meters', 1]);
    expect(m.type.toString()).toBe('meters');
    // The raw arm still injects a number directly.
    const raw = ce.box(['meters', 42]).evaluate();
    expect(raw.json).toEqual(['meters', 42]);
  });
});

describe('runtime arm dispatch — refutations produce clean errors', () => {
  test('a width-subtyped payload with an extra key errors instead of running a refuting user arm', () => {
    // Statically the raw arm admits `{x, z}` (record width subtyping); the
    // runtime exact-key check refutes it; the unary user arm's `boolean`
    // parameter DEFINITELY refutes the record — the result is a clean error
    // value, not a silent body run or an inert Apply wrapper.
    const ce = new ComputeEngine();
    ce.declareType('t', 'record<x: number>');
    ce.assign(
      't',
      ce.box([
        'Function',
        ['Dictionary', ['KeyValuePair', { str: 'x' }, 0]],
        ['Typed', 'b', { str: 'boolean' }],
      ])
    );
    const r = ce
      .box([
        't',
        [
          'Dictionary',
          ['KeyValuePair', { str: 'x' }, 1],
          ['KeyValuePair', { str: 'z' }, 2],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('Error');
  });

  test('a payload leaking the body´s own parameter symbol is never tagged', () => {
    // Pre-existing engine defect (spec §4.5b D15): a recursive body returning
    // a record literal from an `if` branch leaks the raw parameter symbol.
    // The constructor refuses to tag such a payload — inert, not garbage.
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      `type nat = record<v: integer>
function nat(x: integer) { if (x < 0) { nat(0) } else { {v -> x} } }
nat(3)`
    );
    // Stays the inert application — NOT a tagged `nat({v -> x})`.
    expect(r.value!.json).toEqual(['nat', 3]);
  });
});

describe('D15 — self-reference in the constructor body', () => {
  test('a recursive constructor passes its own tagged result through un-nested', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      `type pt = tuple<x: number, y: number>
function pt(k: number, flag: boolean) { if (k < 0) { pt(-k, flag) } else { (k, k + 1) } }
pt(-3, True)`
    );
    expect(r.value!.json).toEqual(['pt', 3, 4]);
    expect(r.value!.type.toString()).toBe('pt');
  });
});

describe('Cortex route (statement flow)', () => {
  test('the §4.5 flagship example works end to end with zero diagnostics', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      `type circle = record<x: number, y: number, r: number>
function circle(x, y, r) { {x -> x, y -> y, r -> r} }
circle(1, 2, 3)`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.json).toEqual(['circle', { dict: { x: 1, y: 2, r: 3 } }]);
    expect(r.value!.type.toString()).toBe('circle');
  });

  test('later statements canonicalize against the constructor signature (pre-pass)', () => {
    // The static pre-pass canonicalizes every statement before evaluation:
    // recognition must run at Assign CANONICALIZATION, or `point(1, 0, True)`
    // would be validated against the auto-minted 2-ary signature.
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      `type point = tuple<x: number, y: number>
function point(r: number, theta: number, polar: boolean) { (r * Cos(theta), r * Sin(theta)) }
point(1, 0, True)`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.json).toEqual(['point', 1, 0]);
  });

  test('match destructures a tagged value through the constructor pattern', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      `type pt = tuple<x: number, y: number>
const p = pt(1, 2)
match p { pt(a, b) => a + b }`
    );
    expect(r.value!.toString()).toBe('3');
  });

  test('function BEFORE the type declaration is the D5 collision', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      `function circle(x, y, r) { {x -> x, y -> y, r -> r} }
type circle = record<x: number, y: number, r: number>
circle(1, 2, 3)`
    );
    expect(
      (r.diagnostics ?? []).some((d) =>
        String(d.message).includes('runtime-error')
      )
    ).toBe(true);
  });

  test('an alias type´s same-name function is an ordinary function (no tagging)', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      `type alias pair = tuple<number, number>
function pair(x) { x + 1 }
pair(3)`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('4');
  });

  test('re-running the function statement replaces the constructor (notebook re-run)', () => {
    const ce = new ComputeEngine();
    executeCortex(
      ce,
      `type m = number
function m(b: boolean) { If(b, 1, 0) }`
    );
    const r1 = executeCortex(ce, `m(True)`);
    expect(r1.value!.json).toEqual(['m', 1]);
    // Edited body, same signature shape: the new body wins.
    executeCortex(ce, `function m(b: boolean) { If(b, 10, 0) }`);
    const r2 = executeCortex(ce, `m(True)`);
    expect(r2.value!.json).toEqual(['m', 10]);
  });
});
