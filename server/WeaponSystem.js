const MAP_SIZE = 100;
const TILE_PX = 48;
const IMPASSABLE = new Set([0, 2, 4]);
const RAY_STEP = 4;
const ENTITY_HALF = 10; // 20x20 bounding box (thinner LimeZu characters)

let nextProjectileId = 1;

const WEAPON_DEFS = {
  pistol:   { type: 'hitscan',    damage: 15, range: 500,  fireRate: 300,  spread: 0.05 },
  smg:      { type: 'hitscan',    damage: 10, range: 400,  fireRate: 100,  spread: 0.12 },
  shotgun:  { type: 'hitscan',    damage: 8,  pellets: 6,  range: 300, fireRate: 800, spread: 0.25 },
  sniper:   { type: 'hitscan',    damage: 75, range: 1200, fireRate: 1500, spread: 0 },
  grenade:  { type: 'projectile', damage: 50, radius: 120, speed: 400, fuseTime: 2000 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tileAt(mapGrid, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return 0;
  return mapGrid[ty][tx];
}

function isImpassable(mapGrid, tx, ty) {
  return IMPASSABLE.has(tileAt(mapGrid, tx, ty));
}

/**
 * Cast a ray from (x,y) along `angle` up to `maxDist` pixels.
 * Returns { hitX, hitY, tileX, tileY, dist } on wall hit, or null.
 */
function raycastMap(x, y, angle, maxDist, mapGrid, tileSize = TILE_PX) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let dist = 0;

  while (dist < maxDist) {
    dist += RAY_STEP;
    const px = x + dx * dist;
    const py = y + dy * dist;
    const tx = Math.floor(px / tileSize);
    const ty = Math.floor(py / tileSize);

    if (isImpassable(mapGrid, tx, ty)) {
      return { hitX: px, hitY: py, tileX: tx, tileY: ty, dist };
    }
  }
  return null;
}

/**
 * AABB hit-test for a point against an entity's 24x24 bounding box.
 */
function pointInEntity(px, py, entity) {
  return (
    px >= entity.x - ENTITY_HALF &&
    px <= entity.x + ENTITY_HALF &&
    py >= entity.y - ENTITY_HALF &&
    py <= entity.y + ENTITY_HALF
  );
}

// ---------------------------------------------------------------------------
// Hitscan
// ---------------------------------------------------------------------------

function castSingleRay(shooterX, shooterY, angle, weaponDef, mapGrid, entities) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const maxDist = weaponDef.range;
  let dist = 0;

  while (dist < maxDist) {
    dist += RAY_STEP;
    const px = shooterX + dx * dist;
    const py = shooterY + dy * dist;

    // Wall collision
    const tx = Math.floor(px / TILE_PX);
    const ty = Math.floor(py / TILE_PX);
    if (isImpassable(mapGrid, tx, ty)) {
      return { hit: false, target: null, wallHit: { x: px, y: py }, distance: dist };
    }

    // Entity collision
    for (const entity of entities) {
      if (pointInEntity(px, py, entity)) {
        return { hit: true, target: entity, wallHit: null, distance: dist };
      }
    }
  }

  return { hit: false, target: null, wallHit: null, distance: maxDist };
}

/**
 * Fire a hitscan weapon from the shooter's position.
 * Returns an array of results — one per pellet.
 * Each result: { hit: bool, target: entity|null, wallHit: {x,y}|null, distance: number }
 */
function fireHitscan(shooter, angle, weaponDef, mapGrid, entities) {
  // Filter out the shooter from candidate targets
  const targets = entities.filter(e => e !== shooter && e.id !== shooter.id);
  const pellets = weaponDef.pellets || 1;

  const results = [];

  for (let i = 0; i < pellets; i++) {
    const spreadOffset = (Math.random() * 2 - 1) * weaponDef.spread;
    const pelletAngle = angle + spreadOffset;
    const result = castSingleRay(shooter.x, shooter.y, pelletAngle, weaponDef, mapGrid, targets);
    results.push(result);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

/**
 * Create a new projectile object.
 */
function fireProjectile(shooterId, x, y, angle, weaponDef) {
  return {
    id: nextProjectileId++,
    ownerId: shooterId,
    x,
    y,
    vx: Math.cos(angle) * weaponDef.speed,
    vy: Math.sin(angle) * weaponDef.speed,
    fuseTime: weaponDef.fuseTime,
    damage: weaponDef.damage,
    radius: weaponDef.radius,
    alive: true,
  };
}

/**
 * Explode a projectile at its current position.
 * Finds all entities within blast radius and applies damage with linear falloff.
 */
function explode(projectile, entities) {
  const hits = [];
  const { x, y, radius, damage } = projectile;

  for (const entity of entities) {
    const dx = entity.x - x;
    const dy = entity.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= radius) {
      const falloff = 1 - dist / radius;
      const dmg = Math.round(damage * falloff);
      if (dmg > 0) {
        hits.push({ entityId: entity.id, damage: dmg });
      }
    }
  }

  return { x, y, radius, hits };
}

/**
 * Advance all projectiles by `dt` seconds.
 * Returns an array of explosion events for projectiles that detonated this frame.
 */
function updateProjectiles(projectiles, dt, mapGrid, entities) {
  const explosions = [];

  for (const proj of projectiles) {
    if (!proj.alive) continue;

    // Move
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;

    // Wall collision
    const tx = Math.floor(proj.x / TILE_PX);
    const ty = Math.floor(proj.y / TILE_PX);
    if (isImpassable(mapGrid, tx, ty)) {
      proj.alive = false;
      explosions.push(explode(proj, entities));
      continue;
    }

    // Entity collision (direct hit)
    for (const entity of entities) {
      if (entity.id === proj.ownerId) continue;
      if (pointInEntity(proj.x, proj.y, entity)) {
        proj.alive = false;
        explosions.push(explode(proj, entities));
        break;
      }
    }
    if (!proj.alive) continue;

    // Fuse countdown (dt is in seconds, fuseTime is in ms)
    proj.fuseTime -= dt * 1000;
    if (proj.fuseTime <= 0) {
      proj.alive = false;
      explosions.push(explode(proj, entities));
    }
  }

  return explosions;
}

export { WEAPON_DEFS, fireHitscan, fireProjectile, updateProjectiles };
