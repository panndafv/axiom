# Drift

A low-poly 3D multiplayer fishing game for a memecoin. Up to 25 players share a pier. Cast from any
edge, reel fish in, and sell them for gold to buy better rods and bait. Rare fish can be **cashed in
for a share of a SOL reward pool** funded by the token's creator fees. Only wallets holding at
least **$30 of the token** can cash in.

The name and the `$DRIFT` ticker are set in `.env` (`GAME_NAME`, `TOKEN_SYMBOL`), along with the token mint.

```
game/
  shared/   rules.js (all numbers: fish, rarities, rods, bait, pool %), engine.js (game state machine)
  server/   Node server: wallet sign-in, holding check, authoritative runs, pool ledger, admin API
  src/      browser client: three.js scene, UI, guest mode
  test/     node:test suites for the engine and the HTTP API
```

## Run it

Needs Node 22.13+ (uses the built-in `node:sqlite`).

**Windows, no typing:** double-click `start.bat` in this folder. It installs everything, writes a
`.env` with local test settings (`ADMIN_KEY=test`, `EARN_GATE=0`), builds the game, starts the
server and opens http://localhost:8787. Keep its window open while you play. Double-click
`fund-pool.bat` to put 5 test SOL in the reward pool.

**Any system, by hand:**

```bash
cd game
npm install
cp .env.example .env      # then edit it
npm run build             # builds the client into dist/
npm start                 # serves the game + API on http://localhost:8787
```

`npm run fund -- 5` adds 5 test SOL to the pool of the server running on this machine (needs
`ADMIN_KEY` in `.env`). While developing, run `npm run dev:server` and `npm run dev` side by side. Vite serves the client
with hot reload on :5173 and proxies `/api` to the server. `npm test` runs the test suites.

With `TOKEN_MINT` empty the server runs in **dev mode**: every wallet passes the holding check.

**Testing real cash-ins before launch:** set `TOKEN_MINT` (the token does not need to exist yet),
`TEST_WALLETS` to your own wallet address, and `HIDE_MINT=1` so the address stays off the title
screen. Only the test wallets pass the holding check. Delete both at launch.

## How fishing works

Walk to any edge of the pier and press E when it says FISH HERE. Fish as long as you like and press
E again to stop.

1. **Cast** with Space or a click. The bobber lands wherever it lands, always in open water.
2. **Wait.** The bite comes on its own.
3. **Reel.** Hold Space or the mouse. Progress and tension both rise; letting go bleeds tension but
   the fish takes line back. When the fish **surges**, let go or the line snaps and the fish is gone.

Every fish you land goes straight into your **backpack**, which holds 15. Sell them for gold at the
fish rack, or cash rare ones in at the reward pool. With a full backpack you can't cast until you
sell some. The bar at the top of the screen shows your luck, gold, backpack and lobby.

On the deck: WASD to walk, the mouse or arrow keys to look, Shift to run, E to interact, V to change
the view, P for your profile, M to mute. On phones there's a joystick, drag-to-look and on-screen
buttons.

## Economy

All of it lives in `shared/rules.js`.

| Rarity    | Base odds | Sells for | Cash-in (share of the pool) |
|-----------|-----------|-----------|-----------------------------|
| Common    | 62%       | ~✦8       | cash only                   |
| Uncommon  | 24%       | ~✦25      | cash only                   |
| Rare      | 9.5%      | ~✦70      | 0.04%                       |
| Epic      | 3.6%      | ~✦200     | 0.25%                       |
| Legendary | 0.8%      | ~✦600     | 1%                          |
| Mythic    | 0.1%      | ~✦2000    | 3% (Moon Marlin, Golden Koi, Swordfish) |

The three 3% mythics each bite 0.03% of the time at zero luck. The **Ghost Whale** is a special
mythic: it bites a third as often as any one of them (0.01% of all bites at zero luck, the rarest
fish in the game) and cashes in for **6.5%** of the pool.
Per-fish overrides live on the species in `rules.js` (`weight`, `poolPct`).

- **Gold** (✦) comes from selling fish. It buys rods, bait and outfits in the tackle shop. Gold has
  no value outside the game.
- **Golden and rainbow casts.** Every 10th cast is golden (2× luck) and every 50th rainbow (5×
  luck), with at least +15 luck per step so it still counts at 0 luck. Counters at the bottom of
  the screen show the next one. The server counts casts, so it cannot be faked.
- **Halos** (shop, ✦600 to ✦18,000) add 5% to 35% to the gold fish sell for, and float over the
  angler's head for everyone in the lobby.
- **Luck** comes from the rod (+0 to +40 in the shop) plus bait (+6 to +45, used up one per cast).
  It multiplies the weight of every tier above common by `1 + luck/100 × 1.5 × tier`. At 40 luck a
  mythic is 4× as likely. Better rods also take a little more tension, so the rare fish they bring
  in can still be landed.
- **The Beacon** (+25 luck) is not for sale. It leans on the lamp room at the top of the lighthouse.
  Press E at the lighthouse door (the prompt only appears when you stand there), walk round the
  gallery and take it. The server only hands it to a wallet whose player is up the lighthouse in a
  lobby at that moment.
- **Cash-ins** pay a fixed percentage of whatever is in the pool at that moment, so the pool can
  never be drained to zero, and more players just means smaller slices. Before a wallet can cash in:
  - it must hold at least `MIN_HOLD_USD` of the token, checked live on-chain with the price from
    DexScreener (Jupiter as fallback);
  - it must have sold `EARN_GATE` fish at the rack (default 10; anti-bot: you have to actually play first);
  - it can take at most `POOL_DAILY_CAP_PCT` of the pool per 24 hours (default 10%; keep it above
    6.5% or a Ghost Whale could never be cashed in).
