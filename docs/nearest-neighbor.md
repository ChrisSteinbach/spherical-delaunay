# Spherical Nearest-Neighbor Search

This document explains the theory behind this library's nearest-neighbor algorithm and how it maps to the implementation. The core insight is that spherical Delaunay triangulation can be computed as a 3D convex hull, and nearest-neighbor queries reduce to triangle walks on the resulting mesh.

## Key idea: Convex hull = Spherical Delaunay

For points on a unit sphere, the faces of their 3D convex hull are exactly the triangles of the spherical Delaunay triangulation (Brown, 1979). This means we can use a standard incremental convex hull algorithm to build the triangulation, then walk the resulting mesh to answer nearest-neighbor queries.

The Delaunay property guarantees that each point's nearest neighbor is one of its Delaunay-adjacent vertices (average degree approximately 6 by Euler's formula, specifically 6 − 12/V). This makes greedy walks on the triangulation graph correct for nearest-neighbor search.

## Algorithm (as implemented)

### Build phase

`convexHull()` in `src/convex-hull.ts` builds the triangulation via incremental insertion:

1. **Perturbation** — All points receive ~1e-6 deterministic perturbation (seeded LCG PRNG) to avoid degenerate coplanar configurations. Perturbed copies are used for `orient3D` tests only; original coordinates are stored in the output.

2. **Seed tetrahedron** — Four non-coplanar points form the initial hull.

3. **Incremental insertion** — For each new point:
   - Find a visible face via greedy walk from the previous insertion point
   - BFS to discover all connected visible faces (the "cavity")
   - Collect horizon edges (boundary between visible and non-visible faces)
   - Delete visible faces, create new faces connecting horizon to the new point
   - Relink adjacency via a half-edge map (edge `a→b` encoded as `a × N + b`)

4. **Fallback strategies** — If the greedy walk fails to find a visible face: FaceGrid spatial index lookup → local BFS from walk endpoint → linear scan (rare, typically <1% of points).

5. **Post-processing** (`buildTriangulation()` in `src/delaunay.ts`) — Computes circumcenters, builds vertex-to-triangle mapping, drops interior points, remaps indices.

The core geometric predicate is `orient3D(a, b, c, d)` — the sign of the 4×4 determinant giving the signed volume of tetrahedron `abcd`. This uses Shewchuk's robust exact arithmetic (vendored via mourner's `robust-predicates` port in `src/vendor/`). Positive means `d` is visible from face `(a, b, c)`.

**Complexity:** O(N log N) for typical geographic distributions; O(N²) worst case (adversarial insertion orders). The implementation uses deterministic (not randomized) incremental insertion, so the O(N log N) expected-case guarantee of Clarkson-Shor does not formally apply — but real-world geographic point distributions are far from worst-case. FaceGrid provides O(1) amortized face lookup. The implementation uses multiple fallback strategies (greedy walk → FaceGrid lookup → BFS → linear scan) to handle the pathological cases gracefully.

### Query phase

Queries run against flat typed arrays (`FlatDelaunay`) rather than the `SphericalDelaunay` object graph, to avoid GC pressure and let callers query immediately after `deserializeBinary` or `flattenTriangulation` — no conversion step needed. This is implemented once in `src/flat-query.ts` and hardened for real-world data (see "Patch triangulations" below).

**Step 1: Triangle walk** (`flatLocate` in `flat-query.ts`)

Starting from a hint triangle (or the default), test which edge of the current triangle the query point lies outside of. Cross to the neighbor sharing that edge. Repeat until the query is inside all three edges.

The edge test uses the sign of `dot(cross(a, b), q)` — the scalar triple product — to determine which side of the great circle through `a` and `b` the query `q` lies on.

**Expected steps:** O(√N) for uniformly distributed points.

**Step 2: Greedy vertex walk** (`flatFindNearest` in `flat-query.ts`)

Starting from a seed vertex, check all Delaunay neighbors. Move to any closer one. Repeat until no improvement. The Delaunay property guarantees this converges to the true nearest vertex on a full-sphere triangulation.

### Patch triangulations: why the runtime walk is hardened

When a triangulation's input covers only part of the sphere — a regional or "patch" dataset rather than full global coverage — its convex hull is a thin lens. The hull's topside facets are the true spherical Delaunay triangles of the patch, but the hull is closed by "back-closure" facets spanning the rim. As spherical regions for the walk's edge tests, topside facets cover the patch while back-closure facets cover its _antipode_ — so a query outside the patch (a common situation whenever the query point falls just beyond the input data's coverage) is contained by **no facet at all**. The textbook walk can never terminate by containment there: it orbits the back closure for thousands of steps until cycle detection or the step limit rescues it, then seeds the descent from an arbitrary triangle.

Float32 coordinate quantization — used by the compact binary serialization format (`serializeBinary`) — compounds this: it collapses co-located points onto identical coordinates, producing degenerate zero-area triangles whose edge-test signs are noise, and clusters whose inner vertices have no strictly-closer neighbor. A greedy descent arriving from far away can stall in such a pocket, far from the true nearest vertex.

