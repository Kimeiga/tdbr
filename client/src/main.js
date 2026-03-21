// Client — Phaser 4 + Socket.IO — LimeZu Art Style
import { io } from 'socket.io-client';
import { FOV } from 'rot-js';

const TILE_PX = 48;
const CHAR_SCALE = 3;  // 16x32 sprites rendered at 3x = 48x96 pixels (matching 48px tiles)
const INTERP_SPEED = 0.2;

// ─── Character names for random assignment ────────────────────────
const CHAR_NAMES = ['Adam', 'Alex', 'Amelia', 'Bob'];
const DIR_OFFSETS = { down: 0, up: 6, right: 12, left: 18 };

function hashStr(s) {
  s = String(s);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function angleToDirection(angle) {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI * 0.25 || a > Math.PI * 1.75) return 'right';
  if (a < Math.PI * 0.75) return 'down';
  if (a < Math.PI * 1.25) return 'left';
  return 'up';
}
const LOS_RADIUS = 380;       // line-of-sight pixel radius
const LOS_RAY_COUNT = 180;    // rays cast for fog-of-war
const LOS_RAY_STEP = 6;

// ─── FOV cache (rot-js shadowcasting) ─────────────────────────────
let visibleTiles = new Set(); // set of "tx,ty" strings
let lastFovX = -1, lastFovY = -1;

// ─── Connection ────────────────────────────────────────────────────
let channel = null;
let myId = null;
let connected = false;
let latency = 0;

// ─── State from server ────────────────────────────────────────────
let serverPlayers = [];
let serverBots = [];
let serverProjectiles = [];
let serverZone = null;
let serverEvents = [];
let serverTick = 0;

// ─── Map ───────────────────────────────────────────────────────────
let mapData = null;
let mapSize = 0;
let mapGrid2D = null;

// ─── Wall autotile variants ───────────────────────────────────────
let wallVariants = null;

// ─── Loot ──────────────────────────────────────────────────────────
let groundLoot = [];

// ─── Client prediction ────────────────────────────────────────────
let inputSeq = 0;
let pendingInputs = [];
let predictedX = 0;
let predictedY = 0;
const PLAYER_SPEED = 220;

// ─── Camera ────────────────────────────────────────────────────────
let cameraX = 0;
let cameraY = 0;
const CAMERA_SMOOTHING = 0.12;

// ─── Scene refs ────────────────────────────────────────────────────
let activeScene = null;
const playerSprites = new Map();  // id → { body, nameTag }
const botSprites = new Map();     // id → { body, hpBar }
const lootSprites = new Map();    // id → { icon, aura }
let zoneGraphics = null;
let fogGraphics = null;  // simple LOS darkness drawn per frame
let combatGfx = null;    // Graphics for tracers / muzzle flashes (world-space)

// ─── HUD elements (fixed to camera) ───────────────────────────────
let hpBarBg = null, hpBarFill = null, hpText = null;
let boostBarBg = null, boostBarFill = null;
let weaponSlots = [];    // array of { bg, icon, label, hotkey }
let minimapGfx = null;
let killFeed = [];       // [{text, time}]
let zoneTimerText = null;
let playerCountText = null;
let ammoText = null;
let reloadBarBg = null, reloadBarFill = null;
let armorText = null;
let aliveCountText = null;

// ─── Smoke clouds (vision blockers) ───────────────────────────────
const smokeClouds = [];  // [{x, y, radius, alpha, timer}]

// ─── Rarity colors ────────────────────────────────────────────────
const RARITY_COLOR = { common: 0xcccccc, rare: 0x4488ff, epic: 0xaa44ff, legendary: 0xffaa00 };
const RARITY_GLOW  = { common: 0x666666, rare: 0x2266cc, epic: 0x7722cc, legendary: 0xcc8800 };

// ─── Weapon switching ───────────────────────────────────────────
let activeSlot = 'primary';

// ─── Death screen ───────────────────────────────────────────────
let deathOverlay = null;
let deathElements = [];
let isShowingDeathScreen = false;
let clientKills = 0;
let gameStartTime = 0;

// ─── Leaderboard ────────────────────────────────────────────────
let leaderboardVisible = false;
let leaderboardPanel = null;
let leaderboardTexts = [];
let serverLeaderboard = [];

// ─── Audio ──────────────────────────────────────────────────────
let audioCtx = null;
let audioInitialized = false;
let audioEnabled = false; // OFF by default — toggled by UI button
let footstepTimer = 0;
let zoneWarningTimer = 0;

function initAudio() {
  if (audioInitialized) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioInitialized = true;
  } catch(e) {}
}

function toggleAudio() {
  if (!audioInitialized) initAudio();
  audioEnabled = !audioEnabled;
  return audioEnabled;
}

function playSound(freq, type, duration, gain = 0.1, pitchEnd = null) {
  if (!audioCtx || !audioEnabled) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (pitchEnd !== null) {
    osc.frequency.linearRampToValueAtTime(pitchEnd, audioCtx.currentTime + duration);
  }
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + duration);
}

function playNoise(duration, gain = 0.05) {
  if (!audioCtx || !audioEnabled) return;
  const bufSize = audioCtx.sampleRate * duration;
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  const g = audioCtx.createGain();
  src.buffer = buf;
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);
  src.connect(g).connect(audioCtx.destination);
  src.start();
}

function playGunshot(weaponId) {
  switch(weaponId) {
    case 'pistol': playSound(200, 'square', 0.08, 0.12); break;
    case 'smg': playSound(300, 'square', 0.04, 0.08); break;
    case 'shotgun': playSound(100, 'sawtooth', 0.12, 0.15); playNoise(0.08, 0.1); break;
    case 'sniper': playSound(150, 'square', 0.2, 0.18); break;
    case 'ar': playSound(250, 'square', 0.06, 0.10); break;
    case 'lmg': playSound(180, 'sawtooth', 0.05, 0.10); break;
    case 'dmr': playSound(160, 'square', 0.15, 0.14); break;
    default: playSound(250, 'square', 0.06, 0.08);
  }
}
function playPickup() { playSound(800, 'sine', 0.1, 0.08, 1200); }
function playHitMarker() { playSound(1000, 'sine', 0.05, 0.06); }
function playDeath() { playSound(200, 'sine', 0.5, 0.12, 50); }
function playZoneWarning() { playSound(400, 'square', 0.15, 0.08); }
function playFootstep() { playNoise(0.03, 0.02); }
const ITEM_RARITY = {
  pistol: 'common', smg: 'rare', shotgun: 'rare', sniper: 'epic',
  ar: 'rare', lmg: 'epic', dmr: 'epic',
  frag_grenade: 'common', smoke_grenade: 'common',
  medkit: 'common', bandage: 'common', energy_drink: 'rare',
  ammo_9mm: 'common', ammo_556: 'common', ammo_762: 'common', ammo_12gauge: 'common', ammo_300: 'common',
  first_aid_kit: 'rare', medkit_full: 'rare', painkiller: 'rare', adrenaline: 'rare',
  vest_1: 'common', vest_2: 'rare', vest_3: 'epic',
  helmet_1: 'common', helmet_2: 'rare', helmet_3: 'epic',
};

// ═══════════════════════════════════════════════════════════════════
// Texture generation
// ═══════════════════════════════════════════════════════════════════

function preload() {
  // ── LimeZu character spritesheets (16x32 frames) ──────────
  for (const name of CHAR_NAMES) {
    this.load.spritesheet(`${name}_run`, `assets/limzu/${name}_run_16x16.png`, {
      frameWidth: 16, frameHeight: 32,
    });
    this.load.spritesheet(`${name}_idle`, `assets/limzu/${name}_idle_anim_16x16.png`, {
      frameWidth: 16, frameHeight: 32,
    });
  }

  // ── LimeZu RPG Maker tileset (scaled 48→32) ─────────────
  this.load.image('rpg_tileset', 'assets/limzu/rpgmaker_tileset.png');

  // ── Modern weapon sprites (ground loot + held) ────────────
  this.load.image('wpn_pistol', 'assets/weapons/pistol.png');
  this.load.image('wpn_smg', 'assets/weapons/smg.png');
  this.load.image('wpn_shotgun', 'assets/weapons/shotgun.png');
  this.load.image('wpn_sniper', 'assets/weapons/sniper.png');

  // ── Procedural textures (kept for tilemap and small FX) ───
  const g = this.make.graphics({ x: 0, y: 0, add: false });

  // ── Muzzle flash ─────────────────────────────────────────
  g.fillStyle(0xffff88, 1);
  g.fillCircle(8, 8, 8);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(8, 8, 4);
  g.generateTexture('muzzle_flash', 16, 16);
  g.clear();

  // ── Bullet hole decal ───────────────────────────────────
  g.fillStyle(0x111111, 1);
  g.fillCircle(4, 4, 4);
  g.fillStyle(0x333333, 1);
  g.fillCircle(4, 4, 2);
  g.generateTexture('bullet_hole', 8, 8);
  g.clear();

  // ── Loot icons (tactical & consumable — procedural) ──────
  // tactical
  g.fillStyle(0x669944, 1);
  g.fillCircle(8, 8, 7);
  g.fillStyle(0x88bb55, 1);
  g.fillCircle(8, 8, 4);
  g.generateTexture('loot_tactical', 16, 16);
  g.clear();
  // consumable
  g.fillStyle(0xdd4444, 1);
  g.fillRoundedRect(2, 2, 12, 14, 3);
  g.fillStyle(0xffffff, 1);
  g.fillRect(6, 5, 4, 2);
  g.fillRect(7, 4, 2, 4);
  g.generateTexture('loot_consumable', 16, 16);
  g.clear();

  // ── Smoke particle ──────────────────────────────────────
  g.fillStyle(0xaaaaaa, 0.5);
  g.fillCircle(16, 16, 16);
  g.generateTexture('smoke_particle', 32, 32);
  g.clear();

  g.destroy();

  // NOTE: Tileset is composed in create() from loaded LimeZu Room Builder tiles
}

