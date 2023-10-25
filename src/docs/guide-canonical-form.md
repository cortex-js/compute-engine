---
title: Canonical Form
permalink: /compute-engine/guides/canonical-form/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: false
render_math_in_document: true
---

# Canonical Form

Many mathematical objects can be represented by several equivalent expressions.

For example, the expressions in each row below represent the same mathematical
object:

<div class="equal-width-columns">

|              |                              |                         |
| :----------: | :--------------------------: | :---------------------: |
| $$215.3465$$ | $$2.15346\operatorname{e}2$$ | $$2.15346 \times 10^2$$ |
|  $$1 - x$$   |          $$-x + 1$$          |      $$1 + (-x)$$       |
| $$-2x^{-1}$$ |       $$-\frac{2}{x}$$       |    $$\frac{-2}{x}$$     |

</div>

The Compute Engine stores expressions internally in a canonical form to simplify
comparisons and to make it easier to implement algorithms that work with
expressions.

The value of `expr.simplify()`, `expr.evaluate()` and `expr.N()` are canonical
expressions.

The `ce.box()` and `ce.parse()` functions return a canonical expression by
default, which is the desirable behavior in most cases.

**To get a non-canonical version of an expression** set the `canonical` option
of `ce.parse()` or `ce.box()` to `false`.

The non-canonical version will be closer to the literal LaTeX input, which may
be desirable to compare a "raw" user input with an expected answer.

```js
ce.parse('\\frac{30}{-50}');
// ➔ ["Rational", -3, 5]
// The canonical version moves the sign to the numerator 
// and reduces the numerator and denominator

ce.parse('\\frac{30}{-50}', { canonical: false });
// ➔ ["Divide", 30, -50]
// The non-canonical version does not change the arguments,
// so this is interpreted as a regular fraction ("Divide"), 
// not as a rational number.
```

The value of `expr.json` (the plain JSON representation of an expression) may 
not be in canonical form: some "sugaring" is applied to the internal 
representation before being returned, for example `["Power", "x", 2]` is
returned as `["Square", "x"]`.

You can customize how an expression is serialized to plain JSON by using
[`ce.jsonSerializationOptions`](/docs/guide-expressions#unboxing).

```js
const expr = ce.parse("\\frac{3}{5}");
console.log(expr.json)
// ➔ ["Rational", 3, 5]

ce.jsonSerializationOptions = { exclude: ["Rational"] };
console.log(expr.json);
// ➔ ["Divide", 3, 5]
// We have excluded `["Rational"]` expressions, so it 
// is interepreted as a division instead.
```

The canonical form of an expression is always the same when used with a given
Compute Engine instance. However, do not rely on the canonical form as future
versions of the Compute Engine could provide a different result.


**To check if an expression is canonical** use `expr.isCanonical`.

**To obtain the canonical representation of a non-canonical expression**, use
the `expr.canonical` property.

If the expression is already canonical, `expr.canonical` immediately returns
`expr`.


```js
const expr = ce.parse("\\frac{10}{30}", { canonical: false });
console.log(expr.json);
// ➔ ["Divide", 10, 30]

console.log(expr.isCanonical);
// ➔ false

console.log(expr.canonical);
// ➔ ["Rational", 1, 3]
```

## Canonical Form and Validity

The canonical form of an expression may not be **valid**. A canonical expression
may include `["Error"]` expressions, for example, indicating missing arguments,
excess arguments, or arguments of the wrong type.

For example the canonical form of `["Ln"]` is `["Ln", ["Error", "'missing'"]]`
and it is not a valid expression.

**To check if an expression is valid** use `expr.isValid`.

**To get a list of errors in an expression** use `expr.errors`.

```js
const expr = ce.parse("Ln");
console.log(expr.json);
// ➔ ["Ln", ["Error", "'missing'"]]
// The canonical form of `Ln` is not valid

console.log(expr.isCanonical);
// ➔ true

console.log(expr.isValid);
// ➔ false

console.log(expr.errors);
// ➔ [["Error", "'missing'"]]
```

## Canonical Form Transformations

The canonical form used by the Compute Engine follows common conventions. 
However, it is not always "the simplest" way to represent an expression.

Calculating the canonical form of an expression involves applying some 
rewriting rules to an expression to put sums, products, numbers, roots, 
etc... in canonical form. In that sense, it is similar to simplifying an 
expression with `expr.simplify()`, but it is more conservative in the 
transformations it applies.

Below is a list of some of the transformations applied to obtain the canonical
form:

- Idempotency: \\( f(f(x)) \to f(x) \\)
- Involution: \\( f(f(x)) \to x \\)
- Associativity: \\( f(a, f(b, c)) \to f(a, b, c) \\)
- **Literals**
  - Rationals are reduced, e.g. \\( \frac{6}{4} \to \frac{3}{2}\\)
  - The denominator of rationals is made positive, e.g. \\(\frac{5}{-11}
    \to \frac{-5}{11}\\)
  - A rational with a denominator of 1 is replaced with a number, e.g.
    \\(\frac{19}{1} \to 19\\)
  - Complex numbers with no imaginary component are replaced with a real number
- `Add`
  - Arguments are sorted
  - Sum of a literal and the product of a literal with the imaginary unit are
    replaced with a complex number.
- `Multiply`: Arguments are sorted
- `Negate`: `["Negate", 3]` \\(\to\\) `-3`
- `Power`
  - \\(x^{\tilde\infty} \to \operatorname{NaN}\\)
  - \\(x^0 \to 1\\)
  - \\(x^1 \to x\\)
  - \\((\pm 1)^{-1} \to -1\\)
  - \\((\pm\infty)^{-1} \to 0\\)
  - \\(0^{\infty} \to \tilde\infty\\)
  - \\((\pm 1)^{\pm \infty} \to \operatorname{NaN}\\)
  - \\(\infty^{\infty} \to \infty\\)
  - \\(\infty^{-\infty} \to 0\\)
  - \\((-\infty)^{\pm \infty} \to \operatorname{NaN}\\)
- `Square`: `["Power", "x", 2]` \\(\to\\) `["Square", "x"]`
- `Sqrt`: `["Sqrt", "x"]` \\(\to\\)`["Power", "x", "Half"]`
- `Root`:  `["Root", "x", 3]` \\(\to\\) `["Power", "x", ["Rational", 1, 3]]`
- `Subtract`: `["Subtract", "a", "b"]` \\(\to\\) `["Add", ["Negate", "b"], "a"]`

