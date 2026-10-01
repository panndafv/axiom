// Background worker: resolves token addresses and drives the Padre / GMGN tabs.
importScripts('config.js');

const TR = globalThis.TR;
// Quote tokens: when a pool pairs a memecoin with one of these, the other side is the memecoin.
const QUOTES = new Set([
  'So11111111111111111111111111111111111111112', // wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handlers = { 'tr-buy': buy, 'tr-prepare': prepare, 'tr-outcome': relayOutcome, 'tr-resolve': resolveMint, 'tr-warm': warmTabs };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg, sender).then(reply, (err) => reply({ ok: false, message: err?.message || String(err) }));
  return true;
});

// Which Axiom tab placed each order, so the site's confirmation can be shown there.
const orderTabs = new Map();
let nextOrderId = 1;

// Pair (pool) address -> token mint, via DexScreener. Returns null when unknown.
async function resolveMint({ pair }) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pair}`);
    const data = await res.json();
    const p = data.pairs?.[0] ?? data.pair;
    const mint = p && [p.baseToken?.address, p.quoteToken?.address].find((a) => a && !QUOTES.has(a));
    if (mint) return mint;

    // The address in Axiom's URL may already be the mint itself.
    const tokens = await (await fetch(`https://api.dexscreener.com/tokens/v1/solana/${pair}`)).json();
    if (Array.isArray(tokens) && tokens.length) return pair;
  } catch {
    // Fall through: the Axiom page scans its own links instead.
  }
  return null;
}

// The token page URL for a terminal, and the address that must appear in it.
async function target(route, pair, mint) {
  if (!TR.SITES[route]) throw new Error(`Unknown terminal: ${route}`);
  const settings = await TR.getSettings();
  const template = settings[`${route}Url`];
  const address = template.includes('{mint}') ? mint : pair;
  if (!address) throw new Error('Missing token address.');
  return { settings, address, url: template.replaceAll('{pair}', pair).replaceAll('{mint}', mint) };
}

// Called when you open a token on Axiom: load it in the terminal tab before you click Buy.
async function prepare({ route, pair, mint }) {
  const { url, address } = await target(route, pair, mint);
  await terminalTab(route, url, address);
  return { ok: true };
}

async function buy({ route, amount, index, pair, mint }, sender) {
  const { settings, url, address } = await target(route, pair, mint);
  const tabId = await terminalTab(route, url, address);
  await whenReady(tabId, address);
  const orderId = nextOrderId++;
  if (sender.tab) orderTabs.set(orderId, sender.tab.id);
  const res = await chrome.tabs.sendMessage(tabId, {
    type: 'tr-exec',
    orderId,
    address,
    amount,
    index,
    dryRun: settings.dryRun,
    matchByPosition: settings.matchByPosition,
  });
  return res ?? { ok: false, message: `${TR.SITES[route].label} tab did not answer.` };
}

// The site's own success/error message, which arrives after the buy was sent.
async function relayOutcome(msg) {
  const tabId = orderTabs.get(msg.orderId);
  orderTabs.delete(msg.orderId);
  if (tabId != null) await chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  return { ok: true };
}

// Prepare and buy can race; run one tab operation per terminal at a time.
const tabLocks = {};
function withTabLock(route, fn) {
  const run = (tabLocks[route] ?? Promise.resolve()).then(fn, fn);
  tabLocks[route] = run.catch(() => {});
  return run;
}

// One dedicated pinned tab per terminal, so the extension never hijacks a tab you are using.
// Navigates it to `url` unless it is already on (or loading) the token `address`.
function terminalTab(route, url, address) {
  return withTabLock(route, async () => {
    const tabKey = `tab_${route}`;
    const saved = await chrome.storage.session.get(tabKey);
    const tab = saved[tabKey] != null ? await chrome.tabs.get(saved[tabKey]).catch(() => null) : null;

    if (!tab) {
      const created = await chrome.tabs.create({ url, active: false, pinned: true });
      await chrome.storage.session.set({ [tabKey]: created.id });
      // Memory Saver would otherwise unload the tab, forcing a full reload on the next buy.
      await chrome.tabs.update(created.id, { autoDiscardable: false }).catch(() => {});
      return created.id;
    }
    if (!(tab.pendingUrl || tab.url || '').includes(address)) await chrome.tabs.update(tab.id, { url });
    if (tab.autoDiscardable) await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
    return tab.id;
  });
}

const ping = (tabId) => chrome.tabs.sendMessage(tabId, { type: 'tr-ping' }).catch(() => null);

// Wait until the buyer script answers from the page for this token, never the previous one.
async function whenReady(tabId, address) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    const pong = await ping(tabId);
    if (pong?.href.includes(address)) return;
    await sleep(100);
  }
  throw new Error('Terminal tab did not load in time. Is it open and logged in?');
}

// Popup button: open the terminal tabs ahead of time so you can check you are logged in.
async function warmTabs() {
  const opened = [];
  for (const [route, site] of Object.entries(TR.SITES)) {
    const tabKey = `tab_${route}`;
    const saved = await chrome.storage.session.get(tabKey);
    const tab = saved[tabKey] != null ? await chrome.tabs.get(saved[tabKey]).catch(() => null) : null;
    if (tab) continue;
    const created = await chrome.tabs.create({ url: site.home, active: false, pinned: true });
    await chrome.storage.session.set({ [tabKey]: created.id });
    await chrome.tabs.update(created.id, { autoDiscardable: false }).catch(() => {});
    opened.push(site.label);
  }
  return { ok: true, message: opened.length ? `Opened ${opened.join(' and ')}.` : 'Terminal tabs are already open.' };
}