- With automatic payouts on, every cash-in is sent to the player's wallet straight away. Otherwise
  it adds to their **claimable** SOL, and a claim (min 0.01 SOL) queues a payout for you to send.

## The reward pool and payouts

Where the pool's SOL comes from:

- **Ledger mode** (default, no pool wallet). The pool is a number in the database. Top it up
  when creator fees come in:
  ```bash
  curl -X POST https://your.site/api/admin/pool -H "x-admin-key: $ADMIN_KEY" \
       -H 'content-type: application/json' -d '{"addLamports": 5000000000}'   # +5 SOL
  ```
- **Wallet mode** (`POOL_WALLET` or `POOL_SECRET_KEY` set). The pool is that wallet's on-chain SOL
  balance, minus everything already owed to players and a small reserve. Sending SOL to the wallet
  tops it up.

How players get paid:

- **Automatic** (`POOL_SECRET_KEY` set). The server signs and sends every payout from the pool
  wallet itself. A player who cashes in a fish gets the SOL in their wallet within seconds, a
  "view on Solscan" link in the game, and a list of all their payouts with their transactions in
  the reward pool panel. Use a wallet made only for the pool (fund it from the creator-fee wallet),
  and keep its key in your host's secret settings only. Payouts are never sent twice: each
  transaction is recorded before it is broadcast and only re-sent once it can no longer land. If
  the network refuses one (say the player's wallet has 0 SOL and the amount is tiny), it goes back
  to the player's balance with a reason, and they can send it again from the reward pool. Run one
  server instance. Turning it on also sends any claims still waiting in the manual queue, so
  record the ones you already paid by hand first.
- **Manual** (no key). Claims queue up for you to pay by hand:
  ```bash
  curl https://your.site/api/admin/payouts?status=pending -H "x-admin-key: $ADMIN_KEY"
  # send each one from the pool wallet, then record the transaction:
  curl -X POST https://your.site/api/admin/payouts/12 -H "x-admin-key: $ADMIN_KEY" \
       -H 'content-type: application/json' -d '{"tx": "<signature>"}'
  ```
  Players see the Solscan link once you record it.

**Try automatic payouts for free on devnet:** make a new wallet in Phantom, switch Phantom to
devnet (Settings → Developer Settings → Testnet Mode, then Solana Devnet), get free devnet SOL from
https://faucet.solana.com, and export that wallet's private key. On the server set
`SOLANA_RPC_URL=https://api.devnet.solana.com`, `POOL_SECRET_KEY=<that key>` and leave
`TOKEN_MINT` empty. Cash-ins then send real devnet SOL with working Solscan links. Your player
wallet needs a little devnet SOL too, or small payouts are refused for rent.

## Lobbies

The server also speaks WebSocket on `/ws`. Players are put in the lowest-numbered lobby with room
(25 per lobby) and see everyone in it walk, fish and change rods, with name tags (short wallet
address, or `guest-xxxx`). Every new player gets a random shirt (10 colours) and hair colour (5),
saved with their profile. When a signed-in player lands an Epic or rarer fish, the rest of their
lobby gets a shout-out. There is no chat. Positions are cosmetic: fish, gold and the pool never go
over the socket. Lobbies live in memory, so run one server instance (Render's single instance is
fine).

## Cheating

Wallet players never get to decide what they caught:

- Sign-in uses a one-time message signed by the wallet. Nothing to approve, and no transaction.
- The server rolls every fish. The species stays on the server until the fish is landed.
- A landing is rejected if it is faster than holding the line the whole way would allow.
- Cancelling or losing a fish keeps the line busy until the fish could have been landed, so a bot
  can't reroll casts hunting for rares.
- All pool maths runs on the server, in integer lamports, inside a SQLite transaction.
- Requests are rate-limited per IP. Behind a proxy, set `TRUST_PROXY=1`.

A bot can still play a perfect reel. That is what the earn gate, the daily cap and the hold
requirement are for. Guests play entirely in the browser (saved in localStorage) and can't touch
the pool.

## Deploying

**Test site on Render (free, a few clicks):** the repo root has a `render.yaml`. On render.com choose
**New → Blueprint**, pick this repo and the branch the game is on, and click **Apply**. You get an
`https://…onrender.com` link with a test pool of 5 fake SOL, no earn gate, and the $30 check off.
The free plan sleeps after 15 idle minutes (the next visit takes about a minute to wake it) and
starts with a fresh database on every deploy or restart. To use your own domain, open the service's
**Settings → Custom Domains**, add the domain, and create the DNS record Render shows you at your
domain registrar.

**For launch,** one Node process serves both the API and the built client. Any host with a **persistent disk** for
the SQLite file works: a VPS, Fly.io, Railway or Render with a volume. Run it behind HTTPS and set:

- `TOKEN_MINT`, `TOKEN_SYMBOL`, `GAME_NAME`
- `SOLANA_RPC_URL`: a private RPC (Helius, Triton, QuickNode). The public endpoint rate-limits.
- `ADMIN_KEY`: a long random string.
- `POOL_SECRET_KEY` for automatic payouts (or `POOL_WALLET` for wallet mode with manual payouts).
- `TRUST_PROXY=1`, if behind a load balancer.

## Not done yet

- Buying shop items with the token, or burning it. Everything is bought with in-game gold.
- Real-device testing on phones. Touch controls were only tested in an emulator.
