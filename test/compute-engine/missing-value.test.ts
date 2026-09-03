import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { parseType } from '../../src/common/type/parse';

/**
 * Missing-Value Typing — Phase P0 (primitives & lattice).
 *
 * Spec: docs/TYPE-SYSTEM.md (revision 6).
 * P0 is value-behavior-neutral: it introduces the `missing` unit type and the
 * `Missing` symbol, plus the subtype union-self-membership fix. No runtime
 * absence semantics yet (those are P1–P3).
 */

const ce = new ComputeEngine();

describe('P0 — `missing` unit type in the lattice (I3)', () => {
  test("ce.type('missing') parses", () => {
    expect(ce.type('missing').toString()).toBe('missing');
  });

  test('the `Missing` symbol has type `missing`', () => {
    expect(ce.Missing.type.toString()).toBe('missing');
  });

  test('`missing` predicates stay honest (Missing.isInteger === false)', () => {
    expect(ce.Missing.isInteger).toBe(false);
    expect(ce.Missing.isNumber).toBe(false);
  });

  test('`missing` is a disjoint unit type (subtype only of any/itself)', () => {
    expect(isSubtype('missing', 'missing')).toBe(true);
    expect(isSubtype('missing', 'any')).toBe(true);
    // Not a subtype of unknown, number, value, or nothing.
    expect(isSubtype('missing', 'unknown')).toBe(false);
    expect(isSubtype('missing', 'number')).toBe(false);
    expect(isSubtype('missing', 'value')).toBe(false);
    expect(isSubtype('missing', 'nothing')).toBe(false);
    // Nothing is a subtype of missing except missing itself.
    expect(isSubtype('integer', 'missing')).toBe(false);
    expect(isSubtype('nothing', 'missing')).toBe(false);
  });

  test('`missing` is disjoint from `number` (satisfies its negation)', () => {
    expect(isSubtype('missing', parseType('!number'))).toBe(true);
  });

  test('`missing` survives widen() (the hole stays visible)', () => {
    // widen keeps the `| missing` arm rather than absorbing it (unlike
    // `nothing`, which is absorbed).
    const t = ce.box(['List', 1, 'Missing', 3]).type;
    expect(t.matches('list<integer | missing>')).toBe(true);
    // The arm is genuinely present: the element type is NOT plain `integer`.
    expect(t.matches('list<integer>')).toBe(false);
  });
});

describe('P0 — subtype union-self-membership fix (prerequisite)', () => {
  test('a unit type is a subtype of a union containing it', () => {
    expect(isSubtype('nothing', parseType('nothing | integer'))).toBe(true);
    expect(isSubtype('missing', parseType('integer | missing'))).toBe(true);
    expect(isSubtype('unknown', parseType('unknown | integer'))).toBe(true);
  });

  test('order is load-bearing: nothing ⊄ unknown but unknown <: unknown', () => {
    expect(isSubtype('nothing', 'unknown')).toBe(false);
    expect(isSubtype('missing', 'unknown')).toBe(false);
    expect(isSubtype('unknown', 'unknown')).toBe(true);
  });
});

/**
 * Phase P1 — `Nothing` erasure, the type-directed absence marker, and the
 * access-operator result types (§3.C, §3.G). BREAKING.
 */

const isMarker = (x: any): boolean =>
  x.isNaN === true || x.symbol === 'Missing';

describe('P1 — `Nothing` erasure (§3.G)', () => {
  test('List / Set / Tuple / Sequence splice a literal `Nothing`', () => {
    expect(ce.box(['List', 1, 'Nothing', 3]).toString()).toBe('[1,3]');
    expect(ce.box(['Set', 1, 'Nothing', 3]).toString()).toBe('Set(1, 3)');
    expect(ce.box(['Tuple', 1, 'Nothing', 3]).toString()).toBe('(1, 3)');
    // A Sequence splices into its host operator list (Add erases too).
    expect(ce.box(['List', 1, ['Sequence', 'Nothing', 2], 3]).toString()).toBe(
      '[1,2,3]'
    );
  });

  test('erasure applies to an operand that EVALUATES to `Nothing` (route parity)', () => {
    // `First([])`... is a marker, not Nothing; use an explicit Nothing-valued
    // computation: `If`-like via a lazy Map body returning Nothing.
    const mapped = ce
      .box(['Map', ['Function', 'Nothing', 'x'], ['List', 1, 2, 3]])
      .evaluate();
    // Every mapped element is `Nothing` → erased from the materialized list.
    expect(mapped.toString()).toBe('[]');
  });

  test('a literal `Missing` is PRESERVED (position kept)', () => {
    const l = ce.box(['List', 1, 'Missing', 3]);
    expect(l.type.matches('list<integer | missing>')).toBe(true);
    expect(l.evaluate().ops?.length).toBe(3);
  });

  test('a dictionary entry whose VALUE is `Nothing` is erased; a `Missing` value is kept', () => {
    const d = ce.box(['Dictionary', ['Tuple', { str: 'a' }, 'Nothing']]);
    // The Nothing value erases the entry.
    expect(d.evaluate().get?.('a')).toBeUndefined();
    const d2 = ce.box(['Dictionary', ['Tuple', { str: 'a' }, 'Missing']]);
    expect(d2.get?.('a')?.symbol).toBe('Missing');
  });

  test('the key–value pair tuple is a NON-ERASING position (pair carve-out)', () => {
    // A dictionary value of `Nothing` (built via KeyValuePair) must not
    // unpair the entry: the pair tuple keeps its arity.
    const kv = ce.box(['KeyValuePair', { str: 'a' }, 'Missing']);
    expect(kv.nops).toBe(2);
  });
});

