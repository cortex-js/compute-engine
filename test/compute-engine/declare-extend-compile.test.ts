import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type {
  Expression,
  OperatorCompileHandler,
} from '../../src/compute-engine/global-types';

/**
 * `ce.declare(name, { evaluate, compile }, { extend: true })` — item 2 of
 * issue #527. `compile` is `'inherit'` (the new `evaluate` agrees with every
 * call that the library lowering compiles) or a handler that gets the
 * lowering of the extended definition as `context.inherited` and answers
 * `undefined` to keep the library lowering. A patch that replaces `evaluate`
 * and states no `compile` still declines. A fresh engine is used per test.
 */

type Json = Parameters<ComputeEngine['box']>[0];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('s', 'real');
  ce.declare('a', 'real');
  return ce;
}

/** The library `evaluate` of `name`, read before an extension replaces it. */
function libraryEvaluate(ce: ComputeEngine, name: string) {
  return ce.lookupDefinition(name)!.operator!.evaluate!;
}

/** `Beta` with the value 0 at a pole of the library `Beta`; every other
 * call gets the library value. */
function betaWithPoles(ce: ComputeEngine) {
  const library = libraryEvaluate(ce, 'Beta');
  return (ops: ReadonlyArray<Expression>, options: never) =>
    ops.length === 2 && ops[0].is(0) ? ce.number(0) : library(ops, options);
}

const code = (ce: ComputeEngine, json: Json) => {
  const f = compile(ce.box(json));
  return { success: f.success, code: f.code, hostCalls: f.hostCalls, f };
};

const SAMPLES: [number, number][] = [
  [2, 3],
  [0.5, 1.5],
  [4.25, 0.75],
];

describe('compile: inherit', () => {
  test('Beta with a pole value compiles to the code of the library Beta', () => {
    const reference = code(engine(), ['Beta', 's', 'a']);
    expect(reference.success).toBe(true);

    const ce = engine();
    ce.declare(
      'Beta',
      { evaluate: betaWithPoles(ce), compile: 'inherit' },
      { extend: true }
    );
    const patched = code(ce, ['Beta', 's', 'a']);
    expect(patched.success).toBe(true);
    expect(patched.hostCalls).toBeUndefined();
    expect(patched.code).toBe(reference.code);

    // The interpreter has the pole value; the compiled code agrees at the
    // samples, away from the pole.
    expect(ce.box(['Beta', 0, 1]).evaluate().toString()).toBe('0');
    for (const [s, a] of SAMPLES) {
      const evaluated = ce.box(['Beta', s, a]).N().re;
      expect(patched.f.run!({ s, a })).toBeCloseTo(evaluated, 12);
      expect(patched.f.run!({ s, a })).toBe(reference.f.run!({ s, a }));
    }
  });

  test.each(['glsl', 'interval-js'] as const)(
    'Beta with a pole value compiles on %s as the library Beta does',
    (to) => {
      const lower = (ce: ComputeEngine) =>
        compile(ce.box(['Beta', 's', 'a']), { to });
      const reference = lower(engine());
      const ce = engine();
      ce.declare(
        'Beta',
        { evaluate: betaWithPoles(ce), compile: 'inherit' },
        { extend: true }
      );
      const patched = lower(ce);
      expect(patched.success).toBe(reference.success);
      expect(patched.code).toBe(reference.code);
      expect(patched.hostCalls).toEqual(reference.hostCalls);
    }
  );

  test('a patch that states no compile still declines', () => {
    const ce = engine();
    ce.declare('Beta', { evaluate: betaWithPoles(ce) }, { extend: true });
    const patched = code(ce, ['Beta', 's', 'a']);
    expect(patched.hostCalls).toEqual(['Beta']);
    expect(patched.code).not.toContain('beta');
  });

  test('the other kinds of patch of a definition are kept: a changed flag declines', () => {
    const ce = engine();
    ce.declare(
      'Beta',
      { evaluate: betaWithPoles(ce), compile: 'inherit', broadcastable: false },
      { extend: true }
    );
    expect(code(ce, ['Beta', 's', 'a']).hostCalls).toEqual(['Beta']);
  });

  test('D and the canonical folds still treat the operator as a user definition', () => {
    // Both read the library by name, and would not see the new `evaluate`.
    const without = engine();
    without.declare(
      'Beta',
      { evaluate: betaWithPoles(without) },
      { extend: true }
    );
    const ce = engine();
    ce.declare(
      'Beta',
      { evaluate: betaWithPoles(ce), compile: 'inherit' },
      { extend: true }
    );
    const probes: Json[] = [
      ['D', ['Beta', 's', 2], 's'],
      ['Add', ['Beta', 2, 3], 's'],
    ];
    for (const json of probes)
      expect(ce.box(json).evaluate().toString()).toBe(
        without.box(json).evaluate().toString()
      );
    expect(ce.box(['Beta', 0, 1]).evaluate().toString()).toBe('0');
  });

  test('an operator that extends no library definition has nothing to inherit', () => {
    const ce = engine();
    ce.declare('Foo', { signature: '(real) -> real', evaluate: ([x]) => x });
    ce.declare(
      'Foo',
      { evaluate: ([x]) => x, compile: 'inherit' },
      { extend: true }
    );
    expect(code(ce, ['Foo', 's']).hostCalls).toEqual(['Foo']);
  });

  test('a library operator that has no lowering still declines', () => {
    const reference = code(engine(), ['Prime', 's']);
    const ce = engine();
    ce.declare(
      'Prime',
      { evaluate: libraryEvaluate(ce, 'Prime'), compile: 'inherit' },
      { extend: true }
    );
    const patched = code(ce, ['Prime', 's']);
    expect(patched.success).toBe(reference.success);
    expect(patched.code).toBe(reference.code);
  });
});

