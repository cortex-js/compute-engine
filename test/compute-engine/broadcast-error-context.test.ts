import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  broadcastFrames,
  errorFrames,
} from '../../src/compute-engine/boxed-expression/error-value';

/**
 * A user function with scalar parameters is auto-broadcast over an indexed
 * collection argument (the ratified vectorization default). When that fires
 * unexpectedly the elementwise failures are mystifying — the user sees a bare
 * type error, or an inert list, with no hint a broadcast was in flight.
 *
 * These pin the DISPLAY layer only: the values are unchanged, an error element
 * is still an error element, and a non-broadcast error keeps its historical
 * shape aside from the site operand every `incompatible-type` error now
 * carries.
 */

/** `bump(n: integer) = n + 1` — a scalar-parameter lambda, so it broadcasts. */
function withBump(ce: ComputeEngine): void {
  ce.assign(
    'bump',
    ce.box(['Function', ['Add', 'n', 1], ['Typed', 'n', { str: 'integer' }]])
  );
}

/**
 * `Boom(x)` — an operator whose evaluate handler raises a host exception, and
 * `pick(c) = Boom(c)`, a scalar-parameter lambda around it. This is the vehicle
 * for the THROWN-element-failure tests: a broadcast element that throws must
 * abort the whole broadcast with the element-wise context appended to the
 * message, and nothing in the built-in library is guaranteed to keep throwing
 * from an evaluate handler, so the throw is supplied by the test itself.
 *
 * With `only` given, the handler throws for that one argument value and answers
 * `0` for every other, which is how an element INDEX can be pinned: the failure
 * has to be attributed to the slot it came from, not merely reported.
 *
 * A conditional used to serve as this vehicle (`pick(c) = If(c, 1, 2)` over a
 * list of numbers). It no longer throws: an undecidable condition leaves the
 * `If` inert (ruling 2026-08-31), which the companion tests below pin.
 */
function withBoom(ce: ComputeEngine, only?: number): void {
  ce.declare('Boom', {
    signature: '(any) -> number',
    evaluate: ([x]) => {
      if (only === undefined || x.isSame(only))
        throw new Error('boom in element');
      return ce.number(0);
    },
  });
}

describe('BROADCAST ERROR CONTEXT — box route', () => {
  test('an element error carries an `ErrorBroadcast` breadcrumb entry', () => {
    const ce = new ComputeEngine();
    withBump(ce);
    const result = ce.box(['bump', ['List', 1, { str: 'b' }, 3]]).evaluate();

    // The VALUE is unchanged: still a 3-element list with the failure in place.
    expect(result.operator).toBe('List');
    expect(result.nops).toBe(3);
    expect(result.op1.toString()).toBe('2');
    expect(result.ops![2].toString()).toBe('4');

    // The failing element carries the context, in the existing `ErrorTrace`
    // breadcrumb (§2a) under a distinct `ErrorBroadcast` head.
    expect(result.ops![1].json).toEqual([
      'Apply',
      ['Function', ['Block', ['Add', 'n', 1]], ['Typed', 'n', "'integer'"]],
      [
        'Error',
        ['ErrorCode', "'incompatible-type'", "'integer'", "'string'"],
        "'b'",
        ['ErrorTrace', ['ErrorBroadcast', "'bump'", 2, 3]],
      ],
    ]);
  });

  test('the context is rendered, naming the function, length and index', () => {
    const ce = new ComputeEngine();
    withBump(ce);
    expect(
      ce
        .box(['bump', ['List', 1, { str: 'b' }, 3]])
        .evaluate()
        .toString()
    ).toBe(
      `[2,Apply((n) => n + 1, Error(ErrorCode("incompatible-type", "integer", "string"), "b", "while applying 'bump' element-wise over 3 elements (element 2)")),4]`
    );
  });

  test('every failing element is self-diagnosing, with its own index', () => {
    const ce = new ComputeEngine();
    withBump(ce);
    const result = ce
      .box(['bump', ['List', { str: 'a' }, { str: 'b' }]])
      .evaluate();
    expect(broadcastFrames(result.op1.ops![1])).toEqual([
      { operator: 'bump', index: 1, length: 2 },
    ]);
    expect(broadcastFrames(result.ops![1].ops![1])).toEqual([
      { operator: 'bump', index: 2, length: 2 },
    ]);
  });

  test('a THROWN element failure enriches the message with the context', () => {
    const ce = new ComputeEngine();
    // A host exception out of an element aborts the whole broadcast, so it
    // cannot carry a breadcrumb operand the way an error VALUE does. The
    // context is appended to the exception's message instead.
    withBoom(ce);
    ce.assign('pick', ce.box(['Function', ['Boom', 'c'], 'c']));
    expect(() => ce.box(['pick', ['List', 1, 2, 3, 4]]).evaluate()).toThrow(
      /while applying 'pick' element-wise over 4 elements \(element 1\)/
    );
  });

  test('an INERT element does not abort the broadcast — it completes', () => {
    // The contrast case for the test above. An undecidable condition is inert,
    // not a throw (ruling 2026-08-31), so a conditional body that cannot decide
    // is not an element FAILURE at all: the broadcast runs to completion and
    // each unresolved element keeps its held `If`.
    const ce = new ComputeEngine();
    ce.assign('pick', ce.box(['Function', ['If', 'c', 1, 2], 'c']));
    const result = ce.box(['pick', ['List', true, false, 3]]).evaluate();
    expect(result.json).toEqual(['List', 1, 2, ['If', 3, 1, 2]]);
    // No element carries a broadcast breadcrumb: nothing failed.
    expect(JSON.stringify(result.json)).not.toContain('ErrorBroadcast');
  });
});

