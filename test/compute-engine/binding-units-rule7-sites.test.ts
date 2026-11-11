// Rule 7 of `docs/plans/2026-11-09-binding-units-slice-1-spec.md` ("a free
// name is not an unbound symbol"), with the engine flag `_bindingUnits` set
// per engine: sites that read "no definition" as "an unbound symbol" or "not
// a function" read the definition that a free name, a free call head or a
// forward call reference resolves to now.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isFreeCallHead,
  readBinding,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce._bindingUnits = true;
  return ce;
}

/** The first call of `name` in `e`, depth first. */
function callOf(e: Expression, name: string): Expression | undefined {
  if (e.operator === name && e.ops !== undefined) return e;
  for (const op of e.ops ?? []) {
    const found = callOf(op, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('binding units, rule 7 sites', () => {
  test('D of a call with a free head reads a later data declaration of the head', () => {
    const ce = engine();
    const e = ce.box(['D', ['g', 'x'], 'x']);
    expect(isFreeCallHead(e.op1)).toBe(true);
    ce.declare('g', 'real');
    const result = e.evaluate().json as unknown[];
    expect(result[0]).toBe('Error');
    expect(result[1]).toEqual([
      'ErrorCode',
      "'expected-function'",
      "'g'",
      "'real'",
    ]);
  });

  test('a self-call boxed before the assignment reads the function it calls', () => {
    const ce = engine();
    ce.declare('D', 'real');
    ce.assign(
      'F',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Which',
            ['Equal', 'n', ['Add', 'D', -1]],
            ['List', 'n'],
            'True',
            ['Join', ['List', 'n'], ['F', ['Add', 'n', 1]]],
          ],
        ],
        'n',
      ])
    );
    // The call in the stored literal is bound to a forward call reference;
    // `readBinding()` gives the operator definition that `F` holds now.
    const def = ce.lookupDefinition('F');
    expect(def !== undefined && 'operator' in def).toBe(true);
    const literal = (def as { operator: { _lambdaLiteral?: Expression } })
      .operator._lambdaLiteral!;
    const selfCall = callOf(literal.op1, 'F')!;
    const read = readBinding(selfCall);
    expect(read !== undefined && 'operator' in read && read.operator).toBe(
      (def as { operator: unknown }).operator
    );
    // The list-recursion recognizer sees the self-call.
    const r = compile(ce.box(['F', 0]), { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    expect(String(r.preamble)).toContain('_SYS.listRecursion("F"');
    expect((r.run!({ D: 4 }) as number[][]).length).toBe(4);
  });

  test('a telescoping sum over a free call head telescopes', () => {
    const ce = engine();
    expect(
      ce
        .expr([
          'Sum',
          ['Subtract', ['g', ['Add', 'k', 1]], ['g', 'k']],
          ['Tuple', 'k', 0, 'n'],
        ])
        .evaluate().json
    ).toEqual(['Subtract', ['g', ['Add', 'n', 1]], ['g', 0]]);
  });

  test('a free name boxed in the scope of a binder after its canonicalization has the home scope of the body', () => {
    const ce = engine();
    const sum = ce.expr([
      'Sum',
      ['Multiply', 'c', 'k'],
      ['Tuple', 'k', 1, 'n'],
    ]);
    const inBody = callOf(sum, 'Multiply')!.ops!.find((x) => x.symbol === 'c')!;
    // `subs()` in the scope of the `Sum` boxes `c` again.
    const again = ce._inScope(sum.localScope, () => ce.box('c'));
    expect(again.isSame(inBody)).toBe(true);
  });

  test('simplify() of a call with a free head gives a canonical call', () => {
    const ce = engine();
    const call = ce.box(['a', ['Add', 'n', 'n', 1]]);
    expect(isFreeCallHead(call)).toBe(true);
    const simplified = call.simplify();
    expect(simplified.isCanonical).toBe(true);
    expect(isFreeCallHead(simplified)).toBe(true);
    expect(
      ce
        .expr([
          'RSolve',
          ['Equal', ['a', ['Add', 'n', 'n', 1]], ['a', 'n']],
          'a',
          'n',
        ])
        .evaluate().operator
    ).toBe('RSolve');
  });

  test('GroupBy with a free call head as the key reports the unknown function', () => {
    const ce = engine();
    expect(() =>
      ce.box(['GroupBy', ['List', 1, 2, 3, 4], 'Even']).evaluate()
    ).toThrow(/Unknown function "Even"/);
  });
});
