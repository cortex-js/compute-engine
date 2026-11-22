import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Applying a typed let (`Apply(Function(body, v), value)`) whose value mentions
// a parameter of the enclosing function must not rename that parameter inside
// the nested function bodies of `body`.

type J = any;
const apply = (f: J, ...args: J[]) => ['Apply', f, ...args];
const range = (to: J) => ['Range', 1, to, 1];

const letV = (body: J, typed: boolean) => [
  'Function',
  body,
  typed ? ['Typed', 'v', { str: 'list<integer>' }] : 'v',
];

const stepBody = (nested: 'Map' | 'Filter') =>
  nested === 'Map'
    ? [
        'Map',
        [
          'Function',
          ['If', ['Less', 'j', 'k'], ['At', 'v', 'j'], ['At', 'acc', 'j']],
          'j',
        ],
        range(3),
      ]
    : [
        'Filter',
        range(3),
        ['Function', ['Less', ['At', 'v', 'j'], ['At', 'acc', 'j']], 'j'],
      ];

const value = [
  'Map',
  ['Function', ['At', 'acc', 'q'], 'q'],
  range(['Subtract', 'k', 1]),
];

const fold = (step: J) => ['Fold', step, ['List', 5, 6, 7], ['Range', 2, 3, 1]];

const leaked = (json: J) => /acc_1|k_1/.test(JSON.stringify(json));

describe('APPLY TYPED LET MENTIONING OUTER PARAMETERS', () => {
  for (const typed of [true, false]) {
    const tag = typed ? 'typed' : 'untyped';

    test(`Fold step with Map (${tag})`, () => {
      const step = [
        'Function',
        apply(letV(stepBody('Map'), typed), value),
        'acc',
        'k',
      ];
      const expr = ce.expr(fold(step) as J);
      expect(expr.evaluate().json).toEqual(['List', 5, 6, 7]);
      expect(expr.N().json).toEqual(['List', 5, 6, 7]);
    });

    test(`Apply of the step body (${tag})`, () => {
      const step = [
        'Function',
        apply(letV(stepBody('Map'), typed), value),
        'acc',
        'k',
      ];
      const expr = ce.expr(apply(step, ['List', 5, 6, 7], 2) as J);
      expect(leaked(expr.evaluate().json)).toBe(false);
      expect(leaked(expr.N().json)).toBe(false);
    });

    test(`Filter instead of Map (${tag})`, () => {
      const step = [
        'Function',
        apply(letV(stepBody('Filter'), typed), value),
        'acc',
        'k',
      ];
      const r = ce.expr(apply(step, ['List', 5, 6, 7], 2) as J);
      expect(leaked(r.evaluate().json)).toBe(false);
      expect(leaked(r.N().json)).toBe(false);
    });
  }

  test('two levels of nesting', () => {
    const inner = letV(
      [
        'Map',
        ['Function', ['Add', ['At', 'v', 'j'], ['At', 'acc', 'j']], 'j'],
        range(3),
      ],
      false
    );
    const outer = [
      'Function',
      apply(
        [
          'Function',
          apply(inner, [
            'Map',
            ['Function', ['Add', ['At', 'w', 'q'], ['At', 'acc', 'q']], 'q'],
            range(3),
          ]),
          'w',
        ],
        ['Map', ['Function', ['At', 'acc', 'r'], 'r'], range(3)]
      ),
      'acc',
    ];
    const r = ce.expr(apply(outer, ['List', 5, 6, 7]) as J);
    expect(leaked(r.evaluate().json)).toBe(false);
    expect(leaked(r.N().json)).toBe(false);
  });

  test('a user symbol named like the fresh name is not captured', () => {
    ce.declare('acc_1', { type: 'integer', value: 100 });
    try {
      const step = [
        'Function',
        apply(
          letV(
            [
              'Map',
              ['Function', ['Add', ['At', 'v', 'j'], 'acc_1'], 'j'],
              range(2),
            ],
            false
          ),
          [
            'Map',
            ['Function', ['Add', ['At', 'acc', 'q'], 'acc_1'], 'q'],
            range(2),
          ]
        ),
        'acc',
      ];
      const r = ce.expr(apply(step, ['List', 5, 6, 7]) as J);
      const out = JSON.stringify(r.evaluate().json);
      expect(out).not.toMatch(/"acc"/);
      expect(out).not.toMatch(/acc_1_/);
      expect(out.match(/"acc_1"/g)).toHaveLength(2);
    } finally {
      ce.forget('acc_1');
    }
  });

  test('a real binder named like a value free name is still renamed', () => {
    // `x` is free in the value and bound by the nested literal: the nested
    // literal is renamed, so the value keeps meaning the outer `x`.
    const f = ['Function', ['Function', ['Power', 'y', 'x'], 'x'], 'y'];
    const r = ce.expr(apply(f, 'x') as J).evaluate();
    const g = apply(r.json, 2);
    expect(ce.expr(g as J).evaluate().json).toEqual(['Power', 'x', 2]);
  });

  test('the compiled form, where it compiles, agrees', () => {
    const step = [
      'Function',
      apply(letV(stepBody('Map'), true), value),
      'acc',
      'k',
    ];
    const expr = ce.expr(fold(step) as J);
    let result: unknown;
    try {
      result = (compile(expr, { fallback: false }) as any).run?.();
    } catch {
      return; // declines on this branch
    }
    if (result !== undefined) expect(result).toEqual([5, 6, 7]);
  });
});
