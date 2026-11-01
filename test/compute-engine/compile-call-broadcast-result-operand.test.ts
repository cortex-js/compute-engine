/**
 * An operator over a call of a user function that maps over a list argument.
 *
 * With `q(t) := 2t` and a free input `u` that nothing types, the JavaScript
 * call `q(u)` maps `q` over a list at run time (`_SYS.bcastFn(_fn_q, _.u)`),
 * as the interpreter does. The engine types `q(u)` as `number`, and the
 * operator around the call was compiled as scalar code: `1 + q(u)` was
 * `_SYS.bcastFn(_fn_q, _.u) + 1`, which ran to the string `"2,4,61"` at
 * `u = [1, 2, 3]`, where the interpreter gives `[3, 5, 7]`.
 *
 * The compiler now reads such a call as a value that can be a list
 * (`mayHoldCallBroadcastResult`, `compilation/compiler-type-facts.ts`), so
 * the operator maps over its result too (`_SYS.bcast`). A list is a valid
 * input there: the program does not declare or imply that `u` is a number.
 * When it does (`u` declared `number`, or narrowed to `number` by a use such
 * as `u + 1`), a list for `u` breaks the host's input contract, and the
 * scalar code stays.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

type Json = any;

function engine(types: Record<string, string> = {}): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries({
    u: 'real | list<real>',
    ...types,
  }))
    ce.declare(name, type);
  ce.declare('q', 'function');
  ce.assign('q', ce.box(['Function', ['Multiply', 2, 't'], 't']));
  ce.declare('p', 'function');
  ce.assign('p', ce.box(['Function', ['Add', 't', 10], 't']));
  ce.declare('w', 'number');
  return ce;
}

/** The compiled value at `vars`, with no fallback to the interpreter. */
function run(
  json: Json,
  vars: Record<string, unknown>,
  types: Record<string, string> = {}
): unknown {
  const result = compile(engine(types).box(json), {
    to: 'javascript',
    fallback: false,
  } as any) as any;
  return result.run(vars);
}

function code(json: Json, types: Record<string, string> = {}): string {
  return (
    compile(engine(types).box(json), { to: 'javascript', fallback: false } as any) as any
  ).code;
}

/**
 * The compiled function `(params) => json`, whose parameters have no type.
 * An input with no type is refused, but a parameter with no type is not: the
 * code then reads the result of the call `q(u)` with the run-time test of
 * a value that can be a list (`callResultGuard`, `compile-expr-handlers.ts`).
 */
function compileFn(json: Json, params: string[]): any {
  return compile(engine().box(['Function', json, ...params]), {
    to: 'javascript',
    fallback: false,
  } as any) as any;
}

/** The value that the interpreter gives for `json`, where each name of
 * `values` has no declared type and holds its value. */
function interpretUntyped(json: Json, values: Record<string, unknown>): unknown {
  const ce = new ComputeEngine();
  ce.declare('q', 'function');
  ce.assign('q', ce.box(['Function', ['Multiply', 2, 't'], 't']));
  const box = (v: unknown): Json =>
    Array.isArray(v) ? ['List', ...v.map(box)] : v;
  for (const [name, v] of Object.entries(values)) ce.assign(name, ce.box(box(v)));
  const plain = (v: any): unknown => {
    if (v.operator === 'List') return v.ops.map(plain);
    if (v.symbol === 'True') return true;
    if (v.symbol === 'False') return false;
    return v.re;
  };
  return plain(ce.box(json).N());
}

/** The interpreter's value, as plain numbers or booleans. */
function interpret(json: Json, u: number[] | number): unknown {
  const ce = engine();
  ce.assign('u', ce.box(Array.isArray(u) ? ['List', ...u] : u));
  ce.assign('w', 1);
  const value = ce.box(json).N();
  const plain = (v: any): unknown => {
    if (v.operator === 'List') return v.ops.map(plain);
    if (v.symbol === 'True') return true;
    if (v.symbol === 'False') return false;
    return v.re;
  };
  return plain(value);
}

