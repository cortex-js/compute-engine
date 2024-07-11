import { engine as ce } from '../../utils';

describe('constructor', () => {
  it('should create from an integer', () => {
    const a = ce._numericValue(1);
    expect(a.re).toEqual(1);
    expect(a.toString()).toMatchInlineSnapshot(`1`);
  });

  it('should create from a rational', () => {
    const a = ce._numericValue([-7, 5]);
    expect(a.re).toMatchInlineSnapshot(`-1.4`);
    expect(a.toString()).toMatchInlineSnapshot(`-7/5`);
  });

  it('should reduce rational', () => {
    const a = ce._numericValue([-70, 50]);
    expect(a.re).toMatchInlineSnapshot(`-1.4`);
    expect(a.toString()).toMatchInlineSnapshot(`-7/5`);
  });

  it('should create from a sqrt', () => {
    const a = ce._numericValue(5).sqrt();
    expect(a.re).toMatchInlineSnapshot(`2.23606797749979`);
    expect(a.toString()).toMatchInlineSnapshot(`sqrt(5)`);
  });

  it('should create from a perfect sqrt', () => {
    const a = ce._numericValue(16).sqrt();
    expect(a.re).toMatchInlineSnapshot(`4`);
    expect(a.toString()).toMatchInlineSnapshot(`4`);
  });
});

describe('one and zero', () => {
  it('should add to 0', () => {
    const zero = ce._numericValue(0);
    const a = zero.add(ce._numericValue(3).sqrt());
    expect(a.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(a.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });

  it('should add to 0', () => {
    const zero = ce._numericValue(0);
    const a = zero.add(ce._numericValue(3).sqrt());
    expect(a.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(a.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });
  it('should add to 0', () => {
    const a = ce._numericValue(3).sqrt();
    const b = a.add(0);
    expect(b.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });
  it('should multiply by 1', () => {
    const a = ce._numericValue(3).sqrt();
    const b = a.mul(1);
    expect(b.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });
  it('should multiply by -1', () => {
    const a = ce._numericValue(3).sqrt();
    const b = a.mul(-1);
    expect(b.re).toMatchInlineSnapshot(`-1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`-sqrt(3)`);
  });
  it('should multiply by 1', () => {
    const one = ce._numericValue(1);
    const b = one.mul(ce._numericValue(3).sqrt());
    expect(b.re).toMatchInlineSnapshot(`1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`sqrt(3)`);
  });
  it('should multiply by -1', () => {
    const one = ce._numericValue(-1);
    const b = one.mul(ce._numericValue(3).sqrt());
    expect(b.re).toMatchInlineSnapshot(`-1.7320508075688772`);
    expect(b.toString()).toMatchInlineSnapshot(`-sqrt(3)`);
  });
});

describe('sign is carried', () => {
  it('should carry it from a float', () => {
    const a = ce._numericValue(-1.23);
    expect(a.sign).toEqual(-1);
    expect(a.re).toEqual(-1.23);
    expect(a.toString()).toMatchInlineSnapshot(`-1.23`);
  });

  it('should carry it from a rational', () => {
    const a = ce._numericValue([-2, 10]);
    expect(a.sign).toEqual(-1);
    expect(a.re).toEqual(-0.2);
    expect(a.toString()).toMatchInlineSnapshot(`-1/5`);
  });

  it('should carry it from a float and rational', () => {
    const a = ce._numericValue(-3.1415).mul([-2, 10]);
    expect(a.sign).toEqual(1);
    expect(a.re).toMatchInlineSnapshot(`0.6283000000000001`);
    expect(a.toString()).toMatchInlineSnapshot(`0.6283000000000001`);
  });
});

describe('multiplication', () => {
  it('should multiply rational two floats', () => {
    const a = ce._numericValue(-1.234);
    const b = a.mul(3.5);
    expect(b.re).toMatchInlineSnapshot(`-4.319`);
    // float * float = float
    expect(b.toString()).toMatchInlineSnapshot(`-4.319`);
  });
  it('should multiply rational by a float', () => {
    const a = ce._numericValue([-2, 10]);
    const b = a.mul(3.5);
    expect(b.re).toEqual(-0.7);
    // Rational * float = float
    expect(b.toString()).toMatchInlineSnapshot(`-0.7`);
  });
  it('should multiply two rationals to a reduced rational', () => {
    const a = ce._numericValue([-2, 10]);
    const b = a.mul([3, 5]);
    expect(b.re).toMatchInlineSnapshot(`-0.12`);
    // Rational * Rational = Rational
    expect(b.toString()).toMatch(`-3/25`);
  });
});

describe('multiplication', () => {
  it('should divide two floats', () => {
    const a = ce._numericValue(-1.234);
    const b = a.div(3.5);
    expect(b.re).toMatchInlineSnapshot(`-0.3525714285714286`);
    // float / float = float
    expect(b.toString()).toMatchInlineSnapshot(`-0.3525714285714286`);
  });

  it('should divide two rationals', () => {
    const a = ce._numericValue([-2, 10]);
    const b = a.div([-3, 5]);
    expect(b.re).toMatchInlineSnapshot(`0.3333333333333333`);
    // float / float = float
    expect(b.toString()).toMatchInlineSnapshot(`1/3`);
  });

  it('should divide a floats and an integer', () => {
    const a = ce._numericValue(-1.234);
    const b = a.div(3);
    expect(b.re).toMatchInlineSnapshot(`-0.41133333333333333`);
    // float / float = float
    expect(b.toString()).toMatchInlineSnapshot(`-0.41133333333333333`);
  });

  it('should divide a complex number', () => {
    const a = ce._numericValue({ im: 2 });
    const b = ce._numericValue(1).div(a);
    expect(`${b.re}, ${b.im}`).toMatch(`0, -0.5`);
    // integer / complex = complex
    expect(b.toString()).toMatchInlineSnapshot(`-0.5i`);
  });
});

describe('power', () => {
  it('should take an exact square root', () => {
    const s = ce._numericValue(3).sqrt();
    const a = ce._numericValue(11).mul(s);

    const b = a.pow(0.5);
    expect(b.re).toMatchInlineSnapshot(`4.36492369730075`);
    expect(b.toString()).toMatchInlineSnapshot(`4.36492369730075`);
  });
  it('should stay exact', () => {
    const s = ce._numericValue(3).sqrt();
    const a = ce._numericValue(8).mul(s);

    const b = a.pow(2);
    expect(b.re).toMatchInlineSnapshot(`192`);
    expect(b.toString()).toMatchInlineSnapshot(`192`);
  });
});
