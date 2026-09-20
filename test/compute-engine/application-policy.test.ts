import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import type { ParseLatexOptions } from '../../src/compute-engine/latex-syntax/types';

type ApplicationContext = Parameters<
  NonNullable<ParseLatexOptions['resolveApplication']>
>[0];

describe('host policy for ambiguous parenthesized application', () => {
  test('accepts ordinary, uppercase, Greek and subscripted identifiers', () => {
    for (const [source, head] of [
      ['a(x+1)', 'a'],
      ['A(x+1)', 'A'],
      [String.raw`\alpha(x+1)`, 'alpha'],
      ['a_1(x+1)', 'a_1'],
    ]) {
      for (const decision of ['apply', 'multiply'] as const) {
        const ce = new ComputeEngine();
        const calls: ApplicationContext[] = [];
        const expr = ce.parse(source, {
          resolveApplication: (context) => {
            calls.push(context);
            return decision;
          },
        });
        expect(calls.map((context) => context.head)).toEqual([head]);
        expect(expr.json).toEqual(
          ce.box(
            decision === 'apply'
              ? [head, ['Add', 'x', 1]]
              : ['Multiply', head, ['Add', 'x', 1]]
          ).json
        );
      }
    }
  });

  test('reports empty, single, multiple and list arguments as parsed structure', () => {
    for (const [source, args] of [
      ['a()', []],
      ['a(x)', ['x']],
      ['a(x,y)', ['x', 'y']],
      ['a([1,2])', [['List', 1, 2]]],
    ] as const) {
      const ce = new ComputeEngine();
      const calls: ApplicationContext[] = [];
      const expr = ce.parse(source, {
        resolveApplication: (context) => {
          calls.push(context);
          return 'apply';
        },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].arguments).toEqual(args);
      expect(expr.json).toEqual(['a', ...args]);
    }
  });

  test('makes a separate decision for nested occurrences', () => {
    const ce = new ComputeEngine();
    const calls: string[] = [];
    const expr = ce.parse('a(b(x)+1)', {
      resolveApplication: ({ head }) => {
        calls.push(head);
        return head === 'a' ? 'apply' : 'multiply';
      },
    });
    expect(calls.sort()).toEqual(['a', 'b']);
    expect(expr.json).toEqual(['a', ['Add', ['Multiply', 'b', 'x'], 1]]);
  });

  test('reports half-open source spans for the head and its argument group', () => {
    const ce = new ComputeEngine();
    const source = String.raw`2+\alpha(x+1)^2`;
    const calls: ApplicationContext[] = [];
    ce.parse(source, {
      resolveApplication: (context) => {
        calls.push(context);
        return 'apply';
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sourceOffsets).toEqual([2, source.indexOf('^')]);
    expect(calls[0].headSourceOffsets).toEqual([2, source.indexOf('(')]);
    expect(source.slice(...calls[0].sourceOffsets)).toBe(
      String.raw`\alpha(x+1)`
    );
  });

  test('distinguishes a whole relation operand from terms within that operand', () => {
    for (const source of ['(a(x))=x+1', 'a(x)+a(x)=0']) {
      const ce = new ComputeEngine();
      const paths: ApplicationContext['ancestors'][] = [];
      ce.parse(source, {
        resolveApplication: ({ ancestors }) => {
          paths.push(
            ancestors.filter(({ operator }) => operator !== 'Delimiter')
          );
          return 'apply';
        },
      });
      expect(paths).toEqual(
        source.startsWith('(')
          ? [[{ operator: 'Equal', operandIndex: 1 }]]
          : [
              [
                { operator: 'Equal', operandIndex: 1 },
                { operator: 'Add', operandIndex: 1 },
              ],
              [
                { operator: 'Equal', operandIndex: 1 },
                { operator: 'Add', operandIndex: 2 },
              ],
            ]
      );
    }
  });

  test('lets a host recognize a complete definition head structurally', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('a(x)=b(x+1)', {
      resolveApplication: ({ ancestors }) => {
        const path = ancestors.filter(
          ({ operator }) => operator !== 'Delimiter'
        );
        return path.length === 1 &&
          path[0].operator === 'Equal' &&
          path[0].operandIndex === 1
          ? 'apply'
          : 'multiply';
      },
    });
    expect(expr.json).toEqual([
      'Equal',
      ['a', 'x'],
      ['Multiply', 'b', ['Add', 'x', 1]],
    ]);
  });

  test('preserves per-call choices through deferred canonicalization and JSON', () => {
    for (const form of ['raw', 'structural'] as const) {
      for (const decision of ['apply', 'multiply'] as const) {
        const ce = new ComputeEngine();
        const calls: string[] = [];
        const expr = ce.parse('a(x+1)', {
          form,
          resolveApplication: ({ head }) => {
            calls.push(head);
            return decision;
          },
        });
        ce.latexOptions = {
          ...ce.latexOptions,
          resolveApplication: () =>
            decision === 'apply' ? 'multiply' : 'apply',
        };
        const expected =
          decision === 'apply'
            ? ['a', ['Add', 'x', 1]]
            : ['Multiply', 'a', ['Add', 'x', 1]];
        expect(expr.canonical.json).toEqual(expected);
        expect(new ComputeEngine().box(expr.json).json).toEqual(expected);
        expect(calls).toEqual(['a']);
      }
    }
  });

  test('allows a per-call policy to override the engine default for that parse', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = {
      ...ce.latexOptions,
      resolveApplication: () => 'multiply',
    };
    expect(
      ce.parse('a(x)', { resolveApplication: () => 'apply' }).json
    ).toEqual(['a', 'x']);
    expect(ce.parse('b(x)').json).toEqual(['Multiply', 'b', 'x']);
  });

  test('attaches powers and factorials according to the selected reading', () => {
    for (const [suffix, operator] of [
      ['^2', 'Power'],
      ['!', 'Factorial'],
    ]) {
      for (const decision of ['apply', 'multiply'] as const) {
        const ce = new ComputeEngine();
        const operand = decision === 'apply' ? ['a', 'x'] : 'x';
        const postfixed =
          operator === 'Power' ? [operator, operand, 2] : [operator, operand];
        expect(
          ce.parse(`a(x)${suffix}`, { resolveApplication: () => decision }).json
        ).toEqual(
          ce.box(
            decision === 'apply' ? postfixed : ['Multiply', 'a', postfixed]
          ).json
        );
      }
    }
  });

  test('keeps indexing on the call when the host chooses application', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('a(x)[1]', {
        form: 'raw',
        resolveApplication: () => 'apply',
      }).json
    ).toEqual(['At', ['a', 'x'], 1]);
  });

  test('does not ask about builtins, bracket indexing or bare juxtaposition', () => {
    for (const source of [String.raw`\sin(x)`, 'a[1]', 'a x', '(x+1)(y+1)']) {
      const ce = new ComputeEngine();
      const calls: string[] = [];
      ce.parse(source, {
        resolveApplication: ({ head }) => {
          calls.push(head);
          return 'multiply';
        },
      });
      expect([source, calls]).toEqual([source, []]);
    }
  });

  test('explicit function, scalar and list declarations bypass both policies', () => {
    for (const type of ['function', 'real', 'list<real>', 'unknown']) {
      const ce = new ComputeEngine();
      ce.declare('a', type);
      const applicationCalls: string[] = [];
      const symbolCalls: string[] = [];
      const expr = ce.parse('a(x+1)', {
        resolveSymbol: (head) => {
          symbolCalls.push(head);
          return head === 'a'
            ? { type: type === 'function' ? 'real' : 'function' }
            : undefined;
        },
        resolveApplication: ({ head }) => {
          applicationCalls.push(head);
          return type === 'function' ? 'multiply' : 'apply';
        },
      });
      expect(applicationCalls).toEqual([]);
      expect(symbolCalls).not.toContain('a');
      expect(expr.operator).toBe(type === 'function' ? 'a' : 'Multiply');
    }
  });

  test('a local scalar declaration shadows an outer function', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'function');
    ce.pushScope();
    try {
      ce.declare('a', 'real');
      const calls: string[] = [];
      const expr = ce.parse('a(x+1)', {
        resolveSymbol: (head) =>
          head === 'a' ? { type: 'function' } : undefined,
        resolveApplication: ({ head }) => {
          calls.push(head);
          return 'apply';
        },
      });
      expect(expr.json).toEqual(['Multiply', 'a', ['Add', 'x', 1]]);
      expect(calls).toEqual([]);
    } finally {
      ce.popScope();
    }
  });

  test('a typed lambda parameter shadows an external function fact and application default', () => {
    const ce = new ComputeEngine();
    const calls: string[] = [];
    const expr = ce.parse(String.raw`(a: real)\mapsto a(2)`, {
      resolveSymbol: (head) =>
        head === 'a' ? { type: 'function' } : undefined,
      resolveApplication: ({ head }) => {
        calls.push(head);
        return 'apply';
      },
    });
    expect(ce.box(['Apply', expr.json, 3]).evaluate().json).toBe(6);
    expect(calls).toEqual([]);
  });

  test('still consults the policy for an inferred function from an earlier parse', () => {
    const ce = new ComputeEngine();
    ce.parse('a(x)');
    const calls: string[] = [];
    expect(
      ce.parse('a(x+1)', {
        resolveApplication: ({ head }) => {
          calls.push(head);
          return 'multiply';
        },
      }).json
    ).toEqual(['Multiply', 'a', ['Add', 'x', 1]]);
    expect(calls).toEqual(['a']);
  });

  test('returning undefined retains the existing parser default', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('a(x+1)', { resolveApplication: () => undefined }).json
    ).toEqual(['a', ['Add', 'x', 1]]);
  });

  test('external list type facts reach boxing and suppress notation policy', () => {
    for (const form of ['canonical', 'structural', 'raw'] as const) {
      const ce = new ComputeEngine();
      const calls: string[] = [];
      const expr = ce.parse('a(x+1)', {
        form,
        resolveSymbol: (head) =>
          head === 'a' ? { type: 'list<real>' } : undefined,
        resolveApplication: ({ head }) => {
          calls.push(head);
          return 'apply';
        },
      });
      const declared = new ComputeEngine();
      declared.declare('a', 'list<real>');
      const control = declared.parse('a(x+1)');
      expect(expr.canonical.json).toEqual(control.json);
      expect(expr.canonical.type.toString()).toBe(control.type.toString());
      expect(ce.lookupDefinition('a')).toBeUndefined();
      expect(calls).toEqual([]);
    }
  });

  test('a multiplication default does not install a false explicit scalar type', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('a(x+1)', { resolveApplication: () => 'multiply' });
    expect(expr.operator).toBe('Multiply');
    const definition = ce.lookupDefinition('a');
    if (definition && 'value' in definition)
      expect(definition.value.inferredType).toBe(true);
    ce.declare('a', 'list<real>');
    expect(ce.symbol('a').type.toString()).toBe('list<real>');
    expect(ce.parse('a(x+1)').type.toString()).toMatch(/^list</);
  });

  test('declining the policy preserves raw juxtaposition and dictionary aliases', () => {
    for (const source of [
      'a(x)b',
      '2a(x)',
      String.raw`y=aQ_z\left(x,y\right)`,
      String.raw`\mu_0(x)=x^2`,
    ]) {
      const stock = new ComputeEngine().parse(source, {
        form: 'raw',
        strict: false,
      });
      const hooked = new ComputeEngine().parse(source, {
        form: 'raw',
        strict: false,
        resolveApplication: () => undefined,
      });
      expect(hooked.json).toEqual(stock.json);
    }
  });

  test('a known dictionary alias is not replaced by the name scanner', () => {
    const ce = new ComputeEngine();
    ce.declare('Mu0', { signature: '(number) -> number' });
    const calls: string[] = [];
    const result = ce.parse(String.raw`\mu_0(x)`, {
      resolveApplication: ({ head }) => {
        calls.push(head);
        return 'multiply';
      },
    });
    expect(result.json).toEqual(['Mu0', 'x']);
    expect(calls).toEqual([]);
  });

  test('combined script orders keep every suffix on the chosen operand', () => {
    for (const source of ['a(x)^2_1', 'a(x)_1^2']) {
      expect(
        new ComputeEngine().parse(source, {
          form: 'raw',
          resolveApplication: () => 'multiply',
        }).json
      ).toEqual([
        'Multiply',
        'a',
        ['Power', ['Subscript', ['Delimiter', 'x'], 1], 2],
      ]);
      expect(
        new ComputeEngine().parse(source, {
          form: 'raw',
          resolveApplication: () => 'apply',
        }).json
      ).toEqual(['Power', ['Subscript', ['a', 'x'], 1], 2]);
    }
  });

  test('untyped value parameters keep multiplication while callable parameters stay local', () => {
    const ce = new ComputeEngine();
    const value = ce.parse(String.raw`x\mapsto x(2)`);
    expect(ce.box(['Apply', value.json, 3]).evaluate().json).toBe(6);
    ce.assign('f', ce.parse(String.raw`t\mapsto t+100`));
    const callable = ce.parse(String.raw`(f,x)\mapsto f(x)`);
    const identity = ce.parse(String.raw`t\mapsto t`);
    expect(
      ce.box(['Apply', callable.json, identity.json, 3]).evaluate().json
    ).toBe(3);
  });
});

