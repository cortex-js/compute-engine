// Regression tests for the Rubi translator toolchain
// (scripts/rubi/wl-parser.ts + scripts/rubi/extract-rules.ts).
// Self-contained: inline WL sources only, no dependency on a local Rubi
// snapshot. See docs/rubi/RUBI.md.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseWL } from '../../scripts/rubi/wl-parser';
import { extractRules, stripComments } from '../../scripts/rubi/extract-rules';

describe('WL InputForm parser', () => {
  test('arithmetic precedence and associativity', () => {
    expect(parseWL('a + b*c')).toEqual(['Add', 'a', ['Multiply', 'b', 'c']]);
    // ^ is right-associative; unary minus binds looser than ^
    expect(parseWL('a^b^c')).toEqual(['Power', 'a', ['Power', 'b', 'c']]);
    expect(parseWL('-x^2')).toEqual(['Negate', ['Power', 'x', 2]]);
    // a/b*c is (a/b)*c
    expect(parseWL('a/b*c')).toEqual(['Multiply', ['Divide', 'a', 'b'], 'c']);
    expect(parseWL('2/3')).toEqual(['Rational', 2, 3]);
  });

  test('juxtaposition is multiplication', () => {
    expect(parseWL('2 x')).toEqual(['Multiply', 2, 'x']);
    expect(parseWL('a (b + c)')).toEqual(['Multiply', 'a', ['Add', 'b', 'c']]);
  });

  test('head and symbol mapping', () => {
    expect(parseWL('Log[x]')).toEqual(['Ln', 'x']);
    expect(parseWL('Log[b, x]')).toEqual(['Log', 'x', 'b']);
    expect(parseWL('ArcTan[x]')).toEqual(['Arctan', 'x']);
    expect(parseWL('E^x')).toEqual(['Power', 'ExponentialE', 'x']);
    // lowercase parameters that collide with CE built-ins are renamed
    expect(parseWL('e + i')).toEqual(['Add', 'e_var', 'i_var']);
    // unknown heads pass through
    expect(parseWL('Hypergeometric2F1[a, b, c, x]')).toEqual([
      'Hypergeometric2F1',
      'a',
      'b',
      'c',
      'x',
    ]);
  });

  test('patterns', () => {
    expect(parseWL('a_')).toEqual(['Blank', 'a']);
    expect(parseWL('a_.')).toEqual(['BlankOptional', 'a']);
    expect(parseWL('x_Symbol')).toEqual(['Blank', 'x', 'Symbol']);
    expect(parseWL('u_')).toEqual(['Blank', 'u']);
    expect(parseWL('_')).toEqual(['Blank', '']);
    expect(parseWL('(a_+b_.*x_)^m_.')).toEqual([
      'Power',
      [
        'Add',
        ['Blank', 'a'],
        ['Multiply', ['BlankOptional', 'b'], ['Blank', 'x']],
      ],
      ['BlankOptional', 'm'],
    ]);
    // pattern names go through the same collision renaming
    expect(parseWL('e_.')).toEqual(['BlankOptional', 'e_var']);
  });

  test('rule-level operators', () => {
    expect(parseWL('f[x_] := x /; FreeQ[a, x] && NeQ[m, -1]')).toEqual([
      'SetDelayed',
      ['f', ['Blank', 'x']],
      ['Condition', 'x', ['And', ['FreeQ', 'a', 'x'], ['NeQ', 'm', -1]]],
    ]);
    expect(parseWL('a || b && c')).toEqual(['Or', 'a', ['And', 'b', 'c']]);
    expect(parseWL('v=!=u')).toEqual(['UnsameQ', 'v', 'u']);
    expect(parseWL('!IntegerQ[m]')).toEqual(['Not', ['IntegerQ', 'm']]);
    expect(parseWL('m != -1')).toEqual(['Unequal', 'm', -1]);
  });

  test('\\[Star], Part, derivative marks, strings, trailing-dot reals', () => {
    expect(parseWL('a \\[Star] Int[u, x]')).toEqual([
      'Multiply',
      'a',
      ['Int', 'u', 'x'],
    ]);
    expect(parseWL('lst[[2]]')).toEqual(['Part', 'lst', 2]);
    expect(parseWL("F'[x]")).toEqual([[['Derivative', 1], 'F'], 'x']);
    expect(parseWL('"hello"')).toEqual(['Str', 'hello']);
    expect(parseWL('x_^2.')).toEqual(['Power', ['Blank', 'x'], 2]);
  });

  test('nested comments are skipped', () => {
    expect(parseWL('1 + (* outer (* inner *) still out *) 2')).toEqual([
      'Add',
      1,
      2,
    ]);
  });
});

