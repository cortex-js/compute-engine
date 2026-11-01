import { ComputeEngine } from '../../src/compute-engine';

// The bounds of a `Limits` clause (the collection of an `Element` clause) of
// a `Sum`, `Product` or `Integrate` are read in the scope that encloses the
// binder: in `Sum(x + 1, Limits(x, 1, x + 1))`, the `x` of the upper bound is
// the outer `x`. A raw node has no operator definition, so its clause
// ordering is read from its `Limits` and `Element` operands. The raw form
// must then give the same free variables and the same substitution as the
// structural and canonical forms.

const ce = new ComputeEngine();

const raw = (x: any) => ce.expr(x, { form: 'raw' });

describe('RAW BINDER: BOUNDS OF THE OWN CLAUSE READ THE OUTER INDEX', () => {
  test('Sum: subs() replaces the index name in the upper bound', () => {
    const e = raw([
      'Sum',
      ['Add', 'x', 1],
      ['Limits', 'x', 1, ['Add', 'x', 1]],
    ]);
    expect(e.freeVariables).toEqual(['x']);
    expect(e.subs({ x: 2 }).json).toEqual([
      'Sum',
      ['Add', 'x', 1],
      ['Limits', 'x', 1, ['Add', 2, 1]],
    ]);
  });

  test('Sum: the result agrees with the structural form', () => {
    const json = ['Sum', ['Add', 'x', 1], ['Limits', 'x', 1, ['Add', 'x', 1]]];
    const structural = ce.expr(json, { form: 'structural' });
    expect(raw(json).subs({ x: 2 }).json).toEqual(
      structural.subs({ x: 2 }).json
    );
  });

  test('Sum: an index with another name (control)', () => {
    const e = raw([
      'Sum',
      ['Add', 'k', 1],
      ['Limits', 'k', 1, ['Add', 'x', 1]],
    ]);
    expect(e.freeVariables).toEqual(['x']);
    expect(e.subs({ x: 2 }).json).toEqual([
      'Sum',
      ['Add', 'k', 1],
      ['Limits', 'k', 1, ['Add', 2, 1]],
    ]);
  });

  test('Sum: the index stays bound in the body and at its binding site', () => {
    const e = raw(['Sum', 'x', ['Limits', 'x', 1, 3]]);
    expect(e.freeVariables).toEqual([]);
    expect(e.subs({ x: 2 }).json).toEqual(['Sum', 'x', ['Limits', 'x', 1, 3]]);
  });

  test('Sum: the collection of an Element clause reads the outer index', () => {
    const e = raw([
      'Sum',
      ['Add', 'x', 1],
      ['Element', 'x', ['Range', 1, 'x']],
    ]);
    expect(e.freeVariables).toEqual(['x']);
    expect(e.subs({ x: 2 }).json).toEqual([
      'Sum',
      ['Add', 'x', 1],
      ['Element', 'x', ['Range', 1, 2]],
    ]);
  });

  test('Sum: an earlier clause reads the outer binding of a later index', () => {
    const e = raw(['Sum', 'x', ['Limits', 'y', 1, 'x'], ['Limits', 'x', 1, 3]]);
    expect(e.freeVariables).toEqual(['x']);
    expect(e.subs({ x: 2 }).json).toEqual([
      'Sum',
      'x',
      ['Limits', 'y', 1, 2],
      ['Limits', 'x', 1, 3],
    ]);
  });

  test('Sum: a later clause reads the index of an earlier clause', () => {
    const e = raw(['Sum', 'x', ['Limits', 'x', 1, 3], ['Limits', 'y', 1, 'x']]);
    expect(e.freeVariables).toEqual([]);
    expect(e.subs({ x: 2 }).json).toEqual([
      'Sum',
      'x',
      ['Limits', 'x', 1, 3],
      ['Limits', 'y', 1, 'x'],
    ]);
  });

  test('Product: subs() replaces the index name in the upper bound', () => {
    const e = raw([
      'Product',
      ['Add', 'x', 1],
      ['Limits', 'x', 1, ['Add', 'x', 1]],
    ]);
    expect(e.freeVariables).toEqual(['x']);
    expect(e.subs({ x: 2 }).json).toEqual([
      'Product',
      ['Add', 'x', 1],
      ['Limits', 'x', 1, ['Add', 2, 1]],
    ]);
  });

  test('Integrate: subs() replaces the variable name in the upper bound', () => {
    const e = raw([
      'Integrate',
      ['Function', ['Add', 'x', 1], 'x'],
      ['Limits', 'x', 0, 'x'],
    ]);
    expect(e.freeVariables).toEqual(['x']);
    expect(e.subs({ x: 2 }).json).toEqual([
      'Integrate',
      ['Function', ['Add', 'x', 1], 'x'],
      ['Limits', 'x', 0, 2],
    ]);
  });

  test('Integrate: the canonical value of the substituted raw form', () => {
    // ∫₀² (x + 1) dx = 2 + 2 = 4
    const e = raw(['Integrate', ['Add', 'x', 1], ['Limits', 'x', 0, 'x']]);
    expect(e.subs({ x: 2 }).canonical.N().re).toBeCloseTo(4, 10);
  });
});

