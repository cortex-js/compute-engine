import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import {
  unsettledShapeIn,
  untypedInputs,
} from '../../src/compute-engine/compilation/compile-admission';

// The admission rules of a compilation (`docs/COMPILATION-MODEL.md`, "Fail
// closed"; design `docs/plans/2026-10-31-static-shape-compilation.md`,
// rules R1 and R3, ROADMAP CE-712.1):
//
// - An input (a free symbol of the compiled code) whose static type is
//   `unknown` or `any` is refused on every target, and `unsupported` names
//   it. A declared union of shapes is not refused.
// - A conditional whose branches have conflicting shapes (a scalar and a
//   list, a point and a list of points) declines on every target, and
//   `unsupported` names it.
// - A function body, the root or a `Loop` whose values (each `Return` or
//   `Break` value and the last value) have conflicting shapes declines.

const TARGETS = ['javascript', 'interval-js', 'glsl', 'wgsl', 'python'];

const silence = jest.spyOn(console, 'warn').mockImplementation(() => {});
afterAll(() => silence.mockRestore());

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('L', 'list<real>');
  return ce;
}

describe('An input with no type is refused (R1)', () => {
  test.each(TARGETS)('an undeclared input on %s', (to) => {
    const ce = engine();
    const r = compile(ce.box(['Add', ['If', ['Less', 'M', 3], 'M', 0], 'x']), {
      to,
    });
    expect(ce.box('M').type.toString()).toBe('unknown');
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.diagnostic?.kind).toBe('correctness');
    expect(r.unsupported).toContain('M');
    expect(r.unsupported).not.toContain('x');
    expect(r.error).toMatch(/the input `M` has no type/);
  });

  test.each(TARGETS)('an input declared `any` on %s', (to) => {
    const ce = engine();
    ce.declare('p', 'any');
    ce.declare('q', 'unknown');
    // `q` is read where nothing infers a type for it.
    const r = compile(
      ce.box(['Add', 'p', ['If', ['Greater', 'x', 0], 'q', 0]]),
      { to }
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toEqual(expect.arrayContaining(['p', 'q']));
    expect(r.error).toMatch(/the inputs `p`, `q` have no type/);
  });

  test.each(TARGETS)('without the fallback, the refusal throws on %s', (to) => {
    const ce = engine();
    const e = ce.box(['Add', ['If', ['Greater', 'x', 0], 'M', 0], 'x']);
    expect(ce.box('M').type.toString()).toBe('unknown');
    if (to === 'interval-js') {
      // This target returns its decline as a `success: false` result.
      const r = compile(e, { to, fallback: false });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/the input `M` has no type/);
    } else
      expect(() => compile(e, { to, fallback: false })).toThrow(
        /the input `M` has no type/
      );
  });

  test.each(TARGETS)(
    'a declared union of shapes is not refused on %s',
    (to) => {
      const ce = engine();
      ce.declare('U', 'real | list<real>');
      const r = compile(ce.box(['Add', 'U', 'x']), { to });
      expect(r.diagnostic?.code).not.toBe('untyped-input');
      expect(r.unsupported ?? []).not.toContain('U');
    }
  );

  test.each(TARGETS)('a typed input is not refused on %s', (to) => {
    const ce = engine();
    const r = compile(ce.box(['Add', ['Sin', 'x'], 1]), { to });
    expect(r.success).toBe(true);
  });

  // The parameters of a function literal are bound, not inputs.
  test.each(TARGETS)('a parameter with no type is not an input on %s', (to) => {
    const ce = engine();
    const r = compile(ce.box(['Function', 't', 't']), { to });
    expect(r.diagnostic?.code).not.toBe('untyped-input');
  });

  // A name that only a loop body assigns, in the body of a function
  // declared with the `scope` effect, is a local of the function body. The
  // reference analysis listed it as a free symbol, with the type `unknown`.
  test('a local that a function body assigns in a loop is not an input', () => {
    const ce = new ComputeEngine();
    const body: MathJsonExpression = [
      'Block',
      ['Declare', 's', 'number'],
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 'p', ['Tuple', 't', ['Multiply', 2, 't']]],
          ['Assign', 's', ['Add', 's', ['At', 'p', 1]]],
        ],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      's',
    ];
    ce.declare('a', { signature: '(number) scope -> number' });
    ce.assign('a', ce.box(['Function', body, 't']));
    ce.declare('u', 'number');
    for (const to of ['javascript', 'glsl']) {
      const r = compile(ce.box(['a', 'u']), { to });
      expect(r.success).toBe(true);
      expect(r.freeSymbols).toEqual(['u']);
    }
    expect(compile(ce.box(['a', 'u'])).run!({ u: 2 })).toBe(6);
  });

  // A name that the code assigns and that nothing declares is an input:
  // `u ≔ If(x < 0, u, 0)` reads `u` before it writes it, and nothing infers
  // a type for it.
  test.each(TARGETS)('an assigned name with no type is refused on %s', (to) => {
    const ce = engine();
    const r = compile(
      ce.box(['Assign', 'u', ['If', ['Less', 'x', 0], 'u', 0]]),
      { to }
    );
    expect(ce.box('u').type.toString()).toBe('unknown');
    expect(r.success).toBe(false);
    expect(r.unsupported).toContain('u');
  });

  // When the expression also declines for another reason, that reason is
  // the error and the diagnostic, and `unsupported` also names the inputs
  // with no type.
  // The variable of an indefinite integral is an input of the compiled code
  // (`_.x`), and the variable in the `Limits` is bound in the scope of the
  // integral: the type of the input is the type of the declaration outside
  // the integral.
  test.each(['javascript', 'interval-js'])(
    'the variable of an indefinite integral has its declared type on %s',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const r = compile(ce.parse('\\int x^2 dx'), { to });
      expect(r.success).toBe(true);
      expect(r.freeSymbolTypes?.x?.type).toBe('real');
      const undeclared = compile(new ComputeEngine().parse('\\int x^2 dx'), {
        to,
      });
      expect(undeclared.diagnostic?.code).toBe('untyped-input');
    }
  );

  // The variable of a derivative is bound in the scope of the `D`, and the
  // compiled code computes the derivative at the input of that name
  // (`_.x`): the type of the input is the type of the declaration outside
  // the `D`. With an untyped parameter `t` in `F`, the compilation declined
  // with `untyped-input`, and the type of `x` was `unknown`.
  // The target `interval-js` has no numeric derivative, and declines `D`
  // of a user function for that reason.
  test('the variable of a derivative has its declared type', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('F', 'function');
    ce.assign(
      'F',
      ce.box([
        'Function',
        ['Max', ['Abs', 't'], ['Abs', ['Subtract', 't', 1]]],
        't',
      ])
    );
    const r = compile(ce.box(['D', ['F', 'x'], 'x']));
    expect(r.success).toBe(true);
    expect(r.freeSymbolTypes?.x).toMatchObject({
      type: 'real',
      provenance: 'declared',
    });
    // d/dx max(|x|, |x - 1|) is 1 at x = 2.
    expect(r.run!({ x: 2 })).toBeCloseTo(1, 6);
  });

  // The bound of a later limit reads the variable of an earlier one: the
  // compiled code nests the integrals.
  test('the bound of an inner integral is not an input', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box([
        'Integrate',
        ['Exp', ['Square', 'y']],
        ['Limits', 'x', 0, 1],
        ['Limits', 'y', 0, 'x'],
      ])
    );
    expect(r.success).toBe(true);
    expect(r.freeSymbols).toEqual([]);
    expect(r.run!({})).toBeCloseTo(0.6035108316776591, 10);
  });

  // A name that only the branches of an `If` in a block assign is an
  // input, also when the scope of the block binds it. The interpreter
  // gives no value for a read of `b` at `x = 5` in
  // `Block(If(x < 1, b ≔ 1); b)`, and the compiled code, which does not
  // check that read, reads the input `b`. So the name is subject to the
  // refusal of an input with no type.
  test.each([
    [
      'both branches',
      ['If', ['Less', 'x', 1], ['Assign', 'b', 1], ['Assign', 'b', 2]],
    ],
    ['one branch', ['If', ['Less', 'x', 1], ['Assign', 'b', 1]]],
  ] as [string, MathJsonExpression][])(
    'a name that only %s of a block assign is an input',
    (_label, statement) => {
      const json: MathJsonExpression = ['Block', statement, 'b'];
      const r = compile(engine().box(json));
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('untyped-input');
      expect(r.unsupported).toContain('b');
      // Declared, `b` compiles, and the value is the interpreter's.
      const ce = engine();
      ce.declare('b', 'real');
      const typed = compile(ce.box(json), { fallback: false });
      expect(typed.success).toBe(true);
      expect(typed.freeSymbols).toEqual(['x', 'b']);
      const fresh = engine();
      fresh.declare('b', 'real');
      fresh.assign('x', 0);
      expect(fresh.box(json).evaluate().json).toBe(1);
      expect(typed.run!({ x: 0, b: 7 })).toBe(1);
    }
  );

  // No scope of the block binds `q` here: the interpreter writes a binding
  // of `q` outside the block, so `q` is an input, also when the code only
  // writes it.
  test('a name that the code only writes outside the block is an input', () => {
    const ce = engine();
    const r = compile(
      ce.box([
        'Block',
        ['Assign', 'p', 1],
        ['Loop', ['Assign', 'q', 'n'], ['Element', 'n', ['Range', 1, 3]]],
        'p',
      ])
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toContain('q');
  });

  test('another reason to decline stays the reason', () => {
    const ce = engine();
    ce.declare('M', 'any');
    // `Foo` is an operator with no definition and no lowering.
    const r = compile(ce.box(['Add', ['Foo', 'x'], 'M']));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).not.toBe('untyped-input');
    expect(r.error).not.toMatch(/has no type/);
    expect(r.unsupported).toEqual(expect.arrayContaining(['M']));
  });

  test('a value with no settled shape stays the reason', () => {
    const ce = engine();
    ce.declare('M', 'any');
    const r = compile(
      ce.box(['Add', ['If', ['Greater', 'x', 0], ['List', 1, 2], 3], 'M'])
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.unsupported).toEqual(expect.arrayContaining(['M']));
  });

  // ROADMAP CE-222: with `M` undeclared, the compiled code read `M` as a
  // number, and `If(M < 3, M, 0)` gave `0` for `M = [1, 5]`, where the
  // interpreter gives `[1, 0]`.
  test('CE-222: an undeclared input declines, and the fallback gives the interpreter value', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['If', ['Less', 'M', 3], 'M', 0]));
    expect(r.success).toBe(false);
    expect(r.unsupported).toEqual(['M']);
    expect(r.run!({ M: [1, 5] })).toEqual([1, 0]);
    // A condition is a boolean or a flat list of booleans. Over a matrix,
    // `M < 3` is a nested list, which the interpreter refuses with an
    // `incompatible-type` error, and the fallback gives `NaN` for an error
    // (the selection rule of 2026-11-02, `docs/BROADCAST-MODEL.md`).
    expect(
      r.run!({
        M: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toBeNaN();
    expect(r.run!({ M: 2 })).toBe(2);
    // Declared, the input compiles.
    ce.declare('M', 'real');
    const typed = compile(ce.box(['If', ['Less', 'M', 3], 'M', 0]));
    expect(typed.success).toBe(true);
    expect(typed.run!({ M: 2 })).toBe(2);
    expect(typed.run!({ M: 5 })).toBe(0);
  });

  // ROADMAP CE-463: two inputs declared `any` and mapped through `vars` to
  // the same effectful source were read once. Such inputs are now refused,
  // so the interpreter reads each of them.
  test('CE-463: inputs declared `any` mapped through vars are refused', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'any');
    ce.declare('q', 'any');
    const r = compile(ce.box(['Add', 'p', 'q']), {
      vars: { p: '_.values.shift()', q: '_.values.shift()' },
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toEqual(expect.arrayContaining(['p', 'q']));
  });

  // ROADMAP CE-706, option (c): the parameter of a root function is not an
  // input, so it is not refused, and a list argument at an untyped root
  // parameter whose body reads a number (`2t`) is a host error: the result
  // is not specified.
  test('CE-706: a root function with an untyped parameter compiles', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Function', ['Multiply', 2, 't'], 't']));
    expect(r.success).toBe(true);
    expect(r.run!(3)).toBe(6);
    const id = compile(ce.box(['Function', 't', 't']));
    expect(id.success).toBe(true);
  });
});

// A document function of the host Tycho is declared `(unknown) -> unknown`,
// and its body is checked in a scope where the parameter is declared
// `broadcastable<number | tuple>`. The body is then boxed again as a
// `Function` literal, outside that scope, and assigned. The compiler reads
// the signature of the definition: the parameter is `unknown`, the return
// type is refined from the body at the assignment. The parameter is bound,
// not an input, so it is not refused.
describe('A Tycho document function (signature `(unknown) -> unknown`)', () => {
  function tychoEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('L', 'list<real>');
    const register = (name: string, body: MathJsonExpression) => {
      ce.declare(name, { signature: '(unknown) -> unknown' });
      ce.pushScope();
      ce.declare('x', { type: 'broadcastable<number | tuple>' });
      const bound = ce.expr(body, { form: 'structural' }).canonical;
      expect(bound.isValid).toBe(true);
      const json = bound.json;
      ce.popScope();
      ce.assign(name, ce.box(['Function', json, 'x']));
    };
    register('f', ['Power', 'x', 2]);
    register('g', ['Add', ['f', 'x'], 1]);
    return ce;
  }

  test('the definition reads `(unknown) -> number`', () => {
    const ce = tychoEngine();
    expect(ce.box('f').type.toString()).toBe('(unknown) -> number');
    expect(ce.box(['f', 't']).type.toString()).toBe('number');
  });

  test.each(TARGETS)('f(t) and g(t) compile on %s', (to) => {
    const ce = tychoEngine();
    for (const json of [
      ['f', 't'],
      ['g', 't'],
      ['Add', ['f', 't'], 1],
    ] as MathJsonExpression[]) {
      const r = compile(ce.box(json), { to });
      expect(r.diagnostic?.code).not.toBe('untyped-input');
      // The python target has no lowering of a user-function call.
      if (to !== 'python') expect(r.success).toBe(true);
    }
  });

  test('a list argument maps the function on javascript', () => {
    const ce = tychoEngine();
    const r = compile(ce.box(['f', 'L']));
    expect(r.success).toBe(true);
    expect(r.code).toBe('_SYS.mapFn(_fn_f, [1], _.L)');
    expect(r.run!({ L: [1, 2, 3] })).toEqual([1, 4, 9]);
  });

  test('the function as a value compiles', () => {
    const ce = tychoEngine();
    const r = compile(ce.box('f'));
    expect(r.success).toBe(true);
  });
});

