import { ComputeEngine } from '../../src/compute-engine';

// The free-variable walk (`unknowns`, `freeVariables`) and `subs()` read the
// names that a node binds with the same rules, so that `subs()` replaces
// exactly the occurrences that the walk reports as free. These tests pin
// those rules for the quantifiers, the set-builders and the locals of a
// `Block`, in the canonical and in the raw form.

const ce = new ComputeEngine();

const forms = ['canonical', 'raw'] as const;

describe('QUANTIFIER: THE FIRST OPERAND IS THE QUANTIFIED VARIABLE', () => {
  for (const form of forms) {
    test(`a bare symbol binds its name (${form})`, () => {
      for (const q of ['ForAll', 'Exists', 'NotExists', 'ExistsUnique']) {
        const e = ce.expr([q, 'x', ['Less', 'y', 'x']], { form });
        expect(e.unknowns).toEqual(['y']);
        expect(e.subs({ x: 3 }).json).toEqual(e.json);
      }
    });

    test(`an Element clause binds its symbol (${form})`, () => {
      const e = ce.expr(
        ['Exists', ['Element', 'x', 'S'], ['Less', 'y', 'x']],
        { form }
      );
      expect(e.unknowns).toEqual(['S', 'y']);
      expect(e.subs({ x: 3 }).json).toEqual(e.json);
    });

    // The first operand `y < x` is not a clause, so the node binds nothing.
    // The evaluator reads `Element(x, S)` as the body, a membership of the
    // free `x`.
    test(`an Element operand that is not the first binds nothing (${form})`, () => {
      const e = ce.expr(
        ['Exists', ['Less', 'y', 'x'], ['Element', 'x', 'S']],
        { form }
      );
      expect(e.unknowns).toEqual(['S', 'x', 'y']);
      expect(e.subs({ x: 3 }).json).toEqual([
        'Exists',
        ['Less', 'y', 3],
        ['Element', 3, 'S'],
      ]);
    });
  }

  test('the parsed quantifier binds its variable', () => {
    expect(ce.parse('\\forall x, x > y').unknowns).toEqual(['y']);
    expect(ce.parse('\\exists x \\in S, y < x').unknowns).toEqual(['S', 'y']);
  });

  test('a raw Loop binds its index', () => {
    const e = ce.expr(
      ['Loop', ['Add', 'x', 'k'], ['Element', 'k', ['Range', 1, 3]]],
      { form: 'raw' }
    );
    expect(e.unknowns).toEqual(['x']);
    expect(e.subs({ k: 9 }).json).toEqual(e.json);
  });
});

