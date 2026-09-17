/**
 * `ce.rebind(expr, { form, scope })` — rebuild a boxed expression as if it
 * had been boxed from its MathJSON, without producing the MathJSON.
 *
 * The oracle for every case is the MathJSON route: `rebind` must answer what
 * `ce.expr(expr.json, { form, scope })` answers. The one behavior that is
 * `rebind`'s own is the headline: a symbol resolves AFRESH in the given
 * scope, where `ce.expr(expr, { scope })` keeps the bindings the expression
 * was boxed with.
 */

import { ComputeEngine, isFunction, isObject } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

function json(expr: Expression): string {
  return JSON.stringify(expr.json);
}

describe('rebind: parity with the MathJSON route', () => {
  test('canonical: an arithmetic expression', () => {
    const e = ce.parse('x^2 + 2xy + \\sqrt{y}');
    const viaJson = ce.expr(e.json);
    const rebound = ce.rebind(e);
    expect(json(rebound)).toBe(json(viaJson));
    expect(rebound.isCanonical).toBe(true);
    expect(rebound.isSame(viaJson)).toBe(true);
  });

  test('canonical: a binder keeps its bound index', () => {
    const e = ce.parse('\\sum_{i=1}^{n} i^2');
    const viaJson = ce.expr(e.json);
    const rebound = ce.rebind(e);
    expect(json(rebound)).toBe(json(viaJson));
    expect(rebound.isSame(viaJson)).toBe(true);
    expect(rebound.evaluate().isSame(viaJson.evaluate())).toBe(true);
  });

  test('canonical: an invalid input stays invalid, as the MathJSON route leaves it', () => {
    const e = ce.parse('\\sin(1, 2, 3)');
    const viaJson = ce.expr(e.json);
    const rebound = ce.rebind(e);
    expect(rebound.isValid).toBe(viaJson.isValid);
    expect(json(rebound)).toBe(json(viaJson));
  });

  test('canonical: a function literal', () => {
    const e = ce.box(['Function', ['Add', 'x', 1], 'x']);
    const viaJson = ce.expr(e.json);
    const rebound = ce.rebind(e);
    expect(json(rebound)).toBe(json(viaJson));
  });

  test('structural: parse vocabulary is kept', () => {
    const e = ce.parse('x^{1/3} + (a - b)', { form: 'structural' });
    const viaJson = ce.expr(e.json, { form: 'structural' });
    const rebound = ce.rebind(e, { form: 'structural' });
    expect(json(rebound)).toBe(json(viaJson));
    expect(rebound.isStructural).toBe(true);
    expect(rebound.isCanonical).toBe(false);
  });

  test('raw: the copy is unbound', () => {
    const e = ce.parse('2x + y', { form: 'raw' });
    const viaJson = ce.expr(e.json, { form: 'raw' });
    const rebound = ce.rebind(e, { form: 'raw' });
    expect(json(rebound)).toBe(json(viaJson));
    expect(rebound.isCanonical).toBe(false);
    expect(rebound.isStructural).toBe(false);
  });

  test('a shared sub-expression: the copy matches the tree the MathJSON route writes', () => {
    const shared = ce.parse('x + 1');
    const e = ce.function('Add', [
      ce.function('Multiply', [shared, shared]),
      ce.function('Power', [shared, 3]),
      shared,
    ]);
    const viaJson = ce.expr(e.json);
    const rebound = ce.rebind(e);
    expect(json(rebound)).toBe(json(viaJson));
    expect(rebound.isSame(viaJson)).toBe(true);
  });

  test('a partial form takes the MathJSON route and matches it', () => {
    const e = ce.parse('c + b + a', { form: 'raw' });
    const form = ['Flatten', 'Order'] as const;
    const viaJson = ce.expr(e.json, { form: [...form] });
    const rebound = ce.rebind(e, { form: [...form] });
    expect(json(rebound)).toBe(json(viaJson));
  });

  test('an expression from another engine is rebuilt on the calling engine', () => {
    const other = new ComputeEngine();
    const e = other.parse('x + \\pi');
    const rebound = ce.rebind(e);
    expect(rebound.engine).toBe(ce);
    expect(json(rebound)).toBe(json(ce.expr(e.json)));
  });

  test('a dictionary is rebuilt from its MathJSON', () => {
    const e = ce.box({ dict: { a: 1, b: ['Add', 'x', 1] } });
    const viaJson = ce.expr(e.json);
    const rebound = ce.rebind(e);
    expect(json(rebound)).toBe(json(viaJson));
  });

  test('a held operand: symbols bind as boxHold binds them, nothing is canonicalized', () => {
    const outer = ce.createScope({ q: 'real' });
    const inner = ce.createScope({ q: 'integer' });
    const e = ce.box(['Hold', ['Add', 'q', 1]], { scope: outer });
    const viaJson = ce.expr(e.json, { scope: inner });
    const rebound = ce.rebind(e, { scope: inner });
    expect(json(rebound)).toBe(json(viaJson));
    const heldSymbol = (x: Expression): Expression => {
      if (!isFunction(x, 'Hold') || !isFunction(x.op1))
        throw new Error('shape');
      return x.op1.op1;
    };
    expect(heldSymbol(rebound).type.toString()).toBe(
      heldSymbol(viaJson).type.toString()
    );
    expect(heldSymbol(rebound).type.toString()).toBe('integer');
  });

  test('an exact rational under the raw and structural forms is the compound the MathJSON route builds', () => {
    const e = ce.parse('\\frac{1}{2} + x');
    for (const form of ['raw', 'structural'] as const) {
      const viaJson = ce.expr(e.json, { form });
      const rebound = ce.rebind(e, { form });
      expect(json(rebound)).toBe(json(viaJson));
      expect(rebound.isCanonical).toBe(viaJson.isCanonical);
    }
  });

  test('a mutable object is rebuilt as its record snapshot, as the MathJSON route boxes it', () => {
    const record = ce.box(['Dictionary', ['KeyValuePair', { str: 'n' }, 1]]);
    const object = ce.box(['Object', record, "'Box'"]);
    const viaJson = ce.expr(object.json);
    const rebound = ce.rebind(object);
    expect(json(rebound)).toBe(json(viaJson));
    expect(isObject(rebound)).toBe(isObject(viaJson));
    const nested = ce.function('Tuple', [object, ce.number(1)]);
    expect(json(ce.rebind(nested))).toBe(json(ce.expr(nested.json)));
  });

  test('a leaf drops its verbatim LaTeX, as the MathJSON route does', () => {
    const five = ce.box({ num: '5', latex: '\\text{five}' });
    const e = ce.function('Tuple', [
      five,
      ce.box({ str: 'a', latex: '\\text{A}' }),
    ]);
    const viaJson = ce.expr(e.json);
    const rebound = ce.rebind(e);
    expect(json(rebound)).toBe(json(viaJson));
    expect(rebound.latex).toBe(viaJson.latex);
  });

  test('leaves: a number literal and a symbol', () => {
    const n = ce.number(42);
    expect(ce.rebind(n).isSame(n)).toBe(true);
    const sym = ce.parse('x');
    expect(json(ce.rebind(sym))).toBe(json(ce.expr(sym.json)));
  });
});