describe('A value with no settled shape declines (R3)', () => {
  const UNSETTLED: [string, MathJsonExpression][] = [
    ['If(x > 0, [1, 2], 3)', ['If', ['Greater', 'x', 0], ['List', 1, 2], 3]],
    [
      'If(x > 0, [1, 2], 3) + 1',
      ['Add', ['If', ['Greater', 'x', 0], ['List', 1, 2], 3], 1],
    ],
    [
      'Which(x > 0, [1, 2], True, 3)',
      ['Which', ['Greater', 'x', 0], ['List', 1, 2], 'True', 3],
    ],
    [
      'If(x > 0, (1, 2), [(1, 2), (3, 4)])',
      [
        'If',
        ['Greater', 'x', 0],
        ['Tuple', 1, 2],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ],
    ],
    ['If(x > 0, L, x)', ['If', ['Greater', 'x', 0], 'L', 'x']],
  ];

  // The admission checks decline after the code was generated, so a target
  // whose code generation declines for a more specific reason reports that
  // reason: a shader array in an arithmetic operation or in a selection, a
  // list operand on the interval target, arithmetic over a list in Python.
  const OWN_REASON = new Set([
    'If(x > 0, [1, 2], 3) + 1 glsl',
    'If(x > 0, [1, 2], 3) + 1 wgsl',
    'If(x > 0, [1, 2], 3) + 1 python',
    'If(x > 0, (1, 2), [(1, 2), (3, 4)]) glsl',
    'If(x > 0, (1, 2), [(1, 2), (3, 4)]) wgsl',
    'If(x > 0, L, x) interval-js',
  ]);

  describe.each(UNSETTLED)('%s', (label, json) => {
    test.each(TARGETS)('on %s', (to) => {
      const ce = engine();
      const r = compile(ce.box(json), { to });
      expect(r.success).toBe(false);
      if (OWN_REASON.has(`${label} ${to}`)) {
        expect(r.diagnostic?.code).toBe('compile-error');
        expect(r.error).toMatch(/^Could not compile `(Add|If)`/);
        return;
      }
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      expect(r.diagnostic?.kind).toBe('capability');
      expect(r.unsupported).toContain(r.diagnostic?.value);
      expect(r.diagnostic?.value).toMatch(/^(If|Which)\(/);
    });
  });

  // Two points of different arities have one shape on the targets where a
  // point of any arity is one array, and conflicting shapes on the shader
  // targets, where they are a `vec2` and a `vec3`.
  test.each(TARGETS)('points of different arities on %s', (to) => {
    const ce = engine();
    const r = compile(
      ce.box(['If', ['Greater', 'x', 0], ['Tuple', 1, 2], ['Tuple', 1, 2, 3]]),
      { to }
    );
    if (to === 'glsl' || to === 'wgsl') {
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
    } else expect(r.diagnostic?.code).not.toBe('unsettled-shape');
    if (to === 'javascript') {
      expect(r.success).toBe(true);
      expect(r.run!({ x: 1 })).toEqual([1, 2]);
      expect(r.run!({ x: -1 })).toEqual([1, 2, 3]);
    }
  });

  // On a shader target, only the branches that the shader code keeps are
  // compared. An `If` whose condition has a literal static type (`2 < 3`)
  // keeps one branch; an `If` whose condition is the symbol `False`, and a
  // `Which`, keep every branch up to the first `True` clause, so a shader
  // with a `vec2` and a `float` branch would not be valid.
  test.each(['glsl', 'wgsl'])(
    'the branches that the shader code keeps on %s',
    (to) => {
      const ce = engine();
      const kept = compile(ce.box(['If', ['Less', 2, 3], ['Tuple', 1, 2], 0]), {
        to,
      });
      expect(kept.success).toBe(true);
      expect(String(kept.code)).toMatch(/^vec2f?\(1\.0, 2\.0\)$/);
      for (const json of [
        ['If', 'False', ['Tuple', 1, 2], 0],
        ['Which', ['Less', 2, 3], ['Tuple', 1, 2], 'True', 0],
      ] as MathJsonExpression[]) {
        const r = compile(ce.box(json), { to });
        expect(r.success).toBe(false);
        expect(r.diagnostic?.code).toBe('unsettled-shape');
      }
      // A clause after the first `True` clause is not emitted.
      const after = compile(
        ce.box([
          'Which',
          ['Greater', 'x', 0],
          1,
          'True',
          2,
          'True',
          ['Tuple', 1, 2],
        ]),
        { to }
      );
      expect(after.diagnostic?.code).not.toBe('unsettled-shape');
    }
  );

  test('the fallback gives the interpreter value', () => {
    const ce = engine();
    const r = compile(ce.box(['If', ['Greater', 'x', 0], ['List', 1, 2], 3]));
    expect(r.success).toBe(false);
    expect(r.run!({ x: 1 })).toEqual([1, 2]);
    expect(r.run!({ x: -1 })).toBe(3);
  });

  // A call of a user function whose body has such a conditional: the walk
  // goes into the body.
  test.each(TARGETS)(
    'a call whose result shape depends on its argument on %s',
    (to) => {
      const ce = engine();
      ce.assign(
        'h',
        ce.box([
          'Function',
          ['If', ['Greater', 'y', 0], ['List', 'y', 'y'], 0],
          'y',
        ])
      );
      const r = compile(ce.box(['Add', ['h', 'x'], 1]), { to });
      expect(r.success).toBe(false);
      // Python declines the arithmetic over a list in the code generation,
      // a more specific reason.
      expect(r.diagnostic?.code).toBe(
        to === 'python' ? 'compile-error' : 'unsettled-shape'
      );
    }
  );

  // The boundary of the rule in this step: a branch whose type settles no
  // shape (a union, `unknown`, `broadcastable<T>`) is not compared, and a
  // conditional over a collection condition selects element by element.
  test.each(TARGETS)('branches of one shape are settled on %s', (to) => {
    const ce = engine();
    for (const json of [
      ['If', ['Greater', 'x', 0], ['List', 1, 2], ['List', 3, 4, 5]],
      ['If', ['Greater', 'x', 0], ['Tuple', 1, 'x'], ['Tuple', 'x', 2]],
      ['If', ['Greater', 'x', 0], 1, 'x'],
    ] as MathJsonExpression[]) {
      const r = compile(ce.box(json), { to });
      expect(r.diagnostic?.code).not.toBe('unsettled-shape');
    }
  });

  test('a branch with a union type is not compared', () => {
    const ce = engine();
    ce.declare('U', 'real | list<real>');
    const r = compile(ce.box(['If', ['Greater', 'x', 0], 'U', 'x']));
    expect(r.diagnostic?.code).not.toBe('unsettled-shape');
  });

  test('a conditional over a collection condition is element-wise', () => {
    const ce = engine();
    const r = compile(ce.box(['Which', ['Greater', 'L', 0], 1, 'True', 'L']));
    expect(r.diagnostic?.code).not.toBe('unsettled-shape');
  });
});

// A branch that a condition known at compile time excludes is not compared:
// a condition that is `True` or `False`, or whose static type is the
// literal value `True` or `False` (`2 < 3`), selects its branch when the
// code is generated, so only the selected branch gives the shape. On the
// shader targets, the code generation emits every branch, so every branch is
// still compared there.
describe('A condition known at compile time selects its branch (R3)', () => {
  const KNOWN: [string, MathJsonExpression, unknown][] = [
    [
      'Which(2 < 3, [1, 2], True, 0)',
      ['Which', ['Less', 2, 3], ['List', 1, 2], 'True', 0],
      [1, 2],
    ],
    [
      'Which(3 < 2, [1, 2], True, 0)',
      ['Which', ['Less', 3, 2], ['List', 1, 2], 'True', 0],
      0,
    ],
    ['If(2 < 3, [1, 2], 0)', ['If', ['Less', 2, 3], ['List', 1, 2], 0], [1, 2]],
    ['If(False, [1, 2], 0)', ['If', 'False', ['List', 1, 2], 0], 0],
    [
      'If(True, [1, 2], 0) + 1',
      ['Add', ['If', 'True', ['List', 1, 2], 0], 1],
      [2, 3],
    ],
    [
      'Which(False, [1, 2], x < 3, 3, True, 4)',
      ['Which', 'False', ['List', 1, 2], ['Less', 'x', 3], 3, 'True', 4],
      3,
    ],
  ];

  test.each(KNOWN)('%s compiles on javascript', (_label, json, expected) => {
    const ce = engine();
    const r = compile(ce.box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ x: 1 })).toEqual(expected);
  });

  test.each(KNOWN)('%s is not refused by R3 on python', (_label, json) => {
    const ce = engine();
    const r = compile(ce.box(json), { to: 'python' });
    expect(r.diagnostic?.code).not.toBe('unsettled-shape');
  });

  // The shader code keeps both branches of an `If` whose condition is the
  // symbol `False`.
  test.each(['glsl', 'wgsl'])('an If with the symbol False on %s', (to) => {
    const ce = engine();
    const r = compile(ce.box(['If', 'False', ['Tuple', 1, 2], 0]), { to });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  // A condition that is not known stays a choice made at run time.
  test('a condition that is not constant keeps both branches', () => {
    const ce = engine();
    const r = compile(
      ce.box(['Which', 'False', 0, ['Less', 'x', 3], ['List', 1, 2], 'True', 0])
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });
});

// The admission checks do not apply to the nodes in a branch that the code
// for the target drops: the code never evaluates them. A branch that the
// code keeps is still checked. A sub-expression of static type `error`
// declines also in a dropped branch.
describe('A branch that the code drops is not checked', () => {
  function withH(): ComputeEngine {
    const ce = engine();
    ce.assign(
      'h',
      ce.box([
        'Function',
        ['If', ['Greater', 'y', 0], ['List', 'y', 'y'], 0],
        'y',
      ])
    );
    return ce;
  }

  test.each(TARGETS)('a conditional with no settled shape on %s', (to) => {
    const ce = engine();
    const r = compile(
      ce.box([
        'If',
        ['Less', 2, 3],
        0,
        ['If', ['Greater', 'x', 0], ['List', 1, 2], 3],
      ]),
      { to, fallback: false }
    );
    expect(r.success).toBe(true);
    if (to === 'javascript') expect(r.run!({ x: 1 })).toBe(0);
  });

  test.each(TARGETS)(
    'a call of a function with no settled shape on %s',
    (to) => {
      const ce = withH();
      const r = compile(ce.box(['If', ['Less', 2, 3], 0, ['h', 'x']]), {
        to,
        fallback: false,
      });
      expect(r.success).toBe(true);
    }
  );

  test.each(TARGETS)('the branch that the code keeps declines on %s', (to) => {
    const ce = engine();
    const r = compile(
      ce.box([
        'If',
        ['Less', 3, 2],
        0,
        ['If', ['Greater', 'x', 0], ['List', 1, 2], 3],
      ]),
      { to }
    );
    expect(r.success).toBe(false);
    // The interval target cannot read the list, a more specific reason.
    expect(r.diagnostic?.code).toBe(
      to === 'interval-js' ? 'compile-error' : 'unsettled-shape'
    );
  });

  test.each(TARGETS)(
    'a function call in a kept and a dropped branch on %s',
    (to) => {
      const ce = withH();
      const r = compile(
        ce.box(['Add', ['h', 'x'], ['If', ['Less', 2, 3], 1, ['h', 'x']]]),
        { to }
      );
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe(
        to === 'python' ? 'compile-error' : 'unsettled-shape'
      );
    }
  );

  test.each(TARGETS)('a static type error declines on %s', (to) => {
    const ce = engine();
    ce.assign('ADD', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    const r = compile(ce.box(['If', ['Less', 2, 3], 0, ['ADD', "'ab'", 'x']]), {
      to,
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('static-type-error');
  });

  test.each(TARGETS)('an input with no type on %s', (to) => {
    const ce = engine();
    const r = compile(ce.box(['If', ['Less', 2, 3], 0, 'z']), {
      to,
      fallback: false,
    });
    expect(ce.box('z').type.toString()).toBe('unknown');
    expect(r.success).toBe(true);
    if (to === 'javascript') expect(r.run!({ x: 1 })).toBe(0);
  });

  test.each(TARGETS)('an input with no type that is kept on %s', (to) => {
    const ce = engine();
    const r = compile(ce.box(['If', ['Less', 3, 2], 0, 'z']), { to });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toContain('z');
  });

  test.each(TARGETS)(
    'an input with no type in a kept and a dropped branch on %s',
    (to) => {
      const ce = engine();
      // The kept `z` is a branch, where nothing infers a type for it.
      const r = compile(
        ce.box([
          'If',
          ['Greater', 'x', 0],
          'z',
          ['If', ['Less', 2, 3], 0, 'z'],
        ]),
        { to }
      );
      expect(ce.box('z').type.toString()).toBe('unknown');
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('untyped-input');
      expect(r.unsupported).toContain('z');
    }
  );

  // On a shader target, an `If` whose condition is the symbol `True` emits
  // both branches, so the code reads `z`. The other targets drop the branch.
  test.each(TARGETS)('an If with the symbol True on %s', (to) => {
    const ce = engine();
    const r = compile(ce.box(['If', 'True', 0, 'z']), { to });
    if (to === 'glsl' || to === 'wgsl') {
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('untyped-input');
      expect(r.unsupported).toContain('z');
    } else expect(r.success).toBe(true);
  });
});

// The values that a function body or the root can give are the value of
// each `Return` that belongs to it and its last value. They must have one
// shape, as the branches of a conditional must (R3). A `Return` belongs to
// the innermost function literal around it, also through a `Loop`; the
// values of the `Break` statements of a `Loop` are the values of the loop.
// Only JavaScript compiles all these forms; another target declines most
// of them for a more specific reason first, which stays the reason.
describe('The values of a body with an early Return have one shape (R3)', () => {
  const y: MathJsonExpression = ['Typed', 'y', "'real'"];
  const fn = (body: MathJsonExpression): MathJsonExpression => [
    'Function',
    body,
    y,
  ];
  const z: MathJsonExpression = ['Assign', 'z', ['Multiply', 2, 'y']];

  const UNSETTLED: [string, MathJsonExpression][] = [
    [
      'y ↦ Block(If(y > 1, Return(y)), [y, y])',
      fn([
        'Block',
        ['If', ['Greater', 'y', 1], ['Return', 'y']],
        ['List', 'y', 'y'],
      ]),
    ],
    [
      'y ↦ Block(z := 2y, If(y > 1, Return(3z), [z, z]))',
      fn([
        'Block',
        z,
        [
          'If',
          ['Greater', 'y', 1],
          ['Return', ['Multiply', 3, 'z']],
          ['List', 'z', 'z'],
        ],
      ]),
    ],
    [
      'y ↦ Block(Loop(If(y > 1, Return(3)), Element(j, 1..3)), [y, y])',
      fn([
        'Block',
        [
          'Loop',
          ['If', ['Greater', 'y', 1], ['Return', 3]],
          ['Element', 'j', ['Range', 1, 3]],
        ],
        ['List', 'y', 'y'],
      ]),
    ],
  ];

  describe.each(UNSETTLED)('%s', (_label, literal) => {
    test.each(TARGETS)('on %s', (to) => {
      const ce = engine();
      ce.assign('g', ce.box(literal));
      const r = compile(ce.box(['g', 'x']), { to });
      expect(r.success).toBe(false);
      if (to === 'javascript') {
        expect(r.diagnostic?.code).toBe('unsettled-shape');
        expect(r.diagnostic?.kind).toBe('capability');
        expect(r.error).toMatch(/the values that it can give/);
      } else
        expect(r.diagnostic?.code).toMatch(/^(unsettled-shape|compile-error)$/);
    });
  });

  test.each(TARGETS)('a root block with an early Return on %s', (to) => {
    // At the root, `Return(3z)` ends the compiled code with a number, and
    // the last value is a list. The shader targets have no statement form
    // for this `Return`, a more specific reason.
    const ce = engine();
    const r = compile(
      ce.box([
        'Block',
        ['Assign', 'z', ['Multiply', 2, 'x']],
        [
          'If',
          ['Greater', 'x', 1],
          ['Return', ['Multiply', 3, 'z']],
          ['List', 'z', 'z'],
        ],
      ]),
      { to }
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe(
      to === 'glsl' || to === 'wgsl' ? 'compile-error' : 'unsettled-shape'
    );
  });

  test.each(TARGETS)('the Break values of a Loop on %s', (to) => {
    const ce = engine();
    const r = compile(
      ce.box([
        'Loop',
        ['If', ['Greater', 'x', 1], ['Break', 3], ['Break', ['List', 1, 2]]],
      ]),
      { to }
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe(
      to === 'glsl' || to === 'wgsl' ? 'compile-error' : 'unsettled-shape'
    );
  });

  // `g(2) = 12` (the early Return) and `g(0.5) = 2` (the last value).
  const SETTLED = fn([
    'Block',
    z,
    [
      'If',
      ['Greater', 'y', 1],
      ['Return', ['Multiply', 3, 'z']],
      ['Add', 'z', 1],
    ],
  ]);

  test.each(TARGETS)('values of one shape compile on %s', (to) => {
    const ce = engine();
    ce.assign('g', ce.box(SETTLED));
    const r = compile(ce.box(['g', 'x']), { to });
    expect(r.diagnostic?.code).not.toBe('unsettled-shape');
    if (to !== 'javascript') return;
    expect(r.success).toBe(true);
    for (const v of [2, 0.5])
      expect(r.run!({ x: v })).toBe(ce.box(['g', v]).evaluate().re);
  });

  test.each(TARGETS)(
    'a Return of a nested literal belongs to it on %s',
    (to) => {
      // The inner literal gives lists (its `Return` and its last value);
      // the body of `g` gives numbers. `g(2) = 2` and `g(0.5) = 1`.
      const ce = engine();
      ce.assign(
        'g',
        ce.box(
          fn([
            'Block',
            [
              'Assign',
              'w',
              [
                'Apply',
                [
                  'Function',
                  [
                    'Block',
                    ['If', ['Greater', 't', 1], ['Return', ['List', 't', 't']]],
                    ['List', 't', 1],
                  ],
                  't',
                ],
                'y',
              ],
            ],
            [
              'If',
              ['Greater', 'y', 1],
              ['Return', ['At', 'w', 1]],
              ['At', 'w', 2],
            ],
          ])
        )
      );
      const r = compile(ce.box(['g', 'x']), { to });
      expect(r.diagnostic?.code).not.toBe('unsettled-shape');
      if (to !== 'javascript') return;
      expect(r.success).toBe(true);
      for (const v of [2, 0.5])
        expect(r.run!({ x: v })).toBe(ce.box(['g', v]).evaluate().re);
    }
  );

  test.each(TARGETS)(
    'a Return in a branch that the code drops is not counted on %s',
    (to) => {
      // `If(3 < 2, Return([z, z]))` is dropped. With the condition `y < 0`,
      // decided at run time, the list is counted and the compilation
      // declines.
      const ce = engine();
      const body = (cond: MathJsonExpression): MathJsonExpression =>
        fn([
          'Block',
          z,
          ['If', cond, ['Return', ['List', 'z', 'z']]],
          [
            'If',
            ['Greater', 'y', 1],
            ['Return', ['Multiply', 3, 'z']],
            ['Add', 'z', 1],
          ],
        ]);
      ce.assign('g', ce.box(body(['Less', 3, 2])));
      ce.assign('h', ce.box(body(['Less', 'y', 0])));
      const r = compile(ce.box(['g', 'x']), { to });
      expect(r.diagnostic?.code).not.toBe('unsettled-shape');
      if (to !== 'javascript') return;
      expect(r.success).toBe(true);
      expect(r.run!({ x: 2 })).toBe(12);
      const s = compile(ce.box(['h', 'x']), { to });
      expect(s.success).toBe(false);
      expect(s.diagnostic?.code).toBe('unsettled-shape');
    }
  );
});

// A conditional whose value the code discards is not checked on the targets
// that are not shaders: a statement of a `Block` that is not its last one,
// the body of a `Loop`, and a branch of such a conditional. An `Assign` has
// the type of its value, so the branches of `If(x > 0, p ≔ (1, 2), n ≔ 3)`
// are a point and a number.
describe('A conditional in a statement position (R3)', () => {
  const IF: MathJsonExpression = [
    'If',
    ['Greater', 'x', 0],
    ['Assign', 'p', ['Tuple', 1, 2]],
    ['Assign', 'n', 3],
  ];
  const INIT: MathJsonExpression[] = [
    ['Assign', 'p', ['Tuple', 0, 0]],
    ['Assign', 'n', 0],
  ];
  const STATEMENTS: [string, MathJsonExpression][] = [
    ['a statement of a block', ['Block', ...INIT, IF, 'n']],
    [
      'the body of a loop',
      [
        'Block',
        ...INIT,
        [
          'Loop',
          [
            'If',
            ['Greater', 'k', 1],
            ['Assign', 'p', ['Tuple', 'k', 2]],
            ['Assign', 'n', 'k'],
          ],
          ['Element', 'k', ['Range', 1, 3]],
        ],
        ['Add', 'n', ['At', 'p', 1]],
      ],
    ],
    [
      'a branch of a conditional in a statement position',
      [
        'Block',
        ...INIT,
        ['If', ['Greater', 'x', 0], IF, ['Assign', 'n', 4]],
        ['Add', 'n', ['At', 'p', 1]],
      ],
    ],
  ];

  /** The value of the interpreter at `x`, on a fresh engine. */
  const interpret = (json: MathJsonExpression, x: number): unknown =>
    engine().box(json).subs({ x }).evaluate().json;

  test.each(STATEMENTS)('%s compiles on javascript', (_label, json) => {
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    for (const x of [2, -1]) expect(r.run!({ x })).toEqual(interpret(json, x));
  });

  test.each(STATEMENTS)('%s compiles on python', (_label, json) => {
    const r = compile(engine().box(json), { to: 'python' });
    expect(r.success).toBe(true);
  });

  // The shader code of a conditional in a statement position is a
  // conditional expression too (`c ? a : b`), whose branches must have the
  // same type.
  test.each(['glsl', 'wgsl'])('a statement of a block on %s', (to) => {
    const r = compile(engine().box(STATEMENTS[0][1]), { to });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  test('the last statement of a block is its value', () => {
    const r = compile(engine().box(['Block', ...INIT, IF]));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  test('a conditional in the value of an assignment is used', () => {
    const r = compile(
      engine().box([
        'Block',
        ['Assign', 'q', ['If', ['Greater', 'x', 0], ['List', 1, 2], 3]],
        'x',
      ])
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });
});

describe('The admission checks of round 1 of the review', () => {
  // A transparent alias is the type that it names.
  test('a transparent alias of `unknown` is refused', () => {
    const ce = engine();
    ce.declareType('U', 'unknown', { alias: true });
    ce.declareType('V', 'U', { alias: true });
    ce.declare('M', 'U');
    ce.declare('W', 'V');
    for (const name of ['M', 'W']) {
      const r = compile(ce.box(['Add', name, 1]));
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('untyped-input');
      expect(r.unsupported).toContain(name);
    }
  });

  // The `z` of the sum is its index, and the code does not read the input
  // `z`, which occurs free only in the branch that the code drops. The
  // check removes a name only when the code that is kept has no occurrence
  // of it at all, bound or free, so the input `z` is refused: the walk can
  // see a name as bound where the code reads the outer input.
  test('a name that the kept code binds is still refused', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'List',
      ['If', ['Less', 2, 3], 0, 'z'],
      ['Sum', 'z', ['Limits', 'z', 1, 3]],
    ];
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toContain('z');
    // A free `z` in the code that is kept is read.
    const kept = compile(
      ce.box([
        'List',
        ['If', ['Less', 'x', 3], 0, 'z'],
        ['Sum', 'z', ['Limits', 'z', 1, 3]],
      ])
    );
    expect(kept.success).toBe(false);
    expect(kept.diagnostic?.code).toBe('untyped-input');
    expect(kept.unsupported).toContain('z');
  });

  // Both branches of each `If` are the same object, so the expression is a
  // DAG of 41 nodes whose tree has 2^40 leaves. The walk lists each node,
  // and each value, once.
  test('a shared DAG of conditionals is checked in linear time', () => {
    const ce = engine();
    const target = new JavaScriptTarget().createTarget({
      cse: { enabled: false, instances: [], harvestOptions: {} },
    });
    const dag = (base: MathJsonExpression) => {
      let e = ce.box(base);
      for (let i = 0; i < 40; i++)
        e = ce.function('If', [ce.box(['Greater', 'x', i]), e, e]);
      expect(e.operator).toBe('If');
      return e;
    };
    expect(unsettledShapeIn(dag(['Multiply', 'x', 2]), target)).toBeUndefined();
    const conflict = ce.box(['If', ['Greater', 'x', 0], ['List', 1, 2], 3]);
    const found = unsettledShapeIn(dag(conflict.json), target);
    expect(found?.reason).toBe('branches');
    expect(found?.node.isSame(conflict)).toBe(true);
  });

  // Each dictionary holds the dictionary below it under two keys, so the
  // expression is a DAG of 31 dictionaries whose tree has 2^30 leaves. The
  // walks that search the values of a dictionary read each one once. The
  // test asserts no time: a walk that followed each path of the tree would
  // not end before the Jest timeout of the test, and the test would fail.
  test('a shared DAG of dictionaries is checked in linear time', () => {
    const ce = engine();
    const target = new JavaScriptTarget().createTarget({
      cse: { enabled: false, instances: [], harvestOptions: {} },
    });
    const kv = (k: string, v: ReturnType<typeof ce.box>) =>
      ce.function('KeyValuePair', [ce.box({ str: k }), v]);
    let d = ce.function('Dictionary', [kv('a', ce.box('i'))]);
    for (let n = 0; n < 30; n++)
      d = ce.function('Dictionary', [kv('a', d), kv('b', d)]);
    const json = ce.function('Block', [
      ce.box(['Assign', 'p', 0]),
      ce.function('Loop', [d, ce.box(['Element', 'i', ['List', 1]])]),
      ce.function('Comprehension', [d, ce.box(['Element', 'i', ['List', 1]])]),
      ce.symbol('p'),
    ]);
    expect(unsettledShapeIn(json, target)).toBeUndefined();
  });

  // The check of the inputs fails closed: when the reference analysis
  // throws, the compilation declines.
  test('an analysis that throws declines', () => {
    const ce = engine();
    const target = new JavaScriptTarget().createTarget({
      cse: { enabled: false, instances: [], harvestOptions: {} },
    });
    // A target whose `varsKeys` throws when the analysis reads it.
    const failing = Object.create(target, {
      varsKeys: {
        get() {
          throw new Error('analysis failed');
        },
      },
    });
    let error: unknown;
    try {
      untypedInputs(ce.box(['Add', 'x', 1]), failing);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({
      diagnostic: { code: 'untyped-input', kind: 'correctness' },
    });
  });

  // The fallback names the same inputs as the decline: a name that occurs
  // only in a branch that the code drops is not named, also when another
  // reason declines.
  test('the fallback of another decline names only the inputs that are read', () => {
    const ce = engine();
    const r = compile(
      ce.box(['List', ['If', ['Less', 2, 3], 0, 'z'], ['Foo', 'x'], 'M'])
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).not.toBe('untyped-input');
    expect(r.unsupported).toContain('M');
    expect(r.unsupported).not.toContain('z');
  });
});

describe('The admission checks of round 2 of the review', () => {
  /** The value of the interpreter at `vars`, on the engine `ce`. */
  const interpret = (
    ce: ComputeEngine,
    json: MathJsonExpression,
    vars: Record<string, number>
  ): unknown => ce.box(json).subs(vars).evaluate().json;

  // The branches of a conditional in a statement position assign values of
  // different shapes to `p`, which is read later. The compiled code gave
  // `null` at `x = 1`, where the interpreter gives `[2, 4]`.
  test.each(TARGETS)(
    'values of different shapes assigned to one name decline on %s',
    (to) => {
      const ce = engine();
      const json: MathJsonExpression = [
        'Block',
        [
          'If',
          ['Greater', 'x', 0],
          ['Assign', 'p', ['List', 1, 2]],
          ['Assign', 'p', 3],
        ],
        ['Multiply', 2, 'p'],
      ];
      expect(interpret(ce, json, { x: 1 })).toEqual(['List', 2, 4]);
      const r = compile(ce.box(json), { to });
      expect(r.success).toBe(false);
      // On interval-js, the lowering of the `If` declines first. On a shader
      // target, the conditional in a statement position declines first: its
      // branches have different shapes.
      if (to === 'interval-js') return;
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      if (to === 'glsl' || to === 'wgsl') return;
      expect(r.error).toMatch(/the name that it assigns gets values or types/);
    }
  );

  test('the same shape assigned to one name in a statement compiles', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', ['Tuple', 0, 0]],
      [
        'If',
        ['Greater', 'x', 0],
        ['Assign', 'p', ['Tuple', 1, 2]],
        ['Assign', 'p', ['Tuple', 3, 4]],
      ],
      ['At', 'p', 1],
    ];
    const r = compile(ce.box(json), { fallback: false });
    expect(r.success).toBe(true);
    for (const x of [1, -1])
      expect(r.run!({ x })).toEqual(interpret(ce, json, { x }));
  });

  test('a value assigned in a loop body is compared too', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Loop',
        ['If', ['Greater', 'k', 1], ['Assign', 'p', ['List', 'k', 2]]],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      ['Multiply', 2, 'p'],
    ];
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  // The variable of an indefinite integral is the outer input `x`, which
  // the walk sees as bound. `x` also occurs in a branch that the code
  // drops, and it stays refused.
  test.each(['javascript', 'interval-js'])(
    'the variable of an indefinite integral is an input on %s',
    (to) => {
      const ce = new ComputeEngine();
      const r = compile(
        ce.box([
          'Add',
          ['If', ['Less', 2, 3], 0, 'x'],
          [
            'Integrate',
            ['Power', 'x', 2],
            ['Limits', 'x', 'Nothing', 'Nothing'],
          ],
        ]),
        { to }
      );
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('untyped-input');
      expect(r.unsupported).toContain('x');
    }
  );

  // An input mapped through `vars` that occurs only in a dropped branch is
  // not read, as without the mapping.
  test('a vars-mapped name in a dropped branch is not read', () => {
    const ce = new ComputeEngine();
    const json: MathJsonExpression = ['If', ['Less', 2, 3], 0, 'z'];
    for (const options of [{}, { vars: { z: '_.z' } }]) {
      const r = compile(ce.box(json), { fallback: false, ...options });
      expect(r.success).toBe(true);
      expect(r.run!({})).toBe(0);
    }
  });

  // Inference gives the input `p` the type `number` from the read `2p`, but
  // the code assigns lists to `p`. The compiled code gave `null` where the
  // interpreter gives `[2, 4]` and `[6, 8]`. The assigned value and the
  // type of the input have different shapes.
  test.each([
    [
      'two branches',
      [
        'If',
        ['Greater', 'x', 0],
        ['Assign', 'p', ['List', 1, 2]],
        ['Assign', 'p', ['List', 3, 4]],
      ],
    ],
    [
      'one branch',
      ['If', ['Greater', 'x', 0], ['Assign', 'p', ['List', 1, 2]]],
    ],
  ] as [string, MathJsonExpression][])(
    'a list assigned to an input inferred as a number declines: %s',
    (_label, statement) => {
      const ce = engine();
      const json: MathJsonExpression = [
        'Block',
        statement,
        ['Multiply', 2, 'p'],
      ];
      expect(interpret(ce, json, { x: 1 })).toEqual(['List', 2, 4]);
      for (const to of TARGETS) {
        // The evaluation above assigned `p` in `ce`: a new engine.
        const r = compile(engine().box(json), { to });
        expect(r.success).toBe(false);
        // interval-js has no lowering of a `List`, and Python none of an
        // `If` with no `else`: these decline first.
        if (to === 'interval-js' || to === 'python') continue;
        expect(r.diagnostic?.code).toBe('unsettled-shape');
      }
      // A declared type of the same shape is accepted.
      const declared = engine();
      declared.declare('p', 'list<real>');
      const d = compile(declared.box(json), { fallback: false });
      expect(d.success).toBe(true);
      expect(d.run!({ x: 1, p: [5, 6] })).toEqual([2, 4]);
    }
  );

  // The literal `F` is the value of `f` and also a discarded statement of
  // the block. The walk reaches it through the call `f(x)` as the root of
  // a body, whose values are used.
  test('a body reached through a function definition is used', () => {
    const ce = engine();
    const F = ce.box([
      'Function',
      ['Block', ['If', ['Greater', 'y', 1], ['Return', 1]], ['List', 'y', 'y']],
      'y',
    ]);
    ce.declare('f', 'function');
    ce.assign('f', F);
    const block = ce.function('Block', [F, ce.box(['f', 'x'])]);
    expect(block.ops[0]).toBe(F);
    const r = compile(block);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });
});

// The names that the code assigns. A local of a block is not an input. The
// values of an input that the code assigns are compared with its type, and
// the values that a name can have after a conditional are compared with
// each other.
describe('Assigned names and the shapes of their values', () => {
  const SHAPE_TARGETS = ['javascript', 'glsl', 'wgsl'];
  const gt: MathJsonExpression = ['Greater', 'x', 0];

  /** An engine with `x: real` and the function `f(t) = body`. */
  const withF = (body?: MathJsonExpression): ComputeEngine => {
    const ce = engine();
    if (body !== undefined) {
      ce.declare('f', 'function');
      ce.assign('f', ce.box(['Function', body, 't']));
    }
    return ce;
  };

  /** The value of the interpreter of `json` at `x`, as MathJSON. */
  const interpret = (
    json: MathJsonExpression,
    x: number,
    body?: MathJsonExpression
  ): unknown => {
    const ce = withF(body);
    ce.assign('x', x);
    return ce.box(json).evaluate().json;
  };

  /** The MathJSON value `v` as the compiled code gives it: a `List` is an
   * array. */
  const plain = (v: unknown): unknown =>
    Array.isArray(v) && v[0] === 'List' ? v.slice(1).map(plain) : v;

  // `Assign(x, 2x)` writes the loop index, not the input `x`, which the
  // code only reads after the loop. The input `x` has a type, and is not
  // refused. (JavaScript declines a loop whose body assigns its index, for
  // another reason; the Python target compiles it, as
  // `ce-583-block-local-list-no-copy.test.ts` checks.)
  test('an assignment to a loop index does not write the input', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Declare', 's', "'real'"],
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 'x', ['Multiply', 2, 'x']],
          ['Assign', 's', ['Add', 's', 'x']],
        ],
        ['Element', 'x', ['Range', 1, 3]],
      ],
      ['Add', 's', 'x'],
    ];
    expect(interpret(json, 1)).toBe(13);
    const r = compile(engine().box(json));
    expect(r.freeSymbols).toEqual(['x']);
    expect(r.diagnostic?.code).not.toBe('untyped-input');
    expect(r.diagnostic?.code).not.toBe('unsettled-shape');
    expect(r.error).toMatch(/assigns the loop index/);
  });

  // The input `acc` has the type that inference gives it, a number, and the
  // code assigns it numbers.
  test('an input assigned values of the shape of its type compiles', () => {
    const json: MathJsonExpression = [
      'Block',
      [
        'Loop',
        ['Assign', 'acc', ['Add', 'acc', 'i']],
        ['Element', 'i', ['Range', 1, 5]],
      ],
      'acc',
    ];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ acc: 1 })).toBe(16);
    const ce = engine();
    ce.assign('acc', 1);
    expect(ce.box(json).evaluate().json).toBe(16);
  });

  // The placeholder `_` of a destructuring target writes nothing, and is not
  // an input.
  test('the placeholder of a destructuring target is not an input', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', ['Tuple', 'a', '_'], ['Tuple', 'x', ['List', 1, 2]]],
      ['Assign', ['Tuple', 'b', '_'], ['Tuple', 2, 3]],
      ['Add', 'a', 'b'],
    ];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.freeSymbols).not.toContain('_');
    expect(r.run!({ x: 1 })).toBe(3);
    expect(interpret(json, 1)).toBe(3);
  });

  // The declared type of an input is compared with the values that the code
  // assigns to it. The interpreter gives an `incompatible-type` error.
  test.each([
    ['real', ['Assign', 'p', ['List', 1, 2]]],
    ['list<real>', ['Assign', 'p', 3]],
  ] as [string, MathJsonExpression][])(
    'a value of another shape than the declared type `%s` declines',
    (type, assign) => {
      const json: MathJsonExpression = [
        'Block',
        ['If', gt, assign],
        ['Multiply', 2, 'p'],
      ];
      const ce = engine();
      ce.declare('p', type);
      ce.assign('x', 1);
      expect(JSON.stringify(ce.box(json).evaluate().json)).toMatch(
        /incompatible-type/
      );
      for (const to of SHAPE_TARGETS) {
        const typed = engine();
        typed.declare('p', type);
        const r = compile(typed.box(json), { to });
        expect(r.success).toBe(false);
        // A shader has no lowering of `2p` for a list: it declines first.
        if (to !== 'javascript' && type !== 'real') continue;
        expect(r.diagnostic?.code).toBe('unsettled-shape');
      }
    }
  );

  // In a function body, `p` is a local of the body, which both branches
  // assign. The compiled code gives the interpreter's values.
  test('a local that both branches assign lists compiles', () => {
    const body: MathJsonExpression = [
      'Block',
      [
        'If',
        ['Greater', 't', 0],
        ['Assign', 'p', ['List', 1, 2]],
        ['Assign', 'p', ['List', 3, 4]],
      ],
      ['Multiply', 2, 'p'],
    ];
    const json: MathJsonExpression = ['f', 'x'];
    const r = compile(withF(body).box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.freeSymbols).toEqual(['x']);
    for (const x of [1, -1])
      expect(r.run!({ x })).toEqual(plain(interpret(json, x, body)));
    expect(interpret(json, 1, body)).toEqual(['List', 2, 4]);
    for (const to of ['glsl', 'wgsl'])
      expect(compile(withF(body).box(json), { to }).success).toBe(true);
  });

  // The branches give the local `p` a list and a number.
  test.each(SHAPE_TARGETS)(
    'a local that the branches give different shapes declines on %s',
    (to) => {
      const body: MathJsonExpression = [
        'Block',
        [
          'If',
          ['Greater', 't', 0],
          ['Assign', 'p', ['List', 1, 2]],
          ['Assign', 'p', 3],
        ],
        ['Multiply', 2, 'p'],
      ];
      expect(interpret(['f', 'x'], 1, body)).toEqual(['List', 2, 4]);
      const r = compile(withF(body).box(['f', 'x']), { to });
      expect(r.success).toBe(false);
      // On a shader, the declaration of the local declines first.
      if (to === 'javascript')
        expect(r.diagnostic?.code).toBe('unsettled-shape');
    }
  );

  // Only one branch assigns the local `p`, and nothing assigns it before.
  // The interpreter gives `read-before-declaration` for the read of `p`
  // when the branch does not run, which compiled code cannot give, so the
  // compilation declines on every target (CE-636).
  test('a local that one branch assigns declines where it is read', () => {
    const body: MathJsonExpression = [
      'Block',
      ['If', ['Greater', 't', 0], ['Assign', 'p', ['List', 1, 2]]],
      ['Multiply', 2, 'p'],
    ];
    const json: MathJsonExpression = ['f', 'x'];
    expect(interpret(json, 1, body)).toEqual(['List', 2, 4]);
    expect(JSON.stringify(interpret(json, -1, body))).toMatch(
      /read-before-declaration/
    );
    for (const to of ['javascript', 'glsl', 'wgsl']) {
      const s = compile(withF(body).box(json), { to });
      expect(s.success).toBe(false);
      expect(s.error).toMatch(/when no assignment gave it a value/);
    }
  });

  // The path on which the `If` runs no branch keeps the number that `p` had
  // before the `If`.
  test.each(SHAPE_TARGETS)(
    'a branch that changes the shape of an assigned name declines on %s',
    (to) => {
      const json: MathJsonExpression = [
        'Block',
        ['Assign', 'p', 0],
        ['If', gt, ['Assign', 'p', ['List', 1, 2]]],
        ['Multiply', 2, 'p'],
      ];
      expect(interpret(json, 1)).toEqual(['List', 2, 4]);
      expect(interpret(json, -1)).toBe(0);
      const r = compile(engine().box(json), { to });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      expect(r.error).toMatch(/the name that it assigns gets values or types/);
    }
  );

  // The assignments of a local are compared also when they are in a
  // sequence. Here `t`, the parameter of `f`, has no type, so the elements
  // of `[t, 2]` have no settled shape, and the two values of `q` do not
  // conflict.
  test('a local assigned a list, then a list of lists, compiles', () => {
    const body: MathJsonExpression = [
      'Block',
      ['Assign', 'q', ['List', 't', 2]],
      ['Assign', 'q', ['List', ['List', 't', 2]]],
      'q',
    ];
    const json: MathJsonExpression = ['f', 'x'];
    const r = compile(withF(body).box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ x: 1 })).toEqual([[1, 2]]);
    expect(interpret(json, 1, body)).toEqual(['List', ['List', 1, 2]]);
  });

  // With the parameter `t` typed `real`, `[t, 2]` is a list of numbers and
  // `[[t, 2]]` is a list of lists: the values of `q` conflict, and the
  // compilation declines.
  test('a local assigned a list of numbers, then a list of lists, declines', () => {
    const body: MathJsonExpression = [
      'Block',
      ['Assign', 'q', ['List', 't', 2]],
      ['Assign', 'q', ['List', ['List', 't', 2]]],
      'q',
    ];
    const ce = engine();
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', body, ['Typed', 't', "'real'"]]));
    const r = compile(ce.box(['f', 'x']));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  // The `p` that the nested block declares is another variable: its
  // numbers are not compared with the list of the outer `p`.
  test.each(['javascript', 'glsl', 'wgsl', 'python'])(
    'a nested local of the same name is another variable on %s',
    (to) => {
      const json: MathJsonExpression = [
        'Block',
        ['Assign', 'p', ['List', 1, 2]],
        [
          'Block',
          ['Declare', 'p', "'real'"],
          ['If', gt, ['Assign', 'p', 3], ['Assign', 'p', 4]],
          'p',
        ],
        ['Multiply', 2, 'p'],
      ];
      const r = compile(engine().box(json), { to, fallback: false });
      expect(r.success).toBe(true);
      if (to === 'javascript') {
        expect(r.run!({ x: 1 })).toEqual([2, 4]);
        expect(interpret(json, 1)).toEqual(['List', 2, 4]);
      }
    }
  );

  // A path that does not assign the local keeps its declared type, here
  // `real`, which is compared with the list of the other branch.
  test('the declared type of a local is its shape before a conditional', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Declare', 'p', "'real'"],
      ['Assign', 'p', 1],
      ['If', gt, ['Assign', 'p', ['List', 1, 2]]],
      'p',
    ];
    const r = compile(engine().box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });
});

