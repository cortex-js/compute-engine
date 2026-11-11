# Event handlers in Epsil

Status: decisions D1 to D15 and choices C1 to C6 are approved (2026-11-10).
No code is written.

## 1. Purpose

A host of the Compute Engine has events: Tycho has a click on a series, the
command-line tool has "the program is loaded" and "the program stops". This
note proposes a way to write the response to an event in Epsil, and a way to
send an event:

```epsil
let count = 0

on click(event) {
  count = count + 1
  last = event.point
}

on click(self, target, parent) {
  if self === target { send selected }
  send click to parent
}

on quit {
  Print("clicked", count, "times")
}
```

Epsil defines the two statements, stores the handlers and collects the sent
events. The host defines every event, decides which handler receives an event
and when, and calls it. Epsil defines no event of its own and has no dispatch
function.

## 2. The model

1. **An event is a one-way message.** A handler gives no value to the sender
   or to the host. `send` is a statement and has no value.
2. **The time of delivery is not guaranteed.** The host can run a handler at
   once or later. A program must not depend on a handler having run when the
   statement after a `send` runs.
3. **A handler runs to its end before another handler of the same engine
   starts.** The events that one handler sends are delivered after it ends,
   in the order it sent them.
4. **An event that has a target is received by one handler** (the HyperTalk
   rule). The host offers the event to the objects of its path, the most
   specific first: the first object that has a handler for the name receives
   it, and the event goes no further.
5. **An event that has no target is received by every handler context that
   has a handler for it** (`init`, `screenGeometryChanged`), in an order that
   is not guaranteed. Rule 3 still holds.
6. **A handler propagates an event with `send`**, to its parent or to any
   other object. There is no `pass` statement.
7. **Handlers run in the thread of the engine.** A handler in a worker is not
   in the first version: a handler assigns to variables of an enclosing
   scope, and a worker has no access to them.

Rules 4 and 5 are conventions for a host: the engine has no dispatch function
(section 6.3), so it cannot check them.

## 3. What a handler is

A handler is a function that is stored under an event name in a handler set
(section 6.1). It differs from a `function` in four points:

1. **It is not a binding.** The handler `click` and a variable `click` do not
   collide, and a handler cannot be read or called by name from Epsil code.
   A handler set is not a scope and holds no bindings.
2. **The host calls it.** An Epsil program reaches a handler only with
   `send`, and the host decides which handler that is.
3. **Its purpose is an effect.** Its body can assign to a variable of an
   enclosing scope without an effect specifier (decision D2). The value of
   its body is not used.
4. **It is declared at the top level of a program only.**

Its body follows the other rules of a function body: it closes over the scope
where it is declared, and its parameters are locals.

## 4. Syntax

### 4.1 `on`

```
on <event-name> [ ( <arguments> ) ] { <body> }
```

- `<event-name>` is one or more names joined by dots: `click`, `plot.click`,
  `series.marker.click`. The dotted name is one string; the dot is not the
  member access of an expression here. A host uses the prefix as its
  namespace. A name with a hyphen (`screen-geometry-changed`) is not an event
  name: the hyphen is the minus operator.
- The argument list is optional: `on quit { … }` is `on quit() { … }`. It can
  hold only the names `self`, `target`, `parent` and `event`, in any order
  (section 6.5).
- `on` is a contextual keyword. It starts a handler declaration only at the
  start of a statement and when a name follows it on the same line. In every
  other position it stays an ordinary identifier.
- An `on` statement is allowed only at the top level of a program: it is one
  of the statements of the program, not a statement of a block, a function
  body, a branch or a loop. In another position it is the error
  `handler-not-at-top-level`. The handlers of a program are therefore known
  from its source, without running it. The program is the binding unit "one
  program" of `docs/plans/2026-11-09-binding-units-model.md`.

A handler declaration is a statement, not an expression.

### 4.2 `send`

```
send <event-name> [ to <recipient> ] [ with <record> ]
```

```epsil
send reset
send click to parent
send click to parent with {point -> {x -> 12, y -> 45}}
send marker.click with {index -> 3}
```

- `<event-name>` has the form of section 4.1.
- `<recipient>` is an expression. Its value is one of the values that the host
  uses to denote its objects (section 10.1): usually `parent`, `self`,
  `target` or a value of the `event` record. Without `to`, the host chooses
  the recipient.
- `<record>` is an expression that gives a record. The host builds the
  `event` record of the receiving handler from it.
- `to` and `with` are words of the `send` statement, in this order. They are
  not named arguments.
