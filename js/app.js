import * as db from './db.js';
import * as G from './gemini.js';
import * as I from './img.js';
import * as P from './prompts.js';

const $app = document.getElementById('app');
const state = { settings: null, draft: null };
const S = () => state.settings;

/* ================= helpers ================= */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
const anim = (el, i = 0) => { el.classList.add('rise'); el.style.setProperty('--i', i); return el; };

const urls = new Map();
const urlFor = (key, blob) => { if (!blob) return ''; if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob)); return urls.get(key); };

function toast(msg, type = '') {
  const t = h('div', { class: `toast ${type}` }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, type === 'error' ? 6000 : 2400);
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;top:0;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (btn) {
    if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
    btn.classList.add('copied'); btn.innerHTML = '✓ Copied';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = btn.dataset.label; }, 1600);
  }
}
const copyBtn = (getText, label = 'Copy', cls = '') => h('button', { class: `copy ${cls}`, onclick: (e) => { e.stopPropagation(); copyText(typeof getText === 'function' ? getText() : getText, e.currentTarget); } }, label);

function modal(content) {
  const back = h('div', { class: 'sheet-back' });
  const sheet = h('div', { class: 'sheet' }, h('div', { class: 'grabber' }), content);
  back.append(sheet);
  const close = () => { back.classList.add('out'); setTimeout(() => back.remove(), 250); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return { close };
}
function ask(title, { value = '', placeholder = '', ok = 'Save', multiline = false } = {}) {
  return new Promise((resolve) => {
    const input = multiline ? h('textarea', { class: 'field', rows: 3, placeholder }) : h('input', { class: 'field', placeholder });
    input.value = value;
    const m = modal(h('div', { class: 'stack' }, h('h3', {}, title), input,
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => { m.close(); resolve(null); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { m.close(); resolve(input.value.trim()); } }, ok))));
    setTimeout(() => input.focus(), 60);
  });
}
function confirmBox(title, text, ok = 'Delete') {
  return new Promise((resolve) => {
    const m = modal(h('div', { class: 'stack' }, h('h3', {}, title), h('p', { class: 'muted' }, text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn danger', onclick: () => { m.close(); resolve(true); } }, ok))));
  });
}
function pickFiles(multiple = true) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/*', multiple: multiple || null, style: 'display:none' });
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}
// Calls Gemini; if the model has no free quota, automatically tries other free models and remembers the one that works.
async function ask_ai(opts) {
  const tried = [];
  let names = null;
  let model = S().model;
  for (;;) {
    tried.push(model);
    try {
      const r = await G.generate({ apiKey: S().apiKey, model, ...opts });
      if (model !== S().model) {
        state.settings.model = model;
        await db.saveSettings(state.settings);
        toast(`Switched to ${model} (free on your key)`);
      }
      return r;
    } catch (e) {
      if (!G.isQuotaError(e)) throw e;
      if (!names) { try { names = await G.listModels(S().apiKey); } catch { names = G.FALLBACKS; } }
      const next = G.FALLBACKS.find((m) => names.includes(m) && !tried.includes(m));
      if (!next) throw new Error(e.message + ' — every free model is limited right now. Wait a minute (or until tomorrow if it says "per day") and try again.');
      model = next;
    }
  }
}
const b64part = async (blob) => ({ inline_data: { mime_type: 'image/jpeg', data: await I.blobToB64(blob) } });
const eur = (n) => (n == null || isNaN(n) ? '—' : `€${Math.round(Number(n))}`);
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const SHOT = { full_product: 'Full product', detail: 'Detail', label_or_tag: 'Tag / label', sole_or_bottom: 'Sole / bottom', packaging: 'Packaging', other: 'Other' };

/* ================= router ================= */
function route() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'scan' && b) return { name: 'scan', id: b };
  if (a === 'new') return { name: 'new' };
  if (a === 'settings') return { name: 'settings' };
  return { name: 'home' };
}
async function render() {
  const r = route();
  const view = r.name === 'scan' ? await viewScan(r.id) : r.name === 'new' ? viewNew() : r.name === 'settings' ? await viewSettings() : await viewHome();
  view.classList.add('page-enter');
  $app.replaceChildren(view);
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

/* ================= home ================= */
async function viewHome() {
  const scans = (await db.all('scans')).sort((a, b) => b.createdAt - a.createdAt);
  return h('div', { class: 'page' },
    h('header', { class: 'bar' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Reseller toolkit'), h('h1', {}, 'Listing Studio')),
      h('a', { class: 'icon', href: '#/settings', 'aria-label': 'Settings' }, gear())),
    !S().apiKey ? anim(h('a', { class: 'notice', href: '#/settings' }, h('b', {}, 'Connect Gemini'), h('span', {}, 'Add your free API key to start →'))) : null,
    anim(h('a', { class: 'hero', href: '#/new', onclick: () => { state.draft = null; } },
      h('div', { class: 'hero-glow' }),
      h('div', { class: 'hero-plus' }, '+'),
      h('div', {}, h('b', {}, 'New listing'), h('span', {}, 'Add photos → get background prompts, photo prompts, title, hashtags & price'))), 1),
    scans.length ? h('div', { class: 'section-title' }, 'Recent') : h('p', { class: 'empty muted' }, 'Your scanned products will be saved here.'),
    h('div', { class: 'list' }, scans.map((s, i) => anim(h('a', { class: 'item', href: `#/scan/${s.id}` },
      h('img', { src: urlFor(`${s.id}-0`, s.photos[0]), alt: '' }),
      h('div', { class: 'grow' }, h('b', {}, s.result?.listing?.title || s.result?.product?.name || 'Untitled'),
        h('small', { class: 'muted' }, `${s.photos.length} photos · ${fmtDate(s.createdAt)}`)),
      h('div', { class: 'price-pill' }, s.price?.suggested ? eur(s.price.suggested) : '›')), i + 2))));
}

/* ================= new scan ================= */
function viewNew() {
  state.draft ||= { photos: [], styleRef: null, notes: '' };
  const d = state.draft;
  const grid = h('div', { class: 'photo-grid' });
  const refSlot = h('div');
  const go = h('button', { class: 'btn primary big', onclick: () => analyzeDraft() }, '✦ Analyze photos');

  const paint = () => {
    grid.replaceChildren(
      ...d.photos.map((p, i) => h('div', { class: 'thumb pop' },
        h('img', { src: p.url, alt: '' }), h('span', { class: 'num' }, i + 1),
        h('button', { class: 'x', onclick: () => { d.photos.splice(i, 1); paint(); } }, '×'))),
      d.photos.length < 10 ? h('button', { class: 'thumb add', onclick: addPhotos }, h('span', {}, '+'), h('small', {}, 'Add photos')) : null);
    refSlot.replaceChildren(d.styleRef
      ? h('div', { class: 'ref' }, h('img', { src: d.styleRef.url, alt: '' }), h('div', { class: 'grow' }, h('b', {}, 'Style reference added'), h('small', { class: 'muted' }, 'Background idea #1 will match it')),
        h('button', { class: 'x static', onclick: () => { d.styleRef = null; paint(); } }, '×'))
      : h('button', { class: 'ref empty', onclick: addRef }, h('span', { class: 'ref-ico' }, '◐'), h('div', { class: 'grow' }, h('b', {}, 'Background style reference'), h('small', { class: 'muted' }, 'Optional — a photo of a background you like'))));
    go.disabled = !d.photos.length;
    go.textContent = d.photos.length ? `✦ Analyze ${d.photos.length} photo${d.photos.length > 1 ? 's' : ''}` : '✦ Analyze photos';
  };
  async function addPhotos() {
    for (const f of await pickFiles(true)) {
      if (d.photos.length >= 10) break;
      try { const { blob } = await I.normalize(f, 1280, 0.86); d.photos.push({ blob, url: URL.createObjectURL(blob) }); } catch (e) { toast(e.message, 'error'); }
    }
    paint();
  }
  async function addRef() {
    const [f] = await pickFiles(false);
    if (!f) return;
    const { blob } = await I.normalize(f, 1024, 0.85);
    d.styleRef = { blob, url: URL.createObjectURL(blob) }; paint();
  }
  const notes = h('textarea', { class: 'field', rows: 2, placeholder: 'Notes for the AI (optional) — e.g. "size 38, worn twice, comes with box"' });
  notes.value = d.notes;
  notes.addEventListener('input', () => { d.notes = notes.value; });
  paint();

  return h('div', { class: 'page' },
    h('header', { class: 'bar' }, h('a', { class: 'icon', href: '#/' }, '‹'), h('h2', {}, 'New listing'), h('span', { class: 'icon' })),
    anim(h('section', { class: 'card' }, h('div', { class: 'card-title' }, h('b', {}, 'Product photos'), h('small', { class: 'muted' }, 'Up to 10')), grid), 0),
    anim(refSlot, 1),
    anim(notes, 2),
    anim(h('div', { class: 'sticky-cta' }, go), 3));
}

/* ================= analysis ================= */
function loader() {
  const steps = ['Reading your photos', 'Identifying the product', 'Picking the best backgrounds', 'Writing prompts & listing'];
  const list = h('ul', { class: 'steps' }, steps.map((s) => h('li', {}, h('i'), s)));
  const el = h('div', { class: 'loader' }, h('div', { class: 'orb' }), h('h3', {}, 'Analyzing'), list);
  document.body.append(el);
  let i = 0;
  const lis = [...list.children];
  lis[0].classList.add('on');
  const iv = setInterval(() => { if (i < lis.length - 1) { lis[i].classList.replace('on', 'done'); lis[++i].classList.add('on'); } }, 2600);
  return {
    done() { clearInterval(iv); lis.forEach((l) => { l.classList.remove('on'); l.classList.add('done'); }); setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 350); },
    fail() { clearInterval(iv); el.classList.add('out'); setTimeout(() => el.remove(), 300); },
  };
}

async function analyze({ photos, styleRef, notes, id }) {
  if (!S().apiKey) { toast('Add your Gemini API key first.', 'error'); location.hash = '#/settings'; return; }
  const L = loader();
  try {
    const parts = [];
    for (const [i, b] of photos.entries()) parts.push({ text: `PHOTO ${i + 1}:` }, await b64part(b));
    if (styleRef) parts.push({ text: 'STYLE REFERENCE:' }, await b64part(styleRef));
    parts.push({ text: P.analyze({ count: photos.length, hasStyleRef: !!styleRef, notes, language: S().language }) });
    const { text } = await ask_ai({ parts, json: true });
    const result = normalize(G.parseJSON(text), photos.length);
    const scan = { id: id || db.uid(), createdAt: Date.now(), photos, styleRef: styleRef || null, notes, result, price: null };
    await db.put('scans', scan);
    L.done();
    state.draft = null;
    if (location.hash === `#/scan/${scan.id}`) render(); else location.hash = `#/scan/${scan.id}`;
    fetchPrice(scan.id);
  } catch (e) {
    L.fail();
    toast(e.message, 'error');
  }
}
const analyzeDraft = () => analyze({ photos: state.draft.photos.map((p) => p.blob), styleRef: state.draft.styleRef?.blob, notes: state.draft.notes });

function normalize(r, count) {
  r.product ||= {};
  r.listing ||= {};
  r.listing.hashtags = (r.listing.hashtags || []).map((t) => '#' + String(t).replace(/^#+/, '').replace(/\s+/g, '').toLowerCase()).filter((t) => t.length > 1);
  r.backgrounds = (r.backgrounds || []).slice(0, 4);
  const byN = new Map((r.photos || []).map((p, i) => [Number(p.n) || i + 1, p]));
  r.photos = Array.from({ length: count }, (_, i) => ({ n: i + 1, shot_type: 'other', camera_angle: 'top_down', keep: [], remove: [], ...(byN.get(i + 1) || {}) }));
  return r;
}

const priceBusy = new Set();
async function fetchPrice(id) {
  if (priceBusy.has(id)) return;
  const scan = await db.get('scans', id);
  if (!scan) return;
  priceBusy.add(id);
  scan.price = null;
  paintPrice(id, 'loading');
  try {
    let r;
    try { r = await ask_ai({ parts: [{ text: P.price(scan.result.product, scan.notes) }], json: true, search: S().useSearch }); }
    catch (e) { if (!S().useSearch || !G.isQuotaError(e)) throw e; r = await ask_ai({ parts: [{ text: P.price(scan.result.product, scan.notes) }], json: true }); } // search has its own quota
    const { text, sources } = r;
    scan.price = { ...G.parseJSON(text), sources: sources.slice(0, 4) };
  } catch (e) {
    scan.price = { error: e.message };
  }
  priceBusy.delete(id);
  const fresh = (await db.get('scans', id)) || scan;
  fresh.price = scan.price;
  await db.put('scans', fresh);
  paintPrice(id, null, fresh);
}

/* ================= scan result ================= */
async function viewScan(id) {
  const scan = await db.get('scans', id);
  if (!scan) { location.hash = '#/'; return h('div'); }
  const { product: p, photos, backgrounds, listing } = scan.result;
  const mainAngle = (photos.find((x) => ['full_product', 'packaging'].includes(x.shot_type)) || photos[0])?.camera_angle || 'top_down';
  let k = 0;

  const nav = h('nav', { class: 'tabs' },
    [['bg', 'Backgrounds'], ['ph', 'Photos'], ['li', 'Listing']].map(([a, l]) => h('button', { onclick: () => document.getElementById(a).scrollIntoView({ behavior: 'smooth', block: 'start' }) }, l)));

  const hero = h('section', { class: 'product' },
    h('div', { class: 'strip' }, scan.photos.map((b, i) => h('img', { src: urlFor(`${id}-${i}`, b), alt: '' }))),
    h('div', { class: 'eyebrow' }, [p.brand, p.category].filter(Boolean).join(' · ') || 'Product'),
    h('h1', { class: 'pname' }, p.name || [p.brand, p.model].filter(Boolean).join(' ') || 'Unknown product'),
    h('div', { class: 'chips' },
      p.condition ? h('span', { class: 'chip accent' }, p.condition) : null,
      p.size ? h('span', { class: 'chip' }, `Size ${p.size}`) : null,
      p.colour ? h('span', { class: 'chip' }, p.colour) : null,
      p.confidence && p.confidence !== 'high' ? h('span', { class: 'chip warn' }, `${p.confidence} confidence`) : null),
    p.condition_notes ? h('p', { class: 'muted small' }, p.condition_notes) : null);

  const how = h('details', { class: 'how' }, h('summary', {}, 'How to use these prompts'),
    h('ol', {},
      h('li', {}, 'Copy a ', h('b', {}, 'background'), ' prompt → paste into Gemini or Flow (Nano Banana 2) → download the background.'),
      h('li', {}, 'For each photo: new chat → attach ', h('b', {}, 'your photo first'), ', then ', h('b', {}, 'the background'), ' → paste that photo\'s prompt.'),
      h('li', {}, 'Zoom in and compare with your original. For tag close-ups, the original is often best.')));

  // backgrounds
  const bgCards = [
    ...backgrounds.map((b, i) => promptCard({
      title: b.name, sub: b.why, badge: i === 0 && scan.styleRef ? 'Matches your reference' : `Idea ${i + 1}`,
      text: P.background(b.scene, mainAngle, i === 0 && !!scan.styleRef),
      tip: i === 0 && scan.styleRef ? 'Attach your style reference photo together with this prompt.' : null,
    })),
    ...(S().styles || []).map((st) => promptCard({ title: st.name, sub: 'Your saved style', badge: 'Saved', text: P.background(st.scene, mainAngle) })),
  ];

  // photos
  const phCards = photos.map((ph, i) => {
    const close = ['label_or_tag', 'detail'].includes(ph.shot_type);
    return promptCard({
      thumb: urlFor(`${id}-${i}`, scan.photos[i]), title: `Photo ${i + 1}`, sub: ph.summary || SHOT[ph.shot_type] || '',
      badge: SHOT[ph.shot_type] || 'Photo', chips: ph.keep, text: P.photo(ph, p),
      tip: close ? 'Close-up: compare the label carefully. If anything changed, use your original photo.' : null,
    });
  });

  // listing
  const tags = (listing.hashtags || []).join(' ');
  const editable = (field, cls) => {
    const el = h('div', { class: `editable ${cls}`, contenteditable: 'true', spellcheck: 'false' }, listing[field] || '');
    el.addEventListener('blur', async () => { listing[field] = el.innerText.trim(); await db.put('scans', scan); });
    return el;
  };
  const titleEl = editable('title', 'ltitle');
  const descEl = editable('description', 'ldesc');
  const listingCard = h('section', { class: 'card listing' },
    h('div', { class: 'field-head' }, h('small', { class: 'label' }, `Title · ${(listing.title || '').length}/60`), copyBtn(() => titleEl.innerText.trim())), titleEl,
    h('div', { class: 'field-head' }, h('small', { class: 'label' }, 'Description'), copyBtn(() => descEl.innerText.trim())), descEl,
    h('div', { class: 'field-head' }, h('small', { class: 'label' }, 'Hashtags'), copyBtn(tags)),
    h('div', { class: 'tags' }, (listing.hashtags || []).map((t) => h('span', {}, t))),
    copyBtn(() => `${titleEl.innerText.trim()}\n\n${descEl.innerText.trim()}\n\n${tags}`, 'Copy everything', 'wide'));

  const priceBox = h('section', { class: 'card price', id: `price-${id}` });

  const page = h('div', { class: 'page' },
    h('header', { class: 'bar' }, h('a', { class: 'icon', href: '#/' }, '‹'), h('h2', {}, 'Results'),
      h('button', { class: 'icon', onclick: () => moreMenu(scan) }, '⋯')),
    anim(hero, k++), anim(nav, k++), anim(how, k++),
    h('div', { class: 'section-title', id: 'bg' }, 'Background prompts', h('small', {}, 'Generate one, download it')),
    bgCards.map((c) => anim(c, k++)),
    h('div', { class: 'section-title', id: 'ph' }, 'Photo prompts', h('small', {}, 'Your photo + background + prompt')),
    phCards.map((c) => anim(c, k++)),
    h('div', { class: 'section-title', id: 'li' }, 'Vinted listing'),
    anim(priceBox, k++), anim(listingCard, k++));
  setTimeout(() => paintPrice(id, scan.price ? null : 'loading', scan), 0);
  if (!scan.price) fetchPrice(id); // not fetched yet (or app was closed mid-way)
  return page;
}

function promptCard({ title, sub, badge, text, chips, thumb, tip }) {
  const body = h('pre', { class: 'ptext' }, text);
  const card = h('section', { class: 'card pcard' },
    h('div', { class: 'phead' },
      thumb ? h('img', { class: 'pthumb', src: thumb, alt: '' }) : h('div', { class: 'pthumb swatch' }, '◐'),
      h('div', { class: 'grow' }, badge ? h('span', { class: 'badge' }, badge) : null, h('b', {}, title), sub ? h('small', { class: 'muted' }, sub) : null),
      copyBtn(text, 'Copy')),
    chips?.length ? h('div', { class: 'keep' }, h('small', { class: 'label' }, 'Keeps'), h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip' }, c)))) : null,
    tip ? h('p', { class: 'tip' }, tip) : null,
    body,
    h('button', { class: 'more', onclick: (e) => { card.classList.toggle('open'); e.currentTarget.textContent = card.classList.contains('open') ? 'Show less' : 'Show full prompt'; } }, 'Show full prompt'));
  return card;
}

async function paintPrice(id, mode, scanArg) {
  const box = document.getElementById(`price-${id}`);
  if (!box) return;
  const scan = scanArg || (await db.get('scans', id));
  const pr = scan?.price;
  if (mode === 'loading' || !pr) {
    box.replaceChildren(h('div', { class: 'label' }, 'Price'), h('div', { class: 'shimmer w60' }), h('div', { class: 'shimmer w90' }), h('small', { class: 'muted' }, 'Checking retail & resale prices…'));
    return;
  }
  if (pr.error) {
    box.replaceChildren(h('div', { class: 'label' }, 'Price'), h('p', { class: 'muted small' }, pr.error), h('button', { class: 'btn', onclick: () => fetchPrice(id) }, 'Try again'));
    return;
  }
  box.replaceChildren(
    h('div', { class: 'price-top' },
      h('div', {}, h('small', { class: 'label' }, 'Suggested price'), h('div', { class: 'big-price' }, eur(pr.suggested))),
      copyBtn(String(Math.round(pr.suggested || 0)), 'Copy')),
    h('div', { class: 'price-row' },
      h('div', {}, h('small', { class: 'label' }, 'Resale range'), h('b', {}, `${eur(pr.resale_low)} – ${eur(pr.resale_high)}`)),
      h('div', {}, h('small', { class: 'label' }, 'Retail'), h('b', {}, pr.retail_eur ? eur(pr.retail_eur) : 'Unknown'))),
    pr.reason ? h('p', { class: 'muted small' }, pr.reason, pr.retail_note ? ` · Retail: ${pr.retail_note}` : '') : null,
    pr.confidence && pr.confidence !== 'high' ? h('p', { class: 'small warn-text' }, `Estimate (${pr.confidence} confidence) — check similar sold items on Vinted.`) : null,
    pr.sources?.length ? h('div', { class: 'sources' }, pr.sources.map((s) => h('a', { href: s.uri, target: '_blank', rel: 'noopener' }, s.title || 'source'))) : null,
    h('button', { class: 'link', onclick: () => fetchPrice(id) }, '↻ Re-check price'));
}

function moreMenu(scan) {
  const m = modal(h('div', { class: 'stack' },
    h('h3', {}, 'Options'),
    h('button', { class: 'btn block', onclick: async () => {
      m.close();
      const notes = await ask('Re-analyze with notes', { value: scan.notes || '', placeholder: 'e.g. "It\'s the Tasman model, size 38"', ok: 'Re-analyze', multiline: true });
      if (notes == null) return;
      analyze({ photos: scan.photos, styleRef: scan.styleRef, notes, id: scan.id });
    } }, '↻ Re-analyze (fix product / add notes)'),
    h('button', { class: 'btn block danger', onclick: async () => {
      m.close();
      if (await confirmBox('Delete this listing?', 'Photos and prompts for it will be removed from this phone.')) { await db.del('scans', scan.id); location.hash = '#/'; }
    } }, 'Delete')));
}

/* ================= settings ================= */
async function viewSettings() {
  const s = S();
  const key = h('input', { class: 'field', type: 'password', placeholder: 'Paste your Gemini API key', autocomplete: 'off' });
  key.value = s.apiKey;
  const model = h('input', { class: 'field', list: 'models' }); model.value = s.model;
  const dl = h('datalist', { id: 'models' });
  const status = h('p', { class: 'small muted' });
  const langs = ['English', 'Lithuanian', 'German', 'French', 'Polish', 'Spanish', 'Italian', 'Dutch', 'Latvian', 'Estonian', 'Czech', 'Portuguese'];
  const lang = h('select', { class: 'field' }, langs.map((l) => h('option', { value: l, selected: l === s.language || null }, l)));
  const search = h('input', { type: 'checkbox', checked: s.useSearch });
  const stylesBox = h('div', { class: 'stack' });

  const save = async (quiet) => {
    state.settings = { ...state.settings, apiKey: key.value.trim(), model: model.value.trim() || 'gemini-flash-latest', language: lang.value, useSearch: search.checked };
    await db.saveSettings(state.settings);
    if (!quiet) toast('Saved');
  };
  const test = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    await save(true);
    status.textContent = 'Checking…';
    try {
      const names = await G.listModels(key.value.trim());
      const { best, options } = G.pickModel(names);
      dl.replaceChildren(...options.map((n) => h('option', { value: n })));
      if (!names.includes(model.value.trim()) && best) model.value = best;
      await save(true);
      status.innerHTML = `<span class="ok">✓ Connected.</span> Using <b>${model.value}</b>`;
    } catch (err) { status.textContent = '✕ ' + err.message; }
    btn.disabled = false;
  };
  const paintStyles = () => {
    stylesBox.replaceChildren(...(state.settings.styles || []).map((st, i) => h('div', { class: 'style-row' },
      h('div', { class: 'grow' }, h('b', {}, st.name), h('small', { class: 'muted' }, st.scene)),
      h('button', { class: 'icon sm', onclick: async () => {
        const name = await ask('Style name', { value: st.name }); if (name == null) return;
        const scene = await ask('Describe the surface', { value: st.scene, multiline: true }); if (scene == null) return;
        state.settings.styles[i] = { ...st, name: name || st.name, scene: scene || st.scene }; await save(true); paintStyles();
      } }, '✎'),
      h('button', { class: 'icon sm', onclick: async () => { state.settings.styles.splice(i, 1); await save(true); paintStyles(); } }, '×'))),
      h('button', { class: 'btn', onclick: async () => {
        const name = await ask('New style name', { placeholder: 'e.g. Warm oak table' }); if (!name) return;
        const scene = await ask('Describe the surface', { placeholder: 'material, colour, texture, finish, lighting', multiline: true }); if (!scene) return;
        state.settings.styles = [...(state.settings.styles || []), { id: db.uid(), name, scene }]; await save(true); paintStyles();
      } }, '+ Add style'));
  };
  paintStyles();

  return h('div', { class: 'page' },
    h('header', { class: 'bar' }, h('a', { class: 'icon', href: '#/' }, '‹'), h('h2', {}, 'Settings'), h('span', { class: 'icon' })),
    anim(h('section', { class: 'card stack' },
      h('b', {}, 'Gemini API key'),
      h('p', { class: 'small muted' }, 'Free at aistudio.google.com → Get API key. This app only reads photos and writes text, which the free tier covers. Your key stays on this phone.'),
      key, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => save() }, 'Save'), h('button', { class: 'btn', onclick: test }, 'Test key')), status), 0),
    anim(h('section', { class: 'card stack' },
      h('b', {}, 'Listing'),
      h('label', { class: 'label' }, 'Listing language'), lang,
      h('label', { class: 'toggle' }, search, h('span', { class: 'track' }), h('div', {}, h('b', {}, 'Search the web for prices'), h('small', { class: 'muted' }, 'More accurate retail & resale prices'))),
      h('label', { class: 'label' }, 'AI model'), model, dl,
      h('button', { class: 'btn', onclick: () => save() }, 'Save')), 1),
    anim(h('section', { class: 'card stack' },
      h('b', {}, 'Your background styles'),
      h('p', { class: 'small muted' }, 'Always shown as extra background prompts on every product.'),
      stylesBox), 2),
    anim(h('section', { class: 'card stack' },
      h('b', {}, 'Data'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Erase all listings?', 'Deletes every saved scan on this phone.', 'Erase')) { await db.clear('scans'); toast('Erased'); } } }, 'Erase all listings')), 3));
}

function gear() {
  return h('span', { html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' });
}

/* ================= boot ================= */
(async () => {
  state.settings = await db.getSettings();
  navigator.storage?.persist?.();
  await render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
