import { ComputeEngine, isFunction } from '../../src/compute-engine';

/** The type of the first occurrence of the symbol `name` in `expr`. Boxing
 * declares nothing, so a type inferred from a use is read on the
 * occurrence, not through a new boxing of the name. */
function occurrenceType(expr: any, name: string): string | undefined {
  if (expr.symbol === name) return expr.type.toString();
  for (const op of expr.ops ?? []) {
    const t = occurrenceType(op, name);
    if (t !== undefined) return t;
  }
  return undefined;
}

/**
 * Collection-aware result typing for `Multiply` (and the `Add` widening it
 * feeds) on DECLARED matrix/vector symbols — decision (d) of the
 * matrix-operator typing design: make the declared path airtight.
 *
 * NOTE: declaring `matrix`/`vector` types retypes a symbol for the engine's
 * lifetime, so each test uses a FRESH `new ComputeEngine()` and never touches
 * the shared test engine.
 */
describe('Matrix-operator typing (declared symbols)', () => {
  function engine() {
    const ce = new ComputeEngine();
    ce.declare('X', 'matrix');
    ce.declare('Y', 'matrix');
    ce.declare('v', 'vector');
    return ce;
  }

  test('scalar × matrix → matrix', () => {
    const e = engine().parse('2Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('matrix − matrix → matrix (poison via canonical -1·Y term)', () => {
    const e = engine().parse('X-Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('scalar·matrix + scalar·matrix → matrix', () => {
    const e = engine().parse('3X+2Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('matrix × matrix preserves shape and the written product order', () => {
    const ce = engine();
    const xy = ce.parse('XY');
    const yx = ce.parse('YX');
    expect(xy.isValid).toBe(true);
    expect(yx.isValid).toBe(true);
    expect(xy.type.toString()).toBe('matrix');
    expect(yx.type.toString()).toBe('matrix');
    ce.assign('X', ['List', ['List', 1, 2], ['List', 3, 4]]);
    ce.assign('Y', ['List', ['List', 2, 0], ['List', 0, 1]]);
    expect(xy.evaluate().json).toEqual(['List', ['List', 2, 2], ['List', 6, 4]]);
    expect(yx.evaluate().json).toEqual(['List', ['List', 2, 4], ['List', 3, 4]]);
  });

  test('det(matrix × matrix) is valid and typed number', () => {
    const e = engine().parse('\\det(XY)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  test('Trace(scalar × matrix) → number', () => {
    const e = engine().parse('\\operatorname{Trace}(2Y)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  test('scalar × vector → vector (v’s declared type)', () => {
    const ce = engine();
    const e = ce.parse('2v');
    expect(e.isValid).toBe(true);
    // `vector` is the alias for `list<number>`; the product carries v's type.
    expect(e.type.toString()).toBe(ce.symbol('v').type.toString());
  });

  // --- Already-correct rows: guard against regression ---

  test('matrix + matrix → matrix', () => {
    expect(engine().parse('X+Y').type.toString()).toBe('matrix');
  });

  test('-matrix → matrix', () => {
    expect(engine().parse('-Y').type.toString()).toBe('matrix');
  });

  test('matrix^2 → matrix', () => {
    expect(engine().parse('X^2').type.toString()).toBe('matrix');
  });

  test('matrix^{-1} → matrix', () => {
    expect(engine().parse('X^{-1}').type.toString()).toBe('matrix');
  });

  test('det(matrix + scalar·matrix) → number', () => {
    const e = engine().parse('\\det(X+2Y)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  // Was pinned as `integer | matrix` ("the honest union"). Reversed:
  // the scalar arm is UNREACHABLE — `matrix + scalar` broadcasts elementwise
  // and always evaluates to a matrix (`[[1,2],[3,4]]+1` → `[[2,3],[4,5]]`).
  // Keeping it cost real consumers: union matching is all-members, so
  // `type.matches('collection')` answered a confident `false` on a value that
  // is always a collection (Tycho item 67), and it made `MatrixMultiply` reject
  // a valid `aM₁+M₂` operand (see `wester.test.ts`, row-vector · matrix-sum).
  test('matrix + scalar → matrix (no unreachable scalar arm)', () => {
    expect(engine().parse('X+1').type.toString()).toBe('matrix');
  });

  test('vector + scalar → vector, shape preserved', () => {
    const ce = engine();
    ce.declare('V', 'vector<3>');
    expect(ce.parse('V+1').type.toString()).toBe('vector<3>');
    expect(ce.parse('2V+1').type.toString()).toBe('vector<3>');
  });

  // A generic `collection`/`set` operand may be non-indexed at runtime, which
  // the value path never broadcasts — those keep the honest widen.
  test('set/collection + scalar keeps the honest union', () => {
    const ce = engine();
    ce.declare('S', 'set<number>');
    expect(ce.parse('S+1').type.toString()).toContain('|');
  });

  test('vector + vector → vector, rank preserved', () => {
    // Was `list<number>`, which this test's old name called merely
    // "acceptable". Since the type parser started recording an unsized
    // `vector`'s open rank-1 dimension (commit eaae156c), vector-ness
    // survives the addition instead of widening to a bare list — a strictly
    // better answer, so the expectation moved rather than the code.
    expect(engine().parse('v+v').type.toString()).toBe('vector');
  });
});

describe('Matrix-operator typing (undeclared symbols)', () => {
  test('an unspecified sum does not establish a determinant operand shape', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\det(A+2B)');
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
    if (!isFunction(e) || !isFunction(e.op1))
      throw new Error('Expected a determinant with an error operand');
    expect(e.op1.op1.json).toEqual([
      'ErrorCode', "'incompatible-type'", "'matrix'", "'number'",
    ]);
    expect(ce.lookupDefinition('A')).toBeUndefined();
    expect(ce.lookupDefinition('B')).toBeUndefined();
  });

  test('does not rewrite an inference made by an earlier expression', () => {
    const ce = new ComputeEngine();
    // `ce.infer()` commits the inference of the earlier expression.
    ce.infer([ce.parse('A+1')]);
    const e = ce.parse('\\det(A)');
    expect(e.isValid).toBe(false);
    expect(ce.symbol('A').type.matches('number')).toBe(true);
  });

  test('fails closed for an ambiguous product of fresh symbols', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\det(x y)');
    expect(e.isValid).toBe(false);
  });
});

describe('Multiply numeric typing (regression — must be unchanged)', () => {
  test('(2)(3) types integer and evaluates to 6', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('(2)(3)');
    expect(e.type.toString()).not.toMatch(/\bnever\b/);
    expect(e.type.matches('integer')).toBe(true);
    expect(e.evaluate().toString()).toBe('6');
  });

  test('2x for a scalar x is unchanged (number)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('2x').type.toString()).toBe('number');
  });
});

describe('Matrix parameter validation', () => {
  const sym = (ce: ComputeEngine, name: string) => ce.box(name).type.toString();

  test.each([true, false])(
    'a matrix plus a scalar is a valid determinant operand (matrix first: %s)',
    (matrixFirst) => {
      const ce = new ComputeEngine();
      ce.assign('A', matrixFirst ? ['List', ['List', 1, 2], ['List', 3, 4]] : 1);
      ce.assign('B', matrixFirst ? 1 : ['List', ['List', 2, 0], ['List', 0, 1]]);
      const e = ce.parse('\\det(A+2B)');
      expect(e.isValid).toBe(true);
      if (!isFunction(e)) throw new Error('Expected a determinant call');
      expect(e.op1.type.toString()).toBe('matrix<integer^(2x2)>');
      expect(e.evaluate().json).toBe(matrixFirst ? -2 : 14);
    }
  );

  test('committed numeric evidence stays numeric after a rejected determinant', () => {
    const ce = new ComputeEngine();
    // The inference of the earlier
    // expression is in its unit until `ce.infer()` commits it.
    const earlier = ce.box(['Add', 'A', 1]);
    earlier.evaluate();
    ce.infer([earlier]);
    expect(ce.box(['Determinant', ['Add', 'A', 'B']]).isValid).toBe(false);
    expect(sym(ce, 'A')).toBe('number');
  });

  test('an unspecified product cannot supply the matrix parameter', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Determinant', ['Multiply', 'a', 'A']]);
    expect(e.isValid).toBe(false);
    expect(occurrenceType(e, 'a')).toBe('number');
    expect(occurrenceType(e, 'A')).toBe('number');
  });

  test('scaling a known matrix preserves its matrix shape', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix');
    const e = ce.box(['Determinant', ['Multiply', 2, 'A']]);
    expect(e.isValid).toBe(true);
    expect(occurrenceType(e, 'A')).toBe('matrix');
  });

  test('negation, integer power, and subtraction preserve known matrix shape', () => {
    {
      const ce = new ComputeEngine();
      ce.declare('A', 'matrix');
      const e = ce.box(['Determinant', ['Negate', 'A']]);
      expect(e.isValid).toBe(true);
      expect(occurrenceType(e, 'A')).toBe('matrix');
    }
    {
      const ce = new ComputeEngine();
      ce.declare('A', 'matrix');
      const e = ce.box(['Determinant', ['Power', 'A', 2]]);
      expect(e.isValid).toBe(true);
      expect(occurrenceType(e, 'A')).toBe('matrix');
    }
    {
      const ce = new ComputeEngine();
      ce.declare('A', 'matrix');
      ce.declare('B', 'matrix');
      const e = ce.box(['Determinant', ['Subtract', 'A', 'B']]);
      expect(e.isValid).toBe(true);
      expect(occurrenceType(e, 'A')).toBe('matrix');
      expect(occurrenceType(e, 'B')).toBe('matrix');
    }
  });


  test('non-strict boxing retains ordinary numeric evidence', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    const e = ce.box(['Determinant', ['Add', 'A', 'B']]);
    expect(e.isValid).toBe(true);
    expect(occurrenceType(e, 'A')).toBe('number');
  });

  test('Dot keeps its own argument types when its scalar result is refused', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Determinant', ['Dot', 'u', 'v']]);
    // Dot returns a scalar, so the outer Determinant(matrix) mismatches; the
    // u/v carry Dot's own parameter typing,
    // which admits a point as well as a vector or matrix (`Dot` is the
    // sanctioned spelling of the point inner product, Tycho item 158).
    expect(e.isValid).toBe(false);
    // `list<number>` in this union is now spelled `vector`, for the same
    // reason as the `v+v` case above (commit eaae156c): an unsized vector
    // keeps its rank-1 dimension rather than flattening to a bare list.
    // `list<tuple>` — a LIST of points — joined the union when `Dot` gained
    // its point-list broadcast (one inner product per point, ruled
    // 2026-09-22); the union is read straight off `Dot`'s signature, so it
    // grows with every operand shape the operator accepts.
    expect(occurrenceType(e, 'u')).toBe('list<tuple> | matrix | tuple | vector');
    expect(occurrenceType(e, 'v')).toBe('list<tuple> | matrix | tuple | vector');
  });

  test('an existing matrix supplies the shape for a scalar product', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix');
    const e = ce.box(['Determinant', ['Multiply', 'A', 'M']]);
    expect(e.isValid).toBe(true);
    expect(occurrenceType(e, 'A')).toBe('number');
  });

  test('a scaled vector is refused without changing scalar evidence', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'vector');
    const e = ce.box(['Determinant', ['Multiply', 'A', 'v']]);
    expect(e.isValid).toBe(false);
    expect(occurrenceType(e, 'A')).toBe('number');
  });

  test('a folded scalar quotient is refused without declaring its name', () => {
    // The argument folds to `1`, so no occurrence of `A` is left; boxing leaves no
    // definition of `A`.
    const ce = new ComputeEngine();
    expect(ce.box(['Determinant', ['Divide', 'A', 'A']]).isValid).toBe(false);
    expect(ce.lookupDefinition('A')).toBeUndefined();
  });

  test('an opaque standalone call leaves its argument unknown', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Determinant', ['f', 'A']]);
    expect(e.isValid).toBe(true);
    expect(occurrenceType(e, 'A')).toBe('unknown');
  });

  test('supplied optional argument preserves a matrix input (CharacteristicPolynomial)', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix');
    ce.declare('B', 'matrix');
    const e = ce.box(['CharacteristicPolynomial', ['Add', 'A', 'B'], 'x']);
    expect(e.isValid).toBe(true);
    expect(occurrenceType(e, 'A')).toBe('matrix');
  });

  test('union parameter (matrix|vector) admits a known matrix (LinearSolve)', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix');
    ce.declare('B', 'matrix');
    ce.declare('M', 'matrix');
    const e = ce.box(['LinearSolve', 'M', ['Add', 'A', 'B']]);
    expect(e.isValid).toBe(true);
    expect(occurrenceType(e, 'A')).toBe('matrix');
  });

  test('a scalar function does not change the types of matrix summands', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix');
    ce.declare('B', 'matrix');
    const e = ce.box([
      'Determinant',
      ['Add', 'A', ['Multiply', ['Cos', 't'], 'B']],
    ]);
    expect(e.isValid).toBe(true);
    expect(occurrenceType(e, 't')).toBe('number');
    expect(occurrenceType(e, 'A')).toBe('matrix');
    expect(occurrenceType(e, 'B')).toBe('matrix');
  });

  // `Length(xs)` narrows an untyped `xs` to `collection` earlier in the same
  // boxing. That is collection evidence, not a numeric guess made by `Add` or
  // `Multiply`, so a later collection accessor does not repair `xs` to
  // `matrix`. Before, `First(xs)` retyped `xs` as `matrix`, typed its own
  // result as a row (`missing | vector`), and a later `Filter` over `xs`
  // refused a scalar predicate.
  test('a symbol narrowed to a collection by Length is not repaired to matrix', () => {
    const ce = new ComputeEngine();
    const first = ce.box([
      'Function',
      ['Block', ['Length', 'xs'], ['First', 'xs']],
      'xs',
    ]);
    expect(first.isValid).toBe(true);
    expect(first.type.toString()).toBe(
      '(xs: indexed_collection<any>) -> unknown'
    );

    const rest = ce.box([
      'Function',
      ['Block', ['Length', 'ys'], ['Rest', 'ys']],
      'ys',
    ]);
    expect(rest.isValid).toBe(true);
    // `ys` is a collection, which can be a string: `Rest` of a string is a
    // string, so the result type joins the string and list arms.
    expect(rest.type.toString()).toBe(
      '(ys: indexed_collection<any>) -> list<any> | string'
    );

    const filter = ce.box([
      'Function',
      [
        'Block',
        ['Length', 'zs'],
        ['Filter', 'zs', ['Function', ['Less', 'x', ['First', 'zs']], 'x']],
      ],
      'zs',
    ]);
    expect(filter.isValid).toBe(true);
    expect(filter.type.toString()).toBe('(zs: indexed_collection<any>) -> list<any>');
    expect(
      ce
        .box(['Apply', filter, ['List', 3, 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
  });

  test('an explicit matrix formal is independent of inferred collection evidence', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Block', ['Length', 'B'], ['Determinant', ['Multiply', 2, 'A']]],
      ['Typed', 'A', "'matrix'"],
      'B',
    ]);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('(A: matrix, B: collection) -> number');
  });

  test('a matrix parameter narrows previous collection evidence', () => {
    // Ordinary inference narrows `collection` to `matrix`.
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Block', ['Length', 'xs'], ['Determinant', 'xs']],
      'xs',
    ]);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('(xs: matrix) -> number');
  });
});

