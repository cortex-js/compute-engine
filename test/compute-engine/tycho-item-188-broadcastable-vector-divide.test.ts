import { ComputeEngine } from '../../src/compute-engine';

// Tycho item 188 (2026-08-15): `Divide`'s parse-time operand check rejected a
// numerator typed `broadcastable<vector<n>>` while accepting the bare
// `vector<n>` it lifts — even though `broadcastable<S>` is precisely the marker
// for "an `S`, or an indexed collection of `S` that broadcasts elementwise".
//
// The lift appears when a vector-valued function is applied to arguments whose
// collection-ness is not statically knowable, which in a document is exactly
// the state of a callee that has been DECLARED but not yet ASSIGNED. So the
// same definition row parsed INVALID above its callees' cells and VALID below
// them: parse validity depended on document position, which no consumer can
// reason about. Tycho's `G` cell was dropped from registration outright and the
// 3D parametric consuming it sampled 0/60 points.
//
// Mechanism: `checkNumericArgs` admits an operand whose type
// `typeCouldBeNumericCollection`, and that predicate's `broadcastable<S>` arm
// only asked whether `S` was numeric-SCALAR-ish — so a collection or tuple base
// fell through to the final `else` and baked `Error(incompatible-type, number,
// …)` at canonicalization. It now recurses into the base, and the companion
// `typeIsProvablyNonNumericCollection` is expressed as its exact negation so
// the admit and reject halves cannot drift apart. The fix is shared by every
// numeric operator, since they all validate through `checkNumericArgs`.

