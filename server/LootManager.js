// LootManager.js — Loot spawning and pickup for battle royale

let _nextLootId = 1;

const ITEM_DEFS = {
  pistol:         { id: 'pistol',         name: 'Pistol',         slot: 'primary',    rarity: 'common',    tier: 1 },
  smg:            { id: 'smg',            name: 'SMG',            slot: 'primary',    rarity: 'rare',      tier: 2 },
  shotgun:        { id: 'shotgun',        name: 'Shotgun',        slot: 'secondary',  rarity: 'rare',      tier: 2 },
  sniper:         { id: 'sniper',         name: 'Sniper',         slot: 'primary',    rarity: 'epic',      tier: 3 },
  ar:             { id: 'ar',             name: 'Assault Rifle',  slot: 'primary',    rarity: 'rare',      tier: 2 },
  lmg:            { id: 'lmg',            name: 'LMG',            slot: 'primary',    rarity: 'epic',      tier: 3 },
  dmr:            { id: 'dmr',            name: 'DMR',            slot: 'primary',    rarity: 'epic',      tier: 3 },
  frag_grenade:   { id: 'frag_grenade',   name: 'Frag Grenade',   slot: 'tactical',   rarity: 'common',    tier: 1 },
  smoke_grenade:  { id: 'smoke_grenade',  name: 'Smoke Grenade',  slot: 'tactical',   rarity: 'common',    tier: 1 },
  medkit:         { id: 'medkit',         name: 'Medkit',         slot: 'consumable', rarity: 'common',    tier: 1, heals: 50 },
  bandage:        { id: 'bandage',        name: 'Bandage',        slot: 'consumable', rarity: 'common',    tier: 1, heals: 25 },
  energy_drink:   { id: 'energy_drink',   name: 'Energy Drink',   slot: 'consumable', rarity: 'rare',      tier: 2, effect: 'speed_boost' },
  ammo_9mm:       { id: 'ammo_9mm',       name: '9mm Ammo',       slot: 'ammo',       ammoType: '9mm',     amount: 30, rarity: 'common', tier: 0 },
  ammo_556:       { id: 'ammo_556',       name: '5.56 Ammo',      slot: 'ammo',       ammoType: '556',     amount: 30, rarity: 'common', tier: 0 },
  ammo_762:       { id: 'ammo_762',       name: '7.62 Ammo',      slot: 'ammo',       ammoType: '762',     amount: 30, rarity: 'common', tier: 0 },
  ammo_12gauge:   { id: 'ammo_12gauge',   name: '12ga Shells',    slot: 'ammo',       ammoType: '12gauge', amount: 5,  rarity: 'common', tier: 0 },
  ammo_300:       { id: 'ammo_300',       name: '.300 Rounds',    slot: 'ammo',       ammoType: '300',     amount: 5,  rarity: 'uncommon', tier: 0 },
  first_aid_kit:  { id: 'first_aid_kit',  name: 'First Aid Kit',  slot: 'consumable', healAmount: 75,  healCap: 75,  useTime: 6000, rarity: 'uncommon', tier: 2 },
  medkit_full:    { id: 'medkit_full',    name: 'Med Kit',        slot: 'consumable', healAmount: 200, healCap: 200, useTime: 8000, rarity: 'rare',     tier: 3 },
  painkiller:     { id: 'painkiller',     name: 'Painkiller',     slot: 'boost',      boostAmount: 60,  useTime: 6000, rarity: 'uncommon', tier: 2 },
  adrenaline:     { id: 'adrenaline',     name: 'Adrenaline Syringe', slot: 'boost',  boostAmount: 100, useTime: 8000, rarity: 'rare',     tier: 3 },
  vest_1:         { id: 'vest_1',         name: 'Police Vest',       slot: 'vest',    level: 1, damageReduction: 0.30, durability: 200, rarity: 'common',   tier: 1 },
  vest_2:         { id: 'vest_2',         name: 'Military Vest',     slot: 'vest',    level: 2, damageReduction: 0.40, durability: 220, rarity: 'uncommon', tier: 2 },
  vest_3:         { id: 'vest_3',         name: 'Spetsnaz Vest',     slot: 'vest',    level: 3, damageReduction: 0.55, durability: 250, rarity: 'rare',     tier: 3 },
  helmet_1:       { id: 'helmet_1',       name: 'Motorcycle Helmet', slot: 'helmet',  level: 1, damageReduction: 0.30, durability: 80,  rarity: 'common',   tier: 1 },
  helmet_2:       { id: 'helmet_2',       name: 'Military Helmet',   slot: 'helmet',  level: 2, damageReduction: 0.40, durability: 150, rarity: 'uncommon', tier: 2 },
  helmet_3:       { id: 'helmet_3',       name: 'Spetsnaz Helmet',   slot: 'helmet',  level: 3, damageReduction: 0.55, durability: 230, rarity: 'rare',     tier: 3 },
};