- `send` is a contextual keyword, with the rule of `on`: it starts a `send`
  statement only at the start of a statement and when a name follows it on
  the same line.
- A `send` statement is allowed wherever a statement is: in a handler, in a
  function, at the top level of a program.

**A `send` to `Nothing` is delivered to no one.** The `parent` of an object
that has no parent is `Nothing`, so `send click to parent` in the last object
of a path ends the propagation.

**A `send` that forwards.** In a handler of the event `E`, a `send E` with no
`with` clause forwards the event that the handler is handling: the receiving
handler gets the same `target` and the same `event` record. This is what
`pass` does in HyperTalk:

```epsil
on click(self, target, parent) {
  if self === target { highlight(self) }
  send click to parent      // the parent's handler sees the same target
}
```

Every other `send` is a new event. Its `target` is its recipient, and its
`event` record comes from the `with` clause.

### 4.3 Existing programs

These statements break no existing program. With the parser of commit
`dd345dbc6e46441039d485ca24890d3b01db6e87` (`src/epsil/parse-epsil.ts`,
`parseEpsil()`):

- `on quit { 1 }`, `on click(event) { 1 }` and `on plot.click(event) { 1 }`
  each give the error `unexpected-symbol` on the name after `on`;
- `send click`, `send click to parent` and `send click with {a -> 1}` each
  give the error `unexpected-symbol` on the name after `send`;
- `on = 5` and `send = 5` parse as assignments, `on(3)` and `send(3)` as
  calls, and `send` alone as a symbol.

`on`, `to`, `with` and `self` are in the list of reserved words of
`src/epsil/docs/literals.md`. `send`, `target`, `parent` and `event` are not,
and this proposal does not reserve them.

## 5. MathJSON forms

```json
["DefineHandler", "'plot.click'", ["Function", body, "event"]]
```

The form follows `DefineFunction` (`src/compute-engine/library/core.ts`): the
operator is lazy, has the `scope` effect and gives `Nothing`. The event name is
a string, not a symbol, because it is not a binding. A host can build this
expression directly, so a handler does not need Epsil source. The Epsil
serializer writes it back as `on plot.click(event) { … }`.

A `DefineHandler` is valid as the whole expression that the host evaluates,
or as a direct operand of the `Block` that the host evaluates as a program.
A second `DefineHandler` for the same name in the same handler set replaces
the first.

```json
["Send", "'click'"]
["Send", "'click'", ["Dictionary", ["KeyValuePair", "'to'", "parent"]]]
["Send", "'click'",
  ["Dictionary",
    ["KeyValuePair", "'to'", "parent"],
    ["KeyValuePair", "'with'", ["Dictionary", …]]]]
```

`Send` is lazy and gives `Nothing`. Its second operand holds the clauses of
the statement: the key `to` is present only when the statement has a `to`
clause, and the key `with` only when it has a `with` clause. The two cases
"no `to` clause" and "a recipient whose value is `Nothing`" are then
different expressions.

## 6. Host interface

All names in this section are proposals.

### 6.1 The handler context: `withHandlers()`

Two questions about a handler have different answers:

- **Which names does its body see?** The lexical scope where the `on`
  statement is written, as for a function.
- **Which object does it belong to?** The handler context that the host set
  for the program that holds the `on` statement.

The two must be apart. In a document, the cell of a series defines names that
other cells read (`f(x) = …`), so the cell cannot run in a scope of its own;
but its `on click` handler belongs to that series only.

The host sets the handler context around the work that it does for one of its
objects:

```ts
const seriesContext: HandlerContext = {
  handlers: ce.createHandlerSet(),
  self: series,
  parent: plot,
  events: plotEvents,
  send: (message) => queue.push(message),
};

ce.withHandlers(seriesContext, () => executeEpsil(ce, source));
```

```ts
interface HandlerContext {
  // Where the `on` statements put their handlers.
  handlers: HandlerSet;
  // The value of `self` in each handler of this context: the object that
  // owns the handlers. Default: `Nothing`.
  self?: Expression;
  // The value of `parent` in each handler of this context: the next object
  // of the path. Default: `Nothing`.
  parent?: Expression;
  // The events that an `on` or a `send` statement can name, and the type of
  // the `event` record of each.
  events: Record<string, { event?: string }>;
  // The types of `self`, `target` and `parent`, for the static check.
  // Default: `any`.
  selfType?: string;
  targetType?: string;
  parentType?: string;
  // Receives each event that a `send` statement of this context sends
  // (section 6.4).
  send?: (message: SentEvent) => void;
}

const plotEvents = {
  click: { event: 'record{point: record{x: real, y: real}, shift: boolean}' },
  'marker.click': { event: 'record{index: integer}' },
  selected: {},
};
```

