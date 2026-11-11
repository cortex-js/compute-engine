import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import {
  lowerStructuredProgram,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import {
  JAVASCRIPT_POLICY,
  verifyJavaScriptProgram,
} from '../../src/compute-engine/compilation/javascript-structured-policy';
import { verifyProgram } from '../../src/compute-engine/compilation/structured-verify';
import { analyzeExecution } from '../../src/compute-engine/compilation/structured-execution';
import { reachesHost } from '../../src/compute-engine/compilation/structured-ir';
import type {
  IRFunction,
  IROperation,
  IRProgram,
  IRValue,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The compile options of the host on the structured route of the JavaScript
// compiler (the `numeric-kernel` profile), slices 3 to 5 of
// docs/plans/2026-11-11-structured-options-and-bindings.md:
//
// - `vars`: a source that reads an entry of the vars object (`_.z`,
//   `_["k"]`) is the read of an input under another name; another source
//   that is one operand (`next()`) is a read of the host at each occurrence.
// - `functions` and the record form of `operators`: a call of a function of
//   the host (the operation `host` of the representation).
// - `imports`, `preamble`: the assembly of the existing route; `broadcast`:
//   no batch body, the values of `broadcast: false`.
//
// For each program the profile gives the doubles of the existing compiler
// with `cse: false, constantFold: false`, and the host sees the same calls
// and reads, in the same order.

const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

type Vars = Record<string, unknown>;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('n', 'integer');
  ce.declare('F', 'list<real>');
  ce.declare('i', 'integer');
  ce.declare('g', '(real) -> real');
  ce.declare('h', '(real, real) -> integer');
  ce.declare('b', '(real) -> boolean');
  return ce;
}

/** The calls and reads of the host, in order. */
let log: string[] = [];
const host = globalThis as unknown as Record<string, unknown>;
host.__optNext = () => {
  log.push('next');
  return 0.25 + log.length;
};
host.__optCount = () => {
  log.push('count');
  return log.length;
};
host.__optG = (t: number) => {
  log.push(`G(${t})`);
  return 2 * t + 1;
};
host.__optH = (a: number, c: number) => {
  log.push(`H(${a},${c})`);
  return Math.floor(a + c);
};

const VARS: Vars = { x: 0.5, y: -1.25, n: 3, i: 1, F: [1, 2.5, -4] };

/** The value of `result` at `vars`, or the message of the error that it
 *  throws, with the calls and reads of the host. */
function run(
  result: CompilationResult<'javascript'>,
  vars: Vars
): { value: unknown; log: string[] } {
  log = [];
  let value: unknown;
  try {
    value = result.run!(vars as never);
  } catch (e) {
    value = `throws ${(e as Error).message}`;
  }
  return { value, log };
}

/** Compile `json` on both routes with `options`, and check that the profile
 *  compiles, gives the values (`Object.is`) and the calls of the host of the
 *  existing compiler at each set of `inputs`. Returns the result of the
 *  profile. */
function same(
  json: MathJsonExpression,
  options: Record<string, unknown>,
  inputs: readonly Vars[] = [VARS],
  ce = engine()
): CompilationResult<'javascript'> {
  const expr = ce.expr(json);
  const existing = compile(expr, { ...EXISTING, ...options } as never);
  const profiled = compile(expr, { ...PROFILE, ...options } as never);
  expect(profiled.success).toBe(true);
  for (const vars of inputs) {
    const a = run(existing, vars);
    const b = run(profiled, vars);
    expect(b.log).toEqual(a.log);
    if (!Object.is(a.value, b.value)) expect(b.value).toEqual(a.value);
  }
  return profiled;
}

/** The message of the decline of `json` with `options` on the profile. */
function declined(
  json: MathJsonExpression,
  options: Record<string, unknown>,
  ce = engine()
): string {
  const expr = ce.expr(json);
  const result = canCompile(expr, { ...PROFILE, ...options } as never);
  expect(result.ok).toBe(false);
  try {
    compile(expr, { ...PROFILE, ...options } as never);
  } catch (e) {
    const diagnostic = (e as { diagnostic?: { code: string } }).diagnostic;
    expect(diagnostic?.code).toBe('outside-profile');
    return (e as Error).message;
  }
  throw new Error('the profile compiled the program');
}

describe('vars: the read of an input under another name', () => {
  test('_.z for u: the source, no entry of the vars object recorded', () => {
    const refs = new Set<string>();
    const result = same(
      ['Add', 'x', 'u'],
      { vars: { u: '_.z' }, varsObjectRefs: refs },
      [{ x: 0.5, z: 7 }]
    );
    expect(result.code).toBe('_.z + _.x');
    expect(refs).toEqual(new Set(['x']));
    expect([result.pure, result.shippable]).toEqual([true, true]);
    // `u` has no declared type: it took the default kind.
    expect(result.defaultedSymbols).toEqual(['u']);
  });

  test('the spelling of the name itself is a read of the vars object, with its entry check', () => {
    const ce = engine();
    ce.declare('ud', 'real');
    const refs = new Set<string>();
    const options = { vars: { ud: '_.ud' }, varsObjectRefs: refs };
    const result = same(['Add', 'x', 'ud'], options, [{ x: 1, ud: 2 }], ce);
    expect(refs).toEqual(new Set(['x', 'ud']));
    // The entry check of a real input refuses a complex value on both
    // routes.
    const existing = compile(ce.expr(['Add', 'x', 'ud']), {
      ...EXISTING,
      ...options,
    } as never);
    const value = { x: 1, ud: { re: 1, im: 1 } };
    expect(run(result, value).value).toEqual(run(existing, value).value);
    expect(String(run(result, value).value)).toMatch(/^throws/);
  });

  test('_["k"], the form of the series walk, is written as it is', () => {
    const ce = engine();
    const json: MathJsonExpression = ['Divide', 1, ['Add', ['Power', 'k', 3], 'k', 1]];
    const result = same(json, { vars: { k: '_["k"]' } }, [{ k: 4 }, { k: 1000 }], ce);
    expect(result.code).toContain('_["k"]');
    expect(result.run!({ k: 4 } as never)).toBe(
      ce.expr(json).subs({ k: 4 }).N().re
    );
  });

  test('a declared value is hidden: the name is an input of its declared type', () => {
    const ce = engine();
    ce.declare('a', 'real');
    ce.assign('a', 4);
    same(['Sqrt', 'a'], { vars: { a: '_.a' } }, [{ a: 9 }, { a: -4 }], ce);
  });

  test('a declared integer keeps its kind', () => {
    same(['Floor', ['Add', 'm', 0.5]], { vars: { m: '_.n' } }, [{ n: 3 }]);
    same(['Add', 'n', 1], { vars: { n: '_.other' } }, [{ other: 5 }]);
  });

  test('Power(u, -2) of a mapped name is Math.pow, as on the existing route', () => {
    // `1 / u / u` and `Math.pow(u, -2)` differ in the last place at 0.464...
    const inputs = [{ w: 0.4641588833612779 }, { w: 3 }, { w: -0 }];
    expect(same(['Power', 'u', -2], { vars: { u: '_.w' } }, inputs).code).toBe(
      'Math.pow(_.w, -2)'
    );
    const read = same(['Power', 'u', -2], { vars: { u: '__optNext()' } });
    expect(read.code).toContain('Math.pow(');
    expect(run(read, VARS).log).toEqual(['next']);
  });

  test('a list input under another name', () => {
    same(['At', 'F', 2], { vars: { F: '_.G' } }, [{ G: [1, 2, 3] }]);
  });

  test('a root Block reads the source', () => {
    same(
      ['Block', ['Declare', 'a', 'real', ['Add', 'u', 1]], ['Multiply', 'a', 'u']],
      { vars: { u: '_.w' } },
      [{ w: 3 }]
    );
  });

  test.each<[string, MathJsonExpression, Record<string, unknown>, RegExp]>([
    [
      'a name with a value and no declared type',
      ['Add', 'x', 'q'],
      { vars: { q: '_.q' } },
      /maps q, which holds a value that the compilation does not hide/,
    ],
    [
      'a constant of the library',
      ['Multiply', 'Pi', 'x'],
      { vars: { Pi: '_.p' } },
      /maps Pi, a constant or an operator of the library/,
    ],
    [
      'a name that the body of a root Function reads',
      ['Function', ['Add', 't', 'u'], 't'],
      { vars: { u: '_.u' } },
      /maps u, which the body of the root Function reads/,
    ],
  ])('declined: %s', (_name, json, options, message) => {
    const ce = engine();
    ce.assign('q', 3);
    expect(declined(json, options, ce)).toMatch(message);
  });
});

describe('vars: a read of the host', () => {
  const next = { vars: { u: '__optNext()' } };

  test('each occurrence reads the host once, in the order of the program', () => {
    const result = same(['Add', 'u', 'u', 'x'], next);
    expect(run(result, VARS).log).toEqual(['next', 'next']);
    expect([result.pure, result.shippable]).toEqual([false, false]);
    expect(result.defaultedSymbols).toEqual(['u']);
  });

  test('a symbol object reached twice reads twice', () => {
    const ce = engine();
    ce.declare('u', 'real');
    const u = ce.symbol('u');
    const expr = ce._fn('Add', [u, u, ce.symbol('x')]);
    const existing = compile(expr, { ...EXISTING, ...next } as never);
    const profiled = compile(expr, { ...PROFILE, ...next } as never);
    expect(run(profiled, VARS)).toEqual(run(existing, VARS));
    expect(run(profiled, VARS).log).toEqual(['next', 'next']);
  });

  test.each<[string, MathJsonExpression]>([
    ['a square', ['Power', 'u', 2]],
    ['a cube', ['Power', 'u', 3]],
    ['a product', ['Multiply', 'x', 'u']],
    ['a branch', ['If', ['Less', 'x', 0], 'u', ['Add', 'u', 'u']]],
    ['an And', ['And', ['Less', 'x', 0], ['Less', 'u', 1]]],
    ['a Sum of terms', ['Sum', ['Multiply', 'k', 'u'], ['Limits', 'k', 1, 4]]],
    ['a loop of a Sum', ['Sum', ['Multiply', 'k', 'u'], ['Limits', 'k', 1, 500]]],
    ['a square root', ['Sqrt', 'u']],
    ['a floor of an integer', ['Floor', 'n']],
  ])('%s', (_name, json) => {
    // `u` is declared: the existing compiler refuses a name that a use
    // narrowed to `unknown` (`u < 1`).
    const ce = engine();
    ce.declare('u', 'real');
    same(
      json,
      { vars: { u: '__optNext()', n: '__optCount()' } },
      [VARS, { ...VARS, x: -2 }],
      ce
    );
  });

  test('a source in parentheses is one operand', () => {
    same(['Sin', ['Multiply', 6, 'u']], { vars: { u: '(Math.PI/4)' } });
  });

  test('a read of the host in a root Block', () => {
    same(
      ['Block', ['Declare', 'a', 'real', ['Add', 'u', 1]], ['Multiply', 'a', 'u']],
      next
    );
  });

  test('a read and a draw keep their order', () => {
    const random = Math.random;
    try {
      Math.random = () => {
        log.push('random');
        return 0.375;
      };
      same(['Add', ['Random'], 'u', ['Random']], next);
    } finally {
      Math.random = random;
    }
  });

  test.each<[string, MathJsonExpression, Record<string, unknown>, RegExp]>([
    [
      'a source that is not one operand',
      ['Sin', ['Multiply', 6, 'u']],
      { vars: { u: 'Math.PI/4' } },
      /maps u to the source "Math\.PI\/4", which is not one operand/,
    ],
    [
      'the complex mode',
      ['Add', 'u', 1],
      { vars: { u: '__optNext()' }, mode: 'complex' },
      /admits such a read of the host in the `strict` mode only/,
    ],
    [
      'a boolean name',
      ['If', 'c', 1, 2],
      { vars: { c: '__optNext()' } },
      /maps c, which has the type boolean/,
    ],
  ])('declined: %s', (_name, json, options, message) => {
    const ce = engine();
    ce.declare('c', 'boolean');
    expect(declined(json, options, ce)).toMatch(message);
  });
});

describe('functions: a call of the host', () => {
  test('a name: each call once, in order; not pure, not shippable', () => {
    const result = same(['Add', ['g', 'x'], ['g', 'y']], {
      functions: { g: '__optG' },
    });
    expect(run(result, VARS).log).toEqual(['G(0.5)', 'G(-1.25)']);
    expect([result.pure, result.shippable]).toEqual([false, false]);
  });

  test('a function declared pure: pure, not shippable, and two calls are two calls', () => {
    const result = same(['Add', ['g', 'x'], ['g', 'x']], {
      functions: { g: { source: '__optG', pure: true } },
    });
    expect(run(result, VARS).log).toEqual(['G(0.5)', 'G(0.5)']);
    expect([result.pure, result.shippable]).toEqual([true, false]);
  });

  test('a node object reached twice is called twice', () => {
    const ce = engine();
    const call = ce.function('g', [ce.symbol('x')]);
    const expr = ce._fn('Add', [call, call]);
    for (const pure of [false, true]) {
      const options = { functions: { g: { source: '__optG', pure } } };
      const existing = compile(expr, { ...EXISTING, ...options } as never);
      const profiled = compile(expr, { ...PROFILE, ...options } as never);
      expect(run(profiled, VARS)).toEqual(run(existing, VARS));
      expect(run(profiled, VARS).log).toEqual(['G(0.5)', 'G(0.5)']);
    }
  });

  test('a call that changes the vars object: no value is reused across it', () => {
    // `__optSet` sets `x` of the vars object to 9. `Sqrt(x)` is one node
    // object, reached before and after the call: the existing compiler
    // evaluates each occurrence, `__optH(2, 5, 3)`.
    const ce = engine();
    ce.declare('k3', '(real, real, real) -> real');
    let current: Vars = {};
    host.__optSet = (t: number) => {
      log.push(`set(${t})`);
      current.x = 9;
      return t + 1;
    };
    host.__optH3 = (a: number, b: number, c: number) => a * 100 + b * 10 + c;
    const x = ce.symbol('x');
    const sqrt = ce.function('Sqrt', [x]);
    const g = ce.function('g', [x]);
    const options = { functions: { g: '__optSet', k3: '__optH3' } };
    for (const expr of [
      ce._fn('k3', [sqrt, g, sqrt]),
      ce._fn('Add', [sqrt, g, sqrt]),
      ce._fn('Add', [x, g, x]),
      ce._fn('If', [ce._fn('Less', [g, x]), x, ce.symbol('y')]),
    ]) {
      const existing = compile(expr, { ...EXISTING, ...options } as never);
      const profiled = compile(expr, { ...PROFILE, ...options } as never);
      current = { ...VARS, x: 4 };
      const a = run(existing, current);
      current = { ...VARS, x: 4 };
      const b = run(profiled, current);
      expect(b).toEqual(a);
    }
    current = { ...VARS, x: 4 };
    expect(
      run(compile(ce._fn('k3', [sqrt, g, sqrt]), { ...PROFILE, ...options } as never), current)
        .value
    ).toBe(253);
  });

  test('a call that is not pure in a complex value, and a read of an input, decline', () => {
    // The existing emitter evaluates the complex operand `g(1)·Arcosh(x)`
    // first, and reads `_.x` for the real operand after `g` changed it.
    expect(
      declined(['Add', 'x', ['Multiply', ['g', 1], ['Arcosh', 'x']]], {
        functions: { g: '__optSet' },
      })
    ).toMatch(/draws more than once, and a draw is in a complex value/);
  });

  test('a callee source that is not a reference declines', () => {
    expect(
      declined(['g', 'x'], { functions: { g: '_.getTransform()' } })
    ).toMatch(/is not a name, a dotted path of names or a function expression/);
    // A name, a dotted path and a pure function expression are admitted.
    same(['g', 'x'], { functions: { g: 'Math.cbrt' } });
    same(['g', 'x'], { functions: { g: '((t)=>t*t+1)' } });
  });

  test.each<[string, Record<string, unknown>]>([
    ['a vars source with a line terminator', { vars: { u: '\n__optNext()' } }],
    ['a vars source with a comment', { vars: { u: '_.w // the width' } }],
    ['a functions source with a comment', { functions: { g: '/* f */ __optG' } }],
  ])('declined: %s', (_name, options) => {
    const json: MathJsonExpression =
      'functions' in options ? ['Add', ['g', 'x'], 1] : ['Add', 'u', 'x'];
    expect(declined(json, options)).toMatch(
      /to a source with a (line terminator|comment)/
    );
  });

  test('an If statement whose branch calls the host is kept, also for a pure function', () => {
    // The existing compiler evaluates `t = g(x)` in the branch although `t`
    // is not read: the call is counted, and a throw of the host surfaces.
    const json: MathJsonExpression = [
      'Block',
      ['Declare', 't', "'real'", 0],
      ['If', ['Less', 'x', 1], ['Assign', 't', ['g', 'x']]],
      'x',
    ];
    for (const pure of [false, true]) {
      const options = { functions: { g: { source: '__optG', pure } } };
      const result = same(json, options, [VARS, { ...VARS, x: 2 }]);
      expect(run(result, VARS).log).toEqual(['G(0.5)']);
    }
    host.__optThrow = () => {
      throw new Error('host error');
    };
    const throwing = { functions: { g: { source: '__optThrow', pure: true } } };
    expect(String(run(same(json, throwing), VARS).value)).toMatch(
      /^throws host error/
    );
  });

  test('a Sum: every term calls a function that is not pure; a pure one declines', () => {
    // The existing emitter skips the terms after a NaN sum only when they
    // have no effect: a call declared pure is skipped there.
    const json: MathJsonExpression = [
      'Sum',
      ['Multiply', ['g', 'x'], 'k'],
      ['Limits', 'k', 1, 4],
    ];
    const result = same(json, { functions: { g: '__optG' } }, [
      VARS,
      { ...VARS, x: NaN },
    ]);
    expect(run(result, { ...VARS, x: NaN }).log).toHaveLength(4);
    expect(
      declined(json, { functions: { g: { source: '__optG', pure: true } } })
    ).toMatch(/Sum calls a function of the host that the options declare pure/);
  });

  test.each<[string, MathJsonExpression]>([
    ['an integer result', ['Add', ['h', 'x', 'y'], 'x']],
    ['nested calls', ['g', ['g', 'x']]],
    ['a branch', ['If', ['Less', 'x', 0], ['g', 'x'], ['g', 'y']]],
    ['a Which', ['Which', ['Less', ['g', 'x'], 0], ['g', 'y'], 'True', 2]],
    ['an And', ['And', ['Less', ['g', 'x'], 0], ['Less', ['g', 'y'], 0]]],
    ['a Sum of terms', ['Sum', ['g', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 3]]],
    ['a loop of a Sum', ['Sum', ['g', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 40]]],
    ['a Max', ['Max', ['g', 'x'], ['g', 'y']]],
    ['a Round', ['Round', ['g', 'x']]],
    ['a Power with a float exponent', ['Power', ['g', 'x'], 1.6]],
    ['an index of At', ['At', 'F', ['Floor', ['g', 'x']]]],
    ['a call with no argument', ['Add', ['p'], 1]],
  ])('%s', (_name, json) => {
    const ce = engine();
    ce.declare('p', '() -> real');
    same(
      json,
      { functions: { g: '__optG', h: '__optH', p: '__optNext' } },
      [VARS, { ...VARS, x: -2, y: 0.75 }],
      ce
    );
  });

  test('a function value: its definition in the preamble', () => {
    const result = same(['Add', ['h', 'x', 'y'], 'x'], {
      functions: { h: (a: number, c: number) => a * c },
    });
    expect(result.preamble).toContain('const h = ');
    const named = same(['Add', ['h', 'x', 'y'], 'x'], {
      functions: {
        h: function hostProduct(a: number, c: number) {
          return a * c;
        },
      },
    });
    expect(named.preamble).toContain('function hostProduct');
  });

  test('a function literal of the engine that the host replaces', () => {
    const ce = engine();
    ce.assign('twice', ce.expr(['Function', ['Multiply', 2, 't'], 't']));
    same(['Add', ['twice', 'x'], 1], { functions: { twice: '__optG' } }, [VARS], ce);
    // A `vars` entry of a user function is a `functions` entry.
    same(['Add', ['twice', 'x'], 1], { vars: { twice: '__optG' } }, [VARS], ce);
  });

  test('a helper whose body calls the host', () => {
    const ce = engine();
    ce.assign(
      'f',
      ce.expr(['Function', ['Add', ['g', 't'], 1], ['Typed', 't', "'real'"]])
    );
    same(['Add', ['f', 'x'], ['f', 'y']], { functions: { g: '__optG' } }, [VARS], ce);
  });

  test('a call and a draw keep their order', () => {
    const random = Math.random;
    try {
      Math.random = () => {
        log.push('random');
        return 0.375;
      };
      same(['Add', ['Random'], ['g', 'x'], ['Random']], {
        functions: { g: '__optG' },
      });
    } finally {
      Math.random = random;
    }
  });

  test.each<[string, MathJsonExpression, Record<string, unknown>, RegExp]>([
    [
      'a library operator',
      ['Add', ['Sin', 'x'], 1],
      { functions: { Sin: 'Math.sin' } },
      /the option `functions` maps Sin, an operator or a constant of the library/,
    ],
    [
      'a head with no signature',
      ['Add', ['sq', 'x'], 1],
      { functions: { sq: '__optG' } },
      /the function sq of the host has the result type unknown/,
    ],
    [
      'a boolean result',
      ['If', ['b', 'x'], 1, 2],
      { functions: { b: '__optG' } },
      /the function b of the host has the result type boolean/,
    ],
    [
      'a source that is not one operand',
      ['Add', ['g', 'x'], 1],
      { functions: { g: 't => t' } },
      /the source "t => t" of the `functions` entry g is not one operand/,
    ],
    [
      'the complex mode',
      ['Add', ['g', 'x'], 1],
      { functions: { g: '__optG' }, mode: 'complex' },
      /is in the profile in the `strict` mode only/,
    ],
  ])('declined: %s', (_name, json, options, message) => {
    expect(declined(json, options)).toMatch(message);
  });
});

describe('operators: a call of the host', () => {
  test('an operator that is a name is a call', () => {
    const result = same(['Add', ['h', 'x', 'y'], 1], {
      operators: { h: ['__optH', 20] },
    });
    expect(run(result, VARS).log).toEqual(['H(0.5,-1.25)']);
    expect([result.pure, result.shippable]).toEqual([false, false]);
  });

  test.each<[string, MathJsonExpression, Record<string, unknown>, RegExp]>([
    [
      'an infix operator',
      ['Add', ['h', 'x', 'y'], 1],
      { operators: { h: ['+', 11] } },
      /the `operators` entry of h is the infix operator "\+"/,
    ],
    [
      'a library operator',
      ['Add', 'x', 'y'],
      { operators: { Add: ['add', 11] } },
      /the option `operators` maps Add, an operator or a constant of the library/,
    ],
    [
      'the function form',
      ['Add', ['h', 'x', 'y'], 1],
      { operators: (op: string) => (op === 'h' ? ['__optH', 20] : undefined) },
      /the function form of the option `operators` is not in the profile/,
    ],
    [
      'a root symbol that an entry maps',
      'h',
      { operators: { h: ['__optH', 20] } },
      /the root is the symbol h, which an `operators` entry maps/,
    ],
  ])('declined: %s', (_name, json, options, message) => {
    expect(declined(json, options)).toMatch(message);
  });
});

describe('imports and preamble: the assembly of the existing route', () => {
  const FIELDS = [
    'code',
    'preamble',
    'preambleOnce',
    'preamblePerCall',
    'callCode',
    'calling',
    'runtimeVersion',
    'entryPlan',
  ] as const;

  test.each<[string, Record<string, unknown>]>([
    ['preamble', { preamble: 'const K = 2;' }],
    ['imports', { imports: [function hostHelper() { return 1; }] }],
    [
      'both, read by a function of the host',
      {
        preamble: 'const K = 2;',
        imports: [function hostScale(t: number) { return 3 * t; }],
        functions: { g: 'hostScale' },
      },
    ],
  ])('%s: the same stored code and run()', (_name, options) => {
    const ce = engine();
    const json: MathJsonExpression =
      'functions' in options ? ['Add', ['g', 'x'], 'y'] : ['Add', 'x', 'y'];
    const expr = ce.expr(json);
    const existing = compile(expr, { ...EXISTING, ...options } as never);
    const profiled = compile(expr, { ...PROFILE, ...options } as never);
    if (!('functions' in options))
      for (const field of FIELDS)
        expect([field, profiled[field]]).toEqual([field, existing[field]]);
    else expect(profiled.preamble).toBe(existing.preamble);
    expect(run(profiled, VARS)).toEqual(run(existing, VARS));
    // A preamble names identifiers of the host.
    expect(profiled.shippable).toBe(existing.shippable && 'imports' in options);
  });

  test('a preamble runs on each call: the result is not pure; an import is', () => {
    const expr = engine().expr(['Add', 'x', 1]);
    host.__optRuns = 0;
    const counted = compile(expr, {
      ...PROFILE,
      preamble: 'globalThis.__optRuns++;',
    } as never);
    run(counted, VARS);
    run(counted, VARS);
    expect(host.__optRuns).toBe(2);
    expect([counted.pure, counted.shippable]).toEqual([false, false]);
    const blank = compile(expr, { ...PROFILE, preamble: '  ' } as never);
    expect(blank.pure).toBe(true);
    const imported = compile(expr, {
      ...PROFILE,
      imports: [function hostHelper() { return 1; }],
    } as never);
    expect([imported.pure, imported.shippable]).toEqual([true, true]);
  });

  test('an import that is not a function throws as on the existing route', () => {
    const expr = engine().expr(['Add', 'x', 'y']);
    const options = { imports: ['helper'] };
    expect(() => compile(expr, { ...EXISTING, ...options } as never)).toThrow(
      'Unsupported import `helper`'
    );
    expect(() => compile(expr, { ...PROFILE, ...options } as never)).toThrow(
      'Unsupported import `helper`'
    );
  });
});

describe('broadcast: no batch body, the values of broadcast: false', () => {
  test('a scalar program: the same result as without the option', () => {
    const expr = engine().expr(['Add', ['Sin', 'x'], 'y']);
    const on = compile(expr, { ...PROFILE, broadcast: true });
    const off = compile(expr, { ...PROFILE });
    expect(on.batch).toBeUndefined();
    expect(on.code).toBe(off.code);
    const inputs = { x: new Float64Array([0, 1, 2]), y: new Float64Array([1, 2, 3]) };
    expect(Array.from(on.broadcast!(inputs as never))).toEqual(
      Array.from(off.broadcast!(inputs as never))
    );
  });

  test('a list input: the values of the batch body of the existing compiler', () => {
    const expr = engine().expr(['Add', 'x', ['At', 'F', ['Add', 'i', 1]]]);
    const existing = compile(expr, { ...EXISTING, broadcast: true });
    const profiled = compile(expr, { ...PROFILE, broadcast: true });
    expect(existing.batch).toBeDefined();
    expect(profiled.batch).toBeUndefined();
    const F = [1, 2.5, -4, 8];
    const inputs = {
      x: new Float64Array([0.5, 1, -2, 3, 4, 5, 6]),
      i: new Float64Array([-6, -1, 0, 1, 2, 3, 4]),
      F,
    };
    const a = Array.from(existing.broadcast!(inputs as never, { shared: ['F'] }));
    const b = Array.from(profiled.broadcast!(inputs as never, { shared: ['F'] }));
    expect(b).toEqual(a);
  });
});

describe('the representation: the operation host', () => {
  /** The verified program of `json` with `options` on the structured route. */
  function program(json: MathJsonExpression, options: Record<string, unknown>) {
    const ce = engine();
    const target = new ScalarFragmentJavaScriptTarget('structured');
    const preparation = target.prepareStructured(ce.expr(json), {
      cse: false,
      constantFold: false,
      ...options,
    } as never);
    const lowered = lowerStructuredProgram(preparation);
    verifyJavaScriptProgram(lowered, preparedNodesOf(preparation));
    return { program: lowered, nodes: preparedNodesOf(preparation) };
  }

  /** `p` with the first host operation of its root replaced by `change`. */
  function withHost(p: IRProgram, change: (op: IROperation) => IROperation): IRProgram {
    const operations = p.root.operations.map((op) =>
      op.kind === 'host' ? change(op) : op
    );
    return { ...p, root: { ...p.root, operations } };
  }

  test('reachesHost() with a call cycle: the answer of each function is that of the cycle', () => {
    // A.body = [call B, host], B.body = [call A]: the answer for A reads B
    // while A is in progress; B must not keep the `false` of that read.
    const owner = {};
    let id = 0;
    const value = (): IRValue => ({
      owner,
      revision: 0,
      id: id++,
      type: 'real',
      representation: 'number',
    });
    const origin = engine().expr('x');
    const fns: IRFunction[] = [];
    const call = (index: number): IROperation =>
      ({
        kind: 'call',
        function: index,
        result: value(),
        operands: [],
        effect: 'unknown',
        origin,
      }) as IROperation;
    const hostOp = {
      kind: 'host',
      host: 0,
      result: value(),
      operands: [],
      effect: 'unknown',
      origin,
    } as IROperation;
    const fn = (operations: IROperation[]): IRFunction => ({
      name: `f${fns.length}`,
      parameters: [],
      result: { type: 'real', representation: 'number' },
      body: { operations, effect: 'unknown' },
      origin,
    });
    fns.push(fn([call(1), hostOp]));
    fns.push(fn([call(0)]));
    expect(reachesHost(call(0), fns)).toBe(true);
    expect(reachesHost(call(1), fns)).toBe(true);
    // The same cycle with no host operation answers false for both.
    const other: IRFunction[] = [];
    other.push({ ...fn([call(1)]), name: 'g0' });
    other.push({ ...fn([call(0)]), name: 'g1' });
    expect(reachesHost(call(0), other)).toBe(false);
    expect(reachesHost(call(1), other)).toBe(false);
  });

  test('a read and a call: the bindings of the program', () => {
    const { program: p } = program(['Add', ['g', 'x'], 'u'], {
      functions: { g: { source: '__optG', pure: true } },
      vars: { u: '__optNext()' },
    });
    expect([...p.hosts!].sort((a, c) => a.name.localeCompare(c.name))).toEqual([
      { name: 'g', form: 'call', result: 'real', pure: true },
      { name: 'u', form: 'read', result: 'real', pure: false },
    ]);
    const hosts = p.root.operations.filter((op) => op.kind === 'host');
    expect(
      hosts.map((op) => [op.operands.length, op.effect]).sort()
    ).toEqual([
      [0, 'unknown'],
      [1, 'pure'],
    ]);
    // `u` is not an input.
    expect(p.inputs.map((input) => input.name)).toEqual(['x']);
  });

  test('the verifier refuses a host operation that does not match its binding', () => {
    const { program: p, nodes } = program(['Add', ['g', 'x'], 1], {
      functions: { g: '__optG' },
    });
    const check = (q: IRProgram) => () => verifyJavaScriptProgram(q, nodes);
    expect(check(withHost(p, (op) => ({ ...op, effect: 'pure' }) as IROperation))).toThrow(
      /a host operation of g has the effect pure, not unknown/
    );
    expect(check(withHost(p, (op) => ({ ...op, host: 3 }) as IROperation))).toThrow(
      /a host operation of the binding 3, which does not exist/
    );
    expect(check({ ...p, hosts: [{ ...p.hosts![0], result: 'integer' }] })).toThrow(
      /a host operation of g has a result of the type real, and its binding the type integer/
    );
    expect(check({ ...p, hosts: [{ ...p.hosts![0], form: 'read' }] })).toThrow(
      /the operation host has 1 operands, not 0/
    );
    expect(
      check(withHost(p, (op) => ({ ...op, touches: ['console'] }) as IROperation))
    ).toThrow(/of unknown effect names the states console/);
    // A policy with no host operation refuses it.
    const { host: _host, ...operations } = JAVASCRIPT_POLICY.operations;
    expect(() =>
      verifyProgram(p, nodes, { ...JAVASCRIPT_POLICY, operations })
    ).toThrow(/the target has no host operation/);
  });

  test('the analysis: an unknown call is not pure and not portable; a pure call is pure and not portable', () => {
    const unknown = analyzeExecution(
      program(['Add', ['g', 'x'], 1], { functions: { g: '__optG' } }).program
    );
    expect([unknown.independentCalls.holds, unknown.workerPortable.holds]).toEqual([
      false,
      false,
    ]);
    const pure = analyzeExecution(
      program(['Add', ['g', 'x'], 1], {
        functions: { g: { source: '__optG', pure: true } },
      }).program
    );
    expect([pure.independentCalls.holds, pure.workerPortable.holds]).toEqual([
      true,
      false,
    ]);
    expect(pure.workerPortable.blockers.map((b) => b.reason)).toEqual([
      'a call of a function of the host, which the runtime of a worker does not have',
    ]);
  });
});
