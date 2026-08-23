"""Patch boxed-function.ts so that, when CE_WITHHOLD is set, every operand handed
to a `type` handler is wrapped in a proxy that withholds ONE fact family:

  sgn      sign from every source (literal value, held value, assumptions)
  literal  the value of a finite number literal other than 0 and 1 — the
           literal looks like a valueless operand of the same static type
  closed   closedness (`isConstant`, `unknowns`)
  finite   finiteness beyond what the static type proves (NaN literal, held value)
"""
import sys
p = sys.argv[1]
s = open(p).read()
old = """      const calculatedType = def.type(expr.ops, {
        engine: expr.engine,
        operandTypes,
      });
"""
new = """      const calculatedType = def.type(
        process.env.CE_WITHHOLD ? expr.ops.map(withholdFact) : expr.ops,
        {
          engine: expr.engine,
          operandTypes,
        }
      );
"""
assert s.count(old) == 1
s = s.replace(old, new)
s += r"""

// EXPERIMENT (not for landing): withhold one fact family from type handlers.
const SGN_GETTERS = ['sgn', 'isPositive', 'isNegative', 'isNonNegative', 'isNonPositive'];
const LITERAL_GETTERS: Record<string, unknown> = {
  _kind: 'withheld', isNumberLiteral: false, numericValue: undefined,
  re: NaN, im: NaN, isEven: undefined, isOdd: undefined, bignumRe: undefined,
};
const LITERAL_METHODS = new Map<string, unknown>([
  ['isSame', false], ['is', false], ['isEqual', undefined], ['isLess', undefined],
  ['isGreater', undefined], ['isLessEqual', undefined], ['isGreaterEqual', undefined],
]);
function withholdFact(x: Expression): Expression {
  const mode = process.env.CE_WITHHOLD;
  const overrides: Record<string, unknown> = {};
  const methods = new Map<string, unknown>();
  if (mode === 'sgn') {
    for (const g of SGN_GETTERS) overrides[g] = undefined;
  } else if (mode === 'literal') {
    if (x._kind === 'number') {
      const v = Reflect.get(x, 're', x);
      const im = Reflect.get(x, 'im', x);
      const finite = typeof v === 'number' && Number.isFinite(v) && im === 0;
      if (finite && v !== 0 && v !== 1) {
        Object.assign(overrides, LITERAL_GETTERS);
        for (const [k, r] of LITERAL_METHODS) methods.set(k, r);
      }
    }
  } else if (mode === 'closed') {
    overrides.isConstant = false;
    overrides.unknowns = ['_withheld'];
  } else if (mode === 'finite') {
    const t = x.type;
    const isNum = t.matches('number');
    overrides.isFinite = !isNum
      ? false
      : t.matches('finite_number')
        ? true
        : t.matches('non_finite_number')
          ? false
          : undefined;
    overrides.isNaN = t.matches('finite_number') ? false : undefined;
    overrides.isInfinity = t.matches('non_finite_number')
      ? true
      : t.matches('finite_number')
        ? false
        : undefined;
  } else {
    return x;
  }
  if (Object.keys(overrides).length === 0 && methods.size === 0) return x;
  return new Proxy(x, {
    get(t, prop) {
      if (typeof prop === 'string') {
        if (prop in overrides) return overrides[prop];
        if (methods.has(prop)) {
          const r = methods.get(prop);
          return () => r;
        }
      }
      // Receiver is the TARGET, so getters backed by private fields still work.
      return Reflect.get(t, prop, t);
    },
  });
}
"""
open(p, 'w').write(s)
print('patched')
