import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// The index reads of a bare (unannotated) function parameter are recorded
// per index (`docs/INFERENCE_ROADMAP.md` §5). While every read uses a literal
// index, the parameter is a tuple whose component at each read index is the
// requirement of that read. When a read uses an index that is not a literal,
// the parameter is an indexed collection whose element type is the union of
// the requirements of all the reads. A free symbol keeps the rule that one
// typed read decides the element type of every element.
//

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

const PROGRAM = 'let f = p => !p[1] if p[2] % 2 == 0 else p[1]';

// `p => !p[1] if p[2] % 2 == 0 else p[1]` as a MathJSON `Function` literal.
const LAMBDA: MathJsonExpression = [
  'Function',
  [
    'If',
    ['Equal', ['Mod', ['At', 'p', 2], 2], 0],
    ['Not', ['At', 'p', 1]],
    ['At', 'p', 1],
  ],
  'p',
];

describe('a literal index read narrows one tuple component', () => {
  test('Epsil: a boolean first element and an integer second element', () => {
    const even = run(`${PROGRAM}\nf((true, 4))`);
    expect(even.diagnostics).toEqual([]);
    expect(even.value?.toString()).toBe('"False"');
    const odd = run(`${PROGRAM}\nf((true, 3))`);
    expect(odd.diagnostics).toEqual([]);
    expect(odd.value?.toString()).toBe('"True"');
  });

  test('MathJSON: the Function literal is valid and types its parameter as a tuple', () => {
    const ce = new ComputeEngine();
    const f = ce.box(LAMBDA);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('(p: tuple<boolean, real>) -> boolean');
    expect(
      ce
        .box(['Apply', LAMBDA, ['Tuple', 'True', 4]])
        .evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      ce
        .box(['Apply', LAMBDA, ['Tuple', 'True', 3]])
        .evaluate()
        .toString()
    ).toBe('"True"');
  });

  test('a component that no read uses is unknown, and the length is the largest index', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', ['At', 'v', 3], 1], 'v']);
    expect(f.type.toString()).toBe(
      '(v: tuple<unknown, unknown, number>) -> number'
    );
  });

  test('the mirror case: a boolean read then a numeric read at another index is not refused', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Block', ['And', ['At', 'xs', 1], 'B'], ['Add', ['At', 'xs', 2], 1]],
      'xs',
    ]);
    expect(f.isValid).toBe(true);
    // The read at index 2 is past the end of `tuple<boolean>`, which index
    // reads made, so it is an unread component (`unknown`), and `+ 1`
    // requires `number` of it, as it does in `p[1] + p[2]`.
    expect(f.type.toString()).toBe('(xs: tuple<boolean, number>) -> number');
  });

  test('two reads at the same index with no common value are still an error', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Block', ['Not', ['At', 'p', 1]], ['Add', ['At', 'p', 1], 1]],
      'p',
    ]);
    expect(f.isValid).toBe(false);
    expect(f.toString()).toContain('incompatible-type');
  });

  test('the inferred tuple is not enforced: a list argument is read whole', () => {
    const r = run('let h = p => p[1] + p[2]\nh([3, 4])');
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('7');
    const m = run('let h = p => p[1] + p[2]\nmap(h, [(1, 2), (3, 4)])');
    expect(m.value?.toString()).toBe('[3,7]');
  });

  test('a literal index above 32 counts as a non-literal index', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', ['At', 'p', 1], ['At', 'p', 100]],
      'p',
    ]);
    expect(f.type.toString()).toBe('(p: indexed_collection<number>) -> number');
  });
});

describe('a read at an index that is not a literal joins the requirements', () => {
  test('the element type is the union of the requirements of all the reads', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      [
        'Block',
        ['Not', ['At', 'p', 1]],
        ['Add', ['At', 'p', 2], 1],
        ['Add', ['At', 'p', 'k'], 1],
      ],
      'p',
      'k',
    ]);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toMatch(
      /^\(p: indexed_collection<boolean \| number>, /
    );
  });

  test('a first read at a non-literal index keeps the general rule', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', ['At', 'p', 'k'], 1], 'p', 'k']);
    expect(f.type.toString()).toBe(
      '(p: dictionary<number> | indexed_collection<number>, unknown) -> number'
    );
  });
});