describe('application policy preserves infix range precedence', () => {
  test('range normalization keeps source metadata on enclosing index expressions', () => {
    for (const resolveApplication of [
      undefined,
      () => undefined,
      () => 'apply' as const,
    ]) {
      const expr = new ComputeEngine().parse('l[f(x)+1...n]=0', {
        form: 'raw',
        preserveLatex: true,
        resolveApplication,
      });
      expect(expr.op1.operator).toBe('At');
      expect(expr.op1.verbatimLatex).toBe('l[f(x)+1...n]');
      expect(expr.op1.op2.operator).toBe('Range');
    }
  });

  test('keeps compound anchors through unchanged and rebuilt range nodes', () => {
    for (const decision of ['stock', undefined, 'apply', 'multiply'] as const) {
      const call = (head: string, arg: string): MathJsonExpression =>
        decision === 'apply'
          ? [head, arg]
          : [
              decision === 'multiply' ? 'Multiply' : 'InvisibleOperator',
              head,
              ['Delimiter', arg],
            ];
      for (const [source, expected] of [
        ['f(x)+1...n', ['Range', ['Add', call('f', 'x'), 1], 'n']],
        [
          'f(x)+1...g(n)',
          ['Range', ['Add', call('f', 'x'), 1], call('g', 'n')],
        ],
        [
          'l[f(x)+1...g(n)]',
          ['At', 'l', ['Range', ['Add', call('f', 'x'), 1], call('g', 'n')]],
        ],
      ] as [string, MathJsonExpression][]) {
        for (const form of ['raw', 'structural', 'canonical'] as const) {
          for (const preserveLatex of [false, true]) {
            const ce = new ComputeEngine();
            const expr = ce.parse(source, {
              form,
              preserveLatex,
              ...(decision === 'stock'
                ? {}
                : { resolveApplication: () => decision }),
            });
            if (form === 'raw') expect(expr.json).toEqual(expected);
            expect(expr.canonical.json).toEqual(ce.box(expected).json);
            expect(ce.box(expr.json).json).toEqual(expr.canonical.json);
          }
        }
      }
    }
  });

  test('keeps the entire index offset as the lower slice bound', () => {
    const source = String.raw`l[I(l,r,i)+1...\operatorname{length}(l)]`;
    const expected = [
      'At',
      'l',
      ['Range', ['Add', ['I', 'l', 'r', 'i'], 1], ['Length', 'l']],
    ];
    for (const resolveApplication of [
      undefined,
      () => undefined,
      () => 'apply' as const,
    ]) {
      expect(
        new ComputeEngine().parse(source, { form: 'raw', resolveApplication })
          .json
      ).toEqual(expected);
    }
  });

  test('a declining policy preserves range syntax even without application candidates', () => {
    for (const source of ['k+1...n', 'l[k+1...n]']) {
      const calls: string[] = [];
      const ce = new ComputeEngine();
      const result = ce.parse(source, {
        form: 'raw',
        resolveApplication: ({ head }) => {
          calls.push(head);
          return undefined;
        },
      });
      expect(result.json).toEqual(
        new ComputeEngine().parse(source, { form: 'raw' }).json
      );
      expect(calls).toEqual([]);
    }
  });

  test('preserves explicit grouping and function-call ranges as addition operands', () => {
    for (const source of [
      'f(x)+(1...n)',
      String.raw`f(x)+\operatorname{Range}(1,n)`,
    ]) {
      const expr = new ComputeEngine().parse(source, {
        form: 'raw',
        resolveApplication: () => 'apply',
      });
      expect(expr.operator).toBe('Add');
      expect(expr.op1.json).toEqual(['f', 'x']);
      expect(expr.op2.canonical.json).toEqual(['Range', 1, 'n']);
    }
  });
});
