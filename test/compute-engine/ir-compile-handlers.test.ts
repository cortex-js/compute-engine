/**
 * A host's `compile` handler in the profile `ir` (batch G28; README of
 * `src/compute-engine/compilation/ir/`, "Selecting the pipeline"), and an
 * expression result under the existing compilers.
 *
 * A handler defers (`undefined`: the library's lowering), returns an
 * expression (lowered in place of the node; a node it created is lowered
 * with no handler, an operand it received is lowered as usual), or returns
 * text, calls the `compile` callback or throws (a decline). The handlers
 * are attached as Tycho attaches them: by mutating
 * `ce.lookupDefinition(name).operator.compile` on a fresh engine.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type {
  Expression,
  OperatorCompileHandler,
} from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type To = 'javascript' | 'glsl' | 'interval-js';
const TARGETS: To[] = ['javascript', 'glsl', 'interval-js'];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('i', 'real');
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  ce.declare('I', 'list<real^3>');
  return ce;
}

/** Attach `handler` to the definition of `name` in place; the number of
 *  its calls. */
function attach(
  ce: ComputeEngine,
  name: string,
  handler: OperatorCompileHandler
): { calls: number } {
  const def = ce.lookupDefinition(name);
  if (def === undefined || !('operator' in def)) throw new Error(name);
  const count = { calls: 0 };
  def.operator.compile = (args, c, context) => {
    count.calls += 1;
    return handler(args, c, context);
  };
  return count;
}

const ir = (
  ce: ComputeEngine,
  json: Json,
  to: To = 'javascript',
  options: object = {}
) =>
  compile(ce.box(json as never), {
    profile: 'ir',
    fallback: false,
    to,
    ...options,
  } as never);
const existing = (ce: ComputeEngine, json: Json, to: To = 'javascript') =>
  compile(ce.box(json as never), { fallback: false, to } as never);

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (
      (x as { diagnostic?: { message: string } }).diagnostic?.message ??
      (x as Error).message
    );
  }
  return undefined;
}

/** The interpreter's value: NaN for no number, an array for a list. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List')) return e.ops.map(read);
  return NaN;
}
function interpreted(ce: ComputeEngine, json: Json, point: object): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            'List',
            v.map((n: number) => ce.number(n))
          )
        : ce.number(v as number),
    ])
  );
  return ce.withValues(values as never, () =>
    read(
      ce
        .box(json as never)
        .evaluate()
        .N()
    )
  );
}
/** A compiled value: NaN for no number (`null`, `undefined`). */
const plain = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(plain) : typeof v === 'number' ? v : NaN;

function agree(v: unknown, w: unknown): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, k) => agree(v[k], x))
    );
  if (typeof w === 'number' && Number.isNaN(w))
    return typeof v === 'number' && Number.isNaN(v);
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w))
  );
}

/** An interval result contains the number `v` (empty contains NaN). */
function contains(r: unknown, v: number): boolean {
  const x = r as { kind: string; value?: { lo: number; hi: number } };
  if (Number.isNaN(v)) return x.kind === 'empty' || x.kind === 'partial';
  if (typeof r === 'number') return r === v;
  return (
    x.value !== undefined && x.value.lo <= v + 1e-9 && v - 1e-9 <= x.value.hi
  );
}

const L3 = ['List', 10, 20, 30];
const POINTS = [-1, 0, 0.5, 1, 1.5, 2.9, 3, 4];

/** The host's index rewrite (Tycho's handler of `At` on GLSL and the
 *  interval target, also on JavaScript here): `At(L, Max(Floor(i), 0))`,
 *  built with `ce.function`, the operands reused. */
const floorIndex =
  (ce: ComputeEngine, languages?: string[]): OperatorCompileHandler =>
  (args, _compile, context) => {
    if (languages !== undefined && !languages.includes(context.language))
      return undefined;
    if (args.length !== 2) return undefined;
    return ce.function('At', [
      args[0],
      ce.function('Max', [ce.function('Floor', [args[1]]), ce.number(0)]),
    ]);
  };
/** The rewritten form, for the interpreter. */
const floored = (l: Json, i: Json) => ['At', l, ['Max', ['Floor', i], 0]];