const CASES: [string, Json][] = [
  ['1 + q(u)', ['Add', 1, ['q', 'u']]],
  ['3 q(u)', ['Multiply', 3, ['q', 'u']]],
  ['-q(u)', ['Negate', ['q', 'u']]],
  ['q(u)^2', ['Power', ['q', 'u'], 2]],
  ['q(u) < 3', ['Less', ['q', 'u'], 3]],
  ['sqrt(q(u))', ['Sqrt', ['q', 'u']]],
  ['1 + sin(q(u))', ['Add', 1, ['Sin', ['q', 'u']]]],
  ['1 + p(q(u))', ['Add', 1, ['p', ['q', 'u']]]],
  ['q(u) + q(u)', ['Add', ['q', 'u'], ['q', 'u']]],
  ['Sum(k q(u), k = 1..3)', ['Sum', ['Multiply', 'k', ['q', 'u']], ['Limits', 'k', 1, 3]]],
  ['1 + If(w > 0, q(u), 0)', ['Add', 1, ['If', ['Greater', 'w', 0], ['q', 'u'], 0]]],
  [
    'Block(z := q(u); 1 + z)',
    ['Block', ['Assign', 'z', ['q', 'u']], ['Add', 1, 'z']],
  ],
  // The value of the block is a local that holds the call: the block is not
  // being compiled when the `+` is, so the local is read through the values
  // that the block assigns to it.
  ['1 + Block(z := q(u); z)', ['Add', 1, ['Block', ['Assign', 'z', ['q', 'u']], 'z']]],
  // The value of a `Declare` in its attributes, and a destructuring
  // assignment whose matching component is the call.
  [
    '1 + Block(Declare(z, {value: q(u)}); z)',
    [
      'Add',
      1,
      [
        'Block',
        ['Declare', 'z', ['Dictionary', ['Tuple', "'value'", ['q', 'u']]]],
        'z',
      ],
    ],
  ],
  [
    '1 + Block((z, y) := (q(u), 0); z)',
    [
      'Add',
      1,
      [
        'Block',
        ['Assign', ['Tuple', 'z', 'y'], ['Tuple', ['q', 'u'], 0]],
        'z',
      ],
    ],
  ],
];