// Rarity weights: common 60%, uncommon 40%, rare 25%, epic 10%, legendary 5%
const RARITY_WEIGHTS = { common: 60, uncommon: 40, rare: 25, epic: 10, legendary: 5 };

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
const AMMO_POOL = ALL_ITEMS.filter(i => i.slot === 'ammo');
const GEAR_POOL = ALL_ITEMS.filter(i => i.slot === 'vest' || i.slot === 'helmet');
const EPIC_LEGENDARY_POOL = ALL_ITEMS.filter(i => i.rarity === 'epic' || i.rarity === 'legendary');
const COMMON_RARE_CONSUMABLE_POOL = ALL_ITEMS.filter(
  i => (i.rarity === 'common' || i.rarity === 'rare' || i.rarity === 'uncommon') && (i.slot === 'consumable' || i.slot === 'boost')
);

// Subway: weapons + gear + ammo (weighted toward epic/legendary weapons, but includes ammo)
const SUBWAY_POOL = EPIC_LEGENDARY_POOL.concat(ALL_ITEMS).concat(AMMO_POOL).concat(GEAR_POOL);
// Forest: consumables + ammo + basic gear
const FOREST_POOL = COMMON_RARE_CONSUMABLE_POOL.concat(AMMO_POOL).concat(AMMO_POOL).concat(GEAR_POOL).concat(ALL_ITEMS);

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
    ammo: {},
    vest: null,
    helmet: null,
    boost: 0,
    magAmmo: { primary: 0, secondary: 0 },
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
    // Auto-load magazine from reserves when picking up a new weapon
    const { WEAPON_DEFS } = require_weapon_defs();
    const wdef = WEAPON_DEFS[itemDef.id];
    if (wdef && wdef.magSize) {
      const ammoType = wdef.ammoType;
      const reserve = inventory.ammo[ammoType] || 0;
      const load = Math.min(wdef.magSize, reserve);
      inventory.magAmmo[slot] = load;
      inventory.ammo[ammoType] = reserve - load;
    }
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

  if (slot === 'ammo') {
    const ammoType = itemDef.ammoType;
    inventory.ammo[ammoType] = (inventory.ammo[ammoType] || 0) + (itemDef.amount || 30);
    return { success: true, dropped: null };
  }

  if (slot === 'vest') {
    const current = inventory.vest;
    if (!current || itemDef.level > current.level) {
      inventory.vest = itemDef;
      return { success: true, dropped: current || null };
    }
    return { success: false, dropped: null };
  }

  if (slot === 'helmet') {
    const current = inventory.helmet;
    if (!current || itemDef.level > current.level) {
      inventory.helmet = itemDef;
      return { success: true, dropped: current || null };
    }
    return { success: false, dropped: null };
  }

  if (slot === 'boost') {
    if (inventory.consumables.length >= 4) {
      return { success: false, dropped: null };
    }
    inventory.consumables.push(itemDef);
    return { success: true, dropped: null };
  }

  return { success: false, dropped: null };
}

// Lazy import to avoid circular dependency
let _weaponDefsCache = null;
function require_weapon_defs() {
  if (!_weaponDefsCache) {
    // Import is dynamic to avoid circular deps at module load time
    // We rely on the fact that WeaponSystem.js is loaded before any addToInventory calls
    try {
      _weaponDefsCache = { WEAPON_DEFS: {} };
    } catch(e) {
      _weaponDefsCache = { WEAPON_DEFS: {} };
    }
  }
  return _weaponDefsCache;
}

function setWeaponDefs(defs) {
  _weaponDefsCache = { WEAPON_DEFS: defs };
}

export { ITEM_DEFS, spawnLoot, pickupLoot, createInventory, addToInventory, setWeaponDefs };
