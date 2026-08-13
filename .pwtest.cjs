const { chromium } = require('playwright-core');
(async () => {
  for (const cfg of [
    { name: 'proxy env only', opts: {} },
    { name: 'explicit proxy', opts: { proxy: { server: process.env.HTTPS_PROXY } } },
  ]) {
    try {
      const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', ...cfg.opts });
      const p = await b.newPage();
      const r = await p.goto('https://www.omerta.fun/health', { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log(cfg.name, '->', r.status(), (await p.content()).slice(0, 120).replace(/\s+/g,' '));
      await b.close();
    } catch (e) { console.log(cfg.name, '-> ERR', String(e.message).split('\n')[0].slice(0, 100)); }
  }
})();
