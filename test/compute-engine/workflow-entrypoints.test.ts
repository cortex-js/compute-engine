import { ComputeEngine } from '../../src/compute-engine';

describe('Workflow Entrypoints', () => {
  test('parseSimplify() parses then simplifies', () => {
    const ce = new ComputeEngine();
    const result = ce.parseSimplify('1+1');

    expect(result?.toString()).toBe('2');
  });

  test('parseEvaluate() parses then evaluates with context values', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 3);

    const result = ce.parseEvaluate('x+2');

    expect(result?.toString()).toBe('5');
  });

  test('parseNumeric() parses then computes a numeric approximation', () => {
    const ce = new ComputeEngine();
    const result = ce.parseNumeric('\\sqrt{2}');

    expect(result).not.toBeNull();
    expect(result?.isNumber).toBe(true);
    expect(result?.toString()).not.toBe('Sqrt(2)');
  });

  test('parseSimplify() supports strict/permissive parse presets', () => {
    const ce = new ComputeEngine();

    const strictResult = ce.parseSimplify('sin(x)', { parseMode: 'strict' });
    const permissiveResult = ce.parseSimplify('sin(x)', {
      parseMode: 'permissive',
    });

    expect(strictResult?.operator).toBe('Multiply');
    expect(permissiveResult?.operator).toBe('Sin');
  });

  test('explicit parse options override parseMode preset', () => {
    const ce = new ComputeEngine();

    const strictOverride = ce.parseSimplify('sin(x)', {
      parseMode: 'permissive',
      parse: { strict: true },
    });
    const permissiveOverride = ce.parseSimplify('sin(x)', {
      parseMode: 'strict',
      parse: { strict: false },
    });

    expect(strictOverride?.operator).toBe('Multiply');
    expect(permissiveOverride?.operator).toBe('Sin');
  });

  test('parseSimplify() supports simplification strategy presets', () => {
    const ce = new ComputeEngine();
    const input = '2\\sin(x)\\cos(x)';

    const defaultMode = ce.parseSimplify(input, { simplifyMode: 'default' });
    const trigMode = ce.parseSimplify(input, { simplifyMode: 'trigonometric' });
    const explicitDefault = ce.parse(input)?.simplify({ strategy: 'default' });
    const explicitTrig = ce.parse(input)?.simplify({ strategy: 'fu' });

    expect(defaultMode?.toString()).toBe(explicitDefault?.toString());
    expect(trigMode?.toString()).toBe(explicitTrig?.toString());
  });

  test('explicit simplify options override simplifyMode preset', () => {
    const ce = new ComputeEngine();
    const input = '2\\sin(x)\\cos(x)';

    const defaultOverride = ce.parseSimplify(input, {
      simplifyMode: 'trigonometric',
      simplify: { strategy: 'default' },
    });
    const trigOverride = ce.parseSimplify(input, {
      simplifyMode: 'default',
      simplify: { strategy: 'fu' },
    });

    expect(defaultOverride?.toString()).toBe(
      ce.parseSimplify(input, { simplifyMode: 'default' })?.toString()
    );
    expect(trigOverride?.toString()).toBe(
      ce.parseSimplify(input, { simplifyMode: 'trigonometric' })?.toString()
    );
  });

  test('parseEvaluate() supports exact/numeric presets', () => {
    const ce = new ComputeEngine();

    const exactResult = ce.parseEvaluate('\\sqrt{2}', { evaluateMode: 'exact' });
    const numericResult = ce.parseEvaluate('\\sqrt{2}', {
      evaluateMode: 'numeric',
    });

    expect(exactResult?.toString()).not.toBe(numericResult?.toString());
    expect(numericResult?.toString()).toBe(ce.parseNumeric('\\sqrt{2}')?.toString());
  });

  test('explicit evaluate options override evaluateMode preset', () => {
    const ce = new ComputeEngine();

    const exactOverride = ce.parseEvaluate('\\sqrt{2}', {
      evaluateMode: 'numeric',
      evaluate: { numericApproximation: false },
    });
    const numericOverride = ce.parseEvaluate('\\sqrt{2}', {
      evaluateMode: 'exact',
      evaluate: { numericApproximation: true },
    });

    expect(exactOverride?.toString()).toBe(
      ce.parseEvaluate('\\sqrt{2}', { evaluateMode: 'exact' })?.toString()
    );
    expect(numericOverride?.toString()).toBe(
      ce.parseEvaluate('\\sqrt{2}', { evaluateMode: 'numeric' })?.toString()
    );
  });

  test('workflow entrypoints propagate null parse input', () => {
    const ce = new ComputeEngine();

    expect(ce.parseSimplify(null)).toBeNull();
    expect(ce.parseEvaluate(null)).toBeNull();
    expect(ce.parseNumeric(null)).toBeNull();
  });
});
