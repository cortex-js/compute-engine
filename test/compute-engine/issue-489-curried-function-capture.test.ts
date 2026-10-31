/**
 * GitHub issue #489: the application of a curried function literal
 * substitutes the value of the outer parameter into the result without
 * capture. With `F = y ↦ (x ↦ y^x)`, `F(x)` gave `x ↦ x^x`: the free `x` of
 * the value became the parameter of the inner literal, and `F(x)(y)` gave
 * `y^y`, not `x^y`. The compiled route gave `x^y`.
 *
 * Now the post-evaluation substitution of a call (`bindingKeyedSubs`,
 * `function-utils.ts`) renames a bound name of a binder of the result (a
 * nested literal, or a scoped operator such as `Sum`) when that name is free
 * in the value and the binder holds an occurrence of the parameter. The fresh
 * name is the name with a suffix that is not used in the expression (`x_1`).
 * A binder that captures nothing keeps its names. When a correct rename
 * cannot be decided before the result runs (the target of an `Assign` of a
 * held block, a local that a `Declare` in a branch of an `If` declares), the
 * application stays unevaluated: it gives no value, never a wrong one.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { rewriteWithBinders } from '../../src/compute-engine/boxed-expression/binders';

const F = ['Function', ['Function', ['Power', 'y', 'x'], 'x'], 'y'];
const G = ['Function', ['Function', ['Add', 'y', 'x'], 'x'], 'y'];

const ce = new ComputeEngine();
const evaluate = (expr: unknown) => ce.box(expr as any).evaluate();
const json = (expr: unknown) => evaluate(expr).json;

describe('a curried function literal applied to a free symbol', () => {
  test('the inner parameter is renamed when the value mentions it', () => {
    const result = evaluate([F, 'x']);
    expect(result.json).toEqual([
      'Function',
      ['Block', ['Power', 'x', 'x_1']],
      'x_1',
    ]);
    expect(
      result.isSame(ce.box(['Function', ['Power', 'x', 'x_1'], 'x_1']))
    ).toBe(true);
  });

  test('the curried application gives x^y, not y^y', () => {
    expect(json([[F, 'x'], 'y'])).toEqual(['Power', 'x', 'y']);
    expect(json([[F, 'x'], 2])).toEqual(['Power', 'x', 2]);
  });

  test('the Apply form gives the same result', () => {
    expect(json(['Apply', ['Apply', F, 'x'], 'y'])).toEqual([
      'Power',
      'x',
      'y',
    ]);
  });

  test('a sum gives x + y, not 2y', () => {
    expect(json([[G, 'x'], 'y'])).toEqual(['Add', 'x', 'y']);
  });

  test('the renamed literal can be applied again', () => {
    const fx = evaluate([F, 'x']);
    expect(json([fx, 3])).toEqual(['Power', 'x', 3]);
    expect(json([fx, 'x'])).toEqual(['Power', 'x', 'x']);
  });

  test('a fresh name that is used is skipped', () => {
    const H = [
      'Function',
      ['Function', ['Add', 'y', 'x', 'x_1'], 'x'],
      'y',
    ];
    expect(json([H, 'x'])).toEqual([
      'Function',
      ['Block', ['Add', 'x', 'x_1', 'x_2']],
      'x_2',
    ]);
    expect(json([[H, 'x'], 5])).toEqual(['Add', 'x', 'x_1', 5]);
  });

  test('an inner binder of the same name keeps its own variable', () => {
    // y ↦ (x ↦ (x ↦ y + x)): the innermost x is bound by the innermost
    // literal.
    const K = [
      'Function',
      ['Function', ['Function', ['Add', 'y', 'x'], 'x'], 'x'],
      'y',
    ];
    expect(json([[[K, 'x'], 1], 2])).toEqual(['Add', 'x', 2]);
  });

  test('a named argument uses the new name of a renamed parameter', () => {
    // G(x) is x_1 ↦ x + x_1: a named argument must use the name x_1. The
    // result of G(z) keeps the name x.
    const named = (name: string, value: unknown) => [
      'NamedArgument',
      { str: name },
      value,
    ];
    const gx = evaluate([G, 'x']);
    expect(evaluate(['Apply', gx, named('x_1', 2)]).json).toEqual([
      'Add',
      'x',
      2,
    ]);
    const wrong = evaluate(['Apply', gx, named('x', 2)]);
    expect(JSON.stringify(wrong.json)).toContain('argument-name-unknown');
    expect(evaluate(['Apply', evaluate([G, 'z']), named('x', 2)]).json).toEqual(
      ['Add', 'z', 2]
    );
  });

  test('a value with a compound expression is not captured', () => {
    expect(json([[F, ['Add', 'x', 1]], 'y'])).toEqual([
      'Power',
      ['Add', 'x', 1],
      'y',
    ]);
  });
});

describe('a capture under a scoped operator', () => {
  const S = [
    'Function',
    [
      'Function',
      ['Sum', ['Multiply', 'y', 'x', 'k'], ['Limits', 'k', 1, 3]],
      'x',
    ],
    'y',
  ];

  test('the index of a sum in the returned literal is renamed', () => {
    expect(json([S, 'k'])).toEqual([
      'Function',
      [
        'Block',
        ['Sum', ['Multiply', 'k', 'k_1', 'x'], ['Limits', 'k_1', 1, 3]],
      ],
      'x',
    ]);
    // Σ_{k'=1}^{3} k·2·k' = 12k, not Σ 2k² = 28.
    expect(json([[S, 'k'], 2])).toEqual(['Multiply', 12, 'k']);
  });

  test('the index of a sum in the body of the called literal is renamed', () => {
    const T = [
      'Function',
      ['Sum', ['Multiply', 'y', 'k'], ['Limits', 'k', 1, 3]],
      'y',
    ];
    expect(json([T, 'k'])).toEqual(['Multiply', 6, 'k']);
    expect(json([T, 2])).toEqual(12);
  });
});

describe('a capture by a local of a block', () => {
  // A local that an `Assign` or a `Declare` statement makes is bound by the
  // block, although the scope of the block does not hold its binding when
  // the block is not running. Each test uses a new engine: once `t` is
  // declared at the top level, `t ≔ 1` in a block canonicalized after it
  // writes that `t` and makes no local.
  test('a local made by an assignment is renamed', () => {
    const L = [
      'Function',
      [
        'Function',
        ['Block', ['Assign', 't', 1], ['Add', 't', 'y', 'x']],
        'x',
      ],
      'y',
    ];
    expect(new ComputeEngine().box([L, 't'] as any).evaluate().json).toEqual([
      'Function',
      ['Block', ['Assign', 't_1', 1], ['Add', 't', 't_1', 'x']],
      'x',
    ]);
    // 1 + t + 5, not 1 + 1 + 5.
    expect(
      new ComputeEngine().box([[L, 't'], 5] as any).evaluate().json
    ).toEqual(['Add', 't', 6]);
  });

  test('a local made by a declaration is renamed', () => {
    const L = [
      'Function',
      [
        'Function',
        [
          'Block',
          ['Declare', 't', "'integer'"],
          ['Assign', 't', 1],
          ['Add', 't', 'y', 'x'],
        ],
        'x',
      ],
      'y',
    ];
    expect(new ComputeEngine().box([L, 't'] as any).evaluate().json).toEqual([
      'Function',
      [
        'Block',
        ['Declare', 't_1', "'integer'"],
        ['Assign', 't_1', 1],
        ['Add', 't', 't_1', 'x'],
      ],
      'x',
    ]);
    expect(
      new ComputeEngine().box([[L, 't'], 5] as any).evaluate().json
    ).toEqual(['Add', 't', 6]);
  });
});

describe('an inner literal with several parameters', () => {
  test('a parameter of a multi-parameter literal is renamed', () => {
    const M = [
      'Function',
      ['Function', ['Add', 'y', ['Multiply', 'x', 'z']], 'x', 'z'],
      'y',
    ];
    expect(json([[M, 'x'], 2, 3])).toEqual(['Add', 'x', 6]);
  });

  test('a leaf of a destructuring parameter is renamed', () => {
    const D = [
      'Function',
      ['Function', ['Add', 'y', ['Multiply', 'a', 'b']], ['Tuple', 'a', 'b']],
      'y',
    ];
    expect(json([D, 'a'])).toEqual([
      'Function',
      ['Block', ['Add', ['Multiply', 'a_1', 'b'], 'a']],
      ['Tuple', 'a_1', 'b'],
    ]);
    expect(json([[D, 'a'], ['Tuple', 2, 3]])).toEqual(['Add', 'a', 6]);
  });

  test('a parameter called as a function is renamed in the call', () => {
    // y ↦ (f ↦ f(y)) applied to f, then to t ↦ 2t: 2f.
    const C = ['Function', ['Function', ['f', 'y'], 'f'], 'y'];
    expect(
      json([[C, 'f'], ['Function', ['Multiply', 2, 't'], 't']])
    ).toEqual(['Multiply', 2, 'f']);
  });

  test('a parameter of a held literal is renamed in a call', () => {
    // y ↦ Hold(f ↦ f(y)) applied to f: the held literal is not canonical,
    // and its parameter is renamed by name, also as the operator of the
    // call. f_1 ↦ f(f) would apply the free f.
    const H = ['Function', ['Hold', ['Function', ['f', 'y'], 'f']], 'y'];
    const held = evaluate([H, 'f']);
    expect(held.json).toEqual(['Hold', ['Function', ['f_1', 'f'], 'f_1']]);
    const released = evaluate(['ReleaseHold', held]);
    expect(
      json([released, ['Function', ['Multiply', 2, 't'], 't']])
    ).toEqual(['Multiply', 2, 'f']);
  });
});

describe('a binder that captures nothing is kept', () => {
  test('a value with no name of the inner parameter', () => {
    expect(json([F, 'z'])).toEqual([
      'Function',
      ['Block', ['Power', 'z', 'x']],
      'x',
    ]);
    expect(json([[F, 'z'], 'w'])).toEqual(['Power', 'z', 'w']);
    expect(json([[F, 2], 3])).toEqual(8);
  });

  test('a literal with no occurrence of the parameter keeps its names', () => {
    // y ↦ (y, x ↦ x²) applied to x: the literal does not read y, so it is
    // not renamed, although the value is x.
    const P = [
      'Function',
      ['Tuple', 'y', ['Function', ['Power', 'x', 2], 'x']],
      'y',
    ];
    expect(json([P, 'x'])).toEqual([
      'Tuple',
      'x',
      ['Function', ['Block', ['Power', 'x', 2]], 'x'],
    ]);
  });

  test('the walk keeps every node when the binder hook renames nothing', () => {
    // `rewriteWithBinders` calls the hook for each binder and rebuilds
    // nothing when neither the hook nor the visitor replaces a node.
    const expr = ce.box([
      'Tuple',
      'y',
      ['Function', ['Power', 'x', 2], 'x'],
      ['Sum', 'k', ['Limits', 'k', 1, 3]],
    ] as any);
    const seen: string[] = [];
    const result = rewriteWithBinders(
      expr,
      (sym) => sym,
      undefined,
      false,
      undefined,
      undefined,
      (node) => {
        seen.push(node.operator);
        return undefined;
      }
    );
    expect(result).toBe(expr);
    expect(seen).toEqual(expect.arrayContaining(['Function', 'Sum']));
  });
});

describe('the interpreter and the compiled code agree', () => {
  test('F(x)(y) at x = 2, y = 3', () => {
    const expr = ce.box([[F, 'x'], 'y'] as any);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    const run = compiled.run as (vars: Record<string, number>) => number;
    expect(run({ x: 2, y: 3 })).toEqual(8);
    expect(expr.evaluate().subs({ x: 2, y: 3 }).N().json).toEqual(8);
  });

  test('G(x)(y) at x = 2, y = 3', () => {
    const expr = ce.box([[G, 'x'], 'y'] as any);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    const run = compiled.run as (vars: Record<string, number>) => number;
    expect(run({ x: 2, y: 3 })).toEqual(5);
    expect(expr.evaluate().subs({ x: 2, y: 3 }).N().json).toEqual(5);
  });
});

describe('a renamed binder with nested scopes', () => {
  // Each test uses a new engine: a free `t` that an earlier test boxed is
  // declared in the engine, and an assignment to a declared name writes it
  // instead of making a local of the block.
  const run = (expr: unknown, engine = new ComputeEngine()) =>
    engine.box(expr as any).evaluate();

  // y ↦ (x ↦ { t ≔ 1; { t ≔ 2; t + y }; t + y + x }): the inner block
  // writes the local t of the body. Applied to t, then to 5: t + 7.
  const N = [
    'Function',
    [
      'Function',
      [
        'Block',
        ['Assign', 't', 1],
        ['Block', ['Assign', 't', 2], ['Add', 't', 'y']],
        ['Add', 't', 'y', 'x'],
      ],
      'x',
    ],
    'y',
  ];
  // The same with no assignment in the body block: the assignment of the
  // inner block makes a local of the body, which owns it.
  const N2 = [
    'Function',
    [
      'Function',
      [
        'Block',
        ['Block', ['Assign', 't', 2], ['Add', 't', 'y']],
        ['Add', 't', 'y', 'x'],
      ],
      'x',
    ],
    'y',
  ];

  test('the inner block writes the renamed local of the body (one step)', () => {
    expect(run([[N, 't'], 5]).json).toEqual(['Add', 't', 7]);
    expect(run([[N2, 't'], 5]).json).toEqual(['Add', 't', 7]);
  });

  test('the inner block writes the renamed local of the body (two steps)', () => {
    for (const F of [N, N2]) {
      const engine = new ComputeEngine();
      const r = run(['Apply', F, 't'], engine);
      expect(run(['Apply', r, 5], engine).json).toEqual(['Add', 't', 7]);
      // A second run of the same literal gives a new local.
      expect(run(['Apply', r, 6], engine).json).toEqual(['Add', 't', 8]);
    }
    expect(run(['Apply', N2, 't']).json).toEqual([
      'Function',
      [
        'Block',
        ['Block', ['Assign', 't_1', 2], ['Add', 't_1', 'y']],
        ['Add', 't', 't_1', 'x'],
      ],
      'x',
    ]);
  });

  test('a sum in a renamed literal reads the renamed parameter', () => {
    // y ↦ (x ↦ Σ_{k=1}^{3} y·k·x) applied to x: x_1 ↦ Σ x·k·x_1, and
    // applied to 2: 12x.
    const S = [
      'Function',
      [
        'Function',
        ['Sum', ['Multiply', 'y', 'k', 'x'], ['Limits', 'k', 1, 3]],
        'x',
      ],
      'y',
    ];
    const engine = new ComputeEngine();
    const r = run(['Apply', S, 'x'], engine);
    expect(r.json).toEqual([
      'Function',
      ['Block', ['Sum', ['Multiply', 'k', 'x', 'x_1'], ['Limits', 'k', 1, 3]]],
      'x_1',
    ]);
    expect(run(['Apply', r, 2], engine).json).toEqual(['Multiply', 12, 'x']);
    expect(run([[S, 'x'], 2]).json).toEqual(['Multiply', 12, 'x']);
  });

  // A `Declare` in a branch of an `If` with no block declares a local of
  // the body block only when the branch runs, and only from that statement
  // on (`blockLocals`, `function-utils.ts`). Which reads denote the local is
  // known only when the body runs, so an application that would have to
  // rename such a local stays unevaluated: it gives no value, never a wrong
  // one.
  const declaredInBranch = (body: unknown) => [
    'Function',
    ['Function', body, 'x'],
    'y',
  ];
  const isDeclined = (e: { operator: string }) => e.operator === 'Apply';

  test('a local declared in a branch with no block declines', () => {
    const D = declaredInBranch([
      'Block',
      ['If', 'True', ['Declare', 't', "'integer'"], 0],
      ['Add', 't', 'y', 'x'],
    ]);
    expect(isDeclined(run(['Apply', D, 't']))).toBe(true);
    expect(isDeclined(run([[D, 't'], 5]))).toBe(true);
  });

  test('a branch that does not run declares no local: declines', () => {
    // The t of the sum is the value t: a rename gave t + t_1 + 5, not 2t + 5.
    const D = declaredInBranch([
      'Block',
      ['If', 'False', ['Declare', 't', "'integer'"], 0],
      ['Add', 't', 'y', 'x'],
    ]);
    expect(isDeclined(run(['Apply', D, 't']))).toBe(true);
    expect(isDeclined(run([[D, 't'], 5]))).toBe(true);
  });

  test('a read in the other branch of the same If: declines', () => {
    const D = declaredInBranch([
      'Block',
      ['If', 'False', ['Declare', 't', "'integer'"], ['Add', 't', 'y', 'x']],
    ]);
    expect(isDeclined(run(['Apply', D, 't']))).toBe(true);
    expect(isDeclined(run([[D, 't'], 5]))).toBe(true);
  });

  test('a read before a declaration in a branch: declines', () => {
    const D = declaredInBranch([
      'Block',
      ['Assign', 'w', ['Add', 't', 'y']],
      ['If', 'True', ['Declare', 't', "'integer'"], 0],
      ['List', 'w', ['Add', 't', 'x']],
    ]);
    expect(isDeclined(run(['Apply', D, 't']))).toBe(true);
  });

  test('a value with no name of the local is substituted', () => {
    const D = declaredInBranch([
      'Block',
      ['If', 'False', ['Declare', 't', "'integer'"], 0],
      ['Add', 't', 'y', 'x'],
    ]);
    expect(run([[D, 'u'], 5]).json).toEqual(['Add', 't', 'u', 5]);
  });
});

describe('a held binder', () => {
  const run = (expr: unknown, engine: ComputeEngine) =>
    engine.box(expr as any).evaluate();

  test('the index of a held sum is renamed', () => {
    // y ↦ Hold(Σ_{k=1}^{3} y·k) applied to k: released, 6k, not 14.
    const engine = new ComputeEngine();
    const H = [
      'Function',
      ['Hold', ['Sum', ['Multiply', 'y', 'k'], ['Limits', 'k', 1, 3]]],
      'y',
    ];
    const held = run([H, 'k'], engine);
    expect(held.json).toEqual([
      'Hold',
      ['Sum', ['Multiply', 'k', 'k_1'], ['Limits', 'k_1', 1, 3]],
    ]);
    expect(run(['ReleaseHold', held], engine).json).toEqual([
      'Multiply',
      6,
      'k',
    ]);
  });

  test('the bound of the own clause of a held sum keeps its name', () => {
    // y ↦ Hold(Σ_{k=1}^{k} y·k): the upper bound reads the k outside.
    const engine = new ComputeEngine();
    const H = [
      'Function',
      ['Hold', ['Sum', ['Multiply', 'y', 'k'], ['Limits', 'k', 1, 'k']]],
      'y',
    ];
    expect(run([H, 'k'], engine).json).toEqual([
      'Hold',
      ['Sum', ['Multiply', 'k', 'k_1'], ['Limits', 'k_1', 1, 'k']],
    ]);
  });

  test('a declared local of a held block is renamed', () => {
    // y ↦ Hold({ t: integer; t ≔ 1; t + y }) applied to t: released,
    // t + 1, not 2.
    const engine = new ComputeEngine();
    const H = [
      'Function',
      [
        'Hold',
        [
          'Block',
          ['Declare', 't', "'integer'"],
          ['Assign', 't', 1],
          ['Add', 't', 'y'],
        ],
      ],
      'y',
    ];
    const held = run([H, 't'], engine);
    expect(held.json).toEqual([
      'Hold',
      [
        'Block',
        ['Declare', 't_1', "'integer'"],
        ['Assign', 't_1', 1],
        ['Add', 't_1', 't'],
      ],
    ]);
    expect(run(['ReleaseHold', held], engine).json).toEqual(['Add', 't', 1]);
  });

  test('an assignment target of a held block that would capture declines', () => {
    // The target of an `Assign` of a held block is a local of the block
    // only when the name is not visible where the block is released. With
    // `s` declared, the block released assigns the declared `s` and gives
    // 6: a rename to s_1 gave s + 3 and left `s` with no value. The
    // application stays unevaluated and writes nothing.
    const engine = new ComputeEngine();
    engine.declare('s', 'integer');
    const H = [
      'Function',
      ['Hold', ['Block', ['Assign', 's', 3], ['Add', 'y', 's']]],
      'y',
    ];
    expect(run([H, 's'], engine).operator).toBe('Apply');
    expect(engine.box('s').evaluate().json).toBe('s');
    expect(
      run(['Block', ['Assign', 's', 3], ['Add', 's', 's']], engine).json
    ).toBe(6);
  });

  test('an assignment target of a held block that is not free in the value', () => {
    const engine = new ComputeEngine();
    const H = [
      'Function',
      ['Hold', ['Block', ['Assign', 't', 1], ['Add', 't', 'y']]],
      'y',
    ];
    expect(run([H, 'u'], engine).json).toEqual([
      'Hold',
      ['Block', ['Assign', 't', 1], ['Add', 't', 'u']],
    ]);
  });

  test('an assignment in a branch of a held block that would capture declines', () => {
    // y ↦ Hold({ If(True, s ≔ 3, 0); y + s }) applied to s, with no `s`
    // declared: released, the `Assign` in the branch makes `s` a local of
    // the block, and a substitution with no rename gave 6, not s + 3.
    const engine = new ComputeEngine();
    const H = [
      'Function',
      [
        'Hold',
        [
          'Block',
          ['If', 'True', ['Assign', 's', 3], 0],
          ['Add', 'y', 's'],
        ],
      ],
      'y',
    ];
    let result: unknown;
    expect(() => (result = run([H, 's'], engine))).not.toThrow();
    expect((result as { operator: string }).operator).toBe('Apply');
  });

  test('a declaration in a branch of a held block that would capture declines', () => {
    // As above with `Declare(s, integer)` in the branch: released, a
    // substitution with no rename gave 2s, not s + s_1.
    const engine = new ComputeEngine();
    const H = [
      'Function',
      [
        'Hold',
        [
          'Block',
          ['If', 'True', ['Declare', 's', "'integer'"], 0],
          ['Add', 'y', 's'],
        ],
      ],
      'y',
    ];
    let result: unknown;
    expect(() => (result = run([H, 's'], engine))).not.toThrow();
    expect((result as { operator: string }).operator).toBe('Apply');
  });

  test('an assignment in a branch of a held block that is not free in the value', () => {
    const engine = new ComputeEngine();
    const H = [
      'Function',
      [
        'Hold',
        [
          'Block',
          ['If', 'True', ['Assign', 's', 3], 0],
          ['Add', 'y', 's'],
        ],
      ],
      'y',
    ];
    expect(run([H, 'u'], engine).json).toEqual([
      'Hold',
      ['Block', ['If', 'True', ['Assign', 's', 3], 0], ['Add', 'u', 's']],
    ]);
  });

  test('the index of a sum in a held literal is renamed', () => {
    // y ↦ Hold(x ↦ Σ_{k=1}^{3} y·k·x) applied to k, released, then applied
    // to 2: 12k, not 28.
    const engine = new ComputeEngine();
    const H = [
      'Function',
      [
        'Hold',
        [
          'Function',
          ['Sum', ['Multiply', 'y', 'k', 'x'], ['Limits', 'k', 1, 3]],
          'x',
        ],
      ],
      'y',
    ];
    const held = run([H, 'k'], engine);
    expect(held.json).toEqual([
      'Hold',
      [
        'Function',
        ['Sum', ['Multiply', 'k', 'k_1', 'x'], ['Limits', 'k_1', 1, 3]],
        'x',
      ],
    ]);
    const released = run(['ReleaseHold', held], engine);
    expect(run(['Apply', released, 2], engine).json).toEqual([
      'Multiply',
      12,
      'k',
    ]);
  });
});

describe('a function argument that was boxed before', () => {
  test('a free name of the argument is free, not a local of its body', () => {
    // `t ↦ x` is boxed when no `x` is declared: boxing declares `x` in the
    // scope of its body, with no value. The `x` is free all the same, so
    // (f ↦ (x ↦ f)) applied to it renames the inner x, and the result
    // applied to 2 and then to 7 is the free x, not 2.
    const engine = new ComputeEngine();
    const arg = engine.box(['Function', 'x', 't']);
    const K = ['Function', ['Function', 'f', 'x'], 'f'];
    const r = engine.box([K, arg] as any).evaluate();
    expect(r.json).toEqual([
      'Function',
      ['Block', ['Function', ['Block', 'x'], 't']],
      'x_1',
    ]);
    const r2 = engine.box(['Apply', r, 2]).evaluate();
    expect(engine.box(['Apply', r2, 7]).evaluate().json).toEqual('x');
  });
});

describe('a nested literal below a renamed binder', () => {
  // (a, b) ↦ If(b, Σ_{j=1}^{2} (a·j + (z ↦ z·j)(2)), 0) applied to j alone:
  // the sum is renamed, and the body scope of the nested literal is copied
  // onto the renamed sum. Applied then to True: 3j + 6, not 9 + 6.
  const inner = [
    'Sum',
    [
      'Add',
      ['Multiply', 'a', 'j'],
      ['Apply', ['Function', ['Multiply', 'z', 'j'], 'z'], 2],
    ],
    ['Limits', 'j', 1, 2],
  ];

  test('in a partial application', () => {
    const engine = new ComputeEngine();
    const F = ['Function', ['If', 'b', inner, 0], 'a', 'b'];
    const partial = engine.box([F, 'j'] as any).evaluate();
    expect(
      engine.box(['Apply', partial, 'True'] as any).evaluate().json
    ).toEqual(['Add', ['Multiply', 3, 'j'], 6]);
  });

  test('a closure that captured the locals of a branch declines', () => {
    // `mk(1)` is a closure made in a branch of `If` in the body of `mk`: the
    // parent of its body scope holds the local `k` it captured. Applying
    // h ↦ (y ↦ (x ↦ [y^x, h])) to it and then to x renames x, and the body
    // scope of the closure cannot be copied onto the renamed literal without
    // losing the captured `k`: the application stays unevaluated.
    const engine = new ComputeEngine();
    const mk = [
      'Function',
      [
        'If',
        ['Greater', 'n', 0],
        [
          'Block',
          ['Declare', 'k', "'integer'"],
          ['Assign', 'k', ['Multiply', 'n', 10]],
          ['Function', 'k'],
        ],
        0,
      ],
      'n',
    ];
    const H = [
      'Function',
      ['Function', ['Function', ['List', ['Power', 'y', 'x'], 'h'], 'x'], 'y'],
      'h',
    ];
    const closure = engine.box(['Apply', mk, 1] as any).evaluate();
    let result: unknown;
    expect(
      () =>
        (result = engine
          .box(['Apply', ['Apply', H, closure], 'x'] as any)
          .evaluate())
    ).not.toThrow();
    expect((result as { operator: string }).operator).toBe('Apply');
  });

  test('in a curried application', () => {
    const engine = new ComputeEngine();
    const C = ['Function', ['Function', ['If', 'b', inner, 0], 'b'], 'a'];
    const curried = engine.box([C, 'j'] as any).evaluate();
    expect(
      engine.box(['Apply', curried, 'True'] as any).evaluate().json
    ).toEqual(['Add', ['Multiply', 3, 'j'], 6]);
  });
});
