// Bot.js — PUBG-style strategic AI with state machine, pathfinding, and inventory

import { createInventory, addToInventory, ITEM_DEFS } from './LootManager.js';
import { WEAPON_DEFS } from './WeaponSystem.js';

const TILE_PX = 48;

let nextBotId = 0;

// Weapon tier ranking for _pickBestWeapon
const WEAPON_TIER = { pistol: 1, smg: 2, shotgun: 3, sniper: 4 };

// Optimal engagement ranges per weapon type [min, max]
const ENGAGE_RANGE = {
  pistol:  [200, 350],
  smg:     [150, 300],
  shotgun: [60,  150],
  sniper:  [400, 800],
};

class Bot {
  constructor(x, y) {
    this.id = nextBotId++;
    this.x = x;
    this.y = y;
    this.hp = 100;
    this.maxHp = 100;
    this.state = 'PATROL';
    this.speed = 60;
    this.baseSpeed = 60;
    this.aggroRange = 250;
    this.angle = 0;

    // Inventory
    this.inventory = createInventory();
    this.activeWeapon = null; // WEAPON_DEFS entry or null (fists)
    this.lastFireTime = 0;

    // Pathfinding
    this.path = [];           // [{x,y}] pixel waypoints
    this.pathAge = 0;         // ticks since path calculated
    this.pathGoal = null;     // {x,y} what path was calculated toward

    // Perception (updated staggered, every 10 ticks)
    this.visibleEnemies = []; // [{id, x, y, hp, dist}]
    this.visibleLoot = [];    // [{id, x, y, itemId, dist}]
    this.targetId = null;     // current combat target

    // Timers
    this.healTimer = 0;       // cooldown for healing
    this.idleTimer = 0;
    this.idleWait = 0;
    this.strafeDir = 1;       // 1 or -1, changes periodically during FIGHT
    this.strafeTimer = 0;
    this.lastDamageTick = 0;  // last tick damage was taken

    // Cover-seeking
    this.coverPos = null;
    this.coverAge = 0;

    // Burst fire
    this.burstCount = 0;      // shots fired in current burst
    this.burstPause = 0;      // cooldown between bursts

    // Target tracking
    this.losLostTicks = 0;    // ticks since target went behind cover
  }

  // ---------------------------------------------------------------------------
  // Main update — returns array of action objects for GameServer
  // ---------------------------------------------------------------------------