describe('The paths of the code that meet after a node (R3)', () => {
  const SHAPE_TARGETS = ['javascript', 'glsl', 'wgsl'];
  const gt: MathJsonExpression = ['Greater', 'x', 0];
  const lt: MathJsonExpression = ['Less', 'x', 0];
  const list: MathJsonExpression = ['List', 1, 2];
  const range: MathJsonExpression = ['Element', 'i', ['Range', 1, 3]];

  /** The value of the interpreter of `json` at `x`, as MathJSON. */
  const interpret = (json: MathJsonExpression, x: number): unknown => {
    const ce = engine();
    ce.assign('x', x);
    return ce.box(json).evaluate().json;
  };

  const declines = (json: MathJsonExpression, to: string): void => {
    const r = compile(engine().box(json), { to: to as any });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  };

  // The body of a loop can run no time: after the loop, `p` is the number
  // before it or the list of the body.
  test.each(SHAPE_TARGETS)('a loop body that changes a shape on %s', (to) => {
    declines(
      [
        'Block',
        ['Assign', 'p', 0],
        ['Loop', ['Assign', 'p', list], range],
        ['Multiply', 2, 'p'],
      ],
      to
    );
    declines(
      [
        'Block',
        ['Assign', 'p', list],
        ['Loop', ['Assign', 'p', 0], range],
        ['Multiply', 2, 'p'],
      ],
      to
    );
  });

  test('a loop over a list input that changes a shape', () => {
    declines(
      [
        'Block',
        ['Assign', 'p', 0],
        ['Loop', ['Assign', 'p', list], ['Element', 'i', 'L']],
        ['Multiply', 2, 'p'],
      ],
      'javascript'
    );
  });

  // The body of a `Sum` with an index runs zero or more times too.
  test.each(SHAPE_TARGETS)('a Sum body that changes a shape on %s', (to) => {
    declines(
      [
        'Block',
        ['Assign', 'p', 0],
        [
          'Assign',
          's',
          ['Sum', ['Block', ['Assign', 'p', list], 'i'], ['Limits', 'i', 1, 3]],
        ],
        ['Add', 's', ['Multiply', 2, 'p']],
      ],
      to
    );
  });

  test.each(SHAPE_TARGETS)('a loop body that keeps the shape on %s', (to) => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Assign',
        's',
        ['Sum', ['Block', ['Assign', 'p', 'i'], 'i'], ['Limits', 'i', 1, 3]],
      ],
      ['Loop', ['Assign', 'p', ['Add', 'p', 'i']], range],
      ['Add', 's', ['Multiply', 2, 'p']],
    ];
    const r = compile(engine().box(json), { to: to as any, fallback: false });
    expect(r.success).toBe(true);
    if (to === 'javascript') {
      expect(interpret(json, 1)).toBe(24);
      expect(r.run!({ x: 1 })).toBe(24);
    }
  });

  // In the second pass, `p` can be the number of the first pass, and the
  // `If` can give it a list.
  test('a conditional that a second pass of a loop reaches', () => {
    declines(
      [
        'Block',
        ['Assign', 'q', 0],
        [
          'Loop',
          [
            'Block',
            ['If', ['Greater', 'i', 'x'], ['Assign', 'p', list]],
            ['Assign', 'p', 0],
            ['Assign', 'q', ['Add', 'q', 'p']],
          ],
          range,
        ],
        'q',
      ],
      'javascript'
    );
  });

  // A `Break` takes its state to the state after the loop.
  test('a Break after an assignment of another shape', () => {
    declines(
      [
        'Block',
        ['Assign', 'p', 0],
        [
          'Loop',
          [
            'If',
            ['Greater', 'i', 'x'],
            ['Block', ['Assign', 'p', list], ['Break']],
          ],
          range,
        ],
        ['Multiply', 2, 'p'],
      ],
      'javascript'
    );
  });

  // The second condition runs only when the first one is false, and it can
  // give `p` a list.
  test.each(['javascript', 'wgsl'])(
    'a Which condition that assigns on %s',
    (to) => {
      declines(
        [
          'Block',
          ['Assign', 'p', 0],
          ['Which', gt, 0, ['Block', ['Assign', 'p', list], lt], 0],
          ['Multiply', 2, 'p'],
        ],
        to
      );
    }
  );

  test.each(SHAPE_TARGETS)('a Match guard that assigns on %s', (to) => {
    declines(
      [
        'Block',
        ['Assign', 'p', 0],
        [
          'Match',
          'x',
          ['MatchCase', 1, ['Block', ['Assign', 'p', list], gt], 0],
          ['MatchCase', '_', 0],
        ],
        ['Multiply', 2, 'p'],
      ],
      to
    );
  });

  // The guard and the body of a case are held raw; the check reads their
  // canonical form, also with captures.
  test('a Match body with captures that assigns', () => {
    declines(
      [
        'Block',
        ['Assign', 'p', 0],
        [
          'Match',
          ['Tuple', 'x', 1],
          [
            'MatchCase',
            ['Tuple', '_a', '_b'],
            ['Assign', 'p', ['List', '_a', '_b']],
          ],
          ['MatchCase', '_', 0],
        ],
        ['Multiply', 2, 'p'],
      ],
      'javascript'
    );
  });

  test('a Match guard that keeps the shape', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Match',
        'x',
        ['MatchCase', 1, ['Block', ['Assign', 'p', 3], gt], 0],
        ['MatchCase', '_', 0],
      ],
      ['Multiply', 2, 'p'],
    ];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    for (const x of [1, 2]) expect(r.run!({ x })).toBe(interpret(json, x));
  });

  // The second operand of `Or` runs only when the first one is false.
  test('an Or operand that assigns', () => {
    declines(
      [
        'Block',
        ['Assign', 'p', 0],
        ['Or', gt, ['Block', ['Assign', 'p', list], 'True']],
        ['Multiply', 2, 'p'],
      ],
      'javascript'
    );
  });

  // The branch that assigns the list returns: where `2p` is evaluated, `p`
  // is the number, and the interpreter has a value. The simple rule does not
  // examine the paths of the code: `p` gets a number and a list in one
  // scope, so the compilation declines.
  test('a branch that ends in a Return, with another shape, declines', () => {
    const json: MathJsonExpression = [
      [
        'Function',
        [
          'Block',
          ['Assign', 'p', 0],
          [
            'If',
            ['Greater', 't', 0],
            ['Block', ['Assign', 'p', list], ['Return', 1]],
          ],
          ['Multiply', 2, 'p'],
        ],
        't',
      ],
      'x',
    ];
    expect(interpret(json, 2)).toBe(1);
    expect(interpret(json, -1)).toBe(0);
    declines(json, 'javascript');
  });

  // The rule has no flow analysis, so the depth of the code does not limit
  // it: each assignment of `q` gives it a number.
  test('a deeply nested assignment of one shape compiles', () => {
    let nested: MathJsonExpression = ['Assign', 'q', ['Add', 'q', 1]];
    for (let k = 0; k < 12; k++)
      nested = ['Loop', nested, ['Element', `i${k}`, ['Range', 1, 2]]];
    const json: MathJsonExpression = ['Block', ['Assign', 'q', 0], nested, 'q'];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(4096);
    expect(engine().box(json).evaluate().json).toBe(4096);
  });
});