// ── Role-based tile system using LimeZu Room Builder 48x48 ──────
// Each tile role maps to a (col, row) position in the Room Builder tileset.
// The tileset strip used by Phaser is composed by placing each role's tile
// at a sequential index.

const TILE_ROLES = {
  // Floors
  floor:           { col: 35, row: 12 },
  floor_n:         { col: 35, row: 11 },
  floor_s:         { col: 35, row: 12 },
  floor_e:         { col: 35, row: 12 },
  floor_w:         { col: 34, row: 12 },
  floor_ne:        { col: 35, row: 11 },
  floor_nw:        { col: 34, row: 11 },
  floor_se:        { col: 35, row: 12 },
  floor_sw:        { col: 34, row: 12 },
  floor_corner_ne: { col: 35, row: 12 },
  floor_corner_nw: { col: 36, row: 11 },
  floor_corner_se: { col: 35, row: 12 },
  floor_corner_sw: { col: 35, row: 12 },
  // Wall faces (2 tiles tall)
  wall_top:        { col: 47, row: 63 },
  wall_bot:        { col: 47, row: 64 },
  wall_top_nw:     { col: 49, row: 64 },
  wall_bot_nw:     { col: 49, row: 65 },
  wall_top_ne:     { col: 46, row: 64 },
  wall_bot_ne:     { col: 46, row: 65 },
  // Side walls
  wall_s:          { col: 12, row: 6 },
  wall_e:          { col: 50, row: 66 },
  wall_w:          { col: 45, row: 66 },
  wall_sw:         { col: 45, row: 65 },
  wall_se:         { col: 50, row: 65 },
  // Diagonal corners
  wall_corner_tl:  { col: 53, row: 52 },
  wall_corner_tr:  { col: 58, row: 52 },
  wall_corner_bl:  { col: 6, row: 6 },
  wall_corner_br:  { col: 5, row: 6 },
  // Top-row diagonal corners (above wall_corner_tl/tr)
  wall_topcorner_tl: { col: 45, row: 62 },
  wall_topcorner_tr: { col: 50, row: 62 },
};

// Build role name → tileset index mapping
const ROLE_NAMES = Object.keys(TILE_ROLES);
const ROLE_TO_IDX = {};
ROLE_NAMES.forEach((name, i) => ROLE_TO_IDX[name] = i);

const TILE_VOID = ROLE_NAMES.length; // void tile index (after all roles)

function composeTileset(scene) {
  const T = TILE_PX;
  const totalTiles = ROLE_NAMES.length + 1; // +1 for void
  const canvas = document.createElement('canvas');
  canvas.width = totalTiles * T;
  canvas.height = T;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const srcImg = scene.textures.get('rpg_tileset').getSourceImage();

  // Draw each role's tile from the source tileset
  for (let i = 0; i < ROLE_NAMES.length; i++) {
    const pos = TILE_ROLES[ROLE_NAMES[i]];
    ctx.drawImage(srcImg, pos.col * T, pos.row * T, T, T, i * T, 0, T, T);
  }

  // Void tile — pure black
  ctx.fillStyle = '#000000';
  ctx.fillRect(TILE_VOID * T, 0, T, T);

  scene.textures.addCanvas('tileset', canvas);
}

// Get weapon texture key for held/ground display
function getWeaponTexture(weaponId) {
  const map = {
    pistol: 'wpn_pistol', smg: 'wpn_smg', shotgun: 'wpn_shotgun', sniper: 'wpn_sniper',
    ar: 'wpn_smg', lmg: 'wpn_shotgun', dmr: 'wpn_sniper',
  };
  return map[weaponId] || null;
}

// ═══════════════════════════════════════════════════════════════════
// Scene create
// ═══════════════════════════════════════════════════════════════════

function create() {
  activeScene = this;

  // ── Compose tileset from LimeZu Room Builder tiles ─────
  console.time('composeTileset');
  composeTileset(this);
  console.timeEnd('composeTileset');

  // ── Register character animations ─────────────────────────
  const DIRS = ['down', 'up', 'right', 'left'];
  for (const name of CHAR_NAMES) {
    for (const dir of DIRS) {
      const start = DIR_OFFSETS[dir];
      this.anims.create({
        key: `${name}_run_${dir}`,
        frames: this.anims.generateFrameNumbers(`${name}_run`, { start, end: start + 5 }),
        frameRate: 10, repeat: -1,
      });
      this.anims.create({
        key: `${name}_idle_${dir}`,
        frames: this.anims.generateFrameNumbers(`${name}_idle`, { start, end: start + 5 }),
        frameRate: 6, repeat: -1,
      });
    }
  }

  // ── Combat graphics (world-space, for tracers/flashes) ───
  combatGfx = this.add.graphics().setDepth(45);

  // ── Zone graphics ────────────────────────────────────────
  zoneGraphics = this.add.graphics().setDepth(50);

  // ── HUD layer (fixed to camera) ─────────────────────────
  createHUD(this);

  this.input.keyboard.addCapture('TAB');

  connectToServer(this);
}

// ═══════════════════════════════════════════════════════════════════
// Scene update
// ═══════════════════════════════════════════════════════════════════

function update(time, delta) {
  if (!connected || !myId) return;
  const dt = delta / 1000;

  // ── Input ────────────────────────────────────────────────
  const keys = this.input.keyboard.addKeys({
    w: Phaser.Input.Keyboard.KeyCodes.W,
    a: Phaser.Input.Keyboard.KeyCodes.A,
    s: Phaser.Input.Keyboard.KeyCodes.S,
    d: Phaser.Input.Keyboard.KeyCodes.D,
    e: Phaser.Input.Keyboard.KeyCodes.E,
    r: Phaser.Input.Keyboard.KeyCodes.R,
    one: Phaser.Input.Keyboard.KeyCodes.ONE,
    two: Phaser.Input.Keyboard.KeyCodes.TWO,
    three: Phaser.Input.Keyboard.KeyCodes.THREE,
    four: Phaser.Input.Keyboard.KeyCodes.FOUR,
    tab: Phaser.Input.Keyboard.KeyCodes.TAB,
    shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
    ctrl: Phaser.Input.Keyboard.KeyCodes.CTRL,
  });

  // ── Death screen check ─────────────────────────────────
  const me = serverPlayers.find(p => p.id === myId);
  if (me && !me.alive) {
    if (!isShowingDeathScreen) showDeathScreen(this);
    return; // Block all input while dead — game auto-restarts
  }
  if (isShowingDeathScreen) hideDeathScreen();

  const pointer = this.input.activePointer;
  const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
  const angle = Math.atan2(worldPoint.y - predictedY, worldPoint.x - predictedX);

  const input = {
    seq: ++inputSeq,
    keys: { w: keys.w.isDown, a: keys.a.isDown, s: keys.s.isDown, d: keys.d.isDown, shift: keys.shift.isDown, ctrl: keys.ctrl.isDown },
    angle,
  };

  applyInput(input, 1 / 60);
  pendingInputs.push(input);
  channel.emit('input', input);

  // ── Footstep sounds ─────────────────────────────────────
  if (input.keys.w || input.keys.a || input.keys.s || input.keys.d) {
    footstepTimer -= dt;
    if (footstepTimer <= 0) { playFootstep(); footstepTimer = 0.35; }
  } else { footstepTimer = 0; }

  // ── Reload ──────────────────────────────────────────────
  if (Phaser.Input.Keyboard.JustDown(keys.r)) {
    channel.emit('reload');
  }

  if (pointer.isDown && !keys.shift.isDown) {
    channel.emit('fire', { angle, slot: activeSlot, latency });
  }
  if (Phaser.Input.Keyboard.JustDown(keys.e)) {
    const nl = findNearestLoot();
    if (nl) channel.emit('pickup', { lootId: nl.id });
  }
  if (Phaser.Input.Keyboard.JustDown(keys.one)) activeSlot = 'primary';
  if (Phaser.Input.Keyboard.JustDown(keys.two)) activeSlot = 'secondary';
  if (Phaser.Input.Keyboard.JustDown(keys.three)) activeSlot = 'tactical';
  if (Phaser.Input.Keyboard.JustDown(keys.four)) {
    channel.emit('use_item', { slot: 'consumable', index: 0 });
  }

  // ── Leaderboard toggle ─────────────────────────────────
  if (Phaser.Input.Keyboard.JustDown(keys.tab)) {
    leaderboardVisible = !leaderboardVisible;
  }
  updateLeaderboard(this);

  // ── Update visuals ──────────────────────────────────────
  recomputeFOV();
  combatGfx.clear();
  updateSmokeClouds(dt);
  updateFogOfWar(this);
  updatePlayerSprites(this);
  updateBotSprites(this);
  updateLootSprites(this);
  updateZoneGraphics();
  updateHUD_frame(this);
  updateMinimap();

  // ── Zone warning sound ─────────────────────────────────
  if (serverZone && me) {
    const dx = predictedX - serverZone.current.x;
    const dy = predictedY - serverZone.current.y;
    const distToCenter = Math.sqrt(dx*dx + dy*dy);
    if (distToCenter > serverZone.current.radius) {
      zoneWarningTimer -= dt;
      if (zoneWarningTimer <= 0) { playZoneWarning(); zoneWarningTimer = 3; }
    } else { zoneWarningTimer = 0; }
  }

  // ── Camera ──────────────────────────────────────────────
  cameraX += (predictedX - cameraX) * CAMERA_SMOOTHING;
  cameraY += (predictedY - cameraY) * CAMERA_SMOOTHING;
  this.cameras.main.centerOn(cameraX, cameraY);
}

