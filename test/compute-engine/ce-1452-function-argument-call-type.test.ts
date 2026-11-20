/**
 * CE-1452: a function argument at a parameter that the body uses as a
 * value. `N` is the library function `N`, so `f(j, N)` passes a function.
 * The call binds it, and the body computes with it symbolically: `j[N +
 * [1, 2, 3]]` is a list. The walk of the body typed `N + [1, 2, 3]` as a
 * number and the call as an element of `j`; it now gives no type, and the
 * call keeps the result of the signature (`literalBodyResultType()`,
 * `call-result-type.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('j', {
    type: 'list<integer>',
    value: ce.box(['List', 3, 1, 4, 1, 5]),
  });
  ce.assign(
    'f',
    ce.box([
      'Function',
      ['At', 'a', ['Add', 'b', ['Range', 1, 3]]],
      'a',
      'b',
    ] as any)
  );
  return ce;
}

describe('CE-1452', () => {
  test('a library function as the argument', () => {
    const ce = engine();
    const call = ce.box(['f', 'j', 'N'] as any);
    expect(call.type.toString()).toBe('unknown');
    expect(call.evaluate().type.toString()).toBe('list<integer>');
  });

  test('a declared function as the argument', () => {
    const ce = engine();
    ce.declare('h', '(real) -> real');
    expect(ce.box(['f', 'j', 'h'] as any).type.toString()).toBe('unknown');
  });

  test('a number argument is still typed from the body', () => {
    const ce = engine();
    expect(ce.box(['f', 'j', 2] as any).type.toString()).toBe(
      'list<integer>'
    );
  });

  test('a function passed through keeps its type', () => {
    const ce = new ComputeEngine();
    ce.assign('id', ce.box(['Function', 'g', 'g'] as any));
    expect(ce.box(['id', 'Sin'] as any).type.toString()).toBe(
      ce.box('Sin').type.toString()
    );
  });
});