describe('P1 — out-of-band access markers (§3.C)', () => {
  test('At(list<integer>, oob) : integer | nan = NaN', () => {
    // The marker of a numeric element type is the `nan` singleton, so the arm
    // is ADDITIVE and the element tier survives. It used to absorb to a bare
    // `number` on the reasoning that `NaN` was a member of `number`; the
    // finite-by-default lattice flip repealed that premise (see the
    // 2026-08-28 `markerType` entry in `docs/ERROR-MODEL.md` §7).
    const e = ce.box(['At', ['List', 10, 20, 30], 9]);
    expect(e.type.toString()).toBe('integer | nan');
    expect(e.evaluate().isNaN).toBe(true);
  });

  test('At(list<string>, oob) : string | missing = Missing', () => {
    const e = ce.box(['At', ['List', { str: 'a' }, { str: 'b' }], 9]);
    expect(e.type.matches('string | missing')).toBe(true);
    expect(e.evaluate().symbol).toBe('Missing');
  });

  test('At on a mixed (non-numeric) collection oob = Missing', () => {
    const e = ce.box(['At', ['List', 1, { str: 'a' }], 9]).evaluate();
    expect(e.symbol).toBe('Missing');
  });

  test('At(tuple, in-range literal incl. negative) is the exact slot', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('tpl', ce2.type('tuple<integer, string, boolean>'));
    expect(ce2.box(['At', 'tpl', 1]).type.toString()).toBe('integer');
    expect(ce2.box(['At', 'tpl', -1]).type.toString()).toBe('boolean');
  });

  test('At(tuple, out-of-range literal) : marker(⊔S), NOT bare missing', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('tpl', ce2.type('tuple<integer, string, boolean>'));
    // marker(integer ⊔ string ⊔ boolean) = nan ⊔ missing ⊔ missing: the
    // numeric arm names the `nan` singleton, not the whole `number` tier.
    expect(ce2.box(['At', 'tpl', 5]).type.toString()).toBe('missing | nan');
  });

  test('gather is length-preserving with holes (§3.C, BREAKING)', () => {
    const e = ce
      .box(['At', ['List', { str: 'a' }, { str: 'b' }], ['List', 1, 9, 2]])
      .evaluate();
    expect(e.operator).toBe('List');
    expect(e.nops).toBe(3);
    expect(e.op1.string).toBe('a');
    expect(isMarker(e.op2)).toBe(true);
    expect(e.op3.string).toBe('b');
  });

  test('an empty gather index yields the empty list', () => {
    const e = ce.box(['At', ['List', 1, 2], ['List']]).evaluate();
    expect(e.operator).toBe('List');
    expect(e.nops).toBe(0);
  });

  test('a mask length mismatch is an error (BREAKING)', () => {
    const e = ce.box(['At', ['List', 1, 2, 3], ['List', 'True', 'False']]);
    expect(e.evaluate().operator).toBe('Error');
  });

  test('chained At absorbs an absent intermediate into the final domain', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('m', ce2.type('list<list<number>>'));
    const e = ce2.box(['At', 'm', 9, 0]);
    // Static type is the final numeric domain (absorbed); runtime NaN.
    expect(e.type.toString()).toBe('number');
    ce2.assign('m', ce2.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(ce2.box(['At', 'm', 9, 0]).evaluate().isNaN).toBe(true);
  });

  test('At(Missing, i) : unknown, runtime Missing (absent base absorbs)', () => {
    const e = ce.box(['At', 'Missing', 1]);
    expect(e.type.toString()).toBe('unknown');
    expect(e.evaluate().symbol).toBe('Missing');
  });

  test('At(xs, Missing) absorbs (absent index) into the result domain', () => {
    const e = ce.box(['At', ['List', 1, 2, 3], 'Missing']);
    expect(e.evaluate().isNaN).toBe(true);
  });

  test('First / Last of an empty or out-of-band position is the marker', () => {
    expect(isMarker(ce.box(['First', ['List']]).evaluate())).toBe(true);
    expect(isMarker(ce.box(['Third', ['List', { str: 'a' }]]).evaluate())).toBe(
      true
    );
  });

  test('First(list<integer>) : integer | nan (T | marker(T), additive)', () => {
    expect(ce.box(['First', ['List', 1, 2, 3]]).type.toString()).toBe(
      'integer | nan'
    );
  });
});

// ===========================================================================
// P2 — behavior & lift
// ===========================================================================