describe('The paths of the code that meet after a node, round 5 of the review (R3)', () => {
  const list: MathJsonExpression = ['List', 1, 2];

  /** The value of the interpreter of `json` with the inputs `args`. */
  const interpret = (
    json: MathJsonExpression,
    args: Record<string, number | number[]>
  ): unknown => {
    const ce = engine();
    for (const [k, v] of Object.entries(args))
      ce.assign(k, Array.isArray(v) ? ce.box(['List', ...v]) : v);
    return ce.box(json).evaluate().json;
  };

  // The guard of a case is a function that the interpreter applies: its
  // `Return` ends the guard, and `p` is a list after the `Match` when
  // x = 1, and a number for any other x.
  test('a Return in the guard of a case of a Match', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Match',
        'x',
        [
          'MatchCase',
          1,
          ['Block', ['Assign', 'p', list], ['Return', 'True']],
          0,
        ],
        ['MatchCase', '_', 0],
      ],
      'x',
    ];
    const r = compile(engine().box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  // The body of a case is a function too: its `Return` ends the body, and
  // `p` is a list after the `Match` when x = 1. The compilation declines
  // (the compiled `Match` also refuses a `Return` in a case body).
  test('a Return in the body of a case of a Match', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Match',
        'x',
        ['MatchCase', 1, ['Block', ['Assign', 'p', list], ['Return', 0]]],
        ['MatchCase', '_', 0],
      ],
      ['Multiply', 2, 'p'],
    ];
    const r = compile(engine().box(json));
    expect(r.success).toBe(false);
    expect(interpret(json, { x: 1 })).toEqual(['List', 2, 4]);
  });

  // No value reaches the end of the `Match` without the wildcard case:
  // `p` is always the list.
  // After the wildcard case, `p` is always the list, and the interpreter
  // gives `[2, 4]`. The simple rule does not examine the order of the
  // assignments: `p` gets a number and a list in one scope, so the
  // compilation declines.
  test('a wildcard case that reassigns another shape declines', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      ['Match', 'x', ['MatchCase', '_', ['Assign', 'p', list]]],
      ['Multiply', 2, 'p'],
    ];
    expect(interpret(json, { x: 1 })).toEqual(['List', 2, 4]);
    const r = compile(engine().box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  // `L > 0` is a list of booleans: the `If` selects element-wise, and the
  // compiled code cannot assign `p` for some elements only. Before this
  // check, the compiled code gave 10 for L = [-1, -2] (the interpreter
  // gives 0).
  test.each(TARGETS)('an element-wise If whose branch assigns on %s', (to) => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      ['If', ['Greater', 'L', 0], ['Assign', 'p', 5]],
      ['Multiply', 2, 'p'],
    ];
    const r = compile(engine().box(json), { to: to as any });
    expect(r.success).toBe(false);
    if (to === 'javascript') {
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      expect(r.error).toMatch(/element-wise selection/);
      expect(interpret(json, { L: [-1, -2] })).toBe(0);
    }
  });

  test('an element-wise If whose branches change nothing', () => {
    const json: MathJsonExpression = ['If', ['Greater', 'L', 0], 1, 2];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(interpret(json, { L: [-1, 2] })).toEqual(['List', 2, 1]);
    expect(r.run!({ L: [-1, 2] })).toEqual([2, 1]);
  });

  // A body that changes nothing needs no second pass, so the limit of
  // nested bodies does not apply to it.
  test('11 nested Sums that assign nothing', () => {
    let json: MathJsonExpression = 'x';
    for (let k = 0; k < 11; k++)
      json = ['Sum', json, ['Limits', `k${k}`, 1, 2]];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(interpret(json, { x: 1 })).toBe(2048);
    expect(r.run!({ x: 1 })).toBe(2048);
  });

  // An assignment in the guard of a clause of a `Comprehension` does not
  // change `p` in the interpreter, but the compiled code would change it:
  // the compilation declines.
  test('a guard of a Comprehension clause that assigns', () => {
    const ce = engine();
    ce.declare('M', 'list<integer>');
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Assign',
        'c',
        [
          'Comprehension',
          'i',
          [
            'Element',
            'i',
            'M',
            ['Block', ['Assign', 'p', list], ['Greater', 'i', 0]],
          ],
        ],
      ],
      ['Multiply', 2, 'p'],
    ];
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.error).toMatch(/inside the `Comprehension`/);
  });
});

