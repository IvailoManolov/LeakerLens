import { describe, expect, it } from 'vitest';
import {
  ALPHA_MIN,
  ANIMATE_CAP,
  buildGraphModel,
  buildTreeModel,
  capForNodeCount,
  defaultForceParams,
  defaultTreeLayoutParams,
  FILE_RADIUS,
  forceStep,
  kineticEnergy,
  nodeRadius,
  RENDER_CAP,
  SECRET_RADIUS,
  seedPosition,
  severityColorVars,
  treeLayout,
  type GraphInputSecret,
  type SimEdge,
  type SimNode,
} from '../../src/engine/secretMapModel';
import type { Severity } from '../../src/engine';

const loc = (uri: string, start = 0, end = 1) => ({ uri, start, end });

function secret(over: Partial<GraphInputSecret> & { fingerprint: string }): GraphInputSecret {
  return {
    ruleName: 'Rule',
    severity: 'high',
    preview: 'AKIA…****',
    totalCount: 1,
    files: [{ file: 'src/a.ts', count: 1, firstLoc: loc('file:///a.ts') }],
    ...over,
  };
}

describe('buildGraphModel', () => {
  it('creates one secret node, one node per distinct file, and one edge per (secret,file)', () => {
    const model = buildGraphModel({
      secrets: [
        secret({
          fingerprint: 'fp1',
          severity: 'critical',
          totalCount: 3,
          files: [
            { file: 'src/config.ts', count: 2, firstLoc: loc('file:///config.ts', 10, 20) },
            { file: 'src/db.ts', count: 1, firstLoc: loc('file:///db.ts', 4, 8) },
          ],
        }),
        secret({
          fingerprint: 'fp2',
          severity: 'medium',
          totalCount: 1,
          files: [{ file: 'src/config.ts', count: 1, firstLoc: loc('file:///config.ts', 99, 110) }],
        }),
      ],
    });

    const secretNodes = model.nodes.filter((n) => n.kind === 'secret');
    const fileNodes = model.nodes.filter((n) => n.kind === 'file');
    expect(secretNodes).toHaveLength(2); // fp1, fp2
    expect(fileNodes).toHaveLength(2); // config.ts (shared), db.ts
    expect(model.edges).toHaveLength(3); // fp1→config, fp1→db, fp2→config
  });

  it('shares a file node across secrets and accumulates its degree, count, and severity', () => {
    const model = buildGraphModel({
      secrets: [
        secret({ fingerprint: 'fp1', severity: 'high', files: [{ file: 'src/x.ts', count: 2, firstLoc: loc('u1') }] }),
        secret({ fingerprint: 'fp2', severity: 'critical', files: [{ file: 'src/x.ts', count: 5, firstLoc: loc('u2') }] }),
      ],
    });
    const fileNode = model.nodes.find((n) => n.kind === 'file');
    expect(fileNode?.secretCount).toBe(2);
    expect(fileNode?.count).toBe(7); // 2 + 5
    expect(fileNode?.severity).toBe('critical'); // upgraded high → critical (returns b)
    // The shared file keeps the loc of the FIRST secret that referenced it.
    expect(fileNode?.loc.uri).toBe('u1');
  });

  it('keeps the more severe existing severity when a later secret is less severe (returns a)', () => {
    const model = buildGraphModel({
      secrets: [
        secret({ fingerprint: 'fp1', severity: 'critical', files: [{ file: 'shared', count: 1, firstLoc: loc('u1') }] }),
        secret({ fingerprint: 'fp2', severity: 'medium', files: [{ file: 'shared', count: 1, firstLoc: loc('u2') }] }),
      ],
    });
    expect(model.nodes.find((n) => n.kind === 'file')?.severity).toBe('critical');
  });

  it('labels file nodes with the basename for posix, windows, and separator-less paths', () => {
    const model = buildGraphModel({
      secrets: [
        secret({ fingerprint: 'a', files: [{ file: 'src/deep/config.ts', count: 1, firstLoc: loc('u') }] }),
        secret({ fingerprint: 'b', files: [{ file: 'src\\win\\db.ts', count: 1, firstLoc: loc('u') }] }),
        secret({ fingerprint: 'c', files: [{ file: '.env', count: 1, firstLoc: loc('u') }] }),
      ],
    });
    const labels = model.nodes.filter((n) => n.kind === 'file').map((n) => n.label);
    expect(labels).toContain('config.ts');
    expect(labels).toContain('db.ts');
    expect(labels).toContain('.env'); // no separator → whole path
  });

  it('carries secret display fields and a jump loc from the first file', () => {
    const model = buildGraphModel({
      secrets: [
        secret({
          fingerprint: 'fp',
          ruleName: 'AWS Access Key ID',
          preview: 'AKIA…****',
          totalCount: 4,
          files: [{ file: 'src/a.ts', count: 4, firstLoc: loc('jump', 7, 27) }],
        }),
      ],
    });
    const node = model.nodes[0];
    expect(node.kind).toBe('secret');
    expect(node.label).toBe('AWS Access Key ID');
    expect(node.preview).toBe('AKIA…****');
    expect(node.fileCount).toBe(1);
    expect(node.loc).toEqual(loc('jump', 7, 27));
  });
});

