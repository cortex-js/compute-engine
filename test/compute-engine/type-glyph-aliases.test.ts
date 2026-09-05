import { ComputeEngine } from '../../src/compute-engine';
import { parseType, parseTypePrefix } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

// The double-struck letters are input spellings of the primitive number
// types: `ℝ` is `real`, `ℤ` `integer`, `ℚ` `rational`, `ℂ` `complex`, and `ℕ`
// the ranged `integer<0..>`. They are normalized in the type parser, so a
// glyph never reaches a `Type` node and serializes back as the ASCII name.

describe('DOUBLE-STRUCK TYPE GLYPHS', () => {
  test('each glyph parses to its primitive', () => {
    expect(typeToString(parseType('ℝ'))).toBe('real');
    expect(typeToString(parseType('ℤ'))).toBe('integer');
    expect(typeToString(parseType('ℚ'))).toBe('rational');
    expect(typeToString(parseType('ℂ'))).toBe('complex');
    expect(typeToString(parseType('ℕ'))).toBe('integer<0..>');
  });

  test('a glyph composes like the name it spells', () => {
    expect(typeToString(parseType('list<ℝ>'))).toBe('list<real>');
    expect(typeToString(parseType('(ℝ, ℤ) -> ℂ'))).toBe(
      '(real, integer) -> complex'
    );
    expect(typeToString(parseType('ℝ<0..1>'))).toBe('real<0..1>');
    expect(typeToString(parseType('ℝ | string'))).toBe('real | string');
    expect(typeToString(parseType('tuple<ℕ, ℚ>'))).toBe(
      'tuple<integer<0..>, rational>'
    );
  });

  test('ℕ takes no range of its own', () => {
    expect(() => parseType('ℕ<1..>')).toThrow();
  });

  test('a glyph names a type only at an identifier boundary', () => {
    // `ℝfoo` is not `real` followed by `foo`: a prefix parse that stopped
    // after the glyph would let a caller resume inside its own token.
    expect(() => parseType('ℝfoo')).toThrow();
    expect(() => parseType('ℝ2')).toThrow();
    expect(() => parseType('ℝ_')).toThrow();
    expect(() => parseTypePrefix('ℝfoo = 3')).toThrow();
  });

  test('the prefix parse ends right after the glyph', () => {
    // A glyph is ONE source character, so the Epsil parser, which resumes
    // just past the type, must be told an end offset of exactly one.
    expect(parseTypePrefix('ℝ = 3').end).toBe(1);
    expect(parseTypePrefix('ℕ, y').end).toBe(1);
    expect(parseTypePrefix('list<ℤ>)').end).toBe(7);
  });

  test('a declaration accepts a glyph type string', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'ℝ');
    ce.declare('n', 'ℕ');
    expect(ce.box('r').type.toString()).toBe('real');
    expect(ce.box('n').type.toString()).toBe('integer<0..>');
  });
});
