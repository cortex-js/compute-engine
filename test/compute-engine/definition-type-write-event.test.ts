/**
 * A write through the public `type` setter of a value definition, or the
 * public `signature` setter of an operator definition, must report a
 * `type-write` state event. Results cached against the engine's cache
 * generation are recomputed only when an event advances it, so without the
 * event a held expression kept the type it had before the write.
 *
 * Internal writers use `_setType()` / `_setSignature()`, which report no
 * event, and report their own event. So each route reports exactly one
 * `type-write` event.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { StateEvent } from '../../src/compute-engine/engine-configuration-lifecycle';

/** Record the `type-write` events that `ce` reports while `fn` runs. */
function typeWrites(ce: ComputeEngine, fn: () => void): StateEvent[] {
  const events: StateEvent[] = [];
  const engine = ce as unknown as { _noteStateEvent(e: StateEvent): void };
  const original = engine._noteStateEvent;
  const spy = jest
    .spyOn(engine, '_noteStateEvent')
    .mockImplementation((e: StateEvent) => {
      events.push(e);
      original.call(engine, e);
    });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return events.filter((e) => e.kind === 'type-write');
}

describe('writing the type of a value definition', () => {
  test('a held expression is typed again after the write', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    const held = ce.box(['Add', 'b', 1]);
    expect(held.type.toString()).toBe('real');
    ce.box('b').valueDefinition!.type = ce.type('integer');
    expect(held.type.toString()).toBe('integer');
  });

  test('the write reports one type-write event', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    const events = typeWrites(ce, () => {
      ce.box('b').valueDefinition!.type = ce.type('integer');
    });
    expect(events).toEqual([
      { kind: 'type-write', callableBefore: false, callableAfter: false },
    ]);
  });

  test('the event says when the write adds a signature arm', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'real');
    const events = typeWrites(ce, () => {
      ce.box('g').valueDefinition!.type = ce.type('(real) -> real');
    });
    expect(events).toEqual([
      { kind: 'type-write', callableBefore: false, callableAfter: true },
    ]);
  });

  test('a refused write to a constant reports no event', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { type: 'integer', value: 3, isConstant: true });
    const events = typeWrites(ce, () => {
      expect(() => {
        ce.box('k').valueDefinition!.type = ce.type('real');
      }).toThrow();
    });
    expect(events).toEqual([]);
  });

  test('a cached derivative is computed again after the write', () => {
    // The closing `simplify()` of an order-2 derivative reads declared
    // types: `sin(πb)` is zero for an integer `b`.
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    ce.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    expect(ce.box(['Derivative', 'f', 2]).evaluate().toString()).toEqual(
      expect.stringContaining('sin')
    );
    ce.box('b').valueDefinition!.type = ce.type('integer');

    // The same sequence with nothing cached, for the reference answer.
    const cold = new ComputeEngine();
    cold.declare('b', 'real');
    cold.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    cold.box('b').valueDefinition!.type = cold.type('integer');

    const after = ce.box(['Derivative', 'f', 2]).evaluate().toString();
    expect(after).not.toEqual(expect.stringContaining('sin'));
    expect(after).toBe(cold.box(['Derivative', 'f', 2]).evaluate().toString());
  });
});

describe('writing the type of a symbol', () => {
  test('the symbol setter reports exactly one type-write event', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    const held = ce.box(['Add', 'b', 1]);
    expect(held.type.toString()).toBe('real');
    const events = typeWrites(ce, () => {
      ce.box('b').type = 'integer';
    });
    expect(events).toEqual([
      { kind: 'type-write', callableBefore: false, callableAfter: false },
    ]);
    expect(held.type.toString()).toBe('integer');
  });

  test('a signature write through the symbol setter reports one event', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(real) -> real');
    const events = typeWrites(ce, () => {
      ce.box('h').type = '(real) -> integer';
    });
    expect(events).toEqual([
      { kind: 'type-write', callableBefore: true, callableAfter: true },
    ]);
  });
});

describe('writing the signature of an operator definition', () => {
  test('a held application is typed again after the write', () => {
    const ce = new ComputeEngine();
    ce.declare('h', { signature: '(real) -> real' });
    const held = ce.box(['h', 'x']);
    expect(held.type.toString()).toBe('real');
    const def = ce.lookupDefinition('h');
    if (def === undefined || !('operator' in def))
      throw new Error('"h" has no operator definition');
    const events = typeWrites(ce, () => {
      def.operator.signature = ce.type('(real) -> integer');
    });
    expect(events).toEqual([
      { kind: 'type-write', callableBefore: true, callableAfter: true },
    ]);
    expect(held.type.toString()).toBe('integer');
  });
});
