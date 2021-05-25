# Fixed Point Parser

[Parser Combinator](https://en.wikipedia.org/wiki/Parser_combinator)

## Combinator

Using Combinators to build parsers.

The idea of a Combinator is that the things it combines and the combined thing
have the same type, so that you can invoke the Combinator again on the result of
the Combinator.

One of the popular areas where Combinators pop up is in parsing, with so-called
Parser Combinator libraries. The idea is that you build more complex parsers out
of simpler parsers, by using Combinators to build combinations of simpler
parsers.

For example, a Parser Combinator library might only provide one single simple
parser: a parser that can parse exactly one character. If you want to parse
anything more complex, the library provides a couple of Combinators:

- The Sequence Combinator takes two parsers and produces a parser that
  recognizes the string recognized by the first parser followed by the string
  recognized by the second parser.
- The Alternation Combinator takes two parsers and produces a parser that
  recognizes the string recognized by the first parser or the string recognized
  by the second parser.

The important thing here is that the Combinator returns a new parser. It does
not execute the parser.

In a functional language, both the parsers and the combinators will typically be
functions, and so the combinators will be higher-order functions. But, that
doesn't have to be the case. E.g. the parsers could be objects and the
combinators functions, that makes the combinators just ordinary functions.

So, with Combinators, you always have two things:

- a set of "primitives" of a specific "kind"
- a set of Combinators that take one or more values of that specific "kind" and
  return a value of that same specific "kind"

This combinator parser library is a _character parser_. It could be extended to
parse other kind of symbols, for example bytes.

It includes support for "fancy" characters, that is some Unicode characters that
can be mapped to one or more ASCII characters.

## Lexical and Syntactic analysis

Now that we have taken care of the lexical analysis, we are still missing the
Syntactic analysis step, i.e. transforming a sequence of tokens into an abstract
syntax tree (AST). Unlike RegexParsers which generate String parsers, we will be
needing a WorkflowToken parser.
