import {
  computeCircumdata,
  dot,
  toCartesian,
  convexHull,
  buildTriangulation,
  flattenTriangulation,
} from "./index.js";
import type { Circumdata, FlatDelaunay, Point3D } from "./index.js";

// ---------- Helpers ----------

function vertexPoint(fd: FlatDelaunay, v: number): Point3D {
  return [
    fd.vertexPoints[v * 3],
    fd.vertexPoints[v * 3 + 1],
    fd.vertexPoints[v * 3 + 2],
  ];
}

function center(cd: Circumdata, t: number): Point3D {
  return [cd.centers[t * 3], cd.centers[t * 3 + 1], cd.centers[t * 3 + 2]];
}

/** 6 axis-aligned points forming an octahedron — builds 8 triangles. */
const OCTAHEDRON: Point3D[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Deterministic quasi-uniform points on the sphere (Fibonacci lattice) — no RNG. */
function fibonacciSpherePoints(count: number): Point3D[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const pts: Point3D[] = [];
  for (let k = 0; k < count; k++) {
    const lat = (Math.asin((2 * (k + 0.5)) / count - 1) * 180) / Math.PI;
    const lon = ((((2 * Math.PI * k) / phi) % (2 * Math.PI)) * 180) / Math.PI;
    pts.push(toCartesian({ lat, lon }));
  }
  return pts;
}

describe("computeCircumdata", () => {
  const fd = flattenTriangulation(buildTriangulation(convexHull(OCTAHEDRON)));
  const cd = computeCircumdata(fd);
  const T = fd.triangleVertices.length / 3;

  it("gives 8 triangles for the octahedron", () => {
    expect(fd.triangleVertices.length / 3).toBe(8);
  });

  it("circumcenter is equidistant from its triangle's three vertices", () => {
    for (let t = 0; t < T; t++) {
      for (let e = 0; e < 3; e++) {
        const v = fd.triangleVertices[t * 3 + e];
        const err = Math.abs(
          dot(center(cd, t), vertexPoint(fd, v)) - cd.cosRadii[t],
        );
        expect(err, `triangle ${t}, vertex slot ${e}`).toBeLessThan(1e-12);
      }
    }
  });

  it("places every circumcenter on the outward side (same side as the centroid)", () => {
    for (let t = 0; t < T; t++) {
      const a = vertexPoint(fd, fd.triangleVertices[t * 3]);
      const b = vertexPoint(fd, fd.triangleVertices[t * 3 + 1]);
      const c = vertexPoint(fd, fd.triangleVertices[t * 3 + 2]);
      const centroid: Point3D = [
        a[0] + b[0] + c[0],
        a[1] + b[1] + c[1],
        a[2] + b[2] + c[2],
      ];
      expect(dot(center(cd, t), centroid), `triangle ${t}`).toBeGreaterThan(0);
    }
  });

  it("gives every circumcenter unit length", () => {
    for (let t = 0; t < T; t++) {
      const c = center(cd, t);
      const len = Math.sqrt(dot(c, c));
      expect(Math.abs(len - 1), `triangle ${t}`).toBeLessThan(1e-9);
    }
  });

  it("keeps every triangle's open circumcap empty of all other vertices (Delaunay property), on a 100-point Fibonacci sphere", () => {
    const fibFd = flattenTriangulation(
      buildTriangulation(convexHull(fibonacciSpherePoints(100))),
    );
    const fibCd = computeCircumdata(fibFd);
    const fibT = fibFd.triangleVertices.length / 3;
    const V = fibFd.vertexTriangles.length;

    for (let t = 0; t < fibT; t++) {
      const triVerts = new Set([
        fibFd.triangleVertices[t * 3],
        fibFd.triangleVertices[t * 3 + 1],
        fibFd.triangleVertices[t * 3 + 2],
      ]);
      const c = center(fibCd, t);
      for (let v = 0; v < V; v++) {
        if (triVerts.has(v)) continue;
        expect(
          dot(c, vertexPoint(fibFd, v)),
          `triangle ${t}, vertex ${v}`,
        ).toBeLessThan(fibCd.cosRadii[t] + 1e-12);
      }
    }
  });
});

describe("computeCircumdata degenerate-triangle guard", () => {
  it("maps a triangle with coincident vertices to an empty cap (NaN center, +Infinity cosRadius)", () => {
    const degenerate: FlatDelaunay = {
      vertexPoints: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      vertexTriangles: Uint32Array.from([0, 0, 0]),
      triangleVertices: Uint32Array.from([0, 0, 1]),
      triangleNeighbors: Uint32Array.from([0, 0, 0]),
    };

    const cd = computeCircumdata(degenerate);

    expect(Number.isNaN(cd.centers[0])).toBe(true);
    expect(Number.isNaN(cd.centers[1])).toBe(true);
    expect(Number.isNaN(cd.centers[2])).toBe(true);
    expect(cd.cosRadii[0]).toBe(Infinity);

    // The in-circumcap predicate stays NaN-free and false: dot() against a
    // NaN center is NaN, and `NaN > Infinity` is false — the empty cap
    // safely excludes every query instead of propagating NaN.
    const q: Point3D = [1, 0, 0];
    expect(dot(center(cd, 0), q) > cd.cosRadii[0]).toBe(false);
  });
});