describe('IR profile, batch G28: a handler that defers', () => {
  test('the text and the values are those of an engine with no handler', () => {
    // prettier-ignore
    const json = ['Add', ['At', L3, ['Add', 'i', 1]], ['Which', ['Less', 'x', 0], 1, 'True', ['Sin', 'x']]];
    for (const to of TARGETS) {
      const plainEngine = engine();
      const ce = engine();
      const at = attach(ce, 'At', () => undefined);
      const which = attach(ce, 'Which', () => undefined);
      const a = ir(ce, json, to);
      const b = ir(plainEngine, json, to);
      expect(a.success).toBe(true);
      expect(a.code).toBe(b.code);
      expect(at.calls).toBeGreaterThan(0);
      expect(which.calls).toBeGreaterThan(0);
      if (to !== 'glsl')
        for (const i of POINTS)
          expect(a.run!({ i, x: i } as never)).toEqual(
            b.run!({ i, x: i } as never)
          );
    }
  });

  test('a handler that defers on two targets and writes text on JavaScript', () => {
    const json = ['At', L3, 'i'];
    for (const to of TARGETS) {
      const ce = engine();
      attach(ce, 'At', (args, c, { language }) =>
        language === 'javascript' ? `_at(${c(args[1])})` : undefined
      );
      if (to === 'javascript')
        expect(failure(() => ir(ce, json, to))).toMatch(
          /the definition of At has its own lowering/
        );
      else expect(ir(ce, json, to).success).toBe(true);
    }
  });

  test('a definition with compileHelpers whose handler defers needs none', () => {
    const ce = engine();
    const def = ce.lookupDefinition('At') as {
      operator: {
        compile?: OperatorCompileHandler;
        compileHelpers?: object;
      };
    };
    def.operator.compileHelpers = { _h: () => 0 };
    def.operator.compile = () => undefined;
    expect(ir(ce, ['At', L3, 'i']).code).toBe(
      ir(engine(), ['At', L3, 'i']).code
    );
  });
});