- The context is a parallel of the lexical scope: `ce.withHandlers()` sets it
  for the duration of the function, and an inner call replaces it until it
  returns. It changes how the `on` and `send` statements are read and nothing
  else.
- An expression is bound to the context when it is boxed. A handler is put in
  the set when its `on` statement is evaluated. An asynchronous program
  (`executeEpsilAsync()`) keeps the context that was set when it started,
  although `withHandlers()` has returned when its later statements run.
- The host can use one `events` table for many contexts, and one context per
  object.
- Outside every `withHandlers()` call, the context is the default context of
  the engine: the set `ce.handlers`, no event and no `send` function.
- The engine gives no meaning to `self` and `parent`. Only the host has the
  relation between an object, its context and its path.

### 6.2 Handler sets and handlers

```ts
interface HandlerSet {
  get(name: string): Handler | undefined;  // "is there a handler named foo"
  names(): string[];
  delete(name: string): boolean;
  clear(): void;
}

interface Handler {
  name: string;
  call(args?: { target?: Expression; event?: Expression }): Expression;
  callAsync(args?: { target?: Expression; event?: Expression }): Promise<Expression>;
}
```

- `names()` lets a host show that an object responds to an event, for
  example a pointer cursor on a series that has a `click` handler.
- `clear()` is for a source that is run again: the host empties the set of a
  cell before it runs the cell, so a handler that the user deleted from the
  source does not stay.
- `call()` gives `Nothing`, or the `Error` value when the body gives one. The
  value of the body is not given (rule 1). `call()` does not throw for an
  error of the program.
- `call()` and `callAsync()` throw `handler-running` when a handler of the
  same engine has not ended (rule 3). The host keeps the events that arrive
  during a handler and calls their handlers after it ends.

### 6.3 Delivery belongs to the host

The engine has no dispatch function, and handler sets have no parent. The
host writes the rule of each of its events.

**An event that has a target** (rule 4). The host walks the path from the
target and calls the first handler:

```ts
for (const context of pathFrom(series)) {
  const h = context.handlers.get('click');
  if (h) {
    h.call({ target: series, event: { point, shift } });
    break;
  }
}
```

In the handler of the plot, `target` is the series and `self` is the plot.
In the handler of the series, both are the series.

**An event that has no target** (rule 5). The host calls the handler of every
context that has one:

```ts
for (const context of allContexts)
  context.handlers.get('screenGeometryChanged')?.call({ event: { width, height } });
```

In each handler, `target` is `self`. A handler of such an event does not
propagate it: every context already received it.

### 6.4 Sent events

```ts
interface SentEvent {
  name: string;
  // The context of the handler that sent the event; for a `send` outside a
  // handler, the context that its expression was bound to.
  from: HandlerContext;
  // The value of the `to` clause. Absent when the statement has none.
  to?: Expression;
  // The value of the `with` clause. Absent when the statement has none.
  with?: Expression;
  // Present when the `send` forwards the event that its handler is handling
  // (section 4.2): the `target` and the `event` record of that event.
  forwarded?: { target: Expression; event: Expression };
}
```

- The engine evaluates the `to` and `with` clauses when the `send` statement
  runs, and gives the message to the `send` function of the context `from`.
- The messages of a handler are given after the handler ends, in the order
  of its `send` statements (rule 3). When the body ends with an error, the
  messages that it sent before the error are still given, as its assignments
  before the error stay.
- The message of a `send` outside a handler (a top-level statement of a
  program) is given at once. The host must not call a handler from its `send`
  function while a handler runs; `handler-running` reports that mistake.
- A `send` whose recipient is `Nothing` gives no message (section 4.2).
- A `send` in a context that has no `send` function is the run-time error
  `send-unavailable`.
- The host finds the recipient: the handler context of the value `to`, or,
  without `to`, the recipient that its rule for this event gives. It then
  delivers the event by the rule of section 6.3. A recipient that has no
  handler for the name is the host's case to decide; with the HyperTalk rule,
  the event goes on along the path from the recipient.

### 6.5 The arguments of a handler

Every handler of every event has the same four arguments:

| Name     | Value                                    | Comes from                         |
| -------- | ---------------------------------------- | ---------------------------------- |
| `self`   | the object that owns the handler         | the handler context                |
| `target` | the object that the event is about       | `call()`; default: `self`          |
| `parent` | the next object of the path after `self` | the handler context                |
| `event`  | a record with the details of this event  | `call()`; default: an empty record |

An `on` statement lists the arguments that its body uses, by name and in any
order: `on click(event) { … }`, `on click(self, target) { … }`,
`on quit { … }`. Another name in the list is the error
`unknown-handler-argument`. A name that is not in the list is not bound, so
a variable `event` or `target` of the document stays visible in a handler
that does not list that name.

When the context declares the event, the static check gives `event` the
record type of the declaration, so `event.pont` is an error before the
program runs. `self`, `target` and `parent` have the types `selfType`,
`targetType` and `parentType`.

An `on` or a `send` statement for an event that the context does not declare
gives the warning `unknown-event` (decision D1). The handler is stored and
the event is sent, so a program can have events of its own (`on reset` with
`send reset`). The `event` of such a handler has the type `record`.

### 6.6 The command-line tool

The command-line tool runs a program in one context that declares `init` and
`quit`, with no `self` and no `parent`. Its `send` function delivers an event
to the handler of the program for that name, if there is one.

- `init` is delivered after the top-level statements of the program have run.
  A handler exists only when its `on` statement has run, so `init` cannot be
  delivered before the first statement.
- `quit` is delivered after `init` and the events that the handlers sent,
  before the process ends.

## 7. Decisions

- D1: an event that the host did not declare is the warning `unknown-event`;
  the handler is stored. approved 2026-11-09, confirmed 2026-11-10 with this
  condition: if the warning is difficult to implement, it is dropped and such
  an event gives no diagnostic.
- D2: a handler has the `scope` effect without a specifier. approved
  2026-11-09
- D3: replaced by D9.
- D4: no decision needed. A handler has no LaTeX form in the first version; a
  LaTeX cell cannot declare one. Handlers are statements with effects, and
  the LaTeX syntax has no block statement to carry them.
- D5 (section 10.2): arguments bound by name. approved 2026-11-09
- D6 (section 10.3): the host names the owner of a handler at boxing.
  approved 2026-11-09
- D7: every handler has the same arguments; the details of an event are
  fields of the `event` record (section 6.5). approved 2026-11-10. The
  arguments are `self`, `target`, `parent` and `event` (D10).
- D8: the host sets the handler context with `ce.withHandlers()` (section
  6.1). approved 2026-11-10
- D9: the model of section 2: one-way messages, no guaranteed time of
  delivery, one receiver for an event that has a target, propagation with
  `send`, no `pass`. The syntax `send <event-name> [to <recipient>]
  [with <record>]`. approved 2026-11-10
- D10: `parent` is the fourth argument. approved 2026-11-10
- D11: a handler runs to its end before another starts; sent events are
  delivered after the handler ends, in order (rule 3). approved 2026-11-10
- D12: no handler in a worker in the first version (rule 7). approved
  2026-11-10
- D13: a `send` of the event being handled, with no `with` clause, forwards
  it with the same `target` and `event` record (section 4.2). approved
  2026-11-10
- D14: an `on` statement is allowed at the top level of a program only
  (section 4.1). approved 2026-11-10
- D15: an event that has no target is delivered to every context that has a
  handler for it, as a convention for the host (rule 5). approved 2026-11-10

Choices of this revision, approved 2026-11-10. Each one is the option that
the rest of the note assumes:

- C1: the clauses of `Send` are a dictionary operand (section 5). The
  alternative is positional operands, where an absent `to` clause and a
  recipient `Nothing` are the same expression.
- C2: a `send` to `Nothing` is delivered to no one (section 4.2). The
  alternative leaves that case to the host; `send click to parent` in the
  last object of a path could then come back to the sender.
- C3: the engine refuses a `call()` during another handler with
  `handler-running` (section 6.2). The alternative states rule 3 as a duty
  of the host and checks nothing.
- C4: a `send` in a function uses the context of the running handler, and
  the forwarding rule applies there too (sections 4.2 and 6.4). The
  alternative uses the context that the function was boxed in; a shared
  function of the document would then send as the document, not as the
  series whose handler called it.
- C5: the command-line tool delivers `init` after the top-level statements
  (section 6.6). The earlier text delivered it before the first statement,
  when no handler is stored yet. The alternative registers the handlers of a
  program before its first statement; an `init` handler would then read
  variables that have no value yet.