describe('buildTreeModel', () => {
  it('duplicates a shared secret into one leaf per file, with a root + edge each', () => {
    const model = buildTreeModel({
      secrets: [
        secret({
          fingerprint: 'fp',
          totalCount: 6,
          files: [
            { file: 'src/a.ts', count: 1, firstLoc: loc('a') },
            { file: 'src/b.ts', count: 2, firstLoc: loc('b') },
            { file: 'src/c.ts', count: 3, firstLoc: loc('c') },
          ],
        }),
      ],
    });
    const roots = model.nodes.filter((n) => n.depth === 0);
    const leaves = model.nodes.filter((n) => n.depth === 1);
    expect(roots).toHaveLength(3); // one root per distinct file
    expect(leaves).toHaveLength(3); // the secret duplicated under each file
    expect(model.edges).toHaveLength(3);
    expect(roots.every((r) => r.kind === 'file' && r.parent === null)).toBe(true);
    expect(leaves.every((l) => l.kind === 'secret')).toBe(true);
  });

  it("gives each leaf the per-pair count (not the secret's total) and the secret's file count", () => {
    const model = buildTreeModel({
      secrets: [
        secret({
          fingerprint: 'fp',
          totalCount: 9,
          files: [
            { file: 'src/a.ts', count: 2, firstLoc: loc('a', 1, 5) },
            { file: 'src/b.ts', count: 7, firstLoc: loc('b', 3, 9) },
          ],
        }),
      ],
    });
    const leaves = model.nodes.filter((n) => n.depth === 1);
    expect(leaves.map((l) => l.count).sort((x, y) => x - y)).toEqual([2, 7]);
    expect(leaves.every((l) => l.fileCount === 2)).toBe(true);
    // The leaf jumps to the occurrence in ITS file, not the secret's first overall.
    const leafB = leaves.find((l) => l.count === 7);
    expect(leafB?.loc).toEqual(loc('b', 3, 9));
  });

  it('aggregates a file root shared by several secrets (count, secretCount, severity)', () => {
    const model = buildTreeModel({
      secrets: [
        secret({ fingerprint: 'fp1', severity: 'high', files: [{ file: 'src/x.ts', count: 2, firstLoc: loc('u1') }] }),
        secret({ fingerprint: 'fp2', severity: 'critical', files: [{ file: 'src/x.ts', count: 5, firstLoc: loc('u2') }] }),
      ],
    });
    const root = model.nodes.find((n) => n.depth === 0);
    expect(root?.count).toBe(7); // 2 + 5
    expect(root?.secretCount).toBe(2);
    expect(root?.severity).toBe('critical'); // upgraded high → critical
    expect(root?.loc.uri).toBe('u1'); // keeps the first secret's loc for this file
  });

  it('orders roots by first appearance and labels them by basename (posix/windows/none)', () => {
    const model = buildTreeModel({
      secrets: [
        secret({ fingerprint: 'a', files: [{ file: 'src/deep/config.ts', count: 1, firstLoc: loc('u') }] }),
        secret({ fingerprint: 'b', files: [{ file: 'src\\win\\db.ts', count: 1, firstLoc: loc('u') }] }),
        secret({ fingerprint: 'c', files: [{ file: '.env', count: 1, firstLoc: loc('u') }] }),
      ],
    });
    const roots = model.nodes.filter((n) => n.depth === 0);
    expect(roots.map((r) => r.label)).toEqual(['config.ts', 'db.ts', '.env']);
  });

  it('places all roots before any leaf, with edges from root → its leaves', () => {
    const model = buildTreeModel({
      secrets: [
        secret({ fingerprint: 'fp1', files: [{ file: 'src/a.ts', count: 1, firstLoc: loc('a') }] }),
        secret({ fingerprint: 'fp2', files: [{ file: 'src/b.ts', count: 1, firstLoc: loc('b') }] }),
      ],
    });
    const firstLeaf = model.nodes.findIndex((n) => n.depth === 1);
    expect(model.nodes.slice(0, firstLeaf).every((n) => n.depth === 0)).toBe(true);
    for (const e of model.edges) {
      expect(model.nodes[e.source].depth).toBe(0);
      expect(model.nodes[e.target].depth).toBe(1);
      expect(model.nodes[e.target].parent).toBe(e.source);
    }
  });

  it('handles empty input', () => {
    const model = buildTreeModel({ secrets: [] });
    expect(model.nodes).toHaveLength(0);
    expect(model.edges).toHaveLength(0);
  });

  it('handles a single secret in a single file (1 root, 1 leaf, 1 edge)', () => {
    const model = buildTreeModel({
      secrets: [secret({ fingerprint: 'fp', files: [{ file: 'src/a.ts', count: 1, firstLoc: loc('a') }] })],
    });
    expect(model.nodes.filter((n) => n.depth === 0)).toHaveLength(1);
    expect(model.nodes.filter((n) => n.depth === 1)).toHaveLength(1);
    expect(model.edges).toHaveLength(1);
  });
});