describe('Assignments in a Comprehension, a Sum, a Product, an Integrate and in a conditional with a condition of no known shape (R3)', () => {
  const list: MathJsonExpression = ['List', 1, 2];

  /** The value of the interpreter of `json` with the inputs `args`. */
  const interpret = (
    ce: ComputeEngine,
    json: MathJsonExpression,
    args: Record<string, MathJsonExpression>
  ): unknown => {
    for (const [k, v] of Object.entries(args)) ce.assign(k, ce.box(v));
    return ce.box(json).evaluate().json;
  };

  /** True when the compilation of `json` declines with `pattern`. */
  const expectDecline = (
    ce: ComputeEngine,
    json: MathJsonExpression,
    pattern: RegExp
  ): void => {
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.error).toMatch(pattern);
  };

  // The interpreter evaluates the body of a `Comprehension` in a scope of
  // its own: `p` stays 0. The compiled code gave 5.
  test('an assignment in the body of a Comprehension', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Comprehension',
        ['Block', ['Assign', 'p', 5], 'i'],
        ['Element', 'i', ['List', 1]],
      ],
      'p',
    ];
    expect(interpret(engine(), json, {})).toBe(0);
    expectDecline(engine(), json, /inside the `Comprehension`/);
  });

  // The admission walks search the values of a dictionary, also of a nested
  // dictionary. The interpreter gives 0; the compiled code built the
  // dictionary and gave 5.
  test('an assignment in a dictionary in the body of a Comprehension', () => {
    const write: MathJsonExpression = ['Assign', 'p', 5];
    for (const body of [
      ['Dictionary', ['KeyValuePair', "'a'", write]],
      [
        'Dictionary',
        [
          'KeyValuePair',
          "'a'",
          ['Dictionary', ['KeyValuePair', "'b'", write]],
        ],
      ],
    ] as MathJsonExpression[]) {
      const json: MathJsonExpression = [
        'Block',
        ['Assign', 'p', 0],
        ['Comprehension', body, ['Element', 'i', ['List', 1]]],
        'p',
      ];
      expect(interpret(engine(), json, {})).toBe(0);
      expectDecline(engine(), json, /inside the `Comprehension`/);
    }
  });

  // A false guard ends the pass before the source of the second clause.
  // The interpreter gives 0 for every x; the compiled code gave [2, 4] for
  // x = -1 and 6 for x = 1.
  test('an assignment in a guard and in a later clause of a Comprehension', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Comprehension',
        'i',
        [
          'Element',
          'i',
          ['List', 1],
          ['Block', ['Assign', 'p', list], ['Greater', 'x', 0]],
        ],
        ['Element', 'j', ['Block', ['Assign', 'p', 3], ['List', 1]]],
      ],
      ['Multiply', 2, 'p'],
    ];
    expect(interpret(engine(), json, { x: -1 })).toBe(0);
    expect(interpret(engine(), json, { x: 1 })).toBe(0);
    expectDecline(engine(), json, /inside the `Comprehension`/);
  });

  // An assignment in the source of the first clause runs once, before the
  // comprehension, in the interpreter and in the compiled code.
  test('an assignment in the source of the first clause of a Comprehension', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Comprehension',
        'i',
        ['Element', 'i', ['Block', ['Assign', 'p', 5], list]],
      ],
      'p',
    ];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(interpret(engine(), json, {})).toBe(5);
    expect(r.run!({})).toBe(5);
  });

  // The interpreter does not change `p` for an assignment in a bound of a
  // `Sum` or a `Product`; the compiled code gave 4 and 2.
  //
  // The compilation declines while it generates the code of the big
  // operator: a bound with an effect (here the `Assign`) is refused by
  // `assertSafeBigOpBounds()` (`compile-folding.ts`), because the
  // interpreter does not evaluate a big operator over such a bound. The
  // admission check that also finds the assignment (R3, code
  // `unsettled-shape`) runs only after the code was generated with no
  // decline, so its reason is not the one reported.
  test.each(['Sum', 'Product'])('an assignment in a bound of a %s', (op) => {
    const first: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [op, 'i', ['Limits', 'i', 1, ['Block', ['Assign', 'p', 4], 2]]],
      'p',
    ];
    const later: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        op,
        ['Add', 'i', 'j'],
        ['Limits', 'i', 1, 2],
        ['Limits', 'j', 1, ['Block', ['Assign', 'p', ['Add', 'p', 1]], 2]],
      ],
      'p',
    ];
    for (const json of [first, later]) {
      expect(interpret(engine(), json, {})).toBe(0);
      const r = compile(engine().box(json));
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('compile-error');
      expect(r.error).toMatch(/upper bound `[^`]*` has an effect/);
    }
  });

  // An assignment in the body of a `Sum` or a `Product` changes `p` in the
  // interpreter and in the compiled code.
  test.each(['Sum', 'Product'])('an assignment in the body of a %s', (op) => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        op,
        ['Block', ['Assign', 'p', ['Add', 'p', 'i']], 'i'],
        ['Limits', 'i', 1, 3],
      ],
      'p',
    ];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(interpret(engine(), json, {})).toBe(6);
    expect(r.run!({})).toBe(6);
  });

  // The interpreter changes `p` for an assignment in the integrand or in a
  // bound of an `Integrate` (7 and 4); the compiled code, which evaluates
  // the integrand in a function of its own, gave 0.
  test('an assignment in the integrand or in a bound of an Integrate', () => {
    const body: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      ['Integrate', ['Block', ['Assign', 'p', 7], 't'], ['Limits', 't', 0, 1]],
      'p',
    ];
    const bound: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      ['Integrate', 't', ['Limits', 't', 0, ['Block', ['Assign', 'p', 4], 1]]],
      'p',
    ];
    expect(interpret(engine(), body, {})).toBe(7);
    expect(interpret(engine(), bound, {})).toBe(4);
    expectDecline(engine(), body, /inside the `Integrate`/);
    expectDecline(engine(), bound, /inside the `Integrate`/);
  });

  // A false guard of the first clause of a `Loop` ends the pass before the
  // source of the second clause: `p` is the list when x <= 0 and 3 when
  // x > 0.
  test('a Loop whose pass can end after each guard and clause', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Loop',
        'j',
        [
          'Element',
          'i',
          ['List', 1],
          ['Block', ['Assign', 'p', list], ['Greater', 'x', 0]],
        ],
        ['Element', 'j', ['Block', ['Assign', 'p', 3], ['List', 1]]],
      ],
      ['Multiply', 2, 'p'],
    ];
    expect(interpret(engine(), json, { x: -1 })).toEqual(['List', 2, 4]);
    expect(interpret(engine(), json, { x: 1 })).toBe(6);
    expectDecline(engine(), json, /different shapes/);
  });

  // A condition of type `any` can be a list, and then the interpreter
  // selects element-wise: with M = [[True, False]], it assigns `p` and
  // gives 10. The compiled code gave 0.
  test('a condition of type any whose branch assigns', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      ['If', ['At', 'M', 1], ['Assign', 'p', 5]],
      ['Multiply', 2, 'p'],
    ];
    const ce = engine();
    ce.declare('M', 'list<any>');
    expect(ce.box(['At', 'M', 1]).type.toString()).toBe('any');
    expectDecline(ce, json, /element-wise selection/);
    const ce2 = engine();
    ce2.declare('M', 'list<any>');
    expect(
      interpret(ce2, json, { M: ['List', ['List', 'True', 'False']] })
    ).toBe(10);
  });

  // The branches of a condition of type `any` give `p` a list or a number.
  test('a condition of type any whose branches conflict', () => {
    const ce = engine();
    ce.declare('M', 'list<any>');
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      ['If', ['At', 'M', 1], ['Assign', 'p', list], ['Assign', 'p', 3]],
      ['Multiply', 2, 'p'],
    ];
    expectDecline(ce, json, /element-wise selection/);
  });

  test('a condition of type any whose branches change nothing', () => {
    const ce = engine();
    ce.declare('N', 'list<any>');
    const json: MathJsonExpression = ['Add', 'x', ['If', ['At', 'N', 1], 1, 2]];
    const r = compile(ce.box(json));
    expect(r.diagnostic?.code).not.toBe('unsettled-shape');
  });

  // The untyped parameter `c` has the type `unknown`: the walk takes it as
  // a scalar, so the two branches are alternatives, and `p` is a list or a
  // number after the `If`.
  test('a condition of type unknown whose branches conflict', () => {
    const ce = engine();
    ce.declare('b', 'boolean');
    const json: MathJsonExpression = [
      'Apply',
      [
        'Function',
        [
          'Block',
          ['Assign', 'p', 0],
          ['If', 'c', ['Assign', 'p', list], ['Assign', 'p', 3]],
          ['Multiply', 2, 'p'],
        ],
        'c',
      ],
      'b',
    ];
    expectDecline(ce, json, /different shapes/);
  });

  test('a condition of type unknown whose branches agree', () => {
    const ce = engine();
    ce.declare('b', 'boolean');
    const json: MathJsonExpression = [
      'Apply',
      [
        'Function',
        [
          'Block',
          ['Assign', 'p', 0],
          ['If', 'c', ['Assign', 'p', 5], ['Assign', 'p', 3]],
          ['Multiply', 2, 'p'],
        ],
        'c',
      ],
      'b',
    ];
    const r = compile(ce.box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ b: true })).toBe(10);
    expect(r.run!({ b: false })).toBe(6);
  });
});

describe('Assignments in a function literal (R3)', () => {
  const L3: MathJsonExpression = ['List', 1, 2, 3];
  const fn = (
    body: MathJsonExpression,
    ...params: string[]
  ): MathJsonExpression => ['Function', body, ...params];
  const local = (value: MathJsonExpression): MathJsonExpression => [
    'Block',
    ['Declare', 'q', "'real'"],
    ['Assign', 'q', ['Multiply', 2, 't']],
    value,
  ];

  /** The interpreter's value of `json`, with a collection as a JS array. */
  const interpret = (json: MathJsonExpression): unknown => {
    const v = engine().box(json).evaluate();
    return v.isCollection ? [...v.each()].map((e) => e.re) : v.re;
  };

  const expectCompiled = (
    json: MathJsonExpression,
    expected: unknown
  ): void => {
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual(expected);
    expect(interpret(json)).toEqual(expected);
  };

  // A name that a `Block` of the part declares, a parameter of a function
  // literal of the part, and a `Return` of such a literal have no effect
  // outside the part.
  test('a Comprehension whose body assigns only its own names', () => {
    expectCompiled(
      [
        'Comprehension',
        [
          'Block',
          ['Declare', 'q', "'real'"],
          ['Assign', 'q', ['Multiply', 2, 'i']],
          'q',
        ],
        ['Element', 'i', L3],
      ],
      [2, 4, 6]
    );
    expectCompiled(
      [
        'Comprehension',
        ['Apply', fn(local('q'), 't'), 'i'],
        ['Element', 'i', L3],
      ],
      [2, 4, 6]
    );
    expectCompiled(
      [
        'Comprehension',
        [
          'Apply',
          fn(['Block', ['If', ['Greater', 't', 1], ['Return', 9]], 't'], 't'),
          'i',
        ],
        ['Element', 'i', L3],
      ],
      [1, 9, 9]
    );
  });

  // The interpreter does not change `p` for an assignment in the callback
  // of `Filter`, `Map` and `Tabulate`, and changes it for `Limit`; the
  // compiled code did the opposite (5, 5, 5 and 0). For `Find` both gave 5,
  // but the check of the shapes did not see the assignment.
  test.each<[string, MathJsonExpression, number]>([
    [
      'Filter',
      [
        'Filter',
        L3,
        fn(['Block', ['Assign', 'p', 5], ['Greater', 'u', 1]], 'u'),
      ],
      0,
    ],
    ['Map', ['Map', fn(['Block', ['Assign', 'p', 5], 'u'], 'u'), L3], 0],
    [
      'Tabulate',
      ['Tabulate', fn(['Block', ['Assign', 'p', 5], 'u'], 'u'), 3],
      0,
    ],
    ['Limit', ['Limit', fn(['Block', ['Assign', 'p', 5], 'u'], 'u'), 1], 5],
    [
      'Find',
      ['Find', L3, fn(['Block', ['Assign', 'p', 5], ['Greater', 'u', 1]], 'u')],
      5,
    ],
  ])('a callback of %s that assigns an outer name', (op, call, value) => {
    const json: MathJsonExpression = ['Block', ['Assign', 'p', 0], call, 'p'];
    expect(interpret(json)).toBe(value);
    const r = compile(engine().box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.error).toMatch(
      new RegExp(
        `the function passed to \`${op}\` assigns a name of an enclosing scope`
      )
    );
  });

  // With a list for `p`, the interpreter gave 1 and the compiled code
  // [2, 3].
  test('a callback that gives an outer name another shape', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Filter',
        L3,
        fn(
          ['Block', ['Assign', 'p', ['List', 1, 2]], ['Greater', 'u', 1]],
          'u'
        ),
      ],
      ['Add', 'p', 1],
    ];
    expect(interpret(json)).toBe(1);
    expect(compile(engine().box(json)).diagnostic?.code).toBe(
      'unsettled-shape'
    );
  });

  test('a callback that assigns only its own names', () => {
    const q = (value: MathJsonExpression): MathJsonExpression => [
      'Block',
      ['Declare', 'q', "'real'"],
      ['Assign', 'q', ['Multiply', 2, 'u']],
      value,
    ];
    expectCompiled(['Filter', L3, fn(q(['Greater', 'q', 2]), 'u')], [2, 3]);
    expectCompiled(['Map', fn(q('q'), 'u'), L3], [2, 4, 6]);
    expectCompiled(
      [
        'Tabulate',
        fn(['Block', ['Assign', 'y', ['Multiply', 2, 'u']], 'y'], 'u'),
        3,
      ],
      [2, 4, 6]
    );
    expectCompiled(['Find', L3, fn(q(['Greater', 'q', 3]), 'u')], 2);
  });

  // A function literal applied where it is written runs after its
  // arguments, and its assignment changes `p` after the `Apply`: `p` is a
  // list when x > 0 and 0 otherwise.
  test('an applied function literal that gives an outer name another shape', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'If',
        ['Greater', 'x', 0],
        ['Apply', fn(['Block', ['Assign', 'p', ['List', 1, 2]], 'u'], 'u'), 1],
        0,
      ],
      ['Add', 'p', 1],
    ];
    const r = compile(engine().box(json));
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.error).toMatch(/different shapes/);
    expectCompiled(
      [
        'Block',
        ['Assign', 'p', 0],
        ['Apply', fn(['Block', ['Assign', 'p', 5], 'u'], 'u'), 1],
        'p',
      ],
      5
    );
  });

  /** The diagnostic of the compilation of `json`, with no fallback. */
  const declined = (
    json: MathJsonExpression,
    ce = engine()
  ): { code?: string; error?: string } => {
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    return { code: r.diagnostic?.code, error: r.error };
  };
  const B = (...ops: MathJsonExpression[]): MathJsonExpression => [
    'Block',
    ...ops,
  ];
  const loop = (body: MathJsonExpression): MathJsonExpression => [
    'Loop',
    body,
    ['Element', 'i', L3],
  ];

  // A literal with a scalar parameter maps over a list argument, so its
  // body runs zero or more times: with an empty `L`, `p` stays 0.
  test('an applied function literal that maps over a list and assigns an outer name', () => {
    const json: MathJsonExpression = B(
      ['Assign', 'p', 0],
      [
        'Apply',
        [
          'Function',
          B(['Assign', 'p', ['List', 1, 2]], 'u'),
          ['Typed', 'u', "'real'"],
        ],
        'L',
      ],
      ['If', ['Greater', 'x', 0], ['Assign', 'p', ['List', 3, 4]]],
      'p'
    );
    const ce = engine();
    ce.assign('L', ce.box(['List']));
    ce.assign('x', -1);
    expect(ce.box(json).evaluate().re).toBe(0);
    const d = declined(json);
    expect(d.code).toBe('unsettled-shape');
    expect(d.error).toMatch(/the function passed to `Apply` assigns a name/);
  });

  // One literal object is the value of a `Declare` and the callback of a
  // `Filter`: the callback declines also when the walk reached the
  // literal first as the value of the `Declare`. The parts are boxed one by
  // one, so `p` is a name of the engine: it is declared, or the compilation
  // declines because the input `p` has no type.
  test('a shared function literal in a Declare and in a Filter', () => {
    const ce = engine();
    ce.declare('p', 'real');
    const f = ce.box([
      'Function',
      B(['Assign', 'p', 5], ['Greater', 'u', 1]),
      'u',
    ]);
    const json = ce.function('Block', [
      ce.box(['Assign', 'p', 0]),
      ce.function('Declare', [
        ce.symbol('g'),
        ce.function('Dictionary', [
          ce.function('KeyValuePair', [ce.box({ str: 'value' }), f]),
        ]),
      ]),
      ce.function('Assign', [
        ce.symbol('r'),
        ce.function('Filter', [ce.box(L3), f]),
      ]),
      ce.symbol('p'),
    ]);
    const r = compile(json);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/the function passed to `Filter`/);
  });

  // A block that assigns a parameter of an enclosing function writes the
  // parameter, in the interpreter and in the compiled code, although the
  // local scope of the block lists it. At p = 2 the interpreter gives 14
  // and [6, 6]; the compiled code gave 8 and null.
  test.each<[string, MathJsonExpression, unknown]>([
    [
      'a guard',
      B(
        [
          'Assign',
          'r',
          [
            'Comprehension',
            'i',
            [
              'Element',
              'i',
              L3,
              B(['Assign', 'p', ['Add', 'p', 'i']], ['Greater', 'i', 1]),
            ],
          ],
        ],
        ['Add', 'p', 0]
      ),
      14,
    ],
    [
      'a body',
      B(
        [
          'Assign',
          'r',
          [
            'Comprehension',
            B(['Assign', 'p', ['List', 'i', 'i']], 'p'),
            ['Element', 'i', L3],
          ],
        ],
        ['Add', ['Multiply', 2, 'p'], 0]
      ),
      [6, 6],
    ],
  ])(
    'a Comprehension whose %s assigns a parameter of the function',
    (_, body, value) => {
      const v = engine()
        .box(['Apply', fn(body, 'p'), 2])
        .evaluate();
      expect(v.isCollection ? [...v.each()].map((e) => e.re) : v.re).toEqual(
        value
      );
      expect(declined(fn(body, 'p')).error).toMatch(
        /inside the `Comprehension`/
      );
    }
  );

  // The parameter `p` has a value of its type (a number) before the loop,
  // and a list after a pass: at p = 2 the interpreter gives [6, 6], the
  // compiled code gave null.
  test('a Loop that assigns a list to a scalar parameter', () => {
    const body = B(loop(['Assign', 'p', ['List', 'i', 'i']]), [
      'Multiply',
      2,
      'p',
    ]);
    const v = engine()
      .box(['Apply', fn(body, 'p'), 2])
      .evaluate();
    expect([...v.each()].map((e) => e.re)).toEqual([6, 6]);
    expect(declined(fn(body, 'p')).error).toMatch(/different shapes/);
    expect(declined(['Apply', fn(body, 'p'), 'x']).error).toMatch(
      /different shapes/
    );
  });

  // A stored function that writes an outer name declines, whether or not
  // the write keeps the shape: the check cannot see every path by which it
  // reaches a callback operator (user decision 2026-11-01, ROADMAP CE-720).
  // The interpreter gives [2, 2] for the second expression.
  test('a stored function literal that assigns an outer name declines', () => {
    const D = (name: string, value: MathJsonExpression): MathJsonExpression => [
      'Declare',
      name,
      ['Dictionary', ['KeyValuePair', "'value'", value]],
    ];
    const json = B(
      ['Assign', 'p', 0],
      D('g', fn(B(['Assign', 'p', ['List', 1, 2]], ['Greater', 'k', 1]), 'k')),
      ['Assign', 'r', ['Filter', 'L', 'g']],
      ['Add', ['Multiply', 2, 'p'], 1]
    );
    expect(declined(json).error).toMatch(/a function \(stored, returned/);
    const kept = B(
      ['Assign', 'p', 0],
      D('g', fn(B(['Assign', 'p', ['Add', 'k', 1]], 'p'), 'k')),
      ['List', ['g', 1], 'p']
    );
    expect(interpret(kept)).toEqual([2, 2]);
    expect(declined(kept).code).toBe('unsettled-shape');
  });

  // The compiled `Loop` is a function of its own: a `Return` in it ended
  // only the loop, and the code after the loop ran. The interpreter gives
  // 5, the compiled code gave 107.
  test('a Return inside a Loop that has code after it', () => {
    const body = B(
      ['Assign', 'q', 0],
      loop(['If', ['Greater', 'i', 1], B(['Assign', 'q', 7], ['Return', 5])]),
      ['Add', 100, 'q']
    );
    expect(interpret(['Apply', fn(body, 'p'), 1])).toBe(5);
    expect(interpret(B(['Assign', 'f', fn(body, 'p')], ['f', 1]))).toBe(5);
    for (const json of [
      ['Apply', fn(body, 'p'), 'x'],
      body,
      B(['Assign', 'f', fn(body, 'p')], ['f', 'x']),
    ] as MathJsonExpression[]) {
      const d = declined(json);
      expect(d.code).toBe('unsettled-shape');
      expect(d.error).toMatch(/a `Return` inside a `Loop` is not compiled/);
    }
    // The loop is the last statement of the function, but it has an
    // indexing set: when no `Return` runs, the loop ends at the end of its
    // indexing set and the interpreter gives `Nothing`, which has no
    // compiled representation. The loop declines, and the fallback gives
    // the value of the interpreter.
    const tail: MathJsonExpression = [
      'Apply',
      fn(
        B(['Assign', 'q', 0], loop(['If', ['Greater', 'i', 1], ['Return', 5]])),
        'p'
      ),
      1,
    ];
    expect(interpret(tail)).toBe(5);
    const d = declined(tail);
    expect(d.code).toBe('unsettled-shape');
    expect(d.error).toMatch(/the value of this `Loop` is used/);
    expect(compile(engine().box(tail)).run!()).toBe(5);
  });

  // The Python target emits the loop inline, as a `for` statement in the
  // compiled function: the `return` in it ends that function, as the
  // `Return` ends it in the interpreter. The case compiles there.
  test('a Return inside a Loop that has code after it compiles on Python', () => {
    const json = B(
      ['Assign', 'q', 0],
      [
        'Loop',
        ['If', ['Greater', 'i', 1], B(['Assign', 'q', 7], ['Return', 5])],
        ['Element', 'i', 'L'],
      ],
      ['Add', 100, 'q']
    );
    const r = compile(engine().box(json), { to: 'python', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/^for i in L:\n/m);
    expect(r.code).toMatch(/^ {8}return 5$/m);
    expect(r.code).toMatch(/^return q \+ 100$/m);
  });

  // The compiled code of the body of a `Sum` or a `Product` is an
  // expression: a `Break` in it was a JavaScript syntax error.
  test.each(['Sum', 'Product'])('a Break in the body of a %s', (op) => {
    const json: MathJsonExpression = [
      'Block',
      [
        'Loop',
        [
          'Block',
          [
            op,
            ['Block', ['If', ['Greater', 'i', 1], ['Break']], 'i'],
            ['Limits', 'i', 1, 3],
          ],
          'j',
        ],
        ['Element', 'j', ['List', 1, 2]],
      ],
    ];
    const r = compile(engine().box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.error).toMatch(new RegExp(`inside the \`${op}\``));
  });
});

