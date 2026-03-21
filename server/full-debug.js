// Full game debug — simulates 2 players doing everything and checks all systems
import { io } from 'socket.io-client';
const URL = 'http://localhost:3000';
const TILE_PX = 48;
const ISSUES = [];
const PASSED = [];

function issue(msg) { ISSUES.push(msg); console.log(`  ✗ ${msg}`); }
function pass(msg) { PASSED.push(msg); console.log(`  ✓ ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function connect(label) {
  return new Promise((resolve, reject) => {
    const socket = io(URL);
    const p = { label, socket, id: null, init: null, lastState: null, stateCount: 0, _seq: 0 };
    socket.on('init', data => { p.init = data; p.id = data.playerId; resolve(p); });
    setTimeout(() => reject(new Error(`${label} timeout`)), 5000);
    socket.on('state', data => { p.stateCount++; p.lastState = data; });
  });
}

function getMe(p) {
  if (!p.lastState) return p.init.playerState;
  return p.lastState.players.find(pl => pl.id === p.id);
}

function sendInput(p, keys, angle = 0) {
  p.socket.emit('input', {
    seq: ++p._seq,
    keys: { w: false, a: false, s: false, d: false, shift: false, ctrl: false, ...keys },
    angle,
  });
}

async function waitStates(p, n) {
  const start = p.stateCount;
  while (p.stateCount < start + n) await sleep(20);
}

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  FULL GAME DEBUG SUITE');
  console.log('══════════════════════════════════════════\n');

  const p1 = await connect('P1');
  const p2 = await connect('P2');

  // ═══════════════════════════════════════
  // 1. SPAWN VALIDATION
  // ═══════════════════════════════════════
  console.log('── 1. SPAWN ──');
  const map = p1.init.map, sz = p1.init.mapSize;

  // Check player spawn
  for (const p of [p1, p2]) {
    const ps = p.init.playerState;
    const tx = Math.floor(ps.x / TILE_PX), ty = Math.floor(ps.y / TILE_PX);
    const tile = map[ty * sz + tx];
    if (tile === 1 || tile === 3 || tile === 5) pass(`${p.label} spawned on walkable tile ${tile}`);
    else issue(`${p.label} spawned on tile ${tile} at (${tx},${ty})`);
    if (ps.alive) pass(`${p.label} alive on spawn`);
    else issue(`${p.label} dead on spawn`);
    if (ps.hp === 100) pass(`${p.label} HP=100`);
    else issue(`${p.label} HP=${ps.hp} (expected 100)`);
  }

  // Check starting inventory
  const inv = p1.init.playerState.inventory;
  if (inv.primary === 'pistol') pass('Starting weapon: pistol');
  else issue(`Starting weapon: ${inv.primary} (expected pistol)`);
  if (inv.ammo?.['9mm'] >= 30) pass(`Starting ammo: ${inv.ammo['9mm']} 9mm`);
  else issue(`Starting ammo: ${JSON.stringify(inv.ammo)}`);
  if (inv.magAmmo?.primary === 15) pass('Starting mag: 15');
  else issue(`Starting mag: ${inv.magAmmo?.primary}`);

  // Check all bots spawned on walkable
  let badBots = 0;
  for (const b of p1.init.bots) {
    const tx = Math.floor(b.x / TILE_PX), ty = Math.floor(b.y / TILE_PX);
    if (map[ty * sz + tx] !== 1 && map[ty * sz + tx] !== 3 && map[ty * sz + tx] !== 5) badBots++;
  }
  if (badBots === 0) pass('All 100 bots on walkable tiles');
  else issue(`${badBots} bots on non-walkable tiles`);

  // Check all loot on walkable
  let badLoot = 0;
  for (const l of p1.init.loot) {
    const tx = Math.floor(l.x / TILE_PX), ty = Math.floor(l.y / TILE_PX);
    if (map[ty * sz + tx] !== 1 && map[ty * sz + tx] !== 3 && map[ty * sz + tx] !== 5) badLoot++;
  }
  if (badLoot === 0) pass(`All ${p1.init.loot.length} loot on walkable tiles`);
  else issue(`${badLoot} loot on non-walkable tiles`);

  // Check wall heights
  let wallViolations = 0;
  for (let r = 1; r < sz - 1; r++) {
    for (let c = 0; c < sz; c++) {
      if (map[r*sz+c] !== 0) continue;
      if (map[(r+1)*sz+c] === 0) continue;
      if (map[(r-1)*sz+c] !== 0) wallViolations++;
    }
  }
  if (wallViolations === 0) pass('All walls ≥2 tiles tall');
  else issue(`${wallViolations} single-height walls`);

  // ═══════════════════════════════════════
  // 2. MOVEMENT
  // ═══════════════════════════════════════
  console.log('\n── 2. MOVEMENT ──');
  await waitStates(p1, 5);

  // Normal movement
  const startX = getMe(p1).x;
  for (let i = 0; i < 30; i++) { sendInput(p1, { d: true }); await sleep(16); }
  await waitStates(p1, 5);
  const normalDist = Math.abs(getMe(p1).x - startX);
  if (normalDist > 30) pass(`Normal move: ${Math.round(normalDist)}px`);
  else issue(`Normal move too slow: ${Math.round(normalDist)}px`);

  // Sprint
  const sprintStart = getMe(p1).x;
  for (let i = 0; i < 30; i++) { sendInput(p1, { d: true, shift: true }); await sleep(16); }
  await waitStates(p1, 5);
  const sprintDist = Math.abs(getMe(p1).x - sprintStart);
  if (sprintDist > normalDist * 1.2) pass(`Sprint faster: ${Math.round(sprintDist)}px vs normal ${Math.round(normalDist)}px`);
  else issue(`Sprint not faster: ${Math.round(sprintDist)}px vs normal ${Math.round(normalDist)}px`);

  // Crouch
  const crouchStart = getMe(p1).x;
  for (let i = 0; i < 30; i++) { sendInput(p1, { d: true, ctrl: true }); await sleep(16); }
  await waitStates(p1, 5);
  const crouchDist = Math.abs(getMe(p1).x - crouchStart);
  if (crouchDist < normalDist * 0.8) pass(`Crouch slower: ${Math.round(crouchDist)}px`);
  else issue(`Crouch not slower: ${Math.round(crouchDist)}px vs normal ${Math.round(normalDist)}px`);

  // ═══════════════════════════════════════
  // 3. COMBAT
  // ═══════════════════════════════════════
  console.log('\n── 3. COMBAT ──');

  // Fire at angle 0 and check mag decreases
  const magBefore = getMe(p1).inventory?.magAmmo?.primary;
  p1.socket.emit('fire', { angle: 0, slot: 'primary', latency: 0 });
  await sleep(350); // wait for fire rate
  p1.socket.emit('fire', { angle: 0, slot: 'primary', latency: 0 });
  await waitStates(p1, 5);
  const magAfter = getMe(p1).inventory?.magAmmo?.primary;
  if (magBefore !== undefined && magAfter < magBefore) pass(`Ammo decreased: ${magBefore}→${magAfter}`);
  else issue(`Ammo not decreasing: ${magBefore}→${magAfter}`);

  // Fire rate limiting
  const magPre = getMe(p1).inventory?.magAmmo?.primary;
  for (let i = 0; i < 10; i++) {
    p1.socket.emit('fire', { angle: 0, slot: 'primary', latency: 0 });
    await sleep(10); // 10ms — too fast for any weapon
  }
  await waitStates(p1, 3);
  const magPost = getMe(p1).inventory?.magAmmo?.primary;
  const firedCount = (magPre || 0) - (magPost || 0);
  if (firedCount <= 2) pass(`Fire rate limited: only ${firedCount} shots from 10 rapid attempts`);
  else issue(`Fire rate not limited: ${firedCount} shots from 10 rapid attempts`);

  // ═══════════════════════════════════════
  // 4. RELOAD
  // ═══════════════════════════════════════
  console.log('\n── 4. RELOAD ──');

  // Empty the magazine
  for (let i = 0; i < 20; i++) {
    p1.socket.emit('fire', { angle: 0, slot: 'primary', latency: 0 });
    await sleep(100);
  }
  await waitStates(p1, 3);
  const magEmpty = getMe(p1).inventory?.magAmmo?.primary;
  console.log(`  Mag after firing: ${magEmpty}`);

  // Reload
  p1.socket.emit('reload');
  await sleep(100);
  await waitStates(p1, 3);
  const reloading = getMe(p1).reloading;
  if (reloading) pass('Reload started');
  else issue('Reload did not start');

  await sleep(2000); // wait for reload
  await waitStates(p1, 3);
  const magReloaded = getMe(p1).inventory?.magAmmo?.primary;
  const reloadingAfter = getMe(p1).reloading;
  if (magReloaded > (magEmpty || 0)) pass(`Reload complete: mag=${magReloaded}`);
  else issue(`Reload failed: mag still ${magReloaded}`);
  if (!reloadingAfter) pass('Reload flag cleared');
  else issue('Still showing as reloading');

  // ═══════════════════════════════════════
  // 5. MULTIPLAYER SYNC
  // ═══════════════════════════════════════
  console.log('\n── 5. MULTIPLAYER SYNC ──');

  await waitStates(p2, 3);
  const p1InP2 = p2.lastState.players.find(pl => pl.id === p1.id);
  const p2InP1 = p1.lastState.players.find(pl => pl.id === p2.id);
  if (p1InP2) pass('P2 sees P1');
  else issue('P2 cannot see P1');
  if (p2InP1) pass('P1 sees P2');
  else issue('P1 cannot see P2');

  if (p1InP2 && p2InP1) {
    const drift = Math.abs(p1InP2.x - getMe(p1).x);
    if (drift < 100) pass(`Position sync: ${Math.round(drift)}px drift`);
    else issue(`Large position drift: ${Math.round(drift)}px`);
  }

  // Both see same bot count
  if (p1.lastState.bots.length === p2.lastState.bots.length) {
    pass(`Both see ${p1.lastState.bots.length} bots`);
  } else {
    issue(`Bot count mismatch: P1=${p1.lastState.bots.length} P2=${p2.lastState.bots.length}`);
  }

  // ═══════════════════════════════════════
  // 6. BOT AI
  // ═══════════════════════════════════════
  console.log('\n── 6. BOT AI ──');

  // Wait 3 seconds for bots to do things
  await sleep(3000);
  await waitStates(p1, 5);

  const states = {};
  const bots = p1.lastState.bots;
  bots.forEach(b => states[b.state] = (states[b.state] || 0) + 1);
  const armed = bots.filter(b => b.weapon).length;
  const alive = bots.length;

  console.log(`  Alive: ${alive}/100, Armed: ${armed}`);
  console.log(`  States: ${JSON.stringify(states)}`);

  if (alive < 100) pass(`Bots killing each other: ${100 - alive} dead`);
  else issue('No bots have died');

  if (states.FIGHT > 0) pass(`${states.FIGHT} bots in FIGHT state`);
  else issue('No bots fighting');

  if (armed > alive * 0.5) pass(`${armed}/${alive} bots armed`);
  else issue(`Only ${armed}/${alive} bots armed`);

  if ((states.IDLE || 0) < alive * 0.5) pass('Less than 50% idle');
  else issue(`Too many idle: ${states.IDLE}/${alive}`);

  // ═══════════════════════════════════════
  // 7. LOOT PICKUP
  // ═══════════════════════════════════════
  console.log('\n── 7. LOOT PICKUP ──');

  // Move P2 toward nearest loot
  const loot = p2.init.loot.filter(l => !l.pickedUp);
  const nearestLoot = loot.sort((a, b) =>
    Math.hypot(a.x - getMe(p2).x, a.y - getMe(p2).y) -
    Math.hypot(b.x - getMe(p2).x, b.y - getMe(p2).y)
  )[0];

  if (nearestLoot) {
    const dist = Math.hypot(nearestLoot.x - getMe(p2).x, nearestLoot.y - getMe(p2).y);
    console.log(`  Nearest loot: ${nearestLoot.itemId} at ${Math.round(dist)}px`);

    // Move toward it for 2 seconds
    for (let i = 0; i < 120; i++) {
      const me = getMe(p2);
      const dx = nearestLoot.x - me.x, dy = nearestLoot.y - me.y;
      sendInput(p2, { w: dy < -5, s: dy > 5, a: dx < -5, d: dx > 5 });
      await sleep(16);
    }
    // Try pickup
    p2.socket.emit('pickup', { lootId: nearestLoot.id });
    await waitStates(p2, 3);
    const me2 = getMe(p2);
    console.log(`  P2 after pickup: primary=${me2.inventory?.primary}, secondary=${me2.inventory?.secondary}`);
    pass('Loot pickup attempted');
  } else {
    issue('No loot found');
  }

  // ═══════════════════════════════════════
  // 8. DISCONNECT/RECONNECT
  // ═══════════════════════════════════════
  console.log('\n── 8. DISCONNECT/RECONNECT ──');

  p2.socket.disconnect();
  await sleep(500);

  const p2r = await connect('P2-Reconnect');
  await waitStates(p2r, 3);
  if (p2r.id) pass(`Reconnected as ${p2r.id}`);
  else issue('Reconnect failed');

  const reconnPlayers = p2r.lastState.players.length;
  if (reconnPlayers >= 2) pass(`Sees ${reconnPlayers} players after reconnect`);
  else issue(`Only ${reconnPlayers} players after reconnect`);

  // ═══════════════════════════════════════
  // 9. ZONE
  // ═══════════════════════════════════════
  console.log('\n── 9. ZONE ──');
  const zone = p1.lastState.zone || p1.init.zone;
  if (zone && zone.current) {
    pass(`Zone active: center=(${Math.round(zone.current.x)},${Math.round(zone.current.y)}) r=${Math.round(zone.current.radius)}`);
  } else {
    issue('No zone data');
  }

  // ═══════════════════════════════════════
  // 10. GAME STATE INTEGRITY
  // ═══════════════════════════════════════
  console.log('\n── 10. INTEGRITY ──');

  // Check no negative HP bots in broadcast (dead bots should be filtered)
  const negHpBots = p1.lastState.bots.filter(b => b.hp <= 0).length;
  if (negHpBots === 0) pass('No dead bots in broadcast');
  else issue(`${negHpBots} dead bots in broadcast`);

  // Check tick is advancing
  const tick1 = p1.lastState.tick;
  await sleep(500);
  await waitStates(p1, 5);
  const tick2 = p1.lastState.tick;
  if (tick2 > tick1) pass(`Tick advancing: ${tick1}→${tick2}`);
  else issue(`Tick stuck: ${tick1}→${tick2}`);

  // ═══════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log(`  PASSED: ${PASSED.length}`);
  console.log(`  FAILED: ${ISSUES.length}`);
  if (ISSUES.length > 0) {
    console.log('\n  ISSUES:');
    ISSUES.forEach(i => console.log(`    ✗ ${i}`));
  }
  console.log('══════════════════════════════════════════\n');

  p1.socket.disconnect();
  p2r.socket.disconnect();
  await sleep(500);
  process.exit(ISSUES.length > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
