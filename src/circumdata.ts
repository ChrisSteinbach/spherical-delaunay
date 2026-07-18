// Per-triangle circumcircle data recomputed from a flat triangulation.
//
// Serialization (toJson / serializeBinary) intentionally drops circumcenters
// and circumradii — nearest-neighbor search never needs them. A Voronoi/Sibson
// consumer working from FlatDelaunay data does need them (Voronoi vertices,
// in-circumcap cavity tests), so it recomputes them once with this and caches
// the result.

import { dot, sphericalCircumcenter } from "./index.js";
import type { Point3D } from "./index.js";
import type { FlatDelaunay } from "./serialization.js";

/** Per-triangle circumcircle data recomputed from flat vertex positions. */
export interface Circumdata {
  /** Unit circumcenter per triangle, [x0,y0,z0, x1,y1,z1, ...] — 3 per triangle. */
  centers: Float64Array;
  /**
   * cos(circumradius) per triangle: dot(center, vertex). The spherical cap
   * { q : dot(center, q) > cosRadii[t] } is the OPEN circumcap of triangle t —
   * for a Delaunay triangulation it contains no other vertex (see
   * sphericalCircumcenter's empty-circumcap guarantee). Degenerate triangles
   * (coincident vertices → NaN circumcenter) get cosRadius = +Infinity, so the
   * cap is empty and the in-circumcap predicate stays NaN-free.
   */
  cosRadii: Float64Array;
}

function vertexPoint(fd: FlatDelaunay, vertex: number): Point3D {
  const vi = vertex * 3;
  return [
    fd.vertexPoints[vi],
    fd.vertexPoints[vi + 1],
    fd.vertexPoints[vi + 2],
  ];
}

function isNaNPoint(p: Point3D): boolean {
  return Number.isNaN(p[0]) || Number.isNaN(p[1]) || Number.isNaN(p[2]);
}

/**
 * Per-triangle circumcircle data recomputed from `fd`'s flat vertex/triangle
 * arrays. Each triangle's `center` is its spherical circumcenter (the
 * empty-circumcap center — see {@link sphericalCircumcenter}) and
 * `cosRadii[t] = dot(center, vertex)`. The in-circumcap test is then the
 * acos-free, allocation-free predicate `dot(center, q) > cosRadii[t]` —
 * exactly "q is above triangle t's hull face plane".
 *
 * A degenerate triangle — coincident vertices collapsed to identical
 * coordinates by Float32 quantization, whose circumcenter is NaN — is mapped
 * to an empty cap (center NaN, cosRadius +Infinity) so the predicate is always
 * false there and never yields NaN. This guard is load-bearing: Float32
 * quantization at serialization can collapse near-duplicate vertices into
 * bit-identical ones downstream of the hull.
 */
export function computeCircumdata(fd: FlatDelaunay): Circumdata {
  const triangleCount = fd.triangleVertices.length / 3;
  const centers = new Float64Array(triangleCount * 3);
  const cosRadii = new Float64Array(triangleCount);

  for (let t = 0; t < triangleCount; t++) {
    const ti = t * 3;
    const a = vertexPoint(fd, fd.triangleVertices[ti]);
    const b = vertexPoint(fd, fd.triangleVertices[ti + 1]);
    const c = vertexPoint(fd, fd.triangleVertices[ti + 2]);

    const cc = sphericalCircumcenter(a, b, c);

    if (isNaNPoint(cc)) {
      centers[ti] = NaN;
      centers[ti + 1] = NaN;
      centers[ti + 2] = NaN;
      cosRadii[t] = Infinity;
      continue;
    }

    centers[ti] = cc[0];
    centers[ti + 1] = cc[1];
    centers[ti + 2] = cc[2];
    // The three dots differ only by roundoff; the max is the conservative
    // choice — a slightly smaller cap never falsely includes a vertex.
    cosRadii[t] = Math.max(dot(cc, a), dot(cc, b), dot(cc, c));
  }

  return { centers, cosRadii };
}