describe('IR profile, batch G28: a handler that returns an expression', () => {
  test("the host's index rewrite: the interpreter's values of the rewritten At", () => {
    const ce = engine();
    attach(ce, 'At', floorIndex(ce));
    const r = ir(ce, ['At', L3, 'i']);
    expect(r).toMatchObject({ success: true, profile: 'ir' });
    const base = engine();
    for (const i of POINTS)
      expect(
        agree(
          plain(r.run!({ i } as never)),
          interpreted(base, floored(L3, 'i'), { i })
        )
      ).toBe(true);
    expect(plain(POINTS.map((i) => r.run!({ i } as never)))).toEqual([
      NaN,
      NaN,
      NaN,
      10,
      10,
      20,
      30,
      NaN,
    ]);
  });

  test('the rewrite compiles on GLSL and in the interval mode, which contains the values', () => {
    const ce = engine();
    attach(ce, 'At', floorIndex(ce));
    expect(ir(ce, ['At', L3, 'i'], 'glsl')).toMatchObject({ success: true });
    const box = ir(ce, ['At', L3, 'i'], 'interval-js');
    const f = ir(ce, ['At', L3, 'i']);
    expect(box).toMatchObject({ success: true, profile: 'ir' });
    for (const i of POINTS)
      expect(
        contains(
          box.run!({ i } as never),
          plain(f.run!({ i } as never)) as number
        )
      ).toBe(true);
  });

  test('a handler of Which that returns a rewritten Which', () => {
    const ce = engine();
    const which = attach(ce, 'Which', (args) =>
      ce.function('Which', [
        args[0],
        ce.function('Multiply', [ce.number(2), args[1]]),
        ...args.slice(2),
      ])
    );
    const json = ['Which', ['Less', 'x', 0], 'x', 'True', 5];
    const rewritten = [
      'Which',
      ['Less', 'x', 0],
      ['Multiply', 2, 'x'],
      'True',
      5,
    ];
    const r = ir(ce, json);
    for (const x of [-2, -0.5, 0, 3])
      expect(
        agree(r.run!({ x } as never), interpreted(engine(), rewritten, { x }))
      ).toBe(true);
    expect(which.calls).toBe(1);
  });

  test('an authored At inside an operand of the rewritten At gets the handler too', () => {
    const ce = engine();
    const at = attach(ce, 'At', floorIndex(ce));
    const json = [
      'At',
      ['List', 1, 2, 3],
      ['At', ['List', 1.5, 2.5, 3.5], 'i'],
    ];
    const r = ir(ce, json);
    expect(at.calls).toBe(2);
    expect(r.code!.split('Math.floor').length - 1).toBe(2);
    // prettier-ignore
    const want = floored(['List', 1, 2, 3], floored(['List', 1.5, 2.5, 3.5], 'i'));
    for (const i of POINTS)
      expect(
        agree(plain(r.run!({ i } as never)), interpreted(engine(), want, { i }))
      ).toBe(true);
  });

  test('a result of another operator', () => {
    const ce = engine();
    attach(ce, 'At', (args) => ce.function('Sin', [args[1]]));
    const r = ir(ce, ['Add', ['At', L3, 'i'], 1]);
    expect(r.run!({ i: 0.5 } as never)).toBeCloseTo(Math.sin(0.5) + 1, 12);
  });

  test('a handler that builds its operator below the root: ListFrom(Map(...)) of a list index', () => {
    // The host's form for a list index: the At it builds is a created node,
    // which no handler sees, so the walk ends with one call.
    const handler = (ce: ComputeEngine): OperatorCompileHandler => {
      return (args) => {
        if (!args[1].type.matches('list')) return undefined;
        const j = ce.symbol('j');
        return ce.function('ListFrom', [
          ce.function('Map', [
            ce.function('Function', [
              ce.function('At', [
                args[0],
                ce.function('Max', [ce.function('Floor', [j]), ce.number(0)]),
              ]),
              j,
            ]),
            args[1],
          ]),
        ]);
      };
    };
    const ce = engine();
    const at = attach(ce, 'At', handler(ce));
    const r = ir(ce, ['At', L3, 'I']);
    expect(at.calls).toBe(1);
    expect(plain(r.run!({ I: [0.5, 1.5, 2.9] } as never))).toEqual([
      NaN,
      10,
      20,
    ]);
    const g = engine();
    const atGlsl = attach(g, 'At', handler(g));
    expect(ir(g, ['At', L3, 'I'], 'glsl')).toMatchObject({ success: true });
    expect(atGlsl.calls).toBe(1);
  });

  test('a created Which inside the result of a handler of At does not consult the handler of Which', () => {
    const ce = engine();
    const which = attach(ce, 'Which', () => 'text');
    attach(ce, 'At', (args) =>
      ce.function('Which', [
        ce.function('Less', [args[1], ce.number(1)]),
        ce.number(-1),
        ce.symbol('True'),
        ce.function('At', [args[0], ce.function('Floor', [args[1]])]),
      ])
    );
    const r = ir(ce, ['At', L3, 'i']);
    expect(which.calls).toBe(0);
    expect(plain([0.5, 1.5, 2.9].map((i) => r.run!({ i } as never)))).toEqual([
      -1, 10, 20,
    ]);
  });

  test('a handler that returns an expression of its own operator for every node ends', () => {
    // Under a rule that consults the handler again for its own result, the
    // walk would not end: Sin(At(L, i)) holds an At.
    const ce = engine();
    const at = attach(ce, 'At', (args) =>
      ce.function('Sin', [ce.function('At', [...args])])
    );
    const r = ir(ce, ['At', L3, 'i']);
    expect(at.calls).toBe(1);
    expect(r.run!({ i: 2 } as never)).toBeCloseTo(Math.sin(20), 12);
    const e = existing(ce, ['At', L3, 'i']);
    expect(e.run!({ i: 2 } as never)).toBeCloseTo(Math.sin(20), 12);
  });

  test('a handler that rebuilds an operand: an At inside the copy gets no handler', () => {
    const ce = engine();
    const at = attach(ce, 'At', (args) =>
      ce.function('At', [
        args[0],
        ce.function('Max', [
          ce.function('Floor', [ce.box(args[1].json)]),
          ce.number(0),
        ]),
      ])
    );
    const json = ['At', ['List', 1, 2, 3], ['At', ['List', 1, 2, 3], 'i']];
    const r = ir(ce, json);
    // The outer At, and the authored inner At, which `facts()` asks but
    // which the copy replaces.
    expect(at.calls).toBe(2);
    expect(r.code!.split('Math.floor').length - 1).toBe(1);
    // The inner At of the copy is the library's: NaN at 1.5.
    // prettier-ignore
    const want = floored(['List', 1, 2, 3], ['At', ['List', 1, 2, 3], 'i']);
    for (const i of POINTS)
      expect(
        agree(plain(r.run!({ i } as never)), interpreted(engine(), want, { i }))
      ).toBe(true);
  });

  test('a handler that reads context.language', () => {
    const ce = engine();
    const seen = new Set<string>();
    attach(ce, 'At', (_args, _c, { language }) => {
      seen.add(language);
      return undefined;
    });
    for (const to of TARGETS) ir(ce, ['At', L3, 'i'], to);
    expect([...seen].sort()).toEqual([
      'glsl',
      'interval-javascript',
      'javascript',
    ]);
  });

  test('a created node and an authored node of one structure share no lowering', () => {
    // At(L, k) is 10·At(L, k + 1). The created At(L, i + 1) is the library's
    // (L[i+1]); the authored At(L, i + 1) is 10·L[i+2]. In both orders.
    const L = ['List', 1, 2, 3, 4, 5];
    const handler =
      (ce: ComputeEngine): OperatorCompileHandler =>
      (args) =>
        ce.function('Multiply', [
          ce.number(10),
          ce.function('At', [
            args[0],
            ce.function('Add', [args[1], ce.number(1)]),
          ]),
        ]);
    for (const json of [
      ['Add', ['At', L, 'i'], ['Multiply', 100, ['At', L, ['Add', 'i', 1]]]],
      ['Add', ['Multiply', 100, ['At', L, ['Add', 'i', 1]]], ['At', L, 'i']],
    ]) {
      const ce = engine();
      attach(ce, 'At', handler(ce));
      // At i = 1: 10·L[2] + 100·10·L[3] = 20 + 3000.
      expect(ir(ce, json).run!({ i: 1 } as never)).toBe(3020);
      expect(existing(ce, json).run!({ i: 1 } as never)).toBe(3020);
    }
  });

  test('an operand with a draw: one draw', () => {
    const ce = engine();
    attach(ce, 'At', floorIndex(ce));
    const json = ['WithRandomSeed', 3, ['At', L3, ['Multiply', 3, ['Random']]]];
    const r = ir(ce, json);
    expect(r.code!.split('drawNextRandomNumber').length - 1).toBe(1);
    const base = engine();
    const want = interpreted(
      base,
      ['WithRandomSeed', 3, floored(L3, ['Multiply', 3, ['Random']])],
      {}
    );
    expect(agree(plain(r.run!({} as never)), want)).toBe(true);
  });

  test('inside a user function body and a Sum body: the result reads the parameter and the index', () => {
    const ce = engine();
    attach(ce, 'At', floorIndex(ce));
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', ['At', L3, 'u'], 'u'] as never));
    expect(ir(ce, ['f', 'i']).run!({ i: 2.5 } as never)).toBe(20);
    // An upper bound of an input: the existing compiler evaluates a closed
    // Sum with the interpreter, whose At has no handler.
    const sum = [
      'Sum',
      ['At', L3, ['Divide', 'k', 2]],
      ['Limits', 'k', 2, 'n'],
    ];
    // Floors 1, 1, 2, 2, 3.
    expect(ir(ce, sum).run!({ n: 6 } as never)).toBe(90);
    expect(existing(ce, sum).run!({ n: 6 } as never)).toBe(90);
  });

  test('symbolDeps names a user function of the result', () => {
    const ce = engine();
    ce.declare('g', 'function');
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 'u'], 'u'] as never));
    attach(ce, 'At', (args) => ce.function('g', [args[1]]));
    const symbolDeps = new Set<string>();
    const r = ir(ce, ['At', L3, 'i'], 'javascript', { symbolDeps });
    expect(r.run!({ i: 4 } as never)).toBe(8);
    expect([...symbolDeps]).toContain('g');
  });

  test('a host operator of its own, declared with evaluate and compile', () => {
    const ce = engine();
    ce.declare('Twice', {
      signature: '(real) -> real',
      evaluate: ([x]) => ce.function('Multiply', [ce.number(2), x]).evaluate(),
      compile: (args) => ce.function('Multiply', [ce.number(2), args[0]]),
    });
    for (const to of TARGETS)
      expect(ir(ce, ['Twice', 'x'], to)).toMatchObject({ success: true });
    expect(ir(ce, ['Twice', 'x']).run!({ x: 3 } as never)).toBe(6);
    expect(existing(ce, ['Twice', 'x']).run!({ x: 3 } as never)).toBe(6);
  });

  test('each compile() call follows the handler of that call (no cache across calls)', () => {
    const ce = engine();
    let on = true;
    attach(ce, 'At', (args, c, ctx) =>
      on ? floorIndex(ce)(args, c, ctx) : undefined
    );
    const e = ce.box(['At', L3, 'i'] as never);
    const run = () =>
      compile(e, { profile: 'ir', fallback: false } as never).run!({
        i: 1.5,
      } as never);
    expect(run()).toBe(10);
    on = false;
    expect(plain(run())).toEqual(NaN);
    on = true;
    expect(run()).toBe(10);
  });
});

