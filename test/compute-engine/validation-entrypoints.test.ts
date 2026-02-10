import { ComputeEngine } from '../../src/compute-engine';

function normalizeAtom(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAtom);
  if (typeof value !== 'string') return value;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

describe('Validation Entrypoints', () => {
  test('invalid symbol preserves error shape', () => {
    const ce = new ComputeEngine();
    const result = ce.symbol('+').toMathJson();

    expect(result).toEqual([
      'Error',
      ['ErrorCode', 'invalid-symbol', 'invalid-first-char'],
      '+',
    ]);
  });

  test('error() wraps LaTeX where as LatexString', () => {
    const ce = new ComputeEngine();
    const result = normalizeAtom(ce.error('missing', '$x+1$').toMathJson());

    expect(result).toEqual(['Error', 'missing', ['LatexString', 'x+1']]);
  });

  test('typeError() includes expected and actual types', () => {
    const ce = new ComputeEngine();
    const result = normalizeAtom(
      ce.typeError('number', ce.type('boolean'), '$x$').toMathJson()
    );

    expect(result).toEqual([
      'Error',
      ['ErrorCode', 'incompatible-type', 'number', 'boolean'],
      ['LatexString', 'x'],
    ]);
  });

  test('typeError() without actual keeps stable shape', () => {
    const ce = new ComputeEngine();
    const result = normalizeAtom(ce.typeError('number', undefined).toMathJson());

    expect(result).toEqual(['Error', ['ErrorCode', 'incompatible-type', 'number']]);
  });

  test('parse type mismatch preserves incompatible-type payload', () => {
    const ce = new ComputeEngine();
    const result = normalizeAtom(ce.parse('1+(2=2)+3')?.canonical.toMathJson());

    expect(result).toEqual([
      'Add',
      1,
      ['Error', ['ErrorCode', 'incompatible-type', 'number', 'boolean']],
      3,
    ]);
  });
});
