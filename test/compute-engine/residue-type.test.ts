/**
 * The type `residue` of a residue class (an element of ℤ/nℤ), and what it
 * does for a head that is not `ResidueClass`
 * (`docs/plans/2026-10-23-residue-class-type.md`, issue #471).
 *
 * Before the type, a class had the type `value`, and the engine kept the
 * number rules (`c/c` is 1, `c - c` is 0) away from it by looking for an
 * operator NAMED `ResidueClass`. A head with another name got no protection:
 * with `MyMod` declared `(any, any) -> value`, `MyMod(2, 4)/MyMod(2, 4)`
 * simplified to `1`, although 2 has no inverse modulo 4. The protection now
 * reads the type: the declared result type of a head, the inferred signature
 * of a function, the declared type of a symbol.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { BoxedType } from '../../src/common/type/boxed-type';

const RC = (k: number, n: number) => ['ResidueClass', k, n] as const;

/** An engine with a head whose values are residue classes of its own, as
 * the reporter of #471 declares one. Its canonical handler reduces the
 * representative; it has no arithmetic of its own. */
function engineWithMyMod(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('MyMod', {
    signature: '(any, any) -> residue',
    lazy: true,
    canonical: (ops, { engine }) => {
      const [a, m] = ops.map((x) => x.canonical);
      if (Number.isInteger(a.re) && Number.isInteger(m.re) && m.re >= 1)
        return engine._fn('MyMod', [
          engine.number(((a.re % m.re) + m.re) % m.re),
          m,
        ]);
      return engine._fn('MyMod', [a, m]);
    },
  });
  return ce;
}

describe('the type residue', () => {
  const ce = new ComputeEngine();

  test('a class and arithmetic over classes are typed residue', () => {
    expect(ce.box(RC(2, 4)).type.toString()).toBe('residue');
    expect(ce.box(['ResidueClass', 'k', 4]).type.toString()).toBe('residue');
    expect(ce.box(['Add', RC(2, 7), RC(3, 7)]).type.toString()).toBe(
      'residue'
    );
    // Two moduli: the sum stays unevaluated, and is still a class.
    expect(ce.box(['Add', RC(2, 7), RC(3, 5)]).type.toString()).toBe(
      'residue'
    );
    expect(ce.box(['Add', RC(2, 7), 3]).type.toString()).toBe('residue');
    expect(ce.box(['Add', RC(2, 7), 1.5]).type.toString()).toBe('residue');
    expect(ce.box(['Add', RC(2, 7), 'x']).type.toString()).toBe('residue');
    expect(ce.box(['Divide', RC(2, 4), RC(2, 4)]).type.toString()).toBe(
      'residue'
    );
    expect(ce.box(['Power', RC(2, 7), ['Rational', 1, 2]]).type.toString()).toBe(
      'residue'
    );
    expect(ce.box(['Sqrt', RC(2, 7)]).type.toString()).toBe('residue');
    expect(ce.box(['Root', RC(2, 7), 3]).type.toString()).toBe('residue');
  });

  test('a NaN beside a class keeps the nan arm; a collection keeps its shape', () => {
    expect(ce.box(['Add', 'NaN', RC(2, 5)]).type.toString()).toBe(
      'nan | residue'
    );
    expect(ce.box(['Add', 'NaN', RC(2, 5)]).evaluate().toString()).toBe('NaN');
    expect(
      ce.box(['Multiply', RC(2, 4), ['Tuple', 1, 2]]).evaluate().json
    ).toEqual(['Tuple', ['ResidueClass', 2, 4], ['ResidueClass', 0, 4]]);
    expect(ce.box(['Multiply', RC(2, 4), ['List', 1, 2]]).type.toString()).toBe(
      'list<residue^2>'
    );
  });

  test('residue is a value, not a number, not a collection', () => {
    expect(ce.type('residue').matches('value')).toBe(true);
    expect(ce.type('residue').matches('number')).toBe(false);
    expect(ce.type('number').matches('residue')).toBe(false);
    expect(ce.type('residue').matches('collection')).toBe(false);
    expect(ce.type('residue | integer').toString()).toBe('integer | residue');
    expect(ce.type('list<residue>').toString()).toBe('list<residue>');
  });

  test('ℤ/nℤ is a set of classes', () => {
    expect(ce.box(['QuotientRing', 'Integers', 5]).type.toString()).toBe(
      'set<residue>'
    );
  });
});

