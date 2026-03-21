// LootManager.js — Loot spawning and pickup for battle royale

let _nextLootId = 1;

const ITEM_DEFS = {
  pistol:         { id: 'pistol',         name: 'Pistol',         slot: 'primary',    rarity: 'common',    tier: 1 },
  smg:            { id: 'smg',            name: 'SMG',            slot: 'primary',    rarity: 'rare',      tier: 2 },
  shotgun:        { id: 'shotgun',        name: 'Shotgun',        slot: 'secondary',  rarity: 'rare',      tier: 2 },
  sniper:         { id: 'sniper',         name: 'Sniper',         slot: 'primary',    rarity: 'epic',      tier: 3 },
  frag_grenade:   { id: 'frag_grenade',   name: 'Frag Grenade',   slot: 'tactical',   rarity: 'common',    tier: 1 },
  smoke_grenade:  { id: 'smoke_grenade',  name: 'Smoke Grenade',  slot: 'tactical',   rarity: 'common',    tier: 1 },
  medkit:         { id: 'medkit',         name: 'Medkit',         slot: 'consumable', rarity: 'common',    tier: 1, heals: 50 },
  bandage:        { id: 'bandage',        name: 'Bandage',        slot: 'consumable', rarity: 'common',    tier: 1, heals: 25 },
  energy_drink:   { id: 'energy_drink',   name: 'Energy Drink',   slot: 'consumable', rarity: 'rare',      tier: 2, effect: 'speed_boost' },
};

// Rarity weights: common 60%, rare 25%, epic 10%, legendary 5%
const RARITY_WEIGHTS = { common: 60, rare: 25, epic: 10, legendary: 5 };

function pickByRarity(pool) {
  // Build weighted list from the pool
  const entries = [];
  let totalWeight = 0;
  for (const item of pool) {
    const w = RARITY_WEIGHTS[item.rarity] || 0;
    if (w > 0) {
      entries.push({ item, weight: w });
      totalWeight += w;
    }
  }
  if (entries.length === 0) return null;

  let roll = Math.random() * totalWeight;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return entries[entries.length - 1].item;
}

const ALL_ITEMS = Object.values(ITEM_DEFS);
const EPIC_LEGENDARY_POOL = ALL_ITEMS.filter(i => i.rarity === 'epic' || i.rarity === 'legendary');
const COMMON_RARE_CONSUMABLE_POOL = ALL_ITEMS.filter(
  i => (i.rarity === 'common' || i.rarity === 'rare') && i.slot === 'consumable'
);

// Fallback pools: if the specialized pool is empty, use all items
const SUBWAY_POOL = EPIC_LEGENDARY_POOL.length > 0 ? EPIC_LEGENDARY_POOL.concat(ALL_ITEMS) : ALL_ITEMS;
const FOREST_POOL = COMMON_RARE_CONSUMABLE_POOL.length > 0 ? COMMON_RARE_CONSUMABLE_POOL.concat(ALL_ITEMS) : ALL_ITEMS;

/**
 * Spawn loot across the map grid.
 * @param {number[][]} mapGrid - 2D tile array
 * @param {number} MAP_SIZE - number of tiles per side
 * @returns {object[]} array of loot objects
 */
function spawnLoot(mapGrid, MAP_SIZE) {
  const loot = [];
  _nextLootId = 1;

  for (let ty = 0; ty < MAP_SIZE; ty++) {
    for (let tx = 0; tx < MAP_SIZE; tx++) {
      const tile = mapGrid[ty][tx];

      // Subway tile (1): 15% chance, weighted toward epic/legendary
      if (tile === 1) {
        if (Math.random() < 0.15) {
          const itemDef = pickByRarity(SUBWAY_POOL);
          if (itemDef) {
            loot.push({
              id: _nextLootId++,
              itemId: itemDef.id,
              x: tx * 48 + 24,
              y: ty * 48 + 24,
              pickedUp: false,
            });
          }
        }
      }

      // Forest tile (3): 5% chance, weighted toward common/rare consumables
      if (tile === 3) {
        if (Math.random() < 0.05) {
          const itemDef = pickByRarity(FOREST_POOL);
          if (itemDef) {
            loot.push({
              id: _nextLootId++,
              itemId: itemDef.id,
              x: tx * 48 + 24,
              y: ty * 48 + 24,
              pickedUp: false,
            });
          }
        }
      }
    }
  }

  return loot;
}

/**
 * Pick up a loot item by id.
 * @param {object[]} lootArray - the spawned loot array
 * @param {number} lootId - the loot instance id
 * @returns {object|null} the ITEM_DEFS entry, or null if not found / already picked up
 */
function pickupLoot(lootArray, lootId) {
  const entry = lootArray.find(l => l.id === lootId);
  if (!entry || entry.pickedUp) return null;
  entry.pickedUp = true;
  return ITEM_DEFS[entry.itemId] || null;
}

/**
 * Create a fresh player inventory.
 */
function createInventory() {
  return {
    primary: null,
    secondary: null,
    tactical: [],
    consumables: [],
  };
}

/**
 * Add an item to the inventory based on its slot.
 * Weapons replace existing (returning the dropped item). Tactical/consumable append up to 4.
 * @param {object} inventory
 * @param {object} itemDef - an entry from ITEM_DEFS
 * @returns {{ success: boolean, dropped: object|null }}
 */
function addToInventory(inventory, itemDef) {
  const { slot } = itemDef;

  if (slot === 'primary' || slot === 'secondary') {
    const dropped = inventory[slot];
    inventory[slot] = itemDef;
    return { success: true, dropped: dropped || null };
  }

  if (slot === 'tactical') {
    if (inventory.tactical.length >= 4) {
      return { success: false, dropped: null };
    }
    inventory.tactical.push(itemDef);
    return { success: true, dropped: null };
  }

  if (slot === 'consumable') {
    if (inventory.consumables.length >= 4) {
      return { success: false, dropped: null };
    }
    inventory.consumables.push(itemDef);
    return { success: true, dropped: null };
  }

  return { success: false, dropped: null };
}

export { ITEM_DEFS, spawnLoot, pickupLoot, createInventory, addToInventory };
