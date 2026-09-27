import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

//
// A guarded `Element` clause in `Comprehension` and `Loop`:
//
//   ["Comprehension", body, ["Element", x, xs, cond]]
//
// The third operand is the guard, the same three-operand indexing set `Sum`
// and `Product` take. An element is visited only when the guard evaluates to
// `True` with the index bound to it. The Epsil comprehension
// `[body for x in xs if cond]` lowers to this form.
//

const ce = new ComputeEngine();

const oddSquares = [
  'Comprehension',
  ['Square', 'x'],
  ['Element', 'x', ['Range', 1, 10], ['Equal', ['Mod', 'x', 2], 1]],
] as const;

describe('COMPREHENSION GUARD — interpreter', () => {
  test('the guard filters the elements', () => {
    expect(ce.box(oddSquares).evaluate().toString()).toBe('[1,9,25,49,81]');
  });

  test('the guard is canonicalized in the loop scope', () => {
    const json = ce.box(oddSquares).json as unknown[];
    expect(json[0]).toBe('Comprehension');
    expect((json[2] as unknown[]).length).toBe(4);
  });

  test('count and finiteness are read through the guard', () => {
    const comp = ce.box(oddSquares);
    expect(comp.count).toBe(5);
    expect(comp.isFiniteCollection).toBe(true);
    expect(comp.isEmptyCollection).toBe(false);
  });

  test('a guard on each clause of a dependent comprehension', () => {
    const comp = ce.box([
      'Comprehension',
      ['Tuple', 'x', 'y'],
      ['Element', 'x', ['Range', 1, 4], ['Greater', 'x', 2]],
      ['Element', 'y', ['Range', 1, 'x'], ['Equal', ['Mod', 'y', 2], 0]],
    ]);
    expect(comp.evaluate().toString()).toBe('[(3, 2),(4, 2),(4, 4)]');
    expect(comp.count).toBe(3);
  });

  test('an undecided guard excludes the element', () => {
    const comp = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Range', 1, 3], ['Greater', 'x', 'a']],
    ]);
    expect(comp.evaluate().toString()).toBe('[]');
    expect(comp.count).toBe(0);
  });

  test('a guarded Loop visits the accepted elements only', () => {
    const loop = ce.box([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      [
        'Loop',
        ['Block', ['Assign', 's', ['Add', 's', 'k']]],
        ['Element', 'k', ['Range', 1, 10], ['Greater', 'k', 7]],
      ],
      's',
    ]);
    expect(loop.evaluate().toString()).toBe('27');
  });
});

describe('COMPREHENSION GUARD — LaTeX', () => {
  test('a guarded comprehension serializes in a form that re-parses', () => {
    const comp = ce.box(oddSquares);
    const latex = comp.latex;
    expect(latex).toContain('\\operatorname{Comprehension}');
    expect(latex).toContain('\\operatorname{Element}');
    const back = ce.parse(latex);
    expect(back.json).toEqual(comp.json);
    expect(back.evaluate().toString()).toBe('[1,9,25,49,81]');
  });

  test('an unguarded comprehension keeps the `for` spelling', () => {
    const comp = ce.box([
      'Comprehension',
      ['Square', 'x'],
      ['Element', 'x', ['Range', 1, 3]],
    ]);
    expect(comp.latex).toContain('\\operatorname{for}');
  });
});

describe('COMPREHENSION GUARD — compiled', () => {
  test('JavaScript: the guard wraps the body', () => {
    const result = compile(ce.box(oddSquares));
    expect(result.success).toBe(true);
    expect(result.run!()).toEqual([1, 9, 25, 49, 81]);
  });

  test('JavaScript: a guard with a free parameter', () => {
    const engine = new ComputeEngine();
    engine.declare('n', 'integer');
    const result = compile(
      engine.box([
        'Comprehension',
        ['Square', 'x'],
        ['Element', 'x', ['Range', 1, 'n'], ['Equal', ['Mod', 'x', 2], 1]],
      ])
    );
    expect(result.success).toBe(true);
    expect(result.run!({ n: 6 })).toEqual([1, 9, 25]);
  });

  test('JavaScript: a guarded Loop takes the general loop path', () => {
    const result = compile(
      ce.box([
        'Block',
        ['Declare', 's'],
        ['Assign', 's', 0],
        [
          'Loop',
          ['Block', ['Assign', 's', ['Add', 's', 'k']]],
          ['Element', 'k', ['Range', 1, 10], ['Greater', 'k', 7]],
        ],
        's',
      ])
    );
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(27);
  });

  test('Python: the guard is the `if` of the comprehension clause', () => {
    const engine = new ComputeEngine();
    engine.declare('n', 'integer');
    const python = new PythonTarget();
    const code = python.compileFunction(
      engine.box([
        'Comprehension',
        ['Square', 'x'],
        ['Element', 'x', ['Range', 1, 'n'], ['Equal', ['Mod', 'x', 2], 1]],
      ]),
      'fn',
      ['n'],
      undefined,
      {}
    );
    // The guard is the decided-true test of the three-valued condition
    // lowering, not a bare truthiness test.
    expect(code).toMatch(/\[x \*\* 2 for x in .* if .*np\.mod\(x, 2\).*\]/);
  });

  test('Python: a guarded Loop statement declines', () => {
    const python = new PythonTarget();
    expect(() =>
      python.compileFunction(
        ce.box([
          'Loop',
          ['Block', ['Assign', 's', ['Add', 's', 'k']]],
          ['Element', 'k', ['Range', 1, 10], ['Greater', 'k', 7]],
        ]),
        'fn',
        [],
        undefined,
        {}
      )
    ).toThrow(/guarded/);
  });
});