describe('treeLayout', () => {
  const sample = () =>
    buildTreeModel({
      secrets: [
        secret({
          fingerprint: 'fp1',
          files: [
            { file: 'src/a.ts', count: 1, firstLoc: loc('a') },
            { file: 'src/b.ts', count: 1, firstLoc: loc('b') },
          ],
        }),
        secret({ fingerprint: 'fp2', files: [{ file: 'src/a.ts', count: 1, firstLoc: loc('a2') }] }),
      ],
    });

  it('keeps every node within the reported bounds, and bounds are well-formed', () => {
    const model = sample();
    const { positions, bounds } = treeLayout(model);
    expect(positions).toHaveLength(model.nodes.length);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.width).toBeCloseTo(bounds.maxX - bounds.minX, 5);
    for (const pos of positions) {
      expect(pos.x - pos.r).toBeGreaterThanOrEqual(bounds.minX);
      expect(pos.x + pos.r).toBeLessThanOrEqual(bounds.maxX);
      expect(pos.y - pos.r).toBeGreaterThanOrEqual(bounds.minY);
      expect(pos.y + pos.r).toBeLessThanOrEqual(bounds.maxY);
    }
  });

  it('puts roots on a shared top tier and leaves on a shared lower tier', () => {
    const model = sample();
    const { positions } = treeLayout(model);
    const rootYs = model.nodes.map((n, i) => (n.depth === 0 ? positions[i].y : null)).filter((y): y is number => y !== null);
    const leafYs = model.nodes.map((n, i) => (n.depth === 1 ? positions[i].y : null)).filter((y): y is number => y !== null);
    expect(new Set(rootYs).size).toBe(1);
    expect(new Set(leafYs).size).toBe(1);
    expect(leafYs[0]).toBeGreaterThan(rootYs[0]);
  });

  it('centres a root over the mean of its leaves', () => {
    const model = sample();
    const { positions } = treeLayout(model);
    model.nodes.forEach((n, i) => {
      if (n.depth !== 0) {
        return;
      }
      const kidXs = model.nodes
        .map((c, j) => (c.parent === i ? positions[j].x : null))
        .filter((x): x is number => x !== null);
      const mean = kidXs.reduce((s, x) => s + x, 0) / kidXs.length;
      expect(positions[i].x).toBeCloseTo(mean, 5);
    });
  });

  it('does not overlap adjacent roots or sibling leaves', () => {
    const model = sample();
    const { positions } = treeLayout(model);
    const rootIdx = model.nodes.map((n, i) => (n.depth === 0 ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < rootIdx.length; k++) {
      const a = positions[rootIdx[k - 1]];
      const b = positions[rootIdx[k]];
      expect(b.x - a.x).toBeGreaterThanOrEqual(a.r + b.r);
    }
    // Sibling leaves under the first root keep at least their radii apart.
    const firstRoot = rootIdx[0];
    const sibs = model.nodes.map((n, i) => (n.parent === firstRoot ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < sibs.length; k++) {
      const a = positions[sibs[k - 1]];
      const b = positions[sibs[k]];
      expect(b.x - a.x).toBeGreaterThanOrEqual(a.r + b.r);
    }
  });

  it('is deterministic and sizes radii via nodeRadius', () => {
    const model = sample();
    expect(treeLayout(model)).toEqual(treeLayout(model));
    const { positions } = treeLayout(model);
    model.nodes.forEach((n, i) => {
      const scale = n.kind === 'secret' ? SECRET_RADIUS : FILE_RADIUS;
      expect(positions[i].r).toBe(nodeRadius(n.count, scale));
    });
  });

  it('accepts explicit params and matches the default when given the defaults', () => {
    const model = sample();
    expect(treeLayout(model, defaultTreeLayoutParams())).toEqual(treeLayout(model));
    const wide = treeLayout(model, { ...defaultTreeLayoutParams(), fileGapX: 200 });
    expect(wide.bounds.width).toBeGreaterThan(treeLayout(model).bounds.width);
  });

  it('returns empty positions and zero bounds for an empty model', () => {
    const layout = treeLayout({ nodes: [], edges: [] });
    expect(layout.positions).toHaveLength(0);
    expect(layout.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
  });
});

describe('defaultTreeLayoutParams', () => {
  it('returns the documented spacing constants', () => {
    expect(defaultTreeLayoutParams()).toEqual({
      fileGapX: 48,
      leafGapX: 28,
      tierGapY: 90,
      marginX: 24,
      marginY: 24,
    });
  });
});

describe('nodeRadius', () => {
  it('grows with the square root of count (area ∝ count)', () => {
    expect(nodeRadius(0, SECRET_RADIUS)).toBe(SECRET_RADIUS.min);
    expect(nodeRadius(4, SECRET_RADIUS)).toBeGreaterThan(nodeRadius(1, SECRET_RADIUS));
    // √: going 1→4 (×4 count) adds 2× the per-root step, not 4×.
    const step1 = nodeRadius(1, SECRET_RADIUS) - SECRET_RADIUS.min;
    const step4 = nodeRadius(4, SECRET_RADIUS) - SECRET_RADIUS.min;
    expect(step4).toBeCloseTo(2 * step1, 5);
  });

  it('never exceeds max and never drops below min', () => {
    expect(nodeRadius(100000, FILE_RADIUS)).toBe(FILE_RADIUS.max);
    expect(nodeRadius(-5, FILE_RADIUS)).toBe(FILE_RADIUS.min); // negative floored to 0
  });
});

describe('capForNodeCount', () => {
  it('animates small graphs with no truncation', () => {
    expect(capForNodeCount(ANIMATE_CAP)).toEqual({ animate: true, renderLimit: ANIMATE_CAP, disclosed: false });
  });

  it('renders a settled static layout above the animation cap, still no truncation', () => {
    const n = ANIMATE_CAP + 1;
    expect(capForNodeCount(n)).toEqual({ animate: false, renderLimit: n, disclosed: false });
    expect(capForNodeCount(RENDER_CAP)).toEqual({ animate: false, renderLimit: RENDER_CAP, disclosed: false });
  });

  it('truncates and discloses past the render cap (never silent)', () => {
    expect(capForNodeCount(RENDER_CAP + 1)).toEqual({
      animate: false,
      renderLimit: RENDER_CAP,
      disclosed: true,
    });
  });
});

describe('severityColorVars', () => {
  it('maps each severity to its VS Code theme variables (primary then fallback)', () => {
    const severities: Severity[] = ['critical', 'high', 'medium', 'low'];
    for (const s of severities) {
      const vars = severityColorVars(s);
      expect(vars.length).toBeGreaterThan(0);
      expect(vars.every((v) => v.startsWith('--vscode-'))).toBe(true);
    }
    expect(severityColorVars('critical')[0]).toBe('--vscode-errorForeground');
  });
});

describe('seedPosition', () => {
  it('is deterministic and places node 0 at the centre offset', () => {
    const a = seedPosition(0, 100, 100);
    const b = seedPosition(0, 100, 100);
    expect(a).toEqual(b);
  });

  it('spreads later nodes outward, honouring an explicit spacing', () => {
    const near = seedPosition(1, 0, 0); // default spacing
    const far = seedPosition(50, 0, 0, 40); // explicit spacing
    const dNear = Math.hypot(near.x, near.y);
    const dFar = Math.hypot(far.x, far.y);
    expect(dFar).toBeGreaterThan(dNear);
  });
});

describe('forceStep & kineticEnergy', () => {
  const params = defaultForceParams(0, 0);

  it('cools alpha each tick and reports kinetic energy', () => {
    const nodes: SimNode[] = [{ x: 10, y: 0, vx: 0, vy: 0, r: 0 }];
    const next = forceStep(nodes, [], 1, params);
    expect(next).toBeCloseTo(params.alphaDecay, 5);
    expect(kineticEnergy(nodes)).toBeGreaterThanOrEqual(0);
  });

  it('pushes two coincident nodes apart (distance + zero-vector floor branches)', () => {
    const nodes: SimNode[] = [
      { x: 50, y: 50, vx: 0, vy: 0, r: 0 },
      { x: 50, y: 50, vx: 0, vy: 0, r: 0 },
    ];
    forceStep(nodes, [], 1, params);
    expect(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y)).toBeGreaterThan(0);
    expect(kineticEnergy(nodes)).toBeGreaterThan(0);
  });

  it('handles close-but-not-coincident nodes (distance floor, non-zero vector)', () => {
    const nodes: SimNode[] = [
      { x: 50, y: 50, vx: 0, vy: 0, r: 0 },
      { x: 50.5, y: 50, vx: 0, vy: 0, r: 0 }, // dx≠0, d<MIN_DIST
    ];
    forceStep(nodes, [], 1, params);
    expect(nodes[0].x).toBeLessThan(nodes[1].x); // pushed apart along x
  });

  it('applies forces to well-separated nodes (no distance floor) and stays finite', () => {
    const nodes: SimNode[] = [
      { x: 100, y: 100, vx: 0, vy: 0, r: 0 },
      { x: -100, y: -100, vx: 0, vy: 0, r: 0 }, // d ≫ MIN_DIST → floor branch skipped
    ];
    const distToCenter0 = Math.hypot(nodes[0].x, nodes[0].y);
    for (let i = 0; i < 20; i++) {
      forceStep(nodes, [], 1, params);
    }
    // Centring gravity dominates at this separation, drawing both toward the centre.
    expect(Math.hypot(nodes[0].x, nodes[0].y)).toBeLessThan(distToCenter0);
    expect(Number.isFinite(nodes[0].x)).toBe(true);
  });

  it('pulls a linked pair toward the spring rest length', () => {
    const nodes: SimNode[] = [
      { x: -200, y: 0, vx: 0, vy: 0, r: 0 },
      { x: 200, y: 0, vx: 0, vy: 0, r: 0 },
    ];
    const edges: SimEdge[] = [{ source: 0, target: 1, weight: 1 }];
    const start = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y);
    let alpha = 1;
    for (let i = 0; i < 600; i++) {
      alpha = forceStep(nodes, edges, alpha, params);
    }
    const end = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y);
    expect(end).toBeLessThan(start); // contracted toward rest length
    expect(end).toBeLessThan(params.l0 * 2);
  });

  it('separates a linked coincident pair (spring distance + zero-vector floor)', () => {
    const nodes: SimNode[] = [
      { x: 0, y: 0, vx: 0, vy: 0, r: 0 },
      { x: 0, y: 0, vx: 0, vy: 0, r: 0 },
    ];
    const edges: SimEdge[] = [{ source: 0, target: 1, weight: 2 }];
    forceStep(nodes, edges, 1, params);
    expect(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y)).toBeGreaterThan(0);
  });

  it('handles a linked close-but-not-coincident pair (spring distance floor, non-zero vector)', () => {
    const nodes: SimNode[] = [
      { x: 0, y: 0, vx: 0, vy: 0, r: 0 },
      { x: 0.4, y: 0, vx: 0, vy: 0, r: 0 },
    ];
    const edges: SimEdge[] = [{ source: 0, target: 1, weight: 1 }];
    expect(() => forceStep(nodes, edges, 1, params)).not.toThrow();
  });

  it('holds a pinned node in place while it still pushes neighbours', () => {
    const nodes: SimNode[] = [
      { x: 0, y: 0, vx: 0, vy: 0, r: 0, fx: 0, fy: 0 }, // pinned
      { x: 5, y: 0, vx: 0, vy: 0, r: 0 }, // free
    ];
    forceStep(nodes, [], 1, params);
    expect(nodes[0].x).toBe(0);
    expect(nodes[0].y).toBe(0);
    expect(nodes[0].vx).toBe(0);
    expect(nodes[0].vy).toBe(0);
    expect(nodes[1].x).not.toBe(5); // neighbour was pushed
  });

  it('settles: velocities decay toward zero and alpha cools below ALPHA_MIN', () => {
    const nodes: SimNode[] = [
      { x: 30, y: 10, vx: 0, vy: 0, r: 0 },
      { x: -30, y: -10, vx: 0, vy: 0, r: 0 },
      { x: 5, y: 40, vx: 0, vy: 0, r: 0 },
    ];
    const edges: SimEdge[] = [
      { source: 0, target: 2, weight: 1 },
      { source: 1, target: 2, weight: 1 },
    ];
    let alpha = 1;
    for (let i = 0; i < 1000; i++) {
      alpha = forceStep(nodes, edges, alpha, params);
    }
    expect(alpha).toBeLessThan(ALPHA_MIN);
    expect(kineticEnergy(nodes)).toBeLessThan(0.5);
  });
});
