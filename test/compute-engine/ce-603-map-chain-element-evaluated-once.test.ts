import { ComputeEngine } from '../../src/compute-engine';
import {
  isCharacter,
  isFunction,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

// ROADMAP CE-603 (Tycho row 474): an operator applied to a large list is a
// lazy `Map`, and a chain of operators gives a chain of `Map` levels. Each
// element is computed one level at a time (`makeSpineRunner`,
// `library/map-lowering.ts`): the application of a level evaluates its
// operand, which is the value of the level below. That value is a new node,
// so its evaluation walked it again, with all the levels below it: a chain
// of `d` levels evaluated the innermost value `d` times, and `d²/2`
// applications in all. An evaluation whose value is the same call as the
// node that was evaluated (`isSameCall()`: the same operators, operand kinds
// and symbol bindings) now gives that value the memo entry of the node
// (`_primeUnchangedResult`, `boxed-function.ts`), and the value is not
// walked again at the same state.
//
// `q` is a broadcastable operator whose handler counts its calls and leaves
// the call unevaluated, so each element stays symbolic, as
// `|sin(2^n x + k/1000)|` does with `x` free.

function countingEngine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let calls = 0;
  ce.declare('q', {
    signature: '(number) -> number',
    broadcastable: true,
    evaluate: () => {
      calls += 1;
      return undefined;
    },
  });
  ce.declare('x', 'real');
  return { ce, calls: () => calls };
}