describe('an operator over a call that maps over a list argument', () => {
  for (const [label, json] of CASES) {
    test(`${label}: the interpreter's value for a list and for a number`, () => {
      for (const u of [[1, 2, 3], 2]) {
        const expected = interpret(json, u);
        const actual = run(json, { u, w: 1 });
        if (Array.isArray(expected)) {
          expect(Array.isArray(actual)).toBe(true);
          (expected as unknown[]).forEach((e, i) => {
            if (typeof e === 'number')
              expect((actual as number[])[i]).toBeCloseTo(e, 12);
            else expect((actual as unknown[])[i]).toBe(e);
          });
        } else if (typeof expected === 'number')
          expect(actual as number).toBeCloseTo(expected, 12);
        else expect(actual).toBe(expected);
      }
    });
  }

  test('1 + q(u) broadcasts the sum when the call gives a list', () => {
    // The call is evaluated once, into a temporary. A number takes the
    // scalar `+`, so a scalar evaluation does not pay the closure call of
    // `_SYS.bcast` (`callResultGuard`, `compile-expr-handlers.ts`). The
    // parameter `u` has no type.
    const result = compileFn(['Add', 1, ['q', 'u']], ['u']);
    const text = String(result.code).replace(/\s+/g, ' ');
    expect(text).toContain('const _js1 = _SYS.bcastFn(_fn_q, u);');
    expect(text).toContain(
      'return ((Array.isArray(_tv1) || _tv1 === undefined) ? ' +
        '_SYS.bcast((_tv2, _tv3) => (_tv2 + _tv3), _tv1, 1) : _tv1 + 1);'
    );
    expect(result.run([1, 2, 3])).toEqual([3, 5, 7]);
    expect(result.run(2)).toBe(5);
  });

  // The local `t` holds a value built from shared subtrees: 30 levels of
  // `Beta(t_{n-1}, t_{n-1})` have 31 distinct nodes and 2^30 paths. The
  // walk of the block visits each node once, so the compilation ends.
  test('a block local assigned a deep shared subtree next to q(u)', () => {
    const ce = engine();
    let t = ce.box('x');
    for (let i = 0; i < 30; i++) t = ce.function('Beta', [t, t]);
    const json = ce.function('Add', [
      ce.box(1),
      ce.function('Block', [
        ce.function('Assign', [ce.symbol('t'), t]),
        ce.function('Assign', [ce.symbol('z'), ce.box(['q', 'u'])]),
        ce.symbol('z'),
      ]),
    ]);
    const result = compile(json, {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(result.run({ u: [1, 2, 3], x: 1 })).toEqual([3, 5, 7]);
    expect(result.run({ u: 2, x: 1 })).toBe(5);
  });

  test('a call in a branch of an If is not evaluated before the test', () => {
    const text = code(['Add', 1, ['If', ['Greater', 'w', 0], ['q', 'u'], 0]]);
    expect(text).toContain('_SYS.bcast(');
    expect(text).not.toContain('Array.isArray');
  });

  test('a Return of the call in a block: the sum maps over the list', () => {
    // The interpreter gives no value here (`1 + Return([2, 4, 6])` stays
    // unevaluated), so only the compiled value is checked: before, it was
    // the string "2,4,61".
    const json = [
      'Add',
      1,
      [
        'Block',
        ['Assign', 'z', ['q', 'u']],
        ['If', ['Greater', 'w', 0], ['Return', 'z']],
        0,
      ],
    ];
    expect(run(json, { u: [1, 2, 3], w: 1 })).toEqual([3, 5, 7]);
    expect(run(json, { u: 2, w: 1 })).toBe(5);
  });

  test('a call in an operand of And is not evaluated before the And', () => {
    // `And` does not evaluate its second operand when the first one is
    // false, so the call must not be evaluated before the `And`: the call
    // (and its run-time test, on the comparison) comes after the test of the
    // first operand.
    // The parameters `b` and `u` have no type.
    const json = ['Not', ['And', 'b', ['Greater', ['q', 'u'], 0]]];
    const text = String(compileFn(json, ['b', 'u']).code);
    expect(text.indexOf('=== false ? false')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('=== false ? false')).toBeLessThan(
      text.indexOf('_SYS.bcastFn(_fn_q')
    );
    expect(compileFn(json, ['b', 'u']).run(false, 2)).toBe(true);
    // With the first operand `False`, the code maps the `And` over its
    // operands (`_SYS.bcastPlain`), which evaluates the call first. The
    // call is pure, so the value is the interpreter's.
    expect(
      compileFn(['Not', ['And', 'False', ['Greater', ['q', 'u'], 0]]], ['u']).run(
        2
      )
    ).toBe(true);
    expect(
      compileFn(['Not', ['And', 'b', ['Greater', ['q', 'u'], 0]]], ['b', 'u']).run(
        true,
        2
      )
    ).toBe(false);
  });

  test('a call in a chain of comparisons: y < 0 < q(u) at y = 1', () => {
    // The parameters `y` and `u` have no type. The chain maps over the list
    // that the call gives, as the interpreter does when `u` has no type,
    // and the code has no run-time test of the call.
    const json = ['Less', 'y', 0, ['q', 'u']];
    const result = compileFn(json, ['y', 'u']);
    expect(String(result.code)).not.toContain('Array.isArray');
    for (const u of [[1, 2, 3], 2])
      expect(result.run(1, u)).toEqual(interpretUntyped(json, { y: 1, u }));
    expect(result.run(1, [1, 2, 3])).toEqual([false, false, false]);
    expect(result.run(1, 2)).toBe(false);
  });

  test('Random() / q(u) keeps the order of the operands', () => {
    // The run-time test of the call would evaluate the call before
    // `Random()`.
    const text = code(['Divide', ['Random'], ['q', 'u']]);
    expect(text).not.toContain('Array.isArray');
    expect(text.indexOf('drawNextRandomNumber')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('drawNextRandomNumber')).toBeLessThan(
      text.indexOf('_fn_q')
    );
  });

  test('another list operand: no run-time test of the call', () => {
    const ce = engine();
    ce.declare('L', 'list<number>');
    const result = compile(ce.box(['Add', 'L', ['q', 'u']]), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(result.code).not.toContain('Array.isArray');
    expect(result.run({ L: [1, 2], u: 3 })).toEqual([7, 8]);
    expect(result.run({ L: [1, 2], u: [1, 2] })).toEqual([3, 6]);
  });

  test('a complex-valued function: 1 + h(u) with h := t ↦ t + i', () => {
    // The complex element lane reads the result of the call by its shape at
    // run time (`_SYS.sadd`). Before, this declined, also for a `u` declared
    // `list<number>`. With no declaration, `u` is a parameter with no type:
    // an input with no type is refused.
    for (const declared of [undefined, 'list<number>']) {
      const ce = new ComputeEngine();
      ce.declare('h', 'function');
      ce.assign('h', ce.parse('t\\mapsto t+i'));
      if (declared !== undefined) ce.declare('u', declared);
      const json = ['Add', 1, ['h', 'u']];
      const result = compile(
        ce.box(declared === undefined ? ['Function', json, 'u'] : json),
        { to: 'javascript', fallback: false } as any
      ) as any;
      const call = (u: unknown): unknown =>
        declared === undefined ? result.run(u) : result.run({ u });
      expect(call([1, 2])).toEqual([
        { re: 2, im: 1 },
        { re: 3, im: 1 },
      ]);
      if (declared === undefined) expect(call(3)).toEqual({ re: 4, im: 1 });
    }
  });

  test('an input declared a number keeps the scalar code', () => {
    // A list for `u` breaks the host's input contract here.
    const ce = engine({ u: 'number' });
    const result = compile(ce.box(['Add', 1, ['q', 'u']]), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(result.code).not.toContain('_SYS.bcast(');
    expect(result.run({ u: 2 })).toBe(5);
  });
});
