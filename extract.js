// ほしい物リスト — 商品ページから名前・写真・値段を読み取る
// アプリ（ブラウザ）と Apps Script の両方で使う。Apps Script はこのファイルを GitHub Pages から読み込むので、
// ここを直して push すれば、スクリプトを貼り直さなくても読み取りの改善が反映される。
(function (root) {
  const X = { version: 1 };

  const SITES = [
    [/(^|\.)amazon\.(co\.jp|com|jp)$|(^|\.)amzn\.(asia|to)$|^a\.co$/, 'Amazon'],
    [/(^|\.)rakuten\.co\.jp$|(^|\.)r10\.to$/, '楽天市場'],
    [/(^|\.)shopping\.yahoo\.co\.jp$|(^|\.)paypaymall\.yahoo\.co\.jp$/, 'Yahoo!ショッピング'],
    [/(^|\.)yodobashi\.com$/, 'ヨドバシ.com'],
    [/(^|\.)biccamera\.com$/, 'ビックカメラ'],
    [/(^|\.)zozo\.jp$/, 'ZOZOTOWN'],
    [/(^|\.)uniqlo\.com$/, 'ユニクロ'],
    [/(^|\.)gu-global\.com$/, 'GU'],
    [/(^|\.)muji\.com$/, '無印良品'],
    [/(^|\.)nitori-net\.jp$/, 'ニトリ'],
    [/(^|\.)mercari\.com$/, 'メルカリ'],
    [/(^|\.)apple\.com$/, 'Apple'],
    [/(^|\.)qoo10\.jp$/, 'Qoo10'],
    [/(^|\.)cosme\.(net|com)$/, '@cosme'],
    [/(^|\.)lohaco\.yahoo\.co\.jp$/, 'LOHACO'],
  ];
  const JINA = 'https://r.jina.ai/';

  /* ---------- URL まわり ---------- */
  // 共有されたテキスト（「商品名 https://...」）から URL と商品名のヒントを取り出す
  X.findUrl = function (text) {
    const s = String(text || '').trim();
    const m = s.match(/https?:\/\/[^\s<>"'「」（）()]+/);
    if (!m) {
      if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) return { url: 'https://' + s, hint: '' };
      return { url: '', hint: s };
    }
    const url = m[0].replace(/[、。,.!！]+$/, '');
    let hint = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    hint = cleanTitle(hint, '');
    return { url, hint };
  };
  X.host = function (url) {
    const m = String(url || '').match(/^https?:\/\/([^/?#:]+)/i);
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  };
  X.siteOf = function (url) {
    const h = X.host(url);
    for (const [re, name] of SITES) if (re.test(h)) return name;
    return h;
  };
  X.isAmazon = url => X.siteOf(url) === 'Amazon';
  X.asin = function (url) {
    const m = String(url || '').match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
    return m ? m[1].toUpperCase() : '';
  };
  // 同じ商品かどうかの判定用
  X.key = function (url) {
    const a = X.asin(url);
    if (a) return 'amazon:' + a;
    const u = String(url || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    return u.toLowerCase();
  };
  // 取得用に整える：#以降を落とし、日本語・空白をエンコード（%xx はそのまま）
  X.normUrl = function (url) {
    return String(url || '').trim().replace(/#.*$/, '').replace(/[^\x21-\x7e]+/g, s => encodeURIComponent(s));
  };
  // ボット対策で弾かれたページか
  X.isBlockedPage = function (html) {
    const t = ((String(html || '').match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1] || '').trim();
    return /^(access denied|forbidden|403|just a moment|attention required|robot check|hang tight|unfortunately we are unable|pardon our interruption|request rejected|アクセスが拒否)/i.test(t) || (String(html || '').length < 3000 && /captcha|challenge|errors\.edgesuite\.net/i.test(html));
  };
  // 読み込み方の順番。kind: direct（そのまま取得）/ jina（ブラウザで開いたページを r.jina.ai 経由で取得）
  X.plan = function (url) {
    url = X.normUrl(url);
    const jinaHeaders = { 'X-Return-Format': 'html' };
    if (X.isAmazon(url)) {
      jinaHeaders['X-Set-Cookie'] = 'i18n-prefs=JPY; lc-acbjp=ja_JP';
      return [{ kind: 'jina', url: JINA + url, headers: jinaHeaders }, { kind: 'direct', url }];
    }
    return [{ kind: 'direct', url }, { kind: 'jina', url: JINA + url, headers: jinaHeaders }];
  };

  /* ---------- 文字列 ---------- */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥', copy: '©', reg: '®', trade: '™', hellip: '…', ndash: '–', mdash: '—' };
  function dec(s) {
    return String(s == null ? '' : s)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
      .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m);
  }
  function safeChar(n) { try { return String.fromCodePoint(n); } catch (e) { return ''; } }
  const strip = s => dec(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

  function attrs(tag) {
    const out = {};
    const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = re.exec(tag))) out[m[1].toLowerCase()] = dec(m[3] != null ? m[3] : m[4] != null ? m[4] : m[5]);
    return out;
  }
  function abs(u, base) {
    u = String(u || '').trim();
    if (!u || /^data:/i.test(u)) return '';
    if (/^\/\//.test(u)) return 'https:' + u;
    if (/^https?:\/\//i.test(u)) return u;
    const m = String(base || '').match(/^(https?:\/\/[^/?#]+)([^?#]*)/i);
    if (!m) return '';
    if (u[0] === '/') return m[1] + u;
    return m[1] + m[2].replace(/[^/]*$/, '') + u;
  }

  // "¥36,500" "36,500円" "36500.0" "$1,234.50" → 数値
  X.num = function (v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
    let s = String(v).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[，]/g, ',');
    const m = s.match(/\d[\d,]*(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0].replace(/,/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  };
  function curOf(s, fallback) {
    s = String(s || '');
    if (/^[A-Z]{3}$/.test(s)) return s;
    if (/[¥￥円]|JPY/.test(s)) return 'JPY';
    if (/US\$|USD|\$/.test(s)) return 'USD';
    if (/€|EUR/.test(s)) return 'EUR';
    if (/£|GBP/.test(s)) return 'GBP';
    return fallback || '';
  }

  /* ---------- 読み取り ---------- */
  function metas(html) {
    const out = {};
    const re = /<meta\b[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const a = attrs(m[0]);
      const k = (a.property || a.name || a.itemprop || '').toLowerCase();
      if (!k || a.content == null) continue;
      (out[k] = out[k] || []).push(a.content);
    }
    return out;
  }
  function jsonLd(html) {
    const out = [];
    const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      let t = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
      let j = null;
      try { j = JSON.parse(t); } catch (e) {
        try { j = JSON.parse(t.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1')); } catch (e2) { }
      }
      if (j) out.push(j);
    }
    return out;
  }
  function typeIs(o, re) {
    const t = o && o['@type'];
    return Array.isArray(t) ? t.some(x => re.test(String(x).replace(/^https?:\/\/schema\.org\//i, ''))) : re.test(String(t || '').replace(/^https?:\/\/schema\.org\//i, ''));
  }
  function findProducts(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return out;
    if (Array.isArray(node)) { node.forEach(n => findProducts(n, out, depth + 1)); return out; }
    if (typeIs(node, /^(Product|ProductGroup|IndividualProduct|ProductModel|Book|Vehicle)$/i)) out.push(node);
    ['@graph', 'mainEntity', 'itemListElement', 'item', 'hasVariant'].forEach(k => node[k] && findProducts(node[k], out, depth + 1));
    return out;
  }
  function ldImages(v, out) {
    if (!v) return out;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(x => ldImages(x, out));
    else if (typeof v === 'object') ldImages(v.contentUrl || v.url || v.thumbnailUrl, out);
    return out;
  }
  function ldOffer(offers) {
    const list = [];
    (function walk(o) {
      if (!o) return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (typeof o !== 'object') return;
      list.push(o);
      if (o.offers) walk(o.offers);
    })(offers);
    for (const o of list) {
      const spec = Array.isArray(o.priceSpecification) ? o.priceSpecification[0] : o.priceSpecification;
      const price = X.num(o.price != null ? o.price : o.lowPrice != null ? o.lowPrice : spec && spec.price);
      if (price) return { price, currency: o.priceCurrency || (spec && spec.priceCurrency) || '', availability: String(o.availability || '') };
    }
    return list[0] ? { price: null, currency: list[0].priceCurrency || '', availability: String(list[0].availability || '') } : null;
  }

  function cleanTitle(t, site) {
    t = strip(t);
    if (!t) return '';
    t = t.replace(/^Amazon(\.co\.jp|\.com)?\s*[:：|｜]\s*/i, '')
      .replace(/^【楽天市場】\s*/, '')
      .replace(/^ヨドバシ\.com\s*-\s*/, '')
      .replace(/\s*通販【[^】]*】\s*$/, '')
      .replace(/\s*[:：]\s*(本|家電&カメラ|ホーム&キッチン|ファッション|ドラッグストア|ビューティー|おもちゃ|ゲーム|食品・飲料・お酒|文房具・オフィス用品|スポーツ&アウトドア|パソコン・周辺機器|Kindleストア|ミュージック|DVD|Software|ペット用品|ベビー&マタニティ|DIY・工具・ガーデン|車&バイク|産業・研究開発用品|腕時計|ジュエリー|シューズ&バッグ|楽器・音響機器|Electronics|Home & Kitchen)\s*$/, '');
    if (/^Amazon/.test(site) || /\|\s*Amazon\s*$/.test(t)) t = t.split(/\s+[|｜]\s*/)[0];   // 「商品名 | 著者 |本 | 通販 | Amazon」
    // 「商品名 | ショップ名」のショップ側を落とす
    const parts = t.split(/\s+[|｜]\s+|\s*｜\s*/);
    if (parts.length > 1) {
      const lowSite = String(site || '').toLowerCase();
      const keep = parts.filter(p => {
        const l = p.toLowerCase();
        return !(lowSite && (l === lowSite || l.indexOf(lowSite) >= 0 && l.length < lowSite.length + 12)) &&
          !/公式|通販|オンラインストア|online ?store|official/i.test(p);
      });
      if (keep.length) t = keep.join(' | ');
    }
    if (site === '楽天市場') t = t.replace(/[：:][^：:]{1,40}$/, '');   // 末尾の「：ショップ名」
    return t.trim();
  }

  function goodImage(u) {
    return u && /^https?:\/\//i.test(u) && !/\.(svg|gif)(\?|$)/i.test(u) &&
      !/(logo|icon|sprite|favicon|banner|blank|spacer|pixel|loading|transparent|badge|button|nav[-_]|\/ads?\/|swatch|chip)/i.test(u) &&
      !/[_-](40|50|60|70|80|100)\.(jpe?g|png|webp)|[?&](w|wid|width)=([1-9]\d?|1[0-4]\d)(&|$)|\$[^$]*swatch[^$]*\$/i.test(u);
  }

  // Amazon 専用
  function amazon(html, r, url) {
    const t = html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i);
    if (t) r.title = strip(t[1]);
    let price = null;
    const hid = html.match(/customerVisiblePrice\]\[amount\]["']?\s+value=["']([\d.]+)/i);
    if (hid) price = X.num(hid[1]);
    if (!price) {
      for (const id of ['corePriceDisplay_desktop_feature_div', 'corePrice_feature_div', 'corePrice_desktop', 'apex_desktop', 'tp_price_block_total_price_ww', 'priceblock_ourprice', 'priceblock_dealprice', 'kindle-price', 'id="price"', 'booksHeaderSection']) {
        const i = html.indexOf(id);
        if (i < 0) continue;
        const seg = html.slice(i, i + 4000);
        const m = seg.match(/a-offscreen["'][^>]*>\s*([^<]+)/) || seg.match(/[¥￥]\s*[\d,]+/);
        if (m && X.num(m[1] || m[0])) { price = X.num(m[1] || m[0]); r.currency = curOf(m[1] || m[0], 'JPY'); break; }
      }
    }
    if (!price) { const m = html.match(/"priceAmount"\s*:\s*([\d.]+)/); if (m) price = X.num(m[1]); }
    if (price) { r.price = price; r.currency = r.currency || (/amazon\.com\//.test(url) ? 'USD' : 'JPY'); }
    const lp = html.match(/basisPrice[\s\S]{0,600}?a-offscreen["'][^>]*>\s*([^<]+)/);
    if (lp && X.num(lp[1]) > (r.price || 0)) r.listPrice = X.num(lp[1]);
    const imgs = [];
    let m;
    const reHi = /"hiRes"\s*:\s*"(https:[^"]+)"/g;
    while ((m = reHi.exec(html)) && imgs.length < 10) imgs.push(m[1]);
    const old = html.match(/data-old-hires=["'](https:[^"']+)/);
    if (old) imgs.unshift(old[1]);
    const dyn = html.match(/data-a-dynamic-image=["']([^"']+)/);
    if (dyn) { try { const o = JSON.parse(dec(dyn[1])); const k = Object.keys(o); if (k.length) imgs.push(k.sort((a, b) => o[b][0] - o[a][0])[0]); } catch (e) { } }
    const reLarge = /"large"\s*:\s*"(https:[^"]+)"/g;
    while ((m = reLarge.exec(html)) && imgs.length < 14) imgs.push(m[1]);
    r.images = imgs.concat(r.images);
    const asin = X.asin(url) || (html.match(/name=["']ASIN["'][^>]*value=["']([A-Z0-9]{10})/i) || [])[1] || (html.match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
    if (asin) {
      r.asin = asin;
      r.url = 'https://www.amazon.co.jp/dp/' + asin;
      if (!r.images.length) r.images.push('https://images-na.ssl-images-amazon.com/images/P/' + asin + '.09.LZZZZZZZ.jpg');
    }
    const ai = html.search(/id=["'](availability|outOfStock)["']/);
    if (ai >= 0) {
      const s = strip(html.slice(ai, ai + 1500).replace(/^[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/gi, ' ')).slice(0, 200);
      if (/在庫切れ|お取り扱いできません|unavailable|out of stock/i.test(s)) r.stock = 'out'; else if (/在庫あり|在庫\d|残り|in stock|通常/i.test(s)) r.stock = 'in';
    }
    r.noGuess = true;   // ページ内のほかの値段（関連商品など）を拾わない
    r.blocked = !r.title && (/captcha|automated access|api-services-support@amazon/i.test(html) || /<title[^>]*>\s*Amazon\.co\.jp\s*<\/title>/i.test(html));
    const brand = html.match(/id=["']bylineInfo["'][^>]*>([\s\S]{0,300}?)<\/a>/i);
    if (brand && !/星|stars|評価|rating/i.test(strip(brand[1]))) r.brand = strip(brand[1]).replace(/^by\s+/i, '').replace(/^(ブランド|Brand)\s*[:：]\s*|のストアを表示|\s*Store$|Visit the\s*|\s*ストア$/gi, '').trim();
  }


  // 写真が少ないとき：メイン画像と同じサーバー・同じ商品番号を含む画像だけ足す（バナーや関連商品を拾わない）
  function moreImages(html, r, url) {
    const found = [];
    const add = u => { u = abs(dec(String(u || '').trim().split(/\s+/)[0]), url); if (u && /\.(jpe?g|png|webp|avif)(\?|$)|\/is\/image\/|\/image\/|imgz|cdn/i.test(u)) found.push(u); };
    let m;
    const reImg = /<(?:img|source)\b[^>]*>/gi;
    while ((m = reImg.exec(html)) && found.length < 400) {
      const a = attrs(m[0]);
      [a['data-src'], a['data-original'], a['data-lazy-src'], a['data-zoom-image'], a['data-large'], a.src].forEach(add);
      const ss = a['data-srcset'] || a.srcset;
      if (ss) add(ss.split(',').pop());
    }
    const rePre = /<link\b[^>]*rel=["']preload["'][^>]*>/gi;
    while ((m = rePre.exec(html))) { const a = attrs(m[0]); if (/image/i.test(a.as || '')) add(a.href); }
    const main = abs(dec(r.images[0] || ''), url);
    if (main) {
      const host = X.host(main);
      const toks = main.replace(/^https?:\/\/[^/]+/, '').split(/[/_\-.?=&$,]+/).filter(t => t.length >= 5 && (t.match(/\d/g) || []).length >= 4);
      found.forEach(u => { if (X.host(u) === host && toks.some(t => u.indexOf(t) >= 0)) r.images.push(u); });
    } else {
      found.filter(u => !/(_s|thumb|small|icon|logo)/i.test(u)).slice(0, 6).forEach(u => r.images.push(u));
    }
  }
  // 値段の表示から読む：class に price が付いた要素、または「価格」の見出しのすぐ後ろ
  function pagePrice(html, r) {
    const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ').replace(/&yen;|&#165;|&#x0*a5;/gi, '¥');
    const yenIn = t => { const m = t.match(/[¥￥]\s*([\d,]{2,}(?:\.\d+)?)|([\d,]{3,})\s*円/); return m ? X.num(m[1] || m[2]) : null; };
    const cands = [];
    let m;
    const reCls = /<[a-z]+\b[^>]*class=["']([^"']*price[^"']*)["'][^>]*>/gi;
    while ((m = reCls.exec(body)) && cands.length < 6) {
      if (/old|before|regular|list|was|strike|original|reference|point|postage|shipping|range|filter|sort|label-only/i.test(m[1])) continue;
      const v = yenIn(strip(body.slice(m.index + m[0].length, m.index + m[0].length + 400)).slice(0, 40));
      if (v) cands.push([m.index, v]);
    }
    const reLbl = /(?:販売価格|本体価格|税込価格|価格|プライス)\s*(?:<[^>]*>\s*)*[:：]?/g;
    while ((m = reLbl.exec(body)) && cands.length < 12) {
      const v = yenIn(strip(body.slice(m.index + m[0].length, m.index + m[0].length + 300)).slice(0, 30));
      if (v) { cands.push([m.index, v]); break; }
    }
    if (cands.length) {
      cands.sort((a, b) => a[0] - b[0]);
      r.price = cands[0][1]; r.currency = 'JPY'; r.guess = false; r.fromPage = true;
      return;
    }
    // 本文の最初の「¥12,345」「12,345円（税込）」を目安として使う
    const g = body.match(/(?:[¥￥]\s*([\d,]{2,}))|(?:([\d,]{3,})\s*円\s*[（(]?税込)/);
    if (g) { r.price = X.num(g[1] || g[2]); r.currency = 'JPY'; r.guess = true; }
  }

  // html を読んで商品情報にする
  X.parse = function (html, url, hint) {
    html = String(html || '');
    const site = X.siteOf(url);
    const r = { title: '', price: null, currency: '', listPrice: null, images: [], site, brand: '', stock: '', url: url, guess: false, blocked: false };
    const mt = metas(html);
    const g = k => (mt[k] || [])[0] || '';

    // 1. 構造化データ（JSON-LD）
    const prods = [];
    jsonLd(html).forEach(j => findProducts(j, prods, 0));
    const p = prods.find(x => x.name && x.offers) || prods.find(x => x.name) || prods[0];
    if (p) {
      r.title = strip(p.name || '');
      ldImages(p.image, r.images);
      const b = p.brand && (typeof p.brand === 'string' ? p.brand : p.brand.name);
      if (b) r.brand = strip(Array.isArray(b) ? b[0] : b);
      let off = ldOffer(p.offers);
      if ((!off || !off.price) && p.hasVariant) { const v = [].concat(p.hasVariant).find(x => x && x.offers); if (v) { off = ldOffer(v.offers); ldImages(v.image, r.images); } }
      if (off) {
        if (off.price) { r.price = off.price; r.currency = curOf(off.currency, ''); }
        if (/OutOfStock|SoldOut|Discontinued/i.test(off.availability)) r.stock = 'out';
        else if (/InStock|LimitedAvailability|PreOrder/i.test(off.availability)) r.stock = 'in';
      }
    }
    // 2. meta タグ（OGP・商品メタ・microdata）
    if (!r.price) {
      const v = g('product:price:amount') || g('og:price:amount') || g('price') || g('product:sale_price:amount');
      if (X.num(v)) { r.price = X.num(v); r.currency = curOf(g('product:price:currency') || g('og:price:currency') || g('pricecurrency'), ''); }
    }
    if (!r.price) {
      const m = html.match(/<[^>]*\bitemprop=["']price["'][^>]*>/i);
      if (m) {
        const a = attrs(m[0]);
        let v = a.content || a.value;
        if (!v) { const after = html.slice(m.index + m[0].length, m.index + m[0].length + 200); v = strip(after.split('<')[0]); }
        if (X.num(v)) { r.price = X.num(v); r.currency = curOf(v, ''); }
      }
    }
    if (!r.currency && r.price) {
      const c = html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([A-Z]{3})|content=["']([A-Z]{3})["'][^>]*itemprop=["']priceCurrency/);
      r.currency = c ? (c[1] || c[2]) : '';
    }
    (mt['og:image'] || []).concat(mt['og:image:secure_url'] || [], mt['twitter:image'] || [], mt['twitter:image:src'] || [], mt['image'] || []).forEach(u => r.images.push(u));
    const ogTitle = g('og:title') || g('twitter:title');
    const siteName = g('og:site_name') || site;
    if (/amazon/i.test(siteName)) r.site = 'Amazon';
    else if (g('og:site_name') && !SITES.some(s => s[1] === site)) r.site = g('og:site_name');
    if (/rakuten/.test(X.host(url))) {
      const shop = (ogTitle.match(/[：:]([^：:]{1,40})$/) || [])[1];
      if (shop) r.shop = strip(shop);
    }
    // 3. サイト別
    if (!r.price && /(^|\.)(uniqlo\.com|gu-global\.com)$/.test(X.host(url))) {
      const m = html.match(/"prices"\s*:\s*\{\s*"base"\s*:\s*\{[^{}]*\{[^{}]*\}[^{}]*"value"\s*:\s*([\d.]+)[^{}]*\}(?:\s*,\s*"promo"\s*:\s*\{[^{}]*\{[^{}]*\}[^{}]*"value"\s*:\s*([\d.]+))?/);
      if (m) { const base = X.num(m[1]), promo = X.num(m[2]); r.price = promo || base; r.currency = 'JPY'; if (promo && base > promo) r.listPrice = base; }
    }
    if (r.site === 'Amazon' || X.isAmazon(url)) { r.site = 'Amazon'; amazon(html, r, url); }

    // 4. 最後の手段
    if (!r.title) r.title = ogTitle || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    r.title = cleanTitle(r.title, siteName);
    if (!r.title && hint) r.title = hint;
    if (r.images.length < 4) moreImages(html, r, url);
    if (!r.price && !r.noGuess) pagePrice(html, r);
    if (r.price && !r.currency) r.currency = /\.jp(\/|$)|\.jp\//.test(url + '/') || /[¥￥円]/.test(html.slice(0, 200000)) ? 'JPY' : '';
    if (r.currency === 'JPY' && r.price) r.price = Math.round(r.price);
    const canon = (html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [])[0];
    if (!r.asin) {
      const cu = canon ? attrs(canon).href : g('og:url');
      if (cu && /^https?:\/\//.test(cu) && X.host(cu)) r.url = cu;
    }

    const seen = {};
    r.images = r.images.map(u => abs(dec(u), url)).filter(u => {
      if (!goodImage(u)) return false;
      const k = u.replace(/\._[^/]*_\./, '.').replace(/[?#].*$/, '');
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).slice(0, 12);
    r.notFound = /お探しのページ|ページが見つかりません|該当する商品がありません|商品が見つかりません|存在しません|削除されました|販売を終了|^404|not found/i.test(r.title);
    if (X.isBlockedPage(html)) { r.blocked = true; r.title = hint || ''; r.images = []; r.price = null; }
    r.ok = !!(r.title && (r.price || r.images.length)) && !r.blocked && !r.notFound && !/^(access denied|forbidden|403|robot check|attention required|just a moment|エラー|error)/i.test(r.title);
    delete r.noGuess;
    return r;
  };

  // 2つの結果のうち良い方
  X.better = function (a, b) {
    if (!a) return b;
    if (!b) return a;
    const sc = r => (r.ok ? 100 : 0) + (r.title ? 10 : 0) + (r.price ? (r.guess ? 3 : 8) : 0) + Math.min(r.images.length, 5);
    return sc(b) > sc(a) ? b : a;
  };

  // 商品名からカテゴリを推測（最初から入っているカテゴリ用）
  const CAT_WORDS = {
    book: /コミックス|コミック|文庫|新書|単行本|小説|漫画|マンガ|画集|写真集|雑誌|ムック|Kindle|ゲームソフト|Nintendo Switch|Switch2|PS5|PlayStation|ボードゲーム|ISBN|\(著\)|著者/i,
    gadget: /イヤホン|ヘッドホン|ヘッドフォン|AirPods|iPhone|iPad|MacBook|Mac |スマホ|スマートフォン|タブレット|パソコン|ノートPC|モニター|ディスプレイ|キーボード|マウス|充電器|ケーブル|モバイルバッテリー|スピーカー|カメラ|レンズ|Apple Watch|スマートウォッチ|Bluetooth|USB|SSD|HDD|ガジェット|Anker|Galaxy|Pixel|Kindle端末|プロジェクター|ドライヤー|シェーバー/i,
    fashion: /\b(shirt|t-shirt|tee|polo|jacket|coat|parka|hoodie|sweat|sweater|knit|cardigan|pants|trousers|denim|jeans|skirt|dress|sneakers?|shoes|boots|bag|tote|cap|hat|socks)\b|BEAMS|UNITED ARROWS|SHIPS|Ralph Lauren|ラルフ ?ローレン|H&M|ZARA|COACH|パタゴニア|patagonia|ナイキ|NIKE|adidas|New Balance|ニューバランス|フリース|ブルゾン|ジャージ|ショーツ|Tシャツ|シャツ|パンツ|ジーンズ|デニム|スカート|ワンピース|ジャケット|コート|パーカ|Men's|Women's|スウェット|ニット|セーター|カーディガン|スニーカー|シューズ|ブーツ|サンダル|バッグ|リュック|財布|帽子|キャップ|ベルト|靴下|ソックス|腕時計|ネックレス|ピアス|指輪|リング|メンズ|レディース|ユニクロ|UNIQLO|ZOZO|アウター|トップス|ボトムス/i,
    beauty: /化粧水|乳液|美容液|クリーム|日焼け止め|ファンデーション|リップ|口紅|アイシャドウ|マスカラ|香水|フレグランス|シャンプー|コンディショナー|トリートメント|ヘアオイル|洗顔|クレンジング|コスメ|ネイル|スキンケア|パック/i,
    home: /収納|ラック|棚|チェア|椅子|テーブル|デスク|ソファ|ベッド|マットレス|枕|布団|カーテン|ラグ|照明|ライト|ランプ|鍋|フライパン|食器|マグ|グラス|タオル|掃除機|洗濯|加湿器|空気清浄機|扇風機|電子レンジ|炊飯器|ケトル|冷蔵庫|キッチン|インテリア|ニトリ|無印良品|生活雑貨|洗剤|ティッシュ/i,
    hobby: /キャンプ|アウトドア|テント|釣り|ゴルフ|ランニング|ヨガ|トレーニング|ダンベル|プロテイン|自転車|楽器|ギター|ピアノ|プラモデル|フィギュア|模型|画材|絵の具|手芸|ガーデニング|グッズ|ぬいぐるみ|トレカ|カード/i,
  };
  X.guessCat = function (info, cats) {
    const text = [info.title, info.brand, info.site].join(' ');
    const ids = (cats || []).map(c => c.id);
    // いちばん多く当てはまったカテゴリ（同数なら本→コスメ→ガジェット→ファッション→くらし→趣味の順）
    let best = '', bestN = 0;
    for (const id of ['book', 'beauty', 'gadget', 'fashion', 'home', 'hobby']) {
      if (ids.indexOf(id) < 0) continue;
      const n = (text.match(new RegExp(CAT_WORDS[id].source, 'gi')) || []).length;
      if (n > bestN) { best = id; bestN = n; }
    }
    if (best) return best;
    // 自分で作ったカテゴリは名前がそのまま入っていれば
    const c = (cats || []).find(c => c.name && c.name.length >= 2 && text.indexOf(c.name) >= 0);
    return c ? c.id : '';
  };

  root.WishExtract = X;
  if (typeof module !== 'undefined' && module.exports) module.exports = X;
})(typeof globalThis !== 'undefined' ? globalThis : this);
