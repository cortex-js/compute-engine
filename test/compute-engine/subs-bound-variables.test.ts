import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// `subs()` replaces only the FREE occurrences of a name. A name that a
// binder binds (a `Sum` or `Comprehension` index, a `Function` parameter, a
// `Block` local) keeps denoting the binder's own binding where the binder
// binds it. Before this was fixed, the substitution reached the binding site
// too: the index of a `Sum` became an `Error`, and a list replaced the index
// of a `Comprehension` (Tycho ledger row 464).

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.box>[0];

function subs(
  json: Json,
  map: Record<string, Json>,
  form?: 'raw' | 'structural'
): Expression {
  const expr = ce.box(json, form ? { form } : undefined);
  const boxed: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(map)) boxed[k] = ce.box(v);
  return expr.subs(boxed);
}

describe('SUBS LEAVES A BOUND VARIABLE AND ITS BINDER UNCHANGED', () => {
  test('the index of a Comprehension', () => {
    const json: Json = [
      'Comprehension',
      ['Add', 'j', 1],
      ['Element', 'j', ['Range', 0, 2]],
    ];
    const result = subs(json, { j: ['List', 4, 4, 5] });
    expect(result.json).toEqual(json);
    // The value is a lazy collection, so it is compared by its elements.
    expect(result.evaluate().toString()).toBe('[1,2,3]');
  });

  test('the index of a Sum', () => {
    const json: Json = ['Sum', 'j', ['Limits', 'j', 1, 3]];
    const result = subs(json, { j: ['List', 4, 5] });
    expect(result.json).toEqual(json);
    expect(result.isValid).toBe(true);
    expect(result.evaluate().json).toEqual(6);
  });

  test('the parameter of a Function literal', () => {
    const result = subs(['Function', ['Add', 'j', 1], 'j'], { j: 7 });
    expect(result.json).toEqual(['Function', ['Block', ['Add', 'j', 1]], 'j']);
    expect(result.isValid).toBe(true);
  });

  test('a local of a Block, declared or assigned', () => {
    const declared: Json = [
      'Block',
      ['Declare', 'j', 'integer'],
      ['Assign', 'j', 2],
      ['Add', 'j', 1],
    ];
    const r1 = subs(declared, { j: 7 });
    expect(r1.json).toEqual(declared);
    expect(r1.evaluate().json).toEqual(3);

    const assigned: Json = ['Block', ['Assign', 'q', 2], ['Add', 'q', 1]];
    const r2 = subs(assigned, { q: 5 });
    expect(r2.json).toEqual(assigned);
    expect(r2.evaluate().json).toEqual(3);
  });

  test('a free symbol read in a Block is still replaced', () => {
    const result = subs(
      ['Block', ['Assign', 't', ['Add', 'k', 1]], ['Multiply', 2, 't']],
      { k: 3 }
    );
    expect(result.evaluate().json).toEqual(8);
  });

  test('the variable of a definite Integrate', () => {
    const integral = subs(
      ['Integrate', ['Multiply', 'a', 'x'], ['Limits', 'x', 0, 1]],
      { x: 3, a: 2 }
    );
    expect(integral.evaluate().json).toEqual(1);
  });

  test('a coefficient of an integrand that lists it as a parameter', () => {
    // The parameter list of an integrand is not read: `a` is free, as the
    // free-variable walk reports it.
    const json: Json = [
      'Integrate',
      ['Function', ['Multiply', 'a', 'x'], 'x', 'a'],
      ['Limits', 'x', 0, 1],
    ];
    expect(ce.box(json).freeVariables).toEqual(['a']);
    expect(subs(json, { a: 2 }).evaluate().json).toEqual(1);
  });
});

describe('SUBS REPLACES THE VARIABLE OF AN INDEFINITE INTEGRAL', () => {
  // The value of an indefinite integral is a function of its variable
  // (`∫ a·x dx = a·x²/2`), as the value of `D(f, x)` is, so the variable is
  // free and is replaced. The result is not an antiderivative in `x`.
  test('Integrate(a·x, x)', () => {
    const expr = ce.box(['Integrate', ['Multiply', 'a', 'x'], 'x']);
    expect(expr.freeVariables).toEqual(['a', 'x']);
    const result = subs(['Integrate', ['Multiply', 'a', 'x'], 'x'], {
      x: 3,
    });
    expect(result.isValid).toBe(false);
    // The body of the integrand (its parameter list is kept as written).
    expect(JSON.stringify(result.op1.op1.json)).not.toMatch(/"x"/);
  });

  test('Integrate(a·x, x) with only the coefficient replaced', () => {
    const result = subs(['Integrate', ['Multiply', 'a', 'x'], 'x'], {
      a: 2,
    });
    expect(result.evaluate().isSame(ce.parse('x^2'))).toBe(true);
  });
});

