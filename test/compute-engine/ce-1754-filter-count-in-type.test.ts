/**
 * CE-1754: the type of a formula does not count a `Filter` by a function
 * literal. In a type computation (`static-typing-view.ts`) a parameter of a
 * function literal has no value, so a predicate there does not judge the
 * element. The norm of `Range(1, Length(P))` was 1 instead of 2√310, or its
 * type threw `Filter predicate must return "True" or "False"`:
 * - the value of a variable `P := Filter(L, k ↦ …)` was read in the type
 *   computation, because its operand is a function literal;
 * - the `Filter` was walked there;
 * - the element memo kept that walk, and the evaluation served it.
 */
import {
  ComputeEngine,
  createDocumentEnvironment,
  type DocumentSyntax,
} from '../../src/compute-engine';
import { withStaticTypingView } from '../../src/compute-engine/static-typing-view';

type Json = Parameters<DocumentSyntax['normalize']>[0];

describe('a Document row reads the count of a filtered row', () => {
  const ce = new ComputeEngine();
  const environment = createDocumentEnvironment(ce, () => {
    ce.declare('Keep', {
      signature: '(real) -> boolean',
      pure: true,
      evaluate: ([x]) => (x.re < 30.5 ? ce.True : ce.False),
    });
  });
  const imports = environment.createImports((input) => {
    input('w', 'real');
  });
  const rows: Record<string, Json> = {
    L: ['Map', ['Function', ['Multiply', 2, 'k'], 'k'], ['Range', 1, 40]],
    P: ['Filter', 'L', ['Function', ['Keep', 'k'], 'k']],
    c: ['Norm', ['Range', 1, ['Length', 'P']]],
    d: [
      'Add',
      ['Norm', ['Range', 1, ['Length', 'P']]],
      ['Length', ['Range', 1, ['Length', 'P']]],
    ],
  };
  const revision = imports.prepare(
    Object.keys(rows).map((id) => ({ id, latex: id })),
    {
      split: (source) =>
        source in rows ? { head: source, body: '' } : undefined,
      recognize: (row) => ({
        role: 'value',
        head: { name: row.id, params: [] },
        bodyJson: rows[row.id],
      }),
      normalize: (raw) => raw,
      fieldAxes: new Set(),
    }
  );
  afterAll(() => {
    revision.dispose();
    imports.dispose();
    environment.dispose();
  });
  const evaluateRow = (id: string): string => {
    ce.pushScope(revision.scope);
    try {
      const e = ce.box(id);
      // The type is computed first, as a host does.
      void e.type.toString();
      return e.evaluate().toString();
    } finally {
      ce.popScope();
    }
  };

  test('the norm of the range has the count of the filter', () => {
    expect(evaluateRow('c')).toBe('2sqrt(310)');
  });

  test('a sum with the norm and the length', () => {
    expect(evaluateRow('d')).toBe('15 + 2sqrt(310)');
  });
});

describe('the type of a formula over a filtered value', () => {
  test('a variable that holds a Filter', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['Map', ['Function', 'k', 'k'], ['Range', 1, 4]]));
    ce.assign(
      'P',
      ce.box(['Filter', 'L', ['Function', ['Less', 'k', 2.5], 'k']])
    );
    const e = ce.box(['Norm', ['Range', 1, ['Length', 'P']]]);
    expect(e.type.toString()).toBe('+oo | nan | real');
    expect(e.evaluate().toString()).toBe('sqrt(5)');
  });

  test('a constant that holds a Filter', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', {
      isConstant: true,
      value: ce.box([
        'Filter',
        ['List', 1, 2, 3, 4],
        ['Function', ['Less', 'k', 2.5], 'k'],
      ]),
    });
    const e = ce.box(['Norm', ['Range', 1, ['Length', 'Q']]]);
    expect(e.type.toString()).toBe('+oo | nan | real');
    expect(e.evaluate().toString()).toBe('sqrt(5)');
  });

  test('a variable that holds a list of function literals keeps its value', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'fs',
      ce.box([
        'List',
        ['Function', ['Multiply', 2, 'x'], 'x'],
        ['Function', ['Add', 1, 'x'], 'x'],
      ])
    );
    const e = ce.box([['At', 'fs', 1], 3] as never);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().toString()).toBe('6');
  });
});

describe('a walk in a type computation is not kept', () => {
  // `H` reads the number of its argument: a symbol with no value gives -1.
  const engine = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declare('H', {
      signature: '(real) -> real',
      pure: true,
      evaluate: ([x]) => ce.number(Number.isNaN(x.re) ? -1 : x.re * 10),
    });
    return ce;
  };
  const walkInViewThenOutside = (
    ce: ComputeEngine,
    json: Json
  ): [string, string] => {
    const e = ce.box(json);
    const inView = withStaticTypingView(ce, () =>
      [...e.each()].map(String).join(',')
    );
    return [inView, [...e.each()].map(String).join(',')];
  };

  test('Filter: the walk in the view misses every element', () => {
    const ce = engine();
    const e = ce.box([
      'Filter',
      ['Range', 1, 5],
      ['Function', ['Less', ['H', 'k'], 25], 'k'],
    ]);
    expect(withStaticTypingView(ce, () => e.count)).toBeUndefined();
    expect(e.count).toBe(2);
    expect(e.evaluate().toString()).toBe('[1,2]');
  });

  test.each([
    ['a variable that holds a literal', 'p'],
    ['a user function', 'g'],
  ])('Filter by %s: no count and no membership in the view', (_, name) => {
    const ce = engine();
    ce.assign('p', ce.box(['Function', ['Less', ['H', 'k'], 25], 'k']));
    ce.parse('g(x) := H(x) < 25').evaluate();
    const e = ce.box(['Filter', ['Range', 1, 5], name]);
    expect(
      withStaticTypingView(ce, () => [e.count, e.contains(ce.number(2))])
    ).toEqual([undefined, undefined]);
    expect(e.count).toBe(2);
    const norm = ce.box(['Norm', ['Range', 1, ['Length', e]]]);
    expect(norm.type.toString()).toBe('+oo | nan | real');
    expect(norm.evaluate().toString()).toBe('sqrt(5)');
  });

  test('Filter by a host operator is counted in the view', () => {
    const ce = engine();
    ce.declare('Small', {
      signature: '(real) -> boolean',
      pure: true,
      evaluate: ([x]) => (x.re < 2.5 ? ce.True : ce.False),
    });
    const e = ce.box(['Filter', ['Range', 1, 5], 'Small']);
    expect(withStaticTypingView(ce, () => e.count)).toBe(2);
  });

  test('TakeWhile', () => {
    const ce = engine();
    const [, outside] = walkInViewThenOutside(ce, [
      'TakeWhile',
      ['Range', 1, 5],
      ['Function', ['Less', ['H', 'k'], 25], 'k'],
    ]);
    expect(outside).toBe('1,2');
  });

  test('Tabulate', () => {
    const ce = engine();
    const [, outside] = walkInViewThenOutside(ce, [
      'Tabulate',
      ['Function', ['H', 'k'], 'k'],
      3,
    ]);
    expect(outside).toBe('10,20,30');
  });

  test('Scan', () => {
    const ce = engine();
    const [, outside] = walkInViewThenOutside(ce, [
      'Scan',
      ['Range', 1, 3],
      ['Function', ['Add', 'a', ['H', 'b']], 'a', 'b'],
    ]);
    expect(outside).toBe('1,21,51');
  });
});