describe('compile: a handler', () => {
  /** A patch that changes two-operand `Zeta(s, a)` (to `HurwitzZeta(s, a)`,
   * a stand-in: the two agree only for `a > 0`); `Zeta(s)` keeps its
   * lowering. */
  function zetaPatch(
    ce: ComputeEngine,
    seen: { inherited: unknown[]; asked: number[] } = {
      inherited: [],
      asked: [],
    }
  ) {
    const library = libraryEvaluate(ce, 'Zeta');
    const handler: OperatorCompileHandler = (args, compile, context) => {
      seen.asked.push(args.length);
      seen.inherited.push(context.inherited);
      return args.length === 2
        ? ce.function('HurwitzZeta', [args[0], args[1]])
        : context.inherited?.(args, compile, context);
    };
    return {
      patch: {
        evaluate: (ops: ReadonlyArray<Expression>, options: never) =>
          ops.length === 2
            ? ce.function('HurwitzZeta', [ops[0], ops[1]]).N()
            : library(ops, options),
        compile: handler,
      },
      seen,
    };
  }

  test('Zeta keeps its lowering for one operand and changes it for two', () => {
    const ce = engine();
    const { patch, seen } = zetaPatch(ce);
    const one = code(engine(), ['Zeta', 's']);
    ce.declare('Zeta', patch, { extend: true });

    const patchedOne = code(ce, ['Zeta', 's']);
    expect(patchedOne.hostCalls).toBeUndefined();
    expect(patchedOne.code).toBe(one.code);
    expect(seen.asked).toEqual([1]);
    expect(typeof seen.inherited[0]).toBe('function');

    const patchedTwo = code(ce, ['Zeta', 's', 'a']);
    expect(patchedTwo.hostCalls).toBeUndefined();
    expect(patchedTwo.code).toContain('hurwitzzeta');
    expect(patchedTwo.code).not.toBe(code(engine(), ['Zeta', 's', 'a']).code);

    // evaluate() and the compiled code agree on the same inputs
    for (const [s, a] of [
      [3, 2],
      [2.5, 1.5],
    ]) {
      expect(patchedTwo.f.run!({ s, a })).toBeCloseTo(
        ce.box(['Zeta', s, a]).N().re,
        10
      );
    }
    for (const s of [2, 3.5])
      expect(patchedOne.f.run!({ s })).toBeCloseTo(
        ce.box(['Zeta', s]).N().re,
        12
      );
  });

  test('a handler that throws for a call declines it to the interpreter', () => {
    const ce = engine();
    ce.declare(
      'Zeta',
      {
        evaluate: libraryEvaluate(ce, 'Zeta'),
        compile: (args, compile, context) => {
          if (args.length === 2) throw new Error('not lowered');
          return context.inherited?.(args, compile, context);
        },
      },
      { extend: true }
    );
    expect(code(ce, ['Zeta', 's']).success).toBe(true);
    // The call declines, and the whole expression runs in the interpreter
    const declined = compile(ce.box(['Zeta', 's', 'a']));
    expect(declined.success).toBe(false);
    expect(declined.run!({ s: 3, a: 2 })).toBeCloseTo(0.2020569031595943, 12);
  });

  test('a handler of an operator with nothing to inherit gets no inherited, and undefined declines', () => {
    const ce = engine();
    ce.declare('Foo', { signature: '(real) -> real', evaluate: ([x]) => x });
    const seen: unknown[] = [];
    ce.declare(
      'Foo',
      {
        evaluate: ([x]) => x,
        compile: (_args, _compile, context) => {
          seen.push(context.inherited);
          return undefined;
        },
      },
      { extend: true }
    );
    expect(code(ce, ['Foo', 's']).hostCalls).toEqual(['Foo']);
    expect(seen[0]).toBeUndefined();
  });

  test('the handler of the library definition, when it has one, is inherited', () => {
    const ce = engine();
    const library = ce.lookupDefinition('Beta')!.operator!;
    const mine: OperatorCompileHandler = () => undefined;
    library.compile = mine;
    let inherited: unknown;
    ce.declare(
      'Beta',
      {
        evaluate: betaWithPoles(ce),
        compile: (_a, _c, context) => {
          inherited = context.inherited;
          return undefined;
        },
      },
      { extend: true }
    );
    code(ce, ['Beta', 's', 'a']);
    expect(inherited).toBe(mine);
  });
});

