// MapGenerator.js — BSP-based dungeon generator

export const MAP_SIZE = 100;
export const TILE_PX = 48;

export const TILE = {
  WALL: 0,
  SUBWAY_FLOOR: 1,
  GLASS: 2,
  DIRT: 3,
  FOLIAGE: 4,
  DOOR: 5,
};

export function isWalkable(tileId) {
  return tileId === TILE.SUBWAY_FLOOR || tileId === TILE.DIRT || tileId === TILE.DOOR;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

// ---------------------------------------------------------------------------
// BSP Tree
// ---------------------------------------------------------------------------

function splitBSP(node, depth) {
  if (depth >= 4 || node.w < 20 || node.h < 20) {
    node.leaf = true;
    return;
  }

  // Bias split direction by aspect ratio
  let splitHorizontal;
  if (node.w > node.h * 1.3) {
    splitHorizontal = false; // split vertically (along width)
  } else if (node.h > node.w * 1.3) {
    splitHorizontal = true;  // split horizontally (along height)
  } else {
    splitHorizontal = Math.random() < 0.5;
  }

  if (splitHorizontal) {
    const minSplit = Math.floor(node.h * 0.4);
    const maxSplit = Math.floor(node.h * 0.6);
    if (maxSplit - minSplit < 1) { node.leaf = true; return; }
    const split = randomInt(minSplit, maxSplit + 1);

    // Ensure both children meet minimum 10x10
    if (split < 10 || node.h - split < 10) { node.leaf = true; return; }

    node.left  = { x: node.x, y: node.y, w: node.w, h: split };
    node.right = { x: node.x, y: node.y + split, w: node.w, h: node.h - split };
  } else {
    const minSplit = Math.floor(node.w * 0.4);
    const maxSplit = Math.floor(node.w * 0.6);
    if (maxSplit - minSplit < 1) { node.leaf = true; return; }
    const split = randomInt(minSplit, maxSplit + 1);

    if (split < 10 || node.w - split < 10) { node.leaf = true; return; }

    node.left  = { x: node.x, y: node.y, w: split, h: node.h };
    node.right = { x: node.x + split, y: node.y, w: node.w - split, h: node.h };
  }

  splitBSP(node.left, depth + 1);
  splitBSP(node.right, depth + 1);
}

// ---------------------------------------------------------------------------
// Room placement
// ---------------------------------------------------------------------------

function placeRooms(node) {
  if (node.leaf || (!node.left && !node.right)) {
    // Leaf node — place a room with 3-tile margin (ensures 2-tile-tall walls)
    const margin = 3;
    const maxRoomW = node.w - margin * 2;
    const maxRoomH = node.h - margin * 2;

    let roomW = Math.max(6, randomInt(Math.floor(maxRoomW * 0.6), Math.floor(maxRoomW * 0.9) + 1));
    let roomH = Math.max(6, randomInt(Math.floor(maxRoomH * 0.6), Math.floor(maxRoomH * 0.9) + 1));

    // Clamp to partition
    roomW = Math.min(roomW, maxRoomW);
    roomH = Math.min(roomH, maxRoomH);

    if (roomW < 6 || roomH < 6) {
      roomW = Math.min(6, maxRoomW);
      roomH = Math.min(6, maxRoomH);
    }

    const roomX = node.x + margin + randomInt(0, Math.max(1, maxRoomW - roomW + 1));
    const roomY = node.y + margin + randomInt(0, Math.max(1, maxRoomH - roomH + 1));

    // Assign biome
    const roll = Math.random();
    let biome;
    if (roll < 0.5) biome = 'subway';
    else if (roll < 0.8) biome = 'forest';
    else biome = 'transition';

    node.room = { x: roomX, y: roomY, w: roomW, h: roomH, biome };
    return;
  }

  if (node.left) placeRooms(node.left);
  if (node.right) placeRooms(node.right);
}

// ---------------------------------------------------------------------------
// Room carving
// ---------------------------------------------------------------------------

function carveRoom(grid, room) {
  const { x, y, w, h } = room;
  // Simple open rooms — just floor, no interior features
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      grid[r * MAP_SIZE + c] = TILE.SUBWAY_FLOOR;
    }
  }
}

// ---------------------------------------------------------------------------
// Corridor carving
// ---------------------------------------------------------------------------

