---
title: Symbolic Computing
permalink: /guides/compute-engine/numerical-evaluation/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---


## Numerical Evaluation

**To obtain a numerical approximation of the value of an expression**, use the
`ComputeEngine.N()` function.

- Due to limitations in the representation of numbers, some arithmetic
  operations cannot produce exact results. For example, \\(\frac{1}{3} \approx
  1.333333333\\). Because the machine representation of floating points is using
  a binary format (and not the base-10 we are used to), the results may
  sometimes be surprising. For example, \\(0.1 + 0.2 = 0.30000000000000004 \\).
- No rewriting of the expression is done before attempting to evaluate it.
  Because of the limitations on the representation of numbers, the result may
  again be surprising, for example \\( x - x = 2.7755575615628914\cdot 10^{-17}\\)
   when \\( x = 0.1 + 0.2\\). The result from `ComputeEngine.simplify()` would
  be \\( 0 \\).
