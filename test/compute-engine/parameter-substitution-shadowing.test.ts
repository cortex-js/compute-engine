/**
 * The substitution of the parameter values into the result of a call
 * (`bindingKeyedSubs`, `function-utils.ts`) skips an occurrence below a
 * binder of the parameter's name. The scope of a nested `Block` (the body of
 * a nested literal, or an inner block of the body) can hold the binding of a
 * parameter of an enclosing literal: canonicalization puts it there when the
 * block reads the parameter. Such a scope entry does not bind the name, and
 * an occurrence below it denotes the parameter. It counted as a binder, so
 * the value was not substituted, and a later read of the name found another
 * binding.
 *
 * Now such an entry does not shadow the parameter. A `Function` literal
 * still binds each name of its parameter list, and a block that makes the
 * name a local still shadows it. A `Declare` of the name in an inner block
 * or an inner literal makes a local of that inner node only.
 *
 * When the result writes the parameter (an `Assign` or a `Declare` of it),
 * the parameter is not substituted at all: the result of a saturated call
 * keeps its binding, which the literals of the result share with the call
 * frame. A partial application is the deferred residual, whose call gives
 * the value of the full call. A write outside every literal
 * of the result makes the saturated call decline too, and so do a read
 * outside every literal and an occurrence in held content, which find no
 * call frame when they run. The substitution
 * never replaces the target of an `Assign` or a `Declare`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const json = (ce: ComputeEngine, expr: unknown) =>
  ce.box(expr as any).evaluate().json;

// (y, w) ↦ (x ↦ y^x)
const F2 = ['Function', ['Function', ['Power', 'y', 'x'], 'x'], 'y', 'w'];

// y ↦ (x ↦ Block(Declare(s, 0),
//   Block(Declare(t, integer), t := 1, s := t + y), s))
const B = [
  'Function',
  [
    'Function',
    [
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'Block',
        ['Declare', 't', "'integer'", 1],
        ['Assign', 's', ['Add', 't', 'y']],
      ],
      's',
    ],
    'x',
  ],
  'y',
];

// (a, b) ↦ If(b, Sum((z ↦ a·j·z)(2), j = 1..2), 0)
const C = [
  'Function',
  [
    'If',
    'b',
    [
      'Sum',
      ['Apply', ['Function', ['Multiply', 'a', 'j', 'z'], 'z'], 2],
      ['Limits', 'j', 1, 2],
    ],
    0,
  ],
  'a',
  'b',
];

describe('partial application of a literal with several parameters', () => {
  test('the value of y is substituted into the inner literal', () => {
    const ce = new ComputeEngine();
    expect(json(ce, [F2, 'x', 0])).toEqual([
      'Function',
      ['Block', ['Power', 'x', 'x_1']],
      'x_1',
    ]);
  });

  test('F2(x)(5)(y) gives x^y, not y^y', () => {
    const ce = new ComputeEngine();
    expect(json(ce, [[[F2, 'x'], 5], 'y'])).toEqual(['Power', 'x', 'y']);
  });

  test('F2(y)(5)(z) gives y^z', () => {
    const ce = new ComputeEngine();
    expect(json(ce, [[[F2, 'y'], 5], 'z'])).toEqual(['Power', 'y', 'z']);
  });

  test('the saturated call keeps its result', () => {
    const ce = new ComputeEngine();
    expect(json(ce, [[F2, 'x', 5], 'y'])).toEqual(['Power', 'x', 'y']);
  });

  test('a Sum in the inner literal reads the value of the parameter', () => {
    // (a, b) ↦ (x ↦ Sum(a·j, j = 1..x)) applied to j, then 1, then 2:
    // j·1 + j·2 = 3j.
    const ce = new ComputeEngine();
    const S = [
      'Function',
      ['Function', ['Sum', ['Multiply', 'a', 'j'], ['Limits', 'j', 1, 'x']], 'x'],
      'a',
      'b',
    ];
    expect(json(ce, [[[S, 'j'], 1], 2])).toEqual(['Multiply', 3, 'j']);
  });
});

describe('a nested block reads the parameter', () => {
  test('B(t)(5) gives t + 1, not 2', () => {
    const ce = new ComputeEngine();
    expect(json(ce, [[B, 't'], 5])).toEqual(['Add', 't', 1]);
  });

  test('the compiled code gives the same value', () => {
    const ce = new ComputeEngine();
    // The outer `t`, the argument of `B`, is an input of the compiled code.
    // An input with no type is refused, so it is declared here. The inner
    // block declares its own `t`, which this declaration does not change.
    ce.declare('t', 'real');
    const expr = ce.box([[B, 't'], 5] as any);
    // `B(t)` is a call whose value is a function, which compiled code does
    // not return, so the compilation declines. The fallback `run` gives the
    // interpreter's value.
    const result = compile(expr);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /its value is a function, and compiled code does not return a function from a call/
    );
    expect(result.run!({ t: 4 })).toBe(5);
    expect(expr.evaluate().subs({ t: 4 }).N().re).toBe(5);
  });
});

describe('a nested literal in a scoped operator of a held branch', () => {
  test('C(u)(True) gives 6u, not 6a', () => {
    const ce = new ComputeEngine();
    expect(json(ce, [[C, 'u'], 'True'])).toEqual(['Multiply', 6, 'u']);
  });

  test('the saturated call gives the same value', () => {
    const ce = new ComputeEngine();
    expect(json(ce, [C, 'u', 'True'])).toEqual(['Multiply', 6, 'u']);
  });
});

describe('cases that keep their result', () => {
  test('a nested literal that re-binds the name keeps its binder', () => {
    const ce = new ComputeEngine();
    expect(json(ce, [['Function', ['Function', 'x', 'x'], 'x'], 1])).toEqual([
      'Function',
      ['Block', 'x'],
      'x',
    ]);
  });

  test('an inner literal whose parameter is the name keeps it', () => {
    // (y, w) ↦ (x ↦ (y ↦ y + x)) applied to q, then 1: the innermost y is
    // the parameter of the innermost literal.
    const ce = new ComputeEngine();
    const R = [
      'Function',
      ['Function', ['Function', ['Add', 'y', 'x'], 'y'], 'x'],
      'y',
      'w',
    ];
    expect(json(ce, [[R, 'q'], 1])).toEqual([
      'Function',
      ['Block', ['Function', ['Block', ['Add', 'x', 'y']], 'y']],
      'x',
    ]);
  });

  test('a parameter that a nested block assigns is not replaced', () => {
    // (y, w) ↦ (x ↦ Block(Block(y := 2, y + x))): the target of the
    // assignment is not replaced by the value of the parameter. The
    // saturated call keeps the occurrences, and the partial application
    // gives the same value.
    const ce = new ComputeEngine();
    const W = [
      'Function',
      [
        'Function',
        ['Block', ['Block', ['Assign', 'y', 2], ['Add', 'y', 'x']]],
        'x',
      ],
      'y',
      'w',
    ];
    const saturated = ce.box([W, 'q', 1] as any).evaluate();
    expect(JSON.stringify(saturated.json)).not.toContain('"Assign","q"');
    expect(json(ce, [saturated, 5])).toBe(7);
    expect(json(ce, [[[W, 'q'], 1], 5])).toBe(7);
  });

  test('a function that calls itself from a Map callback', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'm',
      [
        'Function',
        [
          'Map',
          [
            'Function',
            ['If', ['Less', 'x', 1], 0, ['m', ['Subtract', 'x', 1]]],
            'x',
          ],
          ['List', 'n'],
        ],
        'n',
      ],
    ]).evaluate();
    expect(ce.box(['m', 3]).evaluate().toString()).toBe('[[[[0]]]]');
  });
});

// (y, w) ↦ (x ↦ body)
const curriedLiteral = (body: unknown) => [
  'Function',
  ['Function', body, 'x'],
  'y',
  'w',
];

// The value of `P(q)(1)(5)`, and the value of `P(q, 1)(5)`.
const curriedAndSaturated = (P: unknown) => {
  const ce = new ComputeEngine();
  return [json(ce, [[[P, 'q'], 1], 5]), json(ce, [[P, 'q', 1], 5])];
};

describe('a write or a declaration below a nested block', () => {
  test('a Declare in an inner block makes a local of the inner block', () => {
    // (y, w) ↦ (x ↦ Block(Block(Block(Declare(y), y := 1, y), y + x)))
    const P1 = curriedLiteral([
      'Block',
      [
        'Block',
        ['Block', ['Declare', 'y', "'unknown'", 1], 'y'],
        ['Add', 'y', 'x'],
      ],
    ]);
    const [curried, saturated] = curriedAndSaturated(P1);
    expect(curried).toEqual(['Add', 'q', 5]);
    expect(curried).toEqual(saturated);
  });

  test('a Declare in an inner literal makes a local of the literal', () => {
    // (y, w) ↦ (x ↦ Block(Block(
    //   (z ↦ Block(Declare(y), y := 3, y))(0) + y + x)))
    const P3 = curriedLiteral([
      'Block',
      [
        'Block',
        [
          'Add',
          [
            'Apply',
            [
              'Function',
              ['Block', ['Declare', 'y', "'unknown'", 3], 'y'],
              'z',
            ],
            0,
          ],
          'y',
          'x',
        ],
      ],
    ]);
    const [curried] = curriedAndSaturated(P3);
    expect(curried).toEqual(['Add', 'q', 8]);
  });

  test('the inner literal keeps its own local, the list gets the value', () => {
    // (y, w) ↦ (x ↦ [y, z ↦ Block(Declare(y, integer), y := 2, y)])
    const ce = new ComputeEngine();
    const R = curriedLiteral([
      'List',
      'y',
      [
        'Function',
        ['Block', ['Declare', 'y', "'integer'", 2], 'y'],
        'z',
      ],
    ]);
    expect(json(ce, [[[R, 'q'], 1], 5])).toEqual([
      'List',
      'q',
      [
        'Function',
        ['Block', ['Declare', 'y', "'integer'", 2], 'y'],
        'z',
      ],
    ]);
  });

  test('a read before a write of the parameter: the partial application gives the full-call value', () => {
    // (y, w) ↦ (x ↦ Block(Block(Declare(s, y), y := 2, s + x))): the read of
    // y must give the value of the argument, and the write cannot be
    // substituted. The partial application is the deferred residual, whose
    // full call keeps the binding of y.
    const P2 = curriedLiteral([
      'Block',
      [
        'Block',
        ['Declare', 's', "'unknown'", 'y'],
        ['Assign', 'y', 2],
        ['Add', 's', 'x'],
      ],
    ]);
    const [curried, saturated] = curriedAndSaturated(P2);
    expect(saturated).toEqual(['Add', 'q', 5]);
    expect(curried).toEqual(saturated);
  });

  test('the result of the saturated call shares the binding of y', () => {
    // g = P2(q, 1): the literal of the result captures the binding of the
    // parameter y, and each application reads the value that the previous
    // one wrote (`docs/SCOPING-MODEL.md`, "Callable resolution").
    const ce = new ComputeEngine();
    const P2 = curriedLiteral([
      'Block',
      [
        'Block',
        ['Declare', 's', "'unknown'", 'y'],
        ['Assign', 'y', 2],
        ['Add', 's', 'x'],
      ],
    ]);
    const g = ce.box([P2, 'q', 1] as any).evaluate();
    expect(json(ce, [g, 5])).toEqual(['Add', 'q', 5]);
    expect(json(ce, [g, 5])).toBe(7);
    expect(json(ce, 'q')).toBe('q');
  });

  test('a write in a dictionary value: the partial application gives the full-call value', () => {
    // (y, w) ↦ (x ↦ Block(Block(Declare(s, y), {a: Block(y := 2)}, s + x)))
    const P = curriedLiteral([
      'Block',
      [
        'Block',
        ['Declare', 's', "'unknown'", 'y'],
        ['Dictionary', ['KeyValuePair', "'a'", ['Block', ['Assign', 'y', 2]]]],
        ['Add', 's', 'x'],
      ],
    ]);
    const ce = new ComputeEngine();
    const partial = ce.box([P, 'q'] as any).evaluate();
    expect(partial.json[0]).toBe('Function');
    expect(json(ce, [[partial, 1], 5])).toEqual(['Add', 'q', 5]);
    expect(json(ce, [[P, 'q', 1], 5])).toEqual(['Add', 'q', 5]);
    expect(json(ce, 'q')).toBe('q');
  });

  test('a write in the bound of a Sum over y: the partial application gives the full-call value', () => {
    // (y, w) ↦ (x ↦ Block(Block(Declare(s, y),
    // Sum(x, y = 1..Block(y := 2, 2)), s + y + x))): the bound of the clause is outside the scope of the
    // index y, so its y is the parameter.
    const P = curriedLiteral([
      'Block',
      [
        'Block',
        ['Declare', 's', "'unknown'", 'y'],
        ['Sum', 'x', ['Limits', 'y', 1, ['Block', ['Assign', 'y', 2], 2]]],
        ['Add', 's', 'y', 'x'],
      ],
    ]);
    const ce = new ComputeEngine();
    const partial = ce.box([P, 'q'] as any).evaluate();
    expect(partial.json[0]).toBe('Function');
    expect(JSON.stringify(partial.json)).not.toContain('"Assign","q"');
    const saturated = ce.box([P, 'q', 1] as any).evaluate();
    expect(JSON.stringify(saturated.json)).not.toContain('"Assign","q"');
    // The partial application applied to 1 gives the value of the full call.
    expect(json(ce, [[partial, 1], 5])).toEqual(json(ce, [saturated, 5]));
    expect(json(ce, 'q')).toBe('q');
  });

  test('a write of y in the body block of the result: the saturated call keeps y', () => {
    // (y, w) ↦ (x ↦ Block(Declare(s, y), y := 2, s + x)), and
    // (y, w) ↦ (x ↦ Block(Declare(s, y), Block(y := 2), s + y + x)): the
    // result of the saturated call keeps the binding of y, and each application
    // reads the value that the previous one wrote. The result of the
    // partial application applied to 1 does the same.
    const P2n = curriedLiteral([
      'Block',
      ['Declare', 's', "'unknown'", 'y'],
      ['Assign', 'y', 2],
      ['Add', 's', 'x'],
    ]);
    const P4 = curriedLiteral([
      'Block',
      ['Declare', 's', "'unknown'", 'y'],
      ['Block', ['Assign', 'y', 2]],
      ['Add', 's', 'y', 'x'],
    ]);
    for (const [P, first, second] of [
      [P2n, ['Add', 'q', 5], 7],
      [P4, ['Add', 'q', 7], 9],
    ] as const) {
      const ce = new ComputeEngine();
      const saturated = ce.box([P, 'q', 1] as any).evaluate();
      expect(saturated.json[0]).toBe('Function');
      expect(JSON.stringify(saturated.json)).not.toContain('"Assign","q"');
      expect(json(ce, [saturated, 5])).toEqual(first);
      expect(json(ce, [saturated, 5])).toBe(second);
      expect(json(ce, [P, 'q'])[0]).toBe('Function');
      const curried = ce.box([[P, 'q'], 1] as any).evaluate();
      expect(json(ce, [curried, 5])).toEqual(first);
      expect(json(ce, [curried, 5])).toBe(second);
      expect(json(ce, 'q')).toBe('q');
    }
  });

  test('sibling blocks share the binding of y', () => {
    // (y, w) ↦ (x ↦ Block(Block(y := 2, y + x), Block(y + x))): the
    // second block reads the value that the first one wrote.
    const ce = new ComputeEngine();
    const P = curriedLiteral([
      'Block',
      ['Block', ['Assign', 'y', 2], ['Add', 'y', 'x']],
      ['Block', ['Add', 'y', 'x']],
    ]);
    expect(json(ce, [[P, 'q', 1], 5])).toBe(7);
    expect(json(ce, 'q')).toBe('q');
  });

  test('a read of y in the index of a held write is substituted', () => {
    // (y, w) ↦ (x ↦ Block(Block(Hold(L[y] := 7), y + x))): the target
    // writes L, not y.
    const ce = new ComputeEngine();
    const P = curriedLiteral([
      'Block',
      ['Block', ['Hold', ['Assign', ['At', 'L', 'y'], 7]], ['Add', 'y', 'x']],
    ]);
    expect(json(ce, [P, 'q', 0])).toEqual([
      'Function',
      [
        'Block',
        ['Block', ['Hold', ['Assign', ['At', 'L', 'q'], 7]], ['Add', 'q', 'x']],
      ],
      'x',
    ]);
  });

  test('a shared subexpression is tested once', () => {
    // A tuple that holds the previous tuple twice, 30 times: the result
    // has 2^30 paths to the innermost tuple, and a test that walked each
    // path did not end.
    const ce = new ComputeEngine();
    let t = ce.function('Tuple', [ce.symbol('u'), ce.number(1)]);
    for (let i = 0; i < 30; i++) t = ce.function('Tuple', [t, t]);
    const raw = { canonical: false } as const;
    const sym = (name: string) => ce.symbol(name, raw);
    const P = ce.function(
      'Function',
      [
        ce.function(
          'Function',
          [
            ce.function(
              'Block',
              [
                ce.function(
                  'Block',
                  [ce.function('Add', [sym('x'), sym('y')], raw), t],
                  raw
                ),
              ],
              raw
            ),
            sym('x'),
          ],
          raw
        ),
        sym('y'),
        sym('w'),
      ],
      raw
    );
    // A saturated call: its result is the inner literal with `q` in place of
    // `y`. (A partial application is the deferred residual, which holds the
    // literal unchanged: no substitution runs in it.)
    const result = ce.box(['Apply', P, 'q', 0]).evaluate();
    // Function(Block(Block(q + x, tuple)), x)
    let sum: any = result;
    for (let i = 0; i < 3; i++) sum = sum.ops[0];
    expect(sum.json).toEqual(['Add', 'q', 'x']);
  });
});

describe('a returned closure that writes a parameter', () => {
  // n ↦ (() ↦ Block(n := n + 1, n))
  const counter = [
    'Function',
    ['Function', ['Block', ['Assign', 'n', ['Add', 'n', 1]], 'n']],
    'n',
  ];

  test('a counter: each application reads the previous value', () => {
    const ce = new ComputeEngine();
    const c = ce.box([counter, 5] as any).evaluate();
    expect(c.json[0]).toBe('Function');
    expect(json(ce, ['Apply', c])).toBe(6);
    expect(json(ce, ['Apply', c])).toBe(7);
  });

  test('a declared counter factory gives the same values', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'mk', counter] as any).evaluate();
    const c = ce.box(['mk', 5]).evaluate();
    expect(json(ce, ['Apply', c])).toBe(6);
    expect(json(ce, ['Apply', c])).toBe(7);
  });

  test('the closure writes one parameter and reads the other', () => {
    // (y, w) ↦ (x ↦ Block(w := x + y, w)) applied to (1, 2), then 3
    const ce = new ComputeEngine();
    const r = ce
      .box([
        [
          'Function',
          [
            'Function',
            ['Block', ['Assign', 'w', ['Add', 'x', 'y']], 'w'],
            'x',
          ],
          'y',
          'w',
        ],
        1,
        2,
      ] as any)
      .evaluate();
    expect(r.json[0]).toBe('Function');
    expect(json(ce, [r, 3])).toBe(4);
  });

  test('a Declare of the name in the closure makes a local', () => {
    // y ↦ (z ↦ Block(Declare(y, integer), y := z, y)) applied to 3, then 4
    const ce = new ComputeEngine();
    const r = ce
      .box([
        [
          'Function',
          [
            'Function',
            ['Block', ['Declare', 'y', "'integer'", 'z'], 'y'],
            'z',
          ],
          'y',
        ],
        3,
      ] as any)
      .evaluate();
    expect(r.json[0]).toBe('Function');
    expect(json(ce, [r, 4])).toBe(4);
  });

  test('a Declare in an inner literal does not take the value', () => {
    // y ↦ [y, z ↦ Block(Declare(y, integer), y := 2, y)] applied to q
    const inner = [
      'Function',
      ['Block', ['Declare', 'y', "'integer'", 2], 'y'],
      'z',
    ];
    const F = ['Function', ['List', 'y', inner], 'y'];
    const ce = new ComputeEngine();
    expect(json(ce, [F, 'q'])).toEqual(['List', 'q', inner]);
    ce.box(['Assign', 'g', F] as any).evaluate();
    expect(json(ce, ['g', 'q'])).toEqual(['List', 'q', inner]);
  });
});

describe('a call that declines after its body ran', () => {
  test('the side effects of the body stay done, and run again', () => {
    // y ↦ Block(k := k + 1, Hold(Block(y := 2, y))): the held block of the
    // result writes y outside every literal, so the call declines after
    // the body incremented k. Each evaluation of the inert call runs the
    // body again.
    const ce = new ComputeEngine();
    ce.box(['Assign', 'k', 0]).evaluate();
    const call = ce.box([
      [
        'Function',
        [
          'Block',
          ['Assign', 'k', ['Add', 'k', 1]],
          ['Hold', ['Block', ['Assign', 'y', 2], 'y']],
        ],
        'y',
      ],
      'q',
    ] as any);
    expect(call.evaluate().json[0]).toBe('Apply');
    expect(json(ce, 'k')).toBe(1);
    expect(call.evaluate().json[0]).toBe('Apply');
    expect(json(ce, 'k')).toBe(2);
    expect(json(ce, 'q')).toBe('q');
  });
});

describe('a returned closure that writes a parameter, next to another occurrence', () => {
  // Each case runs with a global `y` (and `n`) of 100: a read or a write that
  // finds no call frame would resolve to it by name, so the global must keep
  // its value.
  const engine = () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'y', 100]).evaluate();
    ce.box(['Assign', 'n', 100]).evaluate();
    return ce;
  };
  const inc = (v: string) => [
    'Function',
    ['Block', ['Assign', v, ['Add', v, 1]], v],
  ];
  const globalsUnchanged = (ce: ComputeEngine) => {
    expect(json(ce, 'y')).toBe(100);
    expect(json(ce, 'n')).toBe(100);
  };

  test('a read outside the closure, in an If: the call declines', () => {
    // y ↦ If(z > 0, y, () ↦ Block(y := y + 1, y)) applied to 5
    const ce = engine();
    const r = ce
      .box([['Function', ['If', ['Greater', 'z', 0], 'y', inc('y')], 'y'], 5])
      .evaluate();
    expect(r.json[0]).toBe('Apply');
    ce.box(['Assign', 'z', 1]).evaluate();
    expect(r.evaluate().json).toBe(5);
    globalsUnchanged(ce);
  });

  test('a held read outside the closure, in a Pair: the call declines', () => {
    // y ↦ Pair(Hold(y), () ↦ Block(y := y + 1, y)) applied to 5
    const ce = engine();
    const r = ce
      .box([['Function', ['Pair', ['Hold', 'y'], inc('y')], 'y'], 5])
      .evaluate();
    expect(r.json[0]).toBe('Apply');
    // The held y stays in the inert call: it does not release to 100.
    expect(json(ce, ['ReleaseHold', ['First', r]])[0]).toBe('First');
    globalsUnchanged(ce);
  });

  test('a held read after the closure, in a List: the call declines', () => {
    // n ↦ List(() ↦ Block(n := n + 1, n), Hold(n)) applied to 5
    const ce = engine();
    const r = ce
      .box([['Function', ['List', inc('n'), ['Hold', 'n']], 'n'], 5])
      .evaluate();
    expect(r.json[0]).toBe('Apply');
    globalsUnchanged(ce);
  });

  test('a held closure that writes the parameter: the call declines', () => {
    // y ↦ Hold(() ↦ Block(y := y + 1, y)) applied to 5
    const ce = engine();
    const r = ce.box([['Function', ['Hold', inc('y')], 'y'], 5]).evaluate();
    expect(r.json[0]).toBe('Apply');
    const c = ce.box(['ReleaseHold', r]).evaluate();
    expect(ce.box(['Apply', c]).evaluate().json[0]).toBe('Apply');
    globalsUnchanged(ce);
  });

  test('a closure that returns a held write of the parameter: the call declines', () => {
    // y ↦ (() ↦ Hold(Block(y := 2, y))) applied to 5
    const ce = engine();
    const r = ce
      .box([
        [
          'Function',
          ['Function', ['Hold', ['Block', ['Assign', 'y', 2], 'y']]],
          'y',
        ],
        5,
      ])
      .evaluate();
    expect(r.json[0]).toBe('Apply');
    const a = ce.box(['Apply', r]).evaluate();
    expect(ce.box(['ReleaseHold', a]).evaluate().json[0]).toBe('Apply');
    globalsUnchanged(ce);
  });

  test('a held literal whose body is a write boxed before: the call declines', () => {
    // n ↦ Hold(() ↦ Assign(n, 2)) applied to 5, with the `Assign` boxed
    // before: the held literal has no body scope, so no call frame is
    // captured, and its write would reach the global n.
    const ce = engine();
    const write = ce.box(['Assign', 'n', 2]);
    const r = ce
      .box([['Function', ['Hold', ['Function', write]], 'n'], 5] as any)
      .evaluate();
    expect(r.json[0]).toBe('Apply');
    globalsUnchanged(ce);
  });

  test('a held Declare makes a local of the held block', () => {
    // y ↦ Hold(Block(Declare(y), y)) applied to 5
    const ce = engine();
    expect(
      json(ce, [['Function', ['Hold', ['Block', ['Declare', 'y'], 'y']], 'y'], 5])
    ).toEqual(['Hold', ['Block', ['Declare', 'y'], 'y']]);
    globalsUnchanged(ce);
  });

  test('a held Sum over the index y next to a closure that writes y', () => {
    // y ↦ List(Hold(Sum(y, Limits(y, 1, 3))), () ↦ Block(y := y + 1, y))
    // applied to 5: the index of the held Sum is not the parameter, so the
    // closure keeps the binding of y and counts from 5.
    const ce = engine();
    const heldSum = ['Hold', ['Sum', 'y', ['Limits', 'y', 1, 3]]];
    const r = ce
      .box([['Function', ['List', heldSum, inc('y')], 'y'], 5])
      .evaluate();
    expect(r.json).toEqual(['List', heldSum, inc('y')]);
    const c = ce.box(['At', r, 2]).evaluate();
    expect(ce.box(['Apply', c]).evaluate().json).toBe(6);
    expect(ce.box(['Apply', c]).evaluate().json).toBe(7);
    expect(json(ce, ['ReleaseHold', ['At', r, 1]])).toBe(6);
    globalsUnchanged(ce);
  });

  test('a counter with a global n keeps counting from the argument', () => {
    const ce = engine();
    const c = ce.box([['Function', inc('n'), 'n'], 5]).evaluate();
    expect(ce.box(['Apply', c]).evaluate().json).toBe(6);
    expect(ce.box(['Apply', c]).evaluate().json).toBe(7);
    globalsUnchanged(ce);
  });
});
