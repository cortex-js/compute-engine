import { ComputeEngine } from '../../src/compute-engine';
import type { InferResult } from '../../src/compute-engine';

/** The names and types of `declared`, and the names and reasons of
 * `skipped`. */
function report(r: InferResult): {
  declared: [string, string][];
  skipped: [string, string][];
} {
  return {
    declared: r.declared.map((d) => [d.name, String(d.type)]),
    skipped: r.skipped.map((s) => [s.name, s.reason]),
  };
}

describe('ce.infer(): a name declared `unknown` has no explicit type', () => {
  test('its uses give it a type', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'unknown');
    const expr = ce.parse('x + 1');
    expect(report(ce.infer([expr]))).toEqual({
      declared: [['x', 'number']],
      skipped: [],
    });
    expect(ce.box('x').type.toString()).toBe('number');
  });

  test('with no use, it is reported as untyped', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'unknown');
    expect(report(ce.infer([ce.box(['List', 'x'])]))).toEqual({
      declared: [],
      skipped: [['x', 'untyped']],
    });
  });
});

describe('ce.infer(): `skipped` lists the symbols that it did not change', () => {
  test('a name with no requirement is untyped', () => {
    const ce = new ComputeEngine();
    expect(report(ce.infer([ce.box(['List', 'q'])])).skipped).toEqual([
      ['q', 'untyped'],
    ]);
    expect(report(ce.infer([ce.box('r')])).skipped).toEqual([['r', 'untyped']]);
  });

  test('a name with a declared type is defined', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(report(ce.infer([ce.parse('x + 1')]))).toEqual({
      declared: [],
      skipped: [['x', 'defined']],
    });
  });

  test('declared, unknown and undeclared names in one expression', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'real');
    ce.declare('h', 'unknown');
    expect(report(ce.infer([ce.box(['List', 'g', 'h', 'q'])])).skipped).toEqual(
      [
        ['g', 'defined'],
        ['h', 'untyped'],
        ['q', 'untyped'],
      ]
    );
  });

  test('library names, parameters and binder variables are not reported', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse('\\pi + \\sin(y) + \\sum_{k=1}^{3} k');
    expect(report(ce.infer([sum]))).toEqual({
      declared: [['y', 'number']],
      skipped: [],
    });
    const literal = ce.box(['Function', ['Add', 'a', 'b'], 'a']);
    expect(report(ce.infer([literal]))).toEqual({
      declared: [['b', 'number']],
      skipped: [],
    });
  });

  test('a name that an earlier call typed is not reported again', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x + 1');
    ce.infer([expr]);
    expect(report(ce.infer([expr]))).toEqual({ declared: [], skipped: [] });
  });
});

describe('Solve: a generated parameter avoids a name that was only used', () => {
  test('`t` of an expression made before the solve keeps its type', () => {
    const ce = new ComputeEngine();
    const held = ce.parse('t + 1');
    const roots = ce
      .box(['Solve', ['Equal', ['Sin', 'x'], 0], 'x'])
      .evaluate();
    expect(roots.json).toEqual(['List', ['Multiply', 'Pi', 't_1']]);
    expect(held.type.toString()).toBe('number');
  });

  test('a series expansion before the solve does not take the name `t`', () => {
    const ce = new ComputeEngine();
    ce.box(['Series', ['Sin', 'x'], 'x', 0, 5]).evaluate();
    const roots = ce
      .box(['Solve', ['Equal', ['Sin', 'x'], 0], 'x'])
      .evaluate();
    expect(roots.json).toEqual(['List', ['Multiply', 'Pi', 't']]);
  });

  test('with no earlier use, the parameter is `t`', () => {
    const ce = new ComputeEngine();
    const roots = ce
      .box(['Solve', ['Equal', ['Sin', 'x'], 0], 'x'])
      .evaluate();
    expect(roots.json).toEqual(['List', ['Multiply', 'Pi', 't']]);
  });
});
