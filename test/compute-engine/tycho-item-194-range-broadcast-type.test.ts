import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho item 194 — arithmetic that broadcasts a scalar over a `Range` (or any
 * declared collection) must combine the scalar's numeric tier into the
 * ELEMENT type, not echo the collection operand's element type verbatim.
 *
 * `Multiply(1/2, Range(1,4))` used to declare `list<integer>` while evaluating
 * to `[1/2, 1, 3/2, 2]`. Anything reading the DECLARED element type then made
 * a wrong decision — a comprehension binder declared `integer` rejected its
 * own first value with `incompatible-type`.
 */
describe('Tycho item 194: scalar broadcast over a collection', () => {
  //
  // The declared type must be a sound upper bound of the evaluated value's
  // type, AND must not claim `integer` for rational/real values.
  //
  describe('declared element tier agrees with the evaluated value', () => {
    const cases: [string, string, string][] = [
      // latex, declared type, evaluated type
      ['\\frac{1}{2}(1..4)', 'list<rational>', 'vector<rational^4>'],
      ['0.5(1..4)', 'list<real>', 'vector<real^4>'],
      ['(1..4)+\\frac{1}{2}', 'list<rational>', 'vector<rational^4>'],
      ['(1..4)-\\frac{1}{2}', 'list<rational>', 'vector<rational^4>'],
      // `canonicalDivide` rewrites a literal denominator into `Multiply`, so
      // this exercises the same arm through a different surface form.
      ['(1..4)/2', 'list<rational>', 'vector<rational^4>'],
      // An integer scalar leaves the tier alone (no regression).
      ['2(1..4)', 'list<integer>', 'vector<integer^4>'],
      ['(1..4)+1', 'list<integer>', 'vector<integer^4>'],
    ];

    for (const [latex, declared, evaluated] of cases) {
      test(`${latex} declares ${declared}`, () => {
        const ce = new ComputeEngine();
        const expr = ce.parse(latex);
        expect(expr.type.toString()).toBe(declared);
        const value = expr.evaluate();
        expect(value.type.toString()).toBe(evaluated);
        // Soundness: the evaluated type must fit the declared one.
        expect(value.type.matches(expr.type)).toBe(true);
      });
    }
  });

  test('a declared `list<integer>` symbol scaled by a float declares real elements', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer>');
    expect(ce.box(['Multiply', 0.5, 'L']).type.toString()).toBe('list<real>');
    expect(ce.box(['Add', 0.5, 'L']).type.toString()).toBe('list<real>');
  });

  test('a symbolic-length Range scaled by a float declares real elements', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'integer');
    expect(ce.box(['Multiply', 0.5, ['Range', 1, 'N']]).type.toString()).toBe(
      'list<real>'
    );
  });

  //
  // Neither sum nor product is closed over `imaginary`: `i + (-i) = 0` and
  // `i · i = -1` are both real, so the broadcast cell type must widen to
  // `complex` rather than claiming `imaginary`.
  //
  test('an imaginary scalar over an imaginary list does not claim `imaginary`', () => {
    const ce = new ComputeEngine();
    const i = ['Complex', 0, 1];
    const prod = ce.box(['Multiply', i, ['List', i, ['Complex', 0, 2]]]);
    expect(prod.type.toString()).toBe('vector<complex^2>');
    expect(prod.evaluate().type.matches(prod.type)).toBe(true);

    const sum = ce.box(['Add', i, ['List', i, ['Complex', 0, -1]]]);
    expect(sum.type.toString()).toBe('vector<complex^2>');
    expect(sum.evaluate().type.matches(sum.type)).toBe(true);
  });

  //
  // A cell that is ITSELF a collection: the scalar folds into the INNERMOST
  // cells, never into the collection cell. A `list` kind carries a
  // multi-dimensional shape in `dimensions` (`matrix<2x2>` has `number`
  // elements), but a DIMENSIONLESS nested list carries it in `elements`
  // (`list<list<number>>`), so reading `elements` as the leaf there and
  // widening a scalar against it produced `list<integer | list<number>>`
  // — a union of a scalar and a collection. No evaluated value ever has that
  // type (every element stays a list), and union matching is all-members, so
  // `type.matches('collection')` answered a confident `false` on a value that
  // is always a collection.
  //
  describe('a nested collection cell absorbs the scalar one level down', () => {
    // label → declares the operand's symbols and returns the operand
    const nested: [string, (ce: ComputeEngine) => any][] = [
      // `List(L, L)` with `L: list<number>` types `list<list<number>>` with no
      // shape (see `list-shape-typing.test.ts`).
      [
        'List(L, L) with L: list<number>',
        (ce) => {
          ce.declare('L', 'list<number>');
          return ['List', 'L', 'L'];
        },
      ],
      [
        'a declared `list<list<number>>` symbol',
        (ce) => {
          ce.declare('M', 'list<list<number>>');
          return 'M';
        },
      ],
    ];

    for (const [label, setup] of nested) {
      for (const head of ['Multiply', 'Add'] as const) {
        test(`${head}(2, ${label})`, () => {
          const ce = new ComputeEngine();
          const expr = ce.box([head, 2, setup(ce)]);
          expect(expr.type.toString()).toBe('list<list<number>>');
          // Not a union of a scalar and a collection.
          expect(expr.type.toString()).not.toContain('|');
          expect(expr.type.matches('collection')).toBe(true);
          // Soundness: the evaluated type must fit the declared one.
          expect(expr.evaluate().type.matches(expr.type)).toBe(true);
        });
      }
    }

    test('the scalar tier reaches the INNER cells', () => {
      const ce = new ComputeEngine();
      ce.declare('Mi', 'list<list<integer>>');
      expect(ce.box(['Multiply', 0.5, 'Mi']).type.toString()).toBe(
        'list<list<real>>'
      );
      expect(ce.box(['Add', 0.5, 'Mi']).type.toString()).toBe(
        'list<list<real>>'
      );
    });

    test('a DIMENSIONED `list` kind still widens its own (leaf) elements', () => {
      const ce = new ComputeEngine();
      ce.declare('V', 'vector<3>');
      ce.declare('X', 'matrix<2x2>');
      // `vector<3>`/`matrix<2x2>` already have `number` leaves: nothing to
      // sharpen, so the spelling is handed back unchanged.
      expect(ce.box(['Multiply', 0.5, 'V']).type.toString()).toBe('vector<3>');
      expect(ce.box(['Multiply', 0.5, 'X']).type.toString()).toBe(
        'matrix<2x2>'
      );
      // A literal matrix has `integer` leaves, which the float sharpens
      // — into the LEAF, not into the row type.
      const m = ce.box([
        'Multiply',
        0.5,
        ['List', ['List', 1, 2], ['List', 3, 4]],
      ]);
      expect(m.type.toString()).toBe('matrix<real^(2x2)>');
      expect(m.evaluate().type.matches(m.type)).toBe(true);
    });
  });

  //
  // The consequence the item reported: a comprehension declares its binder
  // from the iterated collection's DECLARED element type.
  //
  test('a comprehension over `1/2·(1..4)` iterates its rational elements', () => {
    const ce = new ComputeEngine();
    const comp = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Multiply', ['Rational', 1, 2], ['Range', 1, 4]]],
    ]);
    const items = [...comp.evaluate().each()].map((x) => x.toString());
    expect(items).toEqual(['1/2', '1', '3/2', '2']);
  });

  //
  // Robustness of the binder itself, independent of the typing fix above: a
  // binder's index type is INFERRED from the collection's declared element
  // type, so when that declaration understates the values (here a lambda
  // assigned under a `list<integer>` signature that actually yields
  // rationals) the per-iteration assignment must widen the guess rather than
  // throw `incompatible-type`.
  //
  test('a binder whose collection under-declares its element type still iterates', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> list<integer>');
    ce.assign(
      'f',
      ce.parse('n \\mapsto \\left[\\frac{1}{2}, \\frac{3}{2}\\right]')
    );
    const comp = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['f', 1]],
    ]);
    const items = [...comp.evaluate().each()].map((x) => x.toString());
    expect(items).toEqual(['1/2', '3/2']);
  });
});