describe('compile: chained extensions', () => {
  test("'inherit' on top of a handler inherits the handler, not the library lowering", () => {
    const ce = engine();
    const asked: number[] = [];
    ce.declare(
      'Zeta',
      {
        evaluate: libraryEvaluate(ce, 'Zeta'),
        compile: (args) => {
          asked.push(args.length);
          return args.length === 2
            ? ce.function('HurwitzZeta', [args[0], args[1]])
            : undefined;
        },
      },
      { extend: true }
    );
    ce.declare(
      'Zeta',
      { evaluate: libraryEvaluate(ce, 'Zeta'), compile: 'inherit' },
      { extend: true }
    );
    const two = code(ce, ['Zeta', 's', 'a']);
    expect(two.code).toContain('hurwitzzeta');
    expect(asked).toEqual([2]);
    expect(code(ce, ['Zeta', 's']).hostCalls).toBeUndefined();
  });

  test('a handler on top of a handler gets the earlier handler as inherited', () => {
    const ce = engine();
    ce.declare(
      'Zeta',
      {
        evaluate: libraryEvaluate(ce, 'Zeta'),
        compile: (args) =>
          args.length === 2
            ? ce.function('HurwitzZeta', [args[0], args[1]])
            : undefined,
      },
      { extend: true }
    );
    const answers: unknown[] = [];
    ce.declare(
      'Zeta',
      {
        evaluate: libraryEvaluate(ce, 'Zeta'),
        compile: (args, compile, context) => {
          const r = context.inherited!(args, compile, context);
          answers.push(r?.toString());
          return r;
        },
      },
      { extend: true }
    );
    expect(code(ce, ['Zeta', 's', 'a']).code).toContain('hurwitzzeta');
    expect(answers).toEqual(['HurwitzZeta(s, a)']);
  });

  test('a later extension that replaces evaluate and states no compile declines again', () => {
    const ce = engine();
    ce.declare(
      'Beta',
      { evaluate: betaWithPoles(ce), compile: 'inherit' },
      { extend: true }
    );
    expect(code(ce, ['Beta', 's', 'a']).hostCalls).toBeUndefined();
    ce.declare('Beta', { evaluate: betaWithPoles(ce) }, { extend: true });
    expect(code(ce, ['Beta', 's', 'a']).hostCalls).toEqual(['Beta']);
  });
});

describe('compile: the field is validated', () => {
  test.each([
    ['a string other than inherit', 'library'],
    ['a number', 42],
    ['an object', { inherit: true, maxOperands: 1 }],
    ['null', null],
  ])('%s throws at declare time', (_name, value) => {
    const ce = engine();
    const before = ce.lookupDefinition('Beta')!.operator;
    expect(() =>
      ce.declare('Beta', { compile: value as never }, { extend: true })
    ).toThrow(
      /Cannot extend "Beta": `compile` must be 'inherit' or a function/
    );
    expect(ce.lookupDefinition('Beta')!.operator).toBe(before);
  });
});

describe('an extension of an extension', () => {
  test('a new evaluate with no compile drops the compile handler of the earlier extension', () => {
    const ce = engine();
    const library = libraryEvaluate(ce, 'Zeta');
    ce.declare(
      'Zeta',
      {
        evaluate: library,
        compile: (args, compile, context) =>
          args.length === 2
            ? ce.function('HurwitzZeta', [args[0], args[1]])
            : context.inherited?.(args, compile, context),
      },
      { extend: true }
    );
    expect(code(ce, ['Zeta', 's', 'a']).code).toContain('hurwitzzeta');
    ce.declare(
      'Zeta',
      { evaluate: (ops, options) => library(ops, options) },
      { extend: true }
    );
    const two = code(ce, ['Zeta', 's', 'a']);
    expect(two.code).not.toContain('hurwitzzeta');
    expect(two.hostCalls).toEqual(['Zeta']);
  });

  test('a patch that keeps evaluate and compile keeps the inherited lowering', () => {
    const ce = engine();
    ce.declare(
      'Zeta',
      {
        evaluate: libraryEvaluate(ce, 'Zeta'),
        compile: (args, compile, context) =>
          args.length === 2
            ? ce.function('HurwitzZeta', [args[0], args[1]])
            : context.inherited?.(args, compile, context),
      },
      { extend: true }
    );
    const one = code(ce, ['Zeta', 's']).code;
    ce.declare('Zeta', { description: 'Zeta' }, { extend: true });
    const after = code(ce, ['Zeta', 's']);
    expect(after.hostCalls).toBeUndefined();
    expect(after.code).toBe(one);
    expect(code(ce, ['Zeta', 's', 'a']).code).toContain('hurwitzzeta');
  });
});
