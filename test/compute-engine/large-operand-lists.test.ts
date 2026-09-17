/**
 * Operand lists a source does not bound — the terms of a flattened sum, the
 * elements of a literal collection — must never be spread into a call
 * (`push(...ops)`, `widen(...types)`, `Math.max(...data)`): a spread passes
 * every element as a call argument, and past roughly 125,000 of them V8
 * throws `RangeError: Maximum call stack size exceeded`.
 *
 * The witness is a DAG: a 10-level chain in which each level reads the level
 * below it four times holds 40 distinct nodes and 262,144 terms once the
 * nested sums flatten. Boxing it from its MathJSON, and rebinding it in
 * another scope, both build that flattened sum and read its type.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

const DEPTH = 10;
const FAN_OUT = 4;

function sharedChain(scope: ReturnType<ComputeEngine['createScope']>) {
  let level: Expression = ce.box(['Add', 'q', 1], { scope });
  for (let i = 1; i < DEPTH; i++)
    level = ce.function('Add', new Array<Expression>(FAN_OUT).fill(level), {
      scope,
    });
  return level;
}

describe('a flattened sum of 262,144 terms', () => {
  const outer = ce.createScope({ q: 'real' });
  const inner = ce.createScope({ q: 'integer' });
  const chain = sharedChain(outer);

  test('boxes from its MathJSON and reads its type', () => {
    const boxed = ce.expr(chain.json, { scope: inner });
    expect(boxed.isValid).toBe(true);
    expect(boxed.type.toString()).toBe('integer');
  });

  test('rebinds in another scope and reads its type', () => {
    const rebound = ce.rebind(chain, { scope: inner });
    expect(rebound.isValid).toBe(true);
    expect(rebound.type.toString()).toBe('integer');
  });
});

describe('a literal collection of 200,000 elements', () => {
  test('a list with a symbol among its elements types its elements', () => {
    const elements: Expression[] = new Array(200_000);
    for (let i = 0; i < elements.length; i++) elements[i] = ce.number(i);
    elements[100] = ce.parse('x');
    const list = ce.function('List', elements);
    // The point is that the type READS: a list of numbers with one symbol
    // among them is a numeric vector once the symbol is inferred numeric.
    expect(list.type.toString()).toMatch(/^(list|vector)</);
    expect(list.nops).toBe(200_000);
  });
});
