/**
 * Dependency Graph Module for CausalOTel Analysis Engine.
 * Implements Directed Graph representation, BFS, DFS, and Tarjan's Strongly Connected Components (SCC) algorithm.
 */

export class DependencyGraph {
  constructor() {
    this.adjacencyList = new Map(); // node -> Set of target nodes
    this.nodes = new Set();
  }

  addNode(node) {
    this.nodes.add(node);
    if (!this.adjacencyList.has(node)) {
      this.adjacencyList.set(node, new Set());
    }
  }

  addEdge(from, to) {
    this.addNode(from);
    this.addNode(to);
    this.adjacencyList.get(from).add(to);
  }

  getNeighbors(node) {
    return Array.from(this.adjacencyList.get(node) || []);
  }

  /**
   * Breadth-First Search: finds shortest causal path from start to target.
   */
  findShortestPath(start, target) {
    if (!this.nodes.has(start) || !this.nodes.has(target)) return null;
    if (start === target) return [start];

    const queue = [[start]];
    const visited = new Set([start]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      for (const neighbor of this.getNeighbors(current)) {
        if (neighbor === target) {
          return [...path, neighbor];
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }
    return null;
  }

  /**
   * Depth-First Search: returns all nodes reachable from start.
   */
  getReachableNodes(start) {
    if (!this.nodes.has(start)) return [];
    const visited = new Set();

    const dfs = (node) => {
      visited.add(node);
      for (const neighbor of this.getNeighbors(node)) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        }
      }
    };

    dfs(start);
    return Array.from(visited);
  }

  /**
   * Tarjan's Strongly Connected Components (SCC) Algorithm.
   * Identifies cyclic dependencies and clusters in O(V + E) time.
   */
  findStronglyConnectedComponents() {
    let index = 0;
    const indices = new Map();
    const lowlink = new Map();
    const onStack = new Map();
    const stack = [];
    const sccs = [];

    const strongConnect = (v) => {
      indices.set(v, index);
      lowlink.set(v, index);
      index++;
      stack.push(v);
      onStack.set(v, true);

      for (const w of this.getNeighbors(v)) {
        if (!indices.has(w)) {
          // Successor w has not yet been visited; recurse on it
          strongConnect(w);
          lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
        } else if (onStack.get(w)) {
          // Successor w is in stack and hence in the current SCC
          lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
        }
      }

      // If v is a root node, pop the stack and generate an SCC
      if (lowlink.get(v) === indices.get(v)) {
        const component = [];
        let w;
        do {
          w = stack.pop();
          onStack.set(w, false);
          component.push(w);
        } while (w !== v);

        sccs.push(component);
      }
    };

    for (const node of this.nodes) {
      if (!indices.has(node)) {
        strongConnect(node);
      }
    }

    return sccs;
  }

  /**
   * Detects whether the graph contains any cycle.
   */
  hasCycle() {
    const sccs = this.findStronglyConnectedComponents();
    return sccs.some((scc) => {
      if (scc.length > 1) return true;
      // Single node self-loop
      const single = scc[0];
      return this.adjacencyList.get(single)?.has(single) || false;
    });
  }

  toJSON() {
    const nodes = Array.from(this.nodes).map((id) => ({ id, name: id }));
    const edges = [];
    for (const [from, toSet] of this.adjacencyList.entries()) {
      for (const to of toSet) {
        edges.push({ from, to });
      }
    }
    const sccs = this.findStronglyConnectedComponents();
    const cyclicComponents = sccs.filter((s) => s.length > 1);

    return {
      nodes,
      edges,
      sccs,
      cyclicComponents,
      hasCycle: cyclicComponents.length > 0
    };
  }
}

export default DependencyGraph;
