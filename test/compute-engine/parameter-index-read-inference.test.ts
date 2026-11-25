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
      '(p: dictionary<number> | indexed_collection<number>, k: unknown) -> number'
    );
  });
});

describe('a free symbol keeps one element type for every element', () => {
  test('xs[1] + 1 at the top level', () => {
    const ce = new ComputeEngine();
    const sum = ce.box(['Add', ['At', 'xs', 1], 1]);
    const read = sum.ops!.find((op) => op.operator === 'At')!;
    expect(read.op1.type.toString()).toBe('indexed_collection<number>');
  });
});

// A free symbol passed to a bare parameter learns one element type only when
// the parameter's tuple came from index reads. A tuple that a call in the
// body requires is a contract, and the free symbol learns it. The type of the
// free symbol is read on its occurrence in the call.
describe('a free symbol at an inferred tuple slot', () => {
  function slotOf(body: MathJsonExpression): string {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    ce.assign('h', ce.box(['Function', body, 'p']));
    const call = ce.box(['h', 'zs']);
    expect(call.isValid).toBe(true);
    return call.op1.type.toString();
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
    expect(ce.box(['fk', 'xs']).op1.type.toString()).toBe(
      'indexed_collection<number>'
    );
    expect(ce.box(['fh', 'ys']).op1.type.toString()).toBe(
      'tuple<number, number>'
    );
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
      expect(ce.box(['h', 'zs']).op1.type.toString()).toBe(
        'tuple<number, number>'
      );
    }
  });

  test('a read past the end of the tuple is not refused', () => {
    const { fn } = literal([
      'Add',
      ['Floor', ['At', 'p', 1]],
      ['Floor', ['At', 'p', 2]],
    ]);
    expect(fn.isValid).toBe(true);
    // The carrier of `Floor` is `real | signed_infinity | ~oo`.
    expect(fn.type.toString()).toMatch(
      /^\(p: tuple<real \| signed_infinity \| ~oo, real \| signed_infinity \| ~oo>\) ->/
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
      '(p: tuple<real | signed_infinity | ~oo, real | signed_infinity | ~oo>) -> number'
    );
    ce.assign('h', fn);
    expect(ce.box(['h', 'zs']).op1.type.toString()).toBe(
      'tuple<real | signed_infinity | ~oo, real | signed_infinity | ~oo>'
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
      expect(ce.box(['h', 'zs']).op1.type.toString()).toBe(
        'tuple<number, number>'
      );
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

  // CE-1489: the slot of a function whose body reads its parameter by index
  // requires a longer tuple than the reads of the caller made. The parameter
  // of the caller takes that tuple, whether the reads or the call come
  // first, and the tuple keeps the index-read mark: the call does not prove
  // the length.
  test('a call of a function whose slot index reads made, in either order', () => {
    for (const body of [
      ['Block', ['Add', ['At', 'c', 1], 1], ['t', 'c']],
      ['Block', ['t', 'c'], ['Add', ['At', 'c', 1], 1]],
    ] as MathJsonExpression[]) {
      const ce = new ComputeEngine();
      ce.assign(
        't',
        ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 3]], 'p'])
      );
      const fn = ce.box(['Function', body, 'c']);
      expect(fn.isValid).toBe(true);
      expect(fn.type.toString()).toBe(
        '(c: tuple<number, unknown, number>) -> number'
      );
      // A free symbol at the slot learns one element type, as it does at a
      // slot that index reads made.
      ce.assign('h', fn);
      expect(ce.box(['h', 'zs']).op1.type.toString()).toBe(
        'indexed_collection<number>'
      );
    }
  });

  // CE-1493: a slot that index reads made, SHORTER than the reads of the
  // caller, or of the same length with other components, is merged too: the
  // tuple is as long as the longer of the two, each component is the meet of
  // the two at its position, and the type does not depend on the order.
  test('a call of a function whose slot index reads made is merged at any length', () => {
    for (const body of [
      ['Block', ['Add', ['At', 'c', 2], ['At', 'c', 5]], ['t', 'c']],
      ['Block', ['t', 'c'], ['Add', ['At', 'c', 2], ['At', 'c', 5]]],
    ] as MathJsonExpression[]) {
      const ce = new ComputeEngine();
      ce.assign(
        't',
        ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 3]], 'p'])
      );
      const fn = ce.box(['Function', body, 'c']);
      expect(fn.isValid).toBe(true);
      expect(fn.type.toString()).toBe(
        '(c: tuple<number, number, number, unknown, number>) -> number'
      );
      // The merged tuple keeps the index-read mark: a later read past its
      // end is one more component.
      const longer = ce.box([
        'Function',
        ['Block', body, ['Add', ['At', 'c', 7], 1]],
        'c',
      ]);
      expect(longer.type.toString()).toBe(
        '(c: tuple<number, number, number, unknown, number, unknown, number>) -> number'
      );
    }
  });

  // CE-1493: a read that gives no element type (`c[5] > 0`) leaves
  // `dictionary<any> | indexed_collection<any>`, which holds no evidence. A
  // later slot that index reads made narrows it, as it narrows `unknown`, so
  // the type does not depend on the order. (Such a read records no index, so
  // the tuple is not lengthened to 5; it keeps the index-read mark, which
  // proves no length.)
  test('a read with no element type, then a call of a function whose slot index reads made', () => {
    const types = [
      ['Block', ['Greater', ['At', 'c', 5], 0], ['t', 'c']],
      ['Block', ['t', 'c'], ['Greater', ['At', 'c', 5], 0]],
    ].map((body) => {
      const ce = new ComputeEngine();
      ce.assign(
        't',
        ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 3]], 'p'])
      );
      const fn = ce.box(['Function', body as MathJsonExpression, 'c']);
      expect(fn.isValid).toBe(true);
      // The result is the last statement of the block, so it differs.
      return fn.type.toString().replace(/ -> .*$/, '');
    });
    expect(types[0]).toMatch(/^\(c: tuple<number, unknown, number[,>]/);
    expect(types[1]).toBe(types[0]);
  });

  test('Epsil: two functions that read a parameter at different lengths, in either order', () => {
    const header = `function touches(p, q) {
  let d = sqrt((p[2] - q[2])^2 + (p[3] - q[3])^2)
  let rp = 1 / p[1]; let rq = 1 / q[1]
  abs(d - abs(rp + rq)) < 1e-6 || abs(d - abs(rp - rq)) < 1e-6
}
function other(q) { q[1] + q[5] }
`;
    const types = (body: string): string => {
      const ce = new ComputeEngine();
      const r = executeEpsil(ce, `${header}function f(p, c) { ${body} }`);
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const call = ce.box([
        'f',
        ['Tuple', -1, 0, 0],
        ['Tuple', 2, 0.5, 0, 7, 3],
      ] as MathJsonExpression);
      expect(call.evaluate().json).toBe('True');
      return ce.box('f').type.toString();
    };
    const calls = types('touches(c, p) && other(c) > 0');
    expect(calls).toBe(
      '(p: tuple<number, number, number>, c: tuple<number, number, number, unknown, number>) -> boolean'
    );
    expect(types('other(c) > 0 && touches(c, p)')).toBe(calls);
    const read = types('touches(c, p) && c[5] > 0');
    expect(read).toMatch(/c: tuple<number, number, number[,>]/);
    expect(types('c[5] > 0 && touches(c, p)')).toBe(read);
  });

  test('Epsil: a parameter read at index 1, then passed to a function that reads three', () => {
    const ce = new ComputeEngine();
    const source = `function touches(p, q) {
  let d = sqrt((p[2] - q[2])^2 + (p[3] - q[3])^2)
  let rp = 1 / p[1]; let rq = 1 / q[1]
  abs(d - abs(rp + rq)) < 1e-6 || abs(d - abs(rp - rq)) < 1e-6
}
function isNewCircle(p, c) {
  c[1] > 0 && 1 / c[1] >= 0.008 && touches(c, p)
}`;
    const r = executeEpsil(ce, source);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(ce.box('isNewCircle').type.toString()).toBe(
      '(p: tuple<number, number, number>, c: tuple<number, number, number>) -> boolean'
    );
    // The compiled call gives the interpreter's value.
    for (const [c, want] of [
      [[6, 1 / 3, 0.5333333333333333], false],
      [[2, 0.5, 0], true],
      [[-1, 0, 0], false],
    ] as const) {
      const call = ce.box([
        'isNewCircle',
        ['Tuple', -1, 0, 0],
        ['Tuple', ...c],
      ] as MathJsonExpression);
      expect(call.evaluate().json).toBe(want ? 'True' : 'False');
      const compiled = compile(call, {
        to: 'javascript',
        fallback: false,
      } as never) as unknown as { success: boolean; run: () => unknown };
      expect(compiled.success).toBe(true);
      expect(compiled.run()).toBe(want);
    }
  });
});

