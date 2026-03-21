// Pathfinding.js — A* pathfinding using the `pathfinding` npm library

import PF from 'pathfinding';

// Walkable tile IDs: 1 (subway floor), 3 (dirt), 5 (doorway)
const WALKABLE = new Set([1, 3, 5]);

// ---------------------------------------------------------------------------
// createPathfinder
// ---------------------------------------------------------------------------

export function createPathfinder(mapGrid2D, mapSize) {
  // Create PF.Grid and mark walkable/unwalkable tiles
  const grid = new PF.Grid(mapSize, mapSize);
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      grid.setWalkableAt(x, y, WALKABLE.has(mapGrid2D[y][x]));
    }
  }

  // Create finder with diagonal movement, no corner cutting
  const finder = new PF.AStarFinder({
    allowDiagonal: true,
    dontCrossCorners: true,
  });

  // Pre-compute walkability for LOS checks
  function isWalkableAt(x, y) {
    if (x < 0 || y < 0 || x >= mapSize || y >= mapSize) return false;
    return WALKABLE.has(mapGrid2D[y][x]);
  }

  // -------------------------------------------------------------------
  // Bresenham line-of-sight check (tile coordinates)
  // -------------------------------------------------------------------
  function hasLineOfSight(x1, y1, x2, y2) {
    let dx = Math.abs(x2 - x1);
    let dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;

    let cx = x1;
    let cy = y1;

    while (true) {
      if (!isWalkableAt(cx, cy)) return false;
      if (cx === x2 && cy === y2) return true;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  // -------------------------------------------------------------------
  // A* pathfinding using the `pathfinding` library
  // -------------------------------------------------------------------
  function findPath(startX, startY, goalX, goalY) {
    // Bounds / walkability checks
    if (!isWalkableAt(startX, startY) || !isWalkableAt(goalX, goalY)) return null;
    if (startX === goalX && startY === goalY) return [{ x: startX, y: startY }];

    // MUST clone grid each time finder is used
    const path = finder.findPath(startX, startY, goalX, goalY, grid.clone());
    if (!path || path.length === 0) return null;

    // Apply path smoothing
    const smoothed = PF.Util.smoothenPath(grid.clone(), path);

    // Convert [[x,y], ...] to [{x,y}, ...]
    return smoothed.map(p => ({ x: p[0], y: p[1] }));
  }

  // -------------------------------------------------------------------
  // Pixel-coordinate convenience wrapper
  // -------------------------------------------------------------------
  function findPathPx(startX, startY, goalX, goalY, tilePx) {
    const sx = Math.floor(startX / tilePx);
    const sy = Math.floor(startY / tilePx);
    const gx = Math.floor(goalX / tilePx);
    const gy = Math.floor(goalY / tilePx);

    const tilePath = findPath(sx, sy, gx, gy);
    if (!tilePath) return null;

    const half = tilePx / 2;
    return tilePath.map(t => ({
      x: t.x * tilePx + half,
      y: t.y * tilePx + half,
    }));
  }

  return {
    findPath,
    findPathPx,
    hasLineOfSight,
  };
}