describe('a head declared to return residue is protected', () => {
  const ce = engineWithMyMod();
  const c = ['MyMod', 2, 4] as const;
  const d = ['MyMod', 2, 7] as const;

  test('its values are typed residue', () => {
    expect(ce.box(c).type.toString()).toBe('residue');
  });

  test.each([
    ['c/c', ['Divide', c, c]],
    ['c - c', ['Subtract', c, c]],
    ['c + oo', ['Add', c, 'PositiveInfinity']],
    ['(c·x)/c', ['Divide', ['Multiply', c, 'x'], c]],
    ['(c^(2/3))^3', ['Power', ['Power', c, ['Rational', 2, 3]], 3]],
  ])('%s is not folded by a number rule', (_, json) => {
    const e = ce.box(json as any);
    expect(e.isValid).toBe(true);
    for (const r of [e, e.evaluate(), e.N(), e.simplify()]) {
      expect(isNumberLiteral(r)).toBe(false);
      expect(r.isValid).toBe(true);
    }
  });

  test('Equal(c, c) is True, under evaluate() and simplify()', () => {
    expect(ce.box(['Equal', d, d]).evaluate().symbol).toBe('True');
    expect(ce.box(['Equal', d, d]).simplify().symbol).toBe('True');
    // A class against an integer is not decided by the engine, for
    // `ResidueClass` as for a head of its own: the head's equality (the
    // reporter's `IntegerMod` compares equal to an integer) is the head's.
    expect(ce.box(['Equal', d, 2]).evaluate().operator).toBe('Equal');
    expect(
      ce.box(['Equal', RC(2, 7), 2]).evaluate().operator
    ).toBe('Equal');
  });

  test('Expand and Factor keep an expression with a class', () => {
    const sq = ['Power', ['Add', c, 1], 2];
    expect(ce.box(['Expand', sq]).evaluate().json).toEqual(ce.box(sq).json);
    expect(ce.box(['Factor', ['Add', ['Multiply', c, 'x'], c]]).evaluate().json)
      .toEqual(ce.box(['Add', ['Multiply', c, 'x'], c]).json);
  });

  test('the parse route gives the same protection', () => {
    // A head with a known LaTeX spelling is not needed: the MathJSON of a
    // call parses through `\mathrm`.
    const e = ce.parse('\\frac{\\mathrm{MyMod}(2,4)}{\\mathrm{MyMod}(2,4)}');
    expect(e.simplify().json).toEqual(['Divide', c, c]);
  });

  test('the engine does not fold a head that is not ResidueClass', () => {
    // The protection comes with the type; the arithmetic stays with the head.
    expect(ce.box(['Add', c, ['MyMod', 3, 4]]).evaluate().json).toEqual([
      'Add',
      ['MyMod', 2, 4],
      ['MyMod', 3, 4],
    ]);
  });
});

describe('a head declared to return value is not protected', () => {
  test('MyMod(2, 4)/MyMod(2, 4) simplifies to 1, as before', () => {
    const ce = new ComputeEngine();
    ce.declare('MyMod', { signature: '(any, any) -> value' });
    expect(
      ce.box(['Divide', ['MyMod', 2, 4], ['MyMod', 2, 4]]).simplify().json
    ).toBe(1);
  });
});

describe('a symbol declared residue is protected before it has a value', () => {
  test.each([
    ['r/r', ['Divide', 'r', 'r']],
    ['r - r', ['Subtract', 'r', 'r']],
    ['r + oo', ['Add', 'r', 'PositiveInfinity']],
    ['(r·x)/r', ['Divide', ['Multiply', 'r', 'x'], 'r']],
  ])('%s in a fresh engine', (_, json) => {
    const ce = new ComputeEngine();
    ce.declare('r', 'residue');
    const e = ce.box(json as any);
    expect(e.isValid).toBe(true);
    for (const r of [e, e.evaluate(), e.simplify()])
      expect(isNumberLiteral(r)).toBe(false);
    // Then with a value: the quotient folds by the rules of the ring.
    ce.assign('r', ce.box(RC(3, 7)));
    expect(ce.box(['Divide', 'r', 'r']).evaluate().json).toEqual([
      'ResidueClass',
      1,
      7,
    ]);
  });

  test('an integer is refused: it is a representative, not the class', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'residue');
    expect(() => ce.assign('r', 2)).toThrow();
    ce.assign('r', ce.box(RC(2, 4)));
    expect(ce.box('r').evaluate().json).toEqual(['ResidueClass', 2, 4]);
  });

  test('a symbol typed integer | residue is protected too', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'integer | residue');
    expect(ce.box(['Divide', 'u', 'u']).simplify().json).toEqual([
      'Divide',
      'u',
      'u',
    ]);
  });
});

