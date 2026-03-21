// Simple AI test arena — 2 bots in a small room with weapons
// Run: node server/test-ai.js

import { Bot } from './Bot.js';
import { createPathfinder } from './Pathfinding.js';
import { WEAPON_DEFS } from './WeaponSystem.js';
import { ITEM_DEFS, createInventory, addToInventory } from './LootManager.js';

const MAP_SIZE = 20;
const TILE_PX = 48;

// Create a simple rectangular room: walls around edges, floor inside
const grid = new Uint8Array(MAP_SIZE * MAP_SIZE);
for (let r = 3; r < MAP_SIZE - 1; r++) {
  for (let c = 1; c < MAP_SIZE - 1; c++) {
    grid[r * MAP_SIZE + c] = 1; // floor
  }
}

// Create 2D grid for pathfinding
const grid2D = [];
for (let r = 0; r < MAP_SIZE; r++) {
  grid2D[r] = [];
  for (let c = 0; c < MAP_SIZE; c++) {
    grid2D[r][c] = grid[r * MAP_SIZE + c];
  }
}

const pathfinder = createPathfinder(grid2D, MAP_SIZE);

// Walkable check function
function isWalkableFn(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return false;
  return grid[ty * MAP_SIZE + tx] === 1;
}

// Spawn 2 bots
const bot1 = new Bot(5 * TILE_PX, 10 * TILE_PX);
const bot2 = new Bot(15 * TILE_PX, 10 * TILE_PX);

// Give them weapons
bot1.activeWeapon = ITEM_DEFS.pistol;
bot2.activeWeapon = ITEM_DEFS.pistol;

// Create loot: a couple health packs in the middle
const loot = [
  { id: 1, itemId: 'bandage', x: 10 * TILE_PX, y: 8 * TILE_PX, pickedUp: false },
  { id: 2, itemId: 'bandage', x: 10 * TILE_PX, y: 12 * TILE_PX, pickedUp: false },
];

const bots = [bot1, bot2];
const players = new Map(); // no human players

// Track stats
let tick = 0;
const LOG_INTERVAL = 30; // log every 0.5 seconds

console.log('=== AI Test Arena ===');
console.log(`Room: ${MAP_SIZE}x${MAP_SIZE}, 2 bots with pistols`);
console.log(`Bot1 at (${bot1.x}, ${bot1.y}), Bot2 at (${bot2.x}, ${bot2.y})`);
console.log('');

const interval = setInterval(() => {
  tick++;

  const gameState = {
    players,
    bots,
    loot,
    zone: { isInZone: () => true, serialize: () => ({}) },
    isWalkableFn,
    mapGrid: grid2D,
    mapSize: MAP_SIZE,
  };

  // Update both bots
  for (const bot of bots) {
    if (bot.hp <= 0) continue;
    const actions = bot.update(1/60, gameState, pathfinder, tick);

    // Process fire actions
    for (const action of actions) {
      if (action.type === 'bot_fire') {
        // Simple hit check: raycast toward target
        const target = bots.find(b => b !== bot && b.hp > 0);
        if (target) {
          const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
          // Simple hit chance based on distance
          if (dist < 400 && Math.random() < 0.3) {
            const dmg = WEAPON_DEFS[action.weaponId]?.damage || 10;
            target.hp -= dmg;
            if (tick % LOG_INTERVAL === 0 || target.hp <= 0) {
              console.log(`[${tick}] Bot${bot.id} HIT Bot${target.id} for ${dmg}dmg (${target.hp}hp left)`);
            }
          }
        }
      }
    }
  }

  // Log status periodically
  if (tick % LOG_INTERVAL === 0) {
    for (const bot of bots) {
      const enemy = bot.visibleEnemies.length;
      console.log(`[${tick}] Bot${bot.id}: state=${bot.state} hp=${bot.hp} pos=(${Math.round(bot.x)},${Math.round(bot.y)}) enemies=${enemy} weapon=${bot.activeWeapon?.id || 'none'}`);
    }
    console.log('');
  }

  // End conditions
  const alive = bots.filter(b => b.hp > 0);
  if (alive.length <= 1) {
    if (alive.length === 1) {
      console.log(`\n=== Bot${alive[0].id} WINS with ${alive[0].hp}hp at tick ${tick} ===`);
    } else {
      console.log(`\n=== DRAW at tick ${tick} ===`);
    }
    clearInterval(interval);
    process.exit(0);
  }

  // Timeout after 30 seconds (1800 ticks)
  if (tick >= 1800) {
    console.log(`\n=== TIMEOUT at tick ${tick} ===`);
    for (const bot of bots) {
      console.log(`  Bot${bot.id}: hp=${bot.hp} state=${bot.state}`);
    }
    clearInterval(interval);
    process.exit(0);
  }
}, 1000 / 60); // 60fps