describe('SUBS REPLACES A NAME THAT A NON-BINDER READS IN A CLAUSE', () => {
  // `Element` and `Limits` bind their symbol only in an operand of a binder
  // (`Sum`, `Integrate`, a quantifier, …), and `Assign` declares a local only
  // in a `Block`. In the other nodes the name is the name of the enclosing
  // scope, so it is free and is replaced.
  test('x ∈ ℤ ∧ x > 0', () => {
    const expr = ce.parse('x \\in \\Z \\land x > 0');
    expect(expr.freeVariables).toEqual(['x']);
    expect(expr.subs({ x: 3 }).evaluate().json).toEqual('True');
  });

  test('Which(x ∈ ℤ, 1, True, 0)', () => {
    const json: Json = ['Which', ['Element', 'x', 'Integers'], 1, 'True', 0];
    expect(ce.box(json).freeVariables).toEqual(['x']);
    expect(subs(json, { x: 3 }).evaluate().json).toEqual(1);
    expect(subs(json, { x: 0.5 }).evaluate().json).toEqual(0);
  });

  test('If(x ∈ ℤ, x + 1, 0)', () => {
    const json: Json = [
      'If',
      ['Element', 'x', 'Integers'],
      ['Add', 'x', 1],
      0,
    ];
    expect(ce.box(json).freeVariables).toEqual(['x']);
    expect(subs(json, { x: 3 }).evaluate().json).toEqual(4);
  });

  test('Boole(x ∈ ℤ) + x', () => {
    const json: Json = ['Add', ['Boole', ['Element', 'x', 'Integers']], 'x'];
    expect(ce.box(json).freeVariables).toEqual(['x']);
    const result = subs(json, { x: 3 });
    expect(JSON.stringify(result.json)).not.toMatch(/"x"/);
    expect(result.evaluate().json).toEqual(4);
  });

  test('If(z > 0, Assign(z, 5), Assign(z, 6))', () => {
    const json: Json = [
      'If',
      ['Greater', 'z', 0],
      ['Assign', 'z', 5],
      ['Assign', 'z', 6],
    ];
    expect(ce.box(json).freeVariables).toEqual(['z']);
    const result = subs(json, { z: 7 });
    expect(JSON.stringify(result.op1.json)).not.toMatch(/"z"/);
  });

  test('a quantifier still binds the symbol of its Element clause', () => {
    const json: Json = [
      'ForAll',
      ['Element', 'x', ['Set', 1, 2]],
      ['Greater', 'x', 'y'],
    ];
    expect(ce.box(json).freeVariables).toEqual(['y']);
    expect(subs(json, { x: 3, y: 0 }).evaluate().json).toEqual('True');
    expect(subs(json, { x: 3, y: 1 }).evaluate().json).toEqual('False');
    const raw = ce.box(json, { form: 'raw' });
    expect(raw.freeVariables).toEqual(['y']);
    expect(JSON.stringify(raw.subs({ x: ce.box(3) }).json)).not.toContain(
      '3'
    );
  });
});

describe('SUBS ON A SET-BUILDER', () => {
  test('{n ∈ ℕ | n > 1} binds n', () => {
    const expr = ce.parse('\\{n \\in \\N \\mid n > 1\\}');
    expect(expr.freeVariables).toEqual([]);
    expect(expr.subs({ n: ce.box(3) }).isSame(expr)).toBe(true);
  });

  test('the n of the tuple (m, n ∈ S) is free', () => {
    const expr = ce.box(['Tuple', 'm', ['Element', 'n', 'Integers']]);
    expect(expr.freeVariables).toEqual(['m', 'n']);
  });
});

describe('SUBS WITH A RAW RESULT', () => {
  test('the clause of a canonical Sum is rebuilt raw', () => {
    const expr = ce.box(['Sum', ['Add', 'j', 'k'], ['Limits', 'j', 1, 'k']]);
    const result = expr.subs({ k: ce.box(2) }, { canonical: false });
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'j', 2],
      ['Limits', 'j', 1, 2],
    ]);
    expect(result.isCanonical).toBe(false);
    expect(result.ops![1].isCanonical).toBe(false);
  });
});