function carveCorridor(grid, x1, y1, x2, y2) {
  const horizontalFirst = Math.random() < 0.5;

  const corridorTile = TILE.SUBWAY_FLOOR;

  // Helper to carve a single segment (3-tile wide for wall clearance)
  function carveHorizontal(r, cFrom, cTo) {
    const step = cFrom <= cTo ? 1 : -1;
    for (let c = cFrom; c !== cTo + step; c += step) {
      for (let dr = 0; dr <= 2; dr++) {
        const row = r + dr;
        if (row >= 0 && row < MAP_SIZE && c >= 0 && c < MAP_SIZE) {
          const idx = row * MAP_SIZE + c;
          const prev = grid[idx];
          if (prev === TILE.WALL) {
            grid[idx] = corridorTile;
          }
        }
      }
    }
  }

  function carveVertical(c, rFrom, rTo) {
    const step = rFrom <= rTo ? 1 : -1;
    for (let r = rFrom; r !== rTo + step; r += step) {
      for (let dc = 0; dc <= 2; dc++) {
        const col = c + dc;
        if (r >= 0 && r < MAP_SIZE && col >= 0 && col < MAP_SIZE) {
          const idx = r * MAP_SIZE + col;
          const prev = grid[idx];
          if (prev === TILE.WALL) {
            grid[idx] = corridorTile;
          }
        }
      }
    }
  }

  if (horizontalFirst) {
    carveHorizontal(y1, x1, x2);
    carveVertical(x2, y1, y2);
    // Widen the bend corner to avoid thin walls
    for (let dr = -1; dr <= 3; dr++) {
      for (let dc = -1; dc <= 3; dc++) {
        const rr = y1 + dr, cc = x2 + dc;
        if (rr >= 0 && rr < MAP_SIZE && cc >= 0 && cc < MAP_SIZE && grid[rr * MAP_SIZE + cc] === TILE.WALL) {
          grid[rr * MAP_SIZE + cc] = corridorTile;
        }
      }
    }
  } else {
    carveVertical(x1, y1, y2);
    carveHorizontal(y2, x1, x2);
    for (let dr = -1; dr <= 3; dr++) {
      for (let dc = -1; dc <= 3; dc++) {
        const rr = y2 + dr, cc = x1 + dc;
        if (rr >= 0 && rr < MAP_SIZE && cc >= 0 && cc < MAP_SIZE && grid[rr * MAP_SIZE + cc] === TILE.WALL) {
          grid[rr * MAP_SIZE + cc] = corridorTile;
        }
      }
    }
  }

  // Place DOOR tiles at corridor-room transitions
  placeDoors(grid, x1, y1, x2, y2, horizontalFirst);
}