// The simple rule for assignments (user decision 2026-11-01, ROADMAP
// CE-712.1): in one scope, the values that the code assigns to a name, and
// the type of the name, must have one shape class (a number, a complex
// number, a string, a list, a point, a matrix). The order of the
// assignments and the paths of the code are not examined. The length of a
// list is not part of its shape.
describe('The simple rule for assignments (R3)', () => {
  const declinesWithShape = (json: MathJsonExpression, ce = engine()): void => {
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  };
  const compilesTo = (
    json: MathJsonExpression,
    vars: Record<string, unknown>,
    ce = engine()
  ): void => {
    const r = compile(ce.box(json), { fallback: false });
    expect(r.success).toBe(true);
    for (const [k, v] of Object.entries(vars)) ce.assign(k, v as number);
    expect(r.run!(vars as Record<string, number>)).toEqual(
      ce.box(json).evaluate().json
    );
  };

  // The interpreter gives [1, 2]: the second assignment replaces the
  // number. The compiled code gives `p` one representation.
  test('a sequential reassignment to another shape declines', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      ['Assign', 'p', ['List', 1, 2]],
      'p',
    ];
    expect(engine().box(json).evaluate().json).toEqual(['List', 1, 2]);
    declinesWithShape(json);
  });

  test('a list of another length is the same shape', () => {
    const r = compile(
      engine().box([
        'Block',
        ['Assign', 'p', ['List', 1, 2]],
        ['Assign', 'p', ['List', 1, 2, 3]],
        'p',
      ]),
      { fallback: false }
    );
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual([1, 2, 3]);
  });

  test('a list, then a matrix, declines', () => {
    declinesWithShape([
      'Block',
      ['Assign', 'q', ['List', 'x', 2]],
      ['Assign', 'q', ['List', ['List', 'x', 2]]],
      'q',
    ]);
  });

  test('a number, then a string, declines', () => {
    declinesWithShape([
      'Block',
      ['Assign', 'p', 1],
      ['Assign', 'p', "'ab'"],
      'p',
    ]);
  });

  // In the `strict` mode a real and a complex number are two
  // representations, and the compilation does not succeed. The default
  // `auto` mode retries in the `complex` mode, where every value that is not
  // typed real is lifted to a complex number: there the two are one class,
  // and the compiled value is the interpreter's `2i`.
  test('a real, then a complex number, compiles only in the complex mode', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 1],
      ['Assign', 'p', ['Complex', 0, 2]],
      'p',
    ];
    let strict: { success: boolean } | undefined;
    try {
      strict = compile(engine().box(json), { mode: 'strict', fallback: false });
    } catch {
      strict = { success: false };
    }
    expect(strict.success).toBe(false);
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual({ re: 0, im: 2 });
  });

  // The declared type of a local settles its shape.
  test('a value that contradicts the declared type of a local declines', () => {
    declinesWithShape([
      'Block',
      ['Declare', 'p', "'real'"],
      ['Assign', 'p', ['Tuple', 'x', 2]],
      'p',
    ]);
  });

  // A name that a `Declare` of a nested block declares is another variable.
  test('a declared local of a nested block is another variable', () => {
    compilesTo(
      [
        'Block',
        ['Assign', 'p', 1],
        [
          'Block',
          ['Declare', 'p', "'list<real>'"],
          ['Assign', 'p', ['List', 'x', 2]],
          'p',
        ],
        'p',
      ],
      { x: 3 }
    );
  });

  // Two branches that assign one shape compile, with no flow analysis.
  test('branches that assign one shape compile', () => {
    compilesTo(
      [
        'Block',
        ['Assign', 'p', 0],
        ['If', ['Greater', 'x', 0], ['Assign', 'p', 1], ['Assign', 'p', 2]],
        ['Multiply', 2, 'p'],
      ],
      { x: 1 }
    );
  });

  // A condition of type `boolean | missing` can be undecided and select no
  // branch. The rule does not depend on which branch runs: `p` gets a
  // number and a list.
  test('a condition that can select no branch, with another shape, declines', () => {
    const ce = engine();
    ce.declare('A', 'list<integer | missing>');
    ce.declare('B', 'list<integer | missing>');
    declinesWithShape(
      [
        'Block',
        ['Assign', 'p', 0],
        [
          'If',
          ['Equal', 'A', 'B'],
          ['Assign', 'p', ['List', 1, 2]],
          ['Assign', 'p', ['List', 3, 4]],
        ],
        'p',
      ],
      ce
    );
  });

  // The stored function `g` writes `p` with a number, and the code assigns
  // `p` a list after the definition: `p` gets both shapes in one scope.
  test('a stored function that writes an outer name, with a later reassignment, declines', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Declare',
        'g',
        [
          'Dictionary',
          [
            'KeyValuePair',
            "'value'",
            ['Function', ['Block', ['Assign', 'p', 5], 'p'], 'k'],
          ],
        ],
      ],
      ['Assign', 'p', ['List', 1, 2]],
      ['If', ['Greater', 'x', 0], ['g', 1], 0],
      'p',
    ];
    declinesWithShape(json);
  });

  // An assignment of the index of an enclosing loop in a function literal
  // that is applied where it is written declines: the interpreter gives 3
  // and the compiled code gave 1 (CE-723).
  test('an assignment of the index of an enclosing Loop in a function literal declines', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'n', 0],
      [
        'Loop',
        [
          'Block',
          ['Apply', ['Function', ['Assign', 'k', 5], 'u'], 0],
          ['Assign', 'n', ['Add', 'n', 1]],
        ],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      'n',
    ];
    expect(engine().box(json).evaluate().json).toBe(3);
    const r = compile(engine().box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.error).toMatch(
      /a function literal assigns the index of an enclosing/
    );
  });

  // A function literal that the body of another literal returns can reach a
  // callback operator, so its write of the parameter `y` of the outer
  // literal declines, although the interpreter and the compiled code agree
  // here (7). A literal held by a `Declare` is not a callback.
  test('a function literal returned by another literal is a callback', () => {
    const W: MathJsonExpression = [
      'Function',
      [
        'Function',
        ['Block', ['Block', ['Assign', 'y', 2], ['Add', 'y', 'x']]],
        'x',
      ],
      'y',
      'w',
    ];
    const json: MathJsonExpression = [
      'Apply',
      ['Apply', ['Apply', W, 0], 1],
      'x',
    ];
    const r = compile(engine().box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.run!({ x: 5 })).toBe(7);
  });
});