// The clauses of a raw node are read at the operand positions of the
// canonical form, in every spelling of a clause (`Limits`, `Element`,
// `Tuple`, a bare symbol). The body is never read as a clause.
describe('RAW BINDER: CLAUSE SPELLINGS AND POSITIONS', () => {
  test('an Element body is not a clause', () => {
    const e = raw([
      'Sum',
      ['Element', 'x', ['List', 'y']],
      ['Limits', 'y', 1, 3],
    ]);
    expect(e.freeVariables).toEqual(['x']);
    expect(e.subs({ y: 2 }).json).toEqual([
      'Sum',
      ['Element', 'x', ['List', 'y']],
      ['Limits', 'y', 1, 3],
    ]);
  });

  test('a bare-symbol clause binds its index', () => {
    const e = raw(['Sum', 'k', 'k']);
    expect(e.freeVariables).toEqual([]);
    expect(e.subs({ k: 7 }).json).toEqual(['Sum', 'k', 'k']);
  });

  test('a bare-symbol clause after a Limits clause', () => {
    const e = raw(['Sum', ['Add', 'k', 'n'], ['Limits', 'k', 1, 'n'], 'n']);
    expect(e.freeVariables).toEqual(['n']);
    expect(e.subs({ n: 7 }).json).toEqual([
      'Sum',
      ['Add', 'k', 'n'],
      ['Limits', 'k', 1, 7],
      'n',
    ]);
  });

  test('a Tuple clause binds its index and counts as a clause', () => {
    const e = raw([
      'Sum',
      ['Multiply', 'k', 'j'],
      ['Tuple', 'k', 1, 'j'],
      ['Limits', 'j', 1, 3],
    ]);
    expect(e.freeVariables).toEqual(['j']);
    expect(e.subs({ j: 7 }).json).toEqual([
      'Sum',
      ['Multiply', 'k', 'j'],
      ['Tuple', 'k', 1, 7],
      ['Limits', 'j', 1, 3],
    ]);
  });
});

// Each spelling of a clause reads its bounds in the scope that encloses the
// binder, and an indefinite clause in any spelling leaves its variable free.
// The raw, structural and canonical forms give the same free variables and
// the same value after `subs()`.
describe('RAW BINDER: SELF-REFERENCING BOUNDS AND INDEFINITE CLAUSES', () => {
  const forms = ['raw', 'structural', 'canonical'] as const;
  const check = (json: any, sub: Record<string, number>, free: string[]) => {
    const results = forms.map((form) => {
      const e = ce.expr(json, { form });
      return {
        free: e.freeVariables,
        value: JSON.stringify(e.subs(sub).canonical.json),
      };
    });
    for (const r of results) {
      expect(r.free).toEqual(free);
      expect(r.value).toEqual(results[2].value);
    }
  };

  test('Sum: a Tuple bound reads the outer index, as a Limits bound', () => {
    check(['Sum', 'k', ['Tuple', 'k', 1, 'k']], { k: 7 }, ['k']);
    check(['Sum', 'k', ['Limits', 'k', 1, 'k']], { k: 7 }, ['k']);
    expect(
      raw(['Sum', 'k', ['Tuple', 'k', 1, 'k']]).subs({ k: 7 }).json
    ).toEqual(['Sum', 'k', ['Tuple', 'k', 1, 7]]);
  });

  test('Sum: a Tuple clause with a held index', () => {
    check(['Sum', 'k', ['Tuple', ['Hold', 'k'], 1, 'k']], { k: 7 }, ['k']);
  });

  test('Sum: a bound of a flat clause reads the outer index', () => {
    check(['Sum', 'k', 'k', 1, 'k'], { k: 7 }, ['k']);
    expect(raw(['Sum', 'k', 'k', 1, 'k']).subs({ k: 7 }).json).toEqual([
      'Sum',
      'k',
      'k',
      1,
      7,
    ]);
  });

  test('Product: a Tuple bound reads the outer index', () => {
    check(['Product', 'k', ['Tuple', 'k', 1, 'k']], { k: 7 }, ['k']);
  });

  test('Integrate: the variable of an indefinite Tuple clause is free', () => {
    check(['Integrate', 'x', ['Tuple', 'x']], { x: 2 }, ['x']);
    // The substitution is applied to the value of the integral at a point.
    expect(raw(['Integrate', 'x', ['Tuple', 'x']]).subs({ x: 2 }).json).toEqual(
      ['EvaluateAt', ['Function', ['Integrate', 'x', ['Tuple', 'x']], 'x'], 2]
    );
  });

  test('Integrate: the variable of an indefinite held clause is free', () => {
    check(['Integrate', 'x', ['Hold', 'x']], { x: 2 }, ['x']);
  });

  test('Integrate: a definite Tuple clause and a flat clause', () => {
    check(['Integrate', 'x', ['Tuple', 'x', 0, 'x']], { x: 2 }, ['x']);
    check(['Integrate', 'x', 'x', 0, 'x'], { x: 2 }, ['x']);
  });

  test('NDSolveFunction: the initial value is not a bound of a flat clause', () => {
    // `NDSolveFunction` reads operand 2 alone as its limits and operand 3
    // as its initial value, so the `x` of `x + 1` stays bound.
    check(['NDSolveFunction', 'x', 'y', 'x', ['Add', 'x', 1]], { x: 2 }, ['y']);
  });
});
