// Multiplayer simulation — 2 simulated human players playing a full game
// Tests all network synchronization, combat, looting, healing, reload, sprint
// Run: node server/multiplayer-test.js

import { io } from 'socket.io-client';
const URL = 'http://localhost:3000';

const ISSUES = [];
function issue(msg) { ISSUES.push(msg); console.log(`  ⚠ ISSUE: ${msg}`); }

function connect(label) {
  return new Promise((resolve, reject) => {
    const socket = io(URL);
    const p = {
      label, socket, id: null, x: 0, y: 0, hp: 100, alive: true,
      init: null, lastState: null, stateCount: 0, events: [],
      inventory: null, ammo: null, magAmmo: null, boost: 0,
      vest: null, helmet: null, reloading: false,
    };
    socket.on('connect', () => console.log(`[${label}] connected: ${socket.id}`));
    socket.on('init', data => {
      p.init = data;
      p.id = data.playerId;
      p.x = data.playerState.x;
      p.y = data.playerState.y;
      p.inventory = data.playerState.inventory;
      p.ammo = data.playerState.ammo;
      p.magAmmo = data.playerState.magAmmo;
      resolve(p);
    });
    socket.on('state', data => {
      p.stateCount++;
      p.lastState = data;
      const me = data.players.find(pl => pl.id === p.id);
      if (me) {
        p.x = me.x; p.y = me.y; p.hp = me.hp; p.alive = me.alive;
        p.inventory = me.inventory;
        p.ammo = me.inventory?.ammo;
        p.magAmmo = me.inventory?.magAmmo;
        p.boost = me.boost;
        p.vestLevel = me.vestLevel;
        p.helmetLevel = me.helmetLevel;
        p.reloading = me.reloading;
      }
    });
    socket.on('disconnect', () => console.log(`[${label}] disconnected`));
    setTimeout(() => reject(new Error(`${label} timeout`)), 5000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sendInput(p, keys, angle = 0) {
  p.socket.emit('input', {
    seq: ++p._seq || (p._seq = 1),
    keys: { w: false, a: false, s: false, d: false, shift: false, ctrl: false, ...keys },
    angle,
  });
}

async function waitStates(p, n) {
  const start = p.stateCount;
  while (p.stateCount < start + n) await sleep(50);
}

// ═════════════════════════════════════════════════════════════
// SIMULATION
// ═════════════════════════════════════════════════════════════

async function run() {
  console.log('\n=== MULTIPLAYER SIMULATION ===\n');

  // Connect 2 players
  const p1 = await connect('Player1');
  const p2 = await connect('Player2');
  console.log(`[Player1] spawned at (${Math.round(p1.x)}, ${Math.round(p1.y)})`);
  console.log(`[Player2] spawned at (${Math.round(p2.x)}, ${Math.round(p2.y)})`);

  // ── TEST 1: Both players appear in state updates ──
  console.log('\n--- Test 1: Multiplayer state sync ---');
  await waitStates(p1, 3);
  const p1State = p1.lastState;
  const p2InP1 = p1State.players.find(p => p.id === p2.id);
  const p1InP1 = p1State.players.find(p => p.id === p1.id);
  if (!p2InP1) issue('Player2 not visible to Player1');
  if (!p1InP1) issue('Player1 not in own state');
  if (p1State.players.length < 2) issue(`Only ${p1State.players.length} players in state`);
  console.log(`  Players in state: ${p1State.players.length}`);
  console.log(`  Bots in state: ${p1State.bots.length}`);
  console.log(`  Tick: ${p1State.tick}`);

  // ── TEST 2: Movement sync ──
  console.log('\n--- Test 2: Movement synchronization ---');
  const startX1 = p1.x;
  for (let i = 0; i < 60; i++) {
    sendInput(p1, { d: true }); // move right
    sendInput(p2, { w: true }); // move up
    await sleep(16);
  }
  await waitStates(p1, 5);
  const movedX1 = Math.abs(p1.x - startX1);
  console.log(`  P1 moved ${Math.round(movedX1)}px right`);
  if (movedX1 < 20) issue('Player1 barely moved');

  // Check P2 sees P1's new position
  const p1InP2State = p2.lastState.players.find(p => p.id === p1.id);
  if (p1InP2State) {
    const drift = Math.abs(p1InP2State.x - p1.x);
    console.log(`  P2 sees P1 at x=${Math.round(p1InP2State.x)} (drift: ${Math.round(drift)}px)`);
    if (drift > 50) issue(`Large position drift: ${drift}px`);
  }

  // ── TEST 3: Sprint ──
  console.log('\n--- Test 3: Sprint ---');
  const sprintStart = p1.x;
  for (let i = 0; i < 30; i++) {
    sendInput(p1, { d: true, shift: true });
    await sleep(16);
  }
  await waitStates(p1, 3);
  const sprintDist = Math.abs(p1.x - sprintStart);
  console.log(`  Sprint distance: ${Math.round(sprintDist)}px in 30 frames`);

  // ── TEST 4: Crouch ──
  console.log('\n--- Test 4: Crouch ---');
  const crouchStart = p1.x;
  for (let i = 0; i < 30; i++) {
    sendInput(p1, { d: true, ctrl: true });
    await sleep(16);
  }
  await waitStates(p1, 3);
  const crouchDist = Math.abs(p1.x - crouchStart);
  console.log(`  Crouch distance: ${Math.round(crouchDist)}px in 30 frames`);
  if (crouchDist >= sprintDist) issue('Crouch not slower than sprint');

  // ── TEST 5: Inventory check ──
  console.log('\n--- Test 5: Starting inventory ---');
  console.log(`  P1 weapon: ${p1.inventory?.primary || 'none'}`);
  console.log(`  P1 ammo: ${JSON.stringify(p1.ammo || {})}`);
  console.log(`  P1 magAmmo: ${JSON.stringify(p1.magAmmo || {})}`);
  console.log(`  P1 vest: L${p1.vestLevel || 0}, helmet: L${p1.helmetLevel || 0}`);
  if (!p1.inventory?.primary) issue('No starting weapon');

  // ── TEST 6: Fire and ammo deduction ──
  console.log('\n--- Test 6: Firing and ammo ---');
  const magBefore = p1.magAmmo?.primary ?? -1;
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  p1.socket.emit('fire', { angle, slot: 'primary', latency: 0 });
  await sleep(100);
  p1.socket.emit('fire', { angle, slot: 'primary', latency: 0 });
  await sleep(100);
  p1.socket.emit('fire', { angle, slot: 'primary', latency: 0 });
  await waitStates(p1, 5);
  const magAfter = p1.magAmmo?.primary ?? -1;
  console.log(`  Mag before: ${magBefore}, after: ${magAfter}`);
  if (magBefore >= 0 && magAfter >= magBefore) issue('Ammo not decreasing after fire');

  // ── TEST 7: Reload ──
  console.log('\n--- Test 7: Reload ---');
  // Empty the mag by firing
  for (let i = 0; i < 20; i++) {
    p1.socket.emit('fire', { angle: 0, slot: 'primary', latency: 0 });
    await sleep(50);
  }
  await waitStates(p1, 3);
  console.log(`  Mag after emptying: ${p1.magAmmo?.primary}`);

  p1.socket.emit('reload');
  await sleep(200);
  await waitStates(p1, 3);
  console.log(`  Reloading: ${p1.reloading}`);

  // Wait for reload to complete
  await sleep(2000);
  await waitStates(p1, 3);
  console.log(`  Mag after reload: ${p1.magAmmo?.primary}`);
  console.log(`  Still reloading: ${p1.reloading}`);

  // ── TEST 8: Pickup loot ──
  console.log('\n--- Test 8: Loot pickup ---');
  // Find nearest loot to P2
  if (p2.lastState) {
    const lootCount = p2.init.loot.filter(l => !l.pickedUp).length;
    console.log(`  Total loot on map: ${lootCount}`);

    // Try to pick up nearest loot
    const nearLoot = p2.init.loot.find(l => {
      if (l.pickedUp) return false;
      const d = Math.hypot(l.x - p2.x, l.y - p2.y);
      return d < 200;
    });
    if (nearLoot) {
      console.log(`  Attempting pickup: ${nearLoot.itemId} at dist ${Math.round(Math.hypot(nearLoot.x - p2.x, nearLoot.y - p2.y))}`);
      // Move toward it
      const lootAngle = Math.atan2(nearLoot.y - p2.y, nearLoot.x - p2.x);
      for (let i = 0; i < 60; i++) {
        sendInput(p2, {
          w: lootAngle < -0.3, s: lootAngle > 0.3,
          a: Math.abs(lootAngle) > Math.PI * 0.6,
          d: Math.abs(lootAngle) < Math.PI * 0.4,
        }, lootAngle);
        await sleep(16);
      }
      p2.socket.emit('pickup', { lootId: nearLoot.id });
      await waitStates(p2, 3);
      console.log(`  P2 inventory after pickup: primary=${p2.inventory?.primary}, secondary=${p2.inventory?.secondary}`);
    } else {
      console.log('  No loot within 200px');
    }
  }

  // ── TEST 9: Use consumable ──
  console.log('\n--- Test 9: Use consumable ---');
  const consumables = p1.inventory?.consumables || [];
  console.log(`  P1 consumables: ${JSON.stringify(consumables)}`);
  if (consumables.length > 0) {
    p1.socket.emit('use_item', { slot: 'consumable', index: 0 });
    await sleep(500);
    await waitStates(p1, 3);
    console.log(`  P1 HP after use: ${p1.hp}`);
  }

  // ── TEST 10: Bot combat is happening ──
  console.log('\n--- Test 10: Bot free-for-all ---');
  await sleep(2000);
  await waitStates(p1, 5);
  const botStates = {};
  let deadBots = 0;
  for (const b of p1.lastState.bots) {
    botStates[b.state] = (botStates[b.state] || 0) + 1;
    if (b.hp <= 0) deadBots++;
  }
  console.log(`  Bot states: ${JSON.stringify(botStates)}`);
  console.log(`  Dead bots: ${deadBots}`);
  const totalAlive = p1.lastState.bots.filter(b => b.hp > 0).length + p1.lastState.players.filter(p => p.alive).length;
  console.log(`  Total alive: ${totalAlive}`);
  // Only 'alive' bots are broadcast, so count < 100 means bots have died
  const totalBotsAlive = p1.lastState.bots.length;
  console.log(`  Bots alive (of 100 spawned): ${totalBotsAlive}`);
  if (totalBotsAlive >= 100) issue('No bots have died — combat may not be working');

  // ── TEST 11: Disconnect and reconnect ──
  console.log('\n--- Test 11: Disconnect/reconnect ---');
  p2.socket.disconnect();
  await sleep(500);
  const p2r = await connect('Player2-Reconnect');
  await waitStates(p2r, 3);
  console.log(`  Reconnected as ${p2r.id}`);
  console.log(`  Sees ${p2r.lastState.players.length} players, ${p2r.lastState.bots.length} bots`);
  if (p2r.lastState.players.length < 2) issue('Reconnected player lost other player');

  // ── TEST 12: Simultaneous fire from both players ──
  console.log('\n--- Test 12: Simultaneous combat ---');
  const p1HpBefore = p1.hp;
  const p2rHpBefore = p2r.hp;
  // Both players fire at each other
  const a12 = Math.atan2(p2r.y - p1.y, p2r.x - p1.x);
  const a21 = Math.atan2(p1.y - p2r.y, p1.x - p2r.x);
  for (let i = 0; i < 10; i++) {
    p1.socket.emit('fire', { angle: a12, slot: 'primary', latency: 0 });
    p2r.socket.emit('fire', { angle: a21, slot: 'primary', latency: 0 });
    await sleep(100);
  }
  await waitStates(p1, 5);
  await waitStates(p2r, 5);
  console.log(`  P1 HP: ${p1HpBefore} → ${p1.hp}`);
  console.log(`  P2 HP: ${p2rHpBefore} → ${p2r.hp}`);

  // ── TEST 13: Armor state sync ──
  console.log('\n--- Test 13: Armor sync ---');
  console.log(`  P1 vest: L${p1.vestLevel || 0}, helmet: L${p1.helmetLevel || 0}`);
  console.log(`  P2 vest: L${p2r.vestLevel || 0}, helmet: L${p2r.helmetLevel || 0}`);

  // ── TEST 14: Boost bar sync ──
  console.log('\n--- Test 14: Boost sync ---');
  console.log(`  P1 boost: ${p1.boost}`);
  console.log(`  P2 boost: ${p2r.boost}`);

  // ── SUMMARY ──
  console.log('\n═══════════════════════════════════════');
  console.log(`  Tests complete. Issues found: ${ISSUES.length}`);
  if (ISSUES.length > 0) {
    for (const i of ISSUES) console.log(`  ⚠ ${i}`);
  } else {
    console.log('  ✓ All checks passed!');
  }
  console.log('═══════════════════════════════════════\n');

  p1.socket.disconnect();
  p2r.socket.disconnect();
  await sleep(500);
  process.exit(ISSUES.length > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
