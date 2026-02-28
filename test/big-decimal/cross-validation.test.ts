/**
 * Cross-validation: BigDecimal vs Decimal.js
 *
 * Compares results at precisions 50, 100, and 500 for all key operations.
 * For each comparison, both libraries compute at the same precision, then
 * the first `precision - 10` significant digits are compared (allowing for
 * normal rounding differences in the tail).
 */

import { BigDecimal } from '../../src/big-decimal';
import { Decimal } from 'decimal.js';

// ---------- Comparison helper ----------

/**
 * Extract significant digits from a numeric string.
 * Strips sign, decimal point, leading zeros, and trailing zeros.
 * Returns only the significant digit sequence.
 */
function significantDigits(s: string): string {
  // Remove sign
  if (s.startsWith('-') || s.startsWith('+')) s = s.slice(1);

  // Handle scientific notation: normalize to plain digits
  const eIdx = s.search(/[eE]/);
  if (eIdx !== -1) {
    // Extract mantissa digits (ignore exponent for digit comparison)
    s = s.slice(0, eIdx);
  }

  // Remove decimal point
  s = s.replace('.', '');

  // Remove leading zeros
  s = s.replace(/^0+/, '');

  return s;
}

/**
 * Compare the first `matchDigits` significant digits of two numeric strings.
 * Returns true if they match.
 */
function compareDigits(
  ours: string,
  theirs: string,
  matchDigits: number
): boolean {
  const ourDigits = significantDigits(ours);
  const theirDigits = significantDigits(theirs);

  const ourSlice = ourDigits.slice(0, matchDigits);
  const theirSlice = theirDigits.slice(0, matchDigits);

  return ourSlice === theirSlice;
}

/**
 * Format a comparison failure message showing where the digits diverge.
 */
function diffMessage(
  label: string,
  ours: string,
  theirs: string,
  matchDigits: number
): string {
  const ourDigits = significantDigits(ours);
  const theirDigits = significantDigits(theirs);

  // Find first divergence point
  let divergeAt = -1;
  const len = Math.min(ourDigits.length, theirDigits.length, matchDigits);
  for (let i = 0; i < len; i++) {
    if (ourDigits[i] !== theirDigits[i]) {
      divergeAt = i;
      break;
    }
  }

  return [
    `${label}: digits diverge at position ${divergeAt} (of ${matchDigits} required)`,
    `  BigDecimal: ${ours}`,
    `  Decimal.js: ${theirs}`,
    `  BD digits:  ${ourDigits.slice(0, matchDigits)}`,
    `  DJ digits:  ${theirDigits.slice(0, matchDigits)}`,
  ].join('\n');
}

// ---------- Test runner ----------

const PRECISIONS = [50, 100, 500];

/**
 * Save and restore precision for both libraries.
 */
function withPrecision<T>(prec: number, fn: () => T): T {
  const savedBD = BigDecimal.precision;
  const savedDJ = Decimal.precision;
  try {
    BigDecimal.precision = prec;
    Decimal.set({ precision: prec });
    return fn();
  } finally {
    BigDecimal.precision = savedBD;
    Decimal.set({ precision: savedDJ });
  }
}

// ================================================================
// Division
// ================================================================

describe('Cross-validation: Division', () => {
  for (const prec of PRECISIONS) {
    const matchDigits = prec - 10;

    test(`1/7 at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('1').div(new BigDecimal('7')).toString();
        const theirs = new Decimal('1').div('7').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
        if (!compareDigits(ours, theirs, matchDigits)) {
          console.log(diffMessage('1/7', ours, theirs, matchDigits));
        }
      });
    });

    test(`1/3 at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('1').div(new BigDecimal('3')).toString();
        const theirs = new Decimal('1').div('3').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`22/7 at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('22').div(new BigDecimal('7')).toString();
        const theirs = new Decimal('22').div('7').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });
  }
});

// ================================================================
// Square root
// ================================================================

describe('Cross-validation: Square root', () => {
  for (const prec of PRECISIONS) {
    const matchDigits = prec - 10;

    test(`sqrt(2) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('2').sqrt().toString();
        const theirs = Decimal.sqrt('2').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`sqrt(3) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('3').sqrt().toString();
        const theirs = Decimal.sqrt('3').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`sqrt(0.5) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('0.5').sqrt().toString();
        const theirs = Decimal.sqrt('0.5').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });
  }
});

// ================================================================
// Exponential
// ================================================================

describe('Cross-validation: Exponential', () => {
  for (const prec of PRECISIONS) {
    const matchDigits = prec - 10;

    test(`exp(1) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('1').exp().toString();
        const theirs = Decimal.exp('1').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`exp(0.5) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('0.5').exp().toString();
        const theirs = Decimal.exp('0.5').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`exp(-1) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('-1').exp().toString();
        const theirs = Decimal.exp('-1').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`exp(10) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('10').exp().toString();
        const theirs = Decimal.exp('10').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });
  }
});

// ================================================================
// Natural log
// ================================================================

describe('Cross-validation: Natural log', () => {
  for (const prec of PRECISIONS) {
    const matchDigits = prec - 10;

    test(`ln(2) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('2').ln().toString();
        const theirs = Decimal.ln('2').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`ln(10) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('10').ln().toString();
        const theirs = Decimal.ln('10').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`ln(0.5) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('0.5').ln().toString();
        const theirs = Decimal.ln('0.5').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });
  }
});

// ================================================================
// Sine
// ================================================================

describe('Cross-validation: Sine', () => {
  for (const prec of PRECISIONS) {
    const matchDigits = prec - 10;

    test(`sin(1) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('1').sin().toString();
        const theirs = Decimal.sin('1').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`sin(0.5) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('0.5').sin().toString();
        const theirs = Decimal.sin('0.5').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`sin(2) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('2').sin().toString();
        const theirs = Decimal.sin('2').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });
  }
});

// ================================================================
// Cosine
// ================================================================

describe('Cross-validation: Cosine', () => {
  for (const prec of PRECISIONS) {
    const matchDigits = prec - 10;

    test(`cos(1) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('1').cos().toString();
        const theirs = Decimal.cos('1').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`cos(0.5) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('0.5').cos().toString();
        const theirs = Decimal.cos('0.5').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`cos(2) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('2').cos().toString();
        const theirs = Decimal.cos('2').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });
  }
});

// ================================================================
// Arctangent
// ================================================================

describe('Cross-validation: Arctangent', () => {
  for (const prec of PRECISIONS) {
    const matchDigits = prec - 10;

    test(`atan(1) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('1').atan().toString();
        const theirs = Decimal.atan('1').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`atan(0.5) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('0.5').atan().toString();
        const theirs = Decimal.atan('0.5').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });

    test(`atan(2) at precision ${prec}`, () => {
      withPrecision(prec, () => {
        const ours = new BigDecimal('2').atan().toString();
        const theirs = Decimal.atan('2').toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });
  }
});

// ================================================================
// PI
// ================================================================

describe('Cross-validation: PI', () => {
  for (const prec of PRECISIONS) {
    const matchDigits = prec - 10;

    test(`PI at precision ${prec}`, () => {
      withPrecision(prec, () => {
        // BigDecimal.PI is a hardcoded constant; truncate to working precision
        // by converting through division (PI * 1 forces precision-limited output)
        const ours = BigDecimal.PI.div(BigDecimal.ONE).toString();
        const theirs = Decimal.acos(-1).toString();
        expect(compareDigits(ours, theirs, matchDigits)).toBe(true);
      });
    });
  }
});