describe('SUBS REPLACES THE FREE OCCURRENCES NEXT TO A BINDER', () => {
  test('a free j beside a Sum over j', () => {
    const result = subs(['Add', 'j', ['Sum', 'j', ['Limits', 'j', 1, 3]]], {
      j: 10,
    });
    expect(
      result.isSame(ce.box(['Add', 10, ['Sum', 'j', ['Limits', 'j', 1, 3]]]))
    ).toBe(true);
    expect(result.evaluate().json).toEqual(16);
  });

  test('a free j beside a Sum over j, replaced by a list', () => {
    const result = subs(['Add', 'j', ['Sum', 'j', ['Limits', 'j', 1, 3]]], {
      j: ['List', 4, 4, 5],
    });
    expect(result.evaluate().json).toEqual(['List', 10, 10, 11]);
  });

  test('the parse route: j + sum over j', () => {
    const result = ce.parse('j+\\sum_{j=1}^{3} j').subs({ j: 10 });
    expect(result.evaluate().json).toEqual(16);
  });

  test('a name both bound and free in one list: [j[1], [j for j in [0, 1]]]', () => {
    const result = subs(
      [
        'List',
        ['At', 'j', 1],
        ['Comprehension', 'j', ['Element', 'j', ['List', 0, 1]]],
      ],
      { j: ['List', 7, 8] }
    );
    expect(result.json).toEqual([
      'List',
      ['At', ['List', 7, 8], 1],
      ['Comprehension', 'j', ['Element', 'j', ['List', 0, 1]]],
    ]);
    expect(result.evaluate().json).toEqual(['List', 7, ['List', 0, 1]]);
  });

  test('a binder that binds another name: Sum(j·k, k) with j = 2', () => {
    const result = subs(
      ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'k', 1, 3]],
      {
        j: 2,
      }
    );
    expect(result.json).toEqual([
      'Sum',
      ['Multiply', 2, 'k'],
      ['Limits', 'k', 1, 3],
    ]);
    expect(result.evaluate().json).toEqual(12);
  });

  test('the bound of a Limits clause reads the enclosing binding', () => {
    const result = subs(['Sum', 'j', ['Limits', 'j', 1, 'j']], { j: 4 });
    expect(result.json).toEqual(['Sum', 'j', ['Limits', 'j', 1, 4]]);
    expect(result.evaluate().json).toEqual(10);
  });

  test('an earlier clause reads the enclosing binding of a later index', () => {
    const result = subs(
      [
        'Comprehension',
        ['Add', 'i', 'j'],
        ['Element', 'i', ['List', 'j', ['Add', 'j', 1]]],
        ['Element', 'j', ['List', 10, 20]],
      ],
      { j: 100 }
    );
    expect(result.json).toEqual([
      'Comprehension',
      ['Add', 'i', 'j'],
      ['Element', 'i', ['List', 100, 101]],
      ['Element', 'j', ['List', 10, 20]],
    ]);
  });

  test('nested binders', () => {
    const result = subs(
      [
        'Sum',
        ['Sum', ['Multiply', 'i', 'j', 'x'], ['Limits', 'j', 1, 'i']],
        ['Limits', 'i', 1, 3],
      ],
      { i: 9, j: 9, x: 2 }
    );
    expect(result.json).toEqual([
      'Sum',
      ['Sum', ['Multiply', 2, 'i', 'j'], ['Limits', 'j', 1, 'i']],
      ['Limits', 'i', 1, 3],
    ]);
    // 2 · Σ_{i=1}^{3} i · i(i+1)/2 = 1 + 6 + 18, times 2
    expect(result.evaluate().json).toEqual(50);
  });

  test('an inner binder shadows a name that is free in the outer one', () => {
    const result = subs(
      ['Function', ['Add', 'x', ['Sum', 'x', ['Limits', 'x', 1, 3]]], 'y'],
      { x: 5 }
    );
    expect(result.json).toEqual([
      'Function',
      ['Block', ['Add', ['Sum', 'x', ['Limits', 'x', 1, 3]], 5]],
      'y',
    ]);
  });
});

describe('SUBS ON A RAW OR STRUCTURAL BINDER', () => {
  for (const form of ['raw', 'structural'] as const) {
    test(`${form}: the index is kept, the free name is replaced`, () => {
      const json: Json = [
        'Add',
        'k',
        ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'k', 1, 'k']],
      ];
      const result = subs(json, { j: 2, k: 5 }, form);
      // A raw node has no operator definition, so the free-variable walk
      // reads its `Limits` clause by its spelling, with the index bound in the
      // whole clause: the upper bound `k` is not free there, and `subs()`
      // follows the walk. A structural node is bound to the definition of
      // `Sum`, whose bounds read the enclosing `k`.
      const bound = form === 'raw' ? 'k' : 5;
      expect(result.json).toEqual([
        'Add',
        5,
        ['Sum', ['Multiply', 2, 'k'], ['Limits', 'k', 1, bound]],
      ]);
      expect(
        ce.box(json[2] as Json, { form }).freeVariables.includes('k')
      ).toBe(form !== 'raw');
    });

    test(`${form}: a Function parameter and a Block local are kept`, () => {
      expect(
        subs(['Function', ['Add', 'x', 'w'], 'x'], { x: 5, w: 1 }, form).json
      ).toEqual(['Function', ['Add', 'x', 1], 'x']);
      expect(
        subs(
          ['Block', ['Assign', 'q', 2], ['Add', 'q', 'w']],
          { q: 5, w: 1 },
          form
        ).json
      ).toEqual(['Block', ['Assign', 'q', 2], ['Add', 'q', 1]]);
    });
  }

  test('a wildcard index of a rule pattern is still replaced', () => {
    const pattern = ce.box(['Sum', '_f', ['Limits', '_k', 1, 3]], {
      form: 'raw',
    });
    expect(
      pattern.subs({ _k: ce.symbol('n'), _f: ce.symbol('n') }).json
    ).toEqual(['Sum', 'n', ['Limits', 'n', 1, 3]]);
  });
});

