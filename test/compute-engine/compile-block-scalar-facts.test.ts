import { ComputeEngine, compile } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import {
  isScalarValue,
  recordBlockScalarLocals,
} from '../../src/compute-engine/compilation/javascript-value-facts';
import type { MathJsonExpression } from '../../src/math-json/types';

const source = (r: { code?: string; preamble?: string }): string =>
  (r.preamble ?? '') + (r.code ?? '');
function define(ce: ComputeEngine, name: string, body: MathJsonExpression) {
  ce.declare(name, {
    type: '(unknown) -> unknown',
    value: ce.box(['Function', body, 't']),
  });
}

describe('scalar facts through retained helper locals', () => {
  test('scalar assignments and nested helpers avoid broadcasts', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    define(ce, 'f', [
      'Block',
      ['Declare', 'q', "'unknown'", ['Sin', 't']],
      ['Multiply', 'q', ['Abs', 'q']],
    ]);
    define(ce, 'g', [
      'Block',
      ['Declare', 'v', "'unknown'", ['f', 't']],
      ['Add', 1, ['f', 'v']],
    ]);
    const r = compile(ce.box(['Add', 2, ['g', 'x']]));
    expect(r.success).toBe(true);
    expect(source(r)).not.toMatch(/_SYS\.(?:bcast|mul)/);
    const f = (t: number) => Math.sin(t) * Math.abs(Math.sin(t));
    for (const x of [-1, 0, 0.5])
      expect(r.run!({ x })).toBeCloseTo(3 + f(f(x)), 12);
  });

  test('a collection assignment does not become a scalar local', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    define(ce, 'f', [
      'Block',
      ['Declare', 'q', "'unknown'", ['List', 't', ['Add', 't', 1]]],
      ['Multiply', 2, 'q'],
    ]);
    const r = compile(ce.box(['Add', 1, ['f', 'x']]));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 3 })).toEqual([7, 9]);
  });

  // `q` is a list, then a number: the compiled code gives a local one
  // representation, so the compilation declines (CE-712.1, the simple rule
  // for assignments). The interpreter fallback gives [11, 7] at x = 4.
  test('a reassignment of a local to another shape declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    define(ce, 'f', [
      'Block',
      ['Declare', 'q', "'unknown'", ['List', 't', 2]],
      ['Declare', 'v', "'unknown'", ['Multiply', 2, 'q']],
      ['Assign', 'q', 3],
      ['Add', 'q', 'v'],
    ]);
    const r = compile(ce.box(['f', 'x']));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    ce.assign('x', 4);
    expect(ce.box(['f', 'x']).evaluate().json).toEqual(['List', 11, 7]);
  });

  // The first value `t` has the type `unknown`, so the local `q` keeps the
  // type `unknown` and a later list value does not narrow it. A local of
  // type `unknown` that is given a list has no settled shape, and the
  // compilation declines; the interpreter gives the values.
  test('a conditional list write to a local of type unknown declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    define(ce, 'f', [
      'Block',
      ['Declare', 'q', "'unknown'", 't'],
      ['If', ['Greater', 't', 0], ['Assign', 'q', ['List', 2, 3]]],
      ['Multiply', 2, 'q'],
    ]);
    expect(ce.box(['f', 'x']).type.toString()).not.toMatch(/vector/);
    const r = compile(ce.box(['f', 'x']));
    expect(r.success).toBe(false);
    expect(r.run!({ x: 4 })).toEqual([4, 6]);
    expect(r.run!({ x: -1 })).toBe(-2);
  });

  test('a local of type unknown admits a value of any type', () => {
    const body = (first: MathJsonExpression): MathJsonExpression => [
      'Function',
      [
        'Block',
        first,
        ['If', ['Greater', 't', 0], ['Assign', 'q', "'s'"]],
        ['Assign', 'q', ['List', 1]],
        'q',
      ],
      't',
    ];
    const ce = new ComputeEngine();
    const fn = ce.box(body(['Declare', 'q', "'unknown'", 't']));
    expect(fn.isValid).toBe(true);
    expect(fn.type.toString()).toBe('(t: unknown) -> unknown');
    expect(ce.box(['Apply', fn, 3]).evaluate().toString()).toBe('[1]');
    // A local is made only by a `Declare`: an `Assign` to a name that is not
    // in scope is the static error `assignment-to-undeclared-variable`.
    const assigned = new ComputeEngine().box(body(['Assign', 'q', 't']));
    expect(assigned.isValid).toBe(false);
    expect(assigned.toString()).toContain('assignment-to-undeclared-variable');
  });

  test('a nested block shadows an enclosing scalar local', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    define(ce, 'f', [
      'Block',
      ['Declare', 'q', "'unknown'", 't'],
      [
        'Block',
        ['Declare', 'q', "'unknown'", ['List', 2, 3]],
        ['Multiply', 2, 'q'],
      ],
    ]);
    const r = compile(ce.box(['f', 'x']));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 4 })).toEqual([4, 6]);
  });

  test('a callee reads its global input, not a caller local of that name', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'list<real>');
    define(ce, 'g', ['Multiply', 'q', 't']);
    define(ce, 'f', [
      'Block',
      ['Declare', 'q', "'unknown'", 2],
      ['Add', 'q', ['g', 't']],
    ]);
    ce.declare('x', 'real');
    const r = compile(ce.box(['f', 'x']));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 3, q: [4, 5] })).toEqual([14, 17]);
  });

  test('retained bodies use later explicit input declarations', () => {
    const ce = new ComputeEngine();
    define(ce, 'f', [
      'Block',
      ['Declare', 'q', "'unknown'", ['Add', 's', 't']],
      ['Multiply', 'q', ['Abs', 'q']],
    ]);
    ce.declare('x', 'real');
    const unknown = compile(ce.box(['f', 'x']));
    expect(unknown.run!({ x: 1, s: 2 })).toBe(9);
    ce.declare('s', 'real');
    const scalar = compile(ce.box(['Add', 1, ['f', 'x']]));
    expect(scalar.success).toBe(true);
    expect(source(scalar)).not.toMatch(/_SYS\.(?:bcast|mul)/);
    expect(scalar.run!({ x: 1, s: 2 })).toBe(10);
  });

  test('locals inside a symbolic-bound sum retain scalar counter facts', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'integer');
    ce.declare('x', 'real');
    define(ce, 'f', [
      'Sum',
      [
        'Block',
        ['Declare', 'q', "'unknown'", ['Power', 2, 'i']],
        ['Multiply', 'q', 't'],
      ],
      ['Limits', 'i', 0, 'N'],
    ]);
    const r = compile(ce.box(['f', 'x']));
    expect(r.success).toBe(true);
    expect(source(r)).not.toMatch(/_SYS\.bcast\([^\n]*q/);
    expect(r.run!({ N: 3, x: 2 })).toBe(30);
  });
  test.each(['builtin', 'operator override', 'vars override'])(
    '%s conditions respect the local-fact boundary',
    (kind) => {
      const ce = new ComputeEngine();
      ce.declare('condition', { type: '() -> boolean' });
      const target = new JavaScriptTarget().createTarget({
        boundVars: new Set(['q']),
        varsKeys: kind === 'vars override' ? new Set(['flag']) : undefined,
        cse: {
          enabled: false,
          instances: [],
          harvestOptions: {
            isOverriddenOperator: (name) =>
              kind === 'operator override' && name === 'condition',
            isStringVar: (name) => kind === 'vars override' && name === 'flag',
          },
        },
      });
      const statements = [
        ce.box(['Declare', 'q', "'unknown'", 2]),
        ce.box([
          'If',
          kind === 'vars override' ? 'flag' : ['condition'],
          'q',
          0,
        ]),
      ];
      recordBlockScalarLocals(statements, target);
      // A mapped condition may contain `q = [2, 3]`. Its source is opaque,
      // so no scalar fact may survive even though both written arms are scalar.
      expect(isScalarValue(ce.symbol('q'), target)).toBe(
        kind === 'builtin'
      );
    }
  );
});