describe('rule extractor', () => {
  function extractFromSource(src: string) {
    const dir = mkdtempSync(join(tmpdir(), 'rubi-test-'));
    const file = join(dir, 'rules.m');
    writeFileSync(file, src);
    try {
      return extractRules(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('plain rule with condition', () => {
    const { rules, errors } = extractFromSource(`
(* ::Code:: *)
Int[(a_+b_.*x_)^m_,x_Symbol] :=
  (a+b*x)^(m+1)/(b*(m+1)) /;
FreeQ[{a,b,m},x] && NeQ[m,-1]
`);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    const r = rules[0];
    expect(r.variable).toBe('x');
    expect(r.scoped).toBeNull();
    expect(r.condition?.[0]).toBe('And');
    expect(r.rhs[0]).toBe('Divide');
  });

  test('With rule with inner condition', () => {
    const { rules, errors } = extractFromSource(`
Int[1/(a_+b_.*x_^3),x_Symbol] :=
  With[{r=Numerator[Rt[a/b,3]], s=Denominator[Rt[a/b,3]]},
  r/(3*a) \\[Star] Int[1/(r+s*x),x] /;
 Not[FalseQ[r]]] /;
FreeQ[{a,b},x] && PosQ[a/b]
`);
    expect(errors).toEqual([]);
    const r = rules[0];
    expect(r.scoped).toBe('with');
    expect(r.bindings.map((b) => b.name)).toEqual(['r', 's']);
    expect(r.innerCondition).toEqual(['Not', ['FalseQ', 'r']]);
    expect(r.condition?.[0]).toBe('And');
  });

  test('upstream correction: 1.1.3.6 f/e^n → f/g^n', () => {
    // Rubi 4.17.3.0 rule 1.1.3.6 #19/#20 write the split coefficient as f/e^n,
    // but the math is f/g^n (g is the coefficient of (g·x)^m). The corpus is
    // corrected in extract-rules.ts/applyUpstreamCorrections — keyed by the
    // file path, so the temp file must carry the 1.1.3.6 name.
    const dir = mkdtempSync(join(tmpdir(), 'rubi-test-'));
    const file = join(dir, '1.1.3.6 (g x)^m (a+b x^n)^p (c+d x^n)^q (e+f x^n)^r.m');
    writeFileSync(
      file,
      `
Int[(g_.*x_)^m_.*(a_+b_.*x_^n_)^p_.*(c_+d_.*x_^n_)^q_.*(e_+f_.*x_^n_),x_Symbol] :=
  e \\[Star] Int[(g*x)^m*(a+b*x^n)^p*(c+d*x^n)^q,x] +
  f/e^n \\[Star] Int[(g*x)^(m+n)*(a+b*x^n)^p*(c+d*x^n)^q,x] /;
FreeQ[{a,b,c,d,e,f,g,m,p,q},x] && IGtQ[n,0]
`
    );
    try {
      const { rules } = extractRules(file);
      const rhs = JSON.stringify(rules[0].rhs);
      // corrected to f/g^n, no residual f/e^n
      expect(rhs).toContain('["Divide","f",["Power","g","n"]]');
      expect(rhs).not.toContain('e_var","n"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('commented-out rules are dropped; order is preserved', () => {
    const { rules } = extractFromSource(`
Int[1/x_,x_Symbol] := Log[x]

(* Int[old_,x_Symbol] := dropped *)

Int[x_^m_.,x_Symbol] := x^(m+1)/(m+1) /; FreeQ[m,x] && NeQ[m,-1]
`);
    expect(rules.map((r) => r.index)).toEqual([1, 2]);
    expect(rules[0].rhs).toEqual(['Ln', 'x']);
  });

  test('rules split by internal blank lines are re-merged', () => {
    const { rules, errors } = extractFromSource(`
Int[1/(a_+b_.*x_^2),x_Symbol] :=

  ArcTan[x]/b /;
FreeQ[{a,b},x]
`);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
  });

  test('$LoadShowSteps cells keep the plain definition', () => {
    const { rules, errors } = extractFromSource(`
If[TrueQ[$LoadShowSteps],

Int[u_,x_Symbol] :=
  ShowStep["","Int[a*u,x]","a*Integrate[u,x]",Hold[
  IntSum[u,x]]] /;
SimplifyFlag && SumQ[u],

Int[u_,x_Symbol] :=
  IntSum[u,x] /;
SumQ[u]]
`);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0].rhs).toEqual(['IntSum', 'u', 'x']);
    expect(rules[0].condition).toEqual(['SumQ', 'u']);
  });

  test('stripComments preserves cell structure', () => {
    expect(stripComments('a (* x (* y *) z *) b')).toBe('a  b');
    expect(stripComments('a\n(* line\nline *)\nb')).toBe('a\n\n\nb');
  });
});