describe('P2 — missingBehavior resolution (§3.A)', () => {
  test('an all-numeric declared signature resolves to propagate', () => {
    const e = new ComputeEngine();
    e.declare('Foo', { signature: '(number) -> number', evaluate: ([x]) => x });
    expect(e.lookupDefinition('Foo')!.operator!.resolvedMissingBehavior).toBe(
      'propagate'
    );
  });

  test('a non-numeric declared signature resolves to pass-through', () => {
    const e = new ComputeEngine();
    e.declare('Bar', { signature: '(string) -> string', evaluate: ([x]) => x });
    expect(e.lookupDefinition('Bar')!.operator!.resolvedMissingBehavior).toBe(
      'pass-through'
    );
  });

  test('Add/Negate are declared propagate (value signature)', () => {
    expect(ce.lookupDefinition('Add')!.operator!.resolvedMissingBehavior).toBe(
      'propagate'
    );
    expect(
      ce.lookupDefinition('Negate')!.operator!.resolvedMissingBehavior
    ).toBe('propagate');
  });

  test('numeric-signature operators get propagate via the default', () => {
    for (const op of ['Sin', 'Power', 'Root', 'Multiply'])
      expect(ce.lookupDefinition(op)!.operator!.resolvedMissingBehavior).toBe(
        'propagate'
      );
  });

  test('a declared behavior wins over the default', () => {
    const e = new ComputeEngine();
    e.declare('Baz', {
      signature: '(number) -> number',
      missingBehavior: 'reject',
      evaluate: ([x]) => x,
    });
    expect(e.lookupDefinition('Baz')!.operator!.resolvedMissingBehavior).toBe(
      'reject'
    );
  });
});

describe('P2 — strip & absorption (§3.B, propagate)', () => {
  test('Sin(Missing) : number = NaN', () => {
    const e = ce.box(['Sin', 'Missing']);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().isNaN).toBe(true);
  });

  test('Add(Missing, 1) : number = NaN', () => {
    const e = ce.box(['Add', 'Missing', 1]);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().isNaN).toBe(true);
  });

  test('Negate(Missing) : number = NaN (bare-missing base widens)', () => {
    const e = ce.box(['Negate', 'Missing']);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().isNaN).toBe(true);
  });

  test('Power/Root/Sqrt/Multiply(Missing, …) evaluate to NaN', () => {
    expect(ce.box(['Power', 'Missing', 2]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Root', 'Missing', 3]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Sqrt', 'Missing']).evaluate().isNaN).toBe(true);
    expect(ce.box(['Multiply', 'Missing', 2]).evaluate().isNaN).toBe(true);
  });

  test('Sin(x : number | missing) : number (absorption, no arm)', () => {
    const e = new ComputeEngine();
    e.declare('q', 'number | missing');
    expect(e.box(['Sin', 'q']).type.toString()).toBe('number');
  });

  test('Sin(list<number | missing>) : list<number>', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<number | missing>');
    expect(e.box(['Sin', 'L']).type.toString()).toBe('list<number>');
  });

  test('Sin(list<missing>) : list<number> = [NaN, …]', () => {
    const e = new ComputeEngine();
    e.declare('LM', 'list<missing>');
    expect(e.box(['Sin', 'LM']).type.toString()).toBe('list<number>');
  });

  test('Add(Missing, matrix) — every cell NaN', () => {
    const m = ce.box([
      'Add',
      'Missing',
      ['List', ['List', 1, 2], ['List', 3, 4]],
    ]);
    expect(m.type.toString()).toBe('matrix<2x2>');
    const v = m.evaluate();
    for (const row of v.each())
      for (const cell of row.each()) expect(cell.isNaN).toBe(true);
  });

  test('the stripped operand type reaches a per-operator type handler', () => {
    // A custom `propagate` operator whose `type` handler reads its operand's
    // descriptor: the strip is folded into the descriptor's type.
    const e = new ComputeEngine();
    let seen: string | undefined;
    e.declare('Probe', {
      signature: '(number) -> number',
      missingBehavior: 'propagate',
      type: ([x]) => {
        seen = e.type(x.type).toString();
        return 'number';
      },
      evaluate: ([x]) => x,
    });
    e.declare('q', 'number | missing');
    e.box(['Probe', 'q']).type.toString();
    // The stripped operand type (`number|missing` → `number`) is conveyed.
    expect(seen).toBe('number');
  });

  test('I4 — an unconstrained symbol infers the bare param, never |missing', () => {
    const e = new ComputeEngine();
    e.box(['Sin', 'y']).type;
    expect(e.box('y').type.toString()).toBe('number');
  });

  test('I4 — \\max(x, 2x-1) does not widen x by missing', () => {
    const e = new ComputeEngine();
    const m = e.parse('\\max(x, 2x-1)');
    expect(m.operator).toBe('Max');
    expect(e.box('x').type.toString()).toBe('value');
  });
});

describe('P2 — runtime gate: element level & short path (§3.E)', () => {
  test('Sin([1, Missing, 3]) = [Sin(1), NaN, Sin(3)]', () => {
    const v = ce.box(['Sin', ['List', 1, 'Missing', 3]]).evaluate();
    expect(v.operator).toBe('List');
    expect(v.op1.isSame(ce.box(['Sin', 1]))).toBe(true);
    expect(v.op2.isNaN).toBe(true);
    expect(v.op3.isSame(ce.box(['Sin', 3]))).toBe(true);
  });

  test('Add([1, Missing], [10, 20]) = [11, NaN] (packing demotion)', () => {
    const e = ce.box(['Add', ['List', 1, 'Missing'], ['List', 10, 20]]);
    // The (unevaluated) static type absorbs to a numeric list.
    expect(e.type.toString()).toBe('list<number>');
    const v = e.evaluate();
    expect(v.op1.re).toBe(11);
    expect(v.op2.isNaN).toBe(true);
  });

  test('short-path parity: box / function / _fn all give NaN', () => {
    expect(ce.box(['Add', 'Missing', 1]).evaluate().isNaN).toBe(true);
    expect(ce.function('Add', [ce.Missing, ce.One]).evaluate().isNaN).toBe(
      true
    );
    expect(ce._fn('Add', [ce.Missing, ce.One]).evaluate().isNaN).toBe(true);
  });

  test('parse route: an assigned-Missing symbol propagates', () => {
    const e = new ComputeEngine();
    e.assign('w', e.Missing);
    expect(e.parse('\\sin(w)').evaluate().isNaN).toBe(true);
  });

  test('a NaN operand is NOT hijacked by the gate (native handling)', () => {
    // Rgb treats a NaN alpha as opaque; the gate fires on `Missing` only.
    const r = ce.box(['AsRgb', ['Rgb', 1, 0, 0, NaN]]).evaluate();
    expect(r.operator).toBe('Rgb');
  });
});

