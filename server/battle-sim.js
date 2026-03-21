// Headless battle simulation — watches a game and logs all combat events
// Run: node server/battle-sim.js
// Connects as a spectator and monitors all bot/player behavior

import { io } from 'socket.io-client';
const URL = 'http://localhost:3000';

const socket = io(URL);
let tick = 0;
let botHistory = {}; // id → { lastState, stateChanges, shots, kills, deaths }
let combatLog = [];

socket.on('init', data => {
  console.log('=== BATTLE SIMULATOR ===');
  console.log(`Map: ${data.mapSize}x${data.mapSize}`);
  console.log(`Bots: ${data.bots.length}`);
  console.log(`Loot: ${data.loot.length}`);
  console.log(`Player: ${data.playerId} at (${Math.round(data.playerState.x)}, ${Math.round(data.playerState.y)})`);
  console.log(`Weapon: ${data.playerState.inventory.primary || 'none'}`);
  console.log(`Ammo: ${JSON.stringify(data.playerState.inventory?.ammo || {})}`);
  console.log(`MagAmmo: ${JSON.stringify(data.playerState.inventory?.magAmmo || {})}`);
  console.log('');

  // Initialize bot tracking
  for (const b of data.bots) {
    botHistory[b.id] = {
      lastState: b.state, stateChanges: 0, shots: 0, kills: 0, deaths: 0,
      weapon: b.weapon, hp: b.hp, x: b.x, y: b.y,
    };
  }
});

socket.on('state', data => {
  tick++;

  // Track bot state changes
  for (const b of data.bots) {
    const h = botHistory[b.id];
    if (!h) continue;
    if (b.state !== h.lastState) {
      h.stateChanges++;
      if (tick <= 600) { // first 10 seconds only
        combatLog.push(`[${(tick/60).toFixed(1)}s] Bot${b.id}: ${h.lastState} → ${b.state}` +
          (b.weapon ? ` (${b.weapon})` : '') + ` HP:${b.hp}`);
      }
      h.lastState = b.state;
    }
    h.weapon = b.weapon;
    h.hp = b.hp;
    h.x = b.x;
    h.y = b.y;
  }

  // Periodic summary
  if (tick % 300 === 0) { // every 5 seconds
    const elapsed = (tick / 60).toFixed(0);
    const alive = data.bots.length;
    const states = {};
    data.bots.forEach(b => states[b.state] = (states[b.state] || 0) + 1);
    const armed = data.bots.filter(b => b.weapon).length;

    console.log(`\n[${elapsed}s] ── Status ──`);
    console.log(`  Alive: ${alive}/100 | Armed: ${armed}`);
    console.log(`  States: ${JSON.stringify(states)}`);

    // Show recent combat log
    if (combatLog.length > 0) {
      console.log(`  Recent events (${combatLog.length}):`);
      combatLog.slice(-8).forEach(l => console.log(`    ${l}`));
      combatLog = [];
    }

    // Check for concerning patterns
    if (states['FIGHT'] === 0 && alive > 5) {
      console.log('  ⚠ WARNING: No bots fighting with >5 alive');
    }
    if (states['IDLE'] > alive * 0.5) {
      console.log(`  ⚠ WARNING: ${states['IDLE']}/${alive} bots IDLE`);
    }
    if (armed < alive * 0.3 && alive > 10) {
      console.log(`  ⚠ WARNING: Only ${armed}/${alive} bots armed`);
    }
  }

  // End after 60 seconds
  if (tick >= 3600) {
    console.log('\n=== SIMULATION COMPLETE (60s) ===');
    const alive = data.bots.length;
    const totalStateChanges = Object.values(botHistory).reduce((s, h) => s + h.stateChanges, 0);
    console.log(`  Final alive: ${alive}/100`);
    console.log(`  Total state changes: ${totalStateChanges}`);
    console.log(`  Avg state changes per bot: ${(totalStateChanges / 100).toFixed(1)}`);

    // Show survivors
    if (alive <= 10) {
      console.log('\n  Survivors:');
      data.bots.forEach(b => {
        const h = botHistory[b.id];
        console.log(`    Bot${b.id}: HP=${b.hp} weapon=${b.weapon} state=${b.state} changes=${h?.stateChanges || 0}`);
      });
    }

    socket.disconnect();
    process.exit(0);
  }
});

// Timeout
setTimeout(() => { console.log('TIMEOUT'); socket.disconnect(); process.exit(1); }, 70000);