// ═══════════════════════════════════════════════════════════════════
// Network (unchanged protocol)
// ═══════════════════════════════════════════════════════════════════

function connectToServer(scene) {
  channel = io(`http://${location.hostname}:${location.port || 3000}`);

  channel.on('connect', () => { connected = true; console.log('Connected'); });

  channel.on('init', data => {
    console.time('init_total');
    myId = data.playerId;
    gameStartTime = Date.now();
    mapData = data.map;
    mapSize = data.mapSize;
    predictedX = data.playerState.x;
    predictedY = data.playerState.y;
    cameraX = predictedX;
    cameraY = predictedY;
    groundLoot = data.loot;
    serverBots = data.bots;
    serverZone = data.zone;
    wallVariants = data.wallVariants || null;

    mapGrid2D = [];
    for (let r = 0; r < mapSize; r++) {
      mapGrid2D[r] = [];
      for (let c = 0; c < mapSize; c++) {
        mapGrid2D[r][c] = mapData[r * mapSize + c];
      }
    }

    // Clean up previous tilemap/labels if rebuilding (e.g., after server restart)
    if (scene._tileMapLayer) scene._tileMapLayer.destroy();
    if (scene._debugLabels) {
      for (const txt of scene._debugLabels) txt.destroy();
    }
    scene._debugLabels = [];

    console.time('buildTilemap');
    buildTilemap(scene);
    console.timeEnd('buildTilemap');
    buildFogOfWar(scene);
    console.timeEnd('init_total');
    console.log(`Init: id=${myId} map=${mapSize}x${mapSize}`);
  });

  channel.on('state', data => {
    serverTick = data.tick;
    serverPlayers = data.players;
    serverBots = data.bots;
    serverProjectiles = data.projectiles;
    serverZone = data.zone;
    serverEvents = data.events || [];
    serverLeaderboard = data.leaderboard || [];
    reconcile();
    processEvents(scene);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Prediction / reconciliation (same as before)
// ═══════════════════════════════════════════════════════════════════

function reconcile() {
  const me = serverPlayers.find(p => p.id === myId);
  if (!me) return;
  pendingInputs = pendingInputs.filter(i => i.seq > me.lastSeq);
  const dx = me.x - predictedX, dy = me.y - predictedY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 100) {
    predictedX = me.x; predictedY = me.y;
    cameraX = me.x; cameraY = me.y;
  } else if (dist > 3) {
    predictedX = me.x; predictedY = me.y;
    for (const inp of pendingInputs) applyInput(inp, 1 / 60);
  }
}

const CHAR_RADIUS = 8; // half of character collision width (narrower for LimeZu sprites)

function clientIsWalkable(px, py) {
  if (!mapGrid2D) return true;
  // Check 4 corners of character bounding box
  for (const [ox, oy] of [[-CHAR_RADIUS, -CHAR_RADIUS], [CHAR_RADIUS, -CHAR_RADIUS], [-CHAR_RADIUS, CHAR_RADIUS], [CHAR_RADIUS, CHAR_RADIUS]]) {
    const tx = Math.floor((px + ox) / TILE_PX);
    const ty = Math.floor((py + oy) / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= mapSize || ty >= mapSize) return false;
    const t = mapGrid2D[ty][tx];
    if (t !== 1 && t !== 3 && t !== 5) return false;
  }
  return true;
}

function tileBlocksVision(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= mapSize || ty >= mapSize) return true;
  const t = mapGrid2D[ty][tx];
  return t === 0 || t === 2 || t === 4; // walls, glass, foliage
}

function applyInput(input, dt) {
  let vx = 0, vy = 0;
  if (input.keys.a) vx -= 1;
  if (input.keys.d) vx += 1;
  if (input.keys.w) vy -= 1;
  if (input.keys.s) vy += 1;
  if (vx !== 0 && vy !== 0) { vx *= 0.7071; vy *= 0.7071; }
  let speed = PLAYER_SPEED;
  const isSprinting = input.keys.shift && (vx !== 0 || vy !== 0);
  const isCrouching = input.keys.ctrl && !isSprinting;
  if (isSprinting) speed *= 1.5;
  if (isCrouching) speed *= 0.5;
  const mx = vx * speed * dt, my = vy * speed * dt;

  // Try full move
  if (clientIsWalkable(predictedX + mx, predictedY + my)) {
    predictedX += mx; predictedY += my;
    return;
  }
  // Axis sliding — try each axis independently
  let movedX = false, movedY = false;
  if (mx !== 0 && clientIsWalkable(predictedX + mx, predictedY)) {
    predictedX += mx; movedX = true;
  }
  if (my !== 0 && clientIsWalkable(predictedX, predictedY + my)) {
    predictedY += my; movedY = true;
  }
  if (movedX || movedY) return;

  // Corner nudge: push player toward tile center to slide around corners
  // Find which tile edge we're near and nudge perpendicular to movement
  const tileAlignX = Math.round(predictedX / TILE_PX) * TILE_PX + TILE_PX / 2;
  const tileAlignY = Math.round(predictedY / TILE_PX) * TILE_PX + TILE_PX / 2;
  const nudge = 2; // small nudge per frame

  if (mx !== 0) {
    // Moving horizontally but blocked — nudge Y toward tile center
    const diffY = tileAlignY - predictedY;
    if (Math.abs(diffY) > 2) {
      const ny = diffY > 0 ? nudge : -nudge;
      if (clientIsWalkable(predictedX, predictedY + ny)) {
        predictedY += ny;
      }
    }
  }
  if (my !== 0) {
    // Moving vertically but blocked — nudge X toward tile center
    const diffX = tileAlignX - predictedX;
    if (Math.abs(diffX) > 2) {
      const nx = diffX > 0 ? nudge : -nudge;
      if (clientIsWalkable(predictedX + nx, predictedY)) {
        predictedX += nx;
      }
    }
  }
}

function findNearestLoot() {
  let best = null, bestD = 50;
  for (const l of groundLoot) {
    if (l.pickedUp) continue;
    const d = Math.hypot(l.x - predictedX, l.y - predictedY);
    if (d < bestD) { bestD = d; best = l; }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════
// Task 8: Tilemap & Fog of War
// ═══════════════════════════════════════════════════════════════════

function buildTilemap(scene) {
  const grid2D = mapGrid2D;
  const W = 0, F_TILES = new Set([1, 2, 3, 5]); // wall=0, floor types

  function isFloor(r, c) {
    if (r < 0 || c < 0 || r >= mapSize || c >= mapSize) return false;
    return F_TILES.has(grid2D[r][c]);
  }
  function isWall(r, c) {
    if (r < 0 || c < 0 || r >= mapSize || c >= mapSize) return false;
    return grid2D[r][c] === W;
  }
  function get(r, c) {
    if (r < 0 || c < 0 || r >= mapSize || c >= mapSize) return -1;
    return grid2D[r][c];
  }

  // Pre-compute visible walls (adjacent to any floor tile, 8-connected)
  const isVisibleWall = new Uint8Array(mapSize * mapSize);
  for (let r = 0; r < mapSize; r++) {
    for (let c = 0; c < mapSize; c++) {
      if (grid2D[r][c] === W) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (isFloor(r + dr, c + dc)) { isVisibleWall[r * mapSize + c] = 1; break; }
          }
          if (isVisibleWall[r * mapSize + c]) break;
        }
      }
    }
  }

  // Pre-compute wall_bot (wall with floor to south) and wall_top (above wall_bot)
  const isWallBot = new Uint8Array(mapSize * mapSize);
  const isWallTop = new Uint8Array(mapSize * mapSize);
  for (let r = 0; r < mapSize; r++)
    for (let c = 0; c < mapSize; c++)
      if (grid2D[r][c] === W && isFloor(r + 1, c)) isWallBot[r * mapSize + c] = 1;
  for (let r = 0; r < mapSize; r++)
    for (let c = 0; c < mapSize; c++)
      if (grid2D[r][c] === W && r + 1 < mapSize && isWallBot[(r + 1) * mapSize + c])
        isWallTop[r * mapSize + c] = 1;

  // Pre-compute diagonal corners (bottom row)
  const isCornerBot = new Uint8Array(mapSize * mapSize); // 1=tl, 2=tr
  for (let r = 0; r < mapSize; r++) {
    for (let c = 0; c < mapSize; c++) {
      if (grid2D[r][c] !== W) continue;
      if (isWallBot[r * mapSize + c] || isWallTop[r * mapSize + c]) continue;
      const hN = isFloor(r-1,c), hS = isFloor(r+1,c), hE = isFloor(r,c+1), hW = isFloor(r,c-1);
      if (hN || hS || hE || hW) continue;
      if (isFloor(r+1,c+1)) isCornerBot[r * mapSize + c] = 1; // tl
      else if (isFloor(r+1,c-1)) isCornerBot[r * mapSize + c] = 2; // tr
    }
  }
  // Top-row diagonal corners
  const isCornerTop = new Uint8Array(mapSize * mapSize);
  for (let r = 0; r < mapSize; r++) {
    for (let c = 0; c < mapSize; c++) {
      if (r + 1 < mapSize && isCornerBot[(r+1) * mapSize + c]) {
        if (grid2D[r][c] === W && !isWallBot[r*mapSize+c] && !isWallTop[r*mapSize+c]) {
          isCornerTop[r * mapSize + c] = isCornerBot[(r+1) * mapSize + c];
        }
      }
    }
  }

  // Extend visibility: wall_top and top-corner tiles are also visible
  for (let r = 0; r < mapSize; r++) {
    for (let c = 0; c < mapSize; c++) {
      const idx = r * mapSize + c;
      if (isWallTop[idx] || isCornerTop[idx]) {
        isVisibleWall[idx] = 1;
      }
    }
  }

  // Classify every tile into a role
  const roleGrid = Array.from({ length: mapSize }, () => new Array(mapSize).fill('void'));

  for (let r = 0; r < mapSize; r++) {
    for (let c = 0; c < mapSize; c++) {
      const tile = grid2D[r][c];
      const idx = r * mapSize + c;

      if (tile !== W && !F_TILES.has(tile)) { roleGrid[r][c] = 'void'; continue; }

      if (F_TILES.has(tile)) {
        // Floor classification
        const wN = isWall(r-1,c), wS = isWall(r+1,c), wE = isWall(r,c+1), wW = isWall(r,c-1);
        const wNE = isWall(r-1,c+1), wNW = isWall(r-1,c-1), wSE = isWall(r+1,c+1), wSW = isWall(r+1,c-1);
        if (wN && wW) roleGrid[r][c] = 'floor_nw';
        else if (wN && wE) roleGrid[r][c] = 'floor_ne';
        else if (wS && wW) roleGrid[r][c] = 'floor_sw';
        else if (wS && wE) roleGrid[r][c] = 'floor_se';
        else if (wN) roleGrid[r][c] = 'floor_n';
        else if (wS) roleGrid[r][c] = 'floor_s';
        else if (wE) roleGrid[r][c] = 'floor_e';
        else if (wW) roleGrid[r][c] = 'floor_w';
        else if (wNW) roleGrid[r][c] = 'floor_corner_nw';
        else if (wNE) roleGrid[r][c] = 'floor_corner_ne';
        else if (wSW) roleGrid[r][c] = 'floor_corner_sw';
        else if (wSE) roleGrid[r][c] = 'floor_corner_se';
        else roleGrid[r][c] = 'floor';
        continue;
      }

      // Wall classification
      if (!isVisibleWall[idx]) { roleGrid[r][c] = 'void'; continue; }

      if (isWallBot[idx]) {
        const floorLeft = c > 0 && isFloor(r, c - 1);
        const floorRight = c < mapSize - 1 && isFloor(r, c + 1);
        if (floorLeft) roleGrid[r][c] = 'wall_bot_nw';
        else if (floorRight) roleGrid[r][c] = 'wall_bot_ne';
        else roleGrid[r][c] = 'wall_bot';
      } else if (isWallTop[idx]) {
        const floorLeft = c > 0 && isFloor(r, c - 1);
        const floorRight = c < mapSize - 1 && isFloor(r, c + 1);
        if (floorLeft) roleGrid[r][c] = 'wall_top_nw';
        else if (floorRight) roleGrid[r][c] = 'wall_top_ne';
        else roleGrid[r][c] = 'wall_top';
      } else if (isCornerTop[idx]) {
        roleGrid[r][c] = isCornerTop[idx] === 1 ? 'wall_topcorner_tl' : 'wall_topcorner_tr';
      } else if (isCornerBot[idx]) {
        roleGrid[r][c] = isCornerBot[idx] === 1 ? 'wall_corner_tl' : 'wall_corner_tr';
      } else {
        const hN = isFloor(r-1,c), hE = isFloor(r,c+1), hW = isFloor(r,c-1);
        if (hN && hE) roleGrid[r][c] = 'wall_sw';
        else if (hN && hW) roleGrid[r][c] = 'wall_se';
        else if (hN) roleGrid[r][c] = 'wall_s';
        else if (hE) roleGrid[r][c] = 'wall_w';
        else if (hW) roleGrid[r][c] = 'wall_e';
        else {
          const dne = isFloor(r-1,c+1), dnw = isFloor(r-1,c-1);
          if (dne) roleGrid[r][c] = 'wall_corner_bl';
          else if (dnw) roleGrid[r][c] = 'wall_corner_br';
          else roleGrid[r][c] = 'void';
        }
      }
    }
  }

  // Build tilemap index grid from roles
  const displayGrid = roleGrid.map(row => row.map(role => {
    const idx = ROLE_TO_IDX[role];
    return idx !== undefined ? idx : TILE_VOID;
  }));

  const map = scene.make.tilemap({ data: displayGrid, tileWidth: TILE_PX, tileHeight: TILE_PX });
  const tileset = map.addTilesetImage('tileset', 'tileset', TILE_PX, TILE_PX, 0, 0);
  scene._tileMapLayer = map.createLayer(0, tileset, 0, 0).setDepth(0);

  // ── Debug overlay: toggle with O key (lazy — only created when first enabled) ──
  const debugLabels = scene._debugLabels;
  let debugVisible = false;
  let debugCreated = false;

  const SHORT_LABELS = {
    floor:'F',floor_n:'Fn',floor_s:'Fs',floor_e:'Fe',floor_w:'Fw',
    floor_ne:'Fne',floor_nw:'Fnw',floor_se:'Fse',floor_sw:'Fsw',
    floor_corner_ne:'F*ne',floor_corner_nw:'F*nw',floor_corner_se:'F*se',floor_corner_sw:'F*sw',
    wall_top:'WT',wall_bot:'WB',
    wall_top_nw:'WTnw',wall_bot_nw:'WBnw',wall_top_ne:'WTne',wall_bot_ne:'WBne',
    wall_s:'Ws',wall_e:'We',wall_w:'Ww',wall_sw:'Wsw',wall_se:'Wse',
    wall_corner_tl:'W*tl',wall_corner_tr:'W*tr',wall_corner_bl:'W*bl',wall_corner_br:'W*br',
    wall_topcorner_tl:'WT*tl',wall_topcorner_tr:'WT*tr',
  };

  function createDebugOverlay() {
    if (debugCreated) return;
    debugCreated = true;
    console.time('createDebugOverlay');
    for (let r = 0; r < mapSize; r++) {
      for (let c = 0; c < mapSize; c++) {
        const role = roleGrid[r][c];
        if (role === 'void') continue;
        const label = SHORT_LABELS[role] || role;
        const isWall = role.startsWith('wall');
        const txt = scene.add.text(
          c * TILE_PX + TILE_PX / 2, r * TILE_PX + TILE_PX / 2, label,
          { fontSize: '8px', fontFamily: 'monospace', color: isWall ? '#ff8844' : '#ffffff',
            align: 'center', stroke: '#000000', strokeThickness: 2 }
        ).setOrigin(0.5).setDepth(3);
        debugLabels.push(txt);
      }
    }
    console.timeEnd('createDebugOverlay');
  }

  scene.input.keyboard.on('keydown-O', () => {
    debugVisible = !debugVisible;
    if (debugVisible && !debugCreated) createDebugOverlay();
    for (const txt of debugLabels) txt.setVisible(debugVisible);
  });

  // P = restart server (regenerate map)
  scene.input.keyboard.on('keydown-P', () => {
    if (channel) channel.emit('restart_server');
  });

  scene.physics.world.setBounds(0, 0, mapSize * TILE_PX, mapSize * TILE_PX);
  scene.cameras.main.setBounds(0, 0, mapSize * TILE_PX, mapSize * TILE_PX);
}

