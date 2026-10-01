(async () => {
  const TR = globalThis.TR;
  const settings = await TR.getSettings();
  const $ = (id) => document.getElementById(id);

  const routes = $('routes');
  for (const [route, t] of Object.entries(TR.TERMINALS)) {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.dataset.route = route;
    b.classList.toggle('on', settings.route === route);
    b.addEventListener('click', () => {
      chrome.storage.sync.set({ route });
      for (const other of routes.children) other.classList.toggle('on', other === b);
    });
    routes.appendChild(b);
  }

  for (const key of ['dryRun', 'confirm', 'matchByPosition']) {
    $(key).checked = settings[key];
    $(key).addEventListener('change', () => chrome.storage.sync.set({ [key]: $(key).checked }));
  }

  for (const key of ['padreUrl', 'gmgnUrl']) {
    const input = $(key);
    input.value = settings[key];
    input.addEventListener('change', () => {
      const value = input.value.trim();
      const ok = value.startsWith('https://') && /\{(mint|pair)\}/.test(value);
      input.classList.toggle('bad', !ok);
      if (ok) chrome.storage.sync.set({ [key]: value });
    });
  }

  $('warm').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'tr-warm' });
    $('status').textContent = `${res?.message ?? ''} Check both pinned tabs are logged in.`;
  });
})();
