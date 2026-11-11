import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Slice 1 of binding units, with the engine flag `_bindingUnits` on:
// `ce.withValues()` for a name that boxing did not declare, the type that a
// definition records for a captured free symbol (CE-473), and the read of a
// name declared `unknown` (rule 4 of
// `docs/plans/2026-11-09-binding-units-slice-1-spec.md`).

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce._bindingUnits = true;
  return ce;
}

function isTypeError(value: Expression): boolean {
  return (
    value.operator === 'Error' &&
    JSON.stringify(value.json).includes('incompatible-type')
  );
}

describe('withValues() for a free name', () => {
  test('a name that was only boxed is declared, and has no value after the call', () => {
    const ce = engine();
    const expr = ce.box(['Add', 'zz', 1]);
    expect(ce.lookupDefinition('zz')).toBeUndefined();
    expect(ce.withValues({ zz: 7 }, () => expr.evaluate().re)).toBe(8);
    const def = ce.lookupDefinition('zz');
    expect(def !== undefined && 'value' in def).toBe(true);
    if (def !== undefined && 'value' in def) {
      expect(def.value.value).toBeUndefined();
      expect(def.value.type.toString()).toBe('unknown');
      expect(def.value.inferredType).toBe(true);
    }
    expect(expr.evaluate().isNumberLiteral).toBe(false);
  });

  test('a name that a stored body applies throws before it is declared', () => {
    // The declaration of `a` as a value would rewrite the body of `f` as the
    // product `a·(t+1)`.
    const ce = engine();
    ce.parse('f(t) := a(t+1)').evaluate();
    const before = ce.parse('f(1)').evaluate().toString();
    expect(() => ce.withValues({ a: 2 }, () => 0)).toThrow(/Declare "a"/);
    expect(ce.lookupDefinition('a')).toBeUndefined();
    expect(ce.parse('f(1)').evaluate().toString()).toBe(before);
  });
});

describe('a captured free symbol', () => {
  const LITERAL = ['Function', ['List', ['Negate', 'x'], 'y'], 'x'] as const;

  test('a later assignment of another type makes a named call an error', () => {
    const ce = engine();
    ce.assign('g', ce.box(LITERAL as never));
    ce.assign('y', ce.string('abc'));
    const call = ce.box(['g', 3]);
    expect(call.type.toString()).toBe('vector<2>');
    expect(isTypeError(call.evaluate())).toBe(true);
    expect(() => compile(call, { fallback: false })).toThrow(
      /Could not compile the function 'g'/
    );
  });

  test('a later assignment of the recorded type is read', () => {
    const ce = engine();
    ce.assign('g', ce.box(LITERAL as never));
    ce.assign('y', 5);
    expect(ce.box(['g', 3]).evaluate().toString()).toBe('[-3,5]');
  });

  test('the record keeps the type of the occurrence', () => {
    // `y` in `x + y` reads `number` from its unit; a string is refused.
    const ce = engine();
    ce.declare('g', 'function');
    ce.assign('g', ce.parse('x \\mapsto x + y'));
    ce.assign('y', ce.string('s'));
    expect(() => compile(ce.box(['g', 1]), { fallback: false })).toThrow(
      /the symbol 'y' that its body reads has the type `string`, but the body of 'g' was typed when 'y' had the type `number`/
    );
  });
});

describe('a name declared unknown reads as a free name', () => {
  test.each([true, false])('an element read (declared: %s)', (declare) => {
    const ce = engine();
    if (declare) ce.declare('P', 'unknown');
    ce.declare('i', 'integer');
    expect(ce.parse('P[i]').type.toString()).toBe('unknown');
  });

  test.each([true, false])(
    'a sum with a point (declared: %s)',
    (declare) => {
      const ce = engine();
      if (declare) ce.declare('q', 'unknown');
      const sum = ce.box(['Add', ['Tuple', 1, 2], 'q']);
      expect(sum.type.toString()).toBe('number | tuple<number, number>');
    }
  );
});
