// An indexed-base lookup may request preparation during a row parse. Treat
// that request as an early traversal, then use the parsed lexical edges to
// compute which bindings actually form a component.
export function demandComponents(
  dependencies: (name: string) => readonly string[],
  settle: (component: readonly string[], recursive: boolean) => void
) {
  type Visit = { index: number; low: number; stacked: boolean };
  const visits = new Map<string, Visit>();
  const stack: string[] = [];

  function visit(name: string): void {
    const current = { index: visits.size, low: visits.size, stacked: true };
    visits.set(name, current);
    stack.push(name);
    const edges = dependencies(name);
    for (const dependency of edges) {
      const previous = visits.get(dependency);
      if (previous === undefined) {
        visit(dependency);
        current.low = Math.min(current.low, visits.get(dependency)!.low);
      } else if (previous.stacked) {
        // An indexed-base lookup can have already traversed this edge
        // before dependencies(name) returned. Carry that descendant's
        // back-edge into this node, as for an ordinary DFS tree edge.
        current.low = Math.min(
          current.low,
          previous.index > current.index ? previous.low : previous.index
        );
      }
    }
    if (current.low !== current.index) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      visits.get(member)!.stacked = false;
      component.push(member);
    } while (member !== name);
    settle(component, component.length > 1 || edges.includes(name));
  }

  return {
    prepare(name: string) {
      if (!visits.has(name)) visit(name);
    },
  };
}