describe('a function that returns a class', () => {
  test('its inferred signature says so, and its calls are protected', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['ResidueClass', 'k', 4], 'k']));
    expect(ce.box('g').type.toString()).toBe('(k: unknown) -> residue');
    expect(ce.box(['Divide', ['g', 2], ['g', 2]]).simplify().json).toEqual([
      'Divide',
      ['ResidueClass', 2, 4],
      ['ResidueClass', 2, 4],
    ]);
    expect(
      ce.box(['Divide', ['Apply', 'g', 2], ['Apply', 'g', 2]]).simplify().json
    ).toEqual(['Divide', ['ResidueClass', 2, 4], ['ResidueClass', 2, 4]]);
  });

  test('a declared head is protected in a fresh engine before any call', () => {
    // The declaration brings the engine in: no `ResidueClass` call was made.
    const ce = engineWithMyMod();
    ce.declare('h', '(integer) -> residue');
    expect(ce.box(['Divide', ['h', 2], ['h', 2]]).simplify().json).toEqual([
      'Divide',
      ['h', 2],
      ['h', 2],
    ]);
  });
});

describe('operators with no residue arithmetic refuse a class', () => {
  const ce = new ComputeEngine();
  test.each([
    ['Sin(c)', ['Sin', RC(2, 4)]],
    ['Floor(c)', ['Floor', RC(2, 4)]],
    ['Sign(c)', ['Sign', RC(2, 4)]],
    ['Mod(c, 5)', ['Mod', RC(2, 4), 5]],
  ])('%s is an incompatible-type error at boxing', (_, json) => {
    const e = ce.box(json as any);
    expect(e.isValid).toBe(false);
    expect(e.op1.operator).toBe('Error');
    expect(JSON.stringify(e.op1.json)).toContain('incompatible-type');
  });

  test('Max([c, 1]) is refused when it is evaluated: the list may hold numbers', () => {
    // `list<integer | residue>` may hold numbers only, so the call is typed as
    // for numbers; the class among the elements is refused at evaluation.
    const e = ce.box(['Max', ['List', RC(2, 4), 1]]);
    expect(e.type.toString()).toBe('number');
    const r = e.evaluate();
    expect(r.operator).toBe('Error');
    expect(JSON.stringify(r.json)).toContain('incompatible-type');
  });

  test.each([
    ['Max(c, 3)', ['Max', RC(2, 4), 3]],
    ['Min(c, x)', ['Min', RC(2, 4), 'x']],
    ['Max(ℤ/4ℤ)', ['Max', ['QuotientRing', 'Integers', 4]]],
  ])('%s is an incompatible-type error: a class has no order', (_, json) => {
    // The call is typed `error` when it is boxed (its parameters are
    // declared `value`, so that a collection and `Nothing` are accepted),
    // and evaluates to the error.
    const e = ce.box(json as any);
    expect(e.type.toString()).toBe('error');
    const r = e.evaluate();
    expect(r.operator).toBe('Error');
    expect(JSON.stringify(r.json)).toContain('incompatible-type');
  });

  test('Max still omits Nothing and reads a collection', () => {
    expect(ce.box(['Max', 3, 7, 'Nothing']).evaluate().json).toBe(7);
    expect(ce.box(['Max', 3, ['List', 1, 9]]).evaluate().json).toBe(9);
  });

  test('a value-typed operand that holds a class is refused at evaluation', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('w', 'value');
    const e = ce2.box(['Max', 'w', 3]);
    expect(e.isValid).toBe(true);
    ce2.assign('w', ce2.box(RC(2, 4)));
    expect(e.evaluate().operator).toBe('Error');
  });
});

describe('a non-number value type is still refused by arithmetic', () => {
  // `color` is in the position `residue` takes (a value, not a number): the
  // admission of a class does not admit it.
  const ce = new ComputeEngine();
  ce.declare('k', 'color');
  test.each([
    ['k/k', ['Divide', 'k', 'k']],
    ['-k', ['Negate', 'k']],
    ['k + k', ['Add', 'k', 'k']],
    ['k^2', ['Power', 'k', 2]],
  ])('%s is an incompatible-type error', (_, json) => {
    const e = ce.box(json as any);
    expect(e.isValid).toBe(false);
    expect(JSON.stringify(e.json)).toContain('incompatible-type');
  });
});

describe('a juxtaposed class is a product', () => {
  const ce = new ComputeEngine();
  test('\\overline{3}_{7}x and two classes', () => {
    expect(ce.parse('\\overline{3}_{7}x').operator).toBe('Multiply');
    expect(ce.parse('\\overline{3}_{7}\\overline{5}_{7}').evaluate().json).toEqual([
      'ResidueClass',
      1,
      7,
    ]);
  });
});

describe('the descriptor type route agrees with the expression route', () => {
  const ce = new ComputeEngine();
  test('Add and Divide over a residue operand', () => {
    for (const op of ['Add', 'Multiply', 'Divide']) {
      const t = deriveApplicationType(ce, op, [
        describeType('residue'),
        describeType('integer'),
      ]);
      expect(
        t === undefined ? 'undefined' : new BoxedType(t).toString()
      ).toBe('residue');
    }
  });
});

