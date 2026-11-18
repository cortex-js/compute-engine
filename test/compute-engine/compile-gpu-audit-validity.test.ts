import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const source = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

describe.each(['glsl'] as const)('%s emitted shader validity', (to) => {
  test.each(['Sum', 'Product'])(
    '%s lowers a block term to a scoped compound statement and rejects a Return term',
    (head) => {
      for (const upper of [3, 153, 'N']) {
        for (const cse of [false, true]) {
          for (const body of [
            ['Block', 'j'],
            ['Block', ['Declare', 'a', "'unknown'", ['Square', 'j']], 'a'],
            ['Return', 'j'],
          ] as MathJsonExpression[]) {
            const ce = new ComputeEngine();
            ce.declare('N', 'real');
            const expr = ce.expr([head, body, ['Limits', 'j', 1, upper]]);
            // A `Return` term is the `return-in-expression-body` error when
            // the expression is boxed (ROADMAP CE-96), so the compiler refuses
            // an invalid expression.
            if (Array.isArray(body) && body[0] === 'Return') {
              expect(expr.isValid).toBe(false);
              const r = compile(expr, { to, constantFold: false, cse });
              expect(r.success).toBe(false);
              continue;
            }
            expect(expr.isValid).toBe(true);
            const r = compile(expr, { to, constantFold: false, cse });
            expect(r.success).toBe(true);
            const code = source(r);
            // No statement spliced into a value position, no `return` in a
            // loop body (the shape the 0.128.9 corpus audit found).
            expect(code).not.toMatch(
              /[+*]?=\s*(?:return\b|(?:float|var|let)\s+[A-Za-z_]\w*\s*[;=:])/
            );
            expect(code).not.toContain(';;');
            if (upper !== 'N') {
              // JavaScript agrees with the interpreter.
              const js = compile(expr);
              // Within the precision of a double: a product of 153 factors
              // rounds at each step.
              const expected = expr.N().re;
              const value = js.run!({}) as number;
              if (Number.isFinite(expected))
                expect(Math.abs(value - expected)).toBeLessThanOrEqual(
                  1e-13 * Math.abs(expected)
                );
              else expect(value).toBe(expected);
            }
          }
        }
      }
    }
  );

  test('generated names are legal and remain distinct after normalization', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const names = ['a__b', 'a_b', 'α', 'β', 'tail_', 'tail__'];
    names.forEach((name, i) => {
      ce.declare(name, 'function');
      ce.assign(name, ce.expr(['Function', ['Add', 't', i + 1], 't']));
    });
    const expr = ce.expr(['Add', ...names.map((name) => [name, 'x'])]);
    const r = compile(expr, { to, constantFold: false });
    expect(r.success).toBe(true);
    const declarations = [
      ...(r.preamble ?? '').matchAll(/float (_fn_?\w*)\(/g),
    ].map((m) => m[1]);
    expect(declarations).toHaveLength(names.length);
    expect(new Set(declarations).size).toBe(names.length);
    expect(
      declarations.every((name) => !name.includes('__') && !name.includes('$'))
    ).toBe(true);
    for (const name of declarations) expect(r.code).toContain(`${name}(`);
  });
});
