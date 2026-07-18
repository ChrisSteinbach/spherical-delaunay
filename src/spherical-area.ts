// Spherical polygon area primitives — signed spherical excess (solid angle).
// Areas follow the same winding convention as the rest of the library:
// positive when the vertices wind CCW as viewed from outside the sphere.

import { cross, dot } from "./index.js";
import type { Point3D } from "./index.js";

/**
 * Signed spherical excess (= solid angle = area on the unit sphere) of the
 * spherical triangle (a, b, c), all unit vectors. Positive when (a, b, c)
 * winds CCW as viewed from outside the sphere. Van Oosterom–Strackee formula:
 *   E = 2 · atan2( a · (b × c), 1 + a·b + b·c + c·a )
 * Numerically stable for tiny triangles (numerator ~ area, denominator ~ 4).
 */
export function sphericalTriangleArea(
  a: Point3D,
  b: Point3D,
  c: Point3D,
): number {
  const numerator = dot(a, cross(b, c));
  const denominator = 1 + dot(a, b) + dot(b, c) + dot(c, a);
  return 2 * Math.atan2(numerator, denominator);
}

/**
 * Signed area of a simple spherical polygon given as unit vectors in order.
 * Computed as a fan of signed triangle excesses from vertices[0]. Positive
 * for CCW winding viewed from outside. Valid for polygons well smaller than a
 * hemisphere (Voronoi-cell scale). Requires vertices.length >= 3.
 */
export function sphericalPolygonArea(vertices: Point3D[]): number {
  const apex = vertices[0];
  let area = 0;
  for (let i = 1; i < vertices.length - 1; i++) {
    area += sphericalTriangleArea(apex, vertices[i], vertices[i + 1]);
  }
  return area;
}
