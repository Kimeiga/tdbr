# TDBR

A Phaser top-down battle royale prototype. This is separate from the deployed GPS-based NYC Battle Royale Worker.

Requires Node22+. Run npm ci, npm run build, then npm start; open http://localhost:3000. The default arena has four bots and spectators. GAME_MODE=normal npm start enables the full100bot map and playable humans. RTC=0 uses WebSocket only; native RTC uses UDP3001 by default (RTC_PORT overrides). Deploy the matching client and server together.

Twinwire2.2 carries latest input intent and world state; actions remain reliable. The server applies intent at its fixed60Hz simulation tick and stops stale input after200ms. A socket pause retains the same player, coordinates, HP and inventory; terminal expiry removes the player. Game/world generations prevent old-map state from being applied.

The full normal bootstrap was measured above64KiB, so public map/bot/loot bootstrap travels over HTTP, referenced by a small generation-tagged init event. Large JSON world snapshots can use the WebSocket path even when native RTC is proven; inputs and small frames can use datagrams. This migration does not promise a compressed shooter codec or durable world storage.

Validation: npm run test:multiplayer starts an owned server, fetches the100bot bootstrap and verifies movement, fixed-tick intent, stale-input stopping, fire once, retained inventory and explicit leave. TEST_RTC=1 npm run test:multiplayer requires the real native path. It manually steps the game instead of running a long100bot CPU soak on the developer machine. Purchased source asset packs remain excluded from Git; use only assets for which you have the appropriate game license.
