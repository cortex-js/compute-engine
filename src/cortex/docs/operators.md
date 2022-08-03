---
title: Cortex Operators
permalink: /cortex/operators/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Operators

Most operators are infix operators: they have two operands, a left-hand side
(lhs) operand and a right-hand side operand (rhs).

An infix operator can either have whitespace before and after the operator or
have no whitespace neither before nor after the operator.

Infix operators have a precedence that indicate how strongly they bind to their
operand and a left or right associativity.

A few operators are prefix operators: they only have a right-hand side. Prefix
operators are followed immediately by their operand: they cannot be separated by
whitespace.

The whitespace rules are necessary to support unambiguous parsing of expressions
spanning multiple lines without requiring a separator between expressions
{.notice--info}


## Precedence

The operator at the root of the parse tree has the lowest precedence.


## Arithmetic Operations

- `+`, `-`, `/`, `*`, `^`

## Logic Operations

- `and`, `or`, `not`, `=>`, `<=>`


## Relational Operators

- `<`, `<=`, `=`, `>=`, '`>`, '!='
- `==`, '!=='
