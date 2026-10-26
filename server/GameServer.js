import {randomUUID} from 'node:crypto';
// GameServer.js — authoritative game loop coordinating all subsystems

import { generateMap, generateArenaMap, isWalkable, MAP_SIZE, TILE_PX } from './MapGenerator.js';
import { Bot } from './Bot.js';
import { WEAPON_DEFS, fireHitscan, fireProjectile, updateProjectiles } from './WeaponSystem.js';
import { spawnLoot, pickupLoot, createInventory, addToInventory, ITEM_DEFS, setWeaponDefs } from './LootManager.js';
import { ZoneManager } from './ZoneManager.js';
import { createPathfinder } from './Pathfinding.js';

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const BROADCAST_EVERY = 3; // send state every 3 ticks (~20Hz)
const PLAYER_SPEED = 220; // px/s
const PICKUP_RANGE = 40;
const MAX_HISTORY = 60; // 1 second of snapshots

// Helper: determine which inventory slot is active based on last fire slot
function activeSlotForPlayer(p) {
  // Use _activeSlot if set, default to primary
  return p._activeSlot || 'primary';
}

export class GameServer {
  constructor(io, mode = 'normal', {botCount=100}={}) {
    if(!Number.isInteger(botCount)||botCount<0||botCount>100)throw Error('botCount must be 0..100');
    this.botCount=botCount;
    this.io = io;
    this.worldRevision=randomUUID();
    this.mode = mode; // 'normal' or 'arena'

    // Register weapon defs for LootManager ammo loading
    setWeaponDefs(WEAPON_DEFS);

    // Generate map
    if (mode === 'arena') {
      const result = generateArenaMap();
      this.flatGrid = result.grid;
      this.walkable = result.walkable;
      this.wallVariants = result.wallVariants;
      this.mapSizeActual = result.mapSize;
    } else {
      const { grid: flatGrid, walkable, wallVariants } = generateMap();
      this.flatGrid = flatGrid;
      this.walkable = walkable;
      this.wallVariants = wallVariants;
      this.mapSizeActual = MAP_SIZE;
    }

    const sz = this.mapSizeActual;

    // 2D grid for subsystems
    this.mapGrid = [];
    for (let r = 0; r < sz; r++) {
      this.mapGrid[r] = new Array(sz);
      for (let c = 0; c < sz; c++) {
        this.mapGrid[r][c] = this.flatGrid[r * sz + c];
      }
    }

    this.isWalkableFn = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= sz || ty >= sz) return false;
      return isWalkable(this.mapGrid[ty][tx]);
    };

    // Players: channelId -> state
    this.players = new Map();

    // Bots
    this.bots = [];
    if (mode === 'arena') {
      this._spawnArenaBots();
    } else {
      this._spawnBots();
    }

    // Loot
    if (mode === 'arena') {
      this.loot = this._spawnArenaLoot();
    } else {
      this.loot = spawnLoot(this.mapGrid, sz);
    }

    // Zone
    this.zone = new ZoneManager(sz, TILE_PX);

    // Pathfinder (A* on the tile grid)
    this.pathfinder = createPathfinder(this.mapGrid, sz);

    // Projectiles
    this.projectiles = [];

    // State history for lag compensation
    this.stateHistory = [];

    // Events queued for next broadcast
    this.events = [];

    // Kill tracking for leaderboard
    this.killCounts = new Map();

    this.tick = 0;
    this._interval = null;
  }

  _spawnBots() {
    // Spread bots out — enforce minimum distance between spawns
    const MIN_SPAWN_DIST = 96; // 3 tiles apart minimum
    const available = this.walkable.slice();
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }
    const spawned = [];
    for (const t of available) {
      if (spawned.length >= this.botCount) break;
      const px = t.x * TILE_PX + TILE_PX / 2;
      const py = t.y * TILE_PX + TILE_PX / 2;
      // Check distance from all already-spawned bots
      let tooClose = false;
      for (const s of spawned) {
        const dx = px - s.x, dy = py - s.y;
        if (dx * dx + dy * dy < MIN_SPAWN_DIST * MIN_SPAWN_DIST) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      spawned.push({ x: px, y: py });
      this.bots.push(new Bot(px, py));
    }
    console.log(`Spawned ${this.bots.length} bots (target: ${this.botCount}, min spacing: ${MIN_SPAWN_DIST}px)`);
  }

  _spawnArenaBots() {
    const half = TILE_PX / 2;
    // Spawn 4 bots in the corners of the arena
    const spawns = [
      { x: 4, y: 5 },   // top-left
      { x: 15, y: 5 },  // top-right
      { x: 4, y: 15 },  // bottom-left
      { x: 15, y: 15 }, // bottom-right
    ];
    for (const s of spawns) {
      this.bots.push(new Bot(s.x * TILE_PX + half, s.y * TILE_PX + half));
    }
    console.log(`Arena mode: spawned ${this.bots.length} bots`);
  }

  _spawnArenaLoot() {
    const loot = [];
    let nextId = 1;
    const half = TILE_PX / 2;

    // Collect walkable tiles (excluding border)
    const spots = [];
    for (const w of this.walkable) {
      // Skip tiles near the border or on cover walls
      if (w.x >= 3 && w.x <= 16 && w.y >= 4 && w.y <= 16) {
        spots.push(w);
      }
    }
    // Shuffle
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }

    let si = 0;
    function nextSpot() {
      const s = spots[si++ % spots.length];
      return { x: s.x * TILE_PX + half, y: s.y * TILE_PX + half };
    }

    // 4 weapons (one per bot roughly)
    const weapons = ['ar', 'smg', 'shotgun', 'pistol'];
    for (const w of weapons) {
      const p = nextSpot();
      loot.push({ id: `arena_${nextId++}`, itemId: w, x: p.x, y: p.y, pickedUp: false });
    }

    // Ammo for each weapon type
    const ammoTypes = ['ammo_556', 'ammo_9mm', 'ammo_12gauge', 'ammo_9mm', 'ammo_556'];
    for (const a of ammoTypes) {
      const p = nextSpot();
      loot.push({ id: `arena_${nextId++}`, itemId: a, x: p.x, y: p.y, pickedUp: false });
    }

    // A couple medkits
    for (let i = 0; i < 2; i++) {
      const p = nextSpot();
      loot.push({ id: `arena_${nextId++}`, itemId: 'medkit', x: p.x, y: p.y, pickedUp: false });
    }

    return loot;
  }

  getSpawnPos() {
    // Try to find a spawn position away from bots and other players
    const MIN_SAFE_DIST = 200;
    const candidates = this.walkable.slice();
    // Shuffle
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const t of candidates) {
      const px = t.x * TILE_PX + TILE_PX / 2;
      const py = t.y * TILE_PX + TILE_PX / 2;
      let safe = true;
      for (const bot of this.bots) {
        if (bot.hp <= 0) continue;
        const dx = px - bot.x, dy = py - bot.y;
        if (dx * dx + dy * dy < MIN_SAFE_DIST * MIN_SAFE_DIST) { safe = false; break; }
      }
      if (!safe) continue;
      for (const [, p] of this.players) {
        if (!p.alive) continue;
        const dx = px - p.x, dy = py - p.y;
        if (dx * dx + dy * dy < MIN_SAFE_DIST * MIN_SAFE_DIST) { safe = false; break; }
      }
      if (safe) return { x: px, y: py };
    }
    // Fallback: just pick a random tile
    const t = candidates[0];
    return { x: t.x * TILE_PX + TILE_PX / 2, y: t.y * TILE_PX + TILE_PX / 2 };
  }

  publicWorld(){
    return {worldRevision:this.worldRevision,map:Array.from(this.flatGrid),mapSize:this.mapSizeActual,tilePx:TILE_PX,
      bots:this.bots.map(b=>b.serialize()),loot:this.loot.filter(l=>!l.pickedUp),zone:this.zone.serialize(),wallVariants:Array.from(this.wallVariants),mode:this.mode};
  }

  _sendInit(socket,playerState){
    socket.emit('init',{playerId:socket.id,playerState,worldRevision:this.worldRevision,worldURL:'/api/world/'+this.worldRevision});
  }

  addPlayer(socket) {
    if(this.players.has(socket.id)){this._sendInit(socket,this._serializePlayer(this.players.get(socket.id)));return;}
    if (this.mode === 'arena') {
      // Arena mode: player is a spectator, no playable character
      const sz = this.mapSizeActual;
      const spectatorState = {
        id: socket.id, x: sz * TILE_PX / 2, y: sz * TILE_PX / 2,
        angle: 0, hp: 100, alive: true, lastSeq: 0,
        reloading: false, sprinting: false, crouching: false, boost: 0,
        vestLevel: 0, helmetLevel: 0,
        inventory: { primary: null, secondary: null, tactical: [], consumables: [], ammo: {}, magAmmo: {} },
      };
      // Don't add to this.players — spectator only
      this._sendInit(socket,spectatorState);
      return;
    }

    const pos = this.getSpawnPos();
    const p = {
      id: socket.id,
      x: pos.x,
      y: pos.y,
      angle: 0,
      hp: 100,
      maxHp: 100,
      speed: PLAYER_SPEED,
      lastSeq: 0,
      inventory: createInventory(),
      lastFireTime: 0,
      alive: true,
      inputs: [], // pending input queue
      spawnProtection: 180, // 3 seconds at 60 ticks/s
      reloading: false,
      reloadEndTick: 0,
      sprinting: false,
      crouching: false,
      boost: 0,
    };
    // Give starting pistol + ammo
    addToInventory(p.inventory, ITEM_DEFS.pistol);
    p.inventory.ammo['9mm'] = (p.inventory.ammo['9mm'] || 0) + 60;
    // Fill magazine
    p.inventory.magAmmo.primary = WEAPON_DEFS.pistol.magSize;
    this.players.set(socket.id, p);

    // Send init data
    this._sendInit(socket,this._serializePlayer(p));
  }

  removePlayer(channelId) {
    this.players.delete(channelId);
  }

  handleInput(channelId, data) {
    const p = this.players.get(channelId);
    if (!p) return;
    if (!p.alive) {
      // Dead in battle royale = dead. No respawns.
      // Game auto-restarts when all humans are dead.
      return;
    }
    if(!data || !Number.isSafeInteger(data.seq) || data.seq<0 || !Number.isFinite(data.angle) || !data.keys || typeof data.keys!=='object')return;
    if(data.seq<=(p.intent?.seq??p.lastSeq))return;
    p.intent={seq:data.seq,angle:data.angle,keys:Object.fromEntries(['w','a','s','d','shift','ctrl'].map(k=>[k,Boolean(data.keys[k])]))};
    p.lastInputAt=performance.now();
  }

  handleFire(channelId, data) {
    const p = this.players.get(channelId);
    if (!p || !p.alive) return;

    // Cannot fire while sprinting or reloading
    if (p.sprinting || p.reloading) return;

    const weaponSlot = data.slot || 'primary';
    p._activeSlot = weaponSlot; // track active slot for reload
    let itemDef;
    if (weaponSlot === 'tactical') {
      // Tactical is an array — use first item and consume it after fire
      itemDef = p.inventory.tactical[0];
    } else {
      itemDef = p.inventory[weaponSlot];
    }
    if (!itemDef) return;
    const weaponDef = WEAPON_DEFS[itemDef.id];
    if (!weaponDef) return;

    const now = Date.now();
    if (now - p.lastFireTime < weaponDef.fireRate) return;

    // Check magazine ammo for hitscan weapons
    if (weaponDef.type === 'hitscan' && weaponDef.magSize) {
      const currentMag = p.inventory.magAmmo[weaponSlot] || 0;
      if (currentMag <= 0) {
        // Auto-reload when trying to fire with empty mag
        this.handleReload(channelId);
        return;
      }
      p.inventory.magAmmo[weaponSlot] = currentMag - 1;
      // Auto-reload when mag is now empty
      if (p.inventory.magAmmo[weaponSlot] <= 0) {
        // Queue auto-reload after this shot
        setTimeout(() => this.handleReload(channelId), 0);
      }
    }

    p.lastFireTime = now;

    // Build entity list for hit detection (bots + other players)
    const entities = [];
    for (const bot of this.bots) {
      if (bot.hp > 0) entities.push(bot);
    }
    for (const [pid, op] of this.players) {
      if (pid !== channelId && op.alive && op.hp > 0) entities.push({ id: pid, x: op.x, y: op.y });
    }

    if (weaponDef.type === 'hitscan') {
      // Lag compensation: rewind entities
      const latencyMs = data.latency || 0;
      const rewindTicks = Math.min(Math.round(latencyMs / TICK_MS), MAX_HISTORY);
      let useEntities = entities;

      if (rewindTicks > 0 && this.stateHistory.length > rewindTicks) {
        const snapshot = this.stateHistory[this.stateHistory.length - 1 - rewindTicks];
        if (snapshot) {
          useEntities = entities.map(e => {
            const hist = snapshot.entities.get(e.id);
            return hist ? { id: e.id, x: hist.x, y: hist.y, hp: e.hp } : e;
          });
        }
      }

      const results = fireHitscan(
        { id: channelId, x: p.x, y: p.y },
        data.angle,
        weaponDef,
        this.mapGrid,
        useEntities
      );

      // Process each pellet result independently
      for (const result of results) {
        if (result && result.hit && result.target) {
          const targetId = result.target.id;
          const isHeadshot = Math.random() < 0.15; // 15% headshot chance
          let dmg = weaponDef.damage;
          if (isHeadshot && weaponDef.headshotMult) {
            dmg = Math.round(dmg * weaponDef.headshotMult);
          }
          // Apply damage to actual entity (each pellet damages independently)
          const bot = this.bots.find(b => b.id === targetId);
          if (bot) {
            const finalDmg = this._applyDamage(bot, dmg, isHeadshot);
            const dead = bot.takeDamage(finalDmg, this.tick);
            this.events.push({ type: 'hit', targetType: 'bot', targetId, damage: finalDmg, dead, x: bot.x, y: bot.y, headshot: isHeadshot });
            if (dead) {
              this._onBotDeath(bot, channelId);
              this.killCounts.set(channelId, (this.killCounts.get(channelId) || 0) + 1);
            }
          }
          const targetPlayer = this.players.get(targetId);
          if (targetPlayer && !this._isProtected(targetPlayer)) {
            const finalDmg = this._applyDamage(targetPlayer, dmg, isHeadshot);
            targetPlayer.hp -= finalDmg;
            if (targetPlayer.hp <= 0) {
              targetPlayer.hp = 0;
              targetPlayer.alive = false;
              this.events.push({ type: 'kill', killerId: channelId, targetId });
              this.killCounts.set(channelId, (this.killCounts.get(channelId) || 0) + 1);
            }
            this.events.push({ type: 'hit', targetType: 'player', targetId, damage: finalDmg, x: targetPlayer.x, y: targetPlayer.y, headshot: isHeadshot });
          }
        }
        if (result && result.wallHit) {
          this.events.push({ type: 'wallhit', x: result.wallHit.x, y: result.wallHit.y, shooterId: channelId });
        }
      }
      // Broadcast a single fire event for tracer rendering (not per pellet)
      this.events.push({ type: 'fire', shooterId: channelId, angle: data.angle, weapon: itemDef.id });
    } else if (weaponDef.type === 'projectile') {
      const proj = fireProjectile(channelId, p.x, p.y, data.angle, weaponDef);
      this.projectiles.push(proj);
      this.events.push({ type: 'projectile', id: proj.id, x: p.x, y: p.y, angle: data.angle });
      // Consume tactical item after throwing
      if (weaponSlot === 'tactical') {
        p.inventory.tactical.splice(0, 1);
      }
    }
  }

  handlePickup(channelId, data) {
    const p = this.players.get(channelId);
    if (!p || !p.alive) return;

    const lootItem = this.loot.find(l => l.id === data.lootId && !l.pickedUp);
    if (!lootItem) return;

    const dx = p.x - lootItem.x;
    const dy = p.y - lootItem.y;
    if (Math.sqrt(dx * dx + dy * dy) > PICKUP_RANGE) return;

    const itemDef = pickupLoot(this.loot, data.lootId);
    if (!itemDef) return;

    const result = addToInventory(p.inventory, itemDef);
    if (result.success) {
      this.events.push({ type: 'pickup', playerId: channelId, lootId: data.lootId, itemId: itemDef.id });
    }
  }

  handleUseItem(channelId, data) {
    const p = this.players.get(channelId);
    if (!p || !p.alive) return;

    if (data.slot === 'consumable' && data.index >= 0 && data.index < p.inventory.consumables.length) {
      const item = p.inventory.consumables[data.index];
      if (item.heals) {
        p.hp = Math.min(p.maxHp, p.hp + item.heals);
      }
      if (item.healAmount) {
        const cap = item.healCap || p.maxHp;
        p.hp = Math.min(cap, p.hp + item.healAmount);
      }
      if (item.boostAmount) {
        p.boost = Math.min(100, p.boost + item.boostAmount);
      }
      if (item.effect === 'speed_boost') {
        p.speed = PLAYER_SPEED * 1.5;
        setTimeout(() => { if (p) p.speed = PLAYER_SPEED; }, 10000);
      }
      p.inventory.consumables.splice(data.index, 1);
      this.events.push({ type: 'use_item', playerId: channelId, itemId: item.id });
    }
  }

  handleReload(channelId) {
    const p = this.players.get(channelId);
    if (!p || !p.alive || p.reloading) return;

    const slotName = activeSlotForPlayer(p);
    const itemDef = p.inventory[slotName];
    if (!itemDef) return;
    const weaponDef = WEAPON_DEFS[itemDef.id];
    if (!weaponDef || !weaponDef.magSize) return;

    const currentMag = p.inventory.magAmmo[slotName] || 0;
    if (currentMag >= weaponDef.magSize) return; // already full

    const ammoType = weaponDef.ammoType;
    const reserve = p.inventory.ammo[ammoType] || 0;
    if (reserve <= 0) return; // no ammo

    p.reloading = true;
    const reloadTicks = Math.ceil((weaponDef.reloadTime / 1000) * TICK_RATE);
    p.reloadEndTick = this.tick + reloadTicks;
  }

  _completeReload(p) {
    const slotName = activeSlotForPlayer(p);
    const itemDef = p.inventory[slotName];
    if (!itemDef) { p.reloading = false; return; }
    const weaponDef = WEAPON_DEFS[itemDef.id];
    if (!weaponDef || !weaponDef.magSize) { p.reloading = false; return; }

    const currentMag = p.inventory.magAmmo[slotName] || 0;
    const needed = weaponDef.magSize - currentMag;
    const ammoType = weaponDef.ammoType;
    const reserve = p.inventory.ammo[ammoType] || 0;
    const load = Math.min(needed, reserve);

    p.inventory.magAmmo[slotName] = currentMag + load;
    p.inventory.ammo[ammoType] = reserve - load;
    p.reloading = false;
  }

  _applyDamage(target, rawDamage, isHeadshot) {
    let damage = rawDamage;
    // Check vest for body shots
    if (!isHeadshot && target.inventory && target.inventory.vest) {
      const vest = target.inventory.vest;
      const reduced = Math.floor(damage * vest.damageReduction);
      damage -= reduced;
      vest.durability -= reduced;
      if (vest.durability <= 0) {
        target.inventory.vest = null;
      }
    }
    // Check helmet for headshots
    if (isHeadshot && target.inventory && target.inventory.helmet) {
      const helmet = target.inventory.helmet;
      const reduced = Math.floor(damage * helmet.damageReduction);
      damage -= reduced;
      helmet.durability -= reduced;
      if (helmet.durability <= 0) {
        target.inventory.helmet = null;
      }
    }
    return Math.max(1, damage);
  }

  _isProtected(p) {
    return p.spawnProtection && p.spawnProtection > 0;
  }

  _isWalkableForChar(x, y) {
    const CHAR_RADIUS = 8;
    for (const [ox, oy] of [[-CHAR_RADIUS, -CHAR_RADIUS], [CHAR_RADIUS, -CHAR_RADIUS], [-CHAR_RADIUS, CHAR_RADIUS], [CHAR_RADIUS, CHAR_RADIUS]]) {
      const tx = Math.floor((x + ox) / TILE_PX);
      const ty = Math.floor((y + oy) / TILE_PX);
      if (!this.isWalkableFn(tx, ty)) return false;
    }
    return true;
  }

  _processPlayerInputs(dt) {
    for (const [pid, p] of this.players) {
      if (!p.alive) continue;
      if (p.intent && performance.now()-p.lastInputAt<=200) {
        const input = p.intent;
        let vx = 0, vy = 0;
        if (input.keys) {
          if (input.keys.a) vx -= 1;
          if (input.keys.d) vx += 1;
          if (input.keys.w) vy -= 1;
          if (input.keys.s) vy += 1;
        }
        if (vx !== 0 && vy !== 0) {
          vx *= 0.7071;
          vy *= 0.7071;
        }

        // Sprint / crouch from input
        p.sprinting = !!(input.keys && input.keys.shift) && (vx !== 0 || vy !== 0);
        p.crouching = !!(input.keys && input.keys.ctrl) && !p.sprinting;

        let effectiveSpeed = p.speed;
        if (p.sprinting) effectiveSpeed *= 1.5;
        if (p.crouching) effectiveSpeed *= 0.5;

        const moveX = vx * effectiveSpeed * dt;
        const moveY = vy * effectiveSpeed * dt;

        // Bounding box collision with axis sliding and corner nudge
        if (this._isWalkableForChar(p.x + moveX, p.y + moveY)) {
          p.x += moveX;
          p.y += moveY;
        } else {
          let moved = false;
          if (moveX !== 0 && this._isWalkableForChar(p.x + moveX, p.y)) {
            p.x += moveX; moved = true;
          }
          if (moveY !== 0 && this._isWalkableForChar(p.x, p.y + moveY)) {
            p.y += moveY; moved = true;
          }
          if (!moved) {
            // Corner nudge: push toward tile center to slide around corners
            const nudge = 2;
            if (moveX !== 0) {
              const alignY = Math.round(p.y / TILE_PX) * TILE_PX + TILE_PX / 2;
              const diffY = alignY - p.y;
              if (Math.abs(diffY) > 2) {
                const ny = diffY > 0 ? nudge : -nudge;
                if (this._isWalkableForChar(p.x, p.y + ny)) p.y += ny;
              }
            }
            if (moveY !== 0) {
              const alignX = Math.round(p.x / TILE_PX) * TILE_PX + TILE_PX / 2;
              const diffX = alignX - p.x;
              if (Math.abs(diffX) > 2) {
                const nx = diffX > 0 ? nudge : -nudge;
                if (this._isWalkableForChar(p.x + nx, p.y)) p.x += nx;
              }
            }
          }
        }

        p.angle = input.angle || 0;
        p.lastSeq = input.seq || 0;
      }
    }
  }

  _processBotActions(actions, bot) {
    for (const action of actions) {
      switch (action.type) {
        case 'bot_fire': {
          const weaponDef = WEAPON_DEFS[action.weaponId];
          if (!weaponDef) break;

          // Build entity list (players + other bots)
          const entities = [];
          for (const otherBot of this.bots) {
            if (otherBot.id !== bot.id && otherBot.hp > 0) entities.push(otherBot);
          }
          for (const [, p] of this.players) {
            if (p.alive && p.hp > 0) entities.push({ id: p.id, x: p.x, y: p.y });
          }

          if (weaponDef.type === 'hitscan') {
            const results = fireHitscan(
              { id: bot.id, x: bot.x, y: bot.y },
              action.angle,
              weaponDef,
              this.mapGrid,
              entities
            );
            for (const result of results) {
              if (result && result.hit && result.target) {
                const targetId = result.target.id;
                const targetBot = this.bots.find(b => b.id === targetId);
                if (targetBot) {
                  const dead = targetBot.takeDamage(weaponDef.damage, this.tick);
                  this.events.push({ type: 'hit', targetType: 'bot', targetId, damage: weaponDef.damage, dead, x: targetBot.x, y: targetBot.y });
                  if (dead) this._onBotDeath(targetBot, bot.id);
                }
                const targetPlayer = this.players.get(targetId);
                if (targetPlayer && !this._isProtected(targetPlayer)) {
                  targetPlayer.hp -= weaponDef.damage;
                  this.events.push({ type: 'hit', targetType: 'player', targetId, damage: weaponDef.damage, x: targetPlayer.x, y: targetPlayer.y });
                  if (targetPlayer.hp <= 0) {
                    targetPlayer.hp = 0;
                    targetPlayer.alive = false;
                    this.events.push({ type: 'kill', killerId: 'bot_' + bot.id, targetId });
                  }
                }
              }
              if (result && result.wallHit) {
                this.events.push({ type: 'wallhit', x: result.wallHit.x, y: result.wallHit.y, shooterId: bot.id });
              }
            }
            this.events.push({ type: 'fire', shooterId: bot.id, angle: action.angle, weapon: action.weaponId });
          }
          break;
        }

        case 'bot_melee': {
          // Direct melee damage to target
          const targetBot = this.bots.find(b => b.id === action.targetId);
          if (targetBot && targetBot.hp > 0) {
            const dead = targetBot.takeDamage(action.damage, this.tick);
            this.events.push({ type: 'hit', targetType: 'bot', targetId: action.targetId, damage: action.damage, dead, x: targetBot.x, y: targetBot.y });
            if (dead) this._onBotDeath(targetBot, bot.id);
          }
          const targetPlayer = this.players.get(action.targetId);
          if (targetPlayer && targetPlayer.alive && !this._isProtected(targetPlayer)) {
            targetPlayer.hp -= action.damage;
            if (targetPlayer.hp <= 0) {
              targetPlayer.hp = 0;
              targetPlayer.alive = false;
              this.events.push({ type: 'kill', killerId: 'bot_' + bot.id, targetId: action.targetId });
            }
          }
          break;
        }

        case 'bot_pickup': {
          const lootItem = this.loot.find(l => l.id === action.lootId && !l.pickedUp);
          if (!lootItem) break;
          const dx = bot.x - lootItem.x, dy = bot.y - lootItem.y;
          if (Math.sqrt(dx * dx + dy * dy) > PICKUP_RANGE) break;
          const itemDef = pickupLoot(this.loot, action.lootId);
          if (itemDef) {
            addToInventory(bot.inventory, itemDef);
            bot._pickBestWeapon();
            this.events.push({ type: 'pickup', playerId: 'bot_' + bot.id, lootId: action.lootId, itemId: itemDef.id });
          }
          break;
        }

        case 'bot_heal': {
          if (bot.inventory.consumables.length > 0) {
            const item = bot.inventory.consumables[0];
            if (item.heals) {
              bot.hp = Math.min(bot.maxHp, bot.hp + item.heals);
            }
            bot.inventory.consumables.splice(0, 1);
          }
          break;
        }
      }
    }
  }

  _onBotDeath(deadBot, killerId) {
    // Drop bot's inventory as loot
    const items = [];
    if (deadBot.inventory.primary) items.push(deadBot.inventory.primary);
    if (deadBot.inventory.secondary) items.push(deadBot.inventory.secondary);
    items.push(...deadBot.inventory.tactical);
    items.push(...deadBot.inventory.consumables);

    for (const item of items) {
      const lootId = 'drop_' + deadBot.id + '_' + Math.random().toString(36).slice(2, 8);
      this.loot.push({
        id: lootId,
        itemId: item.id,
        x: deadBot.x + (Math.random() - 0.5) * 20,
        y: deadBot.y + (Math.random() - 0.5) * 20,
        pickedUp: false,
      });
    }

    // Track kill
    const key = typeof killerId === 'number' ? 'bot_' + killerId : killerId;
    this.killCounts.set(key, (this.killCounts.get(key) || 0) + 1);
  }

  _saveSnapshot() {
    const entities = new Map();
    for (const bot of this.bots) {
      entities.set(bot.id, { x: bot.x, y: bot.y });
    }
    for (const [pid, p] of this.players) {
      entities.set(pid, { x: p.x, y: p.y });
    }
    this.stateHistory.push({ tick: this.tick, entities });
    if (this.stateHistory.length > MAX_HISTORY) {
      this.stateHistory.shift();
    }
  }

  _serializePlayer(p) {
    return {
      id: p.id, x: p.x, y: p.y, angle: p.angle, hp: p.hp,
      alive: p.alive, lastSeq: p.lastSeq,
      reloading: p.reloading,
      reloadEndTick: p.reloadEndTick,
      sprinting: p.sprinting,
      crouching: p.crouching,
      boost: p.boost,
      vestLevel: p.inventory.vest ? p.inventory.vest.level : 0,
      helmetLevel: p.inventory.helmet ? p.inventory.helmet.level : 0,
      inventory: {
        primary: p.inventory.primary?.id || null,
        secondary: p.inventory.secondary?.id || null,
        tactical: p.inventory.tactical.map(i => i.id),
        consumables: p.inventory.consumables.map(i => i.id),
        ammo: p.inventory.ammo,
        magAmmo: p.inventory.magAmmo,
      }
    };
  }

  _broadcast() {
    const playerStates = [];
    for (const [, p] of this.players) {
      playerStates.push(this._serializePlayer(p));
    }

    // Only send alive bots, compact format
    const botStates = [];
    for (const bot of this.bots) {
      if (bot.hp > 0) {
        botStates.push(bot.serialize());
      }
    }

    const projStates = this.projectiles
      .filter(p => p.alive)
      .map(p => ({ id: p.id, x: p.x, y: p.y }));

    // Build leaderboard (top 10 by kills)
    const leaderboard = Array.from(this.killCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, kills]) => ({ id, kills }));

    const payload = {
      tick: this.tick,
      players: playerStates,
      bots: botStates,
      projectiles: projStates,
      zone: this.zone.serialize(),
      events: [],
      worldRevision:this.worldRevision,
      leaderboard,
    };

    // Cosmetic/action notifications are reliable for currently connected viewers; paused viewers get a current bootstrap.
    for(const channel of this.io.channels.values())if(channel.connected && this.events.length)channel.emit('game-events',{worldRevision:this.worldRevision,events:this.events});
    this.io.emit('state', payload);
    this.events = [];
  }

  update() {
    const dt = 1 / TICK_RATE;
    this.tick++;

    // Decrement spawn protection
    for (const [, p] of this.players) {
      if (p.spawnProtection > 0) p.spawnProtection--;
    }

    // Check reload completion
    for (const [, p] of this.players) {
      if (p.reloading && this.tick >= p.reloadEndTick) {
        this._completeReload(p);
      }
    }

    // Boost system: heal + decay
    for (const [, p] of this.players) {
      if (!p.alive) continue;
      if (p.boost > 0) {
        // Heal based on boost level (per tick)
        let healRate = 0;
        if (p.boost > 80) healRate = 4;       // ~4 hp/s at high boost
        else if (p.boost > 60) healRate = 3;
        else if (p.boost > 30) healRate = 2;
        else healRate = 1;
        p.hp = Math.min(p.maxHp, p.hp + healRate * dt);
        // Decay boost ~1/second
        p.boost = Math.max(0, p.boost - dt);
      }
    }

    // Process player inputs
    this._processPlayerInputs(dt);

    // Update bots with gameState + pathfinder
    const gameState = {
      players: this.players,
      bots: this.bots,
      loot: this.loot,
      zone: this.zone,
      isWalkableFn: this.isWalkableFn,
      mapGrid: this.mapGrid,
    };
    for (const bot of this.bots) {
      if (bot.hp > 0) {
        const actions = bot.update(dt, gameState, this.pathfinder, this.tick);
        if (actions) this._processBotActions(actions, bot);
      }
    }

    // Check player death from bot attacks
    for (const [, p] of this.players) {
      if (p.alive && p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        this.events.push({ type: 'death', playerId: p.id, cause: 'bot' });
      }
    }

    // Update projectiles
    const allEntities = [];
    for (const bot of this.bots) {
      if (bot.hp > 0) allEntities.push(bot);
    }
    for (const [, p] of this.players) {
      if (p.alive) allEntities.push({ id: p.id, x: p.x, y: p.y, hp: p.hp, takeDamage: (d) => { p.hp -= d; } });
    }

    const explosions = updateProjectiles(this.projectiles, dt, this.mapGrid, allEntities);
    for (const exp of explosions) {
      this.events.push({ type: 'explosion', x: exp.x, y: exp.y, radius: exp.radius });
      for (const hit of exp.hits) {
        const bot = this.bots.find(b => b.id === hit.entityId);
        if (bot) bot.takeDamage(hit.damage, this.tick);
        const player = this.players.get(hit.entityId);
        if (player) {
          player.hp -= hit.damage;
          if (player.hp <= 0) { player.hp = 0; player.alive = false; }
        }
      }
    }
    // Clean dead projectiles
    this.projectiles = this.projectiles.filter(p => p.alive);

    // Update zone
    this.zone.update(dt);
    const zoneDmg = this.zone.getDamage();
    if (zoneDmg > 0) {
      for (const [, p] of this.players) {
        if (p.alive && !this.zone.isInZone(p.x, p.y)) {
          p.hp -= zoneDmg * dt;
          if (p.hp <= 0) { p.hp = 0; p.alive = false; }
        }
      }
      for (const bot of this.bots) {
        if (bot.hp > 0 && !this.zone.isInZone(bot.x, bot.y)) {
          bot.takeDamage(zoneDmg * dt, this.tick);
        }
      }
    }

    // Arena mode: restart when a bot dies
    if (this.mode === 'arena') {
      const aliveBots = this.bots.filter(b => b.hp > 0);
      if (aliveBots.length <= 1 && !this._restartCountdown) {
        const winner = aliveBots[0];
        this._restartCountdown = this.tick + TICK_RATE * 3; // 3 seconds
        this.events.push({
          type: 'round_end',
          winner: winner ? `Bot ${winner.id}` : 'Draw',
          winnerHp: winner ? winner.hp : 0,
          seconds: 3,
        });
      }
      if (this._restartCountdown && this.tick >= this._restartCountdown) {
        this._restartCountdown = null;
        this._resetGame();
      }
    }

    // Auto-restart: when all human players are dead, countdown then reset
    if (this.players.size > 0) {
      const anyAlive = [...this.players.values()].some(p => p.alive);
      if (!anyAlive) {
        if (!this._restartCountdown) {
          this._restartCountdown = this.tick + TICK_RATE * 5; // 5 seconds
          this.events.push({ type: 'restart_countdown', seconds: 5 });
        }
        if (this.tick >= this._restartCountdown) {
          this._restartCountdown = null;
          this._resetGame();
        }
      } else {
        this._restartCountdown = null;
      }
    }

    // Save snapshot for lag comp
    this._saveSnapshot();

    // Broadcast at reduced rate
    if (this.tick % BROADCAST_EVERY === 0) {
      this._broadcast();
    }
  }

  _resetGame() {
    this.worldRevision=randomUUID();
    console.log('Auto-restart: regenerating...');
    const sz = this.mapSizeActual;

    // Regenerate map (same mode)
    if (this.mode === 'arena') {
      const result = generateArenaMap();
      this.flatGrid = result.grid;
      this.walkable = result.walkable;
      this.wallVariants = result.wallVariants;
      this.mapSizeActual = result.mapSize;
    } else {
      const { grid: flatGrid, walkable, wallVariants } = generateMap();
      this.flatGrid = flatGrid;
      this.walkable = walkable;
      this.wallVariants = wallVariants;
    }

    const newSz = this.mapSizeActual;
    this.mapGrid = [];
    for (let r = 0; r < newSz; r++) {
      this.mapGrid[r] = new Array(newSz);
      for (let c = 0; c < newSz; c++) {
        this.mapGrid[r][c] = this.flatGrid[r * newSz + c];
      }
    }

    // Reset bots
    this.bots = [];
    if (this.mode === 'arena') {
      this._spawnArenaBots();
    } else {
      this._spawnBots();
    }

    // Reset loot
    if (this.mode === 'arena') {
      this.loot = this._spawnArenaLoot();
    } else {
      this.loot = spawnLoot(this.mapGrid, newSz);
    }

    // Reset zone
    this.zone = new ZoneManager(newSz, TILE_PX);

    // Reset pathfinder
    this.pathfinder = createPathfinder(this.mapGrid, newSz);

    // Reset projectiles and state
    this.projectiles = [];
    this.stateHistory = [];
    this.events = [];
    this.killCounts = new Map();

    // Respawn/re-init all connected sockets
    for (const [, socket] of this.io.channels) {
      if (this.mode === 'arena') {
        // Re-send spectator init
        const sz = this.mapSizeActual;
        const spectatorState = {
          id: socket.id, x: sz * TILE_PX / 2, y: sz * TILE_PX / 2,
          angle: 0, hp: 100, alive: true, lastSeq: 0,
          reloading: false, sprinting: false, crouching: false, boost: 0,
          vestLevel: 0, helmetLevel: 0,
          inventory: { primary: null, secondary: null, tactical: [], consumables: [], ammo: {}, magAmmo: {} },
        };
        this._sendInit(socket,spectatorState);
      } else {
        const p = this.players.get(socket.id);
        if (p) {
          const pos = this.getSpawnPos();
          p.x = pos.x; p.y = pos.y;
          p.hp = p.maxHp; p.alive = true;
          p.spawnProtection = 180;
          p.inputs = []; p.intent=null;
          p.reloading = false;
          p.boost = 0;
          p.inventory = createInventory();
          addToInventory(p.inventory, ITEM_DEFS.pistol);
          p.inventory.ammo['9mm'] = 60;
          p.inventory.magAmmo.primary = WEAPON_DEFS.pistol.magSize;
        }
        this._sendInit(socket,this._serializePlayer(this.players.get(socket.id)));
      }
    }
  }

  start() {
    console.log(`Game loop starting at ${TICK_RATE} ticks/s (mode: ${this.mode})`);
    console.log(`Map: ${this.mapSizeActual}x${this.mapSizeActual}, Walkable tiles: ${this.walkable.length}, Bots: ${this.bots.length}, Loot: ${this.loot.length}`);
    this._interval = setInterval(() => this.update(), TICK_MS);
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
  }
}