function buildFogOfWar(scene) {
  // Lightweight: draw dark rings beyond LOS each frame (screen-space)
  fogGraphics = scene.add.graphics().setDepth(55).setScrollFactor(0);
}

function updateFogOfWar(scene) {
  // DEBUG: fog disabled for debugging
  if (fogGraphics) fogGraphics.clear();
}

function recomputeFOV() {
  const playerTX = Math.floor(predictedX / TILE_PX);
  const playerTY = Math.floor(predictedY / TILE_PX);

  // Only recompute if player moved to a new tile
  if (playerTX === lastFovX && playerTY === lastFovY) return;
  lastFovX = playerTX;
  lastFovY = playerTY;

  visibleTiles.clear();

  const fov = new FOV.PreciseShadowcasting((x, y) => {
    // Return true if light passes through
    if (x < 0 || y < 0 || x >= mapSize || y >= mapSize) return false;
    const t = mapGrid2D[y][x];
    // Walls (0), glass (2), and foliage (4) block vision
    return t === 1 || t === 3 || t === 5;
  });

  const radiusTiles = Math.ceil(LOS_RADIUS / TILE_PX);
  fov.compute(playerTX, playerTY, radiusTiles, (x, y, r, visibility) => {
    if (visibility > 0) {
      visibleTiles.add(x + ',' + y);
    }
  });
}

function isInPlayerLOS(x, y) {
  return true; // DEBUG: disable LOS culling — always visible
}