// The cases of round 1 of the review of the simple rule (CE-712.1).
describe('The admission checks of the review of the simple rule (R3)', () => {
  const declines = (json: MathJsonExpression, ce = engine()): void => {
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  };
  const writer: MathJsonExpression = [
    'Function',
    ['Block', ['Assign', 'p', 5], ['Greater', 'u', 1]],
    'u',
  ];
  const plain: MathJsonExpression = ['Function', ['Greater', 'u', 1], 'u'];

  // A branch of an `If` or a `Which` passes the literal on to the `Filter`,
  // which calls it: with x = 1 and L = [1, 2, 3], the interpreter gives 0
  // and the compiled code gave 5.
  test.each([
    ['If', ['If', ['Greater', 'x', 0], writer, plain]],
    ['Which', ['Which', ['Greater', 'x', 0], writer, 'True', plain]],
  ] as [string, MathJsonExpression][])(
    'a callback in a branch of an %s declines',
    (_, callback) => {
      declines(['Block', ['Assign', 'p', 0], ['Filter', 'L', callback], 'p']);
    }
  );

  test('a callback of Limit in a branch of an If declines', () => {
    const w: MathJsonExpression = [
      'Function',
      ['Block', ['Assign', 'p', 5], 'u'],
      'u',
    ];
    declines([
      'Block',
      ['Assign', 'p', 0],
      ['Limit', ['If', ['Greater', 'x', 0], w, ['Function', 'u', 'u']], 0],
      'p',
    ]);
  });

  // The literal is stored in `g`, and `g` is passed to `Filter`.
  test('a stored literal that writes an outer name, passed by name, declines', () => {
    declines([
      'Block',
      ['Assign', 'p', 0],
      ['Declare', 'g', ['Dictionary', ['KeyValuePair', "'value'", writer]]],
      ['Filter', 'L', 'g'],
      'p',
    ]);
  });

  // A stored literal that writes an outer name declines also when the code
  // only calls it by name, where the two would agree (the simple decline,
  // ROADMAP CE-720).
  test('a stored literal that writes an outer name, called by name, declines', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'p', 0],
      [
        'Declare',
        'g',
        [
          'Dictionary',
          [
            'KeyValuePair',
            "'value'",
            ['Function', ['Block', ['Assign', 'p', ['Add', 'k', 1]], 'p'], 'k'],
          ],
        ],
      ],
      ['List', ['g', 1], 'p'],
    ];
    declines(json);
  });

  // An input declared `complex` assigned a real: the interpreter gives 4 at
  // x = 1 and w = 1 + 2i, the compiled code gave {"re": null}.
  test('a real assigned to an input declared complex declines', () => {
    const ce = engine();
    ce.declare('w', 'complex');
    declines(
      [
        'Block',
        ['If', ['Greater', 'x', 0], ['Assign', 'w', 3]],
        ['Add', 'w', 1],
      ],
      ce
    );
  });

  // An input of type `number` is read as a real number: a complex value
  // assigned to it gave "[object Object]1".
  test('a complex number assigned to an input of type number declines', () => {
    const ce = engine();
    ce.declare('q', 'number');
    declines(
      [
        'Block',
        ['If', ['Greater', 'x', 0], ['Assign', 'q', ['Complex', 0, 2]]],
        ['Add', 'q', 1],
      ],
      ce
    );
  });

  test('a Match whose cases have different shapes declines', () => {
    declines([
      'Match',
      'x',
      ['MatchCase', 1, ['List', 1, 2]],
      ['MatchCase', '_', 3],
    ]);
  });

  test('a conditional with different shapes in a case of a Match declines', () => {
    declines([
      'Match',
      'x',
      ['MatchCase', 1, ['If', ['Greater', 'x', 0], ['List', 1, 2], 3]],
      ['MatchCase', '_', 3],
    ]);
  });

  test('a Match whose cases have one shape compiles', () => {
    const json: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', 1, 2],
      ['MatchCase', '_', 3],
    ];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ x: 1 })).toBe(2);
    expect(r.run!({ x: 5 })).toBe(3);
  });

  // A condition of type `boolean | missing` cannot select element by
  // element: its branches are compared.
  test('a condition that can be missing compares the branches', () => {
    const ce = engine();
    ce.declare('c', 'boolean | missing');
    declines(['If', 'c', ['List', 1, 2], 3], ce);
  });
});

