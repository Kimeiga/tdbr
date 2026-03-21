// ZoneManager.js — Battle royale shrinking zone

const PHASES = [
  // { radiusPct: target radius as fraction of initial, waitTime (s), shrinkTime (s), damage }
  { radiusPct: 1.0,  waitTime: 60, shrinkTime: 30, damage: 1  },  // Phase 0: full -> 70%
  { radiusPct: 0.7,  waitTime: 45, shrinkTime: 25, damage: 2  },  // Phase 1: 70% -> 50%
  { radiusPct: 0.5,  waitTime: 30, shrinkTime: 20, damage: 5  },  // Phase 2: 50% -> 30%
  { radiusPct: 0.3,  waitTime: 20, shrinkTime: 15, damage: 10 },  // Phase 3: 30% -> 15%
  { radiusPct: 0.07, waitTime: 10, shrinkTime: 10, damage: 20 },  // Phase 4: 15% -> ~150px min radius
];

class ZoneManager {
  /**
   * @param {number} mapSize - number of tiles
   * @param {number} tilePx - pixels per tile (typically 32)
   */
  constructor(mapSize, tilePx) {
    const worldPx = mapSize * tilePx;
    const center = worldPx / 2;
    const initialRadius = (worldPx / 2) * Math.SQRT2; // covers the full square

    this.initialRadius = initialRadius;
    this.worldPx = worldPx;

    this.currentZone = { x: center, y: center, radius: initialRadius };
    this.nextZone = { x: center, y: center, radius: initialRadius };

    this.phase = 0;
    this.shrinkProgress = 0; // 0 = not shrinking, 0..1 during shrink
    this.damagePerTick = PHASES[0].damage;

    // Moving final circle properties
    this.isMovingPhase = false;
    this.moveTarget = null;       // {x, y} target center
    this.moveTimer = 0;           // countdown to next move
    this.moveDuration = 5;        // seconds to lerp to new position
    this.moveProgress = 0;        // 0-1 lerp progress
    this.moveStartCenter = null;  // center when move started

    // Timers
    this._waiting = true;          // true = in wait period, false = shrinking
    this._timer = PHASES[0].waitTime; // countdown in seconds

    // Snapshot of zone at the moment shrink starts (lerp source)
    this._shrinkFrom = { ...this.currentZone };

    // Pre-compute next zone target for phase 0 -> 1
    this._computeNextZone();
  }

  /**
   * Pick a random nextZone center within the current zone, with the next phase radius.
   */
  _computeNextZone() {
    const nextPhaseIdx = Math.min(this.phase + 1, PHASES.length - 1);
    const nextRadius = this.initialRadius * PHASES[nextPhaseIdx].radiusPct;

    if (nextRadius <= 0) {
      this.nextZone = { x: this.currentZone.x, y: this.currentZone.y, radius: 0 };
      return;
    }

    // Random center within current zone such that the next circle fits inside
    const maxOffset = Math.max(0, this.currentZone.radius - nextRadius);
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * maxOffset;

    const nx = this.currentZone.x + Math.cos(angle) * dist;
    const ny = this.currentZone.y + Math.sin(angle) * dist;

    // Clamp so circle stays on map
    const clampedX = Math.max(nextRadius, Math.min(this.worldPx - nextRadius, nx));
    const clampedY = Math.max(nextRadius, Math.min(this.worldPx - nextRadius, ny));

    this.nextZone = { x: clampedX, y: clampedY, radius: nextRadius };
  }