- C6: a handler is stored when its `on` statement is evaluated, although it
  could be stored at boxing now that it is at the top level (section 6.1).
  A program that stops with an error before an `on` statement does not have
  that handler.

## 8. What is not in this proposal

- **Compilation.** A handler runs once per user action. It runs in the
  interpreter, and the compile targets do not change. A compilation of a
  program that holds a `DefineHandler` or a `Send` declines.
- **What the host does after a handler changed a variable.** Tycho must
  decide whether the new value is saved with the document, whether undo
  restores the old value, and how it finds the cells to evaluate again. The
  engine reports nothing more than it reports for any assignment.
- **Handlers in a worker** (rule 7).
- **A capture phase.** An outer object does not get an event before its
  target. A host that needs it can add a rule of its own; the `on` statement
  has no phase marker.
- **A limit on events that send events.** `on tick { send tick }` is a
  sequence of events with no end. Each handler ends (rule 3), so the host can
  count the events and stop.

## 9. Order of work

1. `DefineHandler`, `Send`, `HandlerSet`, `ce.withHandlers()` with the
   handler set, `self`, `parent` and the `send` function; rule 3. A host can
   use handlers from MathJSON after this step.
2. The `events` table of the context and the static check of `event`.
3. The Epsil `on` and `send` statements: parser, serializer, formatter, the
   diagnostics, the documentation page.
4. `init` and `quit` in the command-line tool.
5. Tycho: one handler context per series, per plot and per document, the
   `click` events, the path, the queue of sent events.

## 10. Targets

A target is the object that an event is about: the series that the user
clicked. Three needs call for it.

1. **A handler of an outer object must know which object got the event.** A
   document has one `on click` handler for all its series; the body needs the
   series that the user clicked. (HyperTalk: `the target`.)
2. **`send` must name its recipient**: `send click to series`.
3. **A handler can be written away from its object**: the document script
   declares a handler for one series.

### 10.1 A target is a value of the host, not a concept of the engine

In Epsil, a target is a value that the host chooses to denote one of its
objects. The engine gives it no type of its own and no meaning. It can be:

- a string identifier or a record of the properties at the time of the event;
- an `object` value. An object is a mutable instance with a nominal type and
  slots, and two objects are equal only when they are the same instance
  (`docs/TYPE-SYSTEM.md`, "An object value is a `BoxedObject`"). A host that
  declares an object type for its series gives the handler a target whose
  slots it can read and assign, and identity is the comparison that a target
  needs.

`self`, `parent` and the recipient of a `send` are values of the same kind.
The host keeps the relation between such a value and its handler context.

- **Need 1.** `target` is an argument of every handler (section 6.5):

  ```epsil
  on click(target) {
    selected = target
  }
  ```

- **Need 2.** `send` does not dispatch in the engine. It gives the recipient
  value, the event name and the record to the `send` function of the context
  (section 6.4). The host finds the handler context of the recipient and
  applies its own rule of delivery.
- **Need 3.** Not proposed. The host can already read a prefix of the event
  name as an object name (`on series1.click { … }` in the document's handler
  set), because the event name is a string that the host interprets.

### 10.2 Decision D5: arguments bound by name

A handler lists the arguments that it uses by name, not by position, and the
host can add a detail to an event without a change to an existing handler.
Decisions D7 and D10 fixed the names to `self`, `target`, `parent` and
`event`; a new detail is a new field of the `event` record. The options that
were not taken: arguments by position, and names that differ from one event
to the next (`on click(point, modifiers)`).

### 10.3 Decision D6: what owns a handler

Example: a Tycho document has two series cells, `f(x) = x^2` and
`g(x) = f(x) + 1`, and the first cell also holds `on click { … }`.

- (a) Taken: a handler set that the host names at boxing, through the handler
  context (section 6.1). Both cells run in the document scope, so `g` reads
  `f`; the handler goes in the set of the first series. The host can empty
  the set of one cell.
- (b) The lexical scope: the handler is stored in the scope where the `on`
  statement runs, and the host asks a scope for its handlers. The engine
  gets no new option on `ce.box()`. But the host must run each series in a
  scope of its own to tell the handlers apart, and then `f` is a local of
  the first cell that `g` cannot read. The host can avoid that only with
  event names that carry the object (`on series1.click`).
- (c) The host gives the target VALUE at boxing, and the engine keeps a
  table from target values to handlers. The engine then needs a rule for
  when two target values are the same, which a string, a record and an
  object answer differently; with (a) the host keeps that relation.