// The types of the free arguments are read on their occurrences: in Epsil, in
// a last statement of the program, which reads what the earlier statements
// required.
describe('the three routes that define a function agree on a free argument', () => {
  test.each([
    [
      'let',
      'let k = p => p[1] + p[2]\nlet h = p => g(p)\nk(ws)\nh(zs)\n(ws, zs)',
    ],
    [
      'function',
      'function k(p) { p[1] + p[2] }\nfunction h(p) { g(p) }\nk(ws)\nh(zs)\n(ws, zs)',
    ],
  ])('Epsil %s', (_, source) => {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const result = executeEpsil(ce, source, { parseLatex });
    expect(result.diagnostics).toEqual([]);
    const [ws, zs] = result.value!.ops!;
    expect(ws.type.toString()).toBe('indexed_collection<number>');
    expect(zs.type.toString()).toBe('tuple<number, number>');
  });

  test('ce.assign', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    ce.assign('h', ce.box(['Function', ['g', 'p'], 'p']));
    expect(ce.box(['k', 'ws']).op1.type.toString()).toBe(
      'indexed_collection<number>'
    );
    expect(ce.box(['h', 'zs']).op1.type.toString()).toBe(
      'tuple<number, number>'
    );
  });
});

describe('the compiled route checks an inferred tuple base', () => {
  // A matrix given for `v: tuple<number>` is outside the type: its value is
  // not specified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
  test('a kernel compiled for `v: tuple<number>` reads the first element', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Add', ['At', 'v', 1], 1], 'v']));
    expect(ce.symbol('h').type.toString()).toBe('(v: tuple<number>) -> number');
    const compiled = compile(ce.box(['h', 'xs'])) as unknown as
      { run: (env: unknown) => unknown } | ((env: unknown) => unknown);
    const runIt = typeof compiled === 'function' ? compiled : compiled.run;
    expect(runIt({ xs: [1, 2, 3] })).toBe(2);
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

});
