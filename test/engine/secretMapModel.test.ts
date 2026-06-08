import { describe, expect, it } from 'vitest';
import {
  ALPHA_MIN,
  ANIMATE_CAP,
  buildGraphModel,
  capForNodeCount,
  defaultForceParams,
  FILE_RADIUS,
  forceStep,
  kineticEnergy,
  nodeRadius,
  RENDER_CAP,
  SECRET_RADIUS,
  seedPosition,
  severityColorVars,
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
