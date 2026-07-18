# spherical-delaunay

Spherical Delaunay triangulation via 3D convex hull, with O(√N) nearest-neighbor queries.

## Install

```bash
npm install spherical-delaunay
```

## Usage

Convert lat/lon points to Cartesian coordinates, build a triangulation, then query it for the nearest point to any location:

```ts
import {
  toCartesian,
  convexHull,
  buildTriangulation,
  flattenTriangulation,
  createQueryContext,
  findNearestVertices,
  vertexLatLon,
} from "spherical-delaunay";

// Points on the sphere, as lat/lon in degrees.
const cities = [
  { lat: 48.8566, lon: 2.3522 }, // Paris
  { lat: 51.5074, lon: -0.1278 }, // London
  { lat: 52.52, lon: 13.405 }, // Berlin
  { lat: 41.9028, lon: 12.4964 }, // Rome
  { lat: 40.4168, lon: -3.7038 }, // Madrid
  { lat: 59.3293, lon: 18.0686 }, // Stockholm
];

// Build the triangulation once...
const hull = convexHull(cities.map(toCartesian));
const triangulation = buildTriangulation(hull);

// ...then query it as often as you like.
const fd = flattenTriangulation(triangulation);
const ctx = createQueryContext(fd);

const query = toCartesian({ lat: 45, lon: 5 }); // somewhere in the Alps
const { nearestVertex } = findNearestVertices(ctx, query);

console.log(vertexLatLon(fd, nearestVertex)); // { lat, lon } of the nearest city
```

`findNearestVertices` also accepts a `k` for k-nearest queries, a `filter` predicate to restrict
matches, and a `startTriangle` to warm-start the search from a previous result — useful for a
sequence of nearby queries. Triangulations can be persisted or sent over the wire with
`toJson`/`fromJson`, or the compact `serializeBinary`/`deserializeBinary` binary format.

## How it works

A spherical Delaunay triangulation is exactly the set of faces of the 3D convex hull of its
points on the unit sphere. `convexHull` builds that hull incrementally, and `buildTriangulation`
turns it into a navigable triangle mesh. Nearest-neighbor queries then reduce to a triangle walk
— crossing from triangle to triangle toward the query point — followed by a greedy walk over
Delaunay-adjacent vertices, both O(√N) for uniformly distributed points. See
[`docs/nearest-neighbor.md`](./docs/nearest-neighbor.md) for the full theory, including how the
implementation stays correct for partial-sphere (regional) datasets and under floating-point
coordinate quantization.

## Vendored dependencies

The package has zero runtime npm dependencies. The exact-arithmetic geometric predicate
(`orient3D`) it relies on for robustness against near-degenerate input is vendored from
[mourner/robust-predicates](https://github.com/mourner/robust-predicates) under
`src/vendor/robust-predicates/`. That code is public domain and carries its own `LICENSE` file.

## License

ISC © Chris Steinbach. See [`LICENSE`](./LICENSE).
