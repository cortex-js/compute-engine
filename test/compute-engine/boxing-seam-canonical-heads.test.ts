import { ComputeEngine } from '../../src/compute-engine';

/**
 * The boxing validation seam for canonical-handler heads: a head with a
 * `canonical` handler used to get no validation against its declared
 * signature (the handler was the sole gate, and most only check arity). The
 * handler's same-head result is now validated against the declaration as a
 * GATE — a provably off-carrier operand becomes the error operand a plain
 * head would mint, including a symbol whose held value lies outside a
 * ranged parameter — while the inference the plain path would make on a
 * fresh symbol is rolled back, so a fresh `x` in `Sin(x)` keeps its type.
 */

const errorCode = (x: any): string | undefined =>
  x?.operator === 'Error'
    ? String(x.op1?.op1?.string ?? x.op1?.string ?? '')
    : undefined;

describe('boxing validation seam for canonical-handler heads', () => {
  test('a symbol whose held value is outside a ranged carrier is refused', () => {
    const ce = new ComputeEngine();
    ce.assign('s', -3);
    const d = ce.box(['PoissonDistribution', 's']);
    expect(d.isValid).toBe(false);
    expect(d.op1.operator).toBe('Error');
    expect(ce.box(['NormalDistribution', 0, 's']).isValid).toBe(false);
    expect(ce.box(['BinomialDistribution', 's', 0.5]).isValid).toBe(false);
    expect(ce.box(['ExponentialDistribution', 's']).isValid).toBe(false);
    // In range: admitted.
    ce.assign('t', 3);
    expect(ce.box(['PoissonDistribution', 't']).isValid).toBe(true);
  });

  test("a literal keeps the handler's own out-of-range error", () => {
    const ce = new ComputeEngine();
    const d = ce.box(['PoissonDistribution', -3]);
    expect(d.isValid).toBe(false);
    expect(d.op1.toString()).toContain('out-of-range');
  });

  test('a provably off-carrier operand is refused as for a plain head', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['PoissonDistribution', "'a'"]).isValid).toBe(false);
    expect(ce.box(['Sin', "'hello'"]).isValid).toBe(false);
    expect(ce.box(['Factorial', "'x'"]).isValid).toBe(false);
    // Threadable signature validation reads a collection's declared element
    // type, so no second numeric-validation pass is needed.
    ce.declare('L', 'list<string>');
    expect(ce.box(['Sin', 'L']).isValid).toBe(false);
    expect(ce.box(['Sin', ['List', "'a'", "'b'"]]).isValid).toBe(false);
    expect(ce.box(['Sin', ['List', 1, 2]]).isValid).toBe(true);
    ce.declare('U', 'list<any>');
    expect(ce.box(['Sin', 'U']).isValid).toBe(true);
  });

  test('the gate infers nothing: a fresh symbol keeps the type it had', () => {
    // Before the seam a fresh symbol handed to a canonical-handler head was
    // typed by the handler's own numeric check (`number`), never by the
    // declared parameter. The seam keeps that: the declared `complex` of
    // `Sin` and the ranged carrier of `PoissonDistribution` are checked,
    // not inferred.
    const ce = new ComputeEngine();
    ce.box(['Sin', 'x']);
    expect(ce.box('x').type.toString()).toBe('number');
    ce.box(['PoissonDistribution', 'lam']);
    expect(ce.box('lam').type.toString()).toBe('number');
    // Same through the public boxing route, which opens its own window.
    const e = new ComputeEngine();
    e.expr(['Sin', 'y']);
    expect(e.box('y').type.toString()).toBe('number');
    expect(e.expr(['Ln', 'z']).type.toString()).toBe('number');
  });

  test('a non-finite operand of a finite-carrier head is refused at boxing', () => {
    // The trig family's carrier is the finite complex numbers; the error
    // used to surface only at evaluation, because the factory's `canonical`
    // handler skipped boxing validation.
    const ce = new ComputeEngine();
    expect(ce.box(['Sin', 'PositiveInfinity']).isValid).toBe(false);
    expect(ce.box(['Sin', 'ComplexInfinity']).isValid).toBe(false);
    expect(ce.box(['Sin', 'x']).isValid).toBe(true);
    // `~oo` types the wide `number`, which the exponent carrier of `Power`
    // does not refute, so the boxing gate admits it and the evaluate
    // handler stays the seam for that point.
    expect(ce.box(['Power', 'x', 'ComplexInfinity']).isValid).toBe(true);
  });

  test('a declaration widened to what its handler accepts', () => {
    const ce = new ComputeEngine();
    // `Apply` applies a function literal as readily as a named function.
    expect(
      ce.box(['Apply', ['Function', ['Power', 't', 2], 't'], 3]).evaluate().re
    ).toBe(9);
    // The constant-nullary and expression shorthands of `Apply`.
    expect(ce.box(['Apply', 3, 5]).evaluate().re).toBe(3);
    expect(ce.box(['Apply', ['Add', 'x', 1], 2]).evaluate().re).toBe(3);
    // A relation with one operand is the degenerate chain, for the whole
    // family.
    expect(ce.box(['Approx', 3]).evaluate().symbol).toBe('True');
    expect(ce.box(['ApproxEqual', 3]).evaluate().symbol).toBe('True');
    expect(ce.box(['Precedes', 3]).evaluate().symbol).toBe('True');
    expect(ce.box(['Less', 3]).isValid).toBe(true);
    // `DMS` with a complex component stays inert rather than truncated.
    const dms = ce.box(['DMS', 1, 'i']).evaluate();
    expect(dms.operator).toBe('DMS');
    expect(dms.isValid).toBe(true);
    // `At` on a base whose type is no evidence of scalar-ness defers.
    ce.declare('w', 'value');
    expect(ce.parse('w[1]').isValid).toBe(true);
    expect(errorCode(ce.parse('\\sin(3)[1]').op1)).toBeDefined();
  });

  test('the early-out of the seam keeps every verdict', () => {
    // A call whose operands are valueless symbols overlapping their
    // parameters, or number literals inside them, skips the validation
    // machinery; anything the machinery could refuse still reaches it.
    const ce = new ComputeEngine();
    // The first boxing types `lam` as `number` (numeric context); the second
    // boxing admits it by overlap with `real<0<..>`, as the full path does.
    expect(ce.box(['PoissonDistribution', 'lam']).isValid).toBe(true);
    expect(ce.box('lam').type.toString()).toBe('number');
    expect(ce.box(['PoissonDistribution', 'lam']).isValid).toBe(true);
    ce.declare('k', 'integer');
    expect(ce.box(['PoissonDistribution', 'k']).isValid).toBe(true);
    expect(ce.box(['PoissonDistribution', 3]).isValid).toBe(true);
    expect(ce.box(['PoissonDistribution', 0]).isValid).toBe(false);
    ce.declare('u', 'string');
    expect(ce.box(['PoissonDistribution', 'u']).isValid).toBe(false);
    ce.assign('s', -3);
    expect(ce.box(['PoissonDistribution', 's']).isValid).toBe(false);
    expect(ce.box(['PoissonDistribution', 'NaN']).isValid).toBe(false);
    // An operator symbol as an operand is not trivial: it takes the full
    // path, where the devolve repair applies.
    expect(ce.box(['Element', 'n', 'N']).isValid).toBe(true);
  });
});
