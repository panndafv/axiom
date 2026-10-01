// Axiom side: terminal picker beside the Instant Trade panel, and routing of its buy buttons.
(() => {
  const TR = globalThis.TR;
  const PANEL = '#instant-trade';
  const RAIL_GAP = 6;
  const B58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';
  // Links on the token page that carry the token's mint (contract) address.
  const MINT_LINKS = [
    new RegExp(`pump\\.fun/(?:coin/)?(${B58})`),
    new RegExp(`solscan\\.io/token/(${B58})`),
    new RegExp(`gmgn\\.ai/sol/token/(?:\\w+_)?(${B58})`),
    new RegExp(`birdeye\\.so/token/(${B58})`),
  ];

  let settings = { ...TR.DEFAULTS };
  let lastFire = { btn: null, at: 0 };
  const tokenCache = new Map();

  // ---------- settings ----------

  TR.getSettings().then((s) => {
    settings = s;
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    render();
  });

  function setRoute(route) {
    try {
      chrome.storage.sync.set({ route });
    } catch {
      toast('error', 'Extension was reloaded. Refresh this Axiom page.');
    }
  }

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg);
    } catch {
      return Promise.reject(new Error('Extension was reloaded. Refresh this Axiom page.'));
    }
  }

  // ---------- terminal picker bar ----------

  // A row of pills above the Instant Trade panel. Drag the grip to move it (e.g. next to your
  // wallet groups); it keeps that position relative to the panel. Double-click the grip to reset.
  const rail = document.createElement('div');
  rail.id = 'tr-rail';
  const grip = document.createElement('div');
  grip.className = 'tr-grip';
  grip.title = 'Drag to move. Double-click to put back above the panel.';
  rail.appendChild(grip);
  for (const [route, t] of Object.entries(TR.TERMINALS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tr-term';
    b.dataset.route = route;
    b.title = `Buy through ${t.label} (Alt+${t.key})`;
    b.innerHTML = `<span class="tr-dot"></span>${t.label}`;
    b.addEventListener('click', () => setRoute(route));
    rail.appendChild(b);
  }
  const testBadge = document.createElement('div');
  testBadge.className = 'tr-test';
  testBadge.textContent = 'TEST';
  testBadge.title = 'Padre/GMGN orders are filled in but Buy is not pressed. Turn off in the extension popup.';
  rail.appendChild(testBadge);
  document.documentElement.appendChild(rail);

  function render() {
    for (const b of rail.querySelectorAll('.tr-term')) {
      b.classList.toggle('tr-active', b.dataset.route === settings.route);
    }
    rail.classList.toggle('tr-dry', Boolean(settings.dryRun) && settings.route !== 'axiom');
  }

  // Offset of the bar from the panel's top-left corner; null = default (just above the panel).
  let offset = null;
  chrome.storage.local.get('barOffset').then(({ barOffset }) => (offset = barOffset ?? null));

  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    const panel = document.querySelector(PANEL);
    if (!panel) return;
    const p = panel.getBoundingClientRect();
    const b = rail.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, dx: b.left - p.left, dy: b.top - p.top };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (drag) offset = { dx: drag.dx + e.clientX - drag.x, dy: drag.dy + e.clientY - drag.y };
  });
  grip.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    chrome.storage.local.set({ barOffset: offset });
  });
  grip.addEventListener('dblclick', () => {
    offset = null;
    chrome.storage.local.remove('barOffset');
  });

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  // Follow the panel around: it is draggable, resizable and can be closed.
  function place() {
    const panel = document.querySelector(PANEL);
    const r = panel?.getBoundingClientRect();
    if (!r || r.width === 0) {
      rail.style.display = 'none';
    } else {
      rail.style.display = 'flex';
      const w = rail.offsetWidth;
      const h = rail.offsetHeight;
      const { dx, dy } = offset ?? { dx: 0, dy: -h - RAIL_GAP };
      const x = clamp(r.left + dx, 0, innerWidth - w);
      const y = clamp(r.top + dy, 0, innerHeight - h);
      rail.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      if (panel.dataset.trRoute !== settings.route) panel.dataset.trRoute = settings.route;
    }
    requestAnimationFrame(place);
  }
  requestAnimationFrame(place);

  // ---------- buy-click interception ----------

  // Buy presets are the green (text-increase) pills; sell presets are text-decrease.
  function buyButtonFrom(target) {
    if (!(target instanceof Element)) return null;
    const panel = target.closest(PANEL);
    const btn = panel && target.closest('.rounded-full.cursor-pointer');
    return btn && panel.contains(btn) && btn.classList.contains('text-increase') ? btn : null;
  }

  // Window capture listeners run before React's, so Axiom never sees the click.
  function intercept(e) {
    if (settings.route === 'axiom') return;
    const btn = buyButtonFrom(e.target);
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') routeBuy(btn);
  }
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick']) {
    window.addEventListener(type, intercept, { capture: true, passive: false });
  }

  async function routeBuy(btn) {
    const started = performance.now();
    // Guard against an accidental double click on the same button sending two orders.
    const now = Date.now();
    if (lastFire.btn === btn && now - lastFire.at < 400) {
      return toast('info', 'Ignored a double click. Click again to place another order.');
    }
    lastFire = { btn, at: now };

    const route = settings.route;
    const name = TR.TERMINALS[route].label;
    const text = btn.textContent.trim();
    const amount = Number(text);
    if (!(amount > 0)) return toast('error', `"${text}" is not a SOL amount.`);
    const panel = btn.closest(PANEL);
    const unit = panel.querySelector('.buy-click-container button span')?.textContent.trim();
    const index = [...panel.querySelectorAll('.rounded-full.cursor-pointer.text-increase')].indexOf(btn);
    if (unit && unit !== 'SOL') return toast('error', `Switch Axiom's Buy unit to SOL first (it is ${unit}).`);

    try {
      const pair = pairFromUrl();
      if (!pair) throw new Error('Open a token page on Axiom first (axiom.trade/meme/…).');
      let mint = null;
      if (settings[`${route}Url`].includes('{mint}')) {
        toast('pending', 'Finding token address…');
        mint = await resolveMint(pair);
      }
      if (settings.confirm && !window.confirm(`Buy ${amount} SOL of ${mint ?? pair} through ${name}?`)) {
        return toast('info', 'Cancelled.');
      }
      toast('pending', `${settings.dryRun ? 'TEST: ' : ''}Buying ${amount} SOL through ${name}…`);
      const res = await send({ type: 'tr-buy', route, amount, index, pair, mint });
      const secs = ((performance.now() - started) / 1000).toFixed(2);
      toast(res?.ok ? 'ok' : 'error', `${res?.message || 'No response from the extension.'} (${secs}s)`);
    } catch (err) {
      toast('error', err.message);
    }
  }

  // Axiom's URL holds the pair (pool) address. Padre takes that too; GMGN needs the token mint.
  const pairFromUrl = () => location.pathname.match(new RegExp(`/meme/(${B58})`))?.[1];

  async function resolveMint(pair) {
    if (tokenCache.has(pair)) return tokenCache.get(pair);

    let mint = await send({ type: 'tr-resolve', pair }).catch(() => null);
    if (typeof mint !== 'string') {
      const found = new Set();
      for (const a of document.querySelectorAll('a[href]')) {
        for (const re of MINT_LINKS) {
          const m = a.href.match(re);
          if (m && m[1] !== pair) found.add(m[1]);
        }
      }
      if (found.size > 1) throw new Error(`Found ${found.size} different token addresses on the page. Not buying, to be safe.`);
      mint = [...found][0];
    }
    if (!mint) throw new Error("Could not find this token's contract address.");

    tokenCache.set(pair, mint);
    return mint;
  }

  // ---------- preloading ----------

  // Load the current token in the selected terminal's tab as soon as it is opened on Axiom,
  // so a buy only has to click. Axiom changes pages without reloading, so check every 300ms.
  let preparedKey = '';
  async function prepare() {
    const route = settings.route;
    const pair = pairFromUrl();
    const key = `${route}:${pair}`;
    if (!pair || route === 'axiom' || key === preparedKey) return;
    preparedKey = key;
    try {
      const mint = settings[`${route}Url`].includes('{mint}') ? await resolveMint(pair) : null;
      await send({ type: 'tr-prepare', route, pair, mint });
    } catch {
      // A buy on this token will report the problem.
    }
  }
  setInterval(prepare, 300);

  // The site's own confirmation or error, which arrives after "buy sent".
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'tr-outcome') toast(msg.ok ? 'ok' : 'error', msg.message);
  });

  // ---------- shortcuts ----------

  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const hit = Object.entries(TR.TERMINALS).find(([, t]) => e.code === `Digit${t.key}`);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      setRoute(hit[0]);
      toast('info', `Buying through ${hit[1].label}`);
    },
    true,
  );

  // ---------- toast ----------

  const toastEl = document.createElement('div');
  toastEl.id = 'tr-toast';
  document.documentElement.appendChild(toastEl);
  let toastTimer;

  function toast(kind, text) {
    toastEl.className = `tr-show tr-${kind}`;
    toastEl.textContent = text;
    clearTimeout(toastTimer);
    if (kind !== 'pending') toastTimer = setTimeout(() => (toastEl.className = ''), kind === 'error' ? 7000 : 4000);
  }
})();