// Pixel-level line-of-sight check (for shooting — more precise than tile FOV)
function hasDirectLOS(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return true;
  const steps = Math.ceil(dist / 4); // 4px steps
  const sx = dx / steps, sy = dy / steps;
  for (let i = 1; i < steps; i++) {
    const px = x1 + sx * i, py = y1 + sy * i;
    const tx = Math.floor(px / TILE_PX), ty = Math.floor(py / TILE_PX);
    if (tileBlocksVision(tx, ty)) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// Task 9: Combat FX & Events
// ═══════════════════════════════════════════════════════════════════

function processEvents(scene) {
  for (const ev of serverEvents) {
    switch (ev.type) {
      case 'fire': {
        // Tracer line from shooter — raycast to find wall hit on client
        const shooter = serverPlayers.find(p => p.id === ev.shooterId);
        const baseX = shooter ? shooter.x : predictedX;
        const baseY = shooter ? shooter.y : predictedY;
        const originX = baseX;
        const originY = baseY - 16; // center-mass
        // Raycast to find where tracer hits a wall
        let tracerEndX = originX + Math.cos(ev.angle) * 500;
        let tracerEndY = originY + Math.sin(ev.angle) * 500;
        const raySteps = Math.ceil(500 / 8);
        for (let i = 1; i <= raySteps; i++) {
          const rx = originX + Math.cos(ev.angle) * i * 8;
          const ry = originY + Math.sin(ev.angle) * i * 8;
          const tx = Math.floor(rx / TILE_PX), ty = Math.floor(ry / TILE_PX);
          if (tileBlocksVision(tx, ty)) {
            tracerEndX = rx; tracerEndY = ry;
            break;
          }
        }
        const sx = originX + Math.cos(ev.angle) * 24;
        const sy = originY + Math.sin(ev.angle) * 24;
        drawTracer(scene, sx, sy, tracerEndX, tracerEndY);

        // Muzzle flash
        const flash = scene.add.sprite(
          sx + Math.cos(ev.angle) * 8,
          sy + Math.sin(ev.angle) * 8,
          'muzzle_flash'
        ).setDepth(46).setAlpha(0.9).setScale(0.8);
        scene.tweens.add({
          targets: flash, alpha: 0, scale: 1.5, duration: 60,
          onComplete: () => flash.destroy(),
        });
        playGunshot(ev.weapon);
        break;
      }

      case 'hit': {
        playHitMarker();
        break;
      }

      case 'wallhit': {
        const hole = scene.add.sprite(ev.x, ev.y, 'bullet_hole').setDepth(2).setAlpha(0.8);
        scene.tweens.add({
          targets: hole, alpha: 0, duration: 5000, delay: 3000,
          onComplete: () => hole.destroy(),
        });
        break;
      }

      case 'explosion': {
        // Procedural explosion circles
        const explosionRadius = ev.radius || 60;
        for (let i = 0; i < 5; i++) {
          const colors = [0xff4400, 0xff8800, 0xffcc00, 0xff6600, 0xffaa00];
          const c = scene.add.circle(
            ev.x + (Math.random() - 0.5) * 20,
            ev.y + (Math.random() - 0.5) * 20,
            explosionRadius * (0.3 + Math.random() * 0.4),
            colors[i], 0
          ).setDepth(46);
          scene.tweens.add({
            targets: c,
            alpha: { from: 0, to: 0.8 },
            scale: { from: 0.3, to: 1.2 },
            duration: 80,
            delay: i * 40,
            onComplete: () => {
              scene.tweens.add({
                targets: c, alpha: 0, duration: 150,
                onComplete: () => c.destroy(),
              });
            },
          });
        }
        // Smoke aftermath
        for (let i = 0; i < 3; i++) {
          const smokeC = scene.add.circle(
            ev.x + (Math.random() - 0.5) * 30,
            ev.y + (Math.random() - 0.5) * 30,
            explosionRadius * 0.5, 0x888888, 0
          ).setDepth(45);
          scene.tweens.add({
            targets: smokeC,
            alpha: { from: 0, to: 0.5 },
            scale: 1.5,
            duration: 300,
            delay: 250 + i * 80,
            onComplete: () => {
              scene.tweens.add({
                targets: smokeC, alpha: 0, duration: 500,
                onComplete: () => smokeC.destroy(),
              });
            },
          });
        }
        break;
      }

      case 'pickup': {
        const l = groundLoot.find(x => x.id === ev.lootId);
        if (l) l.pickedUp = true;
        playPickup();
        break;
      }

      case 'kill': {
        addKillFeedEntry(scene, ev.killerId, ev.targetId);
        if (ev.killerId === myId) clientKills++;
        playDeath();
        break;
      }

      case 'use_item': {
        // Could show a heal effect — small green flash on player
        if (ev.playerId === myId) {
          const healFx = scene.add.circle(predictedX, predictedY, 20, 0x44ff66, 0.4).setDepth(25);
          scene.tweens.add({
            targets: healFx, alpha: 0, scale: 2, duration: 400,
            onComplete: () => healFx.destroy(),
          });
        }
        break;
      }
    }
  }
}

function drawTracer(scene, x1, y1, x2, y2) {
  const tracer = scene.add.graphics().setDepth(44);
  tracer.lineStyle(2, 0xffff44, 0.9);
  tracer.beginPath();
  tracer.moveTo(x1, y1);
  tracer.lineTo(x2, y2);
  tracer.strokePath();
  scene.tweens.add({
    targets: tracer, alpha: 0, duration: 80,
    onComplete: () => tracer.destroy(),
  });
}

// ─── Smoke clouds ──────────────────────────────────────────────────
function spawnSmoke(scene, x, y) {
  const cloud = { x, y, radius: 10, maxRadius: 80, alpha: 0.7, timer: 5.0, particles: [] };
  // Emit some particles
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 40;
    const p = scene.add.sprite(x + Math.cos(a) * d, y + Math.sin(a) * d, 'smoke_particle')
      .setDepth(42).setAlpha(0).setScale(0.5 + Math.random());
    scene.tweens.add({
      targets: p, alpha: 0.5, scale: 2 + Math.random(), duration: 1500,
      yoyo: true, hold: 2000,
      onComplete: () => p.destroy(),
    });
    cloud.particles.push(p);
  }
  smokeClouds.push(cloud);
}

function updateSmokeClouds(dt) {
  for (let i = smokeClouds.length - 1; i >= 0; i--) {
    const c = smokeClouds[i];
    c.timer -= dt;
    c.radius = Math.min(c.maxRadius, c.radius + dt * 30);
    if (c.timer <= 0) {
      smokeClouds.splice(i, 1);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Task 10: Entity sprites with LOS
// ═══════════════════════════════════════════════════════════════════

function updatePlayerSprites(scene) {
  const active = new Set();
  for (const p of serverPlayers) {
    active.add(p.id);
    const isMe = p.id === myId;
    let entry = playerSprites.get(p.id);

    if (!entry) {
      const charName = CHAR_NAMES[hashStr(p.id) % CHAR_NAMES.length];
      const body = scene.add.sprite(0, 0, `${charName}_idle`, 0)
        .setDepth(20).setScale(CHAR_SCALE).setOrigin(0.5, 1.0);
      const weapon = scene.add.sprite(0, 0, 'wpn_pistol')
        .setDepth(21).setScale(3).setOrigin(0, 0.5).setVisible(false);
      entry = { body, weapon, charName, lastDir: 'down', prevX: 0, prevY: 0 };
      playerSprites.set(p.id, entry);
    }

    let sx, sy;
    if (isMe) {
      sx = predictedX; sy = predictedY;
    } else {
      if (!isInPlayerLOS(p.x, p.y)) {
        entry.body.setVisible(false);
        entry.weapon.setVisible(false);
        continue;
      }
      entry.body.setVisible(true);
      sx = entry.body.x + (p.x - entry.body.x) * INTERP_SPEED;
      sy = entry.body.y + (p.y - entry.body.y) * INTERP_SPEED;
    }

    // Determine direction and movement state
    const dir = angleToDirection(p.angle);
    const dx = sx - entry.prevX, dy = sy - entry.prevY;
    const isMoving = (dx * dx + dy * dy) > 0.5;
    entry.prevX = sx; entry.prevY = sy;

    const animKey = `${entry.charName}_${isMoving ? 'run' : 'idle'}_${dir}`;
    entry.body.anims.play(animKey, true);
    entry.body.setPosition(sx, sy);
    entry.body.setAlpha(p.alive ? 1 : 0.3);

    // Y-based depth sorting for 3/4 perspective
    const yDepth = 10 + sy / (mapSize * TILE_PX) * 40;
    entry.body.setDepth(yDepth);

    // Held weapon
    const weaponId = p.inventory?.primary || p.inventory?.secondary || null;
    const wpnTex = weaponId ? getWeaponTexture(weaponId) : null;
    if (wpnTex && p.alive) {
      entry.weapon.setTexture(wpnTex).setVisible(true);
      entry.weapon.setPosition(sx, sy - 20);
      entry.weapon.setRotation(p.angle);
      entry.weapon.setFlipY(Math.abs(p.angle) > Math.PI / 2);
      entry.weapon.setDepth(dir === 'up' ? yDepth - 0.1 : yDepth + 0.1);
    } else {
      entry.weapon.setVisible(false);
    }
  }

  for (const [id, entry] of playerSprites) {
    if (!active.has(id)) {
      entry.body.destroy();
      entry.weapon.destroy();
      playerSprites.delete(id);
    }
  }
}

function updateBotSprites(scene) {
  const active = new Set();
  for (const b of serverBots) {
    active.add(b.id);
    let entry = botSprites.get(b.id);
    const visible = isInPlayerLOS(b.x, b.y);

    if (!entry) {
      const charName = CHAR_NAMES[hashStr(b.id) % CHAR_NAMES.length];
      const body = scene.add.sprite(b.x, b.y, `${charName}_idle`, 0)
        .setDepth(15).setScale(CHAR_SCALE).setOrigin(0.5, 1.0);
      const weapon = scene.add.sprite(b.x, b.y, 'wpn_pistol')
        .setDepth(16).setScale(3).setOrigin(0, 0.5).setVisible(false);
      const hpBar = scene.add.graphics().setDepth(17);
      entry = { body, weapon, hpBar, charName, prevX: b.x, prevY: b.y };
      botSprites.set(b.id, entry);
    }

    entry.body.setVisible(visible);
    entry.weapon.setVisible(false);
    entry.hpBar.setVisible(visible && b.hp < 100);

    if (visible) {
      const sx = entry.body.x + (b.x - entry.body.x) * INTERP_SPEED;
      const sy = entry.body.y + (b.y - entry.body.y) * INTERP_SPEED;

      const dir = angleToDirection(b.angle);
      const dx = sx - entry.prevX, dy = sy - entry.prevY;
      const isMoving = (dx * dx + dy * dy) > 0.5;
      entry.prevX = sx; entry.prevY = sy;

      const animKey = `${entry.charName}_${isMoving ? 'run' : 'idle'}_${dir}`;
      entry.body.anims.play(animKey, true);
      entry.body.setPosition(sx, sy);

      // Y-based depth sorting
      const yDepth = 10 + sy / (mapSize * TILE_PX) * 40;
      entry.body.setDepth(yDepth);

      // Held weapon
      const wpnTex = b.weapon ? getWeaponTexture(b.weapon) : null;
      if (wpnTex) {
        entry.weapon.setTexture(wpnTex).setVisible(true);
        entry.weapon.setPosition(sx, sy - 20);
        entry.weapon.setRotation(b.angle);
        entry.weapon.setFlipY(Math.abs(b.angle) > Math.PI / 2);
        entry.weapon.setDepth(dir === 'up' ? yDepth - 0.1 : yDepth + 0.1);
      }

      // HP bar above bot
      if (b.hp < 100) {
        entry.hpBar.clear();
        const bx = sx - 12, by = sy - 64 - 4;
        entry.hpBar.fillStyle(0x333333, 0.8);
        entry.hpBar.fillRect(bx, by, 24, 3);
        entry.hpBar.fillStyle(b.hp > 50 ? 0x44ff44 : b.hp > 25 ? 0xffaa00 : 0xff3333, 1);
        entry.hpBar.fillRect(bx, by, 24 * (b.hp / 100), 3);
        entry.hpBar.setDepth(yDepth + 0.2);
      }
    }
  }

  for (const [id, entry] of botSprites) {
    if (!active.has(id)) {
      entry.body.destroy();
      entry.weapon.destroy();
      entry.hpBar.destroy();
      botSprites.delete(id);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Task 10: Loot with rarity auras
// ═══════════════════════════════════════════════════════════════════

function getLootTexture(itemId) {
  if (itemId === 'pistol') return 'wpn_pistol';
  if (itemId === 'smg' || itemId === 'ar') return 'wpn_smg';
  if (itemId === 'shotgun' || itemId === 'lmg') return 'wpn_shotgun';
  if (itemId === 'sniper' || itemId === 'dmr') return 'wpn_sniper';
  if (itemId === 'frag_grenade' || itemId === 'smoke_grenade') return 'loot_tactical';
  return 'loot_consumable';
}

function updateLootSprites(scene) {
  for (const l of groundLoot) {
    if (l.pickedUp) {
      const e = lootSprites.get(l.id);
      if (e) {
        e.icon.destroy();
        if (e.aura) e.aura.destroy();
        lootSprites.delete(l.id);
      }
      continue;
    }

    const visible = isInPlayerLOS(l.x, l.y);

    if (!lootSprites.has(l.id)) {
      const rarity = ITEM_RARITY[l.itemId] || 'common';
      const glowColor = RARITY_GLOW[rarity];

      // Aura glow circle beneath
      const aura = scene.add.circle(l.x, l.y, 14, glowColor, 0.35).setDepth(2);
      scene.tweens.add({
        targets: aura, alpha: { from: 0.15, to: 0.45 }, scale: { from: 0.9, to: 1.2 },
        duration: 800 + Math.random() * 400, yoyo: true, repeat: -1,
      });

      const texKey = getLootTexture(l.itemId);
      const isWeapon = texKey.startsWith('wpn_');
      // Modern weapon sprites are ~26x9px — scale up to be clearly visible
      const icon = scene.add.sprite(l.x, l.y, texKey).setDepth(3).setScale(isWeapon ? 3 : 1);
      // Tint weapons white so they stand out against dark ground, rarity for others
      icon.setTint(isWeapon ? 0xffffff : RARITY_COLOR[rarity]);
      // Gentle bob animation for loot visibility
      scene.tweens.add({
        targets: icon, y: l.y - 3, duration: 1000 + Math.random() * 500,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });

      lootSprites.set(l.id, { icon, aura });
    }

    const e = lootSprites.get(l.id);
    if (e) {
      e.icon.setVisible(visible);
      e.aura.setVisible(visible);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Zone rendering
// ═══════════════════════════════════════════════════════════════════

function updateZoneGraphics() {
  if (!serverZone || !zoneGraphics) return;
  zoneGraphics.clear();
  const { current, next } = serverZone;
  const wW = mapSize * TILE_PX, wH = mapSize * TILE_PX;

  // Danger overlay
  zoneGraphics.fillStyle(0xff0000, 0.08);
  zoneGraphics.fillRect(0, 0, wW, wH);
  // Clear safe area
  zoneGraphics.fillStyle(0x0a0a15, 0.08);
  zoneGraphics.fillCircle(current.x, current.y, current.radius);

  // Zone borders
  zoneGraphics.lineStyle(3, 0x3399ff, 0.6);
  zoneGraphics.strokeCircle(current.x, current.y, current.radius);
  if (next.radius > 0 && next.radius < current.radius) {
    zoneGraphics.lineStyle(2, 0xffffff, 0.3);
    zoneGraphics.strokeCircle(next.x, next.y, next.radius);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Task 11: HUD
// ═══════════════════════════════════════════════════════════════════

function createHUD(scene) {
  const sw = scene.scale.width;
  const sh = scene.scale.height;
  const D = 200; // depth for all HUD

  // ── Health bar (bottom center) ───────────────────────────
  const hpW = 280, hpH = 18, hpX = sw / 2 - hpW / 2, hpY = sh - 50;
  hpBarBg = scene.add.rectangle(hpX + hpW / 2, hpY + hpH / 2, hpW, hpH, 0x222222, 0.8)
    .setScrollFactor(0).setDepth(D);
  hpBarFill = scene.add.rectangle(hpX + 2, hpY + 2, hpW - 4, hpH - 4, 0x33cc55, 1)
    .setScrollFactor(0).setDepth(D + 1).setOrigin(0, 0);
  hpText = scene.add.text(hpX + hpW / 2, hpY + hpH / 2, '200', {
    fontSize: '13px', fill: '#fff', fontFamily: 'monospace', fontStyle: 'bold',
  }).setScrollFactor(0).setDepth(D + 2).setOrigin(0.5);

  // ── Boost bar (energy drink bar above health) ────────────
  boostBarBg = scene.add.rectangle(hpX + hpW / 2, hpY - 6, hpW, 6, 0x222222, 0.6)
    .setScrollFactor(0).setDepth(D);
  boostBarFill = scene.add.rectangle(hpX + 2, hpY - 8, 0, 4, 0xffaa00, 1)
    .setScrollFactor(0).setDepth(D + 1).setOrigin(0, 0);

  // ── Weapon slots (bottom right) ──────────────────────────
  const slotW = 70, slotH = 40, slotGap = 6;
  const slotStartX = sw - (slotW + slotGap) * 3 - 16;
  const slotY = sh - 56;
  const slotLabels = ['Primary [1]', 'Secondry [2]', 'Tactical [3]'];
  weaponSlots = [];
  for (let i = 0; i < 3; i++) {
    const x = slotStartX + (slotW + slotGap) * i;
    const bg = scene.add.rectangle(x + slotW / 2, slotY + slotH / 2, slotW, slotH, 0x1a1a2e, 0.85)
      .setScrollFactor(0).setDepth(D).setStrokeStyle(1, 0x444466);
    const label = scene.add.text(x + slotW / 2, slotY + slotH - 4, slotLabels[i], {
      fontSize: '8px', fill: '#888', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5, 1);
    const icon = scene.add.text(x + slotW / 2, slotY + 14, '—', {
      fontSize: '11px', fill: '#ccc', fontFamily: 'monospace', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5);
    weaponSlots.push({ bg, label, icon });
  }

  // ── Zone timer (top center) ──────────────────────────────
  zoneTimerText = scene.add.text(sw / 2, 16, '', {
    fontSize: '14px', fill: '#aaddff', fontFamily: 'monospace', fontStyle: 'bold',
    backgroundColor: '#00000066', padding: { x: 8, y: 4 },
  }).setScrollFactor(0).setDepth(D).setOrigin(0.5, 0);

  // ── Player count (top left) ──────────────────────────────
  playerCountText = scene.add.text(16, 16, '', {
    fontSize: '13px', fill: '#fff', fontFamily: 'monospace',
    backgroundColor: '#00000066', padding: { x: 6, y: 4 },
  }).setScrollFactor(0).setDepth(D);

  // ── Minimap (top right) ──────────────────────────────────
  minimapGfx = scene.add.graphics().setScrollFactor(0).setDepth(D);

  // ── Ammo counter (below weapon slots) ───────────────────
  ammoText = scene.add.text(sw - 120, sh - 14, '', {
    fontSize: '13px', fill: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
    backgroundColor: '#00000088', padding: { x: 6, y: 2 },
  }).setScrollFactor(0).setDepth(D + 2).setOrigin(0.5, 1);

  // ── Reload progress bar (above weapon slots) ──────────
  const rlX = sw - 160, rlY = sh - 70;
  reloadBarBg = scene.add.rectangle(rlX + 60, rlY, 120, 8, 0x333333, 0.8)
    .setScrollFactor(0).setDepth(D).setVisible(false);
  reloadBarFill = scene.add.rectangle(rlX, rlY, 0, 6, 0x44aaff, 1)
    .setScrollFactor(0).setDepth(D + 1).setOrigin(0, 0.5).setVisible(false);

  // ── Armor icons (next to HP bar) ──────────────────────
  armorText = scene.add.text(hpX + hpW + 10, hpY + 2, '', {
    fontSize: '12px', fill: '#88bbff', fontFamily: 'monospace',
  }).setScrollFactor(0).setDepth(D + 1);

  // ── Alive count (top left, second line) ────────────────
  aliveCountText = scene.add.text(16, 36, '', {
    fontSize: '11px', fill: '#aaa', fontFamily: 'monospace',
    backgroundColor: '#00000066', padding: { x: 6, y: 2 },
  }).setScrollFactor(0).setDepth(D);

  // ── Audio toggle button (bottom left) ─────────────────────
  const audioBtn = scene.add.text(16, sh - 36, 'SOUND: OFF', {
    fontSize: '12px', fill: '#888', fontFamily: 'monospace',
    backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 4 },
  }).setScrollFactor(0).setDepth(D).setInteractive({ useHandCursor: true });
  audioBtn.on('pointerdown', () => {
    const on = toggleAudio();
    audioBtn.setText('SOUND: ' + (on ? 'ON' : 'OFF'));
    audioBtn.setColor(on ? '#44ff66' : '#888');
  });
}

function updateHUD_frame(scene) {
  const me = serverPlayers.find(p => p.id === myId);
  if (!me) return;

  const sw = scene.scale.width;
  const sh = scene.scale.height;

  // ── Health bar ───────────────────────────────────────────
  const hpPct = Math.max(0, me.hp / 200); // maxHp = 200
  const hpW = 276;
  hpBarFill.displayWidth = hpW * hpPct;
  hpBarFill.fillColor = hpPct > 0.5 ? 0x33cc55 : hpPct > 0.25 ? 0xffaa00 : 0xff3333;
  hpText.setText(Math.round(me.hp));

  // ── Boost bar ────────────────────────────────────────────
  const boostPct = (me.boost || 0) / 100;
  boostBarFill.displayWidth = 276 * boostPct;
  boostBarFill.fillColor = boostPct > 0.6 ? 0xff8800 : 0xffaa00;

  // ── Weapon slots ─────────────────────────────────────────
  const inv = me.inventory || {};
  const WEAPON_DISPLAY = { pistol: 'PISTOL', smg: 'SMG', shotgun: 'SHOTGUN', sniper: 'SNIPER', ar: 'AR', lmg: 'LMG', dmr: 'DMR' };
  const slotData = [inv.primary || '—', inv.secondary || '—', (inv.tactical || [])[0] || '—'];
  const slotNames = ['primary', 'secondary', 'tactical'];
  for (let i = 0; i < 3; i++) {
    const item = slotData[i];
    weaponSlots[i].icon.setText(item === '—' ? '—' : (WEAPON_DISPLAY[item] || item.toUpperCase()));
    const isActive = slotNames[i] === activeSlot;
    weaponSlots[i].bg.setStrokeStyle(isActive ? 2 : 1, isActive ? 0x44ff66 : 0x444466);
  }

  // ── Ammo counter ────────────────────────────────────────
  if (ammoText) {
    const activeWeaponId = inv[activeSlot];
    if (activeWeaponId && inv.magAmmo && activeSlot !== 'tactical') {
      const mag = inv.magAmmo[activeSlot] || 0;
      // Determine ammo type from weapon to show reserve
      const AMMO_TYPES = { pistol: '9mm', smg: '9mm', shotgun: '12gauge', sniper: '300', ar: '556', lmg: '762', dmr: '762' };
      const ammoType = AMMO_TYPES[activeWeaponId] || '';
      const reserve = (inv.ammo && inv.ammo[ammoType]) || 0;
      ammoText.setText(`${mag} / ${reserve}`);
      ammoText.setColor(mag === 0 ? '#ff3333' : '#ffcc44');
    } else {
      ammoText.setText('');
    }
  }

  // ── Reload progress bar ─────────────────────────────────
  if (reloadBarBg && reloadBarFill) {
    if (me.reloading) {
      reloadBarBg.setVisible(true);
      reloadBarFill.setVisible(true);
      // Estimate reload progress based on ticks
      const RELOAD_TIMES = { pistol: 1500, smg: 2000, shotgun: 2500, sniper: 3000, ar: 2200, lmg: 5000, dmr: 2500 };
      const activeWeaponId = inv[activeSlot];
      const reloadMs = (activeWeaponId && RELOAD_TIMES[activeWeaponId]) || 2000;
      const reloadTicks = Math.ceil((reloadMs / 1000) * 60);
      const ticksLeft = Math.max(0, (me.reloadEndTick || 0) - (serverTick || 0));
      const progress = Math.max(0, Math.min(1, 1 - ticksLeft / reloadTicks));
      reloadBarFill.displayWidth = 120 * progress;
    } else {
      reloadBarBg.setVisible(false);
      reloadBarFill.setVisible(false);
    }
  }

  // ── Armor display ───────────────────────────────────────
  if (armorText) {
    const vl = me.vestLevel || 0;
    const hl = me.helmetLevel || 0;
    let armorStr = '';
    if (vl > 0) armorStr += `V${vl} `;
    if (hl > 0) armorStr += `H${hl}`;
    armorText.setText(armorStr);
  }

  // ── Zone timer ───────────────────────────────────────────
  if (serverZone) {
    const z = serverZone;
    zoneTimerText.setText(`ZONE ${z.phase} — ${Math.ceil(z.timeLeft)}s`);
    zoneTimerText.setX(sw / 2);
  }

  // ── Player count + bot count (alive) ─────────────────────
  const alivePlayers = serverPlayers.filter(p => p.alive).length;
  const aliveBots = serverBots.length; // serverBots only contains alive bots
  const totalAlive = alivePlayers + aliveBots;
  playerCountText.setText(`${totalAlive} alive`);

  if (aliveCountText) {
    aliveCountText.setText(`Players: ${alivePlayers} | Bots: ${aliveBots}`);
  }

  // ── Kill feed decay ──────────────────────────────────────
  const now = Date.now();
  for (let i = killFeed.length - 1; i >= 0; i--) {
    if (now - killFeed[i].time > 5000) {
      killFeed[i].text.destroy();
      killFeed.splice(i, 1);
    }
  }
}

function addKillFeedEntry(scene, killerId, targetId) {
  const sw = scene.scale.width;
  const y = 50 + killFeed.length * 18;
  const msg = `${killerId.slice(0, 6)} → ${targetId.slice(0, 6)}`;
  const t = scene.add.text(sw - 16, y, msg, {
    fontSize: '11px', fill: '#ff6644', fontFamily: 'monospace',
    backgroundColor: '#00000066', padding: { x: 4, y: 2 },
  }).setScrollFactor(0).setDepth(200).setOrigin(1, 0);
  killFeed.push({ text: t, time: Date.now() });
}

// ═══════════════════════════════════════════════════════════════════
// Minimap
// ═══════════════════════════════════════════════════════════════════

function updateMinimap() {
  if (!minimapGfx || !mapData) return;
  minimapGfx.clear();
  const mmS = 150;
  const sw = activeScene.scale.width;
  const mmX = sw - mmS - 12, mmY = 40;
  const scale = mmS / (mapSize * TILE_PX);

  // Background
  minimapGfx.fillStyle(0x0a0a15, 0.75);
  minimapGfx.fillRoundedRect(mmX - 4, mmY - 4, mmS + 8, mmS + 8, 6);

  // Zone circles
  if (serverZone) {
    minimapGfx.lineStyle(1.5, 0x3399ff, 0.7);
    minimapGfx.strokeCircle(mmX + serverZone.current.x * scale, mmY + serverZone.current.y * scale, serverZone.current.radius * scale);
    if (serverZone.next.radius < serverZone.current.radius) {
      minimapGfx.lineStyle(1, 0xffffff, 0.35);
      minimapGfx.strokeCircle(mmX + serverZone.next.x * scale, mmY + serverZone.next.y * scale, serverZone.next.radius * scale);
    }
  }

  // Bots (tiny red dots — only visible ones)
  minimapGfx.fillStyle(0xff3344, 0.5);
  for (const b of serverBots) {
    if (isInPlayerLOS(b.x, b.y)) {
      minimapGfx.fillCircle(mmX + b.x * scale, mmY + b.y * scale, 1.2);
    }
  }

  // Other players
  minimapGfx.fillStyle(0x4488ff, 1);
  for (const p of serverPlayers) {
    if (p.id !== myId && p.alive) {
      minimapGfx.fillCircle(mmX + p.x * scale, mmY + p.y * scale, 2.5);
    }
  }

  // Self
  minimapGfx.fillStyle(0x44ff88, 1);
  minimapGfx.fillCircle(mmX + predictedX * scale, mmY + predictedY * scale, 3);

  // Border
  minimapGfx.lineStyle(1, 0x444466, 0.6);
  minimapGfx.strokeRoundedRect(mmX - 4, mmY - 4, mmS + 8, mmS + 8, 6);
}

// ═══════════════════════════════════════════════════════════════════
// Death screen
// ═══════════════════════════════════════════════════════════════════

function showDeathScreen(scene) {
  if (isShowingDeathScreen) return;
  isShowingDeathScreen = true;
  const sw = scene.scale.width, sh = scene.scale.height;
  const D = 300;

  // Dark overlay
  deathOverlay = scene.add.rectangle(sw/2, sh/2, sw, sh, 0x000000, 0.75)
    .setScrollFactor(0).setDepth(D);

  const elements = [];

  // "YOU DIED" text
  const title = scene.add.text(sw/2, sh/2 - 60, 'YOU DIED', {
    fontSize: '48px', fill: '#ff3333', fontFamily: 'monospace', fontStyle: 'bold',
  }).setScrollFactor(0).setDepth(D+1).setOrigin(0.5);
  elements.push(title);

  // Stats
  const survivalTime = Math.floor((Date.now() - gameStartTime) / 1000);
  const mins = Math.floor(survivalTime / 60);
  const secs = survivalTime % 60;
  const statsText = scene.add.text(sw/2, sh/2 + 10,
    `Kills: ${clientKills}  |  Survived: ${mins}m ${secs}s`, {
    fontSize: '16px', fill: '#cccccc', fontFamily: 'monospace',
  }).setScrollFactor(0).setDepth(D+1).setOrigin(0.5);
  elements.push(statsText);

  // Spectate prompt
  const respawn = scene.add.text(sw/2, sh/2 + 60, 'GAME OVER — NEW MATCH STARTING SOON', {
    fontSize: '14px', fill: '#aaaaaa', fontFamily: 'monospace',
  }).setScrollFactor(0).setDepth(D+1).setOrigin(0.5);
  scene.tweens.add({
    targets: respawn, alpha: { from: 0.4, to: 1 }, duration: 600, yoyo: true, repeat: -1,
  });
  elements.push(respawn);

  deathElements = elements;
}

function hideDeathScreen() {
  if (!isShowingDeathScreen) return;
  isShowingDeathScreen = false;
  if (deathOverlay) { deathOverlay.destroy(); deathOverlay = null; }
  for (const el of deathElements) el.destroy();
  deathElements = [];
}

// ═══════════════════════════════════════════════════════════════════
// Leaderboard
// ═══════════════════════════════════════════════════════════════════

function updateLeaderboard(scene) {
  // Clean up old elements
  if (leaderboardPanel) { leaderboardPanel.destroy(); leaderboardPanel = null; }
  for (const t of leaderboardTexts) t.destroy();
  leaderboardTexts = [];

  if (!leaderboardVisible || serverLeaderboard.length === 0) return;

  const sw = scene.scale.width, sh = scene.scale.height;
  const D = 250;
  const panelW = 260, panelH = 30 + serverLeaderboard.length * 22;

  leaderboardPanel = scene.add.rectangle(sw/2, sh/2, panelW, panelH, 0x0a0a1a, 0.9)
    .setScrollFactor(0).setDepth(D).setStrokeStyle(1, 0x444466);

  const title = scene.add.text(sw/2, sh/2 - panelH/2 + 12, 'LEADERBOARD', {
    fontSize: '12px', fill: '#aaddff', fontFamily: 'monospace', fontStyle: 'bold',
  }).setScrollFactor(0).setDepth(D+1).setOrigin(0.5);
  leaderboardTexts.push(title);

  serverLeaderboard.forEach((entry, i) => {
    const isMe = entry.id === myId;
    const name = entry.id.slice(0, 8);
    const line = `${i+1}. ${name}  ${entry.kills} kills`;
    const t = scene.add.text(sw/2 - panelW/2 + 16, sh/2 - panelH/2 + 30 + i * 22, line, {
      fontSize: '11px', fill: isMe ? '#44ff66' : '#cccccc', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(D+1);
    leaderboardTexts.push(t);
  });
}

// ═══════════════════════════════════════════════════════════════════
// window.__game API (preserved for playtesting)
// ═══════════════════════════════════════════════════════════════════

window.__game = {
  state() {
    const me = serverPlayers.find(p => p.id === myId);
    const nearbyBots = serverBots
      .map(b => ({ ...b, dist: Math.round(Math.hypot(b.x - predictedX, b.y - predictedY)) }))
      .sort((a, b) => a.dist - b.dist).slice(0, 20);
    return {
      connected, myId,
      player: me ? { x: Math.round(predictedX), y: Math.round(predictedY), hp: me.hp, alive: me.alive, inventory: me.inventory } : null,
      nearbyBots, totalBots: serverBots.length,
      players: serverPlayers.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, alive: p.alive })),
      zone: serverZone, tick: serverTick,
    };
  },
  sendInput(keys, angle) {
    if (!channel || !connected) return;
    const inp = { seq: ++inputSeq, keys: { w: false, a: false, s: false, d: false, shift: false, ctrl: false, ...keys }, angle: angle || 0 };
    applyInput(inp, 1 / 60); pendingInputs.push(inp);
    channel.emit('input', inp);
  },
  moveTo(x, y) {
    const dx = x - predictedX, dy = y - predictedY;
    if (Math.hypot(dx, dy) < 10) { this.sendInput({ w: false, a: false, s: false, d: false }, 0); return false; }
    const moveAngle = Math.atan2(dy, dx);
    const useAngle = (this._engageTime && Date.now() - this._engageTime < 500) ? this._engageAngle : moveAngle;
    this.sendInput({ w: dy < -10, s: dy > 10, a: dx < -10, d: dx > 10 }, useAngle);
    return true;
  },
  shoot(x, y) {
    if (!channel || !connected) return;
    // Pixel-level LOS check — don't shoot through walls
    if (!hasDirectLOS(predictedX, predictedY, x, y)) return;
    const angle = Math.atan2(y - predictedY, x - predictedX);
    channel.emit('fire', { angle, slot: activeSlot, latency });
    // Track engagement angle so moveTo doesn't override facing
    this._engageAngle = angle;
    this._engageTime = Date.now();
  },
  shootNearest() {
    let nearest = null, minD = Infinity;
    for (const b of serverBots) {
      const d = Math.hypot(b.x - predictedX, b.y - predictedY);
      if (d < minD && hasDirectLOS(predictedX, predictedY, b.x, b.y)) { minD = d; nearest = b; }
    }
    if (nearest && minD < 500) { this.shoot(nearest.x, nearest.y); return true; }
    return false;
  },
  dodge() {
    let nearest = null, minD = Infinity;
    for (const b of serverBots) { const d = Math.hypot(b.x - predictedX, b.y - predictedY); if (d < minD) { minD = d; nearest = b; } }
    if (nearest && minD < 200) { this.moveTo(predictedX + (predictedX - nearest.x), predictedY + (predictedY - nearest.y)); return true; }
    return false;
  },
  pickup() { const n = findNearestLoot(); if (n) { channel.emit('pickup', { lootId: n.id }); return true; } return false; },
  _autoInterval: null,
  autoPlay(enabled) {
    if (!enabled) { if (this._autoInterval) clearInterval(this._autoInterval); this._autoInterval = null; return 'OFF'; }
    this._autoInterval = setInterval(() => {
      if (!connected) return;
      const s = this.state();
      if (!s.player) return;
      if (!s.player.alive) {
        // Auto-respawn
        channel.emit('input', { seq: ++inputSeq, keys: {w:false,a:false,s:false,d:false}, angle: 0 });
        return;
      }

      // 1. Zone check — if outside zone, prioritize getting inside
      if (s.zone) {
        const dx = s.player.x - s.zone.current.x;
        const dy = s.player.y - s.zone.current.y;
        const distToCenter = Math.sqrt(dx*dx + dy*dy);
        if (distToCenter > s.zone.current.radius * 0.9) {
          // Outside or near edge of zone — move toward center
          this.moveTo(s.zone.current.x, s.zone.current.y);
          return;
        }
      }

      // 2. Health management — use consumables when hurt
      if (s.player.hp < 60 && s.player.inventory.consumables.length > 0) {
        channel.emit('use_item', { slot: 'consumable', index: 0 });
      }

      // 3. Tactical retreat — if low HP, flee from enemies
      if (s.player.hp < 30) {
        const retreated = this.dodge();
        if (retreated) return;
      }

      // 4. Pickup nearby loot (always try)
      this.pickup();

      // 5. Target assessment — prefer low HP bots (easier kills)
      let target = null;
      let bestScore = Infinity;
      for (const b of s.nearbyBots) {
        if (b.dist > 500) continue;
        // Only target bots with clear line of fire
        if (!hasDirectLOS(predictedX, predictedY, b.x, b.y)) continue;
        // Score: lower is better. Prefer close + low HP targets
        const score = b.dist * (b.hp / 100);
        if (score < bestScore) { bestScore = score; target = b; }
      }

      // 6. Combat — shoot best target
      if (target && target.dist < 400) {
        this.shoot(target.x, target.y);
        // Strafe while shooting (don't stand still)
        if (target.dist < 200) {
          this.dodge();
        }
      }

      // 7. If nothing else, move toward zone center or patrol
      if (!target && s.zone) {
        this.moveTo(s.zone.current.x, s.zone.current.y);
      }

    }, 50); // 50ms update rate (was 100ms)
    return 'ON';
  },
};

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#000000',
  pixelArt: true,  // nearest-neighbor scaling for all sprites
  disableVisibilityChange: true,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
  scene: { preload, create, update },
};

const game = new Phaser.Game(config);