describe('Rejected matrix operands and definition slot restore', () => {
  test('a rejected matrix operand keeps the types of its occurrences', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\det(\\frac{A}{B})');
    expect(e.isValid).toBe(false);
    expect(occurrenceType(e, 'A')).toBe('number');
    expect(occurrenceType(e, 'B')).toBe('number');
    expect(ce.lookupDefinition('A')).toBeUndefined();
  });

  test('the slot restore preserves an assigned value and BoxedType identity', () => {
    // The OLD restore wrote through the `type` setter: restoring `unknown`
    // wiped the value, and every restore allocated a fresh BoxedType
    // (defeating identity-keyed caches). `_restoreTypeSlots` writes the
    // private slots verbatim.
    const ce = new ComputeEngine();
    ce.assign('w', 5);
    const def: any = (ce.lookupDefinition('w') as any).value;
    const beforeType = def.type;
    const snapshot = def._typeSlotSnapshot();
    def.type = ce.type('matrix'); // simulate a repair write
    expect(def.type.toString()).toBe('matrix');
    def._restoreTypeSlots(snapshot);
    expect(def.type).toBe(beforeType); // same BoxedType OBJECT — identity
    expect(ce.box('w').evaluate().toString()).toBe('5'); // value survived
  });

  test('the slot restore round-trips a self-referential value flag', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'number');
    const def: any = (ce.lookupDefinition('r') as any).value;
    expect(def.isSelfReferential).toBe(false);
    const snapshot = def._typeSlotSnapshot();
    // Mutate to a SELF-REFERENTIAL value between snapshot and restore, so
    // the assertion actually exercises the flag's restoration (the value
    // setter recomputes the flag; a verbatim `_value` restore without the
    // flag would leave it stale at `true`).
    def.value = ce.box(['Add', 'r', 1]);
    expect(def.isSelfReferential).toBe(true);
    def._restoreTypeSlots(snapshot);
    expect(def.isSelfReferential).toBe(false);
  });
});