/**
 * The source-level defect behind the binder failure above: `BoxedSymbol._infer()`
 * wrote a concrete type onto a value definition whose declared type was still
 * `unknown` without marking that definition's type INFERRED, so the guess
 * became an enforceable contract and the next assignment of a wider value was
 * rejected instead of widening it (`assertAssignableValueDef`,
 * `engine-declarations.ts`). Inferred means revisable, declared means
 * enforceable (`docs/EFFECTS-MODEL.md`, "Annotation provenance"), so these two
 * tests pin BOTH sides of that split.
 */
describe('inference marks its own writes inferred', () => {
  test('an `unknown` declaration narrowed by inference still widens on assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'unknown');
    const z = ce.symbol('z');
    expect(z._infer(() => ce.type('integer').type)).toBe(true);
    expect(z.type.toString()).toBe('integer');
    // The narrowing is a guess, not a contract.
    expect(z.valueDefinition?.inferredType).toBe(true);
    // A value outside the guess widens the type instead of throwing.
    expect(() => ce.assign('z', ce.box(['Rational', 1, 2]))).not.toThrow();
    expect(ce.symbol('z').valueDefinition?.value?.toString()).toBe('1/2');
    expect(ce.symbol('z').type.matches('rational')).toBe(true);
  });

  test('a DECLARED type is still a contract an assignment cannot break', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'integer');
    expect(ce.symbol('w').valueDefinition?.inferredType).toBe(false);
    expect(() => ce.assign('w', ce.box(['Rational', 1, 2]))).toThrow();
    // ...and inference cannot quietly move it off the declared track either.
    expect(ce.symbol('w')._infer(() => ce.type('real').type)).toBe(false);
    expect(ce.symbol('w').valueDefinition?.inferredType).toBe(false);
  });
});