describe('IR profile, batch G28: a handler that declines', () => {
  test('a handler that throws: the decline has its message', () => {
    const ce = engine();
    attach(ce, 'At', () => {
      throw new Error('no such index');
    });
    expect(failure(() => ir(ce, ['At', L3, 'i']))).toMatch(
      /the compile handler of At throws: no such index/
    );
  });

  test('a handler that calls the compile callback declines', () => {
    const ce = engine();
    attach(ce, 'At', (args, c) => {
      c(args[1]);
      return ce.function('At', [...args]);
    });
    expect(failure(() => ir(ce, ['At', L3, 'i']))).toMatch(
      /the definition of At has its own lowering/
    );
  });
});

describe('IR profile, batch G28: review round 2', () => {
  test('F1: an authored node under an operand that canonicalization merges keeps its handler', () => {
    // The And of the result merges the operand And(…) and keeps its
    // children: the At under it is authored.
    // prettier-ignore
    const json = ['Which', ['And', ['Less', ['At', L3, 'i'], 25], ['Less', 'x', 0]], 1, 'True', 2];
    for (const run of [ir, existing]) {
      const ce = engine();
      const at = attach(ce, 'At', floorIndex(ce));
      attach(ce, 'Which', (args) =>
        ce.function('Which', [
          ce.function('And', [
            args[0],
            ce.function('Greater', [ce.symbol('x'), ce.number(-5)]),
          ]),
          ...args.slice(1),
        ])
      );
      // At(L, Max(Floor(2.5), 0)) = 20 < 25.
      expect(run(ce, json).run!({ i: 2.5, x: -1 } as never)).toBe(1);
      expect(at.calls).toBeGreaterThan(0);
    }
  });

  test('F1: Multiply(2, 3·At(L, i)) merges into one Multiply: the At keeps its handler', () => {
    for (const run of [ir, existing]) {
      const ce = engine();
      attach(ce, 'At', floorIndex(ce));
      attach(ce, 'Which', (args) =>
        ce.function('Which', [
          args[0],
          ce.function('Multiply', [ce.number(2), args[1]]),
          ...args.slice(2),
        ])
      );
      // prettier-ignore
      const json = ['Which', ['Less', 'x', 0], ['Multiply', 3, ['At', L3, 'i']], 'True', 5];
      expect(run(ce, json).run!({ i: 2.5, x: -1 } as never)).toBe(120);
    }
  });

  test('F2: a Range of constant operands above a handled node is not evaluated by the interpreter', () => {
    const ce = engine();
    attach(ce, 'At', (args) =>
      ce.function('At', [args[0], ce.function('Add', [args[1], ce.number(1)])])
    );
    const json = ['Range', 1, ['At', ['List', 2, 4, 6], 1]];
    expect(ir(ce, json).run!({} as never)).toEqual([1, 2, 3, 4]);
    expect(
      ir(ce, ['Sum', json], 'interval-js').run!({} as never)
    ).toMatchObject({ value: { lo: 10, hi: 10 } });
  });

  test('F2: D and Integrate of a handled node decline', () => {
    const ce = engine();
    attach(ce, 'At', floorIndex(ce));
    const at = ['At', ['List', 1, 2, 3], 'x'];
    expect(failure(() => ir(ce, ['D', ['Multiply', 'x', at], 'x']))).toMatch(
      /D of an operator that a compile handler lowers/
    );
    expect(
      failure(() =>
        ir(ce, ['Integrate', ['Multiply', 'x', at], ['Limits', 'x', 0, 1]])
      )
    ).toMatch(/Integrate of an operator that a compile handler lowers/);
  });

  test('F3: the memo of a handled node reads the names of its answer', () => {
    // prettier-ignore
    const map = ['Map', ['Function', ['Add', ['At', L3, 1], 'x'], 'u'], ['List', 1, 2, 3]];
    const sum = ['Sum', ['At', L3, 1], ['Limits', 'k', 1, 3]];
    const reads = (ce: ComputeEngine, name: string) =>
      attach(ce, 'At', (args) => ce.function('At', [args[0], ce.symbol(name)]));
    const a = engine();
    reads(a, 'u');
    expect(ir(a, map).run!({ x: 0.5 } as never)).toEqual([10.5, 20.5, 30.5]);
    const box = ir(a, map, 'interval-js').run!({ x: 0.5 } as never);
    expect(JSON.stringify(box)).toMatch(/10\.5.*20\.5.*30\.5/);
    expect(ir(a, map, 'glsl').code).not.toMatch(/vec3\((\w+), \1, \1\)/);
    const s = engine();
    reads(s, 'k');
    expect(ir(s, sum).run!({} as never)).toBe(60);
    expect(ir(s, sum, 'interval-js').run!({} as never)).toMatchObject({
      value: { lo: 60, hi: 60 },
    });
  });

  test('F4: a handler on a control-flow head other than Which is ignored', () => {
    const json = ['If', ['Less', 'x', 0], 1, 2];
    for (const run of [ir, existing]) {
      const ce = engine();
      const swap = attach(ce, 'If', (args) =>
        ce.function('If', [args[0], args[2], args[1]])
      );
      expect(run(ce, json).run!({ x: -1 } as never)).toBe(1);
      expect(swap.calls).toBe(0);
    }
  });

  test('F5: authored nesting is not counted by the depth guard of the existing compiler', () => {
    let json: Json = 'i';
    for (let k = 0; k < 50; k++) json = ['At', L3, ['Divide', json, 10]];
    const ce = engine();
    attach(ce, 'At', floorIndex(ce));
    expect(existing(ce, json).run!({ i: 2 } as never)).toEqual(
      ir(ce, json).run!({ i: 2 } as never)
    );
  });

  test('F6: an answer that holds its own node declines', () => {
    for (const profile of ['ir', undefined]) {
      const ce = engine();
      const e = ce.box(['Add', ['At', L3, 'i'], 'x'] as never);
      const node = (e as unknown as { ops: Expression[] }).ops.find((x) =>
        isFunction(x, 'At')
      )!;
      attach(ce, 'At', () => ce.function('Sin', [node]));
      expect(
        failure(() => compile(e, { profile, fallback: false } as never))
      ).toMatch(/holds its own node/);
    }
  });

  test('F6: the decline leaves no mark for the next compile() of the same node', () => {
    for (const profile of ['ir', undefined]) {
      const ce = engine();
      const e = ce.box(['Sin', ['At', L3, 'i']] as never);
      let own = true;
      attach(ce, 'At', () => (own ? e : undefined));
      attach(ce, 'Sin', (args) => ce.function('Cos', [args[0]]));
      const options = { profile, fallback: false } as never;
      expect(failure(() => compile(e, options))).toMatch(/holds its own node/);
      own = false;
      expect(compile(e, options).run!({ i: 2 } as never)).toBeCloseTo(
        Math.cos(20),
        12
      );
    }
  });
});

