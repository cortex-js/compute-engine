import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The presence assertion `x?!` (`AssertPresent(x)`, decision P4 of
// `docs/plans/2026-10-21-presence-contracts-and-assertion.md`): the value of
// `x`, or an `expected-present` error when `x` is absent. Postfix at the
// factorial's precedence; `⁈` (U+2048) is an alias. The static check accepts
// an asserted read at a parameter that excludes absence, because the
// assertion's type is the present part of the operand's type.
//

function run(source: string): { value: string; diagnostics: string[] } {
  const r = executeEpsil(new ComputeEngine(), source);
  return {
    value: r.value.toString(),
    diagnostics: r.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join(' ') : String(d.message)
    ),
  };
}

function roundTrip(source: string): string {
  const [ast, diags] = parseEpsil(source);
  expect(diags).toEqual([]);
  return serializeEpsil(ast!);
}

const XS = 'let xs: list<string> = ["a"]\n';

describe('x?! — parsing and serialization', () => {
  test('postfix on an access, a field and a symbol', () => {
    expect(roundTrip('xs[i]?!')).toBe('xs[i]?!');
    expect(roundTrip('p.x?!')).toBe('p.x?!');
    expect(roundTrip('x?!')).toBe('x?!');
  });

  test('binds tighter than the infix operators', () => {
    expect(roundTrip('-x?!')).toBe('-x?!');
    expect(roundTrip('2 ^ x?!')).toBe('2 ^ x?!');
    const [ast] = parseEpsil('x?! + 1');
    expect(JSON.stringify(ast)).toContain('"AssertPresent"');
  });

  test('a postfix operand is parenthesized, never glued', () => {
    expect(roundTrip('(n!)?!')).toBe('(n!)?!');
    expect(roundTrip('(x?!)!')).toBe('(x?!)!');
  });

  test('the MathJSON spelling serializes to the operator', () => {
    const [ast] = parseEpsil('AssertPresent(xs[1])');
    expect(serializeEpsil(ast!)).toBe('xs[1]?!');
  });

  test('`⁈` is an alias of `?!`', () => {
    expect(roundTrip('x⁈')).toBe('x?!');
  });

  test('must abut its operand; an operator run is one token, as for `!`', () => {
    const spaced = run('let x = 2\nx ?!');
    expect(spaced.diagnostics.join(' ')).toContain('unexpected-symbol');
    const glued = run('let x = 2\nx?!+1');
    expect(glued.diagnostics.join(' ')).toContain('?!+');
    expect(run('let x = 2\nx?! + 1').value).toBe('3');
  });
});

describe('x?! — evaluation', () => {
  test('a present read is the value', () => {
    expect(run(`${XS}let i: integer = 1\nxs[i]?!`).value).toBe('"a"');
  });

  test('an absent read is an `expected-present` error naming the read', () => {
    const r = run(`${XS}let i: integer = 3\nxs[i]?!`);
    expect(r.value).toBe('Error("expected-present", "At(\\"xs\\", i)")');
    expect(r.diagnostics).toEqual([]);
  });

  test('NaN and an indeterminate form fail; Nothing passes through', () => {
    expect(run('NaN?!').value).toContain('expected-present');
    expect(run('(0/0)?!').value).toContain('expected-present');
    expect(run('[1, Nothing?!, 2]').value).toBe('[1,2]');
  });

  test('an error operand propagates unchanged', () => {
    expect(run('RuntimeError("boom")?!').value).toBe('Error("boom")');
  });
});

describe('x?! — the static check', () => {
  const F = 'function f(p: string) { p }\n';

  test('a possibly absent read at a strict parameter is reported without it', () => {
    const r = run(`${F}${XS}let i: integer = 1\nf(xs[i])`);
    expect(r.diagnostics.join(' ')).toContain('missing | string');
  });

  test('the asserted read is accepted', () => {
    const r = run(`${F}${XS}let i: integer = 1\nf(xs[i]?!)`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('"a"');
  });

  test('the asserted read fails at run time when absent', () => {
    const r = run(`${F}${XS}let i: integer = 3\nf(xs[i]?!)`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toContain('expected-present');
  });

  test('a typed declaration accepts the asserted read', () => {
    const r = run(`${XS}let i: integer = 1\nlet y: string = xs[i]?!\ny`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('"a"');
  });
});