describe('SET-BUILDER: ITS VARIABLES ARE BOUND IN BOTH OPERANDS', () => {
  test('the membership of the condition names the variable of the body', () => {
    const e = ce.parse('\\{x^2 \\mid x \\in S\\}');
    expect(e.json).toEqual([
      'Set',
      ['Power', 'x', 2],
      ['Condition', ['Element', 'x', 'S']],
    ]);
    expect(e.unknowns).toEqual(['S']);
    expect(e.subs({ x: 3 }).json).toEqual(e.json);
  });

  test('a symbol body is the variable', () => {
    const e = ce.parse('\\{x \\mid x > a\\}');
    expect(e.unknowns).toEqual(['a']);
    expect(e.subs({ x: 3, a: 1 }).json).toEqual([
      'Set',
      'x',
      ['Condition', ['Greater', 'x', 1]],
    ]);
  });

  test('a membership body names the variable', () => {
    const e = ce.parse('\\{x \\in S \\mid x > a\\}');
    expect(e.unknowns).toEqual(['S', 'a']);
    expect(e.subs({ x: 3 }).json).toEqual(e.json);
  });

  test('each membership of a conjunction that the body reads is a variable', () => {
    const e = ce.expr([
      'Set',
      ['Add', 'x', 'y'],
      ['Condition', ['And', ['Element', 'x', 'S'], ['Element', 'y', 'S']]],
    ]);
    expect(e.unknowns).toEqual(['S']);
    expect(e.subs({ x: 3, y: 4 }).json).toEqual(e.json);
  });

  // `a` is not read by the body: `a ∈ T` is a side condition on the `a` of
  // the enclosing scope.
  test('a membership that the body does not read stays free', () => {
    const e = ce.expr([
      'Set',
      ['Multiply', 2, 'k'],
      ['Condition', ['And', ['Element', 'k', 'S'], ['Element', 'a', 'T']]],
    ]);
    expect(e.unknowns).toEqual(['S', 'T', 'a']);
    expect(e.subs({ a: 5 }).json).toEqual([
      'Set',
      ['Multiply', 2, 'k'],
      ['Condition', ['And', ['Element', 'k', 'S'], ['Element', 5, 'T']]],
    ]);
  });

  for (const form of forms) {
    test(`the Element spelling of the big operators binds its symbol (${form})`, () => {
      const e = ce.expr(['Set', ['Square', 'x'], ['Element', 'x', 'S']], {
        form,
      });
      expect(e.unknowns).toEqual(['S']);
      expect(e.subs({ x: 3 }).json).toEqual(e.json);
    });
  }

  // The body does not read `x`: this is the literal set of two elements.
  test('a literal set binds nothing', () => {
    const e = ce.expr(['Set', 'y', ['Element', 'x', 'S']]);
    expect(e.unknowns).toEqual(['S', 'x', 'y']);
    expect(e.subs({ x: 3 }).json).toEqual(['Set', 'y', ['Element', 3, 'S']]);
    expect(ce.expr(['Set', 'x', 'y']).subs({ x: 3 }).json).toEqual([
      'Set',
      3,
      'y',
    ]);
  });

  // The evaluator reads the domain `S` of `Element(v, S)` in the enclosing
  // scope, before it gives `v` the values of `S`.
  for (const form of forms) {
    test(`the domain of the membership reads the enclosing name (${form})`, () => {
      const e = ce.expr(
        ['Set', ['Square', 'x'], ['Element', 'x', ['Range', 1, 'x']]],
        { form }
      );
      expect(e.unknowns).toEqual(['x']);
      const s = e.subs({ x: 3 }, { canonical: false });
      expect(s.ops![0].json).toEqual(e.ops![0].json);
      expect(s.ops![1].json).toEqual(['Element', 'x', ['Range', 1, 3]]);
    });
  }

  test('the domain of a membership of the condition reads the enclosing name', () => {
    const e = ce.expr([
      'Set',
      ['Multiply', 2, 'k'],
      ['Condition', ['And', ['Greater', 'k', 1], ['Element', 'k', ['Range', 1, 'k']]]],
    ]);
    expect(e.unknowns).toEqual(['k']);
    expect(e.subs({ k: 4 }).json).toEqual([
      'Set',
      ['Multiply', 2, 'k'],
      ['Condition', ['And', ['Greater', 'k', 1], ['Element', 'k', ['Range', 1, 4]]]],
    ]);
  });

  test('the domain of the membership of a symbol body reads the enclosing name', () => {
    const e = ce.expr([
      'Set',
      'x',
      ['Condition', ['Element', 'x', ['Range', 1, 'x']]],
    ]);
    expect(e.unknowns).toEqual(['x']);
    expect(e.subs({ x: 3 }).json).toEqual([
      'Set',
      'x',
      ['Condition', ['Element', 'x', ['Range', 1, 3]]],
    ]);
  });

  test('the domain of a membership body reads the enclosing name', () => {
    const e = ce.expr([
      'Set',
      ['Element', 'x', ['Range', 1, 'x']],
      ['Condition', ['Greater', 'x', 1]],
    ]);
    expect(e.unknowns).toEqual(['x']);
    expect(e.subs({ x: 3 }).json).toEqual([
      'Set',
      ['Element', 'x', ['Range', 1, 3]],
      ['Condition', ['Greater', 'x', 1]],
    ]);
  });

  test('two domains under one conjunction read the enclosing name', () => {
    const e = ce.expr([
      'Set',
      ['Add', 'x', 'y'],
      [
        'Condition',
        [
          'And',
          ['Element', 'x', ['Range', 1, 'x']],
          ['Element', 'y', ['Range', 1, 'x']],
        ],
      ],
    ]);
    expect(e.unknowns).toEqual(['x']);
    expect(e.subs({ x: 3, y: 4 }).json).toEqual([
      'Set',
      ['Add', 'x', 'y'],
      [
        'Condition',
        [
          'And',
          ['Element', 'x', ['Range', 1, 3]],
          ['Element', 'y', ['Range', 1, 3]],
        ],
      ],
    ]);
  });

  test('a structural set-builder stays structural', () => {
    const e = ce.expr(
      ['Set', ['Square', 'x'], ['Element', 'x', ['Range', 1, 'x']]],
      { form: 'structural' }
    );
    const s = e.subs({ x: 3 });
    expect(s.isStructural).toBe(true);
    expect(s.ops![1].json).toEqual(['Element', 'x', ['Range', 1, 3]]);
  });

  test('a substitution of a bound name only returns the same node', () => {
    const e = ce.expr(['Set', ['Square', 'x'], ['Element', 'x', 'S']]);
    expect(e.subs({ x: 3 })).toBe(e);
  });

  test('a substituted domain gives the value of the assigned name', () => {
    const e = ce.expr(['Set', ['Square', 'x'], ['Element', 'x', ['Range', 1, 'x']]]);
    expect(e.subs({ x: 3 }).evaluate().json).toEqual(['Set', 1, 4, 9]);
  });

  // A function literal in the body keeps its own parameters.
  test('a function literal body keeps its parameters bound', () => {
    const e = ce.expr([
      'Set',
      ['Function', ['Add', 't', 'x'], 't'],
      ['Condition', ['Element', 'x', 'S']],
    ]);
    expect(e.unknowns).toEqual(['S']);
  });

  test('the membership of a substituted set-builder still evaluates', () => {
    const e = ce.parse('\\{x^2 \\mid x \\in \\{1, 2, 3\\}\\}');
    expect(e.subs({ x: 5 }).json).toEqual(e.json);
    expect(ce.expr(['Element', 4, e]).evaluate().json).toEqual('True');
  });
});

describe('BLOCK: subs() READS THE LOCALS AS THE FREE-VARIABLE WALK DOES', () => {
  test('each leaf of a destructuring target is a local', () => {
    const e = ce.expr([
      'Block',
      ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 1, 2]],
      ['Add', 'a', 'b'],
    ]);
    expect(e.unknowns).toEqual([]);
    expect(e.subs({ a: 5 }).evaluate().json).toEqual(3);
  });
});

describe('RAW SUM: THE UPPER BOUND READS THE ENCLOSING NAME', () => {
  test('the index in the upper bound is free', () => {
    const e = ce.expr(['Sum', ['Multiply', 'j', 'k'], ['Limits', 'k', 1, 'k']], {
      form: 'raw',
    });
    expect(e.unknowns).toEqual(['j', 'k']);
  });
});
