/**
 * ほしい物リスト — 保存・商品情報の取得・値下がりチェック用 Apps Script
 *
 * スプレッドシート「ほしい物データ」の 拡張機能 → Apps Script に貼り付けて:
 *   1. 関数「setup」を一度実行（権限を承認。値下がりチェックを6時間ごとに動かす設定もここで入ります）
 *   2. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        次のユーザーとして実行：自分 / アクセスできるユーザー：全員
 *   発行された URL をアプリの 設定 → 連携 に貼ります（他人に教えないこと）。
 *
 * 更新するとき: コードを貼り替えて保存 → setup を実行 →
 *   デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ（URL はそのまま）
 *
 * シート
 *   items  … 1商品1行。最後の data 列がアプリ用の元データ（ほかの列は見る・分析する用）
 *   config … アプリの設定（A2 に JSON）
 *
 * 商品ページの読み取りルールは GitHub Pages の extract.js を読み込んで使います（このスクリプトの貼り直しは不要）。
 * iPhone のショートカットからは GET  <このURL>?add=<商品のURL>  で追加できます。
 */
const VERSION = 2;
const EXTRACT_URL = 'https://maomax0427.github.io/wishlist/extract.js';
const ITEM_SHEET = 'items';
const CFG_SHEET = 'config';
const HEAD = ['id', '名前', '価格', 'ショップ', 'カテゴリ', 'ほしい度', '状態', '追加日', '購入日', '購入価格', '最安値', '目標価格', 'URL', '画像', 'メモ', '価格確認', 'data'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const ss_ = () => SpreadsheetApp.getActiveSpreadsheet();

function setup() {
  itemSheet_();
  cfgSheet_();
  const first = ss_().getSheetByName('シート1') || ss_().getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss_().getSheets().length > 1) ss_().deleteSheet(first);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkPrices').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkPrices').timeBased().everyHours(6).create();
  UrlFetchApp.fetch(EXTRACT_URL, { muteHttpExceptions: true });   // 外部取得の権限を承認させる
  MailApp.getRemainingDailyQuota();                                 // 値下がりメールの権限
}