// The cases of round 2 of the review of the simple rule (CE-712.1).
describe('The admission checks of round 2 of the review of the simple rule (R3)', () => {
  const declines = (json: MathJsonExpression, ce = engine()): void => {
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  };
  const stored = (
    name: string,
    value: MathJsonExpression
  ): MathJsonExpression => [
    'Declare',
    name,
    ['Dictionary', ['KeyValuePair', "'value'", value]],
  ];
  const writer: MathJsonExpression = [
    'Function',
    ['Block', ['Assign', 'p', 5], ['Greater', 'u', 1]],
    'u',
  ];

  // The value of the `Declare` is in the dictionary of its attributes: the
  // `Return` inside its `Loop` is found. With L = [1, 2] the interpreter
  // gives 5.
  test('a Return inside a Loop of a declared function declines', () => {
    const fn: MathJsonExpression = [
      'Function',
      [
        'Block',
        [
          'Loop',
          ['If', ['Greater', 'i', 1], ['Return', 5]],
          ['Element', 'i', 'L'],
        ],
        100,
      ],
      'p',
    ];
    const r = compile(engine().box(['Block', stored('f', fn), ['f', 1]]));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  // The callback calls `g`, which writes `p`: the interpreter gives 0 (the
  // filter is not used), the compiled code gave 5.
  test('a callback that calls a stored function that writes an outer name declines', () => {
    declines([
      'Block',
      ['Assign', 'p', 0],
      stored('g', writer),
      ['Filter', 'L', ['Function', ['g', 'u'], 'u']],
      'p',
    ]);
  });

  // The inner literal is returned to the `Filter`: the interpreter gives 0,
  // the compiled code gave 5.
  test('a literal returned by a curried literal is a callback', () => {
    declines([
      'Block',
      ['Assign', 'p', 0],
      ['Filter', 'L', ['Apply', ['Function', writer, 'y'], 0]],
      'p',
    ]);
    declines([
      'Block',
      ['Assign', 'p', 0],
      stored('g', ['Function', writer, 'y']),
      ['Filter', 'L', ['g', 0]],
      'p',
    ]);
  });

  // A stored literal behind an `If`, passed by name: the interpreter gives
  // 0 at x = 1, the compiled code gave 5.
  test('a writer stored behind an If and passed by name declines', () => {
    declines([
      'Block',
      ['Assign', 'p', 0],
      stored('g', [
        'If',
        ['Greater', 'x', 0],
        writer,
        ['Function', ['Greater', 'u', 1], 'u'],
      ]),
      ['Filter', 'L', 'g'],
      'p',
    ]);
  });

  // The nested `Match` reads `t`, the list local of the case body: the
  // interpreter gives [2, 3] at x = 1, the compiled code gave "1,21".
  test('a nested Match whose cases have different shapes declines', () => {
    declines([
      'Add',
      [
        'Match',
        'x',
        [
          'MatchCase',
          1,
          [
            'Block',
            ['Assign', 't', ['List', 1, 2]],
            ['Match', 'x', ['MatchCase', 1, 't'], ['MatchCase', '_', 3]],
          ],
        ],
        ['MatchCase', '_', 0],
      ],
      1,
    ]);
  });
});

// The cases of round 3 of the review of the simple rule (CE-712.1).
describe('The admission checks of round 3 of the review of the simple rule (R3)', () => {
  // The nested `Match` reads the capture `a` of the outer case: its
  // canonical form is made in the scope that binds `a` (the body of the
  // case closure), so the admission check does not declare `a` in the
  // engine. The capture has the type `unknown`, so the nested cases are not
  // compared (a branch of unknown type is not).
  test('a nested Match in a case with captures is read where the captures are bound', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'Add',
      [
        'Match',
        'x',
        [
          'MatchCase',
          '_a',
          [
            'Match',
            'x',
            ['MatchCase', 1, ['List', 'a', 'a']],
            ['MatchCase', '_', 'a'],
          ],
        ],
      ],
      1,
    ];
    expect(ce.lookupDefinition('a')).toBeUndefined();
    compile(ce.box(json));
    expect(ce.lookupDefinition('a')).toBeUndefined();
  });

  // A caller override of `Which` receives every operand: the operand after
  // a clause whose condition is `True` is not dropped, so the input `M`,
  // which has no type, is refused.
  test('an operand of an overridden Which is not dropped', () => {
    const r = compile(engine().box(['Which', 'True', 0, 'True', 'M']), {
      functions: { Which: 'myWhich' },
    });
    expect(r.success).toBe(false);
    expect(r.unsupported).toContain('M');
  });

  // A `compile` handler of the definition of `Which` receives every operand
  // too: this one emits the last operand, so the code reads `M`, which has
  // no type, and `M` is refused.
  test('an operand of a Which with a compile handler is not dropped', () => {
    const ce = engine();
    const def = ce.lookupDefinition('Which');
    if (def && 'operator' in def)
      (def.operator as any).compile = (
        args: ReadonlyArray<unknown>,
        c: (expr: unknown) => string
      ) => `(${c(args[args.length - 1])})`;
    const r = compile(ce.box(['Which', 'True', 0, 'True', 'M']));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toContain('M');
  });

  // A handler that returns no code lets the stock lowering compile the
  // `Which`, which reads only `0`. The admission does not call the handler,
  // so it keeps every operand: `M`, which has no type, is refused. This is
  // a decline, not a wrong value.
  test('an operand of a Which with a compile handler that returns no code is checked', () => {
    const ce = engine();
    const def = ce.lookupDefinition('Which');
    let calls = 0;
    if (def && 'operator' in def)
      (def.operator as any).compile = () => {
        calls += 1;
        return undefined;
      };
    const json: MathJsonExpression = ['Which', 'True', 0, 'True', 'M'];
    const r = compile(ce.box(json));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toContain('M');
    expect(calls).toBeGreaterThan(0);
    // With an input that has a type, the stock lowering compiles it.
    const typed = compile(ce.box(['Which', 'True', 0, 'True', 'x']), {
      fallback: false,
    });
    expect(typed.success).toBe(true);
    expect(typed.run!({ x: 3 })).toBe(0);
  });
});

// The cases of the review of the simple decline (CE-712.1).
describe('The admission checks of the review of the simple decline (R3)', () => {
  const declines = (
    json: MathJsonExpression,
    options: Record<string, unknown> = {},
    ce = engine()
  ): { error?: string; unsupported?: string[] } => {
    const r = compile(ce.box(json), options as never);
    expect(r.success).toBe(false);
    return { error: r.error, unsupported: r.unsupported };
  };

  // A destructured index is an index: an applied literal that writes `k`
  // declines.
  test('a function literal that assigns a destructured loop index declines', () => {
    const ce = engine();
    ce.declare('pairs', 'list<tuple<real, real>>');
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'n', 0],
      [
        'Loop',
        [
          'Block',
          ['Apply', ['Function', ['Assign', 'k', 5], 'u'], 0],
          ['Assign', 'n', ['Add', 'n', 1]],
        ],
        ['Element', ['Tuple', 'k', 'j'], 'pairs'],
      ],
      'n',
    ];
    expect(declines(json, {}, ce).error).toMatch(
      /assigns the index of an enclosing/
    );
  });

  // A caller override given as a string receives every operand.
  test('an operand of an If overridden by a string is not dropped', () => {
    expect(
      declines(['If', 'True', 0, 'M'], { functions: { If: 'myIf' } })
        .unsupported
    ).toContain('M');
  });

  // An `If` with no else branch is compiled as a `Which`.
  test('an operand of an If with no else and a Which override is not dropped', () => {
    expect(
      declines(['Add', 1, ['If', 'False', 'M']], {
        functions: { Which: 'myWhich' },
      }).unsupported
    ).toContain('M');
  });

  // Each function owns its local `t`: no function writes an outer name.
  test('two user functions with a local of the same name compile', () => {
    const ce = engine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Block', ['Assign', 't', ['Multiply', 2, 'x']], 't'],
        'x',
      ])
    );
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Block', ['Assign', 't', ['Multiply', 3, 'y']], 't'],
        'y',
      ])
    );
    const r = compile(ce.box(['Add', ['f', 1], ['g', 2]]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(8);
  });

  // The callback owns its local `q`, also in a case of a `Match`. The case
  // body is held raw: the reference analysis reads its canonical form, in
  // which `q` is a local of the callback, so `q` is not an input with no
  // type.
  test('a callback with a local of its own in a Match case compiles', () => {
    const json: MathJsonExpression = [
      'Block',
      [
        'Assign',
        'r',
        [
          'Match',
          'x',
          [
            'MatchCase',
            1,
            [
              'Map',
              [
                'Function',
                ['Block', ['Assign', 'q', ['Multiply', 2, 'v']], 'q'],
                'v',
              ],
              'L',
            ],
          ],
          ['MatchCase', '_', 'L'],
        ],
      ],
      ['At', 'r', 1],
    ];
    const r = compile(engine().box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.freeSymbols).toEqual(['x', 'L']);
    expect(r.run!({ x: 1, L: [1, 2, 3] })).toBe(2);
  });
});
