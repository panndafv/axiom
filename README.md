# Terminal Router

A Chrome extension that adds **AXIOM / PADRE / GMGN** buttons beside Axiom's Instant Trade panel.
Pick a terminal, click a buy amount on Axiom as usual, and the buy is placed **on that terminal**
(Padre or GMGN) using your own logged-in session there, so the trade carries that terminal's tag.

No passwords or keys are stored or needed. The extension uses the sessions you are already
logged into in your browser.

## Install

1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions` (Brave: `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `extension` folder.
4. Pin the extension, open its popup and click **Open Padre & GMGN tabs**. Log in on both pinned tabs if needed.
5. Refresh any open Axiom tab.

## Use

- On an Axiom token page, the rail next to Instant Trade shows the active terminal.
  Click a terminal, or press **Alt+1** (Axiom), **Alt+2** (Padre) or **Alt+3** (GMGN).
- When Padre or GMGN is selected, Axiom's buy presets turn that terminal's colour, and clicking one
  sends the buy to that terminal instead of Axiom. A message in the bottom-right corner shows the result.
- Sells always go through Axiom as normal.

### Test mode (on by default)

While **Test mode** is on, the extension opens the token on Padre/GMGN and types the amount,
but **does not press Buy**. Check the pinned tab to see that it filled the right box, then turn
Test mode off in the popup. Start with tiny amounts (e.g. 0.0001 SOL).

## How it works

1. `src/axiom.js` intercepts clicks on Instant Trade's green buy presets before Axiom sees them.
2. It gets the token's mint address: DexScreener maps Axiom's pair address to the mint, and if that
   fails it reads pump.fun/Solscan links on the page.
3. `src/background.js` opens (or reuses) a dedicated pinned Padre/GMGN tab on that token's page.
4. `src/terminal-buyer.js` runs inside that tab: it finds the amount box and Buy button,
   types the amount, presses Buy and reports the site's own success/error message back.

## Known limits

- Each terminal spends from **its own wallet** unless you imported the same wallet into all three.
  Slippage, fees and MEV settings come from that terminal's own settings.
- Only Instant Trade's preset buy buttons are routed. Advanced-mode buys and Pulse row quick-buys still go through Axiom.
- The Padre/GMGN tab must load the token page first, so routed buys are slower than native Axiom buys (a few seconds).
- Padre and GMGN have no official API for this. If they change their pages, the selectors in
  `src/config.js` (`TR.SITES`) may need updating.