describe('Tycho item 188: broadcastable<vector<n>> in numeric operand position', () => {
  // The document shape from the report: `h`/`H` assigned, `g`/`X`/`Y` declared
  // but not yet assigned, so `H(X(t), Y(t))` types
  // `broadcastable<vector<finite_number^2>>`.
  const setUp = (assignCallees: boolean): ComputeEngine => {
    const ce = new ComputeEngine();
    for (const n of ['h', 'H', 'g', 'X', 'Y', 'G']) ce.declare(n, 'function');
    ce.parse('h(a, b) \\coloneq \\lbrack \\cos(a+b), \\sin(a-b)\\rbrack', {
      strict: false,
    }).evaluate();
    ce.parse('H(a, b) \\coloneq h(2a, 3b)', { strict: false }).evaluate();
    if (assignCallees) assignCallees_(ce);
    return ce;
  };

  const assignCallees_ = (ce: ComputeEngine) => {
    for (const src of [
      'g(t) \\coloneq 1+t^2',
      'X(t) \\coloneq \\lfloor t\\rfloor',
      'Y(t) \\coloneq 2t',
    ])
      ce.parse(src, { strict: false }).evaluate();
  };

  test('the numerator really is broadcastable-wrapped (non-vacuity)', () => {
    const ce = setUp(false);
    expect(
      ce.parse('H(X(t), Y(t))', { strict: false }).type.toString()
    ).toBe('broadcastable<vector<finite_number^2>>');
  });

  test('the Divide row is valid with its callees still unassigned', () => {
    const ce = setUp(false);
    const row = ce.parse('G(t)=\\frac{H(X(t), Y(t))}{g(t)}', {
      strict: false,
    });
    expect(row.isValid).toBe(true);
    // No `Error` node baked into the numerator.
    expect(JSON.stringify(row.json)).not.toContain('incompatible-type');
  });

  test('validity does not depend on document position', () => {
    const before = ce_rowValid(true);
    const after = ce_rowValid(false);
    expect(before).toBe(after);
    expect(before).toBe(true);
  });

  const ce_rowValid = (rowFirst: boolean): boolean => {
    const ce = setUp(!rowFirst);
    const row = ce.parse('G(t)=\\frac{H(X(t), Y(t))}{g(t)}', {
      strict: false,
    });
    return row.isValid;
  };

  test('the value does not depend on document position either', () => {
    const evaluateAt = (rowFirst: boolean): string => {
      const ce = setUp(!rowFirst);
      ce.parse('G(t)\\coloneq\\frac{H(X(t), Y(t))}{g(t)}', {
        strict: false,
      }).evaluate();
      if (rowFirst) assignCallees_(ce);
      return ce.parse('G(0.7)', { strict: false }).N().toString();
    };
    // H(X(0.7), Y(0.7)) = h(0, 4.2) = [cos 4.2, sin(-4.2)]; g(0.7) = 1.49.
    const expected = ce_expected();
    expect(evaluateAt(true)).toBe(expected);
    expect(evaluateAt(false)).toBe(expected);
  });

  const ce_expected = (): string => {
    const ce = new ComputeEngine();
    return ce
      .parse(
        '\\frac{\\lbrack\\cos(4.2), \\sin(-4.2)\\rbrack}{1.49}',
        { strict: false }
      )
      .N()
      .toString();
  };

  // `Divide` keeps the numerator's shape like its sibling operators — but it
  // does NOT echo the component types: each is widened through the same tier
  // rules as the scalar path (`quotientComponentType`), since division moves
  // the tier where `Subtract`/`Negate` cannot. The per-denominator element
  // tiers below mirror the scalar path exactly:
  //  - an unknown-typed APPLICATION (`g(t)` before `g` assigns) reports
  //    `isFinite === false`, and a possibly-NaN denominator makes each
  //    component possibly NaN, so the element widens to `number` (a bare
  //    `x / g(t)` types `number` for the same reason) — `vector<2>` is the
  //    printed form of a `number`-element 2-vector;
  //  - a `number`-DECLARED symbol keeps `finite_number`, as `x / s` does.
  test('the quotient keeps the numerator shape, like its sibling operators', () => {
    const ce = setUp(false);
    ce.declare('s', 'number');
    const typeOf = (latex: string) =>
      ce.parse(latex, { strict: false }).type.toString();
    // Exactly this tier: `g` returns `unknown` (admits NaN and ±∞), so
    // `number` components are the contract, and the result is only POSSIBLY
    // a vector (`g(t)` may be a collection), never a definite `vector<2>`.
    expect(typeOf('\\frac{H(X(t), Y(t))}{g(t)}')).toBe(
      'broadcastable<vector<2>>'
    );
    expect(typeOf('\\frac{H(X(t), Y(t))}{s}')).toBe(
      'broadcastable<vector<finite_number^2>>'
    );
    // Scalar-path parity for the same denominators (the mirror the widening
    // is defined by). Distinct symbols: `s/s` would fold to 1 at
    // canonicalization (the generic-symbol `x/x → 1` convention).
    ce.declare('w', 'number');
    // (`s/g(t)` carries its own broadcast wrap — `g(t)` could itself be a
    // collection dividing `s` elementwise — so the parity reads at the
    // ELEMENT: `number`, matching the vector's components above.)
    expect(typeOf('\\frac{s}{g(t)}')).toBe('broadcastable<number>');
    expect(typeOf('\\frac{s}{w}')).toBe('finite_number');
    // No denominator, no tier movement: the sibling operators echo the shape.
    for (const latex of ['H(X(t), Y(t)) - g(t)', '-H(X(t), Y(t))'])
      expect([latex, typeOf(latex)]).toEqual([
        latex,
        'broadcastable<vector<finite_number^2>>',
      ]);
  });

  // The first landing of this fix echoed the numerator's type verbatim and
  // was withdrawn under review for over-claiming the element tier; these pins
  // hold the widened tiers so that echo cannot return.
  test('dividing a lifted integer vector claims rational, not integer, components', () => {
    const ce = new ComputeEngine();
    ce.declare('bvec', 'broadcastable<vector<finite_integer^2>>');
    ce.declare('bscal', 'broadcastable<number>');
    ce.declare('intfn', '(number) -> finite_integer');
    ce.declare('tt', 'number');
    // Truth: [6,2]/4 = [3/2,1/2] — the components are rational, not integer.
    expect(ce.parse('\\frac{\\lbrack6,2\\rbrack}{4}').evaluate().toString()).toBe(
      '[3/2,1/2]'
    );
    expect(ce.box(['Divide', 'bvec', ['intfn', 'tt']]).type.toString()).toBe(
      'broadcastable<vector<finite_rational^2>>'
    );
    // A broadcast-lifted SCALAR denominator (could be a scalar, or an indexed
    // collection dividing elementwise) preserves the shape either way.
    expect(ce.box(['Divide', 'bvec', 'bscal']).type.toString()).toBe(
      'broadcastable<vector<finite_number^2>>'
    );
  });

  test('a tuple numerator widens its component tiers the same way', () => {
    const ce = new ComputeEngine();
    ce.declare('tup', 'tuple<finite_integer, finite_integer>');
    ce.declare('intfn', '(number) -> finite_integer');
    ce.declare('realfn', '(number) -> finite_real');
    ce.declare('tt', 'number');
    expect(ce.box(['Divide', 'tup', ['intfn', 'tt']]).type.toString()).toBe(
      'tuple<finite_rational, finite_rational>'
    );
    expect(ce.box(['Divide', 'tup', ['realfn', 'tt']]).type.toString()).toBe(
      'tuple<finite_real, finite_real>'
    );
    expect(ce.box(['Divide', 'tup', 'tt']).type.toString()).toBe(
      'tuple<finite_number, finite_number>'
    );
    // A tuple-shaped denominator still makes no shape claim: tuple / tuple
    // has no defined quotient and canonicalDivide rejects it.
    ce.declare('tup2', 'tuple<finite_integer, finite_integer>');
    expect(ce.box(['Divide', 'tup', 'tup2']).isValid).toBe(false);
  });

  // The admission is in `checkNumericArgs`, so every numeric operator gets it.
  test.each([
    ['\\frac{H(X(t), Y(t))}{g(t)}', 'Divide'],
    ['H(X(t), Y(t)) + g(t)', 'Add'],
    ['H(X(t), Y(t)) \\cdot g(t)', 'Multiply'],
    ['H(X(t), Y(t)) - g(t)', 'Subtract'],
    ['-H(X(t), Y(t))', 'Negate'],
  ])('%s (%s) admits the lifted vector operand', (latex) => {
    const ce = setUp(false);
    const expr = ce.parse(latex, { strict: false });
    expect(expr.isValid).toBe(true);
    expect(JSON.stringify(expr.json)).not.toContain('incompatible-type');
  });

  // The admission arm now delegates to the same element predicate the other
  // collection kinds use, so a `broadcastable<S>` and a `list<S>` agree for
  // every `S`. Before that, the hand-rolled arm tested only for a numeric
  // SCALAR base, so a mixed union base disagreed with its list counterpart.
  test.each([
    'finite_integer | string',
    'vector<finite_number^2>',
    'tuple<number, number>',
    'number',
  ])('broadcastable<%s> is admitted exactly as list<%s> is', (base) => {
    const ce = new ComputeEngine();
    ce.declare('bx', `broadcastable<${base}>`);
    ce.declare('lx', `list<${base}>`);
    expect(ce.box(['Divide', 'bx', 2]).isValid).toBe(
      ce.box(['Divide', 'lx', 2]).isValid
    );
    expect(ce.box(['Divide', 'bx', 2]).isValid).toBe(true);
  });

  test('a provably non-numeric lifted operand is still rejected', () => {
    const ce = new ComputeEngine();
    for (const n of ['s', 'S', 'q']) ce.declare(n, 'function');
    ce.parse('s(a) \\coloneq \\lbrack \\text{"a"}, \\text{"b"}\\rbrack', {
      strict: false,
    }).evaluate();
    ce.parse('S(a) \\coloneq s(2a)', { strict: false }).evaluate();
    const expr = ce.parse('\\frac{S(q(t))}{2}', { strict: false });
    expect(expr.isValid).toBe(false);
  });
});
