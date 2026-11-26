import { ComputeEngine } from '../../src/compute-engine';
import {
  implicitVariableCandidates,
  implicitVariableCandidatesAsWritten,
} from '../../src/compute-engine/boxed-expression/implicit-variable-rule';
import { binderSitesOf, parseEpsil } from '../../src/epsil';
import { documentBindings } from '../../src/epsil/occurrences';
import { operand } from '../../src/math-json/utils';

// A symbol that holds a formula is not a candidate for the implicit variable
// of a calculus operator whose variable is not written: the candidates of
// its formula are (`implicitVariableCandidates()`, `docs/SCOPING-MODEL.md`,
// "The variable of a formula"). With `G := sin(x)`, the variable of `2G` is
// `x`, not `G`.

const ONE_MINUS_COS_1 = 1 - Math.cos(1);

function engineWithG(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('G', ce.parse('\\sin(x)'));
  return ce;
}

describe('A formula that reads a symbol that holds a formula', () => {
  test('ND, NLimit and NIntegrate with no variable written', () => {
    const ce = engineWithG();
    expect(
      ce.expr(['ND', ['Multiply', 2, 'G'], 1]).evaluate().re
    ).toBeCloseTo(2 * Math.cos(1), 8);
    expect(
      ce.expr(['NLimit', ['Add', 'G', 1], 0]).evaluate().re
    ).toBeCloseTo(1, 10);
    expect(
      ce.expr(['NIntegrate', ['Multiply', 2, 'G'], 0, 1]).evaluate().re
    ).toBeCloseTo(2 * ONE_MINUS_COS_1, 10);
  });

  test('Limit with no variable written', () => {
    const ce = engineWithG();
    // sin(x)/x → 1 as x → 0. With the variable `G`, the limit was 0.
    const limit = ce.expr(['Limit', ['Divide', 'G', 'x'], 0]);
    expect(limit.json).toEqual([
      'Limit',
      ['Function', ['Block', ['Divide', 'G', 'x']], 'x'],
      0,
    ]);
    expect(limit.evaluate().re).toBe(1);
  });

  test('definite integral with no variable written', () => {
    const ce = engineWithG();
    const integral = ce.parse('\\int_0^1 G + x');
    expect(integral.json).toEqual([
      'Integrate',
      ['Function', ['Block', ['Add', 'G', 'x']], 'x'],
      ['Limits', 'Nothing', 0, 1],
    ]);
    expect(integral.evaluate().toString()).toBe('3/2 - cos(1)');
    expect(integral.N().re).toBeCloseTo(1.5 - Math.cos(1), 12);
  });

  test('indefinite integral with no variable written', () => {
    const ce = engineWithG();
    expect(ce.parse('\\int G + x').evaluate().toString()).toBe(
      '1/2 * x^2 - cos(x)'
    );
  });

  test('D and Series with no variable written', () => {
    const ce = engineWithG();
    expect(ce.expr(['D', ['Power', 'G', 2]]).evaluate().toString()).toBe(
      '2sin(x) * cos(x)'
    );
    expect(ce.expr(['Series', ['Power', 'G', 2]]).json).toEqual([
      'Series',
      ['Power', 'G', 2],
      'x',
      0,
      5,
    ]);
  });

  test('a lone symbol whose formula reads a symbol that holds a formula', () => {
    const ce = engineWithG();
    ce.assign('H', ce.parse('G + x'));
    expect(ce.parse('\\int_0^1 H').evaluate().toString()).toBe('3/2 - cos(1)');
    expect(ce.parse('\\int_0^1 2H').N().re).toBeCloseTo(
      3 - 2 * Math.cos(1),
      12
    );
  });

  test('a literal with a written parameter and a limit that names none', () => {
    // The formula of `G` is read in the parameter `x`, and the integral with
    // the formula in place keeps `x` as its variable: its candidates are `a`
    // and `x`, and `a` is first in sorted order.
    const ce = engineWithG();
    const integral = ce.expr([
      'Integrate',
      ['Function', ['Add', 'G', 'a'], 'x'],
      ['Limits', 'Nothing', 0, 1],
    ]);
    expect(integral.evaluate().toString()).toBe('a + 1 - cos(1)');
  });

  test('the other symbols of the formula stay candidates', () => {
    const ce = engineWithG();
    // `t` comes before `x` in sorted order.
    expect(ce.parse('\\int_0^1 G t').evaluate().toString()).toBe(
      '1/2 * sin(x)'
    );
  });

  test('the canonical and the non-canonical form bind the same variable', () => {
    const ce = engineWithG();
    const canonical = ce.parse('\\int_0^1 G + x');
    const raw = ce.parse('\\int_0^1 G + x', { form: 'raw' });
    expect(canonical.freeVariables).toEqual([]);
    expect(raw.freeVariables).toEqual([]);
    expect(raw.subs({ x: 3 }).isSame(raw)).toBe(true);
  });
});

