// ほしい物リスト — 画面
(function () {
  const X = window.WishExtract;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const K = { api: 'wishlist:api', data: 'wishlist:data', tab: 'wishlist:tab', pend: 'wishlist:pending', pref: 'wishlist:pref' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } },
  };
  const COLORS = ['#E8475F', '#3B7BE0', '#F29D12', '#8E5BD9', '#17A398', '#D6457A', '#5F6B7A', '#3A9E3A'];
  const DEF_CATS = [
    { id: 'fashion', name: 'ファッション', emoji: '👕' },
    { id: 'gadget', name: 'ガジェット', emoji: '🎧' },
    { id: 'home', name: 'くらし', emoji: '🏠' },
    { id: 'beauty', name: 'コスメ', emoji: '💄' },
    { id: 'book', name: '本・ゲーム', emoji: '📚' },
    { id: 'hobby', name: '趣味', emoji: '🎨' },
  ];
  const DEF_CFG = { categories: DEF_CATS, notify: true };
  const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const SORTS = [['new', '追加が新しい順'], ['pri', 'ほしい度順'], ['cheap', '安い順'], ['high', '高い順'], ['drop', '値下がり順']];

  const cache = store.get(K.data, null);
  const pref = store.get(K.pref, {});
  const S = {
    tab: store.get(K.tab, 'want'),
    api: store.get(K.api, ''),
    items: cache && cache.items || [],
    config: Object.assign({}, DEF_CFG, cache && cache.config || {}),
    lastSync: cache && cache.at || 0,
    pend: Object.assign({ up: {}, del: {}, cfg: false }, store.get(K.pend, {})),
    filter: pref.filter || 'all',
    sort: pref.sort || 'new',
    syncing: false, oldScript: false, sheet: null, toastT: 0,
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cats = () => S.config.categories || [];
  const catOf = id => cats().find(c => c.id === id);
  const catColor = id => COLORS[Math.max(0, cats().findIndex(c => c.id === id)) % COLORS.length];
  const byId = id => S.items.find(x => x.id === id);
  const want = () => S.items.filter(x => x.status !== 'bought');
  const bought = () => S.items.filter(x => x.status === 'bought');

  /* ---------------- 表示用の小道具 ---------------- */
  const yen = (n, cur) => {
    if (n == null || n === '' || isNaN(n)) return '';
    if (cur && cur !== 'JPY') return ({ USD: '$', EUR: '€', GBP: '£' }[cur] || cur + ' ') + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return '¥' + Math.round(n).toLocaleString('ja-JP');
  };
  const man = n => n >= 100000 ? (Math.round(n / 1000) / 10).toLocaleString('ja-JP') + '万' : Math.round(n).toLocaleString('ja-JP');
  const ago = ms => {
    if (!ms) return '';
    const s = (Date.now() - ms) / 1000;
    if (s < 90) return 'たった今';
    if (s < 3600) return Math.round(s / 60) + '分前';
    if (s < 86400) return Math.round(s / 3600) + '時間前';
    if (s < 86400 * 30) return Math.round(s / 86400) + '日前';
    const d = new Date(ms);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  };
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const md = s => { const p = String(s || '').split('-'); return p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) : s; };
  // 値段の動き：最初に登録したときと比べてどれだけ下がったか
  function trend(it) {
    const h = it.hist || [];
    if (!it.price || h.length < 2) return null;
    const first = h[0][1], max = h.reduce((m, x) => Math.max(m, x[1]), 0), min = h.reduce((m, x) => Math.min(m, x[1]), Infinity);
    const prev = h[h.length - 2][1];
    return { first, max, min, prev, diff: first - it.price, pct: first ? (first - it.price) / first : 0, lowest: it.price <= min, lastDiff: prev - it.price };
  }
  const isTarget = it => it.target && it.price && it.price <= it.target;
  const siteLabel = it => it.shop ? it.site + ' · ' + it.shop : it.site || X.host(it.url);
  const initial = it => esc(((it.site || it.title || '?').replace(/^[^\p{L}\p{N}]+/u, '')[0] || '?').toUpperCase());
  const imgTag = (src, ph) => src
    ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"><div class="ph" style="display:none">${ph}</div>`
    : `<div class="ph">${ph}</div>`;
  document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);

  const I = {
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.2 0 3.6 1.2 4.3 2.4.4.6 1.6.6 2 0 .7-1.2 2.1-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>',
    heartO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 20.2s-7-4.3-8.9-8.7C1.7 8.4 3.6 5.2 6.8 5.2c2 0 3.3 1.1 4 2.2.5.8 1.9.8 2.4 0 .7-1.1 2-2.2 4-2.2 3.2 0 5.1 3.2 3.7 6.3-1.9 4.4-8.9 8.7-8.9 8.7z"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12.2a1 1 0 0 1-1 .8H7a1 1 0 0 1-1-.8L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/><path d="m9.5 14 2 2 3.5-3.5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/></svg>',
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  };

  /* ---------------- 保存・通信 ---------------- */
  function persist() {
    store.set(K.data, { items: S.items.map(x => { const c = Object.assign({}, x); delete c.loading; return c; }), config: S.config, at: S.lastSync });
    store.set(K.pend, S.pend);
  }
  async function api(action, payload) {
    const res = await fetch(S.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action }, payload || {})) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '通信エラー');
    return j;
  }
  let flushing = null;
  async function flush() {
    if (!S.api) return;
    if (flushing) { await flushing; }
    const up = Object.keys(S.pend.up), del = Object.keys(S.pend.del), cfg = S.pend.cfg;
    if (!up.length && !del.length && !cfg) return;
    flushing = (async () => {
      S.pend = { up: {}, del: {}, cfg: false };
      persist();
      try {
        if (cfg) await api('saveConfig', { config: S.config });
        const items = up.map(byId).filter(x => x && !x.loading);
        if (items.length) {
          const r = await api('upsert', { items });
          r.items.forEach(sv => { const i = S.items.findIndex(x => x.id === sv.id); if (i >= 0 && !S.pend.up[sv.id]) S.items[i] = sv; });
        }
        if (del.length) await api('delete', { ids: del });
      } catch (e) {
        up.forEach(id => { S.pend.up[id] = 1; });
        del.forEach(id => { S.pend.del[id] = 1; });
        if (cfg) S.pend.cfg = true;
        throw e;
      } finally {
        persist();
        flushing = null;
      }
    })();
    return flushing;
  }
  function save(ids) {
    [].concat(ids || []).forEach(id => { S.pend.up[id] = 1; });
    persist();
    flush().catch(() => { });
  }
  function saveCfg() {
    S.pend.cfg = true;
    persist();
    flush().catch(() => { });
  }
  async function sync(quiet) {
    if (!S.api || S.syncing) return;
    S.syncing = true;
    renderHead();
    try {
      await flush();
      const j = await api('load');
      S.oldScript = (j.version || 0) < 3;
      const local = {};
      S.items.forEach(x => { local[x.id] = x; });
      const out = j.items.map(sv => {
        const lo = local[sv.id];
        if (lo && (S.pend.up[sv.id] || lo.loading)) return lo;
        return sv;
      }).filter(x => !S.pend.del[x.id]);
      // まだ送れていない新しいもの・読み込み中のものは残す
      S.items.forEach(x => { if ((S.pend.up[x.id] || x.loading) && !out.some(o => o.id === x.id)) out.push(x); });
      S.items = out;
      if (j.config && !S.pend.cfg) S.config = Object.assign({}, DEF_CFG, j.config);
      else if (!j.config) { S.pend.cfg = true; flush().catch(() => { }); }
      S.lastSync = Date.now();
      persist();
    } catch (e) {
      if (!quiet) toast('同期できませんでした：' + e.message);
    } finally {
      S.syncing = false;
      render();
    }
  }

  /* ---------------- 商品の追加・取得 ---------------- */
  // ブラウザだけで使うとき（スプレッドシート未連携）は r.jina.ai 経由で読む
  async function fetchLocal(url, hint) {
    let best = null, why = '';
    for (const st of X.plan(url).filter(s => s.kind === 'jina')) {
      for (let tryN = 0; tryN < 2; tryN++) {
        try {
          const res = await fetch(st.url, { headers: st.headers });
          const html = await res.text();
          const r = X.parse(html, url, hint);
          if (!res.ok && !r.ok) r.why = 'HTTP ' + res.status;
          best = X.better(best, r);
          if (r.ok || r.blocked || r.notFound || res.status < 500 && res.status !== 429) break;
        } catch (e) { why = e.message; }
        await new Promise(ok => setTimeout(ok, 1500));
      }
    }
    if (!best) { best = X.parse('', url, hint); best.why = why || '通信エラー'; }
    return best;
  }
  function applyInfo(it, info, now) {
    if (info.price && !(info.guess && it.price && !it.guess)) {
      it.price = info.price; it.currency = info.currency || it.currency; it.guess = !!info.guess;
      it.hist = it.hist || [];
      const last = it.hist[it.hist.length - 1];
      if (!last || last[1] !== info.price) it.hist.push([now, info.price]);
    }
    if (info.listPrice) it.listPrice = info.listPrice;
    if (info.stock) it.stock = info.stock;
    if ((!it.title || it.err) && info.title) it.title = info.title;
    if (info.images && info.images.length) {
      const seen = {};
      it.images = (it.images || []).concat(info.images).filter(u => !seen[u] && (seen[u] = 1)).slice(0, 16);
      if (!it.img) it.img = it.images[0];
    }
    if (info.ok) it.err = '';
    if (info.site && !it.site) it.site = info.site;
    if (info.shop && !it.shop) it.shop = info.shop;
    it.checkedAt = now;
  }
  function newItem(f, info, cat) {
    const now = Date.now();
    return {
      id: uid(), url: info.url || f.url, src: f.url, title: info.title || f.hint || X.host(f.url),
      price: info.price || null, currency: info.currency || 'JPY', listPrice: info.listPrice || null, guess: !!info.guess,
      images: info.images || [], img: (info.images || [])[0] || '', site: info.site || X.siteOf(f.url), shop: info.shop || '', brand: info.brand || '', stock: info.stock || '',
      cat: cat || '', pri: 2, memo: '', target: null, status: 'want',
      addedAt: now, updatedAt: now, checkedAt: info.price ? now : 0, hist: info.price ? [[now, info.price]] : [],
      err: info.ok ? '' : info.notFound ? 'ページが見つかりませんでした' : info.blocked ? 'ボット対策で読めませんでした' : '商品情報を読み取れませんでした' + (info.why ? '（' + info.why + '）' : ''),
    };
  }
  async function addFromText(text) {
    const f = X.findUrl(text);
    if (!f.url) { toast('リンクが見つかりませんでした'); return false; }
    const key = X.key(f.url);
    const dup = S.items.find(x => X.key(x.src || '') === key || X.key(x.url || '') === key);
    if (dup) { toast('もうリストに入っています'); openDetail(dup.id); return true; }
    const cat = S.filter !== 'all' && catOf(S.filter) ? S.filter : '';
    const ph = { id: uid(), loading: true, url: f.url, src: f.url, title: f.hint || '読み込み中…', site: X.siteOf(f.url), images: [], img: '', cat, pri: 2, status: 'want', addedAt: Date.now(), hist: [] };
    S.items.unshift(ph);
    if (S.tab !== 'want') S.tab = 'want';
    render();
    let it;
    try {
      if (S.api) {
        const r = await api('add', { id: ph.id, url: f.url, hint: f.hint, cat });
        it = r.item;
      } else {
        const info = await fetchLocal(f.url, f.hint);
        it = newItem(f, info, cat || X.guessCat(info, cats()));
        it.id = ph.id;
      }
    } catch (e) {
      it = newItem(f, X.parse('', f.url, f.hint), cat);
      it.id = ph.id;
      it.err = '読み込めませんでした（' + e.message + '）';
      S.pend.up[it.id] = 1;
    }
    const cur = byId(ph.id);
    if (cur) {   // 読み込み中に変えたもの（ほしい度・カテゴリ）は残す
      if (cur.pri !== ph.pri) it.pri = cur.pri;
      if (cur.cat !== ph.cat) { it.cat = cur.cat; S.pend.up[it.id] = 1; }
      Object.assign(cur, it);
      delete cur.loading;
      persist();
      flush().catch(() => { });
      render();
      if (S.sheet && S.sheet.id === cur.id) openDetail(cur.id);
      toast(cur.err ? '⚠️ ' + cur.err + '。タップして手で入力できます' : '追加しました：' + (cur.price ? yen(cur.price, cur.currency) : cur.title.slice(0, 18)));
    }
    return true;
  }
  async function refresh(id) {
    const it = byId(id);
    if (!it) return;
    it.loading = true;
    render(); if (S.sheet && S.sheet.id === id) openDetail(id);
    try {
      if (S.api) {
        await flush();
        const r = await api('refresh', { id });
        Object.assign(it, r.item);
      } else {
        const before = it.price;
        applyInfo(it, await fetchLocal(it.src || it.url, it.title), Date.now());
        if (before && it.price && before !== it.price) { /* 変化あり */ }
      }
      toast(it.price ? '最新の値段：' + yen(it.price, it.currency) : '値段は見つかりませんでした');
    } catch (e) {
      toast('取得できませんでした：' + e.message);
    }
    delete it.loading;
    persist();
    render(); if (S.sheet && S.sheet.id === id) openDetail(id);
  }
  function update(id, patch, quiet) {
    const it = byId(id);
    if (!it) return;
    Object.assign(it, patch, { updatedAt: Date.now() });
    if (patch.price != null && patch.price !== '' && !it.loading) {
      it.hist = it.hist || [];
      const last = it.hist[it.hist.length - 1];
      if (!last || last[1] !== patch.price) it.hist.push([Date.now(), patch.price]);
      it.checkedAt = Date.now(); it.guess = false;
    }
    save(id);
    if (!quiet) render();
  }
  function remove(id) {
    const it = byId(id);
    if (!it) return;
    const i = S.items.indexOf(it);
    S.items.splice(i, 1);
    S.pend.del[id] = 1;
    delete S.pend.up[id];
    persist();
    closeSheet();
    render();
    toast('削除しました', '元に戻す', () => {
      S.items.splice(i, 0, it);
      delete S.pend.del[id];
      save(id);
      render();
    }, 5000);
    setTimeout(() => { if (S.pend.del[id]) flush().catch(() => { }); }, 5200);
  }

  /* ---------------- 画面 ---------------- */
  function render() {
    renderTabs();
    const m = $('#main');
    if (S.tab === 'bought') m.innerHTML = vBought();
    else if (S.tab === 'set') m.innerHTML = vSettings();
    else m.innerHTML = vWant();
  }
  function renderHead() {
    const b = $('#syncBtn');
    if (b) b.classList.toggle('spin', S.syncing);
  }
  function renderTabs() {
    const t = [['want', 'ほしい物', I.heartO], ['bought', '買った', I.bag], ['set', '設定', I.gear]];
    $('#tabbar').innerHTML = t.map(([k, n, ic]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${ic}<span>${n}</span></button>`).join('');
  }
  function syncBtn() {
    return S.api ? `<button id="syncBtn" class="icon-btn ${S.syncing ? 'spin' : ''}" data-act="sync" aria-label="同期">${I.sync}</button>` : '';
  }

  function sorted(list) {
    const p = x => x.price || 0;
    const f = {
      new: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      pri: (a, b) => (b.pri || 0) - (a.pri || 0) || (b.addedAt || 0) - (a.addedAt || 0),
      cheap: (a, b) => (p(a) || 1e12) - (p(b) || 1e12),
      high: (a, b) => p(b) - p(a),
      drop: (a, b) => ((trend(b) || {}).pct || 0) - ((trend(a) || {}).pct || 0) || (b.addedAt || 0) - (a.addedAt || 0),
    }[S.sort] || ((a, b) => 0);
    return list.slice().sort((a, b) => (b.loading ? 1 : 0) - (a.loading ? 1 : 0) || f(a, b));
  }
  function vWant() {
    const all = want();
    const list = sorted(S.filter === 'all' ? all : S.filter === 'none' ? all.filter(x => !catOf(x.cat)) : all.filter(x => x.cat === S.filter));
    const jp = list.filter(x => x.price && (!x.currency || x.currency === 'JPY'));
    const total = jp.reduce((s, x) => s + x.price, 0);
    const drops = list.filter(x => { const t = trend(x); return t && t.diff > 0; });
    const targets = list.filter(isTarget);
    const must = jp.filter(x => (x.pri || 0) >= 3).reduce((s, x) => s + x.price, 0);
    const noPrice = list.filter(x => !x.price && !x.loading).length;

    // カテゴリ別の割合
    let bar = '';
    if (S.filter === 'all' && total && jp.some(x => catOf(x.cat))) {
      const by = {};
      jp.forEach(x => { const k = catOf(x.cat) ? x.cat : ''; by[k] = (by[k] || 0) + x.price; });
      bar = '<div class="catbar">' + Object.keys(by).sort((a, b) => by[b] - by[a]).map(k => `<i style="flex:${by[k]};background:${k ? catColor(k) : 'var(--sub)'}" title="${esc(k ? catOf(k).name : '未分類')}"></i>`).join('') + '</div>';
    }
    const pills = [];
    if (drops.length) pills.push(`<span class="pill down">↓ 値下がり中 ${drops.length}件</span>`);
    if (targets.length) pills.push(`<span class="pill gold">★ 目標価格 ${targets.length}件</span>`);
    if (noPrice) pills.push(`<span class="pill" style="background:var(--field);color:var(--sub)">値段なし ${noPrice}件</span>`);

    const counts = {};
    all.forEach(x => { const k = catOf(x.cat) ? x.cat : 'none'; counts[k] = (counts[k] || 0) + 1; });
    const chips = [`<button class="chip ${S.filter === 'all' ? 'on' : ''}" data-act="filter" data-v="all">すべて <span class="n">${all.length}</span></button>`]
      .concat(cats().filter(c => counts[c.id]).map(c => `<button class="chip ${S.filter === c.id ? 'on' : ''}" data-act="filter" data-v="${esc(c.id)}">${esc(c.emoji || '')} ${esc(c.name)} <span class="n">${counts[c.id]}</span></button>`))
      .concat(counts.none && cats().some(c => counts[c.id]) ? [`<button class="chip ${S.filter === 'none' ? 'on' : ''}" data-act="filter" data-v="none">未分類 <span class="n">${counts.none}</span></button>`] : []);

    const sortName = (SORTS.find(s => s[0] === S.sort) || SORTS[0])[1];
    return `
      <div class="page-h"><h1>ほしい物</h1>${syncBtn()}</div>
      ${S.oldScript ? '<div class="banner">Apps Script が古いようです。Code.gs を貼り替えて「新バージョン」でデプロイし直してください（共有ボタンからの読み取りが強くなります）</div>' : ''}
      <form class="addbar" data-form="add" autocomplete="off" novalidate>
        <svg class="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
        <input id="addInput" name="u" type="text" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="商品のリンクを貼り付け" enterkeyhint="go">
        <button type="button" class="btn soft" data-act="paste" id="pasteBtn">${I.paste}貼り付け</button>
      </form>
      ${all.length ? `
      <div class="card sum">
        <div class="sum-top">
          <div><div class="lbl">${S.filter === 'all' ? 'ぜんぶ買うと' : esc(S.filter === 'none' ? '未分類' : catOf(S.filter).name) + 'をぜんぶ買うと'}</div><div class="big num">${yen(total) || '¥0'}</div></div>
          <div class="sum-side">${list.length}個<br>${must ? `<span style="color:var(--accent)">${I.heart.replace('<svg', '<svg style="width:11px;height:11px;vertical-align:-1px"')}</span>3つ <b class="num">¥${man(must)}</b>` : ''}</div>
        </div>
        ${bar}
        ${pills.length ? `<div class="pills">${pills.join('')}</div>` : ''}
      </div>
      <div class="chips">${chips.join('')}</div>
      <div class="tools"><span class="cnt">${list.length}件</span>
        <label class="sel">${esc(sortName)}${I.down}<select data-act="sort">${SORTS.map(s => `<option value="${s[0]}" ${S.sort === s[0] ? 'selected' : ''}>${s[1]}</option>`).join('')}</select></label>
      </div>
      ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : '<div class="empty"><p>このカテゴリにはまだありません</p></div>'}
      ` : vEmpty()}`;
  }
  function vEmpty() {
    return `<div class="empty">
      <div class="em">🛍️</div>
      <h3>ほしい物を集めよう</h3>
      <p>Amazon・楽天・ユニクロなどの商品ページのリンクを上に貼り付けると、写真と値段を自動で取ってきます。</p>
      <p class="small" style="margin-top:14px">${S.api ? 'iPhone の共有ボタンから追加する方法は <button class="link" data-act="tab" data-v="set">設定</button> にあります' : '<button class="link" data-act="tab" data-v="set">設定</button> でスプレッドシートとつなぐと、値下がりチェックや共有ボタンからの追加ができます'}</p>
    </div>`;
  }
  function card(it) {
    if (it.loading && !it.addedAt) it.addedAt = Date.now();
    const t = trend(it);
    const badges = [];
    if (it.loading) badges.push('<span class="bdg">読み込み中…</span>');
    if (isTarget(it)) badges.push('<span class="bdg gold">目標価格</span>');
    if (t && t.diff > 0) badges.push(`<span class="bdg down">↓${Math.max(1, Math.round(t.pct * 100))}%</span>`);
    if (it.stock === 'out') badges.push('<span class="bdg out">在庫なし</span>');
    const hearts = '♥'.repeat(Math.max(0, (it.pri || 0) - 1));
    return `<button class="it ${it.loading ? 'loading' : ''} ${it.err ? 'err' : ''}" data-act="open" data-id="${esc(it.id)}">
      <div class="it-img">${it.loading ? '' : imgTag(it.img, initial(it))}<div class="badges">${badges.join('')}</div>${hearts ? `<span class="hearts-mini">${hearts}</span>` : ''}</div>
      <div class="it-b">
        <div class="it-t">${esc(it.title)}</div>
        <div class="it-p num">${it.price ? yen(it.price, it.currency) + (it.guess ? '<span class="q"> 目安</span>' : '') + (t && t.diff > 0 ? `<s>${yen(t.first, it.currency)}</s>` : '') : '<span class="muted" style="font-size:13px;font-weight:600">値段 —</span>'}</div>
        <div class="it-s">${it.err ? esc(it.err) : esc(siteLabel(it))}</div>
      </div>
    </button>`;
  }

  function vBought() {
    const list = bought().slice().sort((a, b) => String(b.boughtAt || '').localeCompare(String(a.boughtAt || '')) || (b.updatedAt || 0) - (a.updatedAt || 0));
    const y = new Date().getFullYear();
    const amt = x => Number(x.paid || x.price || 0);
    const thisYear = list.filter(x => String(x.boughtAt || '').startsWith(String(y)));
    const ty = thisYear.reduce((s, x) => s + amt(x), 0);
    const saved = list.reduce((s, x) => { const t = (x.hist || [])[0]; return s + (t && x.paid && t[1] > x.paid ? t[1] - x.paid : 0); }, 0);
    const groups = {};
    list.forEach(x => { const k = String(x.boughtAt || '').slice(0, 7) || '日付なし'; (groups[k] = groups[k] || []).push(x); });
    return `
      <div class="page-h"><h1>買った</h1>${syncBtn()}</div>
      ${list.length ? `
      <div class="card sum">
        <div class="sum-top">
          <div><div class="lbl">${y}年に買った</div><div class="big num">${yen(ty)}</div></div>
          <div class="sum-side">${thisYear.length}個${saved ? `<br><b class="num" style="color:var(--down)">${yen(saved)}</b> おトク` : ''}</div>
        </div>
      </div>
      ${Object.keys(groups).map(k => {
        const g = groups[k];
        const label = /^\d{4}-\d{2}$/.test(k) ? Number(k.slice(0, 4)) + '年' + Number(k.slice(5)) + '月' : k;
        return `<div class="sec-h"><span>${label}</span><span class="num">${yen(g.reduce((s, x) => s + amt(x), 0))}</span></div>
        <div class="card rows">${g.map(x => `<button class="row" data-act="open" data-id="${esc(x.id)}">
          <div class="th">${imgTag(x.img, initial(x))}</div>
          <div class="mid"><b>${esc(x.title)}</b><span>${md(x.boughtAt)} · ${esc(siteLabel(x))}</span></div>
          <div class="amt num">${yen(amt(x), x.currency)}</div></button>`).join('')}</div>`;
      }).join('')}
      ` : `<div class="empty"><div class="em">🎁</div><h3>まだありません</h3><p>ほしい物の詳細で「買った！」を押すと、ここにたまっていきます。</p></div>`}`;
  }

  function vSettings() {
    const c = S.config;
    return `
      <div class="page-h"><h1>設定</h1></div>
      <div class="sec-h">スプレッドシート連携</div>
      <div class="card set">
        <div class="fld">
          ${S.api ? `<div style="font-weight:700"><span class="ok-dot"></span>つながっています</div>
            <p>最後の同期：${S.lastSync ? ago(S.lastSync) : '—'}　・　値段は6時間ごとに自動で確認します</p>
            <div style="display:flex;gap:8px;margin-top:12px"><button class="btn sm soft" data-act="sync">${I.sync}今すぐ同期</button><button class="btn sm gray" data-act="unlink">連携をやめる</button></div>`
          : `<div style="font-weight:700">この端末だけに保存中</div>
            <p>Googleスプレッドシートとつなぐと、ほかの端末でも見られて、<b>値下がりの自動チェック＆メール通知</b>と <b>iPhoneの共有ボタンから追加</b> が使えるようになります。</p>
            <form data-form="api" style="display:flex;gap:8px;margin-top:12px"><input class="inp" name="u" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"><button class="btn primary sm" style="height:44px">接続</button></form>`}
        </div>
        <div class="fld"><details ${S.api ? '' : 'open'}><summary>つなぎ方（最初の1回だけ）</summary>
          <ol class="steps">
            <li>Googleドライブで新しいスプレッドシートを作り、名前を「ほしい物データ」にする</li>
            <li>メニューの 拡張機能 → Apps Script を開き、中身を全部消して <a class="link" href="https://github.com/maomax0427/wishlist/blob/main/apps-script/Code.gs" target="_blank" rel="noopener">Code.gs</a> の内容を貼り付けて保存</li>
            <li>上の関数の選択で <code>setup</code> を選んで「実行」→ 権限を許可（「安全ではないページ」→ 詳細 → 移動）</li>
            <li>右上の デプロイ → 新しいデプロイ → 種類「ウェブアプリ」<br>次のユーザーとして実行：<b>自分</b>／アクセスできるユーザー：<b>全員</b> → デプロイ</li>
            <li>出てきた ウェブアプリの URL（…/exec）をコピーして、上の欄に貼って「接続」</li>
          </ol>
          <p>URL は他の人に教えないでください。この端末のリストは、つないだときにスプレッドシートへ移します。</p>
        </details></div>
      </div>

      <div class="sec-h">iPhoneの共有ボタンから追加</div>
      <div class="card set"><div class="fld">
        ${S.api ? `<p style="margin-top:0">Amazon や Safari の <b>共有 → 「ほしい物に追加」</b> で、アプリを開かずに登録できるようにします（ショートカットを1つ作ります）。iPhone でページを読むので、<b>Amazon の値段や、ボット対策のある公式通販（ZOZO・H&amp;M・パタゴニアなど）も読めます</b>。</p>
        <p>Mac で Claude が作った <b>「ほしい物に追加.shortcut」</b> をダブルクリック → 下の URL を貼る だけで、iCloud 経由で iPhone にも入ります。<br><button class="btn sm soft" style="margin-top:8px" data-act="copy" data-v="${esc(S.api)}">スクリプトの URL をコピー</button></p>
        <details style="margin-top:10px"><summary>自分で作る場合の手順</summary>
          <ol class="steps">
            <li>「ショートカット」アプリ → 右上の ＋ → 名前を「ほしい物に追加」に。下の ⓘ（詳細）で <b>「共有シートに表示」をオン</b></li>
            <li><b>「入力からURLを取得」</b>（入力は「ショートカットの入力」）→ <b>「リストから項目を取得」</b>（最初の項目）</li>
            <li><b>「URLの内容を取得」</b>（URL は「リストの項目」）。▶ を開いて「ヘッダ」に追加：キー <code>User-Agent</code>、値は ↓<br><button class="btn sm soft" style="margin-top:6px" data-act="copy" data-v="${esc(SAFARI_UA)}">User-Agent の値をコピー</button></li>
            <li><b>「Base64エンコード」</b>（入力は「URLの内容」、改行は「なし」）</li>
            <li>もう1つ <b>「URLの内容を取得」</b>。URL にスクリプトの URL を貼り、▶ で 方法：<b>POST</b>、本文を要求：<b>JSON</b>、フィールド（すべて「テキスト」）：<br>
              <code>action</code> → <code>add</code>、<code>url</code> → 「リストの項目」、<code>text</code> → 「ショートカットの入力」、<code>html64</code> → 「Base64エンコードされた結果」</li>
            <li><b>「辞書の値を取得」</b>（キー <code>message</code>）→ <b>「通知を表示」</b>（本文に「辞書の値」）</li>
          </ol>
          <p>あとは商品ページで 共有 → 「ほしい物に追加」。数秒〜十数秒で「追加しました：○○ ¥12,800」と通知が出ます。</p>
        </details>` : `<p style="margin:0">スプレッドシートとつなぐと使えます。今は、商品ページのリンクをコピーして「ほしい物」タブの <b>貼り付け</b> ボタンを押してください。</p>`}
      </div></div>

      ${S.api ? `<div class="sec-h">通知</div>
      <div class="card set"><div class="fld"><div class="fld-row"><div><div style="font-weight:600">値下がりしたらメール</div><p>Gmail に「値下がり：○○ ¥12,800」と届きます。目標価格を入れた商品は、その値段以下になったときにも届きます。</p></div>
        <label class="sw"><input type="checkbox" data-act="notify" ${c.notify !== false ? 'checked' : ''}><i></i></label></div></div></div>` : ''}

      <div class="sec-h">カテゴリ</div>
      <div class="card set"><div class="fld">
        ${cats().map((ct, i) => `<div class="catrow"><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span>
          <input class="inp emo" data-act="catEmoji" data-id="${esc(ct.id)}" value="${esc(ct.emoji || '')}" maxlength="4">
          <input class="inp" data-act="catName" data-id="${esc(ct.id)}" value="${esc(ct.name)}">
          <button class="x" data-act="catDel" data-id="${esc(ct.id)}" aria-label="削除">${I.x}</button></div>`).join('')}
        <button class="btn sm soft" style="margin-top:12px" data-act="catAdd">＋ カテゴリを追加</button>
      </div></div>

      <div class="sec-h">バックアップ</div>
      <div class="card set"><div class="fld">
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm gray" data-act="export">書き出す（JSON）</button><label class="btn sm gray">読み込む<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
        <p>商品 ${S.items.length}件（ほしい ${want().length}・買った ${bought().length}）</p>
      </div></div>
      <p class="small muted" style="text-align:center;margin-top:24px">ほしい物リスト ・ 商品ページの読み取りは r.jina.ai も使います</p>`;
  }

  /* ---------------- シート（詳細・入力） ---------------- */
  function openSheet(html, opt) {
    S.sheet = opt || {};
    const sh = $('#sheet');
    sh.className = 'sheet' + (S.sheet.tall ? ' tall' : '');
    sh.innerHTML = '<div class="grab"></div>' + html;
    sh.hidden = false;
    $('#sheetBack').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    S.sheet = null;
    $('#sheet').hidden = true;
    $('#sheetBack').hidden = true;
    document.body.style.overflow = '';
  }
  function chartSvg(it) {
    const h = (it.hist || []).filter(x => x[1]);
    if (h.length < 2) return '';
    const pts = h.concat([[Date.now(), it.price || h[h.length - 1][1]]]);
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const vs = pts.map(p => p[1]);
    let lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi === lo) { hi += 1; lo -= 1; }
    const W = 300, H = 100, X0 = 0, Y = v => 8 + (1 - (v - lo) / (hi - lo)) * (H - 22), Xp = t => X0 + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * W;
    let d = '';
    pts.forEach((p, i) => { const x = Xp(p[0]).toFixed(1), y = Y(p[1]).toFixed(1); d += i ? ` H${x} V${y}` : `M${x} ${y}`; });
    const minP = pts.reduce((m, p) => p[1] < m[1] ? p : m, pts[0]);
    const fmtD = ms => { const x = new Date(ms); return (x.getMonth() + 1) + '/' + x.getDate(); };
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="0" x2="${W}" y1="${Y(minP[1])}" y2="${Y(minP[1])}" stroke="var(--down)" stroke-dasharray="3 4" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".6"/>
      <path d="${d} V${H} H0 Z" fill="var(--accent-soft)" opacity=".7"/>
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      </svg><div class="cl"><span>${fmtD(t0)}</span><span>最安 ${yen(minP[1], it.currency)}・最高 ${yen(Math.max.apply(null, vs), it.currency)}</span><span>今</span></div></div>`;
  }
  function openDetail(id) {
    const it = byId(id);
    if (!it) return;
    const t = trend(it);
    const imgs = (it.images || []).length ? it.images : it.img ? [it.img] : [];
    const order = it.img && imgs.includes(it.img) ? [it.img].concat(imgs.filter(u => u !== it.img)) : imgs;
    const gal = order.length
      ? `<div class="gal"><div class="gal-in" id="gal">${order.map(u => `<div><img src="${esc(u)}" alt="" referrerpolicy="no-referrer"><div class="ph" style="display:none;position:absolute;inset:0">${initial(it)}</div></div>`).join('')}</div>
         ${order.length > 1 ? `<div class="dots">${order.map((u, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div><span class="main-tag" id="galTag">メイン</span><button class="main-btn" id="galMain" data-act="setMain" data-id="${esc(id)}" hidden>この写真にする</button>` : ''}</div>`
      : `<div class="gal"><div class="gal-in"><div><div class="ph" style="position:absolute;inset:0">${initial(it)}</div></div></div></div>`;
    const priceLine = it.loading ? '<span class="muted">読み込み中…</span>' : it.price
      ? `<span class="p num">${yen(it.price, it.currency)}</span>${it.guess ? '<span class="pill" style="background:var(--field);color:var(--sub)">目安</span>' : ''}${it.listPrice && it.listPrice > it.price ? `<s class="num">${yen(it.listPrice, it.currency)}</s>` : ''}${t && t.diff > 0 ? `<span class="pill down">登録時より ↓${yen(t.diff, it.currency)}</span>` : t && t.diff < 0 ? `<span class="pill" style="background:var(--red-soft);color:var(--red)">登録時より ↑${yen(-t.diff, it.currency)}</span>` : ''}`
      : `<div style="width:100%"><div class="lbl" style="margin-bottom:6px">値段が読み取れませんでした。わかれば入れておくと合計に入ります</div><div class="yen-inp"><span class="muted">¥</span><input class="inp num" type="number" inputmode="numeric" data-act="setPrice" data-id="${esc(id)}" placeholder="値段を入力"></div></div>`;
    const meta = [];
    if (it.stock === 'out') meta.push('<span class="pill" style="background:#555;color:#fff">在庫なし</span>');
    if (t && t.lowest && t.diff > 0) meta.push('<span style="color:var(--down);font-weight:700">これまでで最安</span>');
    if (it.checkedAt) meta.push((S.api ? '値段の確認：' : '値段の取得：') + ago(it.checkedAt));
    meta.push('追加：' + ago(it.addedAt));
    const isB = it.status === 'bought';
    openSheet(`
      <div class="sh-h"><span></span><button class="x" data-act="close" aria-label="閉じる">${I.x}</button></div>
      ${gal}
      <div class="d-site">${esc(siteLabel(it))}${it.brand ? ' · ' + esc(it.brand) : ''}</div>
      <div class="d-title">${esc(it.title)}</div>
      <div class="d-price">${priceLine}</div>
      <div class="d-meta">${meta.join('<span>·</span>')}</div>
      ${it.err ? `<div class="err-box">${esc(it.err)}。${S.api ? 'iPhone の共有ボタン（ショートカット「ほしい物に追加」）から追加し直すと、ほとんどのサイトで読めます。' : '設定でスプレッドシートとつなぎ、共有ボタン用のショートカットを入れると、ほとんどのサイトで読めるようになります。'}「編集」から手で入れることもできます。</div>` : ''}
      ${isB ? `<div class="card" style="margin-top:14px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center"><div><div class="lbl">買った日</div><b>${esc(it.boughtAt || '—')}</b></div><div style="text-align:right"><div class="lbl">払った金額</div><b class="num">${yen(it.paid || it.price, it.currency) || '—'}</b></div></div>` : ''}
      <div class="d-acts">
        <a class="btn primary ${isB ? 'wide' : ''}" href="${esc(it.url || it.src)}" target="_blank" rel="noopener">ショップで見る${I.ext}</a>
        ${isB ? '' : `<button class="btn green" data-act="buy" data-id="${esc(id)}">${I.check}買った！</button>`}
      </div>
      ${!isB && (it.hist || []).length > 1 ? `<div class="sec-h" style="margin-top:20px"><span>値段の動き</span></div><div class="card pad">${chartSvg(it)}</div>` : ''}
      ${isB ? '' : `
      <div class="sec-h"><span>整理</span></div>
      <div class="card">
        <div class="fld fld-row"><span class="lbl" style="margin:0">ほしい度</span><div class="hearts">${[1, 2, 3].map(v => `<button data-act="pri" data-id="${esc(id)}" data-v="${v}" class="${(it.pri || 0) >= v ? 'on' : ''}" aria-label="ほしい度${v}">${I.heart}</button>`).join('')}</div></div>
        <div class="fld"><span class="lbl">カテゴリ</span><div class="catpick">${cats().map(c => `<button data-act="cat" data-id="${esc(id)}" data-v="${esc(c.id)}" class="${it.cat === c.id ? 'on' : ''}">${esc(c.emoji || '')} ${esc(c.name)}</button>`).join('')}</div></div>
        <div class="fld"><span class="lbl">目標価格${S.api ? '（この値段以下になったらメールで知らせる）' : '（この値段以下になったら印がつく）'}</span><div class="yen-inp"><span class="muted">¥</span><input class="inp num" type="number" inputmode="numeric" data-act="target" data-id="${esc(id)}" value="${it.target || ''}" placeholder="${it.price ? Math.round(it.price * 0.9 / 100) * 100 : ''}"></div></div>
        <div class="fld"><span class="lbl">メモ（サイズ・色など）</span><textarea class="inp" data-act="memo" data-id="${esc(id)}" placeholder="M サイズ / ブラック など">${esc(it.memo || '')}</textarea></div>
      </div>`}
      <div class="d-acts" style="margin-top:16px">
        ${isB ? `<button class="btn gray" data-act="unbuy" data-id="${esc(id)}">${I.undo}ほしい物に戻す</button>` : `<button class="btn gray" data-act="refresh" data-id="${esc(id)}" ${it.loading ? 'disabled' : ''}>${I.sync}値段を再取得</button>`}
        <button class="btn gray" data-act="edit" data-id="${esc(id)}">${I.edit}編集</button>
        <button class="btn danger wide" data-act="del" data-id="${esc(id)}">${I.trash}削除</button>
      </div>`, { id, tall: true });
    const g = $('#gal');
    if (g && order.length > 1) {
      g.addEventListener('scroll', () => {
        const i = Math.round(g.scrollLeft / g.clientWidth);
        document.querySelectorAll('.gal .dots i').forEach((d, k) => d.classList.toggle('on', k === i));
        const isMain = order[i] === (it.img || order[0]);
        $('#galTag').hidden = !isMain;
        const b = $('#galMain');
        b.hidden = isMain;
        b.dataset.v = order[i];
      }, { passive: true });
    }
  }
  function openBuy(id) {
    const it = byId(id);
    openSheet(`
      <div class="sh-h"><h2>🎉 買いました</h2><button class="x" data-act="close">${I.x}</button></div>
      <form class="form" data-form="buy" data-id="${esc(id)}">
        <div class="muted small" style="margin:0 2px">${esc(it.title)}</div>
        <label class="lbl fl">払った金額</label>
        <div class="yen-inp"><span class="muted">¥</span><input class="inp num" name="paid" type="number" inputmode="numeric" value="${it.price || ''}"></div>
        <label class="lbl fl">買った日</label>
        <input class="inp" name="date" type="date" value="${ymd(new Date())}">
        <button class="btn primary block" style="margin-top:18px">「買った」に移す</button>
      </form>`, { id: null });
  }
  function openEdit(id) {
    const it = id ? byId(id) : { images: [], currency: 'JPY' };
    const imgs = (it.images || []).slice();
    if (it.img && !imgs.includes(it.img)) imgs.unshift(it.img);
    openSheet(`
      <div class="sh-h"><h2>${id ? '編集' : '手で追加'}</h2><button class="x" data-act="close">${I.x}</button></div>
      <form class="form" data-form="edit" novalidate data-id="${esc(id || '')}">
        <label class="lbl fl">商品名</label>
        <input class="inp" name="title" value="${esc(it.title || '')}" required>
        <label class="lbl fl">値段</label>
        <div class="yen-inp"><span class="muted">${it.currency && it.currency !== 'JPY' ? esc(it.currency) : '¥'}</span><input class="inp num" name="price" type="number" inputmode="decimal" step="any" value="${it.price || ''}"></div>
        ${imgs.length ? `<label class="lbl fl">写真（タップでメインに）</label><div class="thumbs">${imgs.map(u => `<button type="button" data-act="pickImg" data-v="${esc(u)}" class="${u === it.img ? 'on' : ''}"><img src="${esc(u)}" referrerpolicy="no-referrer" alt=""></button>`).join('')}</div><input type="hidden" name="img" value="${esc(it.img || '')}">` : '<input type="hidden" name="img" value="">'}
        <label class="lbl fl">写真の URL を追加（任意）</label>
        <input class="inp" name="imgUrl" type="url" placeholder="https://…jpg">
        <label class="lbl fl">ショップ・商品ページの URL</label>
        <input class="inp" name="url" type="url" value="${esc(it.url || '')}" placeholder="https://">
        <label class="lbl fl">ショップ名</label>
        <input class="inp" name="site" value="${esc(it.site || '')}">
        <button class="btn primary block" style="margin-top:18px">保存</button>
      </form>`, { id: null });
  }

  /* ---------------- 操作 ---------------- */
  function toast(msg, btn, fn, ms) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${btn ? `<button>${esc(btn)}</button>` : ''}`;
    t.hidden = false;
    if (btn) t.querySelector('button').onclick = () => { t.hidden = true; fn(); };
    clearTimeout(S.toastT);
    S.toastT = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  async function pasteAdd() {
    let txt = '';
    try { txt = await navigator.clipboard.readText(); } catch (e) { }
    const inp = $('#addInput');
    if (!txt) { if (inp) inp.focus(); toast('欄に貼り付けて「Enter」で追加できます'); return; }
    if (!X.findUrl(txt).url) { toast('コピーした中にリンクがありません'); return; }
    if (inp) inp.value = '';
    addFromText(txt);
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT' && el.type !== 'checkbox' || el.tagName === 'TEXTAREA') return;
    const a = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
    switch (a) {
      case 'tab': S.tab = v; store.set(K.tab, v); closeSheet(); render(); scrollTo(0, 0); break;
      case 'filter': S.filter = v; pref.filter = v; store.set(K.pref, pref); render(); break;
      case 'paste': pasteAdd(); break;
      case 'sync': sync(); break;
      case 'open': openDetail(id); break;
      case 'close': closeSheet(); break;
      case 'buy': openBuy(id); break;
      case 'unbuy': update(id, { status: 'want', boughtAt: '', paid: null }); closeSheet(); toast('ほしい物に戻しました'); break;
      case 'refresh': refresh(id); break;
      case 'edit': openEdit(id); break;
      case 'del': if (confirm('「' + (byId(id) || {}).title + '」を削除しますか？')) remove(id); break;
      case 'pri': {
        const it = byId(id); const n = Number(v) === it.pri && it.pri > 1 ? Number(v) - 1 : Number(v);
        update(id, { pri: n }, true);
        el.parentNode.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i < n));
        render(); break;
      }
      case 'cat': {
        const it = byId(id); const nv = it.cat === v ? '' : v;
        update(id, { cat: nv }, true);
        el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === nv));
        render(); break;
      }
      case 'setMain': update(id, { img: el.dataset.v }); openDetail(id); toast('メインの写真にしました'); break;
      case 'pickImg': {
        const f = el.closest('form');
        f.img.value = v;
        f.querySelectorAll('.thumbs button').forEach(b => b.classList.toggle('on', b === el));
        break;
      }
      case 'unlink':
        if (confirm('スプレッドシートとの連携をやめますか？（スプレッドシートのデータは消えません。この端末には今のリストが残ります）')) {
          S.api = ''; store.del(K.api); S.pend = { up: {}, del: {}, cfg: false }; persist(); render();
        }
        break;
      case 'copy': navigator.clipboard.writeText(v).then(() => toast('コピーしました'), () => toast('コピーできませんでした')); break;
      case 'notify': S.config.notify = el.checked; saveCfg(); break;
      case 'catAdd': S.config.categories = cats().concat([{ id: uid(), name: '新しいカテゴリ', emoji: '✨' }]); saveCfg(); render(); break;
      case 'catDel': {
        const c = catOf(id);
        const n = S.items.filter(x => x.cat === id).length;
        if (!confirm('「' + c.name + '」を削除しますか？' + (n ? '（' + n + '件は未分類になります）' : ''))) break;
        S.config.categories = cats().filter(x => x.id !== id);
        S.items.filter(x => x.cat === id).forEach(x => { x.cat = ''; S.pend.up[x.id] = 1; });
        if (S.filter === id) S.filter = 'all';
        saveCfg(); render(); break;
      }
      case 'export': {
        const blob = new Blob([JSON.stringify({ app: 'wishlist', at: Date.now(), items: S.items, config: S.config }, null, 1)], { type: 'application/json' });
        const u = URL.createObjectURL(blob);
        const aa = document.createElement('a');
        aa.href = u; aa.download = 'wishlist-' + ymd(new Date()) + '.json';
        document.body.appendChild(aa); aa.click(); aa.remove();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
        break;
      }
    }
  });
  $('#sheetBack').addEventListener('click', closeSheet);

  document.addEventListener('change', e => {
    const el = e.target;
    const a = el.dataset && el.dataset.act;
    if (!a) return;
    const id = el.dataset.id;
    if (a === 'sort') { S.sort = el.value; pref.sort = el.value; store.set(K.pref, pref); render(); }
    else if (a === 'target') { const n = Number(el.value); update(id, { target: n > 0 ? n : null, alerted: 0 }, true); render(); }
    else if (a === 'memo') update(id, { memo: el.value }, true);
    else if (a === 'setPrice') { const n = Number(el.value); if (n > 0) { update(id, { price: n, currency: 'JPY' }); openDetail(id); } }
    else if (a === 'catName' || a === 'catEmoji') {
      const c = catOf(id);
      if (!c) return;
      if (a === 'catName') c.name = el.value.trim() || c.name; else c.emoji = el.value.trim();
      saveCfg();
    } else if (a === 'import') {
      const f = el.files && el.files[0];
      if (!f) return;
      f.text().then(t => {
        const j = JSON.parse(t);
        if (!Array.isArray(j.items)) throw new Error('形式が違います');
        const have = {};
        S.items.forEach(x => { have[x.id] = 1; });
        const add = j.items.filter(x => x && x.id && !have[x.id]);
        S.items = S.items.concat(add);
        if (j.config && j.config.categories) {
          const ids = {};
          cats().forEach(c => { ids[c.id] = 1; });
          S.config.categories = cats().concat(j.config.categories.filter(c => !ids[c.id]));
          S.pend.cfg = true;
        }
        save(add.map(x => x.id));
        render();
        toast(add.length + '件を読み込みました');
      }).catch(err => toast('読み込めませんでした：' + err.message));
    }
  });

  document.addEventListener('submit', e => {
    const f = e.target;
    const kind = f.dataset.form;
    if (!kind) return;
    e.preventDefault();
    if (kind === 'add') {
      const v = f.u.value.trim();
      if (!v) { pasteAdd(); return; }
      f.u.value = '';
      f.u.blur();
      addFromText(v);
    } else if (kind === 'api') {
      const u = f.u.value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(u)) { toast('Apps Script のウェブアプリURL（…/exec）を貼ってください'); return; }
      connect(u);
    } else if (kind === 'buy') {
      const id = f.dataset.id;
      update(id, { status: 'bought', paid: Number(f.paid.value) || null, boughtAt: f.date.value || ymd(new Date()) });
      closeSheet();
      toast('🎉 おめでとう！「買った」に移しました');
    } else if (kind === 'edit') {
      const id = f.dataset.id;
      const price = Number(f.price.value) || null;
      const extra = f.imgUrl.value.trim();
      const patch = { title: f.title.value.trim(), url: f.url.value.trim(), site: f.site.value.trim(), img: f.img.value };
      const it = id ? byId(id) : null;
      const images = (it && it.images || []).slice();
      if (extra) { images.unshift(extra); patch.img = extra; }
      patch.images = images;
      if (!patch.img && images.length) patch.img = images[0];
      if (patch.title) patch.err = '';
      if (id) {
        if (price !== it.price) patch.price = price;
        if (patch.url && !it.src) patch.src = patch.url;
        update(id, patch);
        openDetail(id);
      } else {
        const now = Date.now();
        const n = Object.assign({ id: uid(), src: patch.url, price, currency: 'JPY', cat: '', pri: 2, memo: '', status: 'want', addedAt: now, updatedAt: now, checkedAt: price ? now : 0, hist: price ? [[now, price]] : [], stock: '', shop: '', brand: '', err: '' }, patch);
        if (!n.site && n.url) n.site = X.siteOf(n.url);
        S.items.unshift(n);
        save(n.id);
        render();
        closeSheet();
      }
    }
  });

  async function connect(u) {
    toast('接続中…', null, null, 20000);
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'load' }) }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || '応答がありません');
      S.api = u;
      store.set(K.api, u);
      // この端末のリストをスプレッドシートへ
      const have = {};
      (r.items || []).forEach(x => { have[x.id] = 1; });
      S.items.forEach(x => { if (!have[x.id]) S.pend.up[x.id] = 1; });
      if (!r.config) S.pend.cfg = true;
      persist();
      await sync(true);
      toast('つながりました！');
    } catch (e) {
      toast('接続できませんでした：' + e.message + '（デプロイの「アクセスできるユーザー」が「全員」か確認してください）', null, null, 6000);
    }
  }

  /* ---------------- 起動 ---------------- */
  // 共有（Android）や ?add= で開かれたとき
  function incoming() {
    const p = new URLSearchParams(location.search);
    const txt = [p.get('add'), p.get('url'), p.get('text'), p.get('title')].filter(Boolean).join(' ');
    if (!txt) return;
    history.replaceState(null, '', location.pathname);
    if (X.findUrl(txt).url) addFromText(txt);
  }
  render();
  incoming();
  if (S.api) sync(true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.api && Date.now() - S.lastSync > 60000) sync(true);
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