describe('SUBS DOES NOT AVOID VARIABLE CAPTURE', () => {
  // A replacement that holds a name the binder binds is inserted as it is: the
  // index is not renamed. This is the documented behavior of `subs()`.
  test('Sum(j + k, k) with j replaced by k', () => {
    const result = subs(['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]], {
      j: 'k',
    });
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'k', 'k'],
      ['Limits', 'k', 1, 3],
    ]);
    expect(result.evaluate().json).toEqual(12);
  });

  test('renaming the index first with a recursive replace() avoids it', () => {
    const sum = ce.box(['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]]);
    const renamed = sum.replace(
      { match: ce.symbol('k'), replace: ce.symbol('m') },
      { recursive: true }
    )!;
    const result = renamed.subs({ j: ce.symbol('k') });
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'k', 'm'],
      ['Limits', 'm', 1, 3],
    ]);
    expect(result.evaluate().toString()).toBe('3k + 6');
  });
});

describe('SUBS REPLACES EXACTLY THE NAMES THAT freeVariables REPORTS FREE', () => {
  // For each expression and each name written in it, `subs()` of that name by
  // a fresh symbol leaves the expression unchanged exactly when the
  // free-variable walk does not report the name free.
  const names = (json: unknown, out = new Set<string>()): Set<string> => {
    if (typeof json === 'string' && /^[a-z]$/.test(json)) out.add(json);
    else if (Array.isArray(json)) for (const x of json) names(x, out);
    return out;
  };
  const cases: Json[] = [
    ['D', ['Power', 'x', 2], 'x'],
    ['D', ['Multiply', 'a', ['Power', 'x', 2]], 'x'],
    ['Series', ['Sin', ['Multiply', 'a', 'x']], 'x', 0, 3],
    ['Integrate', ['Multiply', 'a', 'x'], 'x'],
    ['Integrate', ['Multiply', 'a', 'x'], ['Limits', 'x', 0, 'b']],
    ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'k', 1, 'n']],
    ['Add', 'k', ['Sum', 'k', ['Limits', 'k', 1, 'k']]],
    ['Product', ['Add', 'k', 'c'], ['Limits', 'k', 1, 3]],
    ['Comprehension', ['Add', 'j', 'k'], ['Element', 'k', ['Range', 0, 'n']]],
    [
      'Comprehension',
      ['Add', 'i', 'j'],
      ['Element', 'i', ['List', 'j', 1]],
      ['Element', 'j', ['List', 10, 20]],
    ],
    ['Loop', ['Add', 'j', 'k'], ['Element', 'k', ['Range', 0, 2]]],
    ['Function', ['Add', 'x', 'w'], 'x'],
    ['Block', ['Assign', 'q', 2], ['Add', 'q', 'w']],
    ['ForAll', ['Less', 'y', 'x'], ['Element', 'x', 'Integers']],
    ['And', ['Element', 'x', 'Integers'], ['Greater', 'x', 0]],
    ['Which', ['Element', 'x', 'Integers'], 1, 'True', 0],
    ['If', ['Element', 'x', 'Integers'], ['Add', 'x', 1], 0],
    ['Add', ['Boole', ['Element', 'x', 'Integers']], 'x'],
    ['If', ['Greater', 'z', 0], ['Assign', 'z', 5], ['Assign', 'z', 6]],
    [
      'Integrate',
      ['Function', ['Multiply', 'a', 'x'], 'x', 'a'],
      ['Limits', 'x', 0, 1],
    ],
    ['Integrate', ['Multiply', 'a', 'x'], ['Limits', 'x', 'Nothing', 'Nothing']],
    ['Set', ['Element', 'n', 'Integers'], ['Condition', ['Greater', 'n', 'c']]],
  ];
  for (const json of cases) {
    test(JSON.stringify(json), () => {
      const expr = ce.box(json);
      const free = new Set(expr.freeVariables);
      const fresh = ce.symbol('Fresh_Name');
      for (const n of names(json)) {
        const replaced = JSON.stringify(
          expr.subs({ [n]: fresh }).json
        ).includes('Fresh_Name');
        expect([n, replaced]).toEqual([n, free.has(n)]);
      }
    });
  }
});
