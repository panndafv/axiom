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

### Padre and GMGN presets

Padre and GMGN buys use each site's floating **Instant Trade** panel. The extension clicks the preset
on that panel with the same amount as the Axiom button you clicked. So:

- Keep the Instant Trade panel open in the pinned Padre and GMGN tabs.
- Give them the same buy presets as Axiom where you can. If there is no matching preset, nothing is
  bought and you get an error listing that site's presets.
- Or turn on **"same position"** in the popup: when amounts differ, the extension clicks the preset in
  the same position as your Axiom button (e.g. Axiom's 7th button 0.0001 → Padre's 7th button 0.001).
  The result message always says the amount that was actually bought.
- Pay with **SOL**, not USDC/USD1. GMGN is checked automatically; on Padre, keep SOL selected yourself.
- Each site buys from the wallets selected **on that site**. If Padre has 3 wallets ticked, one
  click buys with all 3.

### Test mode (on by default)

While **Test mode** is on, the extension opens the token on Padre/GMGN and types the amount,
but **does not press Buy**. Check the pinned tab to see that it filled the right box, then turn
Test mode off in the popup. Start with tiny amounts (e.g. 0.0001 SOL).

## How it works

1. `src/axiom.js` intercepts clicks on Instant Trade's green buy presets before Axiom sees them.
2. Padre opens straight from the pool (pair) address in Axiom's URL. GMGN needs the token's mint
   address: DexScreener maps the pair to the mint, and if that fails the extension reads pump.fun/Solscan
   links on the page.
3. `src/background.js` opens (or reuses) a dedicated pinned Padre/GMGN tab on that token's page.
4. `src/terminal-buyer.js` runs inside that tab. It clicks the matching buy preset (Padre/GMGN), or types
   the amount into the amount box and presses Buy, then reports the site's own success/error message back.

## Known limits

- Each terminal spends from **its own wallet** unless you imported the same wallet into all three.
  Slippage, fees and MEV settings come from that terminal's own settings.
- Only Instant Trade's preset buy buttons are routed. Advanced-mode buys and Pulse row quick-buys still go through Axiom.
- Speed: when you open a token on Axiom, the selected terminal's pinned tab preloads that token, so a
  routed buy is just a click. If you click before the preload finishes (e.g. right after switching
  token or terminal), the buy waits for the page and is never placed on the previous token.
  Axiom shows "buy sent" with the time it took, then the site's own confirmation or error.
- Chrome's Memory Saver can unload the pinned tabs. The extension asks Chrome to keep them loaded; you
  can also add trade.padre.gg and gmgn.ai under "Always keep these sites active" in chrome://settings/performance.
- Padre and GMGN have no official API for this. If they change their pages, the selectors in
  `src/config.js` (`TR.SITES`) may need updating.
