import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

for (const [language, makeTarget] of [
  ['glsl', () => new GLSLTarget()],
  ['wgsl', () => new WGSLTarget()],
] as const) {
  describe(`${language} folded bounds and integer indices`, () => {
    function fixture(size = 153) {
      const ce = new ComputeEngine();
      ce.declare('A', 'vector<153>');
      ce.declare('flag', 'boolean');
      ce.assign(
        'P',
        ce.box(['List', ...Array.from({ length: size }, (_, i) => i)])
      );
      const target = makeTarget();
      const code = (json: any, options = {}) => {
        const result = target.compile(ce.box(json), {
          fallback: false,
          ...options,
        });
        expect(result.success).toBe(true);
        return result.code!;
      };
      return { ce, target, code };
    }
    const length = ['Length', 'P'];
    const sum = (index: any, lower: any = 1, upper: any = length) => [
      'Sum',
      ['At', 'A', index],
      ['Limits', 'k', lower, upper],
    ];

    test.each(['Sum', 'Product'])(
      '%s folds list-length bounds before loop emission',
      (op) => {
        const { code } = fixture();
        const source = code([
          op,
          ['Multiply', ['At', 'A', 'k'], 'x'],
          ['Limits', 'k', 1, length],
        ]);
        expect(source).toContain('k <= 153;');
        expect(source).not.toContain('floor');
        expect(source).not.toContain('_gpu_at');
        expect(source).toContain('[k - 1]');
        if (language === 'wgsl') expect(source).toMatch(/var _tv\d+ = A;/);
        else expect(source).toContain('A[k - 1]');
      }
    );

    test('a folded 53-element bound unrolls', () => {
      const { code } = fixture(53);
      const source = code([
        'Sum',
        ['Multiply', 'k', 'x'],
        ['Limits', 'k', 1, length],
      ]);
      expect(source).not.toContain('for (');
      expect(source).not.toContain('floor');
      expect(source).toContain('53.0 * x');
    });

    test('exactly representable fractional bounds floor before unrolling', () => {
      const { code } = fixture(5);
      const source = code([
        'Sum',
        ['Multiply', 'k', 'x'],
        [
          'Limits',
          'k',
          ['Negate', ['Divide', length, 2]],
          ['Divide', length, 2],
        ],
      ]);
      expect(source).not.toContain('for (');
      expect(source).not.toContain('floor');
      expect(source).toContain('-3.0');
      expect(source).toContain('2.0');
    });

    test.each(['Sum', 'Product'])(
      '%s eliminates an empty folded range',
      (op) => {
        const { code } = fixture();
        expect(
          code([op, 'x', ['Limits', 'k', ['Add', length, 1], length]])
        ).toBe(op === 'Sum' ? '0.0' : '1.0');
      }
    );

    test('non-exact binary32 constants retain shader conversion', () => {
      const { code } = fixture();
      // The mathematical sum is 16777217, which binary32 cannot represent.
      const source = code(sum('k', 1, ['Add', length, 16777064]));
      expect(source).toContain('floor(16777217.0)');
      expect(source).toContain('_gpu_at153');
    });

    test('a folded value outside the counter range retains conversion', () => {
      const { code } = fixture();
      expect(code(sum('k', 1, ['Multiply', length, 16777216]))).toContain(
        'floor('
      );
    });

    test('constantFold false preserves the unsupported Length diagnostic', () => {
      const { code } = fixture();
      expect(() => code(sum('k'), { constantFold: false })).toThrow(
        /Length.*not supported/
      );
    });

    test('literal bounds still prove indices when constant folding is disabled', () => {
      const { code } = fixture();
      expect(code(sum('k', 1, 153), { constantFold: false })).toContain(
        '[k - 1]'
      );
    });

    test('bounded arithmetic uses native integer source', () => {
      const { code } = fixture();
      const source = code(sum(['Add', 'k', 1], 0, 152));
      expect(source).not.toContain('_gpu_at');
      expect(source).toContain('(k + 1) - 1');
      expect(source).not.toContain('float(k)');
      expect(source).not.toContain('f32(k)');
    });

    test.each([
      ['k', 0, 153],
      ['k', -2, 153],
      ['k', 1, 154],
      ['k', 1, 'n'],
      [['Add', 'k', 0.5], 1, 153],
      [['Subtract', 'k', 16777216], 16777216, 16777369],
    ])(
      'uncertain or invalid indices retain the guarded helper: %j',
      (index, lo, hi) => {
        const { code } = fixture();
        expect(code(sum(index, lo, hi))).toContain('_gpu_at153');
      }
    );

    test('caller overrides and mappings block the affected proofs', () => {
      const { code } = fixture(3);
      expect(
        code(sum('k'), { functions: { Length: 'customLength' } })
      ).toContain('floor(customLength(');
      expect(
        code(sum(['Add', 'k', 1], 0, 152), { functions: { Add: 'customAdd' } })
      ).toContain('_gpu_at153');
      expect(code(sum('k', 1, 153), { vars: { A: 'mappedA' } })).toContain(
        '_gpu_at153'
      );
    });

    test('per-operator compile handlers block native integer proofs', () => {
      const { ce, target, code } = fixture();
      ce.pushScope();
      ce.declare('Add', {
        signature: '(number, number) -> number',
        pure: true,
        compile: (_args, _c, { language: outputLanguage }) =>
          outputLanguage === language ? '7.0' : undefined,
      });

      const loop = code(sum(['Add', 'k', 1], 0, 152), {
        constantFold: false,
      });
      expect(loop).toMatch(/_gpu_at153\([^,]+, 7\.0\)/);
      expect(loop).not.toContain('(k + 1) - 1');

      // Preserve the arithmetic node so literal canonicalization cannot
      // erase the handler before the independent integer proof sees it.
      const constant = target.compile(
        ce._fn('At', [
          ce.symbol('A'),
          ce._fn('Add', [ce.number(1), ce.number(1)]),
        ]),
        { fallback: false, constantFold: false }
      );
      expect(constant.success).toBe(true);
      expect(constant.code).toMatch(/_gpu_at153\([^,]+, 7\.0\)/);
      expect(constant.code).not.toContain('(1 + 1) - 1');

      // An opaque handler elsewhere in the body can also affect the counter.
      const sibling = code(
        [
          'Sum',
          ['Multiply', ['At', 'A', 'k'], ['Add', 'k', 1]],
          ['Limits', 'k', 1, 153],
        ],
        { constantFold: false }
      );
      expect(sibling).toContain('_gpu_at153');
      expect(sibling).toContain('7.0');
      expect(sibling).not.toContain('[k - 1]');
    });

    test('shadowing and later compilations cannot inherit another loop range', () => {
      const { code } = fixture();
      const nested = ['Sum', sum('k', 1, 'n'), ['Limits', 'k', 1, 153]];
      expect(code(nested)).toContain('_gpu_at153');
      const first = code(sum('k', 1, 153));
      expect(first).toContain('[k - 1]');
      expect(code(['At', 'A', 'k'])).toContain('_gpu_at153');
      expect(code(sum('k', 1, 153))).toBe(first);
    });

    test('runtime parameters are not folded against engine values', () => {
      const { ce, target } = fixture();
      ce.assign('n', 153);
      const source = target.compileFunction(
        ce.box([
          'Sum',
          ['Multiply', 'k', 'x'],
          ['Limits', 'k', 1, ['Add', 'n', 1]],
        ]),
        'f',
        language === 'wgsl' ? 'f32' : 'float',
        [
          ['n', language === 'wgsl' ? 'f32' : 'float'],
          ['x', language === 'wgsl' ? 'f32' : 'float'],
        ]
      );
      expect(source).toContain('floor(n + 1.0)');
    });

    test('WGSL array reads in lazy branches retain a legal helper call', () => {
      if (language !== 'wgsl') return;
      const { code } = fixture();
      const source = code([
        'Sum',
        ['Which', 'flag', ['At', 'A', 'k'], 'True', 0],
        ['Limits', 'k', 1, 153],
      ]);
      expect(source).toContain('_gpu_at153');
    });
  });
}