describe('P2 — reject is a behavior gate (§3.E)', () => {
  test('reject errors at a Missing operand in strict mode', () => {
    const e = new ComputeEngine();
    e.declare('Rj', {
      signature: '(number) -> number',
      missingBehavior: 'reject',
      evaluate: ([x]) => x,
    });
    expect(e.box(['Rj', 'Missing']).evaluate().isValid).toBe(false);
  });

  test('reject errors at a Missing operand in NON-strict mode too', () => {
    const e = new ComputeEngine();
    e.strict = false;
    e.declare('Rj', {
      signature: '(number) -> number',
      missingBehavior: 'reject',
      evaluate: ([x]) => x,
    });
    expect(e.box(['Rj', 'Missing']).evaluate().isValid).toBe(false);
  });
});

describe('P2 — pass-through does not strip (§3.A)', () => {
  test('Characters(Missing) errors (no strip)', () => {
    const e = ce.box(['Characters', 'Missing']);
    expect(e.isValid).toBe(false);
  });
});

describe('P2 — compile: absence capability & gates (§3.F)', () => {
  // Import lazily to keep the P0/P1 sections dependency-free.
  const {
    compile,
  } = require('../../src/compute-engine/compilation/compile-expression');

  test('Add(x:number|missing, 1) compiles guard-free to native x+1', () => {
    const e = new ComputeEngine();
    e.declare('x', 'number | missing');
    const r = compile(e.box(['Add', 'x', 1]));
    expect(r.code).not.toMatch(/isNaN|\?\?/);
    expect(Number.isNaN(r.run({ x: NaN }))).toBe(true);
    expect(r.run({ x: 5 })).toBe(6);
  });

  test('Sin(list<number|missing>) maps natively (no guard)', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<number | missing>');
    const r = compile(e.box(['Sin', 'L']), { fallback: true });
    expect(r.success).toBe(true);
  });

  test('an object-domain missing on JS (has object axis) compiles', () => {
    const e = new ComputeEngine();
    e.declare('S', 'list<string>');
    const r = compile(e.box(['At', 'S', 9]), { to: 'javascript' });
    expect(r.success).toBe(true);
  });

  test('an object-domain missing on a target w/o object axis is a compile error', () => {
    const e = new ComputeEngine();
    e.declare('S', 'list<string>');
    for (const to of ['glsl', 'interval-js']) {
      const r = compile(e.box(['At', 'S', 9]), { to, fallback: true });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/object-domain absent/);
    }
  });

  test('every executable target exposes the numeric absence capability', () => {
    const jsTarget = (ce as any)._getCompilationTarget('javascript');
    const t = jsTarget.createTarget();
    expect(typeof t.absence.numeric.make).toBe('function');
    expect(t.absence.numeric.make()).toBe('Number.NaN');
    expect(t.absence.numeric.isAbsent('v')).toBe('Number.isNaN(v)');
    expect(t.absence.object.nullLiteral).toBe('undefined');
  });

  test('interval target: numeric isAbsent = isnan(x.lo)', () => {
    const it = (ce as any)._getCompilationTarget('interval-js');
    const t = it.createTarget();
    expect(t.absence.numeric.isAbsent('v')).toBe('Number.isNaN((v).lo)');
    expect(t.absence.object).toBeUndefined();
  });

  test('GPU target: make only, no isAbsent (fail closed)', () => {
    const gl = (ce as any)._getCompilationTarget('glsl');
    const t = gl.createTarget();
    expect(typeof t.absence.numeric.make).toBe('function');
    expect(t.absence.numeric.isAbsent).toBeUndefined();
    expect(t.absence.object).toBeUndefined();
  });
});

// ===========================================================================
// P3 — remaining computed handlers & discharge
// ===========================================================================