function placeDoors(grid, x1, y1, x2, y2, horizontalFirst) {
  // Scan corridor path and place doors at wall-to-floor transitions
  const points = [];

  if (horizontalFirst) {
    const step1 = x1 <= x2 ? 1 : -1;
    for (let c = x1; c !== x2 + step1; c += step1) {
      points.push({ r: y1, c });
    }
    const step2 = y1 <= y2 ? 1 : -1;
    for (let r = y1; r !== y2 + step2; r += step2) {
      points.push({ r, c: x2 });
    }
  } else {
    const step1 = y1 <= y2 ? 1 : -1;
    for (let r = y1; r !== y2 + step1; r += step1) {
      points.push({ r, c: x1 });
    }
    const step2 = x1 <= x2 ? 1 : -1;
    for (let c = x1; c !== x2 + step2; c += step2) {
      points.push({ r: y2, c });
    }
  }

  // Walk through corridor points and detect transitions from corridor into room
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const prevTile = grid[prev.r * MAP_SIZE + prev.c];
    const currTile = grid[curr.r * MAP_SIZE + curr.c];

    // Detect transition: corridor tile next to a non-corridor walkable tile
    if (prevTile === TILE.SUBWAY_FLOOR && currTile !== TILE.SUBWAY_FLOOR && isWalkable(currTile)) {
      // Place door at the transition point
      for (let dr = 0; dr <= 1; dr++) {
        for (let dc = 0; dc <= 1; dc++) {
          const doorR = prev.r + dr;
          const doorC = prev.c + dc;
          if (doorR >= 0 && doorR < MAP_SIZE && doorC >= 0 && doorC < MAP_SIZE) {
            const idx = doorR * MAP_SIZE + doorC;
            if (grid[idx] === TILE.SUBWAY_FLOOR) {
              grid[idx] = TILE.DOOR;
            }
          }
        }
      }
    }
    if (currTile === TILE.SUBWAY_FLOOR && prevTile !== TILE.SUBWAY_FLOOR && isWalkable(prevTile)) {
      for (let dr = 0; dr <= 1; dr++) {
        for (let dc = 0; dc <= 1; dc++) {
          const doorR = curr.r + dr;
          const doorC = curr.c + dc;
          if (doorR >= 0 && doorR < MAP_SIZE && doorC >= 0 && doorC < MAP_SIZE) {
            const idx = doorR * MAP_SIZE + doorC;
            if (grid[idx] === TILE.SUBWAY_FLOOR) {
              grid[idx] = TILE.DOOR;
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// BSP room connection
// ---------------------------------------------------------------------------

function getAllRooms(node) {
  if (!node) return [];
  if (node.room) return [node.room];
  return [...getAllRooms(node.left), ...getAllRooms(node.right)];
}

function roomCenter(room) {
  return {
    x: Math.floor(room.x + room.w / 2),
    y: Math.floor(room.y + room.h / 2),
  };
}

function distSq(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function connectRooms(grid, node) {
  if (!node || !node.left || !node.right) return;

  // Post-order: connect children first
  connectRooms(grid, node.left);
  connectRooms(grid, node.right);

  // Find closest room pair between left and right subtrees
  const leftRooms = getAllRooms(node.left);
  const rightRooms = getAllRooms(node.right);

  let bestDist = Infinity;
  let bestL = null;
  let bestR = null;

  for (const lr of leftRooms) {
    const lc = roomCenter(lr);
    for (const rr of rightRooms) {
      const rc = roomCenter(rr);
      const d = distSq(lc, rc);
      if (d < bestDist) {
        bestDist = d;
        bestL = lr;
        bestR = rr;
      }
    }
  }

  if (bestL && bestR) {
    const lc = roomCenter(bestL);
    const rc = roomCenter(bestR);
    carveCorridor(grid, lc.x, lc.y, rc.x, rc.y);
  }
}

// ---------------------------------------------------------------------------
// Smooth pass (cellular automata)
// ---------------------------------------------------------------------------

function smoothPass(grid, iterations) {
  for (let iter = 0; iter < iterations; iter++) {
    const changes = [];

    for (let r = 1; r < MAP_SIZE - 1; r++) {
      for (let c = 1; c < MAP_SIZE - 1; c++) {
        const idx = r * MAP_SIZE + c;
        if (grid[idx] !== TILE.WALL) continue;

        let walkableCount = 0;
        let subwayCount = 0;
        let dirtCount = 0;

        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            const nIdx = nr * MAP_SIZE + nc;
            const t = grid[nIdx];
            if (isWalkable(t) || t === TILE.GLASS || t === TILE.FOLIAGE) {
              walkableCount++;
              if (t === TILE.SUBWAY_FLOOR || t === TILE.GLASS || t === TILE.DOOR) subwayCount++;
              if (t === TILE.DIRT || t === TILE.FOLIAGE) dirtCount++;
            }
          }
        }

        if (walkableCount >= 5) {
          const replaceTile = subwayCount >= dirtCount ? TILE.SUBWAY_FLOOR : TILE.DIRT;
          changes.push({ idx, tile: replaceTile });
        }
      }
    }

    for (const { idx, tile } of changes) {
      grid[idx] = tile;
    }
  }
}

// ---------------------------------------------------------------------------
// Connectivity validation
// ---------------------------------------------------------------------------

function validateConnectivity(grid, walkable) {
  if (walkable.length === 0) return;

  const visited = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const directions = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
  ];

  function floodFill(startIdx) {
    const startR = Math.floor(startIdx / MAP_SIZE);
    const startC = startIdx % MAP_SIZE;
    const stack = [{ r: startR, c: startC }];
    visited[startIdx] = 1;

    while (stack.length > 0) {
      const { r, c } = stack.pop();
      for (const [dr, dc] of directions) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= MAP_SIZE || nc < 0 || nc >= MAP_SIZE) continue;
        const nIdx = nr * MAP_SIZE + nc;
        if (visited[nIdx]) continue;
        if (isWalkable(grid[nIdx])) {
          visited[nIdx] = 1;
          stack.push({ r: nr, c: nc });
        }
      }
    }
  }

  // Start flood fill from first walkable tile
  const firstIdx = walkable[0].y * MAP_SIZE + walkable[0].x;
  floodFill(firstIdx);

  // Check for unreachable walkable tiles and connect them
  let maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let disconnected = null;

    for (const w of walkable) {
      const idx = w.y * MAP_SIZE + w.x;
      if (!visited[idx] && isWalkable(grid[idx])) {
        disconnected = w;
        break;
      }
    }

    if (!disconnected) break;

    // Find the closest visited walkable tile
    let bestDist = Infinity;
    let bestTarget = null;

    for (const w of walkable) {
      const idx = w.y * MAP_SIZE + w.x;
      if (visited[idx]) {
        const d = Math.abs(w.x - disconnected.x) + Math.abs(w.y - disconnected.y);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = w;
        }
      }
    }

    if (bestTarget) {
      // Carve a direct corridor to connect
      carveCorridor(grid, disconnected.x, disconnected.y, bestTarget.x, bestTarget.y);

      // Re-flood from scratch
      visited.fill(0);
      floodFill(firstIdx);
    }
  }
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Arena map generator — small square room for testing
// ---------------------------------------------------------------------------

export function generateArenaMap() {
  const ARENA_SIZE = 20;
  const grid = new Uint8Array(ARENA_SIZE * ARENA_SIZE);
  // Fill with walls
  // Uint8Array is zero-initialized = all walls

  // Carve open floor in center (2-tile wall border, 2-tile tall walls)
  for (let r = 3; r < ARENA_SIZE - 2; r++) {
    for (let c = 2; c < ARENA_SIZE - 2; c++) {
      grid[r * ARENA_SIZE + c] = TILE.SUBWAY_FLOOR;
    }
  }

  // Add a few cover walls in the middle
  // Small L-shaped cover on left side
  grid[8 * ARENA_SIZE + 6] = TILE.WALL;
  grid[9 * ARENA_SIZE + 6] = TILE.WALL;
  grid[10 * ARENA_SIZE + 6] = TILE.WALL;
  grid[10 * ARENA_SIZE + 7] = TILE.WALL;

  // Small L-shaped cover on right side
  grid[8 * ARENA_SIZE + 13] = TILE.WALL;
  grid[9 * ARENA_SIZE + 13] = TILE.WALL;
  grid[10 * ARENA_SIZE + 13] = TILE.WALL;
  grid[10 * ARENA_SIZE + 12] = TILE.WALL;

  // Build walkable list
  const walkable = [];
  for (let r = 0; r < ARENA_SIZE; r++) {
    for (let c = 0; c < ARENA_SIZE; c++) {
      if (isWalkable(grid[r * ARENA_SIZE + c])) {
        walkable.push({ x: c, y: r });
      }
    }
  }

  const wallVariants = computeAutoTiles(grid, ARENA_SIZE);
  return { grid, walkable, wallVariants, mapSize: ARENA_SIZE };
}

export function generateMap() {
  // Create grid filled with WALL
  const grid = new Uint8Array(MAP_SIZE * MAP_SIZE);
  // Uint8Array is zero-initialized, and TILE.WALL === 0, so grid is already all walls.

  // Build BSP tree
  const root = { x: 0, y: 0, w: MAP_SIZE, h: MAP_SIZE };
  splitBSP(root, 0);

  // Place rooms in leaf nodes
  placeRooms(root);

  // Carve rooms into the grid
  const allRooms = getAllRooms(root);
  for (const room of allRooms) {
    carveRoom(grid, room);
  }

  // Connect rooms via BSP traversal
  connectRooms(grid, root);

  // Smooth pass disabled — creates irregular thin walls
  // smoothPass(grid, 2);

  // Build walkable list
  let walkable = [];
  for (let r = 0; r < MAP_SIZE; r++) {
    for (let c = 0; c < MAP_SIZE; c++) {
      if (isWalkable(grid[r * MAP_SIZE + c])) {
        walkable.push({ x: c, y: r });
      }
    }
  }

  // Validate connectivity
  validateConnectivity(grid, walkable);

  // Rebuild walkable list after potential corridor additions from connectivity fix
  walkable = [];
  for (let r = 0; r < MAP_SIZE; r++) {
    for (let c = 0; c < MAP_SIZE; c++) {
      if (isWalkable(grid[r * MAP_SIZE + c])) {
        walkable.push({ x: c, y: r });
      }
    }
  }

  // ── Ensure all north-facing walls are at least 2 tiles tall ──────
  // In the 3/4 view, walls with floor to south need a top row (wall_top) above
  // the bottom row (wall_bot). If a wall has floor to south but its north
  // neighbor is also floor, we need to push the floor down or add a wall row.
  ensureDoubleHeightWalls(grid);

  // Rebuild walkable after wall height adjustments
  walkable = [];
  for (let r = 0; r < MAP_SIZE; r++) {
    for (let c = 0; c < MAP_SIZE; c++) {
      if (isWalkable(grid[r * MAP_SIZE + c])) {
        walkable.push({ x: c, y: r });
      }
    }
  }

  const wallVariants = computeAutoTiles(grid, MAP_SIZE);
  return { grid, walkable, wallVariants };
}

// ---------------------------------------------------------------------------
// Ensure walls are at least 2 tiles tall for 3/4 perspective
// ---------------------------------------------------------------------------

function ensureDoubleHeightWalls(grid) {
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (let r = 1; r < MAP_SIZE - 1; r++) {
      for (let c = 0; c < MAP_SIZE; c++) {
        if (grid[r * MAP_SIZE + c] !== 0) continue;          // not a wall
        if (grid[(r + 1) * MAP_SIZE + c] === 0) continue;    // south is wall, OK
        if (grid[(r - 1) * MAP_SIZE + c] === 0) continue;    // north is wall, OK
        // Wall with non-wall on both sides — convert SOUTH to wall
        grid[(r + 1) * MAP_SIZE + c] = 0;
        changed = true;
      }
    }
    // Also ensure wall_bot (floor to south) has wall to north
    for (let r = 1; r < MAP_SIZE - 1; r++) {
      for (let c = 0; c < MAP_SIZE; c++) {
        if (grid[r * MAP_SIZE + c] !== 0) continue;
        if (grid[(r + 1) * MAP_SIZE + c] === 0) continue;    // south is wall
        if (grid[(r - 1) * MAP_SIZE + c] === 0) continue;    // north is wall
        // Still a violation — convert north to wall
        grid[(r - 1) * MAP_SIZE + c] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Run again after diagonal fills might have introduced new thin walls
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (let r = 1; r < MAP_SIZE - 1; r++) {
      for (let c = 0; c < MAP_SIZE; c++) {
        if (grid[r * MAP_SIZE + c] !== 0) continue;
        if (grid[(r + 1) * MAP_SIZE + c] === 0) continue;
        if (grid[(r - 1) * MAP_SIZE + c] === 0) continue;
        grid[(r + 1) * MAP_SIZE + c] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

// ---------------------------------------------------------------------------
// Autotile computation (9-slice wall variants via 4-bit cardinal bitmask)
// ---------------------------------------------------------------------------

function computeAutoTiles(flatGrid, mapSize) {
  const variants = new Uint8Array(mapSize * mapSize);
  function isFloor(r, c) {
    if (r < 0 || c < 0 || r >= mapSize || c >= mapSize) return false;
    const t = flatGrid[r * mapSize + c];
    return t === 1 || t === 3 || t === 5;
  }

  for (let r = 0; r < mapSize; r++) {
    for (let c = 0; c < mapSize; c++) {
      const idx = r * mapSize + c;
      if (flatGrid[idx] !== 0) { variants[idx] = 0; continue; }

      let mask = 0;
      // Cardinal edges: bits 0-3
      const N = isFloor(r - 1, c), E = isFloor(r, c + 1);
      const S = isFloor(r + 1, c), W = isFloor(r, c - 1);
      if (N) mask |= 1;
      if (E) mask |= 2;
      if (S) mask |= 4;
      if (W) mask |= 8;

      // Inside corners: bits 4-7
      // An inside corner exists when BOTH adjacent cardinal neighbors are walls
      // but the diagonal between them is floor
      // bit 4 (16) = NE diagonal is floor (and N,E are both walls)
      if (!N && !E && isFloor(r - 1, c + 1)) mask |= 16;
      // bit 5 (32) = NW diagonal is floor (and N,W are both walls)
      if (!N && !W && isFloor(r - 1, c - 1)) mask |= 32;
      // bit 6 (64) = SE diagonal is floor (and S,E are both walls)
      if (!S && !E && isFloor(r + 1, c + 1)) mask |= 64;
      // bit 7 (128) = SW diagonal is floor (and S,W are both walls)
      if (!S && !W && isFloor(r + 1, c - 1)) mask |= 128;

      variants[idx] = mask;
    }
  }
  return variants;
}
