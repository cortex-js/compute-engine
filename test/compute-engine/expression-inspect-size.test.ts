import assert from 'node:assert';
import { inspect } from 'node:util';
import {
  ComputeEngine,
  compile,
  type Expression,
} from '../../src/compute-engine';

// CE-1650. `node:assert` writes the message of a failed comparison with
// `util.inspect` and `customInspect: false`, at depth 1000: it walks the own
// enumerable properties and the entries of each Map and Set. An expression
// must not reach its engine, a scope or a definition on that walk, or the
// message of a failed assertion on an expression uses all the memory.

/** The path from `root` to the engine `target` or to a scope (an object
 * with a `bindings` Map) through own enumerable properties and the entries
 * of each Map and Set, as `util.inspect` walks them, or `undefined` when
 * there is none. */
function pathTo(root: unknown, target: object): string | undefined {
  const seen = new Set<unknown>();
  const queue: [unknown, string][] = [[root, 'expr']];
  for (let i = 0; i < queue.length; i++) {
    const [node, path] = queue[i];
    if (node === target) return path;
    if (node === null || typeof node !== 'object' || seen.has(node)) continue;
    if ((node as { bindings?: unknown }).bindings instanceof Map) return path;
    seen.add(node);
    if (node instanceof Map)
      for (const [k, v] of node)
        queue.push([k, `${path}.<key>`], [v, `${path}.<value>`]);
    else if (node instanceof Set)
      for (const v of node) queue.push([v, `${path}.<item>`]);
    for (const key of Object.keys(node))
      queue.push([(node as Record<string, unknown>)[key], `${path}.${key}`]);
  }
  return undefined;
}

function exercise(expr: Expression): void {
  void expr.type;
  void expr.isPure;
  void expr.toString();
  expr.evaluate();
  expr.N();
  expr.simplify();
}

describe('A failed assertion on an expression does not walk the engine', () => {
  const ce = new ComputeEngine();
  ce.declare('A', 'real');
  ce.declare('f', 'function');
  const inputs: Record<string, () => Expression> = {
    'a sum with a declared symbol': () => ce.expr(['Add', 'A', 'x']),
    'a declared symbol': () => ce.expr('A'),
    'a free symbol': () => ce.expr('y'),
    'an integer': () => ce.expr(3),
    'a rational': () => ce.expr(['Rational', 1, 3]),
    'a string': () => ce.expr({ str: 'hi' }),
    'a matrix': () => ce.expr(['List', ['List', 1, 2], ['List', 3, 4]]),
    'a dictionary': () => ce.expr(['Dictionary', ['Tuple', { str: 'a' }, 1]]),
    'a function literal': () => ce.expr(['Function', ['Add', 'y', 1], 'y']),
    'a sum over an index': () =>
      ce.expr(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 10]]),
    'a block with a local': () =>
      ce.expr([
        'Block',
        ['Declare', 'z', "'real'"],
        ['Assign', 'z', 3],
        ['Multiply', 'z', 2],
      ]),
    'a call of a declared function': () => ce.expr(['f', 'x']),
    'a call whose head is declared after the call': () => {
      const expr = ce.expr(['g', 'x']);
      ce.declare('g', 'function');
      ce.assign('g', ce.expr(['Function', ['Multiply', 'u', 2], 'u']));
      return expr;
    },
    'a map over a list': () =>
      ce.expr(['Map', ['List', 1, 2], ['Function', ['Add', 'y', 1], 'y']]),
    'an error': () => ce.expr(['Error', "'missing'"]),
    'a parsed expression': () => ce.parse('x^2+\\sin(y)'),
    'an expression in a scope': () => {
      const scope = ce.createScope();
      return ce.expr(['Add', 'w', 1], { scope });
    },
    'a compiled expression': () => {
      const expr = ce.parse('\\sin(x)+A');
      compile(expr);
      return expr;
    },
  };

  for (const [label, make] of Object.entries(inputs)) {
    test(label, () => {
      const expr = make();
      exercise(expr);
      expect(pathTo(expr, ce)).toBeUndefined();

      let message = '';
      try {
        assert.deepStrictEqual(expr, undefined);
      } catch (error) {
        message = String(error);
      }
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThan(100_000);

      const text = inspect(expr, {
        customInspect: false,
        depth: 1000,
        getters: true,
      });
      expect(text.length).toBeLessThan(100_000);
    });
  }
});