function itemSheet_() {
  let sh = ss_().getSheetByName(ITEM_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(ITEM_SHEET);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}
function cfgSheet_() {
  let sh = ss_().getSheetByName(CFG_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(CFG_SHEET);
    sh.getRange('A1').setValue('config (JSON)').setFontWeight('bold');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
// ショートカット用: ?add=<URL or 共有テキスト>&cat=<カテゴリ名>
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.add) {
    try {
      const it = add_({ text: p.add, cat: p.cat || '' });
      const price = it.price ? ' ' + fmt_(it.price, it.currency) : '';
      return json_({ ok: true, message: it.err ? '追加しました（情報は取れませんでした）' : '追加しました：' + short_(it.title, 40) + price, item: it });
    } catch (err) {
      return json_({ ok: false, message: '追加できませんでした：' + (err && err.message || err) });
    }
  }
  return json_({ ok: true, app: 'wishlist', version: VERSION });
}
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    switch (req.action) {
      case 'load': return json_({ ok: true, version: VERSION, items: readItems_().items, config: readConfig_(), at: Date.now() });
      case 'add': return json_({ ok: true, item: add_(req) });
      case 'fetch': return json_({ ok: true, info: fetchInfo_(req.url, req.hint || '') });
      case 'refresh': return json_({ ok: true, item: refresh_(req.id) });
      case 'upsert': return json_(withLock_(() => ({ ok: true, items: upsert_(req.items || []) })));
      case 'delete': return json_(withLock_(() => { delete_(req.ids || []); return { ok: true }; }));
      case 'saveConfig': cfgSheet_().getRange('A2').setValue(JSON.stringify(req.config || {})); return json_({ ok: true });
      default: return json_({ ok: false, error: 'unknown action: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- 読み書き ---------- */
function readConfig_() {
  const v = cfgSheet_().getRange('A2').getValue();
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function readItems_() {
  const sh = itemSheet_();
  const n = sh.getLastRow() - 1;
  const items = [], row = {};
  if (n < 1) return { items, row };
  sh.getRange(2, 1, n, HEAD.length).getValues().forEach((r, i) => {
    if (!r[0]) return;
    let it = null;
    try { it = JSON.parse(r[HEAD.length - 1]); } catch (e) { }
    if (!it) return;
    it.id = String(r[0]);
    items.push(it);
    row[it.id] = i + 2;
  });
  return { items, row };
}
function day_(ms) { return ms ? Utilities.formatDate(new Date(ms), 'Asia/Tokyo', 'yyyy-MM-dd') : ''; }
const DEF_CAT_NAMES = { fashion: 'ファッション', gadget: 'ガジェット', home: 'くらし', beauty: 'コスメ', book: '本・ゲーム', hobby: '趣味' };
function rowOf_(it, cats) {
  const cat = (cats || []).find(c => c.id === it.cat) || (DEF_CAT_NAMES[it.cat] && !(cats || []).length ? { name: DEF_CAT_NAMES[it.cat] } : null);
  const low = (it.hist || []).reduce((m, h) => Math.min(m, h[1]), Infinity);
  return [it.id, it.title || '', it.price || '', it.shop ? it.site + '（' + it.shop + '）' : it.site || '', cat ? cat.name : '', it.pri || '',
    it.status === 'bought' ? '購入済み' : 'ほしい', day_(it.addedAt), it.boughtAt || '', it.paid || '', isFinite(low) ? low : '', it.target || '',
    it.url || '', it.img || '', it.memo || '', it.checkedAt ? new Date(it.checkedAt) : '', JSON.stringify(it)];
}
function writeItem_(it, cur) {
  const cats = ((readConfig_() || {}).categories) || [];
  const sh = itemSheet_();
  const r = cur.row[it.id];
  if (r) sh.getRange(r, 1, 1, HEAD.length).setValues([rowOf_(it, cats)]);
  else {
    sh.appendRow(rowOf_(it, cats));
    cur.row[it.id] = sh.getLastRow();
  }
}
// アプリからの保存。値段の確認結果（price/hist/stock など）は新しい方を残す
const PRICE_KEYS = ['price', 'currency', 'listPrice', 'hist', 'stock', 'checkedAt', 'guess', 'alerted'];
function upsert_(list) {
  const cur = readItems_();
  const byId = {};
  cur.items.forEach(it => { byId[it.id] = it; });
  const cats = ((readConfig_() || {}).categories) || [];
  const sh = itemSheet_();
  const out = [], append = [];
  list.forEach(inc => {
    if (!inc || !inc.id) return;
    const old = byId[inc.id];
    const it = Object.assign({}, inc);
    if (old && (old.checkedAt || 0) > (inc.checkedAt || 0)) PRICE_KEYS.forEach(k => { it[k] = old[k]; });
    delete it.loading;
    out.push(it);
    if (cur.row[it.id]) sh.getRange(cur.row[it.id], 1, 1, HEAD.length).setValues([rowOf_(it, cats)]);
    else append.push(rowOf_(it, cats));
  });
  if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, HEAD.length).setValues(append);
  return out;
}
function delete_(ids) {
  const cur = readItems_();
  const sh = itemSheet_();
  ids.map(id => cur.row[id]).filter(Boolean).sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
}

/* ---------- 商品ページの読み取り ---------- */
function X_() {
  if (globalThis.WishExtract) return globalThis.WishExtract;
  const cache = CacheService.getScriptCache();
  let code = cache.get('extract:v' + VERSION);
  if (!code) {
    const res = UrlFetchApp.fetch(EXTRACT_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('読み取りルールを読み込めませんでした（' + res.getResponseCode() + '）');
    code = res.getContentText('UTF-8');
    try { cache.put('extract:v' + VERSION, code, 3600); } catch (e) { }
  }
  (0, eval)(code);
  return globalThis.WishExtract;
}
// 文字コード（EUC-JP・Shift_JIS のサイトがある）を見て本文を取り出す
function text_(res) {
  const ct = String((res.getHeaders() || {})['Content-Type'] || (res.getHeaders() || {})['content-type'] || '');
  let cs = (ct.match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) cs = sniffCharset_(res.getContentText('ISO-8859-1'));
  return decodeAs_(cs, c => res.getContentText(c), () => res.getContentText());
}
function sniffCharset_(latin1) {
  return (String(latin1).slice(0, 8000).match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
}
function decodeAs_(cs, fn, fallback) {
  cs = String(cs || 'UTF-8').toLowerCase();
  if (/euc/.test(cs)) cs = 'EUC-JP';
  else if (/sjis|shift|ms932|windows-31j|cp932/.test(cs)) cs = 'Shift_JIS';
  else cs = 'UTF-8';
  try { return fn(cs); } catch (e) { return fallback(); }
}
// ショートカットが iPhone で読んだページ（Base64）を文字列に戻す
function fromB64_(b64) {
  const blob = Utilities.newBlob(Utilities.base64Decode(String(b64).replace(/\s+/g, '')));
  const cs = sniffCharset_(blob.getDataAsString('ISO-8859-1'));
  return decodeAs_(cs, c => blob.getDataAsString(c), () => blob.getDataAsString());
}
function fetchInfo_(url, hint) {
  const X = X_();
  let best = null;
  const steps = X.plan(url);
  url = X.normUrl(url);
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    try {
      // r.jina.ai にブラウザの User-Agent を送ると弾かれるので、そのまま取得するときだけ付ける
      const headers = Object.assign(st.kind === 'direct' ? { 'User-Agent': UA, 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.6' } : {}, st.headers || {});
      const res = UrlFetchApp.fetch(st.url, { headers, muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: false });
      const code = res.getResponseCode();
      if (code >= 400 && st.kind === 'direct' && code !== 404) continue;
      const r = X.parse(text_(res), url, hint);
      if (code === 404) r.notFound = true;
      best = X.better(best, r);
      if (r.ok && r.price && !r.guess) break;
      if (r.notFound) break;
    } catch (err) { }
  }
  if (!best) best = X.parse('', url, hint);
  return best;
}

const uid_ = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function add_(req) {
  const X = X_();
  const f = X.findUrl(req.text || '');
  if (req.url) f.url = String(req.url);
  if (req.hint) f.hint = req.hint;
  if (!f.url) throw new Error('URL が見つかりません');
  // ショートカットが iPhone で読み込んだページ（html）があれば先に使う（Amazon は海外からだと値段が出ないことがあるため）
  let info = null;
  if (req.html || req.html64) {
    try { info = X.parse(req.html64 ? fromB64_(req.html64) : String(req.html), f.url, f.hint || ''); } catch (e) { }
  }
  if (!info || !info.ok || !info.price) info = X.better(info, fetchInfo_(f.url, f.hint || req.hint || ''));
  const now = Date.now();
  const cfg = readConfig_() || {};
  const cats = cfg.categories || [{ id: 'fashion' }, { id: 'gadget' }, { id: 'home' }, { id: 'beauty' }, { id: 'book' }, { id: 'hobby' }];
  let cat = req.cat || '';
  if (cat && !cats.some(c => c.id === cat)) {
    const c = cats.find(c => c.name === cat);
    cat = c ? c.id : '';
  }
  if (!cat && X.guessCat) cat = X.guessCat(info, cats);
  const it = {
    id: req.id || uid_(), url: info.url || f.url, src: f.url, title: info.title || f.hint || X.host(f.url),
    price: info.price || null, currency: info.currency || 'JPY', listPrice: info.listPrice || null, guess: !!info.guess,
    images: info.images || [], img: (info.images || [])[0] || '', site: info.site || X.siteOf(f.url), shop: info.shop || '', brand: info.brand || '', stock: info.stock || '',
    cat, pri: req.pri || 2, memo: '', target: null, status: 'want',
    addedAt: now, updatedAt: now, checkedAt: info.price ? now : 0, hist: info.price ? [[now, info.price]] : [],
    err: info.ok ? '' : info.notFound ? 'ページが見つかりませんでした' : info.blocked ? 'ボット対策で読めませんでした（共有ボタンから追加すると読めます）' : '商品情報を読み取れませんでした',
  };
  withLock_(() => writeItem_(it, readItems_()));
  return it;
}
// 1件だけ今すぐ値段を確かめる
function refresh_(id) {
  const cur = readItems_();
  const it = cur.items.find(x => x.id === id);
  if (!it) throw new Error('見つかりません');
  const info = fetchInfo_(it.src || it.url, it.title);
  applyInfo_(it, info, Date.now());
  withLock_(() => writeItem_(it, readItems_()));
  return it;
}
function applyInfo_(it, info, now) {
  const before = it.price;
  if (info.price && !(info.guess && it.price && !it.guess)) {
    it.price = info.price;
    it.currency = info.currency || it.currency;
    it.guess = !!info.guess;
    it.hist = it.hist || [];
    const last = it.hist[it.hist.length - 1];
    if (!last || last[1] !== info.price) it.hist.push([now, info.price]);
    if (it.hist.length > 200) it.hist = it.hist.slice(-200);
  }
  if (info.listPrice) it.listPrice = info.listPrice;
  if (info.stock) it.stock = info.stock;
  if ((!it.title || it.err) && info.title) it.title = info.title;
  if (info.images && info.images.length) {
    const seen = {};
    it.images = (it.images || []).concat(info.images).filter(u => !seen[u] && (seen[u] = 1)).slice(0, 16);
    if (!it.img) it.img = it.images[0];
  }
  if (!it.site && info.site) it.site = info.site;
  if (info.ok) it.err = '';
  it.checkedAt = now;
  return before;
}

/* ---------- 値下がりチェック（6時間ごと） ---------- */
function checkPrices() {
  const t0 = Date.now();
  const cfg = readConfig_() || {};
  const cur = readItems_();
  const todo = cur.items.filter(it => it.status !== 'bought' && (it.src || it.url))
    .sort((a, b) => (a.checkedAt || 0) - (b.checkedAt || 0));
  const news = [];
  for (let i = 0; i < todo.length && Date.now() - t0 < 4.5 * 60 * 1000; i++) {
    const it = todo[i];
    if (Date.now() - (it.checkedAt || 0) < 5 * 3600 * 1000) break;   // 6時間以内に確認済みなら後回し
    let info;
    try { info = fetchInfo_(it.src || it.url, it.title); } catch (e) { continue; }
    const before = applyInfo_(it, info, Date.now());
    if (info.price && !info.guess && before && info.price < before) news.push({ it, before, kind: 'drop' });
    if (info.price && !info.guess && it.target && info.price <= it.target && !(it.alerted && it.alerted >= it.target)) {
      it.alerted = it.target;
      if (!news.some(n => n.it === it)) news.push({ it, before, kind: 'target' });
    }
    if (it.target && info.price > it.target) it.alerted = 0;
    withLock_(() => writeItem_(it, readItems_()));
  }
  if (news.length && cfg.notify !== false) mail_(news);
}
function fmt_(n, cur) {
  if (!n) return '';
  return cur && cur !== 'JPY' ? cur + ' ' + Number(n).toLocaleString('en-US') : '¥' + Math.round(n).toLocaleString('ja-JP');
}
function short_(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function mail_(news) {
  const to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  const first = news[0];
  const subject = news.length === 1
    ? (first.kind === 'target' ? '目標価格になりました：' : '値下がり：') + short_(first.it.title, 30) + ' ' + fmt_(first.it.price, first.it.currency)
    : 'ほしい物リスト：' + news.length + '件が値下がりしました';
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = news.map(n => {
    const it = n.it;
    const diff = n.before && it.price < n.before ? '<span style="color:#1F9D57;font-weight:700">↓ ' + fmt_(n.before - it.price, it.currency) + '</span>' : '';
    return '<tr><td style="padding:10px 12px 10px 0;vertical-align:top">' + (it.img ? '<img src="' + esc(it.img) + '" width="72" height="72" style="object-fit:contain;border-radius:10px;background:#fff;border:1px solid #eee">' : '') + '</td>'
      + '<td style="padding:10px 0;vertical-align:top;font-family:sans-serif"><a href="' + esc(it.url) + '" style="color:#111;text-decoration:none;font-weight:700">' + esc(short_(it.title, 60)) + '</a><br>'
      + '<span style="color:#888;font-size:12px">' + esc(it.site) + '</span><br>'
      + (n.before && n.before !== it.price ? '<s style="color:#999">' + fmt_(n.before, it.currency) + '</s> → ' : '') + '<b style="font-size:17px">' + fmt_(it.price, it.currency) + '</b> ' + diff
      + (n.kind === 'target' ? '<br><span style="color:#B87A00;font-weight:700">目標価格 ' + fmt_(it.target, it.currency) + ' 以下になりました</span>' : '') + '</td></tr>';
  }).join('');
  const html = '<div style="font-family:sans-serif"><table style="border-collapse:collapse">' + rows + '</table>'
    + '<p style="margin-top:16px"><a href="https://maomax0427.github.io/wishlist/" style="color:#E8475F;font-weight:700">ほしい物リストを開く</a></p></div>';
  MailApp.sendEmail({ to, subject, htmlBody: html, name: 'ほしい物リスト' });
}
