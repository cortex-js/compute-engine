import { ComputeEngine } from '../../src/compute-engine';
import { presentType } from '../../src/common/type/coalesce';
import { isSubtype } from '../../src/common/type/subtype';
import type { Type } from '../../src/common/type/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { expectTypeBetween } from '../utils';

describe('whole-value absence checks and fallbacks', () => {
  test('non-strict arity keeps extra inputs but still requires the first', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    expect(ce.box(['IsMissing', 1, 2]).evaluate().symbol).toBe('False');
    expect(ce.box(['IsMissing', 'Nothing', 2]).evaluate().symbol).toBe('False');
    expect(ce.box(['IsMissing']).evaluate().operator).toBe('Error');
  });

  test.each(['Missing', 'Undefined', 'NaN', 'Indeterminate'])(
    '%s selects a fallback and the final absent operand is retained',
    (marker) => {
      const ce = new ComputeEngine();
      expect(ce.box(['IsMissing', marker]).evaluate().symbol).toBe('True');
      expect(ce.box(['Coalesce', marker, 5]).evaluate().re).toBe(5);
      expect(
        ce
          .box(['Coalesce', 'Missing', marker])
          .evaluate()
          .isSame(ce.box(marker))
      ).toBe(true);
      expect(ce.box(['IsMissing', marker]).N().symbol).toBe('True');
    }
  );

  test('Nothing passes through, whether literal or computed', () => {
    const ce = new ComputeEngine();
    for (const value of [ce.Nothing, ce.box(['If', 'True', 'Nothing', 1])]) {
      expect(ce.function('IsMissing', [value]).evaluate().symbol).toBe('False');
      expect(
        ce.function('Coalesce', [value, ce.number(5)]).evaluate().symbol
      ).toBe('Nothing');
    }
    expect(ce.box(['IsMissing']).evaluate().operator).toBe('Error');
    expect(ce.box(['IsMissing', 1, 2]).evaluate().operator).toBe('Error');
    expect(ce.box(['IsMissing', 'Nothing', 2]).evaluate().operator).toBe(
      'Error'
    );
    expect(ce.box(['IsMissing', 1, 'Nothing']).evaluate().operator).toBe(
      'Error'
    );
    expect(ce.box(['IsMissing', ['Sequence', 1, 2]]).evaluate().operator).toBe(
      'Error'
    );
    // An empty Sequence canonicalizes to Nothing before reaching this operator.
    expect(ce.box(['IsMissing', ['Sequence']]).evaluate().symbol).toBe('False');
    expect(
      ce.box(['IsMissing', ['Sequence', 'Nothing']]).evaluate().symbol
    ).toBe('False');
  });

  test.each([
    ['Divide', 0, 0],
    ['Mean', ['List', 1, 'Indeterminate']],
    ['Max', 1, 'Indeterminate'],
  ])('exact arithmetic remains Indeterminate: %j', (...value) => {
    const ce = new ComputeEngine();
    const expression = ce.box(value);
    expect(expression.evaluate().isIndeterminate).toBe(true);
    expect(ce.function('IsMissing', [expression]).evaluate().symbol).toBe(
      'True'
    );
    expect(
      ce.function('Coalesce', [expression, ce.number(5)]).evaluate().re
    ).toBe(5);
  });

  test('fallbacks remain lazy after a present value or an unresolved operand', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('TraceFallback', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => {
        calls++;
        return ce.number(7);
      },
    });
    expect(
      ce.box(['Coalesce', 'Indeterminate', 3, ['TraceFallback']]).evaluate().re
    ).toBe(3);
    expect(calls).toBe(0);
    expect(
      ce.box(['Coalesce', 'undecided', ['TraceFallback']]).evaluate().operator
    ).toBe('Coalesce');
    expect(calls).toBe(0);
    expect(
      ce.box(['Coalesce', 'Indeterminate', ['TraceFallback']]).evaluate().re
    ).toBe(7);
    expect(calls).toBe(1);
  });

  test('Epsil ?? evaluates an exact indeterminate computation as absent', () => {
    const result = executeEpsil(new ComputeEngine(), '(0 / 0) ?? 5');
    expect(result.diagnostics).toEqual([]);
    expect(result.value.re).toBe(5);
  });
});

