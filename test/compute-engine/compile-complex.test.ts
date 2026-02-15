import { engine as ce } from '../utils';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('COMPILE COMPLEX - isComplexValued', () => {
  it('real number literal is not complex', () => {
    expect(BaseCompiler.isComplexValued(ce.box(3))).toBe(false);
  });

  it('complex number literal is complex', () => {
    expect(BaseCompiler.isComplexValued(ce.box(['Complex', 3, 2]))).toBe(true);
  });

  it('ImaginaryUnit is complex', () => {
    expect(BaseCompiler.isComplexValued(ce.box('ImaginaryUnit'))).toBe(true);
  });

  it('untyped symbol is assumed real', () => {
    expect(BaseCompiler.isComplexValued(ce.box('x'))).toBe(false);
  });

  it('Add with one complex operand is complex', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Add', ['Complex', 1, 2], 3])
      )
    ).toBe(true);
  });

  it('Add with all real operands is real', () => {
    expect(
      BaseCompiler.isComplexValued(ce.box(['Add', 1, 2, 3]))
    ).toBe(false);
  });

  it('Abs of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Abs', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Arg of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Arg', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Re of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Re', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Im of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Im', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Sin of complex is complex', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Sin', ['Complex', 1, 2]])
      )
    ).toBe(true);
  });

  it('nested complex propagates', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Multiply', ['Add', 'ImaginaryUnit', 1], 3])
      )
    ).toBe(true);
  });
});

describe('COMPILE COMPLEX - literals', () => {
  it('should compile a complex number literal', () => {
    const expr = ce.box(['Complex', 3, 2]);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 3, im: 2 })');
  });

  it('should compile a pure imaginary literal', () => {
    const expr = ce.box(['Complex', 0, 1]);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 0, im: 1 })');
  });

  it('should compile ImaginaryUnit symbol', () => {
    const expr = ce.box('ImaginaryUnit');
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 0, im: 1 })');
  });
});
