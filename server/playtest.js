// Automated playtest — connects as 2 players, simulates gameplay, checks for bugs
// Run: node server/playtest.js

import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const TILE_PX = 48;
const TESTS = [];
let passed = 0, failed = 0;

function test(name, fn) { TESTS.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Connect a player and wait for init
function connectPlayer(label) {
  return new Promise((resolve, reject) => {
    const socket = io(URL);
    const state = { init: null, updates: [], events: [] };

    socket.on('connect', () => console.log(`  [${label}] connected: ${socket.id}`));
    socket.on('init', data => { state.init = data; resolve({ socket, state, label }); });
    socket.on('state', data => { state.updates.push(data); });
    socket.on('disconnect', () => console.log(`  [${label}] disconnected`));

    setTimeout(() => reject(new Error(`${label} init timeout`)), 5000);
  });
}

// Wait for N state updates
function waitUpdates(player, count) {
  return new Promise(resolve => {
    const startLen = player.state.updates.length;
    const check = setInterval(() => {
      if (player.state.updates.length >= startLen + count) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
}

// ═════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════

test('Player receives valid init data', async () => {
  const p = await connectPlayer('P1');
  const d = p.state.init;

  assert(d.playerId, 'missing playerId');
  assert(d.map && d.map.length === d.mapSize * d.mapSize, `map size mismatch: ${d.map.length} vs ${d.mapSize}^2`);
  assert(d.mapSize === 100, `unexpected mapSize: ${d.mapSize}`);
  assert(d.tilePx === 48, `unexpected tilePx: ${d.tilePx}`);
  assert(d.playerState.x > 0 && d.playerState.y > 0, 'player at origin');
  assert(d.playerState.alive === true, 'player not alive');
  assert(d.bots.length > 0, 'no bots');
  assert(d.loot.length > 0, 'no loot');

  // Check player spawns on walkable tile
  const tx = Math.floor(d.playerState.x / TILE_PX);
  const ty = Math.floor(d.playerState.y / TILE_PX);
  const tile = d.map[ty * d.mapSize + tx];
  assert(tile === 1 || tile === 3 || tile === 5, `player spawned on non-walkable tile ${tile} at (${tx},${ty})`);

  p.socket.disconnect();
});

test('All bots spawn on walkable tiles', async () => {
  const p = await connectPlayer('P2');
  const d = p.state.init;
  let badBots = 0;

  for (const bot of d.bots) {
    const tx = Math.floor(bot.x / TILE_PX);
    const ty = Math.floor(bot.y / TILE_PX);
    const tile = d.map[ty * d.mapSize + tx];
    if (tile !== 1 && tile !== 3 && tile !== 5) {
      badBots++;
      if (badBots <= 3) console.log(`    Bot ${bot.id} at (${tx},${ty}) on tile ${tile}`);
    }
  }
  assert(badBots === 0, `${badBots} bots spawned on non-walkable tiles`);

  p.socket.disconnect();
});

test('All loot spawns on walkable tiles', async () => {
  const p = await connectPlayer('P3');
  const d = p.state.init;
  let badLoot = 0;

  for (const l of d.loot) {
    const tx = Math.floor(l.x / TILE_PX);
    const ty = Math.floor(l.y / TILE_PX);
    const tile = d.map[ty * d.mapSize + tx];
    if (tile !== 1 && tile !== 3 && tile !== 5) {
      badLoot++;
      if (badLoot <= 3) console.log(`    Loot ${l.itemId} at (${tx},${ty}) on tile ${tile}`);
    }
  }
  assert(badLoot === 0, `${badLoot} loot items spawned on non-walkable tiles`);

  p.socket.disconnect();
});

test('No walls are single-tile height', async () => {
  const p = await connectPlayer('P4');
  const d = p.state.init;
  const map = d.map;
  const sz = d.mapSize;
  let violations = 0;

  for (let r = 1; r < sz - 1; r++) {
    for (let c = 0; c < sz; c++) {
      if (map[r * sz + c] !== 0) continue; // not wall
      if (map[(r + 1) * sz + c] === 0) continue; // south is wall, OK
      if (map[(r - 1) * sz + c] === 0) continue; // north is wall, OK
      violations++;
    }
  }
  assert(violations === 0, `${violations} single-height walls found`);

  p.socket.disconnect();
});

test('Player receives state updates', async () => {
  const p = await connectPlayer('P5');

  // Send some movement input
  p.socket.emit('input', { seq: 1, keys: { w: true, a: false, s: false, d: false }, angle: 0 });

  await waitUpdates(p, 3);

  const latest = p.state.updates[p.state.updates.length - 1];
  assert(latest.players && latest.players.length > 0, 'no players in state');
  assert(latest.bots && latest.bots.length > 0, 'no bots in state');
  assert(typeof latest.tick === 'number', 'missing tick');

  p.socket.disconnect();
});

test('Multiplayer: 2 players see each other', async () => {
  const p1 = await connectPlayer('MP1');
  const p2 = await connectPlayer('MP2');

  await waitUpdates(p1, 3);

  const latest = p1.state.updates[p1.state.updates.length - 1];
  const playerIds = latest.players.map(p => p.id);

  assert(playerIds.includes(p1.state.init.playerId), 'P1 not in player list');
  assert(playerIds.includes(p2.state.init.playerId), 'P2 not in player list');
  assert(latest.players.length >= 2, `only ${latest.players.length} players`);

  p1.socket.disconnect();
  p2.socket.disconnect();
});

test('Player movement works (position changes)', async () => {
  const p = await connectPlayer('P6');
  const startX = p.state.init.playerState.x;

  // Move right for 30 ticks
  for (let i = 0; i < 30; i++) {
    p.socket.emit('input', { seq: i + 1, keys: { w: false, a: false, s: false, d: true }, angle: 0 });
  }

  await waitUpdates(p, 10);

  const latest = p.state.updates[p.state.updates.length - 1];
  const me = latest.players.find(pl => pl.id === p.state.init.playerId);
  assert(me, 'player not found in update');
  assert(Math.abs(me.x - startX) > 10, `player didn't move: startX=${startX} nowX=${me.x}`);

  p.socket.disconnect();
});

test('Bots are fighting each other (state changes from PATROL)', async () => {
  const p = await connectPlayer('P7');

  // Wait 3 seconds for bots to start interacting
  await new Promise(r => setTimeout(r, 3000));
  await waitUpdates(p, 5);

  const latest = p.state.updates[p.state.updates.length - 1];
  const botStates = {};
  for (const b of latest.bots) {
    botStates[b.state] = (botStates[b.state] || 0) + 1;
  }

  console.log('    Bot state distribution:', botStates);
  const activeBots = (botStates['FIGHT'] || 0) + (botStates['FLEE'] || 0) + (botStates['LOOT'] || 0);
  assert(activeBots > 0, 'no bots are in active states (FIGHT/FLEE/LOOT)');

  p.socket.disconnect();
});

test('Disconnect and reconnect works', async () => {
  const p1 = await connectPlayer('RC1');
  const id1 = p1.state.init.playerId;

  // Disconnect
  p1.socket.disconnect();
  await new Promise(r => setTimeout(r, 500));

  // Reconnect
  const p2 = await connectPlayer('RC2');
  assert(p2.state.init.playerId, 'no playerId on reconnect');
  assert(p2.state.init.map.length > 0, 'no map on reconnect');

  p2.socket.disconnect();
});

test('Fire event generates response', async () => {
  const p = await connectPlayer('P8');

  // Get a weapon first — check if player has one
  // Send fire
  p.socket.emit('fire', { angle: 0, slot: 'primary', latency: 0 });

  await waitUpdates(p, 5);

  // Just verify no crash
  const latest = p.state.updates[p.state.updates.length - 1];
  assert(latest.tick > 0, 'game still running after fire');

  p.socket.disconnect();
});

// ═════════════════════════════════════════════════════════════
// Runner
// ═════════════════════════════════════════════════════════════

async function run() {
  console.log(`\n=== PLAYTEST: ${TESTS.length} tests ===\n`);

  for (const t of TESTS) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${t.name}: ${e.message}`);
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