describe('The candidates of the implicit variable', () => {
  test('a symbol that holds a formula gives the candidates of the formula', () => {
    const ce = engineWithG();
    expect(implicitVariableCandidates(ce.parse('2G'))).toEqual(['x']);
    expect(implicitVariableCandidates(ce.parse('G + t'))).toEqual(['t', 'x']);
  });

  test('a formula that reads a symbol that holds a formula', () => {
    const ce = engineWithG();
    ce.assign('K', ce.parse('G + 1'));
    expect(implicitVariableCandidates(ce.parse('K'))).toEqual(['x']);
    // `G` is read in `K` and in the expression.
    expect(implicitVariableCandidates(ce.parse('G + K'))).toEqual(['x']);
  });

  test('a symbol that holds a number stays a candidate', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 4);
    ce.assign('c', 5);
    expect(implicitVariableCandidates(ce.parse('c x'))).toEqual(['c', 'x']);
    // The formula `2c` has the candidate `c`.
    ce.assign('M', ce.parse('2c'));
    expect(implicitVariableCandidates(ce.parse('M + t'))).toEqual(['c', 't']);
  });

  test('a value that reaches its own symbol again ends', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ce.parse('Q + 1'));
    ce.assign('Q', ce.parse('P + 1'));
    expect(implicitVariableCandidates(ce.parse('P x'))).toEqual(['P', 'x']);
    ce.assign('A', ce.parse('B'));
    ce.assign('B', ce.parse('A'));
    expect(implicitVariableCandidates(ce.parse('A x'))).toEqual(['A', 'x']);
  });

  test('a formula that many formulas read is read once', () => {
    // `K60` reads `K59` and `K58`, which read `K58` and `K57`, and so on:
    // read once for each path, the candidates would not end.
    const ce = engineWithG();
    ce.assign('K0', ce.parse('\\sin(x)'));
    ce.assign('K1', ce.parse('\\cos(t)'));
    for (let i = 2; i <= 60; i++)
      ce.assign(`K${i}`, ce.expr(['Add', `K${i - 1}`, `K${i - 2}`]));
    expect(implicitVariableCandidates(ce.expr(['Multiply', 2, 'K60']))).toEqual(
      ['t', 'x']
    );
  });

  test('without the read of the formulas, the symbol is the candidate', () => {
    const ce = engineWithG();
    expect(implicitVariableCandidatesAsWritten(ce.parse('G + t'))).toEqual([
      'G',
      't',
    ]);
  });

  test('a bare symbol with a limit that names a variable is the variable', () => {
    // The lone symbol is read as its formula only when no limit names a
    // variable. Here `G` is the variable of the first limit.
    const ce = engineWithG();
    const integral = ce.expr([
      'Integrate',
      'G',
      ['Limits', 'Nothing', 0, 1],
      ['Limits', 'y', 0, 1],
    ]);
    expect(integral.evaluate().toString()).toBe('1/2');
  });
});

describe('The implicit variable of an Epsil call', () => {
  test('a name that holds a formula in the engine is not the variable', () => {
    const ce = engineWithG();
    const sitesOf = (source: string) => {
      const [program] = parseEpsil(source);
      return binderSitesOf(ce, operand(program, 1)!, source);
    };
    expect(sitesOf('limit(2*G + h, 0)')).toEqual([
      { name: 'h', operands: [0] },
    ]);
    // The engine chooses `x`, which the call does not write: no site.
    expect(sitesOf('limit(2*G, 0)')).toEqual([]);
  });

  test('a name that the program binds is not read as the formula', () => {
    // `G` is the parameter of `f`, not the symbol of the engine. It is the
    // first candidate and its value is not known, so the call binds no name.
    // With the formula read, the candidates were `h` and `x`, and the site
    // was `h`.
    const ce = engineWithG();
    const source = 'function f(G) { limit(G*h, 0) }';
    const [ast] = parseEpsil(source);
    let sites: unknown;
    documentBindings(ast, source, {
      binderSites: (node, isBound, declarationOf) => {
        const result = binderSitesOf(
          ce,
          node,
          source,
          undefined,
          isBound,
          declarationOf
        );
        if ((node as { fn?: unknown[] }).fn?.[0] === 'limit') sites = result;
        return result;
      },
    });
    expect(sites).toEqual([]);
  });
});