describe('compile() declines a residue class', () => {
  const ce = new ComputeEngine();
  test.each([
    ['Equal(r, r), r: residue', ['Equal', 'r', 'r']],
    ['c/c', ['Divide', RC(2, 4), RC(2, 4)]],
    ['MyMod(2, 4) + 1', ['Add', ['MyMod', 2, 4], 1]],
  ])('%s', (_, json) => {
    const ce2 = engineWithMyMod();
    ce2.declare('r', 'residue');
    expect(() => compile(ce2.box(json as any), { fallback: false })).toThrow(
      /residue/
    );
  });
  test('an ordinary expression still compiles', () => {
    expect(() => compile(ce.box(['Add', 'x', 1]), { fallback: false })).not.toThrow();
  });

  test('a written absence and a value that may be a class still compile', () => {
    // The type `missing` strips to `never`, which is below every type: the
    // decline reads the strict test, not a subtype test, so `Missing` is not
    // read as a class.
    expect(() => compile(ce.box('Missing'), { fallback: false })).not.toThrow(
      /residue/
    );
    // A user function that shadows a library head takes the library's
    // parameter type, `number | residue`: its body may be a number, and the
    // call compiles.
    const ce2 = new ComputeEngine();
    ce2.declare('y', 'real');
    ce2.box(['DefineFunction', 'Square', ['Function', ['Add', 'x', 100], 'x']]).evaluate();
    const f = compile(ce2.box(['Square', 'y']));
    expect(f.success).toBe(true);
    expect(f.run!({ y: 2 })).toBe(102);
  });
});

describe('findings of the review of the implementation (2026-10-23)', () => {
  test('an operator without residue arithmetic refuses a class through checkNumericArgs too', () => {
    // `Exp`, `Ln`, `Log` and `Exp2` check their operands with the same
    // function as the arithmetic operators; the admission of a class is an
    // option that only the nine operators with residue arithmetic pass.
    const ce = new ComputeEngine();
    for (const json of [
      ['Log', 1, RC(2, 4)],
      ['Ln', RC(2, 4)],
      ['Exp', RC(2, 4)],
      ['Exp2', RC(2, 4)],
    ]) {
      const e = ce.box(json as any);
      expect(e.isValid).toBe(false);
      expect(JSON.stringify(e.json)).toContain('incompatible-type');
    }
    expect(ce.box(['Add', RC(2, 4), 1]).isValid).toBe(true);
  });

  test('a union with a non-number arm is not admitted by the class admission', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'string | residue');
    ce.declare('s', 'list<string | residue>');
    expect(ce.box(['Add', 't', 1]).isValid).toBe(false);
    expect(ce.box(['Add', 's', 1]).isValid).toBe(false);
    // A list of classes is a list of cells like numbers.
    const l = ce.box(['Add', ['List', RC(2, 4), RC(3, 4)], 1]);
    expect(l.isValid).toBe(true);
    expect(l.type.toString()).toBe('list<residue^2>');
    expect(l.evaluate().json).toEqual([
      'List',
      ['ResidueClass', 3, 4],
      ['ResidueClass', 0, 4],
    ]);
  });

  test('the public type setter registers a residue type', () => {
    const ce = new ComputeEngine();
    const r = ce.symbol('r');
    (r as any).type = 'residue';
    expect(ce.box(['Divide', 'r', 'r']).simplify().json).toEqual([
      'Divide',
      'r',
      'r',
    ]);
  });

  test('the callee of an Apply is read before the library definition of Apply', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['ResidueClass', 'k', 4], 'k']));
    ce.assign('g', ce.box(['Function', ['ResidueClass', 'k', 7], 'k']));
    ce.declare('p', 'boolean');
    const a = ['Apply', ['If', 'p', 'f', 'g'], 2];
    expect(ce.box(['Divide', a, a] as any).simplify().operator).toBe('Divide');
  });

  test('an operand that may be a class is typed with the operator, not with Add', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'integer | residue');
    expect(ce.box(['Divide', 'u', 2]).type.toString()).toBe('rational | residue');
    expect(ce.box(['Sqrt', 'u']).type.toString()).toBe('complex | residue');
    expect(ce.box(['Add', 'u', 1]).type.toString()).toBe('integer | residue');
    // Max of such an operand is typed as for a number, and evaluates once
    // the operand holds a number; a class is refused at evaluation.
    expect(ce.box(['Max', 'u', 5]).type.toString()).toBe('number');
    ce.assign('u', 4);
    expect(ce.box(['Max', 'u', 5]).evaluate().json).toBe(5);
  });

  test('a class that scales a point keeps the tuple shape', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Multiply', RC(2, 4), ['Tuple', 1, 2]]).type.toString()).toBe(
      'tuple<residue, residue>'
    );
  });
});

function isNumberLiteral(e: { json: unknown }): boolean {
  return typeof e.json === 'number';
}