  update(dt, gameState, pathfinder, tickCount) {
    const actions = [];

    // Increment path age
    this.pathAge++;

    // Staggered perception: every 10 ticks, offset by bot id
    if (tickCount % 10 === this.id % 10) {
      this._updatePerception(gameState, pathfinder);
    }

    // Reset speed each tick (FLEE may override)
    this.speed = this.baseSpeed;

    // Decision priority
    const nextState = this._evaluate(gameState, tickCount);
    if (nextState !== this.state) {
      this._onStateChange(nextState);
    }
    this.state = nextState;

    // Execute current state behavior
    switch (this.state) {
      case 'IDLE':
        this._updateIdle(dt);
        break;
      case 'PATROL':
        this._updatePatrol(dt, gameState, pathfinder);
        break;
      case 'LOOT':
        this._updateLoot(dt, gameState, pathfinder, actions);
        break;
      case 'FIGHT':
        this._updateFight(dt, gameState, pathfinder, actions, tickCount);
        break;
      case 'FLEE':
        this._updateFlee(dt, gameState, pathfinder);
        break;
      case 'HEAL':
        this._updateHeal(dt, actions, tickCount);
        break;
      case 'REPOSITION':
        this._updateReposition(dt, gameState, pathfinder);
        break;
    }

    return actions;
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------

  _updatePerception(gameState, pathfinder) {
    const { players, bots } = gameState;

    // Scan enemies: prioritize PLAYERS, only target bots in specific situations
    const enemies = [];

    // Always scan for players
    for (const [, p] of players) {
      if (!p.alive || p.hp <= 0) continue;
      const dist = this._dist(p.x, p.y);
      if (dist > this.aggroRange) continue;
      if (!this._checkLOS(p.x, p.y, pathfinder)) continue;
      enemies.push({ id: p.id, x: p.x, y: p.y, hp: p.hp, dist, isPlayer: true });
    }

    // Only scan other bots if: we were already fighting one (retaliation),
    // or for third-party opportunities (bot is low HP and fighting someone else)
    for (const bot of bots) {
      if (bot === this || bot.hp <= 0) continue;
      const dist = this._dist(bot.x, bot.y);
      if (dist > this.aggroRange) continue;
      // Retaliate: if this bot was recently damaged AND the other bot is close
      const isRetaliating = this.targetId === bot.id;
      // Third-party: other bot is low HP (already in a fight)
      const isVulnerable = bot.hp < 40 && bot.state === 'FIGHT';
      if (!isRetaliating && !isVulnerable) continue;
      if (!this._checkLOS(bot.x, bot.y, pathfinder)) continue;
      enemies.push({ id: bot.id, x: bot.x, y: bot.y, hp: bot.hp, dist, isPlayer: false });
    }

    // Sort: players first, then by distance
    enemies.sort((a, b) => {
      if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
      return a.dist - b.dist;
    });
    this.visibleEnemies = enemies;

    // Scan loot within 200px that isn't picked up
    const loot = [];
    for (const item of gameState.loot) {
      if (item.pickedUp) continue;
      const dist = this._dist(item.x, item.y);
      if (dist > 200) continue;
      loot.push({ id: item.id, x: item.x, y: item.y, itemId: item.itemId, dist });
    }
    loot.sort((a, b) => a.dist - b.dist);
    this.visibleLoot = loot;
  }

  _checkLOS(tx, ty, pathfinder) {
    const sx = Math.floor(this.x / TILE_PX);
    const sy = Math.floor(this.y / TILE_PX);
    const ex = Math.floor(tx / TILE_PX);
    const ey = Math.floor(ty / TILE_PX);
    return pathfinder.hasLineOfSight(sx, sy, ex, ey);
  }

  // ---------------------------------------------------------------------------
  // Decision evaluation
  // ---------------------------------------------------------------------------

  _evaluate(gameState, tickCount) {
    const { zone } = gameState;

    // 1. Outside zone? Reposition
    if (zone && typeof zone.isInZone === 'function' && !zone.isInZone(this.x, this.y)) {
      return 'REPOSITION';
    }

    // 2. Low HP and enemies visible? Flee (raised from 30% to 40%)
    if (this.hp < 40 && this.visibleEnemies.length > 0) {
      return 'FLEE';
    }

    // 2.5. Healing interrupt: if currently healing but unsafe, flee
    if (this.state === 'HEAL' && !this._isSafe(tickCount)) {
      return 'FLEE';
    }

    // 3. Moderate HP, have consumables, and safe? Heal
    if (this.hp < 70 && this._hasConsumables() && this._isSafe(tickCount)) {
      return 'HEAL';
    }

    // 3.5. Early game loot priority: first 2 minutes without weapon, prioritize LOOT
    if (tickCount < 7200 && this.activeWeapon === null &&
        this.visibleLoot.length > 0 && this._wantsLoot()) {
      return 'LOOT';
    }

    // 4. See ongoing fight nearby (two entities within 300px, both <80% HP)? Target weaker
    if (this.visibleEnemies.length >= 2) {
      const nearby = this.visibleEnemies.filter(e => e.dist < 300);
      for (let i = 0; i < nearby.length; i++) {
        for (let j = i + 1; j < nearby.length; j++) {
          const a = nearby[i];
          const b = nearby[j];
          const abDist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
          if (abDist < 300 && a.hp < 80 && b.hp < 80) {
            // Target the weaker one
            this.targetId = a.hp <= b.hp ? a.id : b.id;
            return 'FIGHT';
          }
        }
      }
    }

    // 5. Enemy visible and have weapon? Fight
    if (this.visibleEnemies.length > 0 && this.activeWeapon !== null) {
      this.targetId = this.visibleEnemies[0].id;
      return 'FIGHT';
    }

    // 6. Loot nearby and want it?
    if (this.visibleLoot.length > 0 && this._wantsLoot()) {
      return 'LOOT';
    }

    // 7. Default: patrol or idle
    if (this.state === 'IDLE') return 'IDLE';
    if (this.state === 'PATROL') return 'PATROL';
    return 'PATROL';
  }

  _onStateChange(newState) {
    // Clear path when switching states so we recalculate
    this.path = [];
    this.pathGoal = null;
    this.pathAge = 0;

    if (newState === 'IDLE') {
      this.idleWait = 2 + Math.random();
      this.idleTimer = 0;
    }
    if (newState === 'HEAL') {
      this.healTimer = 1.5;
    }
  }

  // ---------------------------------------------------------------------------
  // State behaviors
  // ---------------------------------------------------------------------------

  _updateIdle(dt) {
    this.idleTimer += dt;
    if (this.idleTimer >= this.idleWait) {
      this.state = 'PATROL';
      this._onStateChange('PATROL');
    }
  }

  _updatePatrol(dt, gameState, pathfinder) {
    if (this.path.length === 0) {
      // 50% chance to path toward nearest visible loot instead of random tile
      if (this.visibleLoot.length > 0 && Math.random() < 0.5) {
        const lootTarget = this.visibleLoot[0];
        const result = pathfinder.findPathPx(this.x, this.y, lootTarget.x, lootTarget.y, TILE_PX);
        if (result && result.length > 1) {
          this.path = result;
          this.pathAge = 0;
          this.pathGoal = { x: lootTarget.x, y: lootTarget.y };
        }
      }

      // If no loot path, pick random walkable tile 5-10 tiles away
      if (this.path.length === 0) {
        const range = 5 + Math.floor(Math.random() * 6); // 5-10
        const { zone } = gameState;

        // Get zone info for bias and boundary checks
        let zoneCX = null;
        let zoneCY = null;
        let zoneCheck = null;
        if (zone) {
          const zoneData = typeof zone.serialize === 'function' ? zone.serialize() : zone;
          zoneCX = zoneData.cx || zoneData.x || null;
          zoneCY = zoneData.cy || zoneData.y || null;
          if (typeof zone.isInZone === 'function') {
            zoneCheck = (x, y) => zone.isInZone(x, y);
          }
        }

        for (let attempt = 0; attempt < 10; attempt++) {
          let angle = Math.random() * Math.PI * 2;

          // Bias patrol toward zone center slightly if known
          if (zoneCX !== null && zoneCY !== null) {
            const toCenterAngle = Math.atan2(zoneCY - this.y, zoneCX - this.x);
            // 30% bias toward center
            angle = angle * 0.7 + toCenterAngle * 0.3;
          }

          const dist = range * TILE_PX;
          const goalX = this.x + Math.cos(angle) * dist;
          const goalY = this.y + Math.sin(angle) * dist;

          // Don't patrol outside the zone
          if (zoneCheck && !zoneCheck(goalX, goalY)) continue;

          const result = pathfinder.findPathPx(this.x, this.y, goalX, goalY, TILE_PX);
          if (result && result.length > 1) {
            this.path = result;
            this.pathAge = 0;
            this.pathGoal = { x: goalX, y: goalY };
            break;
          }
        }
      }

      if (this.path.length === 0) {
        // Failed to find path, go idle
        this.state = 'IDLE';
        this._onStateChange('IDLE');
        return;
      }
    }

    this._followPath(dt, gameState.isWalkableFn);

    // Reached destination
    if (this.path.length === 0) {
      this.state = 'IDLE';
      this._onStateChange('IDLE');
    }
  }

  _updateLoot(dt, gameState, pathfinder, actions) {
    // Find nearest desirable loot
    const target = this.visibleLoot[0];
    if (!target) {
      this.state = 'PATROL';
      this._onStateChange('PATROL');
      return;
    }

    const dist = this._dist(target.x, target.y);
    if (dist < 40) {
      // Pick it up
      actions.push({ type: 'bot_pickup', botId: this.id, lootId: target.id });
      // Try to add to inventory locally for decision-making
      const itemDef = ITEM_DEFS[target.itemId];
      if (itemDef) {
        addToInventory(this.inventory, itemDef);
        this._pickBestWeapon();
      }
      // Clear loot from visible list
      this.visibleLoot.shift();
      // Clear path to force re-evaluation
      this.path = [];
      this.pathGoal = null;
      return;
    }

    // Path toward loot
    if (this.path.length === 0 || this.pathAge > 60) {
      const result = pathfinder.findPathPx(this.x, this.y, target.x, target.y, TILE_PX);
      if (result && result.length > 1) {
        this.path = result;
        this.pathAge = 0;
        this.pathGoal = { x: target.x, y: target.y };
      }
    }

    this._followPath(dt, gameState.isWalkableFn);
  }

  _updateFight(dt, gameState, pathfinder, actions, tickCount) {
    // Find current target in visible enemies
    let target = this.visibleEnemies.find(e => e.id === this.targetId);
    if (!target) {
      // Target lost — track how long we've lost LOS
      this.losLostTicks++;

      // If can't see target for 30+ ticks, try switching to another visible enemy
      if (this.losLostTicks >= 30 && this.visibleEnemies.length > 0) {
        target = this.visibleEnemies[0];
        this.targetId = target.id;
        this.losLostTicks = 0;
      } else if (this.visibleEnemies.length > 0) {
        target = this.visibleEnemies[0];
        this.targetId = target.id;
      } else {
        if (this.losLostTicks >= 30) {
          this.targetId = null;
          this.losLostTicks = 0;
          this.state = 'PATROL';
          this._onStateChange('PATROL');
          return;
        }
        // Brief LOS loss — hold position
        return;
      }
    } else {
      this.losLostTicks = 0;
    }

    const dist = this._dist(target.x, target.y);

    // Face the target
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);

    // Update cover position periodically (every ~2-3 seconds = 120-180 ticks)
    this.coverAge++;
    if (this.coverPos === null || this.coverAge > 120 + Math.floor(Math.random() * 60)) {
      this.coverPos = this._findCover(target.x, target.y, pathfinder, gameState.isWalkableFn);
      this.coverAge = 0;
    }

    if (this.activeWeapon) {
      // Ranged combat
      const weaponId = this.activeWeapon.id || Object.keys(WEAPON_DEFS).find(
        k => WEAPON_DEFS[k] === this.activeWeapon
      );
      const range = ENGAGE_RANGE[weaponId] || [150, 300];
      const [minRange, maxRange] = range;

      // --- Cover-seeking behavior when low HP ---
      if (this.hp < 60 && this.coverPos) {
        // Alternate between peeking (2s) and hiding (1.5s)
        // Use a simple tick-based cycle: 120 ticks peek, 90 ticks hide = 210 tick cycle
        const cyclePos = tickCount % 210;
        const isPeeking = cyclePos < 120;

        if (!isPeeking) {
          // Hide phase — path to cover position
          if (this.path.length === 0 || this.pathAge > 30) {
            const result = pathfinder.findPathPx(this.x, this.y, this.coverPos.x, this.coverPos.y, TILE_PX);
            if (result && result.length > 1) {
              this.path = result;
              this.pathAge = 0;
              this.pathGoal = { x: this.coverPos.x, y: this.coverPos.y };
            }
          }
          this._followPath(dt, gameState.isWalkableFn);
          // Don't fire while hiding
          return;
        }
        // During peek phase, fall through to normal combat below
      }

      if (dist > maxRange) {
        // Too far — path toward target
        if (this.path.length === 0 || this.pathAge > 30) {
          const result = pathfinder.findPathPx(this.x, this.y, target.x, target.y, TILE_PX);
          if (result && result.length > 1) {
            this.path = result;
            this.pathAge = 0;
            this.pathGoal = { x: target.x, y: target.y };
          }
        }
        this._followPath(dt, gameState.isWalkableFn);
      } else if (dist < minRange && weaponId === 'sniper') {
        // Too close for sniper (< 200px effective) — back away
        const awayAngle = Math.atan2(this.y - target.y, this.x - target.x);
        const retreatDist = 8 * TILE_PX;
        const goalX = this.x + Math.cos(awayAngle) * retreatDist;
        const goalY = this.y + Math.sin(awayAngle) * retreatDist;

        if (this.path.length === 0 || this.pathAge > 30) {
          const result = pathfinder.findPathPx(this.x, this.y, goalX, goalY, TILE_PX);
          if (result && result.length > 1) {
            this.path = result;
            this.pathAge = 0;
            this.pathGoal = { x: goalX, y: goalY };
          }
        }
        this._followPath(dt, gameState.isWalkableFn);
      } else {
        // In good range — strafe, biasing toward cover positions
        this.path = [];
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeDir = -this.strafeDir;
          this.strafeTimer = 0.5 + Math.random() * 0.5;
        }

        let perpAngle = this.angle + (Math.PI / 2) * this.strafeDir;

        // Bias strafe toward cover if available
        if (this.coverPos) {
          const toCoverAngle = Math.atan2(this.coverPos.y - this.y, this.coverPos.x - this.x);
          // Blend: 70% strafe direction, 30% toward cover
          perpAngle = perpAngle * 0.7 + toCoverAngle * 0.3;
        }

        const strafeX = this.x + Math.cos(perpAngle) * this.speed * dt;
        const strafeY = this.y + Math.sin(perpAngle) * this.speed * dt;
        this.moveToward(strafeX, strafeY, dt, gameState.isWalkableFn);
      }

      // Burst fire: fire 2-3 shots, then pause 0.3-0.5s
      const weaponDef = this.activeWeapon;
      const fireRate = weaponDef.fireRate || 500;
      const now = tickCount * (1000 / 60); // approximate ms from ticks

      if (this.burstPause > 0) {
        this.burstPause -= dt;
      } else if (now - this.lastFireTime >= fireRate && dist <= (weaponDef.range || 500)) {
        this.lastFireTime = now;
        this.burstCount++;
        actions.push({
          type: 'bot_fire',
          botId: this.id,
          targetId: this.targetId,
          angle: this.angle,
          weaponId: weaponId,
        });

        // After 2-3 shots, pause for 0.3-0.5s
        const burstSize = 2 + Math.floor(Math.random() * 2); // 2 or 3
        if (this.burstCount >= burstSize) {
          this.burstPause = 0.3 + Math.random() * 0.2;
          this.burstCount = 0;
        }
      }
    } else {
      // No weapon — melee
      const meleeRange = 100;

      if (dist > meleeRange) {
        // Path toward target for melee
        if (this.path.length === 0 || this.pathAge > 30) {
          const result = pathfinder.findPathPx(this.x, this.y, target.x, target.y, TILE_PX);
          if (result && result.length > 1) {
            this.path = result;
            this.pathAge = 0;
            this.pathGoal = { x: target.x, y: target.y };
          }
        }
        this._followPath(dt, gameState.isWalkableFn);
      } else {
        // In melee range — attack on 1s cooldown
        this.path = [];
        const now = tickCount * (1000 / 60);
        if (now - this.lastFireTime >= 1000) {
          this.lastFireTime = now;
          actions.push({
            type: 'bot_melee',
            botId: this.id,
            targetId: this.targetId,
            damage: 8,
          });
        }
      }
    }
  }

  _updateFlee(dt, gameState, pathfinder) {
    this.speed = this.baseSpeed * 1.3;

    if (this.path.length === 0 || this.pathAge > 60) {
      const nearest = this.visibleEnemies[0];
      if (nearest) {
        // First try to find cover between self and enemy
        const cover = this._findCover(nearest.x, nearest.y, pathfinder, gameState.isWalkableFn);
        if (cover) {
          const result = pathfinder.findPathPx(this.x, this.y, cover.x, cover.y, TILE_PX);
          if (result && result.length > 1) {
            this.path = result;
            this.pathAge = 0;
            this.pathGoal = { x: cover.x, y: cover.y };
          }
        }

        // If no cover found (or path failed), fall back to running away 8-10 tiles
        if (this.path.length === 0) {
          const awayAngle = Math.atan2(this.y - nearest.y, this.x - nearest.x);
          const fleeDist = (8 + Math.random() * 2) * TILE_PX;
          const goalX = this.x + Math.cos(awayAngle) * fleeDist;
          const goalY = this.y + Math.sin(awayAngle) * fleeDist;

          const result = pathfinder.findPathPx(this.x, this.y, goalX, goalY, TILE_PX);
          if (result && result.length > 1) {
            this.path = result;
            this.pathAge = 0;
            this.pathGoal = { x: goalX, y: goalY };
          }
        }
      }
    }

    this._followPath(dt, gameState.isWalkableFn);
  }

  _updateHeal(dt, actions, tickCount) {
    // Healing interrupt: if unsafe, cancel heal and re-evaluate
    if (!this._isSafe(tickCount)) {
      this.state = 'PATROL'; // will be re-evaluated next tick (likely to FLEE)
      this._onStateChange('PATROL');
      return;
    }

    // Stand still and count down
    this.healTimer -= dt;
    if (this.healTimer <= 0) {
      actions.push({ type: 'bot_heal', botId: this.id });
      // Consume first consumable locally
      if (this.inventory.consumables.length > 0) {
        const item = this.inventory.consumables[0];
        if (item.heals) {
          this.hp = Math.min(this.maxHp, this.hp + item.heals);
        }
        this.inventory.consumables.splice(0, 1);
      }
      // Re-evaluate next tick
      this.state = 'PATROL';
      this._onStateChange('PATROL');
    }
  }

  _updateReposition(dt, gameState, pathfinder) {
    const { zone } = gameState;
    if (!zone) {
      this.state = 'PATROL';
      this._onStateChange('PATROL');
      return;
    }

    // Check if we're back in zone
    if (typeof zone.isInZone === 'function' && zone.isInZone(this.x, this.y)) {
      this.state = 'PATROL';
      this._onStateChange('PATROL');
      return;
    }

    // Path toward just inside the zone edge (80% of radius from center toward bot)
    const zoneData = typeof zone.serialize === 'function' ? zone.serialize() : zone;
    const centerX = zoneData.cx || zoneData.x || 0;
    const centerY = zoneData.cy || zoneData.y || 0;
    const radius = zoneData.radius || zoneData.r || 0;

    // Target: 80% of radius from center toward our current position
    let goalX = centerX;
    let goalY = centerY;
    if (radius > 0) {
      const toBotAngle = Math.atan2(this.y - centerY, this.x - centerX);
      goalX = centerX + Math.cos(toBotAngle) * radius * 0.8;
      goalY = centerY + Math.sin(toBotAngle) * radius * 0.8;
    }

    if (this.path.length === 0 || this.pathAge > 60) {
      const result = pathfinder.findPathPx(this.x, this.y, goalX, goalY, TILE_PX);
      if (result && result.length > 1) {
        this.path = result;
        this.pathAge = 0;
        this.pathGoal = { x: goalX, y: goalY };
      }
    }

    this._followPath(dt, gameState.isWalkableFn);
  }

  // ---------------------------------------------------------------------------
  // Path following
  // ---------------------------------------------------------------------------

  _followPath(dt, isWalkableFn) {
    // Expire stale paths
    if (this.pathAge > 60) {
      this.path = [];
      this.pathGoal = null;
      return;
    }

    if (this.path.length === 0) return;

    const wp = this.path[0];
    const dx = wp.x - this.x;
    const dy = wp.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 8) {
      this.path.shift();
      if (this.path.length === 0) {
        this.pathGoal = null;
        return;
      }
      // Continue toward next waypoint this frame
      return this._followPath(dt, isWalkableFn);
    }

    this.angle = Math.atan2(dy, dx);
    this.moveToward(wp.x, wp.y, dt, isWalkableFn);
  }

  // ---------------------------------------------------------------------------
  // Movement with axis-sliding collision
  // ---------------------------------------------------------------------------

  _isWalkableForBot(x, y, isWalkableFn) {
    const BOT_RADIUS = 8;
    for (const [ox, oy] of [[-BOT_RADIUS, -BOT_RADIUS], [BOT_RADIUS, -BOT_RADIUS], [-BOT_RADIUS, BOT_RADIUS], [BOT_RADIUS, BOT_RADIUS]]) {
      const tx = Math.floor((x + ox) / TILE_PX);
      const ty = Math.floor((y + oy) / TILE_PX);
      if (!isWalkableFn(tx, ty)) return false;
    }
    return true;
  }

  moveToward(tx, ty, dt, isWalkableFn) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;

    const nx = dx / dist;
    const ny = dy / dist;

    const moveX = nx * this.speed * dt;
    const moveY = ny * this.speed * dt;

    // Bounding box collision with axis sliding
    if (this._isWalkableForBot(this.x + moveX, this.y + moveY, isWalkableFn)) {
      this.x += moveX;
      this.y += moveY;
    } else if (moveX !== 0 && this._isWalkableForBot(this.x + moveX, this.y, isWalkableFn)) {
      this.x += moveX;
    } else if (moveY !== 0 && this._isWalkableForBot(this.x, this.y + moveY, isWalkableFn)) {
      this.y += moveY;
    } else if (moveX !== 0 && this._isWalkableForBot(this.x + moveX * 0.5, this.y, isWalkableFn)) {
      this.x += moveX * 0.5;
    } else if (moveY !== 0 && this._isWalkableForBot(this.x, this.y + moveY * 0.5, isWalkableFn)) {
      this.y += moveY * 0.5;
    }
  }

  // ---------------------------------------------------------------------------
  // Damage
  // ---------------------------------------------------------------------------

  takeDamage(amount, tick) {
    this.hp -= amount;
    this.lastDamageTick = tick || 0;
    if (this.hp <= 0) {
      this.hp = 0;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  serialize() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      state: this.state,
      hp: this.hp,
      angle: this.angle,
      weapon: this.activeWeapon?.id || null,
    };
  }

  // ---------------------------------------------------------------------------
  // Cover-seeking
  // ---------------------------------------------------------------------------

  _findCover(enemyX, enemyY, pathfinder, isWalkableFn) {
    // Scan tiles in a 5-tile radius around the bot
    const botTX = Math.floor(this.x / TILE_PX);
    const botTY = Math.floor(this.y / TILE_PX);
    const enemyTX = Math.floor(enemyX / TILE_PX);
    const enemyTY = Math.floor(enemyY / TILE_PX);

    let bestPos = null;
    let bestDist = Infinity;

    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const tx = botTX + dx;
        const ty = botTY + dy;
        // Must be walkable
        if (!isWalkableFn(tx, ty)) continue;
        // Must NOT have line of sight to enemy (= behind cover)
        if (!pathfinder.hasLineOfSight(tx, ty, enemyTX, enemyTY)) {
          // This tile is behind cover from enemy
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < bestDist && dist > 1) { // not our current tile
            bestDist = dist;
            bestPos = { x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 };
          }
        }
      }
    }
    return bestPos;
  }

  // ---------------------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------------------

  _dist(tx, ty) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _hasConsumables() {
    return this.inventory.consumables.length > 0;
  }

  _isSafe(tick) {
    return tick - this.lastDamageTick > 60;
  }

  _wantsLoot() {
    return (this.inventory.primary === null && this.inventory.secondary === null) ||
           this.inventory.consumables.length < 2;
  }

  _pickBestWeapon() {
    let best = null;
    let bestTier = -1;

    const candidates = [this.inventory.primary, this.inventory.secondary].filter(Boolean);
    for (const item of candidates) {
      const tier = WEAPON_TIER[item.id] || 0;
      if (tier > bestTier) {
        bestTier = tier;
        best = item;
      }
    }

    if (best) {
      // Resolve to WEAPON_DEFS entry so we have fireRate, range, etc.
      const def = WEAPON_DEFS[best.id];
      if (def) {
        // Attach the id for easy reference
        this.activeWeapon = { ...def, id: best.id };
      } else {
        this.activeWeapon = null;
      }
    } else {
      this.activeWeapon = null;
    }
  }
}

export { Bot };