describe('IR profile, batch G28: what a handler is given', () => {
  test('no handler is asked about a node of a value of more than 20,000 nodes as a tree', () => {
    // 36 levels over one shared node: 5 nodes per level, about 2^37 as a
    // tree. A handler that serializes an operand would not return.
    for (const answer of ['defers', 'text'] as const) {
      const ce = engine();
      let read = 0;
      attach(ce, 'Which', (args) => {
        read += 1;
        void args[0].json;
        return answer === 'defers' ? undefined : '0';
      });
      let node: Expression = ce.box(['Multiply', 'x', 2] as never);
      for (let k = 0; k < 36; k++)
        node = ce.function('Add', [
          ce.function('Sin', [node]),
          ce.function('Which', [
            ce.function('Greater', [node, ce.number(0)]),
            node,
            ce.True,
            ce.number(1),
          ]),
        ]);
      expect(
        failure(() =>
          compile(node, { profile: 'ir', fallback: false } as never)
        )
      ).toMatch(
        /is not asked about a node of a value of more than 20000 nodes/
      );
      expect(read).toBe(0);
    }
  });

  test('a node under the limit inside a shared value is asked', () => {
    const ce = engine();
    const count = attach(ce, 'Which', (args) => {
      void args[0].json;
      return undefined;
    });
    let node: Expression = ce.box(['Multiply', 'x', 2] as never);
    for (let k = 0; k < 6; k++)
      node = ce.function('Add', [
        ce.function('Sin', [node]),
        ce.function('Which', [
          ce.function('Greater', [node, ce.number(0)]),
          node,
          ce.True,
          ce.number(1),
        ]),
      ]);
    const plainEngine = engine();
    const f = ir(ce, node.json);
    const g = ir(plainEngine, node.json);
    expect(count.calls).toBeGreaterThan(0);
    for (const x of [-1, 0.3, 2])
      expect(f.run!({ x } as never)).toBe(g.run!({ x } as never));
  });

  test("the callback gives '0', the placeholder of the reference analysis", () => {
    const ce = engine();
    const codes: string[] = [];
    attach(ce, 'Which', (args, c) => {
      codes.push(c(args[0]));
      return '0';
    });
    expect(
      failure(() => ir(ce, ['Which', ['Less', 'x', 0], 1, 'True', 2]))
    ).toMatch(/its own lowering/);
    expect(codes).toEqual(['0']);
  });
});