/**
 * The wildcard `ce.declare('f', 'function')` + assign route registers a VALUE
 * definition, so the application is broadcast by `applyFunctionLiteral` rather
 * than by the operator-definition lambda arms (steps 2b/4b). Same user
 * function, different dispatch — the context must be there too.
 */
function withDeclaredBump(ce: ComputeEngine): void {
  ce.declare('bump', 'function');
  ce.assign(
    'bump',
    ce.box(['Function', ['Add', 'n', 1], ['Typed', 'n', { str: 'integer' }]])
  );
}

describe('BROADCAST ERROR CONTEXT — value-definition route', () => {
  test('the wildcard declaration really is a value definition', () => {
    const ce = new ComputeEngine();
    withDeclaredBump(ce);
    // Guards the two tests below from silently drifting onto the
    // operator-definition route (which the box-route tests already cover).
    expect(ce.lookupDefinition('bump')).toHaveProperty('value');
  });

  test('an error element carries the `ErrorBroadcast` breadcrumb entry', () => {
    const ce = new ComputeEngine();
    withDeclaredBump(ce);
    const result = ce.box(['bump', ['List', 1, { str: 'b' }, 3]]).evaluate();

    // The VALUE is unchanged: still a 3-element list with the failure in place.
    expect(result.operator).toBe('List');
    expect(result.nops).toBe(3);
    expect(broadcastFrames(result.ops![1].ops![1])).toEqual([
      { operator: 'bump', index: 2, length: 3 },
    ]);
    expect(result.toString()).toBe(
      `[2,Apply((n) => n + 1, Error(ErrorCode("incompatible-type", "integer", "string"), "b", "while applying 'bump' element-wise over 3 elements (element 2)")),4]`
    );
  });

  test('a THROWN element failure enriches the message with the context', () => {
    const ce = new ComputeEngine();
    withBoom(ce);
    ce.declare('pick', 'function');
    ce.assign('pick', ce.box(['Function', ['Boom', 'c'], 'c']));
    expect(() => ce.box(['pick', ['List', 1, 2, 3, 4]]).evaluate()).toThrow(
      /while applying 'pick' element-wise over 4 elements \(element 1\)/
    );
  });
});

describe('BROADCAST ERROR CONTEXT — async route', () => {
  test('a rejection is attributed to its element index', async () => {
    const ce = new ComputeEngine();
    // `Boom` raises only on the argument `3`, so elements 1 and 2 succeed.
    withBoom(ce, 3);
    ce.assign('pick', ce.box(['Function', ['Boom', 'c'], 'c']));
    // `Promise.all` cannot attribute a rejection, but each element's promise
    // is created in a known slot: the third element is the one that fails.
    await expect(
      ce.box(['pick', ['List', 1, 2, 3]]).evaluateAsync()
    ).rejects.toThrow(
      /while applying 'pick' element-wise over 3 elements \(element 3\)/
    );
  });

  test('the context is appended exactly once', async () => {
    const ce = new ComputeEngine();
    withBoom(ce);
    ce.assign('pick', ce.box(['Function', ['Boom', 'c'], 'c']));
    // The per-element wrapper enriches; the outer `Promise.all` handler must
    // not enrich the same error a second time.
    const message = await ce
      .box(['pick', ['List', 1, 2]])
      .evaluateAsync()
      .then(
        () => '',
        (e) => (e as Error).message
      );
    expect(message.match(/element-wise/g)).toHaveLength(1);
  });
});

