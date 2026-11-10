import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  ScalarFragmentJavaScriptTarget,
  type StructuredPhase,
} from '../../src/compute-engine/compilation/javascript-fragment-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { SYS_HELPERS } from '../../src/compute-engine/compilation/javascript-runtime';
import {
  lowerStructuredFragment,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import { inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import type {
  IROperation,
  IRProgram,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';

// Step 6, change 6c, of docs/plans/2026-11-09-js-compiler-status-and-plan.md
// (design: docs/plans/2026-11-10-structured-ir-loops-and-lists.md), on the
// structured route of the internal scalar JavaScript fragment target: lists
// that the program makes (`Comprehension` over a range, `ReplaceAt`), a list
// as a local, a carried value, the value of an `If`, of a helper and of the
// program, the forms of the definitions that `executeEpsil()` makes, and the
// update of a list in place.
//
// The rules of the interpreter and of the existing emitter that the tests
// follow:
// - `Comprehension(body, Element(j, Range(a, b)))` visits `a, a + 1, …, b`,
//   or `a, a - 1, …, b` when `b < a` (the range from 1 to 0 has the two
//   elements 1 and 0). The existing emitter fills one array with `push`,
//   in that order, and counts no pass of the iteration budget.
// - `ReplaceAt(L, k, v)` is a new list; `L` is not changed. An index 0 or
//   out of range leaves the expression unevaluated in the interpreter; the
//   existing emitter throws a `RangeError` from `_SYS.replaceAt` or
//   `_SYS.replaceAtInPlace`. A negative index counts from the end.
// - The interpreter keeps a `ReplaceAt` of a long list as a lazy view
//   (`ReplaceAt` in src/compute-engine/library/collections.ts): its elements
//   are read here with `each()`.
// - The engine computes with machine numbers here (`precision =
//   'machine'`), so that the interpreter rounds as the compiled code does
//   and the values are compared exactly.

/** The prelude of Tycho's heat showcase, copied from
 *  `~/dev/tycho/src/graph-paper/onboarding/showcase-heat.js` (`HEAT_ENTRY.prelude`). */
const PRELUDE = `
const N = 32
// The coefficient a is diffusivity times timestep divided by cell width
// squared. Clamping to [0, 1/4] keeps each update a convex average.
function heatwall(c: integer, r: integer, obstacle: real) -> boolean {
  obstacle > 0.5 && c == 16 && (r < 13 || r > 18)
}
function heatseed() -> list<real> {
  [exp(-((((k - 1) % N) - 9)^2 + (floor((k - 1)/N) - 15.5)^2)/32) for k in 1..N^2]
}
const H_0 = heatseed()
// A missing neighbour reflects the cell temperature for an insulated edge,
// or reads a zero-temperature reservoir for a cooled edge. A wall blocks flux.
function heatneighbor(H: list<real>, c: integer, r: integer, center: real, boundary: real, obstacle: real) -> real {
  if c < 0 || c >= N || r < 0 || r >= N {
    if boundary > 0.5 { 0 } else { center }
  } else if heatwall(c, r, obstacle) { center } else { H[1 + c + N*r] }
}
function heatstep(H: list<real>, diffusivity: real, boundary: real, obstacle: real) -> list<real> {
  let a = min(0.25, max(0, diffusivity))
  let L = [0 for j in 1..N^2]
  for k in 1..N^2 {
    let c = ((k - 1) % N)
    let r = floor((k - 1)/N)
    let v = H[k]
    if heatwall(c, r, obstacle) {
      L = replaceAt(L, k, v)
    } else {
      let neighbors = heatneighbor(H, c-1, r, v, boundary, obstacle) + heatneighbor(H, c+1, r, v, boundary, obstacle) + heatneighbor(H, c, r-1, v, boundary, obstacle) + heatneighbor(H, c, r+1, v, boundary, obstacle)
      L = replaceAt(L, k, v + a*(neighbors - 4*v))
    }
  }
  L
}
// Drag the brush point and press the heat action to add a warm patch.
function heatpaint(H: list<real>, p: real, q: real, obstacle: real) -> list<real> {
  [if !heatwall(((k-1) % N), floor((k-1)/N), obstacle) && (((k-1) % N)+0.5-p)^2 + (floor((k-1)/N)+0.5-q)^2 <= 9 { 1 } else { H[k] } for k in 1..N^2]
}
`;

const OPTIONS = { cse: false, constantFold: false } as const;
/** The interpreter of a step of 1024 cells takes about 3 s. */
const SLOW = 60_000;

/** An engine that has executed `source` with `executeEpsil()`, with
 *  machine numbers. */
function engineWith(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const { diagnostics } = executeEpsil(ce, source);
  expect(diagnostics).toEqual([]);
  return ce;
}

/** The `Function` literal that `executeEpsil()` made for `name`. */
function literal(ce: ComputeEngine, name: string): Expression {
  const definition = ce.lookupDefinition(name) as
    | { operator?: { _lambdaLiteral?: Expression } }
    | undefined;
  const fn = definition?.operator?._lambdaLiteral;
  if (fn === undefined) throw new Error(`no function literal for ${name}`);
  return fn;
}

const structured = (hooks = {}) => new ScalarFragmentJavaScriptTarget('structured', new Map(), hooks);

type Value = number | boolean | readonly number[];

function run(result: CompilationResult<'javascript'>, args: readonly Value[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
}

function box(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return ce.symbol(v ? 'True' : 'False');
  return typeof v === 'number' ? ce.number(v) : ce.function('List', v.map((x) => ce.number(x)));
}

/** The value of the call of `name` on `args` by the interpreter: a number,
 *  or the numbers of a list. */
function interpret(ce: ComputeEngine, name: string, args: readonly Value[]): number | number[] {
  const value = ce.function(name, args.map((v) => box(ce, v))).evaluate();
  if (value.type.matches('number')) return value.N().re;
  const list = value as Expression & { each(): Generator<Expression> };
  return [...list.each()].map((x) => x.N().re);
}

/** The value or the message of the throw of `f`. */
function outcome(f: () => unknown): unknown {
  try {
    const v = f();
    return Array.isArray(v) ? [...v] : v;
  } catch (e) {
    return `throws ${String(e)}`;
  }
}

/** Compile `name` of `source` on both routes and compare each with the
 *  interpreter on each list of arguments. Returns the structured result. */
function differential(
  source: string,
  name: string,
  cases: readonly (readonly Value[])[],
  interpreter = true
): CompilationResult<'javascript'> {
  const ce = engineWith(source);
  const fn = literal(ce, name);
  const result = structured().compile(fn, OPTIONS);
  const existing = compile(fn, { ...OPTIONS, fallback: false });
  for (const args of cases) {
    const value = outcome(() => run(result, args));
    expect([args, value]).toEqual([args, outcome(() => run(existing, args))]);
    if (interpreter) expect([args, value]).toEqual([args, interpret(ce, name, args)]);
  }
  return result;
}

/** The operations of `region` and of the regions nested in it. */
function allOperations(region: IRRegion): IROperation[] {
  return region.operations.flatMap((op) => [
    op,
    ...(op.kind === 'if'
      ? [...allOperations(op.then), ...allOperations(op.else)]
      : op.kind === 'loop' || op.kind === 'build'
        ? allOperations(op.body)
        : op.kind === 'and' || op.kind === 'or'
          ? op.rest.flatMap(allOperations)
          : []),
  ]);
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

//
// The fields
//

const HEAT = engineWith(PRELUDE);
/** `heatseed()` by the interpreter: the structured route declines it
 *  (`exp` is not in the route). */
const SEED: readonly number[] = (() => {
  const v = interpret(HEAT, 'heatseed', []);
  if (!Array.isArray(v)) throw new Error('heatseed is not a list');
  return v;
})();
const UNIFORM: readonly number[] = Array(1024).fill(0.7);
/** One hot cell in a corner. */
const CORNER: readonly number[] = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
/** One hot cell beside the wall (column 15, row 4), as in Tycho's test. */
const SPOT: readonly number[] = Array.from({ length: 1024 }, (_, i) => (i === 15 + 32 * 4 ? 1 : 0));

const STEP = structured().compile(literal(HEAT, 'heatstep'), OPTIONS);
const STEP_EXISTING = compile(literal(HEAT, 'heatstep'), { ...OPTIONS, fallback: false });
const PAINT = structured().compile(literal(HEAT, 'heatpaint'), OPTIONS);
const PAINT_EXISTING = compile(literal(HEAT, 'heatpaint'), { ...OPTIONS, fallback: false });

const step = (H: readonly number[], a: number, b: number, o: number) =>
  run(STEP, [H, a, b, o]) as number[];

//
// The forms of the definitions of executeEpsil()
//

describe('the definitions that executeEpsil() makes', () => {
  test('their forms: Block(Typed(…)), Block branches, let locals', () => {
    const json = (name: string) => JSON.stringify(literal(HEAT, name).json);
    expect(json('heatwall')).toMatch(/^\["Function",\["Block",\["Typed",\["And",/);
    expect(json('heatneighbor')).toContain('["Block",0]');
    expect(json('heatstep')).toContain('["Typed","L","\'list<real>\'"]');
    expect(json('heatstep')).toContain('["Declare","L",["Dictionary",["KeyValuePair",{"str":"value"},["Comprehension",0,');
    expect(json('heatpaint')).toContain('["Not",["heatwall",');
  });

  test('heatwall and heatneighbor compile as root functions', () => {
    const wall = structured().compile(literal(HEAT, 'heatwall'), OPTIONS);
    expect([[16, 5, 1], [16, 15, 1], [16, 5, 0], [3, 5, 1]].map((a) => run(wall, a))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    const neighbor = structured().compile(literal(HEAT, 'heatneighbor'), OPTIONS);
    const existing = compile(literal(HEAT, 'heatneighbor'), { ...OPTIONS, fallback: false });
    for (const [c, r] of [[3, 4], [-1, 4], [16, 5], [31, 31], [4, 32]])
      for (const boundary of [0, 1]) {
        const args = [SEED, c, r, 0.75, boundary, 1];
        expect(run(neighbor, args)).toBe(run(existing, args));
        expect(run(neighbor, args)).toBe(interpret(HEAT, 'heatneighbor', args));
      }
  });

  test('heatseed declines: exp is not in the structured route', () => {
    expect(() => structured().compile(literal(HEAT, 'heatseed'), OPTIONS)).toThrow(
      /Power is in the structured route only with the literal exponent 2/
    );
  });
});

//
// heatstep
//

describe('heatstep: the interpreter decides, the existing emitter checks', () => {
  test(
    'seed field, wall on, insulated, diffusivity 0.22',
    () => {
      const args = [SEED, 0.22, 0, 1];
      expect(step(SEED, 0.22, 0, 1)).toEqual(interpret(HEAT, 'heatstep', args));
    },
    SLOW
  );

  test(
    'one hot cell in a corner, wall off, cooled, diffusivity 0.22',
    () => {
      expect(step(CORNER, 0.22, 1, 0)).toEqual(interpret(HEAT, 'heatstep', [CORNER, 0.22, 1, 0]));
    },
    SLOW
  );

  test(
    'uniform field, wall on, cooled, diffusivity 10 (clamped to 0.25)',
    () => {
      expect(step(UNIFORM, 10, 1, 1)).toEqual(interpret(HEAT, 'heatstep', [UNIFORM, 10, 1, 1]));
    },
    SLOW
  );

  test(
    'three steps in sequence',
    () => {
      let compiled: readonly number[] = SPOT;
      let interpreted: readonly number[] = SPOT;
      for (let n = 0; n < 3; n++) {
        compiled = step(compiled, 0.22, 0, 1);
        interpreted = interpret(HEAT, 'heatstep', [interpreted, 0.22, 0, 1]) as number[];
      }
      expect(compiled).toEqual(interpreted);
    },
    SLOW
  );

  test('every field, wall on and off, insulated and cooled, diffusivity 0.22, 0 and 10', () => {
    for (const H of [SEED, UNIFORM, CORNER, SPOT])
      for (const obstacle of [0, 1])
        for (const boundary of [0, 1])
          for (const a of [0.22, 0, 10]) {
            const args = [H, a, boundary, obstacle];
            expect(run(STEP, args)).toEqual(run(STEP_EXISTING, args));
          }
    // Three steps in sequence, on both routes.
    let a: readonly number[] = SEED;
    let b: readonly number[] = SEED;
    for (let n = 0; n < 3; n++) {
      a = step(a, 0.22, 1, 1);
      b = run(STEP_EXISTING, [b, 0.22, 1, 1]) as number[];
    }
    expect(a).toEqual(b);
  });

  test('the properties that Tycho checks', () => {
    // Insulated: the total heat stays, the values stay in [0, 1], and the
    // field stays symmetric about the middle row.
    let H: readonly number[] = SEED;
    for (let n = 0; n < 8; n++) H = step(H, 0.22, 0, 0);
    close(sum(H), sum(SEED));
    expect(H).not.toEqual(SEED);
    expect(H.every((v) => v >= 0 && v <= 1)).toBe(true);
    for (let r = 0; r < 32; r++)
      for (let c = 0; c < 32; c++) close(H[c + 32 * r], H[c + 32 * (31 - r)]);
    // A uniform field stays; a cooled edge loses heat.
    step(UNIFORM, 0.25, 0, 0).forEach((v) => close(v, 0.7));
    const cooled = step(UNIFORM, 0.25, 1, 0);
    expect(sum(cooled)).toBeLessThan(0.7 * 1024);
    close(cooled[0], 0.35);
    // The wall blocks the flux; the diffusivity is clamped.
    const blocked = step(SPOT, 0.25, 0, 1);
    close(blocked[16 + 32 * 4], 0);
    close(sum(blocked), 1);
    const safe = step(SPOT, 10, 0, 0);
    expect(safe.every((v) => v >= 0 && v <= 1)).toBe(true);
    close(sum(safe), 1);
    close(safe[15 + 32 * 4], 0);
    close(safe[14 + 32 * 4], 0.25);
  });

  test('the input list is not changed, and the result is another array', () => {
    const H = [...SEED];
    const result = step(H, 0.22, 0, 1);
    expect(H).toEqual(SEED);
    expect(result).not.toBe(H);
    // Two calls give two arrays.
    expect(step(H, 0.22, 0, 1)).not.toBe(result);
  });

  test('one list per call: one build, every update in place, no copy', () => {
    // The code makes an array only with the `[]` of a `build` and with the
    // copy of `_SYS.replaceAt`; the runtime helpers are counted with spies.
    expect(STEP.code.match(/= \[\];/g)?.length).toBe(1);
    const copy = jest.spyOn(SYS_HELPERS, 'replaceAt');
    const inPlace = jest.spyOn(SYS_HELPERS, 'replaceAtInPlace');
    try {
      step(SEED, 0.22, 0, 1);
      expect(copy).toHaveBeenCalledTimes(0);
      expect(inPlace).toHaveBeenCalledTimes(1024);
    } finally {
      jest.restoreAllMocks();
    }
  });

  test('the representation: a build, a loop that carries the list, two replace-at in place', () => {
    const preparation = structured().prepareStructured(literal(HEAT, 'heatstep'), OPTIONS);
    const program = lowerStructuredFragment(preparation);
    const ops = allOperations(program.root);
    const build = ops.find((op) => op.kind === 'build')!;
    expect(build.result!.type).toBe('list<integer>');
    const loop = ops.find((op) => op.kind === 'loop')!;
    expect(loop.kind === 'loop' && loop.results.map((r) => r.type)).toEqual(['list<real>']);
    const updates = ops.filter((op) => op.kind === 'replace-at');
    expect(updates).toHaveLength(2);
    const inPlace = inPlaceUpdates(program);
    expect(updates.every((op) => inPlace.has(op))).toBe(true);
  });

  test('the exact emitted code', () => {
    expect(STEP.code).toBe(EXPECTED_HEATSTEP);
  });

  test('the existing readers are not called from preparation to emission', () => {
    const READERS: [object, string][] = [
      [core, 'isComplexValued'],
      [core, 'staticTypeOf'],
      [core, 'userFunctionParamLanes'],
      [core, 'compile'],
      [BaseCompiler, 'compileCseRoot'],
    ];
    const phases: StructuredPhase[] = [];
    const onPhase = (phase: StructuredPhase) => {
      phases.push(phase);
      if (phase === 'preparation')
        for (const [object, reader] of READERS)
          jest.spyOn(object as never, reader as never).mockImplementation((() => {
            throw new Error(`${reader} called from preparation to emission`);
          }) as never);
      if (phase === 'emission') jest.restoreAllMocks();
    };
    let result: CompilationResult<'javascript'>;
    try {
      result = structured({ onPhase }).compile(literal(HEAT, 'heatstep'), OPTIONS);
    } finally {
      jest.restoreAllMocks();
    }
    expect(phases).toEqual(['preparation', 'annotation', 'lowering', 'verification', 'emission', 'assembly']);
    expect(run(result, [SPOT, 0.22, 0, 1])).toEqual(step(SPOT, 0.22, 0, 1));
  });
});

/** The code of `heatstep`: one array (`_tv14`), filled by the build and
 *  carried by the loop, written in place in both branches; the helpers
 *  `heatwall` (`_tv1`) and `heatneighbor` (`_tv2`) read `H` only. */
const EXPECTED_HEATSTEP =
  '(H, diffusivity, boundary, obstacle) => { function _tv1(_tv3, _tv4, _tv5) { return 0.5 < _tv5 && _tv3 === 16 && (_tv4 < 13 || 18 < _tv4); }\n' +
  'function _tv2(_tv6, _tv7, _tv8, _tv9, _tv10, _tv11) { return _tv7 < 0 || 32 <= _tv7 || _tv8 < 0 || 32 <= _tv8 ? 0.5 < _tv10 ? 0 : _tv9 : _tv1(_tv7, _tv8, _tv11) ? _tv9 : _SYS.atNumeric(_tv6, _tv7 + 32 * _tv8 + 1, "real"); }\n' +
  'const _tv12 = Math.min(0.25, Math.max(0, diffusivity)); const _tv13 = 32 * 32; const _tv14 = []; for (let _tv15 = 1, _tv16 = _tv13 < _tv15 ? -1 : 1, _tv17 = _tv16 * (_tv13 - _tv15); _tv17 >= 0; _tv15 += _tv16, _tv17--) { _tv14.push(0); } const _tv18 = 32 * 32; let _tv19 = _tv14; for (let _tv20 = 1, _tv21 = _tv18 < _tv20 ? -1 : 1, _tv22 = _tv21 * (_tv18 - _tv20); _tv22 >= 0; _tv20 += _tv21, _tv22--) { const _tv23 = _SYS.floorMod(_tv20 + -1, 32); const _tv24 = Math.floor((_tv20 + -1) / 32); const _tv25 = _SYS.atNumeric(H, _tv20, "real"); _tv19 = _tv1(_tv23, _tv24, obstacle) ? _SYS.replaceAtInPlace(_tv19, _tv20, _tv25) : _SYS.replaceAtInPlace(_tv19, _tv20, _tv12 * (_tv2(H, _tv23 + -1, _tv24, _tv25, boundary, obstacle) + _tv2(H, _tv23 + 1, _tv24, _tv25, boundary, obstacle) + _tv2(H, _tv23, _tv24 + -1, _tv25, boundary, obstacle) + _tv2(H, _tv23, _tv24 + 1, _tv25, boundary, obstacle) + -4 * _tv25) + _tv25); } return _tv19; }';

//
// heatpaint
//

describe('heatpaint', () => {
  test(
    'the interpreter decides: a brush on the seed field, wall on',
    () => {
      const args = [SEED, 23, 16, 1];
      expect(run(PAINT, args)).toEqual(interpret(HEAT, 'heatpaint', args));
    },
    SLOW
  );

  test('the existing emitter checks: brushes near the wall and the edges, wall on and off', () => {
    for (const [p, q] of [[23, 16], [16.5, 10], [0, 0], [31.5, 31.5], [-5, 40]])
      for (const obstacle of [0, 1]) {
        const args = [SEED, p, q, obstacle];
        expect(run(PAINT, args)).toEqual(run(PAINT_EXISTING, args));
      }
  });

  test('the patch adds heat, the wall keeps its cells, the input is not changed', () => {
    const H = [...SEED];
    const painted = run(PAINT, [H, 23, 16, 1]) as number[];
    expect(H).toEqual(SEED);
    expect(painted).not.toBe(H);
    expect(sum(painted)).toBeGreaterThan(sum(SEED));
    // A brush on the wall (column 16, row 5) leaves the wall cells.
    const wall = run(PAINT, [UNIFORM, 16.5, 5.5, 1]) as number[];
    expect(wall[16 + 32 * 5]).toBe(0.7);
    expect(wall[15 + 32 * 5]).toBe(1);
  });
});

//
// build
//

describe('Comprehension over a range: build', () => {
  const source = (body: string, a: string, b: string, extra = '') => `
${extra}
function f(n: integer) -> list<real> {
  [${body} for j in ${a}..${b}]
}`;

  test('the range from 1 to n: n = 0 has the elements 1 and 0, n = 1 one element, n = 4', () => {
    differential(source('2*j + 0.5', '1', 'n'), 'f', [[0], [1], [4]]);
  });

  test('a range that counts down', () => {
    differential(source('j', 'n', '1'), 'f', [[5], [1], [-2]]);
  });

  test('an integer body gives the same array', () => {
    const result = differential(
      `function f(n: integer) -> list<integer> { [j*j for j in 1..n] }`,
      'f',
      [[3]]
    );
    expect(run(result, [3])).toEqual([1, 4, 9]);
  });

  test('a body with an If', () => {
    differential(source('if j < 3 { j } else { 0.5 }', '1', 'n'), 'f', [[5]]);
  });

  test('a body that calls a helper', () => {
    differential(
      source('g(j)', '1', 'n', 'function g(x: integer) -> real { x/4 }'),
      'f',
      [[5]]
    );
  });

  test('the bound Power(N, 2) of an integer capture and the length of a list', () => {
    differential(
      `const M = 3
function f(H: list<real>) -> list<real> { [H[j] + M^2 for j in 1..length(H)] }`,
      'f',
      [[[1.5, 2.5, 3]]]
    );
    differential(
      `const M = 3
function f() -> list<real> { [j for j in 1..M^2] }`,
      'f',
      [[]]
    );
  });

  test('a list made by a helper and returned by it', () => {
    const result = differential(
      `function g(n: integer) -> list<real> { [j/2 for j in 1..n] }
function f(n: integer) -> real {
  let L = g(n)
  L[1] + L[n]
}`,
      'f',
      [[4]]
    );
    expect(run(result, [4])).toBe(2.5);
  });

  test('the representation: a build with two bounds, an index, one element', () => {
    const ce = engineWith(source('j*j', '1', 'n'));
    const program = lowerStructuredFragment(structured().prepareStructured(literal(ce, 'f'), OPTIONS));
    const build = allOperations(program.root).find((op) => op.kind === 'build')!;
    expect(build.operands.map((v) => v.type)).toEqual(['integer', 'integer']);
    expect(build.kind === 'build' && build.body.parameters?.map((p) => p.type)).toEqual(['integer']);
    expect(build.result!.type).toBe('list<integer>');
    expect(build.effect).toBe('pure');
  });
});

//
// replace-at
//

describe('ReplaceAt: replace-at', () => {
  const source = `function f(H: list<real>, k: integer, v: real) -> list<real> { replaceAt(H, k, v) }`;
  test('the first and the last index, a negative index', () => {
    differential(source, 'f', [[[1, 2, 3], 1, 9], [[1, 2, 3], 3, 9], [[1, 2, 3], -1, 9]]);
  });

  test('an index 0 or out of range: the throw of the existing emitter', () => {
    // The interpreter keeps the expression unevaluated; compiled code throws.
    const result = differential(source, 'f', [[[1, 2, 3], 0, 9], [[1, 2, 3], 4, 9], [[1, 2, 3], -4, 9]], false);
    expect(() => run(result, [[1, 2, 3], 4, 9])).toThrow(RangeError);
  });

  test('an index 0 or out of range in place: the same throw', () => {
    const result = differential(
      `function f(k: integer) -> list<real> {
  let L = [j for j in 1..3]
  L = replaceAt(L, k, 0.5)
  L
}`,
      'f',
      [[1], [0], [4], [-1]],
      false
    );
    expect(result.code).toContain('_SYS.replaceAtInPlace(');
  });

  test('an integer element in a list of reals, a real element in a list of integers', () => {
    differential(
      `function f(n: integer) -> list<real> {
  let L = [j for j in 1..n]
  let M = replaceAt(L, 1, 0.5)
  replaceAt(M, 2, 7)
}`,
      'f',
      [[3]]
    );
  });
});

//
// Update in place
//

describe('update in place: the copies that the rule keeps', () => {
  /** The structured result of `source`, compared with the interpreter and
   *  the existing emitter; `inPlace`: whether its code updates in place. */
  const check = (source: string, cases: readonly (readonly Value[])[], inPlace: boolean, copy: boolean) => {
    const result = differential(source, 'f', cases);
    expect(result.code.includes('_SYS.replaceAtInPlace(')).toBe(inPlace);
    expect(result.code.includes('_SYS.replaceAt(')).toBe(copy);
    return result;
  };

  test('the old list read after the update: a copy', () => {
    const result = check(
      `function f() -> real {
  let L = [0 for j in 1..4]
  let M = replaceAt(L, 1, 5)
  L[1] + M[1]
}`,
      [[]],
      false,
      true
    );
    expect(run(result, [])).toBe(5);
  });

  test('the old list read before the update: in place', () => {
    check(
      `function f(n: integer) -> list<real> {
  let L = [j for j in 1..n]
  for k in 1..n {
    let v = L[k]
    L = replaceAt(L, k, v + L[1])
  }
  L
}`,
      [[4]],
      true,
      false
    );
  });

  test('the old list returned with the new one through an If: a copy', () => {
    check(
      `function f(c: boolean) -> list<real> {
  let L = [j for j in 1..3]
  let M = replaceAt(L, 1, 5)
  if c { L } else { M }
}`,
      [[true], [false]],
      false,
      true
    );
  });

  test('a list parameter of a helper updated in the helper while the caller still reads it: a copy', () => {
    check(
      `function g(H: list<real>) -> list<real> { replaceAt(H, 1, 9) }
function f() -> real {
  let L = [j for j in 1..3]
  let M = g(L)
  L[1] + M[1]
}`,
      [[]],
      false,
      true
    );
  });

  test('a list input updated: a copy, and the input is not changed', () => {
    const result = check(
      `function f(H: list<real>) -> list<real> {
  let L = H
  L = replaceAt(L, 1, 9)
  L
}`,
      [[[1, 2, 3]]],
      false,
      true
    );
    const H = [1, 2, 3];
    expect(run(result, [H])).toEqual([9, 2, 3]);
    expect(H).toEqual([1, 2, 3]);
  });

  test('a captured list declines: a capture is a number', () => {
    const ce = engineWith(`const K = [1, 2, 3]
function f() -> list<real> { replaceAt(K, 1, 9) }`);
    expect(() => structured().compile(literal(ce, 'f'), OPTIONS)).toThrow(/unsupported capture K/);
  });

  test('a list updated in one branch and read in the other: in place', () => {
    check(
      `function f(c: boolean) -> real {
  let L = [j for j in 1..3]
  let s = 0
  if c { L = replaceAt(L, 1, 5) } else { s = L[1] }
  L[1] + s
}`,
      [[true], [false]],
      true,
      false
    );
  });

  test('a list carried by a loop and also read through another local: a copy', () => {
    check(
      `function f(n: integer) -> real {
  let L = [0 for j in 1..n]
  let s = 0
  for k in 1..n {
    let M = L
    L = replaceAt(L, k, k)
    s = s + M[k]
  }
  s + L[n]
}`,
      [[4]],
      false,
      true
    );
  });

  // Rule 1 of `inPlaceUpdates()`: a value is unique only when no other
  // value can hold its array.

  test('the result of a helper that returns its list parameter: a copy', () => {
    check(
      `function g(H: list<real>) -> list<real> { H }
function f(n: integer) -> real {
  let L = [j for j in 1..n]
  let M = g(L)
  M = replaceAt(M, 1, 9)
  L[1] + M[1]
}`,
      [[3]],
      false,
      true
    );
  });

  test('the result of a helper that returns its list parameter or a new list: a copy', () => {
    check(
      `function g(H: list<real>, c: boolean, n: integer) -> list<real> {
  if c { H } else { [0 for j in 1..n] }
}
function f(c: boolean, n: integer) -> real {
  let L = [j for j in 1..n]
  let M = g(L, c, n)
  M = replaceAt(M, 1, 9)
  L[1] + M[1]
}`,
      [[true, 3], [false, 3]],
      false,
      true
    );
  });

  test('an If of a list input and a new list, then updated: a copy, and the input is not changed', () => {
    const result = check(
      `function f(H: list<real>, c: boolean) -> list<real> {
  let M = if c { H } else { [j for j in 1..3] }
  M = replaceAt(M, 1, 9)
  M
}`,
      [[[4, 5, 6], true], [[4, 5, 6], false]],
      false,
      true
    );
    for (const c of [true, false]) {
      const H = [4, 5, 6];
      const value = run(result, [H, c]);
      expect(H).toEqual([4, 5, 6]);
      expect(value).not.toBe(H);
      expect(value).toEqual(c ? [9, 5, 6] : [9, 2, 3]);
    }
  });

  test('the initial value of a loop-carried list read after the loop: a copy', () => {
    const result = check(
      `function f(n: integer) -> real {
  let L0 = [j for j in 1..n]
  let L = L0
  for k in 1..n { L = replaceAt(L, k, 0.5) }
  L0[1] + L[1]
}`,
      [[3]],
      false,
      true
    );
    expect(run(result, [3])).toBe(1.5);
  });

  test('a list that a helper built and returned: in place', () => {
    const result = check(
      `function g(n: integer) -> list<real> { [j/2 for j in 1..n] }
function f(n: integer, x: real) -> list<real> {
  let L = g(n)
  L = replaceAt(L, 1, x)
  L
}`,
      [[3, 7]],
      true,
      false
    );
    expect(run(result, [3, 7])).toEqual([7, 1, 1.5]);
  });

  test('a list defined before a loop and updated in it with no carried value: a copy', () => {
    check(
      `function f(n: integer) -> real {
  let L = [0 for j in 1..n]
  let s = 0
  for k in 1..n {
    let M = replaceAt(L, k, k)
    s = s + M[k] + L[k]
  }
  s
}`,
      [[4]],
      false,
      true
    );
  });

  test('a list updated in a build body: a copy', () => {
    check(
      `function f(n: integer) -> list<real> {
  let L = [0 for j in 1..n]
  [replaceAt(L, j, 1)[j] + L[j] for j in 1..n]
}`,
      [[3]],
      false,
      true
    );
  });

  test('a read of the list that the emitter could move after the update stays before it', () => {
    // `L[1]` is read before the update and used after it.
    const result = check(
      `function f(n: integer) -> real {
  let L = [j for j in 1..n]
  let a = L[1]
  L = replaceAt(L, 1, 10)
  a + L[1]
}`,
      [[3]],
      true,
      false
    );
    expect(run(result, [3])).toBe(11);
  });
});

//
// The verifier
//

describe('the verifier, build and replace-at', () => {
  function lowered() {
    const ce = engineWith(`function f(n: integer, x: real) -> list<real> {
  let L = [j for j in 1..n]
  replaceAt(L, 1, x)
}`);
    const preparation = structured().prepareStructured(literal(ce, 'f'), OPTIONS);
    const program = lowerStructuredFragment(preparation);
    const ops = program.root.operations as IROperation[];
    const build = ops.findIndex((op) => op.kind === 'build');
    const replace = ops.findIndex((op) => op.kind === 'replace-at');
    const change = (index: number, changed: IROperation): IRProgram => {
      const rootOps = [...ops];
      rootOps[index] = changed;
      return { ...program, root: { ...program.root, operations: rootOps } };
    };
    return { program, ops, build, replace, change, nodes: preparedNodesOf(preparation) };
  }

  test('the lowered program is accepted', () => {
    const m = lowered();
    expect(m.build).toBeGreaterThanOrEqual(0);
    expect(m.replace).toBeGreaterThan(m.build);
    expect(() => verifyJavaScriptProgram(m.program, m.nodes)).not.toThrow();
  });

  test('a build whose bound is a list', () => {
    const m = lowered();
    const op = m.ops[m.build];
    const changed = { ...op, operands: [op.operands[0], op.result!] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(m.build, changed), m.nodes)).toThrow();
  });

  test('a build with two parameters', () => {
    const m = lowered();
    const op = m.ops[m.build] as Extract<IROperation, { kind: 'build' }>;
    const [index] = op.body.parameters!;
    const changed = { ...op, body: { ...op.body, parameters: [index, { ...index, id: 9999 }] } } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(m.build, changed), m.nodes)).toThrow(
      /the body of a build has 2 parameters, not one index/
    );
  });

  test('a build whose result is not a list', () => {
    const m = lowered();
    const op = m.ops[m.build];
    const changed = { ...op, result: { ...op.result!, type: 'integer', representation: 'number' } } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(m.build, changed), m.nodes)).toThrow(
      /a build has a result of the type integer, not a list/
    );
  });

  test('a build of integers whose body yields a real', () => {
    const m = lowered();
    const op = m.ops[m.build] as Extract<IROperation, { kind: 'build' }>;
    const body = op.body;
    const yieldOp = body.operations[body.operations.length - 1];
    const real = { ...body.parameters![0], type: 'real' as const };
    // A real index is refused first; a yield of a real value of the body
    // is refused by the element rule.
    const changed = {
      ...op,
      body: { ...body, operations: [...body.operations.slice(0, -1), { ...yieldOp, operands: [real] }] },
    } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(m.build, changed), m.nodes)).toThrow();
  });

  test('a replace-at whose index is not an integer', () => {
    const m = lowered();
    const op = m.ops[m.replace];
    const [list, , value] = op.operands;
    const changed = { ...op, operands: [list, value, value] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(m.replace, changed), m.nodes)).toThrow(
      /the index of the operation replace-at has the type real/
    );
  });

  test('a replace-at of a real element with a result of integers', () => {
    const m = lowered();
    const op = m.ops[m.replace];
    const changed = { ...op, result: { ...op.result!, type: 'list<integer>' } } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(m.replace, changed), m.nodes)).toThrow(
      /the operation replace-at writes a real element into a list<integer> and has a result of the type list<integer>/
    );
  });

  test('a replace-at of a value that is not a list', () => {
    const m = lowered();
    const op = m.ops[m.replace];
    const [, index, value] = op.operands;
    const changed = { ...op, operands: [index, index, value] } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(m.replace, changed), m.nodes)).toThrow(
      /the operation replace-at reads a value of the type integer, not a list/
    );
  });

  test('a replace-at that is not pure', () => {
    const m = lowered();
    const changed = { ...m.ops[m.replace], effect: 'unknown' } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(m.replace, changed), m.nodes)).toThrow(
      /the operation replace-at is not pure/
    );
  });
});

//
// Refusals and shadowed heads
//

describe('refusals', () => {
  test('a shadowed Comprehension or ReplaceAt (a user function of that name) declines', () => {
    for (const [name, call] of [
      ['Comprehension', "Comprehension(0, 1)"],
      ['ReplaceAt', 'ReplaceAt(H, 1, 2)'],
    ]) {
      const ce = engineWith(`function ${name}(a: real, b: real) -> real { a + b }
function f(H: real) -> real { ${call.replace('H, 1, 2', 'H, 1')} }`);
      const fn = literal(ce, 'f');
      expect(JSON.stringify(fn.json)).toContain(`["${name}"`);
      // The head is not the operator of the library: the rule of the
      // operator does not apply, and the head is refused.
      expect(() => structured().compile(fn, OPTIONS)).toThrow(
        new RegExp(`unsupported (bound )?head ${name}`)
      );
    }
  });

  test('a list literal declines', () => {
    const ce = engineWith(`function f(k: integer) -> real { [1, 2, 3][k] }`);
    expect(() => structured().compile(literal(ce, 'f'), OPTIONS)).toThrow(
      /a list literal is not in the structured route/
    );
  });
});