describe('a free symbol keeps one element type for every element', () => {
  test('xs[1] + 1 at the top level', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', 'xs', 1], 1]);
    expect(ce.symbol('xs').type.toString()).toBe('indexed_collection<number>');
  });
});

// A free symbol passed to a bare parameter learns one element type only when
// the parameter's tuple came from index reads. A tuple that a call in the
// body requires is a contract, and the free symbol learns it.
describe('a free symbol at an inferred tuple slot', () => {
  function slotOf(body: MathJsonExpression): string {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    ce.assign('h', ce.box(['Function', body, 'p']));
    expect(ce.box(['h', 'zs']).isValid).toBe(true);
    return ce.symbol('zs').type.toString();
  }

  test('index reads only: one element type', () => {
    expect(slotOf(['Add', ['At', 'p', 1], ['At', 'p', 2]])).toBe(
      'indexed_collection<number>'
    );
  });

  test('a call: the tuple of the call', () => {
    expect(slotOf(['g', 'p'])).toBe('tuple<number, number>');
  });

  test('a call and index reads: the call decides, in either order', () => {
    expect(slotOf(['Add', ['g', 'p'], ['At', 'p', 1]])).toBe(
      'tuple<number, number>'
    );
    expect(
      slotOf(['Block', ['Add', ['At', 'p', 1], ['At', 'p', 2]], ['g', 'p']])
    ).toBe('tuple<number, number>');
    expect(
      slotOf(['Block', ['g', 'p'], ['Add', ['At', 'p', 1], ['At', 'p', 2]]])
    ).toBe('tuple<number, number>');
  });

  test('a call and a read at an index that is not a literal: the call decides', () => {
    expect(slotOf(['Add', ['g', 'p'], ['At', 'p', 'j']])).toBe(
      'tuple<number, number>'
    );
    expect(slotOf(['Block', ['Add', ['At', 'p', 'j'], 1], ['g', 'p']])).toBe(
      'tuple<number, number>'
    );
  });

  test('a parameter that forwards its argument keeps the origin of the slot', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    ce.assign('h', ce.box(['Function', ['g', 'p'], 'p']));
    ce.assign('fk', ce.box(['Function', ['k', 'q'], 'q']));
    ce.assign('fh', ce.box(['Function', ['h', 'q'], 'q']));
    ce.box(['fk', 'xs']);
    ce.box(['fh', 'ys']);
    expect(ce.symbol('xs').type.toString()).toBe('indexed_collection<number>');
    expect(ce.symbol('ys').type.toString()).toBe('tuple<number, number>');
  });
});

