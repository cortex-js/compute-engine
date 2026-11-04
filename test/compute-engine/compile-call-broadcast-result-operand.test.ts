/**
 * An operator over a call of a user function that maps over a list argument.
 *
 * With `q(t) := 2t`, the JavaScript call `q(u)` maps `q` over a list
 * argument, as the interpreter does. An earlier version compiled the
 * operator around the call as scalar code: `1 + q(u)` was
 * `_SYS.bcastFn(_fn_q, _.u) + 1`, which ran to the string `"2,4,61"` at
 * `u = [1, 2, 3]`, where the interpreter gives `[3, 5, 7]`.
 *
 * The shape of the call is now settled at compile time from the static type
 * of `u` (`docs/plans/2026-10-31-static-shape-compilation.md`). Most tests
 * declare `u: real | list<real>`: the code tests `Array.isArray(_.u)` once,
 * at the input, and holds one body per shape. In the list body the call is a
 * static map (`_SYS.mapFn(_fn_q, [1], _.u)`) with a list type, so the
 * operator maps over its result (`_SYS.bcast`); in the scalar body the call
 * and the operator are scalar code. The code has no run-time test of the
 * value of the call. When a member body has no settled shape (an `If` whose
 * branches are a list and a number), the compilation declines.
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
 * An input with no type is refused, but a parameter with no type is not:
 * the root function is compiled with scalar parameters, and a list given
 * for one of them is a value outside that type.
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
  [
    'Block(z := q(u); 1 + z)',
    ['Block', ['Assign', 'z', ['q', 'u']], ['Add', 1, 'z']],
  ],
  // The value of a `Declare` in its attributes. A block of declarations is a
  // value expression, so it compiles as an operand.
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
];

// A block with an assignment as the operand of an operator declines: such a
// block compiles only as a statement, or as the body of a function or of
// the compiled expression.
const BLOCK_OPERAND_CASES: [string, Json][] = [
  ['1 + Block(z := q(u); z)', ['Add', 1, ['Block', ['Assign', 'z', ['q', 'u']], 'z']]],
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
  for (const [label, json] of BLOCK_OPERAND_CASES) {
    test(`${label}: declines`, () => {
      for (const u of ['real | list<real>', 'real', 'list<real>']) {
        const result = compile(engine({ u }).box(json), {
          to: 'javascript',
        } as any) as any;
        expect(result.success).toBe(false);
        // For the union input, the decline of the list body is reported as
        // a call whose argument has no settled shape.
        if (u !== 'real | list<real>')
          expect(result.error).toMatch(
            /a block with a statement other than a declaration with a value is an operand/
          );
      }
    });
  }

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
    // A parameter with no type is a scalar of the root function: the call
    // and the sum are scalar code.
    const result = compileFn(['Add', 1, ['q', 'u']], ['u']);
    const text = String(result.code).replace(/\s+/g, ' ');
    expect(text).toContain('return _fn_q(u) + 1;');
    expect(result.run(2)).toBe(5);
    // An input declared as a list: the call maps, and the sum maps over the
    // list that the call gives. There is no run-time test of a shape.
    const listCode = code(['Add', 1, ['q', 'u']], { u: 'list<real>' });
    expect(listCode).toBe(
      '_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _SYS.mapFn(_fn_q, [1], _.u), 1)'
    );
    expect(run(['Add', 1, ['q', 'u']], { u: [1, 2, 3] }, { u: 'list<real>' })).toEqual(
      interpret(['Add', 1, ['q', 'u']], [1, 2, 3])
    );
  });

  test('1 + If(w > 0, q(u), 0) declines for a union input: the list body has two shapes', () => {
    // In the body for `u: list<real>`, one branch is a list and the other a
    // number, so the shape of the `If` is known only at run time.
    const json = ['Add', 1, ['If', ['Greater', 'w', 0], ['q', 'u'], 0]];
    const result = compile(engine().box(json), { to: 'javascript' } as any) as any;
    expect(result.success).toBe(false);
    // The compilation declines with the reason of that body.
    expect(result.diagnostic?.code).toBe('unsettled-shape');
    expect(result.unsupported).toContain('If(0 < w, q(u), 0)');
    // With `u` declared `real`, the shape is settled.
    expect(run(json, { u: 2, w: 1 }, { u: 'real' })).toBeCloseTo(
      interpret(json, 2) as number,
      12
    );
    // With `u` declared `list<real>` and two list branches, the shape is
    // settled too.
    const lists = ['Add', 1, ['If', ['Greater', 'w', 0], ['q', 'u'], 'u']];
    expect(run(lists, { u: [1, 2, 3], w: 1 }, { u: 'list<real>' })).toEqual(
      interpret(lists, [1, 2, 3])
    );
  });

  // The local `deep` holds a value built from shared subtrees: 30 levels of
  // `Beta(t_{n-1}, t_{n-1})` have 31 distinct nodes and 2^30 paths. The
  // walk of the block visits each node once, so the compilation ends.
  test('a block local assigned a deep shared subtree next to q(u)', () => {
    const ce = engine();
    let t = ce.box('x');
    for (let i = 0; i < 30; i++) t = ce.function('Beta', [t, t]);
    // The local is not named `t`: the engine already knows `t` (the
    // parameter of `q`), and a write to a symbol of the engine declines.
    // The block is boxed as a whole: `ce.symbol('deep')` alone would declare
    // `deep` in the engine, and the block would then write an engine symbol.
    const json = ce.box([
      'Block',
      ['Assign', 'deep', t],
      ['Assign', 'z', ['q', 'u']],
      ['Add', 1, 'z'],
    ] as any);
    const result = compile(json, {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(result.run({ u: [1, 2, 3], x: 1 })).toEqual([3, 5, 7]);
    expect(result.run({ u: 2, x: 1 })).toBe(5);
  });

  test('a call in a branch of an If is not evaluated before the test', () => {
    const text = code(['Add', 1, ['If', ['Greater', 'w', 0], ['q', 'u'], 'u']], {
      u: 'list<real>',
    });
    expect(text).toBe(
      '_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), ((0 < _.w) ? (_SYS.mapFn(_fn_q, [1], _.u)) : (_.u)), 1)'
    );
  });

  test('a block with a Return of the call as an operand declines', () => {
    // A block with an assignment as the operand of an operator declines.
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
    for (const u of ['real | list<real>', 'real', 'list<real>']) {
      const result = compile(engine({ u }).box(json), {
        to: 'javascript',
      } as any) as any;
      expect(result.success).toBe(false);
    }
  });

  test('a call in an operand of And is not evaluated before the And', () => {
    // `And` does not evaluate its second operand when the first one is
    // false, so the call must not be evaluated before the `And`: the call
    // is in the second operand of the `&&`.
    // The parameters `b` and `u` have no type; `b` is inferred `boolean`.
    const json = ['Not', ['And', 'b', ['Greater', ['q', 'u'], 0]]];
    const text = String(compileFn(json, ['b', 'u']).code);
    expect(text).toContain('!(b && 0 < _fn_q(u))');
    expect(compileFn(json, ['b', 'u']).run(false, 2)).toBe(true);
    // With the first operand `False`, the code maps the `And` over its
    // operands (`_SYS.bcast`), which evaluates the call first. The call is
    // pure, so the value is the interpreter's.
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
    // The parameters `y` and `u` have no type: they are scalars of the root
    // function, and the chain is scalar code.
    const json = ['Less', 'y', 0, ['q', 'u']];
    const result = compileFn(json, ['y', 'u']);
    expect(String(result.code)).not.toContain('Array.isArray');
    expect(result.run(1, 2)).toEqual(interpretUntyped(json, { y: 1, u: 2 }));
    expect(result.run(1, 2)).toBe(false);
    // With `u` declared as a list, the chain maps over the list that the
    // call gives, as the interpreter does, and the code has no run-time
    // test of the call.
    const types = { u: 'list<real>', y: 'real' };
    expect(code(json, types)).not.toContain('Array.isArray');
    for (const y of [1, -1])
      expect(run(json, { y, u: [1, 2, 3] }, types)).toEqual(
        interpretUntyped(json, { y, u: [1, 2, 3] })
      );
  });

  test('Random() / q(u) keeps the order of the operands', () => {
    // A run-time test of the value of the call would evaluate the call
    // before `Random()`. The only test is of the input `u`, and in each
    // body the draw comes before the call.
    const text = code(['Divide', ['Random'], ['q', 'u']]);
    expect(text).toBe(
      '(Array.isArray(_.u) ? _SYS.bcast((_tv1, _tv2) => ((_tv1) / (_tv2)), _SYS.drawNextRandomNumber(), _SYS.mapFn(_fn_q, [1], _.u)) : _SYS.drawNextRandomNumber() / _fn_q(_.u))'
    );
  });

  test('another list operand: no run-time test of the call', () => {
    const ce = engine();
    ce.declare('L', 'list<number>');
    const result = compile(ce.box(['Add', 'L', ['q', 'u']]), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    // The only run-time test is of the input `u` (one body per member of
    // its type), not of the value of the call.
    expect(result.code).toBe(
      '(Array.isArray(_.u) ? _SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.L, _SYS.mapFn(_fn_q, [1], _.u)) : _SYS.bcast((_tv3, _tv4) => (_tv3 + _tv4), _.L, _fn_q(_.u)))'
    );
    expect(result.run({ L: [1, 2], u: 3 })).toEqual([7, 8]);
    expect(result.run({ L: [1, 2], u: [1, 2] })).toEqual([3, 6]);
  });

  test('a complex-valued function: 1 + h(u) with h := t ↦ t + i', () => {
    // The complex element lane reads the result of the call by its shape at
    // run time (`_SYS.sadd`). Before, this declined, also for a `u` declared
    // `list<number>`. With no declaration, `u` is a parameter with no type:
    // an input with no type is refused. A parameter with no type is a scalar
    // of the root function, so only a number is given for it.
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
      if (declared !== undefined)
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
