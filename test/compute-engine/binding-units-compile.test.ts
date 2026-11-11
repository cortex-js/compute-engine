import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// Phase E of slice 1 of binding units, package A: the compilation of an
// expression whose inputs are
// typed by several units, the operations that a target opens, and the scope
// that the body of a stored function reads
// (`docs/plans/2026-11-09-binding-units-slice-1-spec.md`, rules 3 and 8).

function engine(): ComputeEngine {
  return new ComputeEngine();
}

type Run = (vars: Record<string, unknown>) => unknown;

describe('BINDING UNITS: THE TYPE OF A COMPILED INPUT', () => {
  test('an input used in a block and outside it has the type that the block requires', () => {
    const ce = engine();
    const expr = ce.expr([
      'If',
      ['Greater', 'x', 0],
      ['Block', 'x'],
      ['Block', ['Negate', 'x']],
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as Run)({ x: -3 })).toBe(3);
  });

  test('an input that occurs only in an assigned value has the type that the value requires', () => {
    const ce = engine();
    ce.assign('b', ce.parse('c + 1'));
    const r = compile(ce.parse('2b'), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.freeSymbols).toEqual(['c']);
    expect(r.freeSymbolTypes?.c?.type).toBe('number');
    expect((r.run as Run)({ c: 4 })).toBe(10);
  });

  test('an input that occurs only in the body of a called function has the type that the body requires', () => {
    const ce = engine();
    ce.declare('u', 'real');
    ce.assign('f', ce.parse('x \\mapsto x + k'));
    const r = compile(ce.parse('f(u)'), { fallback: false });
    expect(r.success).toBe(true);
    expect([...(r.freeSymbols ?? [])].sort()).toEqual(['k', 'u']);
    expect((r.run as Run)({ u: 1, k: 2 })).toBe(3);
  });

  test('an input whose units disagree declines', () => {
    const ce = engine();
    // `c` is a number in the value of `b` and a boolean in the root.
    ce.assign('b', ce.parse('c + 1'));
    const r = compile(ce.box(['List', 'b', ['Not', 'c']]));
    expect(r.success).toBe(false);
  });

  test('the variable of an indefinite integral does not type the input of its name', () => {
    const ce = engine();
    const r = compile(
      ce.box([
        'Add',
        ['If', ['Less', 2, 3], 0, 'x'],
        ['Integrate', ['Power', 'x', 2], ['Limits', 'x', 'Nothing', 'Nothing']],
      ])
    );
    expect(r.success).toBe(false);
    expect(r.unsupported).toContain('x');
  });

  test('the variable of a D does not type the input of its name', () => {
    const ce = engine();
    ce.declare('g', 'list<real>');
    const r = compile(ce.box(['D', ['Power', 'g', 2], 'g']));
    expect(r.success).toBe(true);
    expect((r.run as Run)({ g: [1, 2] })).toEqual([2, 4]);
  });

  test('an input that no unit types still declines', () => {
    const ce = engine();
    ce.assign('b', ce.box(['List', 'c', 1]));
    const r = compile(ce.box(['First', 'b']));
    expect(r.success).toBe(false);
    expect(r.unsupported).toContain('c');
  });
});

describe('BINDING UNITS: A TARGET CALLED DIRECTLY IS AN OPERATION', () => {
  test('GLSL: the argument of a called function is typed by the body', () => {
    const ce = engine();
    ce.assign('f', ce.parse('x \\mapsto x + k'));
    const r = new GLSLTarget().compile(ce.parse('f(u)'));
    expect([...(r.freeSymbols ?? [])].sort()).toEqual(['k', 'u']);
  });

  test('the expression of the host is not narrowed by the compilation', () => {
    const ce = engine();
    ce.assign('f', ce.parse('x \\mapsto x + k'));
    const expr = ce.parse('f(u)') as Expression & { op1: Expression };
    new GLSLTarget().compile(expr);
    expect(expr.op1.type.toString()).toBe('unknown');
  });
});