describe('COMPREHENSION GUARD — infinite and undecidable domains', () => {
  const evens = [
    'Comprehension',
    'x',
    [
      'Element',
      'x',
      ['Range', 1, 'PositiveInfinity'],
      ['Equal', ['Mod', 'x', 2], 0],
    ],
  ] as const;

  test('count and finiteness are unknown over an infinite domain', () => {
    const comp = ce.box(evens);
    expect(comp.count).toBeUndefined();
    expect(comp.isFiniteCollection).toBeUndefined();
    // The first accepted element decides emptiness, as it does for `Filter`.
    expect(comp.isEmptyCollection).toBe(false);
  });

  test('Take over an infinite guarded comprehension materializes', () => {
    expect(ce.box(['Take', evens, 3]).evaluate().toString()).toBe('[2,4,6]');
    expect(ce.box(['At', evens, 3]).evaluate().toString()).toBe('6');
  });

  test('a guard that never accepts stops at the iteration limit', () => {
    const never = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Range', 1, 'PositiveInfinity'], ['Less', 'x', 0]],
    ]);
    expect(never.isEmptyCollection).toBeUndefined();
    expect(ce.box(['Take', never, 3]).evaluate().operator).toBe('Take');
    expect(() => [...never.each()]).toThrow();
  });

  test('a domain that cannot be enumerated leaves everything unknown', () => {
    const comp = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Coalesce', 'xs', ['List']], ['Greater', 'x', 0]],
    ]);
    expect(comp.count).toBeUndefined();
    expect(comp.isEmptyCollection).toBeUndefined();
    expect(comp.evaluate().operator).toBe('Comprehension');
  });
});

describe('COMPREHENSION GUARD — decided-true semantics and clause scope', () => {
  // The interpreter keeps an element only when the guard evaluates to the
  // symbol `True`. A non-boolean guard keeps nothing, and the compiled routes
  // must agree: JavaScript truthiness would keep every positive integer.
  test('a non-boolean guard keeps nothing, interpreted and compiled', () => {
    const engine = new ComputeEngine();
    engine.declare('n', 'integer');
    const comp = engine.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Range', 1, 'n'], 'x'],
    ]);
    const js = compile(comp);
    expect(js.success).toBe(true);
    expect(js.run!({ n: 3 })).toEqual([]);
    const py = new PythonTarget().compileFunction(
      comp,
      'fn',
      ['n'],
      undefined,
      {}
    );
    // Not a bare `if x`: the value is tested for a decided boolean.
    expect(py).not.toMatch(/ if x\]/);
    expect(py).toContain('isinstance(x, (bool, np.bool_))');
    engine.assign('n', 3);
    expect(comp.evaluate().toString()).toBe('[]');
  });

  // A guard reads the bindings of its own clause and the clauses BEFORE it;
  // a name bound by a later clause is the ENCLOSING variable of that name.
  // The node's free variables say so (`boundVariableNamesInOperand`), so the
  // compiled routes neither fold the node nor bind the name to the later
  // loop: the guard reads the parameter.
  test('a guard naming a later clause variable reads the enclosing one', () => {
    const engine = new ComputeEngine();
    engine.declare('y', 'integer');
    const comp = engine.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Range', 1, 3], ['Less', 'x', 'y']],
      ['Element', 'y', ['Range', 1, 2]],
    ]);
    expect(comp.unknowns).toEqual(['y']);
    const js = compile(comp, { fallback: false });
    expect(js.success).toBe(true);
    expect(js.run!({ y: 2 })).toEqual([1, 1]);
    expect(js.run!({ y: 3 })).toEqual([1, 1, 2, 2]);
    // A Python comprehension is one scope, where `y` would be the later
    // loop's unassigned local: the Python route declines the shape.
    expect(() =>
      new PythonTarget().compileFunction(comp, 'fn', ['y'], undefined, {})
    ).toThrow(/later clause binds/);
    engine.assign('y', 2);
    expect(comp.evaluate().toString()).toBe('[1,1]');
  });

  test('LaTeX: a block body of a guarded comprehension is fenced', () => {
    const comp = ce.box([
      'Comprehension',
      [
        'Block',
        ['Declare', 't'],
        ['Assign', 't', ['Square', 'x']],
        ['Add', 't', 1],
      ],
      ['Element', 'x', ['Range', 1, 4], ['Greater', 'x', 2]],
    ]);
    const back = ce.parse(comp.latex);
    expect(back.json).toEqual(comp.json);
    expect(back.evaluate().toString()).toBe('[10,17]');
  });
});