describe('CE-603: each level of a Map chain is applied once per element', () => {
  test.each([1, 2, 4, 6])('a chain of %d levels', (depth) => {
    const { ce, calls } = countingEngine();
    let e: unknown = ['Add', 'x', ['Range', 1, 1000]];
    for (let k = 0; k < depth; k++) e = ['q', e];
    const value = ce.box(e as never).evaluate();
    expect(value.operator).toBe('Map');
    const before = calls();
    const elements = [...value.each()];
    expect(elements.length).toBe(1000);
    let expected: unknown = ['Add', 'x', 1];
    for (let k = 0; k < depth; k++) expected = ['q', expected];
    expect(elements[0].json).toEqual(expected);
    // One call per level and per element. It was depth·(depth + 1)/2 per
    // element: 21 for 6 levels.
    expect((calls() - before) / 1000).toBe(depth);
  });

  test('a result that is isSame but holds an operand of another kind is not primed', () => {
    // A character and a one-character string are `isSame`, but a handler
    // can answer differently for each. `q("a")` answers the call
    // `q('a')` with a character operand, which evaluates to `2`. Primed as
    // its own value, it stayed `q("a")`.
    const ce = new ComputeEngine();
    ce.declare('q', {
      signature: '(value) -> value',
      evaluate: ([x]) => {
        if (isString(x)) return ce.function('q', [ce.character('a')]);
        if (isCharacter(x)) return ce.number(2);
        return undefined;
      },
    });
    const r = ce.function('q', [ce.string('a')]).evaluate();
    expect(r.isSame(ce.function('q', [ce.string('a')]))).toBe(true);
    expect(r.evaluate().toString()).toBe('2');
  });

  test('a result whose symbol is bound to another definition is not primed', () => {
    // The handler answers `q(x)` with an `x` declared in a scope of its
    // own, and `2` for that `x`. The result must be evaluated again.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const outer = ce.symbol('x');
    const outerDef = outer.valueDefinition;
    ce.declare('q', {
      signature: '(real) -> real',
      evaluate: ([a]) => {
        if (!isSymbol(a)) return undefined;
        if (a.valueDefinition !== outerDef) return ce.number(2);
        ce.pushScope();
        try {
          ce.declare('x', 'real');
          return ce.function('q', [ce.symbol('x')]);
        } finally {
          ce.popScope();
        }
      },
    });
    const r = ce.function('q', [outer]).evaluate();
    expect(r.toString()).toBe('q(x)');
    expect(r.evaluate().toString()).toBe('2');
  });

  test('a result whose call is bound to another function value is not primed', () => {
    // `h` is a function-typed symbol with no value, so `h(1)` is bound to a
    // VALUE definition and has no operator definition. The handler answers
    // `q(h(1))` with an `h` declared in a scope of its own: the result is
    // `isSame` as the node, but its call is bound to another definition, so
    // it is not the same call, and its next evaluation runs the handler.
    // This test also passes without the value-definition test of
    // `isSameCall()`: a call to a function with no value is impure, so the
    // node that holds it gets no memo entry and nothing is primed (measured
    // 2026-10-28). It guards the result if that purity rule changes.
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    const outerCall = ce.function('h', [ce.number(1)]);
    const outerDef = outerCall.valueDefinition;
    expect(outerDef).toBeDefined();
    // The inner `h(1)` is made before the evaluation: a declaration during
    // the evaluation would advance the generation, and the memo entry of the
    // node would then be outdated as soon as it is stored, so nothing would
    // be primed and the test would not see the binding.
    ce.pushScope();
    ce.declare('h', 'function');
    const innerCall = ce.function('h', [ce.number(1)]);
    ce.popScope();
    expect(innerCall.valueDefinition).not.toBe(outerDef);
    let calls = 0;
    ce.declare('q', {
      signature: '(any) -> any',
      evaluate: ([a]) => {
        calls += 1;
        if (!isFunction(a, 'h')) return undefined;
        if (a.valueDefinition !== outerDef) return ce.number(2);
        return ce.function('q', [innerCall]);
      },
    });
    const r = ce.function('q', [outerCall]).evaluate();
    expect(r.isSame(ce.function('q', [outerCall]))).toBe(true);
    expect(isFunction(r) && r.op1.valueDefinition !== outerDef).toBe(true);
    expect(calls).toBe(1);
    r.evaluate();
    // It was 1: the result was primed with the entry of the node.
    expect(calls).toBe(2);
  });

  test('the comparison of a shared graph visits each pair of nodes once', () => {
    // `e = q(e, e)` built 40 levels deep has 41 distinct nodes and 2⁴⁰
    // paths. `q` declines, so each result is the same call as its node,
    // and the comparison of the two (`isSameCall()`) must not follow every
    // path: without its memo of compared pairs, the evaluation took 0.3 s
    // at 20 levels and 5 s at 24 (measured 2026-10-28), so 40 levels would
    // not end within the test timeout. `isSame()` is not used here: it
    // follows every path too.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('q', {
      signature: '(any, any) -> any',
      evaluate: () => {
        calls += 1;
        return undefined;
      },
    });
    ce.declare('x', 'real');
    let e = ce.symbol('x');
    for (let k = 0; k < 40; k++) e = ce.function('q', [e, e]);
    const r = e.evaluate();
    expect(r.operator).toBe('q');
    // The result shares its subtrees as the node does.
    expect(isFunction(r) && r.op1 === r.op2).toBe(true);
    // Each distinct node is evaluated once: its second mention answers from
    // its memo.
    expect(calls).toBe(40);
    // The result received the entry of the node: evaluating it again runs
    // no handler.
    r.evaluate();
    expect(calls).toBe(40);
  });

  test('the elements of the Tycho case are the evaluated member sums', () => {
    const ce = new ComputeEngine();
    const value = ce
      .parse(
        String.raw`\sum_{n=0}^{3}\frac{1}{2^n}\operatorname{abs}\left(\sin\left(2^nx+\frac{[0...99]}{100}\right)\right)`
      )
      .evaluate();
    const elements = [...value.each()];
    expect(elements.length).toBe(100);
    for (const k of [0, 1, 37, 99]) {
      const member = ce
        .box([
          'Sum',
          [
            'Multiply',
            [
              'Abs',
              [
                'Sin',
                ['Add', ['Multiply', 'x', ['Power', 2, 'n']], ['Rational', k, 100]],
              ],
            ],
            ['Power', 2, ['Negate', 'n']],
          ],
          ['Limits', 'n', 0, 3],
        ])
        .evaluate();
      expect(elements[k].json).toEqual(member.json);
    }
  });
});
