import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// An interpreter ERROR must never reach compiled code as a number.
//
// The compile-time constant fold evaluates a constant subtree with `.N()` and
// inlines the value. It inlines only number literals (a scalar, or the
// elements of a finite indexed collection), so an `Error` value, or a
// collection that holds one, is not folded: compilation continues on the
// ordinary emit route, which then reports its own refusal.
//
// The error can still reach the fold disguised as a number. `.N()` of a
// `Map` with a bare-symbol callback rewraps the callback as
// `_1 ↦ N(w(_1))`, and the lazy `Map` serves that shape through the lowered
// broadcast spine (`library/map-lowering.ts`), which replaces an element whose
// callback returned an `Error` with the collection's absence marker: `NaN` for
// a numeric collection. So `Map(w, [1, 2, 3]).N()` holds `[NaN, NaN, NaN]`,
// and the fold compiled that with `success: true`. A collection with a `NaN`
// element therefore does not fold (`tryConstantFold`,
// `compilation/base-compiler.ts`).
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  // A NOMINAL type: the one-argument clause rejects a plain number at call
  // time, and the JavaScript target cannot emit the clause set.
  ce.box(['DeclareType', 'meters', { str: 'number' }]).evaluate();
  clause('w', ['Function', 2, p('d', 'meters')]);
  clause('w', [
    'Function',
    ['Add', 'x', 'y'],
    p('x', 'number'),
    p('y', 'number'),
  ]);
});

function clause(name: string, fn: MathJsonExpression): void {
  ce.box(['DefineFunction', name, fn]).evaluate();
}

function p(name: string, type: string): MathJsonExpression {
  return ['Typed', name, { str: type }];
}

function isErrorElement(x: { json: unknown }): boolean {
  return Array.isArray(x.json) && x.json[0] === 'Error';
}

describe('an interpreter error is not folded into a number', () => {
  test('the interpreter gives no number for an element whose callback errors', () => {
    for (const expr of [
      ce.box(['Map', 'w', ['List', 1, 2, 3]]),
      ce.parse('\\operatorname{Map}(w, [1, 2, 3])'),
    ]) {
      const exact = [...expr.evaluate().each()];
      expect(exact).toHaveLength(3);
      expect(exact.every(isErrorElement)).toBe(true);
      // Under `.N()` each element is the error or its absence marker `NaN`,
      // never a finite number.
      const approx = [...expr.N().each()];
      expect(approx).toHaveLength(3);
      for (const x of approx)
        expect(isErrorElement(x) || Number.isNaN(x.re)).toBe(true);
    }
  });

  test('a Map whose callback errors per element does not compile to NaNs', () => {
    const expr = ce.box(['Map', 'w', ['List', 1, 2, 3]]);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /^Could not compile `w`: [\s\S]*referenced as a value/
    );
  });

  test('a fold whose value is an Error declines', () => {
    // `Sum` over the per-element errors evaluates to one `Error`. The fold
    // declines it, and the emit route refuses `w` as a value.
    const expr = ce.box(['Sum', ['Map', 'w', ['List', 1, 2, 3]]]);
    expect(isErrorElement(expr.N())).toBe(true);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /^Could not compile `w`: [\s\S]*referenced as a value/
    );
  });
});
