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
    // Not a subtype of number, value, expression or nothing. It IS a subtype
    // of `unknown`, a type still to be inferred that restricts nothing (user
    // decision D1, 2026-10-21).
    expect(isSubtype('missing', 'unknown')).toBe(true);
    expect(isSubtype('missing', 'expression')).toBe(false);
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

  test('order is load-bearing: nothing ⊄ expression, but every type <: unknown', () => {
    expect(isSubtype('nothing', 'expression')).toBe(false);
    expect(isSubtype('missing', 'expression')).toBe(false);
    // `unknown` restricts nothing (user decision D1, 2026-10-21).
    expect(isSubtype('nothing', 'unknown')).toBe(true);
    expect(isSubtype('missing', 'unknown')).toBe(true);
    expect(isSubtype('unknown', 'unknown')).toBe(true);
    expect(isSubtype('unknown', 'nothing')).toBe(false);
  });
});

/**
 * Phase P1 — `Nothing` erasure, the type-directed absence marker, and the
 * access-operator result types (§3.C, §3.G). BREAKING.
 */

const isMarker = (x: any): boolean =>
  x.isNaN === true || x.symbol === 'Missing';

describe('P1 — `Nothing` is kept as an element (§3.G)', () => {
  test('List / Set / Sequence / Tuple keep Nothing', () => {
    expect(ce.box(['List', 1, 'Nothing', 3]).toString()).toBe('[1,"Nothing",3]');
    expect(ce.box(['Set', 1, 'Nothing', 3]).toString()).toBe(
      'Set(1, 3, "Nothing")'
    );
    expect(ce.box(['Tuple', 1, 'Nothing', 3]).toString()).toBe('(1, "Nothing", 3)');
    // A Sequence splices into its host operator list.
    expect(ce.box(['List', 1, ['Sequence', 'Nothing', 2], 3]).toString()).toBe(
      '[1,"Nothing",2,3]'
    );
  });

  test('an operand that EVALUATES to `Nothing` is kept too (route parity)', () => {
    // `First([])`... is a marker, not Nothing; use an explicit Nothing-valued
    // computation: an element of a list literal that evaluates to `Nothing`.
    const engine = new ComputeEngine();
    const literal = engine.box([
      'List',
      1,
      ['If', ['Greater', 'x', 2], 2, 'Nothing'],
      3,
    ]);
    engine.assign('x', 1);
    expect(literal.evaluate().toString()).toBe('[1,"Nothing",3]');

    // A lazy `Map` whose callback answers `Nothing` is not a literal: it has
    // 3 elements (`Length`, `.at()`, `.each()`), and its printed value keeps
    // them. Before, it printed `[]`. Turning the view into a list keeps
    // them, as a list literal does.
    const mapped = ce
      .box(['Map', ['Function', 'Nothing', 'x'], ['List', 1, 2, 3]])
      .evaluate();
    expect(mapped.toString()).toBe('["Nothing","Nothing","Nothing"]');
    expect(mapped.evaluate({ materialization: true }).toString()).toBe(
      '["Nothing","Nothing","Nothing"]'
    );
  });

  test('a literal `Missing` is PRESERVED (position kept)', () => {
    const l = ce.box(['List', 1, 'Missing', 3]);
    expect(l.type.matches('list<integer | missing>')).toBe(true);
    expect(l.evaluate().ops?.length).toBe(3);
  });

  test('a dictionary entry whose VALUE is `Nothing` or `Missing` is kept', () => {
    const d = ce.box(['Dictionary', ['Tuple', { str: 'a' }, 'Nothing']]);
    expect(d.evaluate().get?.('a')?.symbol).toBe('Nothing');
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
  test('At(list<integer^3>, oob) : nan = NaN', () => {
    // The marker of a numeric element type is the `nan` singleton, so the arm
    // is ADDITIVE and the element tier survives. It used to absorb to a bare
    // `number` on the reasoning that `NaN` was a member of `number`; the
    // finite-by-default lattice flip repealed that premise (see the
    // 2026-08-28 `markerType` entry in `docs/ERROR-MODEL.md` §7). The
    // literal is proved NOT to hold position 9, so the type is the marker
    // alone.
    const e = ce.box(['At', ['List', 10, 20, 30], 9]);
    expect(e.type.toString()).toBe('nan');
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

  test('First(list<integer>) : integer (the marker is implicit)', () => {
    // The length of a filter's result is not known before evaluation, so
    // its first element may be absent. The result type does not name the
    // marker: it describes the values of a read that finds an element.
    const kept = ['Filter', ['List', 1, 2, 3], ['Function', ['Less', 'x', 9], 'x']];
    expect(ce.box(['First', kept]).type.toString()).toBe('integer');
  });

  test('First of a list proved to hold an element : integer', () => {
    // User decision 2026-09-30: no marker when the access cannot find
    // nothing. A list literal carries its length in its type.
    expect(ce.box(['First', ['List', 1, 2, 3]]).type.toString()).toBe(
      'integer'
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
  test('Sin(Missing) : missing = Missing', () => {
    const e = ce.box(['Sin', 'Missing']);
    expect(e.type.toString()).toBe('missing');
    expect(e.evaluate().symbol).toBe('Missing');
  });

  test('Add(Missing, 1) : missing = Missing', () => {
    const e = ce.box(['Add', 'Missing', 1]);
    expect(e.type.toString()).toBe('missing');
    expect(e.evaluate().symbol).toBe('Missing');
  });

  test('Negate(Missing) : missing = Missing', () => {
    const e = ce.box(['Negate', 'Missing']);
    expect(e.type.toString()).toBe('missing');
    expect(e.evaluate().symbol).toBe('Missing');
  });

  test('Power/Root/Sqrt/Multiply(Missing, …) evaluate to Missing', () => {
    expect(ce.box(['Power', 'Missing', 2]).evaluate().symbol).toBe('Missing');
    expect(ce.box(['Root', 'Missing', 3]).evaluate().symbol).toBe('Missing');
    expect(ce.box(['Sqrt', 'Missing']).evaluate().symbol).toBe('Missing');
    expect(ce.box(['Multiply', 'Missing', 2]).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('a declared type cannot name missing', () => {
    // `Missing` is a result only (`docs/ERROR-MODEL.md`): a declaration
    // that names `missing`, at any depth, throws.
    const e = new ComputeEngine();
    expect(() => e.declare('q', 'number | missing')).toThrow(
      /cannot be declared/
    );
    expect(() => e.declare('L', 'list<number | missing>')).toThrow(
      /cannot be declared/
    );
  });

  test('Add(Missing, matrix) — every cell Missing', () => {
    const m = ce.box([
      'Add',
      'Missing',
      ['List', ['List', 1, 2], ['List', 3, 4]],
    ]);
    expect(m.type.toString()).toBe('matrix<integer | missing^(2x2)>');
    const v = m.evaluate();
    for (const row of v.each())
      for (const cell of row.each()) expect(cell.symbol).toBe('Missing');
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
    // The product `2x` narrows `x` to `number`, as `2\\cdot x` does
    // (ROADMAP CE-32); the type still has no `missing` arm.
    expect(e.box('x').type.toString()).toBe('number');
  });
});

describe('P2 — runtime gate: element level & short path (§3.E)', () => {
  test('Sin([1, Missing, 3]) = [Sin(1), Missing, Sin(3)]', () => {
    const v = ce.box(['Sin', ['List', 1, 'Missing', 3]]).evaluate();
    expect(v.operator).toBe('List');
    expect(v.op1.isSame(ce.box(['Sin', 1]))).toBe(true);
    expect(v.op2.symbol).toBe('Missing');
    expect(v.op3.isSame(ce.box(['Sin', 3]))).toBe(true);
  });

  test('Add([1, Missing], [10, 20]) = [11, Missing] (packing demotion)', () => {
    const e = ce.box(['Add', ['List', 1, 'Missing'], ['List', 10, 20]]);
    // The (unevaluated) static type is a vector of the length of the
    // operands, with a `missing` arm for the absent cell.
    expect(e.type.toString()).toBe('list<integer | missing^2>');
    const v = e.evaluate();
    expect(v.op1.re).toBe(11);
    expect(v.op2.symbol).toBe('Missing');
  });

  test('short-path parity: box / function / _fn all give Missing', () => {
    expect(ce.box(['Add', 'Missing', 1]).evaluate().symbol).toBe('Missing');
    expect(ce.function('Add', [ce.Missing, ce.One]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(ce._fn('Add', [ce.Missing, ce.One]).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('parse route: an assigned-Missing symbol propagates', () => {
    const e = new ComputeEngine();
    e.assign('w', e.Missing);
    expect(e.parse('\\sin(w)').evaluate().symbol).toBe('Missing');
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

  test('an object-domain missing on JS (has object axis) compiles', () => {
    const e = new ComputeEngine();
    e.declare('S', 'list<string>');
    const r = compile(e.box(['At', 'S', 9]), { to: 'javascript' });
    expect(r.success).toBe(true);
  });

  test('a read of a list of strings on a target w/o object axis declines', () => {
    const e = new ComputeEngine();
    e.declare('S', 'list<string>');
    const r = compile(e.box(['At', 'S', 9]), { to: 'glsl', fallback: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Could not compile/);
  });

  test('every executable target exposes the numeric absence capability', () => {
    const jsTarget = (ce as any)._getCompilationTarget('javascript');
    const t = jsTarget.createTarget();
    expect(typeof t.absence.numeric.make).toBe('function');
    expect(t.absence.numeric.make()).toBe('Number.NaN');
    // The numeric test reads `undefined` as absent as well as `NaN`
    // (2026-09-22): a written absence symbol lowers to the object null, and an
    // unsupplied `vars` key reads `undefined` too, so the operand is coalesced
    // to `NaN` before the test.
    expect(t.absence.numeric.isAbsent('v')).toBe(
      'Number.isNaN((v) ?? Number.NaN)'
    );
    expect(t.absence.object.nullLiteral).toBe('undefined');
  });

  test('interval target: numeric isAbsent is the runtime tri-state test', () => {
    const it = (ce as any)._getCompilationTarget('interval-js');
    const t = it.createTarget();
    // A verdict, not a JavaScript boolean: `'true'` for the whole-NaN marker
    // and for the `empty` result a failed restriction yields, `'maybe'` for a
    // value present over part of the cell.
    expect(t.absence.numeric.isAbsent('v')).toBe('_IA.isAbsent(v)');
    expect(t.absence.numeric.coversValueModel).toBe(true);
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

  test('a scalar Missing datum ⇒ Missing (both call shapes)', () => {
    for (const op of ['Max', 'Mean']) {
      expect(ce.box([op, 1, 'Missing', 3]).evaluate().symbol).toBe('Missing');
      expect(
        ce.box([op, ['List', 1, 'Missing', 3]]).evaluate().symbol
      ).toBe('Missing');
    }
  });

  test('a NaN datum ⇒ NaN', () => {
    expect(ce.box(['Max', 1, 'NaN', 3]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Median', ['List', 1, 'NaN']]).evaluate().isNaN).toBe(true);
  });

  test('empty input ⇒ NaN for every aggregate', () => {
    for (const op of AGGREGATES)
      expect(ce.box([op, ['List']]).evaluate().isNaN).toBe(true);
  });

  test('Max(1, Missing, 3) : number = Missing (the marker is implicit)', () => {
    const e = ce.box(['Max', 1, 'Missing', 3]);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().symbol).toBe('Missing');
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

  test('Quartiles with a Missing datum = Missing', () => {
    const q = ce.box(['Quartiles', ['List', 1, 'Missing', 3]]).evaluate();
    expect(q.symbol).toBe('Missing');
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

  test('result type: the type of the present values', () => {
    // A read that may be absent is typed by its present values (the marker
    // is implicit), and so is the `Coalesce` over it.
    const e = new ComputeEngine();
    e.declare('xs', 'list<number>');
    e.declare('ss', 'list<string>');
    e.declare('k', 'integer');
    e.declare('d', 'number');
    expect(e.box(['Coalesce', ['At', 'xs', 'k'], 'd']).type.toString()).toBe(
      'number'
    );
    expect(
      e.box(['Coalesce', ['At', 'ss', 'k'], ['At', 'ss', 'k']]).type.toString()
    ).toBe('string');
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

// A comparison is two-valued (user decision of 2026-11-02, two-valued
// comparisons): a `Missing` operand is read as `NaN`, so the comparison is
// `False` (`NotEqual`: `True`). From 2026-07-24 to 2026-11-02 a `Missing`
// operand made the comparison `Missing` (Kleene).
describe('P3 — relational absence: IEEE over NaN, and Missing is read as NaN', () => {
  test('Equal: a Missing or a NaN operand makes it False', () => {
    expect(ce.box(['Equal', 2, 'Missing']).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', 'Missing', 'Missing']).evaluate().symbol).toBe(
      'False'
    );
    // IEEE: NaN (even NaN == NaN is False).
    expect(ce.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', 'NaN', 2]).evaluate().symbol).toBe('False');
  });

  test('NotEqual: a Missing or a NaN operand makes it True', () => {
    expect(ce.box(['NotEqual', 'Missing', 1]).evaluate().symbol).toBe('True');
    expect(ce.box(['NotEqual', 'NaN', 'NaN']).evaluate().symbol).toBe('True');
    expect(ce.box(['NotEqual', 'NaN', 2]).evaluate().symbol).toBe('True');
    expect(ce.box(['NotEqual', 2, 3]).evaluate().symbol).toBe('True');
  });

  test('ordering comparisons: a Missing or a NaN operand makes it False', () => {
    // Less / LessEqual directly.
    expect(ce.box(['Less', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['LessEqual', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['Less', 'Missing', 1]).evaluate().symbol).toBe('False');
    // Greater / GreaterEqual canonicalize to Less / LessEqual — same outcome.
    expect(ce.box(['Greater', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['GreaterEqual', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['Greater', 'Missing', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['GreaterEqual', 'Missing', 1]).evaluate().symbol).toBe(
      'False'
    );
  });

  test('ordinary comparisons are unchanged', () => {
    expect(ce.box(['Equal', 2, 2]).evaluate().symbol).toBe('True');
    expect(ce.box(['Equal', 2, 3]).evaluate().symbol).toBe('False');
    expect(ce.box(['Less', 1, 2]).evaluate().symbol).toBe('True');
    expect(ce.box(['NotEqual', 2, 3]).evaluate().symbol).toBe('True');
  });

  test('result type: boolean, also with an absent operand (family-wide)', () => {
    const e = new ComputeEngine();
    // A definite Missing operand → boolean.
    expect(e.box(['Equal', 'x', 'Missing']).type.toString()).toBe('boolean');
    expect(e.box(['Less', 'x', 'Missing']).type.toString()).toBe('boolean');
    expect(e.box(['NotEqual', 'x', 'Missing']).type.toString()).toBe('boolean');
    // Otherwise the comparison's own answer: a closed comparison over
    // literals is decided by its type (boolean value types), and an
    // undecided one keeps `boolean`.
    expect(e.box(['Equal', 2, 3]).type.toString()).toBe('false');
    expect(e.box(['Less', 2, 3]).type.toString()).toBe('true');
    expect(e.box(['Less', 'x', 3]).type.toString()).toBe('boolean');
  });

  test('broadcast is per-cell (a Missing or a NaN cell is False)', () => {
    const v = ce.box(['Equal', ['List', 1, 'Missing', 3], 1]).evaluate();
    expect(v.operator).toBe('List');
    expect(v.op1.symbol).toBe('True');
    expect(v.op2.symbol).toBe('False');
    expect(v.op3.symbol).toBe('False');
    // A NaN cell is IEEE (False).
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
    e.declare('xs', 'list<number>');
    e.declare('k', 'integer');
    const r = compile(e.box(['IsMissing', ['At', 'xs', 'k']]));
    expect(r.code).toMatch(/isNaN/);
    expect(r.run({ xs: [1, 2], k: 5 })).toBe(true);
    expect(r.run({ xs: [1, 2], k: 1 })).toBe(false);
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
    e.declare('a', 'number');
    e.declare('b', 'number');
    const r = compile(e.box(['Equal', 'a', 'b']));
    expect(r.code).not.toMatch(/isNaN|\?\?/);
    expect(r.run({ a: NaN, b: NaN })).toBe(false); // IEEE, matches interpreter
    expect(r.run({ a: 2, b: 2 })).toBe(true);
    expect(r.run({ a: 2, b: 3 })).toBe(false);
    // Interpreter parity for a literal NaN comparison.
    expect(e.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
  });

  test('a comparison with an absent numeric operand is False, and compiles on GPU', () => {
    // User decision 2026-11-02 (two-valued comparisons): a comparison with an
    // absent operand is `False` (`NotEqual`: `True`), in a numeric slot
    // (`number | missing`) and in an object slot, and the condition of an
    // `If` reads it the same way. From 2026-10-23 (ROADMAP CE-93) to
    // 2026-11-02 it was `Missing`. On a GPU target an absent number is
    // `NaN`, so the comparison compiles there, guard-free, with the IEEE
    // reading. A declared name accepts the absence marker as a value.
    const e = new ComputeEngine();
    e.declare('a', 'number');
    e.declare('b', 'number');
    e.declare('s', 'string');

    expect(e.box(['Equal', 'a', 'b']).type.toString()).toBe('boolean');
    expect(e.box(['Less', 'a', 1]).type.toString()).toBe('boolean');
    expect(e.box(['Equal', 's', { str: 'x' }]).type.toString()).toBe(
      'boolean'
    );

    e.assign('a', e.Missing);
    expect(e.box(['Equal', 'a', 1]).evaluate().symbol).toBe('False');
    expect(e.box(['NotEqual', 'a', 1]).evaluate().symbol).toBe('True');
    expect(e.box(['Less', 'a', 1]).evaluate().symbol).toBe('False');
    e.assign('s', e.Missing);
    expect(e.box(['Equal', 's', { str: 'x' }]).evaluate().symbol).toBe(
      'False'
    );

    // GPU: compiles guard-free. A fresh engine: a symbol whose held value
    // is `Missing` does not compile as a `number`.
    const gpu = new ComputeEngine();
    gpu.declare('a', 'number');
    gpu.declare('b', 'number');
    for (const expr of [
      ['Equal', 'a', 'b'],
      ['Less', 'a', 1],
      ['If', ['Less', 'a', 1], 1, 0],
    ] as const) {
      const r = compile(gpu.box(expr as any), { to: 'glsl', fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).not.toMatch(/isnan/);
    }
    // An object-domain absent value has no representation there.
    expect(() =>
      compile(e.box(['Equal', 's', { str: 'x' }]), {
        to: 'glsl',
        fallback: false,
      })
    ).toThrow(/Could not compile/);

    // JavaScript: a `NaN` is a value, and the comparison is `false`. The
    // compiled value with an absent operand (`undefined`) is not specified
    // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
    // "Everything computed from an absent value, except at a discharge"; R4
    // of `docs/plans/2026-11-01-absent-value-contract.md`).
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'number');
    const js = compile(ce2.box(['Less', 'a', 1]), {
      to: 'javascript',
      fallback: false,
    });
    expect(js.run!({ a: 0.5 } as never)).toBe(true);
    expect(js.run!({ a: NaN } as never)).toBe(false);
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
    e.declare('xs', 'list<number>');
    e.declare('k', 'integer');
    const r = compile(e.box(['IsMissing', ['At', 'xs', 'k']]), {
      to: 'glsl',
      fallback: true,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/isAbsent|absence|Could not compile/i);
  });
});

// An absent condition of `If`/`Which` is `False` (user decision of
// 2026-11-02, two-valued comparisons), as in Desmos, where `\{u<1:5,7\}` is
// 7 when `u` is undefined. From 2026-07-24 to 2026-11-02 it was a catchable
// error expression (the "absent-condition error").
describe('P3 — an absent If/Which condition is False', () => {
  test('a scalar Missing condition takes the else arm', () => {
    const r = ce.box(['If', 'Missing', 1, 2]).evaluate();
    expect(r.re).toBe(2);
  });

  test('from ordinary data: an object-domain comparison as condition', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string');
    e.assign('s', e.Missing);
    const r = e.box(['If', ['Equal', 's', { str: 'a' }], 1, 2]).evaluate();
    expect(r.re).toBe(2);
  });

  test('an absent Which guard falls through to the next clause', () => {
    const r = ce.box(['Which', 'Missing', 1, 'True', 2]).evaluate();
    expect(r.re).toBe(2);
  });

  test('discharge restores branching', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string');
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