describe('P3 — aggregate absent-datum / empty-input gate (§3.C)', () => {
  const AGGREGATES = [
    'Mean',
    'Variance',
    'PopulationVariance',
    'StandardDeviation',
    'PopulationStandardDeviation',
    'Kurtosis',
    'Skewness',
    'Median',
    'InterquartileRange',
    'Max',
    'Min',
    'Supremum',
    'Infimum',
    'Mode',
  ];

  test('all 15 aggregates are declared missingBehavior: handle', () => {
    for (const op of [...AGGREGATES, 'Quartiles'])
      expect(ce.lookupDefinition(op)!.operator!.resolvedMissingBehavior).toBe(
        'handle'
      );
  });

  test('a scalar Missing datum ⇒ NaN (both call shapes)', () => {
    expect(ce.box(['Max', 1, 'Missing', 3]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Max', ['List', 1, 'Missing', 3]]).evaluate().isNaN).toBe(
      true
    );
    expect(ce.box(['Mean', 1, 'Missing', 3]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Mean', ['List', 1, 'Missing', 3]]).evaluate().isNaN).toBe(
      true
    );
  });

  test('a NaN datum ⇒ NaN', () => {
    expect(ce.box(['Max', 1, 'NaN', 3]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Median', ['List', 1, 'NaN']]).evaluate().isNaN).toBe(true);
  });

  test('empty input ⇒ NaN for every aggregate', () => {
    for (const op of AGGREGATES)
      expect(ce.box([op, ['List']]).evaluate().isNaN).toBe(true);
  });

  test('Max(1, Missing, 3) : number = NaN', () => {
    const e = ce.box(['Max', 1, 'Missing', 3]);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().isNaN).toBe(true);
  });

  test('Max([]) = NaN (was ∓∞)', () => {
    expect(ce.box(['Max', ['List']]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Min', ['List']]).evaluate().isNaN).toBe(true);
  });

  test('Quartiles([]) = (NaN, NaN, NaN)', () => {
    const q = ce.box(['Quartiles', ['List']]).evaluate();
    expect(q.operator).toBe('Tuple');
    expect(q.nops).toBe(3);
    for (const c of q.ops!) expect(c.isNaN).toBe(true);
  });

  test('Quartiles with a Missing datum = (NaN, NaN, NaN)', () => {
    const q = ce.box(['Quartiles', ['List', 1, 'Missing', 3]]).evaluate();
    expect(q.nops).toBe(3);
    for (const c of q.ops!) expect(c.isNaN).toBe(true);
  });

  test('Mode([]) = NaN', () => {
    expect(ce.box(['Mode', ['List']]).evaluate().isNaN).toBe(true);
  });

  test('every numeric aggregate admits `nan` in its result type', () => {
    // The point of this pin is I6 absorption: an absent datum or empty input
    // makes the answer `NaN`, so no aggregate may claim a result type that
    // excludes it — a bare `real` would be the unsound claim. It used to be
    // spelled as "they all type `number`", which the Contract B flip of the
    // statistics heads (`docs/plans/2026-08-30-error-model-implementation.md`)
    // made too strong: those results are now the narrowest sound claims
    // (`real<0..> | nan` for the variance family,
    // `real | signed_infinity | nan` for the order-based heads), each of which
    // still carries the `nan` arm this pin is really about.
    for (const op of AGGREGATES) {
      const t = ce.box([op, ['List', 1, 2, 3]]).type;
      expect(`${op}: ${t.couldMatch('nan')}`).toBe(`${op}: true`);
    }
  });

  test('an ordinary (absence-free) aggregate is unchanged', () => {
    expect(ce.box(['Max', 2, 3]).evaluate().toString()).toBe('3');
    expect(
      ce
        .box(['Mean', ['List', 1, 2, 3, 4]])
        .evaluate()
        .toString()
    ).toBe('5/2');
    // Exact non-absent data stays exact (no numericization).
    expect(ce.box(['Max', 2, 3]).evaluate().isExact).toBe(true);
  });
});

describe('P3 — IsMissing (§3.D)', () => {
  test('IsMissing(Missing) / IsMissing(NaN) / IsMissing(3)', () => {
    expect(ce.box(['IsMissing', 'Missing']).evaluate().symbol).toBe('True');
    expect(ce.box(['IsMissing', 'NaN']).evaluate().symbol).toBe('True');
    expect(ce.box(['IsMissing', 3]).evaluate().symbol).toBe('False');
  });

  test('IsMissing -> boolean', () => {
    expect(ce.box(['IsMissing', 3]).type.toString()).toBe('boolean');
  });

  test('parse/serialize round-trip via operatorname', () => {
    expect(
      ce.parse('\\operatorname{IsMissing}(\\mathrm{Missing})').evaluate().symbol
    ).toBe('True');
    expect(ce.box(['IsMissing', 3]).toLatex()).toBe('\\mathrm{IsMissing}(3)');
  });
});

describe('P3 — Coalesce (§3.D)', () => {
  test('first non-absent operand (Missing / NaN skipped)', () => {
    expect(ce.box(['Coalesce', 'Missing', 3]).evaluate().toString()).toBe('3');
    expect(ce.box(['Coalesce', 'NaN', 3]).evaluate().toString()).toBe('3');
    expect(ce.box(['Coalesce', 2, 3]).evaluate().toString()).toBe('2');
  });

  test('short-circuit: a later operand is not needed', () => {
    // The second operand is a definite value; a third divergent operand is
    // never consulted.
    expect(
      ce.box(['Coalesce', 'Missing', 7, 'Missing']).evaluate().toString()
    ).toBe('7');
  });

  test('all-absent → the last operand verbatim (still absent)', () => {
    expect(ce.box(['Coalesce', 'Missing', 'Missing']).evaluate().symbol).toBe(
      'Missing'
    );
    expect(ce.box(['Coalesce', 'NaN', 'Missing']).evaluate().symbol).toBe(
      'Missing'
    );
    expect(ce.box(['Coalesce', 'NaN', 'NaN']).evaluate().isNaN).toBe(true);
  });

  test('Coalesce(x) is x', () => {
    expect(ce.box(['Coalesce', 5]).evaluate().toString()).toBe('5');
  });

  test('an UNDECIDED operand leaves the tail unevaluated', () => {
    // `Coalesce` short-circuits, so an operand past an undecided one may never
    // be needed. Evaluating the tail here would run its effects on a path the
    // decided case never takes — and would make the flat form observably
    // different from the nested one, blocking `a ?? b ?? c` flattening.
    const e = new ComputeEngine();
    e.declare('u', 'number');
    const ran: string[] = [];
    e.declare('trace', {
      signature: '(number) -> number',
      evaluate: (ops) => {
        ran.push(ops[0].toString());
        return ops[0];
      },
    });

    // Flat: neither tail operand runs.
    expect(
      e
        .box(['Coalesce', 'u', ['trace', 1], ['trace', 2]])
        .evaluate()
        .toString()
    ).toBe('Coalesce(u, trace(1), trace(2))');
    expect(ran).toEqual([]);

    // Nested (the shape `a ?? b ?? c` parses to): same, and the same effects.
    ran.length = 0;
    expect(
      e
        .box(['Coalesce', 'u', ['Coalesce', ['trace', 1], ['trace', 2]]])
        .evaluate()
        .toString()
    ).toBe('Coalesce(u, Coalesce(trace(1), trace(2)))');
    expect(ran).toEqual([]);

    // A DECIDED first operand still short-circuits the whole tail.
    ran.length = 0;
    expect(
      e
        .box(['Coalesce', 7, ['trace', 1], ['trace', 2]])
        .evaluate()
        .toString()
    ).toBe('7');
    expect(ran).toEqual([]);
  });

  test('result type T₁° | … | Tₙ₋₁° | Tₙ (stripped arms except last)', () => {
    const e = new ComputeEngine();
    e.declare('q', 'number | missing');
    e.declare('d', 'number');
    expect(e.box(['Coalesce', 'q', 'd']).type.toString()).toBe('number');
    // A non-numeric object arm stays visible only in the last operand.
    e.declare('s', 'string | missing');
    e.declare('t', 'string | missing');
    expect(e.box(['Coalesce', 's', 't']).type.matches('string | missing')).toBe(
      true
    );
  });

  test('box AND parse routes both work (lazy + canonical trap)', () => {
    expect(
      ce
        .box(['Coalesce', ['At', ['List', 10, 20], 9], 0])
        .evaluate()
        .toString()
    ).toBe('0');
    expect(
      ce
        .parse('\\operatorname{Coalesce}(\\mathrm{Missing}, 3)')
        .evaluate()
        .toString()
    ).toBe('3');
  });

  test('Coalesce over an out-of-band access discharges the hole', () => {
    // numeric hole (NaN) discharged to 0
    expect(
      ce
        .box(['Coalesce', ['At', ['List', 10, 20], 9], 0])
        .evaluate()
        .toString()
    ).toBe('0');
    // object hole (Missing) discharged to "d"
    expect(
      ce
        .box(['Coalesce', ['At', ['List', { str: 'a' }], 9], { str: 'd' }])
        .evaluate().string
    ).toBe('d');
  });
});

describe('P3 — relational absence: IEEE over NaN, Kleene over Missing (§3.D, amended 2026-07-24)', () => {
  test('Equal: a Missing operand is Kleene (Missing), a NaN operand is IEEE (False)', () => {
    // Kleene: the `Missing` symbol.
    expect(ce.box(['Equal', 2, 'Missing']).evaluate().symbol).toBe('Missing');
    expect(ce.box(['Equal', 'Missing', 'Missing']).evaluate().symbol).toBe(
      'Missing'
    );
    // IEEE: NaN (even NaN == NaN is False).
    expect(ce.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', 'NaN', 2]).evaluate().symbol).toBe('False');
  });

  test('NotEqual: Missing is Kleene (Missing), NaN is IEEE (True)', () => {
    expect(ce.box(['NotEqual', 'Missing', 1]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(ce.box(['NotEqual', 'NaN', 'NaN']).evaluate().symbol).toBe('True');
    expect(ce.box(['NotEqual', 'NaN', 2]).evaluate().symbol).toBe('True');
    expect(ce.box(['NotEqual', 2, 3]).evaluate().symbol).toBe('True');
  });

  test('ordering comparisons: Missing is Kleene (Missing), NaN is IEEE (False, unordered)', () => {
    // Less / LessEqual directly.
    expect(ce.box(['Less', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['LessEqual', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['Less', 'Missing', 1]).evaluate().symbol).toBe('Missing');
    // Greater / GreaterEqual canonicalize to Less / LessEqual — same outcome.
    expect(ce.box(['Greater', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['GreaterEqual', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['Greater', 'Missing', 1]).evaluate().symbol).toBe('Missing');
    expect(ce.box(['GreaterEqual', 'Missing', 1]).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('ordinary comparisons are unchanged', () => {
    expect(ce.box(['Equal', 2, 2]).evaluate().symbol).toBe('True');
    expect(ce.box(['Equal', 2, 3]).evaluate().symbol).toBe('False');
    expect(ce.box(['Less', 1, 2]).evaluate().symbol).toBe('True');
    expect(ce.box(['NotEqual', 2, 3]).evaluate().symbol).toBe('True');
  });

  test('result type: missing / boolean | missing / boolean (unchanged, family-wide)', () => {
    const e = new ComputeEngine();
    e.declare('q', 'number | missing');
    // Definite Missing operand → missing.
    expect(e.box(['Equal', 'x', 'Missing']).type.toString()).toBe('missing');
    expect(e.box(['Less', 'x', 'Missing']).type.toString()).toBe('missing');
    expect(e.box(['NotEqual', 'x', 'Missing']).type.toString()).toBe('missing');
    // A `missing`-arm operand → boolean | missing.
    expect(e.box(['Equal', 'q', 2]).type.matches('boolean | missing')).toBe(
      true
    );
    expect(e.box(['Less', 'q', 2]).type.matches('boolean | missing')).toBe(
      true
    );
    // Otherwise the comparison's own answer: a closed comparison over
    // literals is decided by its type (boolean value types), and an
    // undecided one keeps `boolean`.
    expect(e.box(['Equal', 2, 3]).type.toString()).toBe('false');
    expect(e.box(['Less', 2, 3]).type.toString()).toBe('true');
    expect(e.box(['Less', 'x', 3]).type.toString()).toBe('boolean');
  });

  test('broadcast is per-cell (Kleene Missing / IEEE NaN)', () => {
    const v = ce.box(['Equal', ['List', 1, 'Missing', 3], 1]).evaluate();
    expect(v.operator).toBe('List');
    expect(v.op1.symbol).toBe('True');
    expect(v.op2.symbol).toBe('Missing');
    expect(v.op3.symbol).toBe('False');
    // A NaN cell is IEEE (False), not Missing.
    const w = ce.box(['Equal', ['List', 1, 'NaN', 3], 1]).evaluate();
    expect(w.op1.symbol).toBe('True');
    expect(w.op2.symbol).toBe('False');
    expect(w.op3.symbol).toBe('False');
  });
});

describe('P3 — compile discharge (§3.F)', () => {
  const {
    compile,
  } = require('../../src/compute-engine/compilation/compile-expression');

  test('IsMissing lowers via numeric isAbsent; interpreter/compiled agree', () => {
    const e = new ComputeEngine();
    e.declare('x', 'number | missing');
    const r = compile(e.box(['IsMissing', 'x']));
    expect(r.code).toMatch(/isNaN/);
    expect(r.run({ x: NaN })).toBe(true);
    expect(r.run({ x: 5 })).toBe(false);
    // interpreter parity
    expect(e.box(['IsMissing', 'NaN']).evaluate().symbol).toBe('True');
  });

  test('Coalesce(At(list<number>,9), 0) = 0 (interpreter AND compiled)', () => {
    const expr = ce.box(['Coalesce', ['At', ['List', 10, 20], 9], 0]);
    expect(expr.evaluate().toString()).toBe('0');
    const r = compile(expr);
    expect(r.run()).toBe(0);
  });

  test('Coalesce(At(list<string>,9), "d") = "d" (interpreter AND compiled)', () => {
    const expr = ce.box([
      'Coalesce',
      ['At', ['List', { str: 'a' }], 9],
      { str: 'd' },
    ]);
    expect(expr.evaluate().string).toBe('d');
    const r = compile(expr, { to: 'javascript' });
    expect(r.run()).toBe('d');
  });

  test('numeric Equal is IEEE: NO isNaN guard, false for NaN inputs (interpreter parity)', () => {
    // Amended 2026-07-24: NaN follows IEEE, so plain `==` IS the semantics and
    // interpreter/compiled agree by construction — no guard is emitted, and
    // `NaN == NaN` compiles to `false` (matching the interpreter).
    const e = new ComputeEngine();
    e.declare('a', 'number | missing');
    e.declare('b', 'number | missing');
    const r = compile(e.box(['Equal', 'a', 'b']));
    expect(r.code).not.toMatch(/isNaN|\?\?/);
    expect(r.run({ a: NaN, b: NaN })).toBe(false); // IEEE, matches interpreter
    expect(r.run({ a: 2, b: 2 })).toBe(true);
    expect(r.run({ a: 2, b: 3 })).toBe(false);
    // Interpreter parity for a literal NaN comparison.
    expect(e.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
  });

  test('a numeric-domain missing arm does not widen a comparison result, and compiles on GPU', () => {
    // GPU cleanup (2026-07-24, follow-up to the IEEE amendment): a
    // `number | missing` slot's absence representation is `NaN` (I6), and an
    // IEEE comparison of `NaN` is a plain boolean — so the `missing` arm never
    // reaches the comparison result. Static type has no arm, the interpreter
    // reads a numeric-slot `Missing` as `NaN` (IEEE False/True), and the
    // comparison compiles guard-free on a float-only target.
    const e = new ComputeEngine();
    e.declare('a', 'number | missing');
    e.declare('b', 'number | missing');
    e.declare('s', 'string | missing');

    // Type: no missing arm from numeric-domain operands…
    expect(e.box(['Equal', 'a', 'b']).type.toString()).toBe('boolean');
    expect(e.box(['Less', 'a', 1]).type.toString()).toBe('boolean');
    // …but an object-domain arm still widens (Kleene reachable).
    expect(e.box(['Equal', 's', { str: 'x' }]).type.toString()).toBe(
      'boolean | missing'
    );

    // Interpreter: a Missing VALUE in a numeric-domain slot reads as NaN.
    e.assign('a', e.Missing);
    expect(e.box(['Equal', 'a', 1]).evaluate().symbol).toBe('False');
    expect(e.box(['NotEqual', 'a', 1]).evaluate().symbol).toBe('True');
    expect(e.box(['Less', 'a', 1]).evaluate().symbol).toBe('False');
    // An object-domain slot stays Kleene.
    e.assign('s', e.Missing);
    expect(e.box(['Equal', 's', { str: 'x' }]).evaluate().symbol).toBe(
      'Missing'
    );

    // GPU: compiles guard-free (previously failed closed on the result's arm).
    const r = compile(e.box(['Equal', 'a', 'b']), {
      to: 'glsl',
      fallback: true,
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toMatch(/isnan/);
  });

  test('an object-domain (string|missing) Equal keeps the Kleene guard on JS', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string | missing');
    e.declare('t', 'string | missing');
    const r = compile(e.box(['Equal', 's', 't']), { to: 'javascript' });
    // The object hole (Missing) lowers to the target null; the guard stays.
    expect(r.code).toMatch(/undefined/);
    // The PRESENT side must be strict string equality, not the numeric
    // tolerance kernel: `Math.abs("x" - "y")` is NaN, so the tolerance form
    // answered `false` for every pair of present strings — the guard pinned
    // above only ever protected the absent side. (This is what the string
    // fail-closed gate rejects; the wholly-string guarded form is the one
    // faithful inner, so it is emitted directly.)
    expect(r.code).toMatch(/===/);
    expect(r.code).not.toMatch(/Math\.abs/);
    const run = r.run as unknown as (vars: {
      s: string | undefined;
      t: string | undefined;
    }) => boolean | undefined;
    expect(run({ s: 'x', t: 'x' })).toBe(true);
    expect(run({ s: 'x', t: 'y' })).toBe(false);
    expect(run({ s: undefined, t: 'x' })).toBeUndefined();
  });

  test('a Missing-free Equal is NOT pessimized (no guard)', () => {
    const e = new ComputeEngine();
    e.declare('p', 'number');
    e.declare('q', 'number');
    const r = compile(e.box(['Equal', 'p', 'q']));
    expect(r.code).not.toMatch(/isNaN/);
  });

  test('compiled Max([]) / Min([]) = NaN (interpreter parity)', () => {
    expect(Number.isNaN(compile(ce.box(['Max', ['List']])).run())).toBe(true);
    expect(Number.isNaN(compile(ce.box(['Min', ['List']])).run())).toBe(true);
    // Non-empty folds are unpoisoned.
    expect(compile(ce.box(['Max', ['List', 3, 4, 5]])).run()).toBe(5);
    expect(compile(ce.box(['Min', ['List', 3, 4, 5]])).run()).toBe(3);
    // Interpreter parity.
    expect(ce.box(['Max', ['List']]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Min', ['List']]).evaluate().isNaN).toBe(true);
  });

  test('IsMissing on a GPU target (no isAbsent) is a compile error', () => {
    const e = new ComputeEngine();
    e.declare('x', 'number | missing');
    const r = compile(e.box(['IsMissing', 'x']), {
      to: 'glsl',
      fallback: true,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/isAbsent|absence|Fail closed/i);
  });
});

describe('P3 — absent If/Which condition is a catchable error expression (resolved 2026-07-24)', () => {
  test('a scalar Missing condition yields an error EXPRESSION, not a throw', () => {
    // R's `if (NA)` stance, but catchable: absence is a runtime data state of
    // a correct program, so it must not crash the host's .evaluate().
    const r = ce.box(['If', 'Missing', 1, 2]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/absent/);
  });

  test('reachable from ordinary data: an object-domain Kleene comparison as condition', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string | missing');
    e.assign('s', e.Missing);
    const r = e.box(['If', ['Equal', 's', { str: 'a' }], 1, 2]).evaluate();
    expect(r.operator).toBe('Error');
  });

  test('an absent Which guard errors — it cannot fall through (that would decide the undecidable)', () => {
    const r = ce.box(['Which', 'Missing', 1, 'True', 2]).evaluate();
    expect(r.operator).toBe('Error');
  });

  test('discharge restores branching', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string | missing');
    e.assign('s', e.Missing);
    const cond = ['Equal', 's', { str: 'a' }];
    const r = e.box(['If', ['Coalesce', cond, 'False'], 1, 2]).evaluate();
    expect(r.re).toBe(2);
  });

  test('a not-a-boolean-at-all condition is an error operand, and does not crash the host', () => {
    // Absence is not the only condition the engine refuses to branch on: a
    // condition whose TYPE proves it can never be a boolean — the number 3
    // — is an `incompatible-type` error operand at boxing (ruling
    // 2026-09-02), propagated as the condition's error at evaluation. This
    // used to raise a host exception carrying a spell-check hint, then (ruling
    // 2026-08-31) stayed inert. `Missing` is a decided data state that can
    // never resolve, so it is an error EXPRESSION at evaluation; a symbol of
    // unknown type may still become a boolean, so it alone keeps inertness.
    const boxed = ce.box(['If', 3, 1, 2]);
    expect(boxed.errors).toHaveLength(1);
    const r = boxed.evaluate();
    expect(r.operator).toBe('Error');
    expect(ce.box(['If', 'stillUnknown', 1, 2]).evaluate().operator).toBe('If');
  });

  test('an undecided symbolic condition still holds the If (unchanged)', () => {
    const e = new ComputeEngine();
    e.declare('x', 'number');
    const r = e.box(['If', ['Equal', 'x', 4], 1, 2]).evaluate();
    expect(r.operator).toBe('If');
  });
});
