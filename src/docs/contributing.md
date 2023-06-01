---
title: Contributing
permalink: /compute-engine/contributing/
read_time: false
layout: single
sidebar:
  - nav: "universal"
---


This would be _very_ welcome! There are many kinds of contribution that can make a difference. Listing them in roughly order of difficulty:

## Documentation

Contribute to the documentation. 

It's in the `/src/docs/` directory, as markdown files. 

The guides are explainers and "how-tos". The reference documentation is a 
description of each available function.

Some of it is incomplete, some is probably just wrong. Any addition/correction to it is super helpful. 

It could also be some examples, etc...

## Test Cases

Contribute test cases. 

There is a test suite right now, (in `/test/compute-engine`) but it would 
benefit from being extended. 

The test suite is run each time a change is made to the code, and the more complete it is, the less likely that a regression will be introduced (i.e. break something)


## Code Contributions

### Core Engine

That's the hardest part, because it really requires an understanding of the entire architecture. Thankfully, that's also probably the part that needs least contribution: it's pretty complete and robust right now.

### LaTeX Dictionary

Contribute to the default LaTeX dictionary. It's in `/src/compute-engine/latex-syntax/dictionary/`.

That's where a LaTeX expression is parsed into a MathJSON expression (or a MathJSON expression serialized into LaTeX). 

There's a decent dictionary already, but it could be extended with either new "idioms" or existing definitions could be made more robust or more complete. 

There are still a lot of mathematical expressions that can be expressed in LaTeX that cannot be understood by the LaTeX parser, so there's work to be done there.

### Standard Library

Contributing to the function dictionary. It's in `/src/compute-engine/library/`.


The Standard Library provides the definition of MathJSON functions like `Add` or `Sum`. 

There is much to do here, both in fleshing out what's there and adding new entries. 

For example, the entry for integral doesn't know how to do a numerical evaluation. That would be handy. 

Derivatives are also not supported yet, either symbolically or numerically. That would be super nice to have, and probably not too hard. Symbolic integration would be nice too, but that's a bit more complex 🙂

To contribute to this dictionary, a good way to approach it is to write a utility function in JavaScript taking a MathJSON expression as input and returning another MathJSON expression. This can be done without any knowledge/understanding of the internals of the Compute Engine, and once you have the JS function that does what you want, it's easy to plug in in the standard library so that it becomes part of the default engine.


```ts
export function numericAdd2(
  ce: IComputeEngine,
  lhs: BoxedExpression,
  rhs: BoxedExpression
) : BoxedExpression {
  if (lhs.isNaN || rhs.isNaN) return ce.number(NaN);

  if (ce.numericMode = "machine")
    return ce.number(asFloat(lhs) + asFloat(rhs));

  // Handle other cases (lhs.numericValue instanceof Decimal, Complex, Rational)
  return ...;
}

```

If you are looking for some inspiration, you can have a look at the issues that have been filed to see what others have requested, or you can just follow your interest. 

There's almost no statistical functions, for example (`Average`, `Mean`, `Variance`, `StdDev`, `Median`, `Quantile`...), linear-algebra (`Transpose`, `Determinant`, `Rank`...). Also, in the source file for the standard library, I have left some comments as to what some future functions would be nice to have. That can also be a source of inspiration.
