import {
  toCartesian,
  cross,
  dot,
  sphericalTriangleArea,
  sphericalPolygonArea,
  convexHull,
  buildTriangulation,
  flattenTriangulation,
} from "./index.js";
import type { Point3D, FlatDelaunay } from "./index.js";

// Three mutually orthogonal unit vectors. The triangle (X, Y, N) bounds
// exactly one octant of the sphere: area = 4π/8 = π/2.
const X: Point3D = [1, 0, 0];
const Y: Point3D = [0, 1, 0];
const N: Point3D = [0, 0, 1];

describe("sphericalTriangleArea", () => {
  it("gives exactly one octant (π/2) for the mutually orthogonal X, Y, N triangle", () => {
    expect(sphericalTriangleArea(X, Y, N)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("flips sign when the last two vertices are swapped", () => {
    expect(sphericalTriangleArea(X, N, Y)).toBe(
      -sphericalTriangleArea(X, Y, N),
    );
  });

  it("is invariant under cyclic rotation of its vertices", () => {
    const first = sphericalTriangleArea(X, Y, N);
    const second = sphericalTriangleArea(Y, N, X);
    const third = sphericalTriangleArea(N, X, Y);

    expect(first).toBeCloseTo(Math.PI / 2, 12);
    expect(second).toBeCloseTo(Math.PI / 2, 12);
    expect(third).toBeCloseTo(Math.PI / 2, 12);
    expect(second).toBeCloseTo(first, 12);
    expect(third).toBeCloseTo(first, 12);
  });

  it("approximates the flat chord-triangle area for a tiny triangle near the pole", () => {
    const deltaDeg = (1e-6 * 180) / Math.PI;
    const a = toCartesian({ lat: 89.9, lon: 10 });
    const b = toCartesian({ lat: 89.9 + deltaDeg, lon: 10 });
    const c = toCartesian({ lat: 89.9, lon: 10 + deltaDeg });

    const ab: Point3D = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Point3D = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const flat = 0.5 * dot(cross(ab, ac), a);

    const spherical = sphericalTriangleArea(a, b, c);
    const relativeError = Math.abs(spherical - flat) / Math.abs(flat);
    expect(relativeError).toBeLessThan(1e-6);
  });
});

describe("sphericalPolygonArea", () => {
  const square: Point3D[] = [0, 90, 180, 270].map((lon) =>
    toCartesian({ lat: 45, lon }),
  );

  it("agrees with an independent fan decomposition to the north pole, and is positive", () => {
    const fanFromFirstVertex = sphericalPolygonArea(square);
    let fanFromPole = 0;
    for (let i = 0; i < 4; i++) {
      fanFromPole += sphericalTriangleArea(N, square[i], square[(i + 1) % 4]);
    }

    expect(Math.abs(fanFromFirstVertex - fanFromPole)).toBeLessThan(1e-12);
    expect(fanFromFirstVertex).toBeGreaterThan(0);
  });

  it("is unaffected by a duplicated consecutive vertex", () => {
    const withDuplicate = [
      square[0],
      square[1],
      square[1],
      square[2],
      square[3],
    ];
    const areaWithDuplicate = sphericalPolygonArea(withDuplicate);
    const areaOriginal = sphericalPolygonArea(square);

    expect(Math.abs(areaWithDuplicate - areaOriginal)).toBeLessThan(1e-12);
  });

  it("sums to the full sphere (4π) over the faces of an octahedron built by the library", () => {
    function vertexPoint(fd: FlatDelaunay, i: number): Point3D {
      const vp = fd.vertexPoints;
      return [vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2]];
    }

    const fd = flattenTriangulation(
      buildTriangulation(
        convexHull([
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ]),
      ),
    );

    let total = 0;
    const triangleCount = fd.triangleVertices.length / 3;
    for (let t = 0; t < triangleCount; t++) {
      const a = vertexPoint(fd, fd.triangleVertices[t * 3]);
      const b = vertexPoint(fd, fd.triangleVertices[t * 3 + 1]);
      const c = vertexPoint(fd, fd.triangleVertices[t * 3 + 2]);
      total += sphericalTriangleArea(a, b, c);
    }

    expect(total).toBeCloseTo(4 * Math.PI, 10);
  });
});
