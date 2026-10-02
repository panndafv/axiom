# Pier Pressure

A low-poly 3D fishing game for a memecoin. Walk the pier, cast from any edge, reel fish in against
a 90-second lantern, and sell them for gold to buy better rods and bait. Rare fish can be **cashed in
for a share of a SOL reward pool** funded by the token's creator fees. Only wallets holding at
least **$50 of the token** can cash in.

"Pier Pressure" and `$PIER` are placeholders. Set your own name, ticker and mint in `.env`.

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

## How a run works

Walk to any edge of the pier and press E when it says FISH HERE. Then:

1. **Cast** with Space or a click. The bobber lands wherever it lands.
2. **Wait.** The bite comes on its own.
3. **Reel.** Hold Space or the mouse. Progress and tension both rise; letting go bleeds tension but
   the fish takes line back. When the fish **surges**, let go or the line snaps.
4. **Bank or push.** Every landed fish adds +0.10 to the multiplier. **B** banks the stringer ×
   multiplier into the run score; the multiplier bonus is paid as gold. A **snap loses the whole
   unbanked stringer**.

When the lantern's 90 seconds run out, the run is scored and the stringer is banked automatically.
Banked fish go in your **backpack**, which holds 15. Sell them for gold at the fish rack, or cash
rare ones in at the reward pool. If the backpack is full when you bank, the cheapest fish are sold
to make room (rarer fish are always kept first). The bar at the top of the screen shows your luck,
gold and backpack.

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
| Mythic    | 0.1%      | ~✦2000    | 3%                          |

- **Gold** (✦) comes from selling fish. It buys rods, bait and outfits in the tackle shop. Gold has
  no value outside the game.
- **Luck** comes from the rod (+0 to +40) plus bait (+6 to +45, used up one per cast). It multiplies
  the weight of every tier above common by `1 + luck/100 × 1.5 × tier`. At 40 luck a mythic is 4×
  as likely. Better rods also take a little more tension, so the rare fish they bring in can still
  be landed.
- **Cash-ins** pay a fixed percentage of whatever is in the pool at that moment, so the pool can
  never be drained to zero, and more players just means smaller slices. Before a wallet can cash in:
  - it must hold at least `MIN_HOLD_USD` of the token, checked live on-chain with the price from
    DexScreener (Jupiter as fallback);
  - it must have earned `EARN_GATE` lifetime gold (anti-bot: you have to actually play first);
  - it can take at most `POOL_DAILY_CAP_PCT` of the pool per 24 hours.
- Cash-ins add to the player's **claimable** SOL. A claim (min 0.01 SOL) queues a payout.

## The reward pool and payouts

Two modes:

- **Ledger mode** (default, `POOL_WALLET` empty). The pool is a number in the database. Top it up
  when creator fees come in:
  ```bash
  curl -X POST https://your.site/api/admin/pool -H "x-admin-key: $ADMIN_KEY" \
       -H 'content-type: application/json' -d '{"addLamports": 5000000000}'   # +5 SOL
  ```
- **Wallet mode** (`POOL_WALLET` set). The pool is that wallet's on-chain SOL balance, minus
  everything already owed to players and a small reserve. Sending SOL to the wallet tops it up.

Payouts are **manual for now**. Nothing in this code holds a private key. To pay out:

```bash
curl https://your.site/api/admin/payouts?status=pending -H "x-admin-key: $ADMIN_KEY"
# send each one from the pool wallet, then record the transaction:
curl -X POST https://your.site/api/admin/payouts/12 -H "x-admin-key: $ADMIN_KEY" \
     -H 'content-type: application/json' -d '{"tx": "<signature>"}'
```

Players see their claims and the transaction links in the reward pool panel.

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
`https://…onrender.com` link with a test pool of 5 fake SOL, no earn gate, and the $50 check off.
The free plan sleeps after 15 idle minutes (the next visit takes about a minute to wake it) and
starts with a fresh database on every deploy or restart. To use your own domain, open the service's
**Settings → Custom Domains**, add the domain, and create the DNS record Render shows you at your
domain registrar.

**For launch,** one Node process serves both the API and the built client. Any host with a **persistent disk** for
the SQLite file works: a VPS, Fly.io, Railway or Render with a volume. Run it behind HTTPS and set:

- `TOKEN_MINT`, `TOKEN_SYMBOL`, `GAME_NAME`
- `SOLANA_RPC_URL`: a private RPC (Helius, Triton, QuickNode). The public endpoint rate-limits.
- `ADMIN_KEY`: a long random string.
- `POOL_WALLET`, if you use wallet mode.
- `TRUST_PROXY=1`, if behind a load balancer.

## Not done yet

- Automatic on-chain payouts. Claims queue for manual payment; a payout worker can be added once the
  fee wallet setup is decided.
- Buying shop items with the token, or burning it. Everything is bought with in-game gold.
- Multiplayer. Each player is alone on their own pier for now.
- Real-device testing on phones. Touch controls were only tested in an emulator.
