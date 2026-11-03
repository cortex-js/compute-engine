/**
 * A user name that is equal to an identifier of the emitted code must not
 * hide that identifier.
 *
 * The JavaScript target calls each runtime helper through the object `_SYS`
 * (`_SYS.factorial(x)`), and the loop of a `Sum` declares its upper bound as
 * `_upper`. A parameter, a block local or a loop index with one of these
 * names hid the identifier: `(_SYS) => _SYS.factorial(_SYS)` threw
 * `_SYS.factorial is not a function`. Such a name now gets a generated name
 * in the emitted code (`CompileTarget.reservedEmittedNames`). The parameters
 * are positional, so the caller supplies the same arguments.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { createJavaScriptRuntime } from '../../src/runtime';

const ce = new ComputeEngine();

function compiled(json: unknown, options: Record<string, unknown> = {}) {
  const r = compile(ce.box(json as any), { fallback: false, ...options })!;
  expect(r.success).toBe(true);
  return r;
}

const factorialOfSys = [
  'Function',
  ['Factorial', '_SYS'],
  ['Typed', '_SYS', "'integer'"],
];

describe('A parameter named _SYS', () => {
  test('run and load() give the value of the interpreter', () => {
    const expected = ce
      .box(['Apply', factorialOfSys, 3] as any)
      .evaluate().re;
    expect(expected).toBe(6);
    const r = compiled(factorialOfSys);
    expect(r.code).not.toContain('(_SYS)');
    expect(r.run!(3)).toBe(expected);
    expect(createJavaScriptRuntime().load(r)(3)).toBe(expected);
  });

  test('a write to the parameter writes its generated name', () => {
    const r = compiled([
      'Function',
      [
        'Block',
        ['Assign', '_SYS', ['Add', '_SYS', 1]],
        ['Factorial', '_SYS'],
      ],
      ['Typed', '_SYS', "'integer'"],
    ]);
    expect(r.run!(2)).toBe(6);
  });

  test('in the bigint mode', () => {
    const r = compiled(factorialOfSys, { mode: 'bigint' });
    expect(r.run!(3n)).toBe(6n);
    expect(createJavaScriptRuntime().load(r)(3n)).toBe(6n);
  });

  test('a parameter named _CND in an If', () => {
    const r = compiled([
      'Function',
      ['If', ['Greater', '_CND', 1], ['Factorial', '_CND'], 0],
      ['Typed', '_CND', "'integer'"],
    ]);
    expect(r.run!(3)).toBe(6);
  });

  // A nested function literal and a user function also emit such a
  // parameter under a generated name. A write to the parameter in their
  // body writes that name; it does not decline as a write to a reference
  // that cannot be assigned.
  test.each(['_SYS', '_upper'])(
    'a nested literal that writes its parameter named %s',
    (n) => {
      const fn = [
        'Function',
        [
          'Apply',
          [
            'Function',
            ['Block', ['Assign', n, ['Add', n, 1]], ['Factorial', n]],
            ['Typed', n, "'integer'"],
          ],
          'x',
        ],
        ['Typed', 'x', "'integer'"],
      ];
      const expected = ce.box(['Apply', fn, 2] as any).evaluate().re;
      expect(expected).toBe(6);
      expect(compiled(fn).run!(2)).toBe(expected);
    }
  );

  test.each(['_SYS', '_upper'])(
    'a user function that writes its parameter named %s',
    (n) => {
      const ce2 = new ComputeEngine();
      ce2.declare('g', 'function');
      ce2.assign(
        'g',
        ce2.box([
          'Function',
          ['Block', ['Assign', n, ['Add', n, 1]], ['Factorial', n]],
          ['Typed', n, "'integer'"],
        ] as any)
      );
      const fn = ['Function', ['g', 'x'], ['Typed', 'x', "'integer'"]];
      const expected = ce2.box(['Apply', fn, 2] as any).evaluate().re;
      expect(expected).toBe(6);
      const r = compile(ce2.box(fn as any), { fallback: false })!;
      expect(r.success).toBe(true);
      expect(r.run!(2)).toBe(expected);
    }
  );
});

describe('Other user names equal to an emitted identifier', () => {
  test('a free input named _SYS is read from the vars object', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('_SYS', 'integer');
    const r = compile(ce2.box(['Factorial', '_SYS']), { fallback: false })!;
    expect(r.success).toBe(true);
    expect(r.run!({ _SYS: 3 })).toBe(6);
  });

  test('a block local named _SYS', () => {
    const r = compiled([
      'Block',
      ['Declare', '_SYS', "'integer'"],
      ['Assign', '_SYS', 3],
      ['Factorial', '_SYS'],
    ]);
    expect(r.code).not.toContain('let _SYS');
    expect(r.run!()).toBe(6);
  });

  test('a block local named _SYS declared with a value', () => {
    const r = compiled([
      'Block',
      ['Declare', '_SYS', "'integer'", 3],
      ['Factorial', '_SYS'],
    ]);
    expect(r.code).not.toContain('let _SYS');
    expect(r.run!()).toBe(6);
  });

  // A `Declare` that is the body of a loop, with no block around it, is not
  // a local of a block. Its declaration must not use the name `_SYS` either.
  const loopBodyDeclare = [
    'Block',
    [
      'Loop',
      ['Declare', '_SYS', "'integer'", ['Factorial', 'k']],
      ['Element', 'k', ['Range', 1, 3]],
    ],
    5,
  ];

  test('a Declare of _SYS that is the body of a Loop', () => {
    const expected = ce.box(loopBodyDeclare as any).evaluate().re;
    expect(expected).toBe(5);
    const r = compiled(loopBodyDeclare);
    expect(r.code).not.toContain('let _SYS');
    expect(r.run!()).toBe(expected);
  });

  test('a Declare of _SYS that is the body of a Loop, in a Function', () => {
    const fn = ['Function', loopBodyDeclare, ['Typed', 'n', "'integer'"]];
    const expected = ce.box(['Apply', fn, 1] as any).evaluate().re;
    expect(expected).toBe(5);
    const r = compiled(fn);
    expect(r.code).not.toContain('let _SYS');
    expect(r.run!(1)).toBe(expected);
  });

  test('a Sum index named _SYS with a symbolic bound', () => {
    const r = compiled([
      'Function',
      ['Sum', ['Factorial', '_SYS'], ['Limits', '_SYS', 1, 'n']],
      ['Typed', 'n', "'integer'"],
    ]);
    // 1! + 2! + 3! = 9
    expect(r.run!(3)).toBe(9);
  });

  test('a Loop index named _SYS', () => {
    const r = compiled([
      'Function',
      [
        'Block',
        ['Declare', 'q', "'integer'"],
        ['Assign', 'q', 0],
        [
          'Loop',
          ['Assign', 'q', ['Add', 'q', ['Factorial', '_SYS']]],
          ['Element', '_SYS', ['Range', 1, 'n']],
        ],
        'q',
      ],
      ['Typed', 'n', "'integer'"],
    ]);
    expect(r.run!(3)).toBe(9);
  });

  test('a parameter named _upper read in the body of a Sum', () => {
    const r = compiled([
      'Function',
      ['Sum', ['Multiply', 'k', '_upper'], ['Limits', 'k', 1, 'n']],
      ['Typed', 'n', "'integer'"],
      ['Typed', '_upper', "'real'"],
    ]);
    // 10 · (1 + 2 + 3) = 60
    expect(r.run!(3, 10)).toBe(60);
  });

  test('interval-js: a Sum index named _IA', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('n', 'integer');
    ce2.declare('x', 'real');
    const r = compile(
      ce2.box(['Sum', ['Multiply', '_IA', 'x'], ['Limits', '_IA', 1, 'n']]),
      { to: 'interval-js', fallback: false }
    )!;
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('let _IA');
    const v: any = r.run!({ n: 3, x: 2 });
    // 2 · (1 + 2 + 3) = 12
    const value = v?.value ?? v;
    expect(value.lo).toBeCloseTo(12);
    expect(value.hi).toBeCloseTo(12);
  });
});

describe('A local named like an emitted identifier in the Block body of a Loop', () => {
  // The statements of a `Block` that is the body of a `Loop` are compiled
  // by `compileLoopBody`, not by `compileBlock`. The local must get the
  // same fresh name at its declaration and at each read.
  const loopBlockBody = (local: string, upper: unknown, value: unknown) => [
    'Block',
    ['Declare', 'q', "'integer'"],
    ['Assign', 'q', 0],
    [
      'Loop',
      [
        'Block',
        ['Declare', local, "'integer'", value],
        ['Assign', 'q', ['Add', 'q', local]],
      ],
      ['Element', 'k', ['Range', 1, upper]],
    ],
    'q',
  ];

  test('a local named _SYS', () => {
    const expr = loopBlockBody('_SYS', 3, ['Factorial', 'k']);
    const expected = ce.box(expr as any).evaluate().re;
    // 1! + 2! + 3! = 9
    expect(expected).toBe(9);
    const r = compiled(expr);
    expect(r.code).not.toContain('let _SYS');
    expect(r.run!()).toBe(expected);
  });

  test('a local named _SYS, with a symbolic bound', () => {
    const fn = [
      'Function',
      loopBlockBody('_SYS', 'n', ['Factorial', 'k']),
      ['Typed', 'n', "'integer'"],
    ];
    const expected = ce.box(['Apply', fn, 3] as any).evaluate().re;
    expect(expected).toBe(9);
    const r = compiled(fn);
    expect(r.code).not.toContain('let _SYS');
    expect(r.run!(3)).toBe(expected);
  });

  test('a local named _upper', () => {
    const expr = loopBlockBody('_upper', 3, ['Multiply', 'k', 2]);
    const expected = ce.box(expr as any).evaluate().re;
    // 2 · (1 + 2 + 3) = 12
    expect(expected).toBe(12);
    const r = compiled(expr);
    expect(r.code).not.toContain('let _upper');
    expect(r.run!()).toBe(expected);
  });

  test('interval-js: a local named _SYS', () => {
    const expr = loopBlockBody('_SYS', 3, ['Multiply', 'k', 2]);
    const r = compile(ce.box(expr as any), {
      to: 'interval-js',
      fallback: false,
    })!;
    // The compilation may decline, but a compiled result has the value
    // of the interpreter.
    if (!r.success) return;
    expect(r.code).not.toContain('let _SYS');
    const v: any = r.run!();
    const value = v?.value ?? v;
    expect(value.lo).toBeCloseTo(12);
    expect(value.hi).toBeCloseTo(12);
  });
});

// The lowerings below bind a fixed name around compiled user code. A user
// name equal to that fixed name read the emitted value instead of its own.
describe('A user name equal to a name that a lowering binds around user code', () => {
  const list = (n: string) => ['Typed', n, "'list<integer>'"];

  // `Map`, `Filter` and the other operators with a callback bind the
  // callback to `_f` around the code of the collection.
  test.each([
    ['Map', ['Map', ['Function', ['Add', 'y', 2], 'y'], '_f'], [3, 4, 5]],
    ['Filter', ['Filter', '_f', ['Function', ['Greater', 'y', 2], 'y']], [3]],
    ['Count', ['Count', '_f', ['Function', ['Greater', 'y', 2], 'y']], 1],
  ])('a list parameter named _f in %s', (_op, body, value) => {
    const fn = ['Function', body, list('_f')];
    const expected = ce
      .box(['Apply', fn, ['List', 1, 2, 3]] as any)
      .evaluate()
      .toString();
    expect(expected).toBe(JSON.stringify(value));
    expect(compiled(fn).run!([1, 2, 3])).toEqual(value);
  });

  // `Comprehension` collects its values in the array `result` around the
  // code of its term.
  test('a parameter named result in a Comprehension', () => {
    const fn = [
      'Function',
      ['Comprehension', ['Add', 'k', 'result'], ['Element', 'k', 'L']],
      list('L'),
      ['Typed', 'result', "'integer'"],
    ];
    const expected = ce
      .box(['Apply', fn, ['List', 1, 2, 3], 2] as any)
      .evaluate()
      .toString();
    expect(expected).toBe('[3,4,5]');
    expect(compiled(fn).run!([1, 2, 3], 2)).toEqual([3, 4, 5]);
  });

  test('a Comprehension index named result', () => {
    const fn = [
      'Function',
      ['Comprehension', ['Multiply', 'result', 2], ['Element', 'result', 'L']],
      list('L'),
    ];
    expect(compiled(fn).run!([1, 2, 3])).toEqual([2, 4, 6]);
  });

  test('interval-js: a parameter named result in a Comprehension', () => {
    const fn = [
      'Function',
      ['Comprehension', ['Add', 'k', 'result'], ['Element', 'k', 'L']],
      list('L'),
      ['Typed', 'result', "'integer'"],
    ];
    const r = compiled(fn, { to: 'interval-js' });
    const v: any[] = r.run!([1, 2, 3], 2) as any;
    expect(v.map((x) => [x.value.lo, x.value.hi])).toEqual([
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
  });

  // `Norm` over a list of points binds each point to `_pt` around the code
  // of the order of the norm.
  test('a parameter named _pt that is the order of a Norm', () => {
    const fn = [
      'Function',
      ['Norm', 'P', '_pt'],
      ['Typed', 'P', "'list<tuple<real, real>>'"],
      ['Typed', '_pt', "'integer'"],
    ];
    const expected = ce
      .box([
        'Apply',
        fn,
        ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]],
        1,
      ] as any)
      .evaluate()
      .toString();
    expect(expected).toBe('[7,14]');
    expect(
      compiled(fn).run!(
        [
          [3, 4],
          [6, 8],
        ],
        1
      )
    ).toEqual([7, 14]);
  });

  // `Norm` of an operand whose shape is known only at run time binds the
  // operand to `_v` around the code of the order of the norm.
  test('a parameter named _v that is the order of a Norm', () => {
    const fn = [
      'Function',
      ['Norm', 'P', '_v'],
      ['Typed', 'P', "'broadcastable<tuple<real, real>>'"],
      ['Typed', '_v', "'integer'"],
    ];
    const expected = ce
      .box([
        'Apply',
        fn,
        ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]],
        1,
      ] as any)
      .evaluate()
      .toString();
    expect(expected).toBe('[7,14]');
    expect(
      compiled(fn).run!(
        [
          [3, 4],
          [6, 8],
        ],
        1
      )
    ).toEqual([7, 14]);
  });

  // A `Coalesce` of a number binds the first operand to `_c` around the
  // code of the default value.
  test('a parameter named _c that is the default of a Coalesce', () => {
    const fn = [
      'Function',
      ['Coalesce', ['At', 'L', 5], '_c'],
      ['Typed', 'L', "'list<real>'"],
      ['Typed', '_c', "'real'"],
    ];
    expect(
      ce.box(['Apply', fn, ['List', 1, 2], 7] as any).evaluate().re
    ).toBe(7);
    expect(compiled(fn).run!([1, 2], 7)).toBe(7);
  });

  // The interval target folds the term of a `Sum` over a `Range` with a
  // run-time bound in the scope of `_r`, the name of the range.
  test('interval-js: a parameter named _r in the term of a Sum over a Range', () => {
    const fn = [
      'Function',
      [
        'Sum',
        ['Map', ['Function', ['Multiply', 'y', '_r'], 'y'], ['Range', 1, 'n']],
      ],
      ['Typed', 'n', "'integer'"],
      ['Typed', '_r', "'integer'"],
    ];
    expect(ce.box(['Apply', fn, 3, 2] as any).evaluate().re).toBe(12);
    const v: any = compiled(fn, { to: 'interval-js' }).run!(3, 2);
    expect([v.value.lo, v.value.hi]).toEqual([12, 12]);
  });
});

// A `Reduce` over complex values with a user function as the combiner
// compiles the combiner as the function literal `(_a, _x) ↦ f(_a, _x)`. The
// parameters of this literal must not have the name of the function.
describe('A user function named like a parameter of a combiner literal', () => {
  test.each(['_a', '_x'])('a user function named %s', (name) => {
    const ce2 = new ComputeEngine();
    ce2.assign(name, ce2.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    const fn = [
      'Function',
      ['Reduce', 'L', name, 0],
      ['Typed', 'L', "'list<complex>'"],
    ];
    const expected = ce2
      .box(['Apply', fn, ['List', ['Complex', 1, 1], ['Complex', 2, 0]]] as any)
      .evaluate();
    expect(expected.re).toBe(3);
    expect(expected.im).toBe(1);
    const r = compile(ce2.box(fn as any), {
      fallback: false,
      mode: 'complex',
    })!;
    expect(r.success).toBe(true);
    expect(
      r.run!([
        { re: 1, im: 1 },
        { re: 2, im: 0 },
      ])
    ).toEqual({ re: 3, im: 1 });
  });
});
