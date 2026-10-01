// Shared settings and per-site tuning. Loaded first by every extension script.
(() => {
  const TR = (globalThis.TR = globalThis.TR || {});

  TR.TERMINALS = {
    axiom: { label: 'AXIOM', key: '1' },
    padre: { label: 'PADRE', key: '2' },
    gmgn: { label: 'GMGN', key: '3' },
  };

  TR.DEFAULTS = {
    route: 'axiom',
    // Test mode: types the amount on Padre/GMGN but never presses Buy.
    dryRun: true,
    confirm: false,
    // When a terminal has no preset with the clicked amount, click its preset in the same
    // position as the Axiom button instead (e.g. Axiom 0.0001 -> Padre 0.001).
    matchByPosition: false,
    // {pair} = the pool address in Axiom's URL, {mint} = the token's contract address.
    padreUrl: 'https://trade.padre.gg/trade/solana/{pair}',
    gmgnUrl: 'https://gmgn.ai/sol/token/{mint}',
  };

  // presetBuy:        the site's one-click buy amount buttons (clicked when one matches the amount).
  // presetScope + presetLabel: alternative to presetBuy. Inside presetScope, the numeric buttons
  //                   in the section headed by the text presetLabel.
  // panelRoot:        the panel holding those presets.
  // currencySelected: the highlighted "pay with" option in that panel; currencySol must match inside it.
  // amountInput / buyButton: selectors for an amount box + Buy button, tried before the
  //                   text-based heuristics in terminal-buyer.js.
  TR.SITES = {
    padre: {
      label: 'Padre',
      home: 'https://trade.padre.gg/trenches',
      presetScope: '.MuiPaper-root:has(> [data-floating-widget-header])',
      presetLabel: 'Buy',
      amountInput: [],
      buyButton: [],
    },
    gmgn: {
      label: 'GMGN',
      home: 'https://gmgn.ai/trade?chain=sol',
      presetBuy:
        '[data-testid="instant_trade_buy"] [data-sentry-component="BtnItem"] > div, [data-testid="instant_trade_buy"] .cursor-pointer.border',
      panelRoot: '[data-sentry-component="CustomRndView"]',
      currencySelected: '[data-sentry-component="CurrencySwitcher"] > .bg-toggle-highlight-200',
      currencySol: 'img[data-icon*="Solana" i]',
      amountInput: [],
      buyButton: [],
    },
  };

  TR.getSettings = () => chrome.storage.sync.get(TR.DEFAULTS);
})();
