---
title: Canonical Form
permalink: /compute-engine/guides/canonical-form/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
---

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
the implementation of some algorithms.

The value of `expr.simplify()`, `expr.evaluate()` and `expr.N()` are canonical
expressions.

The `ce.box()` and `ce.parse()` functions return a canonical expression by
default, which is the desirable behavior in most cases.

**To get a non-canonical version of an experssion** set the `canonical` option
of `ce.parse()` or `ce.box()` to `false`.

The non-canonical version will be closer to the literal LaTeX input, which may
be desirable to compare a "raw" user input with an expected answer.

```js
ce.parse('\\frac{3}{-5}');
// ➔ ["Rational", -3, 5]
// The canonical version moves the sign to the numerator

ce.parse('\\frac{3}{-5}', { canonical: false });
// ➔ ["Divide", 3, -5]
// The non-canonical version does not change the arguments, so this is
// interpreted as a regular fraction ("Divide"), not a rational.
```

The value of `expr.json` may not be strictly in canonical form: some "sugaring"
is applied to the internal representation before being returned, for example
`["Add", -1, "x"]` may be returned as `["Subtract", "x ", 1]`.

You can further customize how an expression is interpreted by using
[`ce.jsonSerializationOptions`](/docs/guide-expressions#unboxing).

```js
ce.parse('\\frac{3}{5}', { canonical: false });
// ➔ ["Rational", 3, 5]
// This is a rational without modifying the arguments, so a `["Rational"]`
// expression is returned

ce.jsonSerializationOptions = { exclude: ["Rational"] };
ce.parse('\\frac{3}{5}', { canonical: false });
// ➔ ["Divide", 3, 5]
// We've excluded `["Rational"]` expressions, so it is interepreted as a
// division instead.
```

The canonical form of an expression is always the same when used with a given
Compute Engine instance. However, do not rely on the canonical form as future
versions of the Compute Engine could provide a different result.

**To obtain the canonical representation of an non-canonical expression**, use
the `expr.canonical` property.

```js
console.log(ce.box(["Add", 2, "x", 3]).canonical);
// ➔ ["Add", 5, "x"]
```

**To check if an expression is canonical** use `expr.isCanonical`.

If the expression is already canonical, `expr.canonical` immediately returns
`expr`.

## Canonical Form Transformations

The canonical form used by the Compute Engine follows common conventions. It is
not always "the simplest" way to represent an expression.

Calculating the canonical form of an expression is applying some rewriting rules
to an expression to put sums, products, numbers, roots, etc... in canonical
form. In that sense, it is similar to simplifying an expression with
`expr.simplify()`, but it is more conservative in the transformations it
applies, and it will not take into account any assumptions about symbols or
their value.

Below is a list of some of the transformations applied to obtain the canonical
form:

- Idempotency: \\( f(f(x)) \to f(x) \\)
- Involution: \\( f(f(x)) \to x \\)
- Associativity: \\( f(a, f(b, c)) \to f(a, b, c) \\)
- **Literals**
  - Rationals are reduced, e.g. \\[(\frac{6}{4} \longrightarrow \frac{3}{2}\\]
  - The denominator of rationals is made positive, e.g. \\[(\frac{5}{-11}
    \longrightarrow \frac{-5}{11}\\]
  - A rational with a denominator of 1 is replaced with a number, e.g.
    \\[(\frac{19}{1} \longrightarrow 19\\]
  - Square roots of rationals have their perfect squared factored out, e.g.
    \\[(\sqrt{63} \longrightarrow 3\sqrt{7}\\]
  - Complex numbers with no imaginary component are replaced with a real number
- `Abs`
  - The absolute value of literals is evaluated
- `Add`
  - Arguments are sorted
  - Literal `0` is removed
  - Sum of a literal and the product of a literal with the imaginary unit are
    replaced with a complex number.
- `Multiply`
  - Arguments are sorted
  - $x \times x$ is replaced with `["Square", x]`
  - The product of two integers literals is evaluated **But not exact literals?
    I.e. rationals or Square Root of fractional?**
    - If any argument is `NaN` or `Undefined` evaluates to `NaN` **Might be too
      aggressive**
- `Divide`
- `Power`
  - $x^{\tilde\infty} \longrightarrow \operatorname{NaN}$
  - $x^0 \longrightarrow 1$
  - $x^1 \longrightarrow x$
  - $(\pm 1)^{-1} \longrightarrow -1$
  - $(\pm\infty)^{-1} \longrightarrow 0$
  - $0^{\infty} \longrightarrow \tilde\infty$
  - $(\pm 1)^{\pm \infty} \longrightarrow \operatorname{NaN}$
  - $\infty^{\infty} \longrightarrow \infty$
  - $\infty^{-\infty} \longrightarrow 0$
  - $(-\infty)^{\pm \infty} \longrightarrow \operatorname{NaN}$
- `Square`
- `Sqrt`
- `Root`
- `Subtract`
- `Negate`

- For `Multiply`, literal 1 is removed, small integers and small rations are
  multiplied together.
- For `Divide`, replaced by `Multiply` / `Power`
- For `Subtract`, replaced by `Add`
- For `Sqrt` and `Root`, replaced by `Power`