describe('successful fallback result types', () => {
  test('open content and aliases exclude only whole-value markers', () => {
    const ce = new ComputeEngine();
    const alias: Type = {
      kind: 'reference',
      name: 'MaybeText',
      alias: true,
      def: ce.type('string | nan').type,
    };
    for (const input of [
      ce.type('any').type,
      ce.type('value').type,
      alias,
      { kind: 'union', types: [alias, 'missing'] } as Type,
    ]) {
      const present = presentType(input);
      expect(isSubtype('nan', present)).toBe(false);
      expect(isSubtype('missing', present)).toBe(false);
      expect(isSubtype('string', present)).toBe(true);
    }
    expect(presentType(ce.type('unknown | missing').type)).toBe('unknown');
    expect(isSubtype('nothing', presentType('any'))).toBe(true);
  });

  test('a demanded failure makes later fallbacks unreachable', () => {
    const ce = new ComputeEngine();
    const failure = ce.box(['RuntimeError', { str: 'absent' }]);
    expect(
      ce.function('Coalesce', [failure, ce.number(5)]).type.toString()
    ).toBe('never');
    expect(
      ce
        .function('Coalesce', [ce.Missing, failure, ce.number(5)])
        .type.toString()
    ).toBe('never');
    ce.declare('text', 'string | missing');
    expectTypeBetween(
      ce.function('Coalesce', [ce.symbol('text'), failure, ce.number(5)]),
      { atMost: 'string' }
    );
    expect(
      deriveApplicationType(ce, 'If', [
        describeType('never'),
        describeType('integer'),
        describeType('integer'),
      ])
    ).toBe('never');
    expect(
      deriveApplicationType(ce, 'Coalesce', [
        describeType('never'),
        describeType('integer'),
      ])
    ).toBe('never');
  });

  test.each(['string | missing', 'string'])(
    '%s with a failing fallback has successful string outcomes',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('text', type);
      const fallback = ce.box(['RuntimeError', { str: 'expected-present' }]);
      const expr = ce.function('Coalesce', [ce.symbol('text'), fallback]);
      expectTypeBetween(expr, { atMost: 'string' });
      const derived = deriveApplicationType(ce, 'Coalesce', [
        describeType(ce.type(type).type),
        describeType('never'),
      ]);
      expect(derived).toBe('string');
      ce.assign('text', ce.string('ok'));
      expect(expr.evaluate().string).toBe('ok');
      ce.assign('text', ce.Missing);
      expect(expr.evaluate().operator).toBe('Error');
    }
  );

  test('numeric success excludes nan and retains infinity', () => {
    const ce = new ComputeEngine();
    ce.declare('numeric', 'number');
    const expr = ce.box([
      'Coalesce',
      'numeric',
      ['RuntimeError', { str: 'absent' }],
    ]);
    expectTypeBetween(expr, { atMost: 'number' });
    expect(expr.type.matches('!nan')).toBe(true);
    expect(ce.type('infinity').matches(expr.type)).toBe(true);
    ce.assign('numeric', ce.PositiveInfinity);
    expect(expr.evaluate().isSame(ce.PositiveInfinity)).toBe(true);
  });

  test('Nothing and nested absent cells survive the whole-value check', () => {
    const ce = new ComputeEngine();
    ce.declare('optional', 'integer | nothing | missing');
    ce.declare('cells', 'list<integer | missing>');
    const failure = ['RuntimeError', { str: 'absent' }];
    const optional = ce.box(['Coalesce', 'optional', failure]);
    expectTypeBetween(optional, { atMost: 'integer | nothing' });
    expect(ce.type('nothing').matches(optional.type)).toBe(true);
    const cells = ce.box(['Coalesce', 'cells', failure]);
    expectTypeBetween(cells, {
      atMost: 'list<integer | missing>',
      above: 'list<integer>',
    });
  });

  test('an absent final fallback remains possible and unresolved content stays unresolved', () => {
    const ce = new ComputeEngine();
    ce.declare('text', 'string | missing');
    expectTypeBetween(ce.box(['Coalesce', 'text', 'Missing']), {
      atMost: 'string | missing',
      above: 'string',
    });
    ce.declare('open', 'unknown');
    expect(
      ce.box(['Coalesce', 'open', ['RuntimeError', { str: 'absent' }]]).type
        .isUnknown
    ).toBe(true);
    expect(
      ce.box(['Coalesce', ['RuntimeError', { str: 'absent' }]]).type.toString()
    ).toBe('never');
    expect(
      ce.box(['Add', 1, ['RuntimeError', { str: 'absent' }]]).type.toString()
    ).toBe('never');
  });
});

describe('compiled numeric absence', () => {
  test.each(['nothing', 'integer | nothing', 'any'])(
    'a possible Nothing input (%s) is refused rather than tested as missing',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('omission', type);
      for (const expression of [
        ce.box(['IsMissing', 'omission']),
        ce.box(['Coalesce', 'omission', 5]),
      ]) {
        const compiled = compile(expression, { to: 'javascript' });
        expect(compiled.success).toBe(false);
        expect(compiled.error).toMatch(/cannot distinguish.*Nothing/);
      }
    }
  );

  test('a numeric marker still triggers a nonnumeric fallback', () => {
    const ce = new ComputeEngine();
    ce.declare('marker', 'nan');
    const expr = ce.box(['Coalesce', 'marker', { str: 'fallback' }]);
    expectTypeBetween(expr, { atMost: 'string' });
    const compiled = compile(expr, { to: 'javascript' });
    expect(compiled.success).toBe(true);
    expect(compiled.run!({ marker: NaN })).toBe('fallback');
    ce.assign('marker', ce.Indeterminate);
    expect(expr.evaluate().string).toBe('fallback');
  });

  test.each(['NaN', 'Indeterminate'])(
    '%s agrees with the JavaScript interpreter semantics',
    (marker) => {
      const ce = new ComputeEngine();
      for (const [expression, expected] of [
        [ce.box(['IsMissing', marker]), true],
        [ce.box(['Coalesce', marker, 5]), 5],
      ] as const) {
        const compiled = compile(expression, { to: 'javascript' });
        expect(compiled.success).toBe(true);
        expect(compiled.run!()).toBe(expected);
      }
    }
  );
});