`flatLocate` therefore adds, on top of the textbook walk:

- **Best-seen tracking** — the walk records the closest vertex (squared chord distance) over all triangles it visits, and the descent is always seeded from it, never from whatever triangle the walk stopped on.
- **Patience termination** — if no strictly closer vertex appears for `LOCATE_PATIENCE` steps, the walk stops: an orbit never approaches the query, so this cuts it short right after it has passed the rim vertices nearest the query. In-patch walks terminate by containment as usual.
- **Back-closure walls** — the walk never crosses into facets with `det[a,b,c] < -1e-8` (`markBackClosure`, computed at load). In practice, real back-closure facets — including every patch-spanning rim chord — sit at or below that determinant, while quantization-noise slivers stay within ±1e-9, so no genuine front triangle is ever walled. Rim edges act as walls and the walk slides along the rim's narrow front triangles instead; this also keeps long spurious streaks out of the walk trace (see `WalkTrace`).
- **Anchor restart** — a stalled or cycling walk restarts once from the triangulation's anchor triangle (the incident triangle of the vertex nearest the point-cloud centroid, computed at load). This rescues walks whose start triangle sits on the back closure, where flipped edge tests strand them (a warm start from an out-of-patch query can name such a triangle).
- **Cycle triage** — a cycle hit while the walk was still improving means a degenerate tangle right where the answer should be: fall back to the exact brute-force scan. A cycle after progress stopped is just an orbit closing; the best-seen vertex already seeds correctly.
- **Plateau tunneling** (`plateauEscape` in the descent) — when no fan neighbor is strictly closer, the descent floods the connected set of _exactly equal-distance_ vertices (coincident duplicates) and continues from any member with a strictly closer neighbor, escaping quantization pockets.

With these safeguards in place, the hardened walk matches exhaustive brute-force search exactly across the library's test suite — including adversarial cases like Float32-quantized near-duplicate-vertex clusters and queries well outside the input data's coverage — while keeping the walk's step count bounded, instead of degrading toward the unmodified textbook walk's worst-case linear scan.

Neighbors are enumerated by walking the triangle fan around a vertex (`vertexNeighbors`).

**Step 3: BFS expansion** (k > 1 or filtered, `findNearestVertices` in `flat-query.ts`)

For k-nearest queries, expand from the nearest vertex through Delaunay edges via BFS, collecting `max(2k, k+6)` candidates. Sort by distance, return top k. The oversampling margin (`k+6` for small k, `2k` for large k) ensures at least one full neighbor ring beyond the nearest vertex.

The expansion (and the filtered variant — the search takes a vertex predicate via the `filter` option, letting callers restrict matches to vertices satisfying arbitrary criteria) skips fan edges contributed by back-closure triangles. Rim vertices are graph-connected to distant rim vertices through the hull's underside chords, and a BFS seeded at the rim — every query from outside the patch is — would otherwise teleport along the patch boundary, scattering its visit budget over rim clusters hundreds of kilometres away and breaking the "hop order roughly tracks distance order" assumption the budget relies on. The greedy descent keeps the full fan: a chord can only ever shortcut it closer.

## Distance computation

`sphericalDistance` in `src/index.ts` uses `acos(dot(a, b))`, which is fine for Float64 math.

The query module (`src/flat-query.ts`) uses **chord distance** instead: `2 * asin(||v - q|| / 2)` (with clamping guards for numerical safety). This avoids catastrophic cancellation when vertex coordinates originate from Float32 storage (the binary serialization format). For nearby points, the dot product is approximately 1 and `(1 - dot)` falls below Float32 rounding error, causing `acos` to collapse to 0. Chord distance computes differences instead, which stay above the noise floor.

Both are monotonically related to great-circle distance, so they produce the same nearest-neighbor ordering.

## Why this approach

This library uses the convex-hull-to-Delaunay approach with triangle walks over alternatives:

- **KD-trees:** O(log N) queries but no adjacency structure for k-nearest BFS expansion. Also requires balancing and doesn't naturally decompose into regional partitions.
- **Hierarchical point location (Kirkpatrick):** O(log N) queries with O(N) storage, but complex to implement and doesn't benefit from warm-start hints across consecutive queries.
- **Triangle walks:** O(√N) expected but simple to implement, naturally support warm-starting from the previous query result (consecutive GPS positions are nearby), and the Delaunay adjacency structure directly supports k-nearest via BFS.

For a triangulation of a few thousand points (N ≈ 1,500, say), the walk takes on the order of √N ≈ 39 steps — fast enough that the O(√N) vs O(log N) distinction is irrelevant in practice.

## References

- Brown, K.Q. (1979). "Voronoi diagrams from convex hulls." _Information Processing Letters_, 9(5), 223-228.
- Shewchuk, J.R. (1997). "Adaptive Precision Floating-Point Arithmetic and Fast Robust Geometric Predicates." _Discrete & Computational Geometry_, 18, 305-363.
