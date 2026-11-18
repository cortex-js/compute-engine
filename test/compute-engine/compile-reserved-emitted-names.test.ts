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
      ['Declare', '_SYS', "'integer'", 3],
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

  // A `Declare` that is the body of a loop, with no block around it, is the
  // static error `declaration-below-statement`, so no code declares `_SYS`:
  // the compilation declines.
  const loopBodyDeclare = [
    'Block',
    [
      'Loop',
      ['Declare', '_SYS', "'integer'", ['Factorial', 'k']],
      ['Element', 'k', ['Range', 1, 3]],
    ],
    5,
  ];

  test('a Declare of _SYS that is the body of a Loop is an error', () => {
    const expr = ce.box(loopBodyDeclare as any);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.evaluate().json)).toContain(
      'declaration-below-statement'
    );
    expect(() => compile(expr, { fallback: false })).toThrow(
      /declaration-below-statement/
    );
  });

  test('a Declare of _SYS that is the body of a Loop, in a Function, is an error', () => {
    const fn = ['Function', loopBodyDeclare, ['Typed', 'n', "'integer'"]];
    expect(
      JSON.stringify(ce.box(['Apply', fn, 1] as any).evaluate().json)
    ).toContain('declaration-below-statement');
    expect(() => compile(ce.box(fn as any), { fallback: false })).toThrow(
      /declaration-below-statement/
    );
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
        ['Declare', 'q', "'integer'", 0],
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
    ['Declare', 'q', "'integer'", 0],
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