describe('Existing compilers, batch G28: an expression result', () => {
  test('the index rewrite and the Which rewrite give the values of the profile', () => {
    for (const to of ['javascript', 'interval-js'] as const) {
      const ce = engine();
      attach(ce, 'At', floorIndex(ce));
      const a = existing(ce, ['At', L3, 'i'], to);
      const b = ir(ce, ['At', L3, 'i'], to);
      for (const i of POINTS)
        expect(a.run!({ i } as never)).toEqual(b.run!({ i } as never));
    }
    const ce = engine();
    attach(ce, 'Which', (args) =>
      ce.function('Which', [
        args[0],
        ce.function('Multiply', [ce.number(2), args[1]]),
        ...args.slice(2),
      ])
    );
    const json = ['Which', ['Less', 'x', 0], 'x', 'True', 5];
    const a = existing(ce, json);
    for (const x of [-2, 3])
      expect(a.run!({ x } as never)).toBe(x < 0 ? 2 * x : 5);
  });

  test('a text result and undefined are as before', () => {
    const ce = engine();
    attach(ce, 'At', (args, c) => `(${c(args[1])} + 1000)`);
    expect(existing(ce, ['At', L3, 'i']).run!({ i: 1 } as never)).toBe(1001);
    const d = engine();
    attach(d, 'At', () => undefined);
    expect(existing(d, ['At', L3, 'i']).code).toBe(
      existing(engine(), ['At', L3, 'i']).code
    );
  });
});

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G28: the index rewrite in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    // prettier-ignore
    const programs: [string, Json][] = [
      ['At of a literal list', ['At', L3, 'i']],
      ['an At inside the index of an At', ['At', L3, ['At', ['List', 1.5, 2.5, 3.5], 'i']]],
      ['a sum of rewritten At', ['Add', ['At', L3, 'i'], ['At', L3, ['Add', 'i', 1]]]],
    ];

    test.each(programs)(
      '%s agrees with JavaScript',
      async (_, json) => {
        const ce = engine();
        attach(ce, 'At', floorIndex(ce));
        const r = ir(ce, json, 'glsl');
        const f = ir(ce, json);
        const source = (body: string) =>
          [
            '#version 300 es',
            'precision highp float;',
            'uniform float u_i;',
            'out vec4 fragColor;',
            r.preamble ?? '',
            'float userFn(float i) {',
            r.code!.includes(';') ? body : `return ${body};`,
            '}',
            'void main() { fragColor = vec4(userFn(u_i), 0.0, 0.0, 0.0); }',
          ].join('\n');
        // The points where the JavaScript value is a number.
        const items = [1, 1.5, 2.2]
          .map((i) => ({
            name: String(i),
            source: source(r.code!.replace(/\b_\.i\b/g, 'i')),
            uniforms: { u_i: i } as Record<string, number | number[]>,
            expected: f.run!({ i } as never) as number,
          }))
          .filter((x) => typeof x.expected === 'number');
        expect(items.length).toBeGreaterThan(0);
        const values = await driver.evaluate(items);
        for (const [k, v] of values.entries()) {
          if (!v.ok) throw new Error(v.log);
          expect(Math.abs(v.value - items[k].expected)).toBeLessThan(1e-5);
        }
      },
      120_000
    );
  }
);
