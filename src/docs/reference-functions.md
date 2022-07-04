---
title: Functions
permalink: /compute-engine/reference/functions/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
toc: false
---

## Functions

{% defs "Function" "Operation" %} 

{% def "Function" %}

<code>["Function", list-of-variables_, _body_]</code><br>
<code>["Function", _variable_, _body_]</code>

Create a [Lambda-function](https://en.wikipedia.org/wiki/Anonymous_function),
also called **anonymous function**.

The first argument is a symbol or a list of symbols which are the bound
variables (parameters) of the Lambda-function.

The others arguments are expressions which are evaluated sequentially, or until
a `["Return"]` expression is encountered.

The `["Function"]` expression creates a new scope.

**To apply some arguments to a function expression**, use `["Apply"]`.

{% enddef %} 


{% def "Apply" %}
<code>["Apply", _body_, _expr-1_, ..._expr-n_]</code>

[Apply](https://en.wikipedia.org/wiki/Apply) a list of arguments to a lambda expression or function.

The following wildcards in _body_ are replaced as indicated

- `\_` or `\_1` : the first argument
- `\_2` : the second argument
- `\_3` : the third argument, etc...
- `\_`: the sequence of arguments, so `["Length", "&#95;"]` is the number of arguments

If _body_ is a `["Function"]` expression, the named arguments of `["Function"]`
are replaced by the wildcards.


```json
["Apply", ["Multiply", "\_", "\_"], 3]
// ➔ 9
["Apply", ["Function", "x", ["Multiply", "x", "x"]], 3]
// ➔ 9
```

You can assign a Lambda expression to a symbol for later use:

```cortex
cube = Lambda(_ * _ * _)
cube(5)
// ➔ 125
```

{% enddef %} 


{% def "Return" %}
<code>["Return", _expression_]</code>

If in an `["Function"]` expression, interupts the evaluation of the function. 
The value of the `["Function"]` expression is _expression_

{% enddef %} 


{% enddefs %}