// Index reads do not prove the length of the argument. A read past the end
// of the tuple that the earlier reads made is a component that no read used
// yet, and a call that requires a longer tuple gives the parameter that
// tuple.
describe('an index-read tuple does not fix the length', () => {
  function literal(body: MathJsonExpression) {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    return { ce, fn: ce.box(['Function', body, 'p']) };
  }

  test('a call that requires a longer tuple, in either statement order', () => {
    for (const body of [
      ['Block', ['Add', ['At', 'p', 1], 1], ['g', 'p']],
      ['Block', ['g', 'p'], ['Add', ['At', 'p', 1], 1]],
    ] as MathJsonExpression[]) {
      const { ce, fn } = literal(body);
      expect(fn.isValid).toBe(true);
      expect(fn.type.toString()).toBe('(p: tuple<number, number>) -> number');
      ce.assign('h', fn);
      ce.box(['h', 'zs']);
      expect(ce.symbol('zs').type.toString()).toBe('tuple<number, number>');
    }
  });

  test('a read past the end of the tuple is not refused', () => {
    const { fn } = literal([
      'Add',
      ['Floor', ['At', 'p', 1]],
      ['Floor', ['At', 'p', 2]],
    ]);
    expect(fn.isValid).toBe(true);
    expect(fn.type.toString()).toMatch(
      /^\(p: tuple<real \| signed_infinity, real \| signed_infinity>\) ->/
    );
  });

  test('a read past the end, then a call', () => {
    const { ce, fn } = literal([
      'Block',
      ['Add', ['Floor', ['At', 'p', 1]], ['Floor', ['At', 'p', 2]]],
      ['g', 'p'],
    ]);
    expect(fn.isValid).toBe(true);
    expect(fn.type.toString()).toBe(
      '(p: tuple<real | signed_infinity, real | signed_infinity>) -> number'
    );
    ce.assign('h', fn);
    ce.box(['h', 'zs']);
    expect(ce.symbol('zs').type.toString()).toBe(
      'tuple<real | signed_infinity, real | signed_infinity>'
    );
  });

  test('a call whose tuple contradicts a component that the reads gave is an error', () => {
    // `p[1]` is a boolean, and both slots require a number at position 1.
    for (const callee of ['g', 'g1']) {
      const ce = new ComputeEngine();
      ce.declare('g', '(tuple<number, number>) -> number');
      ce.declare('g1', '(tuple<number>) -> number');
      const fn = ce.box([
        'Function',
        ['Block', ['Boole', ['Not', ['At', 'p', 1]]], [callee, 'p']],
        'p',
      ]);
      expect(fn.isValid).toBe(false);
      const call = fn.ops![0].ops![1];
      expect(call.ops![0].toString()).toMatch(
        /^Error\(ErrorCode\("incompatible-type", .*\), p\)$/
      );
    }
  });

  test('a call of an overloaded function that requires a longer tuple', () => {
    // The tuple arm is not removed when the overloads are filtered, although
    // `tuple<number>` and `tuple<number, number>` have different lengths.
    // The call then gives the parameter the tuple of that arm, as it does
    // for a function with one signature.
    for (const body of [
      ['Block', ['Add', ['At', 'p', 1], 1], ['g', 'p']],
      ['Block', ['g', 'p'], ['Add', ['At', 'p', 1], 1]],
    ] as MathJsonExpression[]) {
      const ce = new ComputeEngine();
      ce.declare(
        'g',
        '((tuple<number, number>) -> number) & ((string) -> string)'
      );
      const fn = ce.box(['Function', body, 'p']);
      expect(fn.isValid).toBe(true);
      expect(fn.type.toString()).toBe('(p: tuple<number, number>) -> number');
      ce.assign('h', fn);
      ce.box(['h', 'zs']);
      expect(ce.symbol('zs').type.toString()).toBe('tuple<number, number>');
    }

    // A component that the reads gave and that no arm admits is still an
    // error.
    const ce = new ComputeEngine();
    ce.declare(
      'g',
      '((tuple<number, number>) -> number) & ((string) -> string)'
    );
    const fn = ce.box([
      'Function',
      ['Block', ['Boole', ['Not', ['At', 'p', 1]]], ['g', 'p']],
      'p',
    ]);
    expect(fn.isValid).toBe(false);
  });

  test('a read past the end of a tuple that a call required is still an error', () => {
    const { fn } = literal(['Block', ['g', 'p'], ['Floor', ['At', 'p', 3]]]);
    expect(fn.isValid).toBe(false);
  });
});

describe('the three routes that define a function agree on a free argument', () => {
  test.each([
    ['let', 'let k = p => p[1] + p[2]\nlet h = p => g(p)\nk(ws)\nh(zs)'],
    [
      'function',
      'function k(p) { p[1] + p[2] }\nfunction h(p) { g(p) }\nk(ws)\nh(zs)',
    ],
  ])('Epsil %s', (_, source) => {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    executeEpsil(ce, source, { parseLatex });
    expect(ce.symbol('ws').type.toString()).toBe('indexed_collection<number>');
    expect(ce.symbol('zs').type.toString()).toBe('tuple<number, number>');
  });

  test('ce.assign', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    ce.assign('h', ce.box(['Function', ['g', 'p'], 'p']));
    ce.box(['k', 'ws']);
    ce.box(['h', 'zs']);
    expect(ce.symbol('ws').type.toString()).toBe('indexed_collection<number>');
    expect(ce.symbol('zs').type.toString()).toBe('tuple<number, number>');
  });
});

