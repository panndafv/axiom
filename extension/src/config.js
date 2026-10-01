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
    padreUrl: 'https://trade.padre.gg/trade/solana/{mint}',
    gmgnUrl: 'https://gmgn.ai/sol/token/{mint}',
  };

  // amountInput / buyButton: CSS selectors tried before the text-based
  // heuristics in terminal-buyer.js. Fill these in once we have each site's HTML.
  TR.SITES = {
    padre: {
      label: 'Padre',
      home: 'https://trade.padre.gg/trenches',
      amountInput: [],
      buyButton: [],
    },
    gmgn: {
      label: 'GMGN',
      home: 'https://gmgn.ai/trade?chain=sol',
      amountInput: [],
      buyButton: [],
    },
  };

  TR.getSettings = () => chrome.storage.sync.get(TR.DEFAULTS);
})();