describe('rebind: symbols resolve afresh in the given scope', () => {
  test('a symbol declared differently in two scopes', () => {
    const outer = ce.createScope({ q: 'real' });
    const inner = ce.createScope({ q: 'string' });
    const e = ce.parse('q', { scope: outer });
    expect(e.type.toString()).toBe('real');
    // `ce.expr` on a boxed input keeps the binding it was boxed with.
    expect(ce.expr(e, { scope: inner }).type.toString()).toBe('real');
    // `rebind` re-resolves it, and answers what the MathJSON route answers.
    expect(ce.rebind(e, { scope: inner }).type.toString()).toBe('string');
    expect(ce.expr(e.json, { scope: inner }).type.toString()).toBe('string');
  });

  test('a function expression over a re-declared symbol', () => {
    const outer = ce.createScope({ k: 'integer' });
    const inner = ce.createScope({ k: 'real' });
    const e = ce.parse('k + 1', { scope: outer });
    expect(e.type.toString()).toBe('integer');
    const rebound = ce.rebind(e, { scope: inner });
    expect(rebound.type.toString()).toBe(
      ce.expr(e.json, { scope: inner }).type.toString()
    );
    expect(rebound.type.toString()).toBe('real');
    // The input is untouched.
    expect(e.type.toString()).toBe('integer');
  });
});