describe('the compiled route checks an inferred tuple base', () => {
  test('a matrix given to a kernel compiled for `v: tuple<number>` fails loudly', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Add', ['At', 'v', 1], 1], 'v']));
    expect(ce.symbol('h').type.toString()).toBe('(tuple<number>) -> number');
    const compiled = compile(ce.box(['h', 'xs'])) as unknown as
      { run: (env: unknown) => unknown } | ((env: unknown) => unknown);
    const runIt = typeof compiled === 'function' ? compiled : compiled.run;
    expect(runIt({ xs: [1, 2, 3] })).toBe(2);
    expect(() =>
      runIt({
        xs: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toThrow(/static element type/);
  });

  test('the compiled tuple lambda agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(LAMBDA));
    const compiled = compile(ce.box(['f', 'q'])) as unknown as
      { run: (env: unknown) => unknown } | ((env: unknown) => unknown);
    const runIt = typeof compiled === 'function' ? compiled : compiled.run;
    expect(runIt({ q: [true, 4] })).toBe(false);
    expect(runIt({ q: [true, 3] })).toBe(true);
  });
});

//
// Issue #448: the inferred tuple is not a contract on the argument. The
// `Apply` route mapped a list argument over the elements of a tuple-typed
// parameter (`literalParamsMap`, `library/core.ts`), and a collection
// operator refused a parameter whose tuple had an `unknown` component
// (`indexReadTupleAtCollectionSlot`, `boxed-expression/index-read-tuple.ts`).
//
describe('issue #448: a bare parameter read at literal indices', () => {
  const ADD_READS: MathJsonExpression = [
    'Function',
    ['Add', ['At', 'p', 1], ['At', 'p', 2]],
    'p',
  ];
  const JOIN_DROP: MathJsonExpression = [
    'Function',
    ['Join', ['List', ['Add', ['At', 'p', 2], 1]], ['Drop', 'p', 2]],
    'p',
  ];

  test('Apply binds a list argument whole (not mapped over the elements)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Apply', ADD_READS, ['List', 5, 7]]).evaluate().json).toBe(
      12
    );
    // A longer list and a tuple are read the same way: the length is not
    // enforced.
    expect(
      ce.box(['Apply', ADD_READS, ['List', 5, 7, 9]]).evaluate().json
    ).toBe(12);
    expect(ce.box(['Apply', ADD_READS, ['Tuple', 5, 7]]).evaluate().json).toBe(
      12
    );
    expect(ce.box(['Apply', ADD_READS, ['List', 5, 7]]).type.toString()).toBe(
      'number'
    );
  });

  test('a destructuring tuple parameter still maps over a list of points', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Apply',
          ['Function', ['Add', 'a', 'b'], ['Tuple', 'a', 'b']],
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ])
        .evaluate().json
    ).toEqual(['List', 3, 7]);
  });

  test('the parameter is accepted by a collection operator (Drop)', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(JOIN_DROP);
    expect(fn.type.toString()).toBe(
      '(p: tuple<number, number>) -> list<number>'
    );
    expect(
      ce.box(['Apply', JOIN_DROP, ['List', 0, 0, 7]]).evaluate().json
    ).toEqual(['Join', ['List', 1], ['Drop', ['List', 0, 0, 7], 2]]);
  });

  test('a read passed to a typed parameter of an inner literal', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Apply',
      [
        'Function',
        [
          'Apply',
          [
            'Function',
            ['Subtract', ['At', 'p', 1], 'n'],
            ['Typed', 'n', "'integer'"],
          ],
          ['At', 'p', 2],
        ],
        'p',
      ],
      ['List', 5, 7],
    ]);
    expect(e.evaluate().json).toBe(-2);
  });

  test('a Fold accumulator read at literal indices and passed to Drop', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Fold',
      [
        'Function',
        ['Join', ['List', ['Add', ['At', 's', 2], 1]], ['Drop', 's', 2]],
        's',
        'i',
      ],
      ['List', 0, 0, 7],
      ['Range', 1, 2],
    ]);
    expect(e.evaluate().json).toEqual(['List', 8]);
  });

  test('a Fold that threads a state tuple read at literal indices', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Fold',
      [
        'Function',
        [
          'Tuple',
          ['Add', ['At', 'st', 1], 'i'],
          ['Multiply', ['At', 'st', 2], 'i'],
        ],
        'st',
        'i',
      ],
      ['Tuple', 0, 1],
      ['Range', 1, 4],
    ]);
    expect(e.evaluate().json).toEqual(['Tuple', 10, 24]);
  });

  test('the same expressions compile', () => {
    const ce = new ComputeEngine();
    const r1 = compile(ce.box(ADD_READS), { fallback: false });
    expect(r1.success).toBe(true);
    expect(r1.run!([5, 7])).toBe(12);
    const r2 = compile(ce.box(JOIN_DROP), { fallback: false });
    expect(r2.success).toBe(true);
    expect(r2.run!([0, 0, 7])).toEqual([1, 7]);
  });
});