describe('BINDING UNITS: THE BOUNDS OF A COMPILED INTEGRAL', () => {
  const TAIL = String.raw`\int_{x}^{\infty}\!\frac{\exp(-(y/2))y^{k/2-1}}{\Gamma(\frac{k}{2})\sqrt{2}^{k}}\, \mathrm{d}y`;
  beforeAll(() => BaseCompiler.setAntiderivativeAttemptBudgetForTesting(0));
  afterAll(() => BaseCompiler.setAntiderivativeAttemptBudgetForTesting());

  const searches = (ce: ComputeEngine, to: 'javascript' | 'interval-js') => {
    const before = BaseCompiler.antiderivativeAttemptCount;
    const r = compile(ce.parse(TAIL), { to });
    expect(r.success).toBe(true);
    return BaseCompiler.antiderivativeAttemptCount - before;
  };

  test('a compilation that makes no search still types a bound', () => {
    const ce = engine();
    expect(searches(ce, 'javascript')).toBe(1);
    // The search timed out and is recorded: the next compilations make no
    // search, and the bound `x` is still a number.
    expect(searches(ce, 'interval-js')).toBe(0);
    expect(searches(ce, 'javascript')).toBe(0);
  });

  test('the first assignment of a name of the integral repeats the search', () => {
    const ce = engine();
    expect(searches(ce, 'javascript')).toBe(1);
    ce.assign('k', 4);
    expect(searches(ce, 'javascript')).toBe(1);
  });

  test('the variable of a constant dimension does not capture a name of an assigned value', () => {
    const ce = engine();
    ce.assign('c', ce.box(['Add', 'IntegrationVariable', 1]));
    const r = compile(
      ce.box([
        'Integrate',
        ['Function', ['Multiply', 'c', ['Sin', ['Sin', 'x']]], 'x'],
        ['Limits', 'Nothing', 0, 1],
        ['Limits', 'Nothing', 0, 2],
      ]),
      { fallback: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).not.toMatch(/\(IntegrationVariable\) =>/);
    expect((r.run as Run)({ IntegrationVariable: 2 })).toBeCloseTo(
      2.583636618724144,
      10
    );
  });
});

describe('BINDING UNITS: A FIT IS ONE OPERATION', () => {
  test('FindRoot in a statement of a program compiles its residual', () => {
    const ce = engine();
    // The residual norm of the compiled residual. The interpreted residual
    // gives another last digits (2.5673675777e-10).
    const result = executeEpsil(ce, 'findRoot(x^2 - 2, [(x, 1)])');
    expect(JSON.stringify(result.value?.json)).toContain(
      '2.567368539985182e-10'
    );
  });
});

describe('BINDING UNITS: THE BODY OF A STORED FUNCTION READS ITS OWN SCOPE', () => {
  test('the type of a call does not read a declaration of a pushed scope', () => {
    const ce = engine();
    ce.declare('U', 'real | list<real>');
    ce.assign('h', ce.box(['Function', ['Add', 's', 'U'], 's']));
    const outer = ce.box(['h', 1]).type.toString();
    ce.pushScope();
    try {
      ce.declare('U', 'real');
      expect(ce.box(['h', 1]).type.toString()).toBe(outer);
    } finally {
      ce.popScope();
    }
  });

  test('the type of an applied literal reads the binding that the literal captured', () => {
    const ce = engine();
    ce.declare('M', 'list<real>');
    ce.declare('g', 'list<real>');
    const literal = ce.box(['Function', ['Join', 'a', 'g'], 'a']);
    ce.pushScope();
    try {
      ce.declare('g', 'list<string>');
      expect(
        ce.function('Apply', [literal, ce.symbol('M')]).type.toString()
      ).toBe('list<real>');
    } finally {
      ce.popScope();
    }
  });

  test('the dispatch on a declared union types a called function with the outer input', () => {
    const ce = engine();
    ce.declare('U', 'real | list<real>');
    ce.assign('h', ce.box(['Function', ['Add', 's', 'U'], 's']));
    const r = compile(ce.box(['Add', 'U', ['h', 1]]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('Array.isArray');
    ce.assign('U', ce.box(['List', 1, 2]));
    expect((r.run as Run)({ U: [1, 2] })).toEqual([3, 5]);
  });

  test('a symbol declared with a function type reads its own definition', () => {
    const ce = engine();
    ce.pushScope();
    ce.declare('h', '(real) -> string');
    ce.assign('h', ce.box(['Function', "'local'", 'u']));
    const view = ce.box(['Map', 'h', ['List', 1, 2]]);
    ce.popScope();
    ce.assign('h', ce.box(['Function', 9, 'u']));
    expect(view.type.toString()).toBe('list<string^2>');
    expect(ce.box(['ListFrom', view]).evaluate().json).toEqual([
      'List',
      "'local'",
      "'local'",
    ]);
  });
});