  /**
   * Advance zone timers.
   * @param {number} dt - delta time in seconds
   */
  update(dt) {
    // Moving phase: circle wanders indefinitely
    if (this.isMovingPhase) {
      if (this.moveTarget === null) {
        // No active move — wait for timer
        this.moveTimer -= dt;
        if (this.moveTimer <= 0) {
          // Pick a new moveTarget within 200px of current center
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * 200;
          let nx = this.currentZone.x + Math.cos(angle) * dist;
          let ny = this.currentZone.y + Math.sin(angle) * dist;

          // Clamp so the circle stays on the map
          const r = this.currentZone.radius;
          nx = Math.max(r, Math.min(this.worldPx - r, nx));
          ny = Math.max(r, Math.min(this.worldPx - r, ny));

          this.moveTarget = { x: nx, y: ny };
          this.moveProgress = 0;
          this.moveStartCenter = { x: this.currentZone.x, y: this.currentZone.y };
        }
      } else if (this.moveProgress < 1) {
        // Lerp toward moveTarget
        this.moveProgress += dt / this.moveDuration;
        if (this.moveProgress >= 1) {
          // Snap to target
          this.moveProgress = 1;
          this.currentZone.x = this.moveTarget.x;
          this.currentZone.y = this.moveTarget.y;
          this.moveTarget = null;
          this.moveTimer = 15 + Math.random() * 5;
        } else {
          const t = this.moveProgress;
          this.currentZone.x = this.moveStartCenter.x + (this.moveTarget.x - this.moveStartCenter.x) * t;
          this.currentZone.y = this.moveStartCenter.y + (this.moveTarget.y - this.moveStartCenter.y) * t;
        }
      }
      return;
    }

    if (this.phase >= PHASES.length - 1) {
      // Final phase completed shrinking — enter moving phase
      this.isMovingPhase = true;
      this.moveTimer = 15 + Math.random() * 5;
      this.damagePerTick = PHASES[PHASES.length - 1].damage;
      return;
    }

    this._timer -= dt;

    if (this._waiting) {
      // Wait period
      if (this._timer <= 0) {
        // Transition to shrink
        this._waiting = false;
        this._timer = PHASES[this.phase].shrinkTime;
        this.shrinkProgress = 0;
        this._shrinkFrom = { x: this.currentZone.x, y: this.currentZone.y, radius: this.currentZone.radius };
      }
    } else {
      // Shrink period
      const shrinkTime = PHASES[this.phase].shrinkTime;
      const elapsed = shrinkTime - this._timer;
      this.shrinkProgress = shrinkTime > 0 ? Math.min(1, elapsed / shrinkTime) : 1;

      // Lerp current zone toward next zone
      const t = this.shrinkProgress;
      this.currentZone.x = this._shrinkFrom.x + (this.nextZone.x - this._shrinkFrom.x) * t;
      this.currentZone.y = this._shrinkFrom.y + (this.nextZone.y - this._shrinkFrom.y) * t;
      this.currentZone.radius = this._shrinkFrom.radius + (this.nextZone.radius - this._shrinkFrom.radius) * t;

      if (this._timer <= 0) {
        // Snap to target
        this.currentZone.x = this.nextZone.x;
        this.currentZone.y = this.nextZone.y;
        this.currentZone.radius = this.nextZone.radius;

        // Advance phase (but don't go past the last phase)
        this.phase = Math.min(this.phase + 1, PHASES.length - 1);
        this.damagePerTick = PHASES[this.phase].damage;
        this.shrinkProgress = 0;
        this._waiting = true;
        this._timer = PHASES[this.phase].waitTime;

        // Compute the next target zone
        this._computeNextZone();
      }
    }
  }

  /**
   * Check if a point is inside the current zone circle.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isInZone(x, y) {
    const dx = x - this.currentZone.x;
    const dy = y - this.currentZone.y;
    return (dx * dx + dy * dy) <= (this.currentZone.radius * this.currentZone.radius);
  }

  /**
   * Get damage per tick for entities outside the zone.
   * Returns 0 during the safe (wait) period, damagePerTick during/after shrink.
   * @returns {number}
   */
  getDamage() {
    if (this.isMovingPhase) return PHASES[PHASES.length - 1].damage;
    if (this._waiting) return 0;
    return this.damagePerTick;
  }

  /**
   * Serialize zone state for network transmission.
   */
  serialize() {
    return {
      current: { x: this.currentZone.x, y: this.currentZone.y, radius: this.currentZone.radius },
      next: { x: this.nextZone.x, y: this.nextZone.y, radius: this.nextZone.radius },
      phase: this.phase,
      timeLeft: Math.max(0, this._timer),
      moving: this.isMovingPhase,
    };
  }
}

export { ZoneManager };