describe('BROADCAST ERROR CONTEXT — Epsil route', () => {
  test('the final statement value carries the rendered context', () => {
    const ce = new ComputeEngine();
    const { value } = executeEpsil(
      ce,
      `function bump(n: integer) { n + 1 }\nbump([1, "b", 3])`
    );
    expect(value.toString()).toBe(
      `[2,Apply((n) => n + 1, Error(ErrorCode("incompatible-type", "integer", "string"), "b", "while applying 'bump' element-wise over 3 elements (element 2)")),4]`
    );
  });

  test('a non-final statement reports the context as a runtime diagnostic', () => {
    const ce = new ComputeEngine();
    const { diagnostics } = executeEpsil(
      ce,
      `function bump(n: integer) { n + 1 }\nbump([1, "b", 3])\n99`
    );
    const runtime = diagnostics.filter((x) => x.message[0] === 'runtime-error');
    expect(runtime).toHaveLength(1);
    expect(runtime[0].message[2]).toBe(
      'while applying bump element-wise over 3 elements (element 2)'
    );
  });

  test('a thrown element failure surfaces as an error VALUE with the context', () => {
    const ce = new ComputeEngine();
    withBoom(ce);
    const { value } = executeEpsil(
      ce,
      `function pick(c) { Boom(c) }\npick([1, 2, 3, 4])`
    );
    expect(value.toString()).toContain(
      `while applying 'pick' element-wise over 4 elements (element 1)`
    );
  });
});

describe('BROADCAST ERROR CONTEXT — nothing else moves', () => {
  test('a successful broadcast is unchanged', () => {
    const ce = new ComputeEngine();
    withBump(ce);
    const result = ce.box(['bump', ['List', 1, 2, 3]]).evaluate();
    expect(result.json).toEqual(['List', 2, 3, 4]);
    expect(result.toString()).toBe('[2,3,4]');
  });

  test('an ordinary (non-broadcast) error keeps its historical shape aside from the site operand', () => {
    const ce = new ComputeEngine();
    const err = ce.box(['Sin', ['Add', { str: 'a' }, 1]]).evaluate();
    expect(err.json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
      "'a'",
      ['ErrorTrace', ['ErrorFrame', "'Add'", 1], ['ErrorFrame', "'Sin'", 1]],
    ]);
    expect(err.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"), "a")'
    );
    expect(broadcastFrames(err)).toEqual([]);
  });

  test('a BUILTIN broadcast keeps its historical errors', () => {
    const ce = new ComputeEngine();
    // `Sin` is `broadcastable` but not a lambda: step 4b must not annotate it.
    const result = ce.box(['Sin', ['List', 0, { str: 'a' }]]).evaluate();
    expect(JSON.stringify(result.json)).not.toContain('ErrorBroadcast');
  });

  test('a malformed `ErrorBroadcast` entry is skipped, not half-read', () => {
    const ce = new ComputeEngine();
    // Hand-built (a host could hand us any MathJSON): the `length` operand is
    // missing, so the frame cannot be reported as `length: undefined` behind a
    // `number` type ("over undefined elements").
    const err = ce._fn(
      'Error',
      [
        ce._fn('ErrorCode', [ce.string('incompatible-type')], {
          canonical: false,
        }),
        ce._fn(
          'ErrorTrace',
          [
            ce._fn('ErrorBroadcast', [ce.string('f'), ce.number(1)], {
              canonical: false,
            }),
          ],
          { canonical: false }
        ),
      ],
      { canonical: false }
    );
    expect(broadcastFrames(err)).toEqual([]);
    // Serialization still works, and reports no element-wise context.
    expect(err.toString()).toBe('Error(ErrorCode("incompatible-type"))');
  });

  test('`errorFrames()` ignores the broadcast entry', () => {
    const ce = new ComputeEngine();
    withBump(ce);
    const err = ce.box(['bump', ['List', { str: 'a' }]]).evaluate().op1.ops![1];
    expect(errorFrames(err)).toEqual([]);
    expect(broadcastFrames(err)).toEqual([
      { operator: 'bump', index: 1, length: 1 },
    ]);
  });
});
