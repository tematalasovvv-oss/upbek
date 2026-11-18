/* ===== UpBek: штрих-код упаковки =====
   Фото → цифры штрих-кода распознаются прямо на телефоне (html5-qrcode с cdnjs, проверка SRI)
   → продукт ищем в открытой базе Open Food Facts. Наружу уходит только номер штрих-кода.
   Найденный продукт сохраняется в «Мои блюда», и в следующий раз ищется без интернета. */
'use strict';

let qrP = null;
function loadQr() {
  if (window.Html5Qrcode) return Promise.resolve();
  if (!qrP) qrP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
    // SRI: если файл на CDN подменят, браузер его не запустит
    s.integrity = 'sha512-r6rDA7W6ZeQhvl8S7yRVQUKVHdexq+GAlNkNNqVC7YyIV+NwqCTJe2hDWCiffTyRNOeGEzRRJ9ifvRm/HCzGYg==';
    s.crossOrigin = 'anonymous';
    s.onload = () => res();
    s.onerror = () => { qrP = null; rej(new Error('Не удалось загрузить сканер — проверь интернет')); };
    document.head.appendChild(s);
  });
  return qrP;
}
// уменьшаем фото: быстрее и надёжнее распознаётся
async function shrinkFile(file, max = 1400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть фото')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return new File([blob], 'scan.jpg', { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(url); }
}
const okCode = (c) => /^\d{8,14}$/.test(String(c || ''));
async function decodeBarcode(file) {
  await loadQr();
  let host = document.getElementById('qrHost');
  if (!host) { host = document.createElement('div'); host.id = 'qrHost'; host.style.cssText = 'position:fixed;left:-9999px;top:0;width:300px;height:300px;overflow:hidden'; document.body.appendChild(host); }
  const F = window.Html5QrcodeSupportedFormats;
  const sc = new window.Html5Qrcode('qrHost', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose: false });
  try {
    const t = await sc.scanFile(await shrinkFile(file), false);
    return okCode(t) ? t : null;
  } catch (e) { return null; } finally { try { sc.clear(); } catch (e) { /* ок */ } }
}

/* ---- поиск в Open Food Facts ---- */
const num100 = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 && x <= 1000 ? x : 0; };
function packGrams(q) { const m = String(q || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|g|гр|мл|ml|л|l)\b/i); if (!m) return 0; const v = parseFloat(m[1]); return Math.round(/^(кг|kg|л|l)$/i.test(m[2]) ? v * 1000 : v); }
async function offLookup(code) {
  if (!okCode(code)) return null;
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_ru,brands,quantity,serving_quantity,nutriments`;
  const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('База продуктов не ответила (' + r.status + ')');
  const j = await r.json();
  if (!j || j.status !== 1 || !j.product) return null;
  const p = j.product, n = p.nutriments || {};
  const k = num100(n['energy-kcal_100g']) || Math.round(num100(n['energy_100g']) / 4.184);
  const name = String(p.product_name_ru || p.product_name || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  if (!name && !k) return null;
  return {
    code, name: name || 'Продукт ' + code, brand: String(p.brands || '').split(',')[0].trim().slice(0, 30),
    k, p: num100(n.proteins_100g), f: num100(n.fat_100g), c: num100(n.carbohydrates_100g), fb: num100(n.fiber_100g),
    serving: Math.round(num100(p.serving_quantity)), pack: Math.min(5000, packGrams(p.quantity)),
    noKcal: !k,
  };
}
const bcFood = (code) => S.customFoods.find((f) => f.bc === code);

/* ---- окно продукта: выбираешь граммы и записываешь ---- */
async function openBarcode(code, ready) {
  UI.bcCode = code; UI.bc = null;
  const known = bcFood(code);
  if (known) { UI.bc = { code, name: known.n, brand: known.brand || '', k: known.k, p: known.p, f: known.f || 0, c: known.c || 0, fb: known.fb || 0, serving: known.serving || 0, pack: known.pack || 0 }; }
  else if (ready) UI.bc = ready;
  else {
    openSheet(() => `${sheetHead('🏷️ Штрих-код')}<div class="ai-wait"><div class="spinner"></div><div class="muted">Ищу продукт ${esc(code)}…</div></div>`);
    try { UI.bc = await offLookup(code); } catch (e) { UI.bcErr = e.message; }
  }
  if (UI.bcCode !== code) return;
  UI.bcG = UI.bc ? (UI.bc.serving || (UI.bc.pack && UI.bc.pack <= 300 ? UI.bc.pack : 100)) : 100;
  openSheet(renderBarcode);
}
function renderBarcode() {
  const b = UI.bc, code = UI.bcCode;
  if (!b) {
    return `${sheetHead('🏷️ Штрих-код ' + esc(code))}
    <p class="muted" style="margin-top:0">${UI.bcErr ? '⚠️ ' + esc(UI.bcErr) : 'Этого продукта пока нет в открытой базе Open Food Facts.'}</p>
    <button class="btn gold" data-a="bcLabel">📸 Сфотографировать состав на упаковке (ИИ)</button>
    <button class="btn ghost" style="margin-top:8px" data-a="cfOpen">⭐ Ввести калории вручную</button>
    <div class="note" style="margin-top:12px">ИИ прочитает таблицу «пищевая ценность» с фото и посчитает порцию.</div>`;
  }
  const g = UI.bcG, q = g / 100;
  const chips = [...new Set([b.serving, 50, 100, 150, 200, b.pack].filter((x) => x > 0 && x <= 2000))].sort((x, y) => x - y);
  const lbl = (x) => (x === b.pack ? `вся упаковка · ${x} г` : x === b.serving ? `порция · ${x} г` : `${x} г`);
  return `${sheetHead('🏷️ ' + esc(b.name))}
  <div class="dim" style="text-align:center;margin-top:-6px">${b.brand ? esc(b.brand) + ' · ' : ''}на 100 г: ${fmt(b.k)} ккал · Б ${dec(b.p)} · Ж ${dec(b.f)} · У ${dec(b.c)}${b.fb ? ' · 🌾 ' + dec(b.fb) : ''}</div>
  ${b.noKcal ? '<div class="note red" style="margin-top:8px">В базе нет калорий для этого продукта — проверь по упаковке.</div>' : ''}
  <div class="qty-q" style="margin-top:14px">Сколько съел?</div>
  <div class="stepper qty-step"><button data-a="bcG" data-v="-10" aria-label="Меньше" ${g <= 10 ? 'disabled' : ''}>−</button><b class="num">${fmt(g)} г</b><button data-a="bcG" data-v="10" aria-label="Больше">＋</button></div>
  <div class="qty-chips">${chips.map((x) => `<button class="chip${x === g ? ' on' : ''}${x === b.pack || x === b.serving ? ' wide' : ''}" data-a="bcSet" data-v="${x}">${lbl(x)}</button>`).join('')}</div>
  <div class="qty-sum"><b class="num">${fmt(Math.round(b.k * q))} ккал</b><span>Б ${Math.round(b.p * q)} · Ж ${Math.round(b.f * q)} · У ${Math.round(b.c * q)}${b.fb ? ' · 🌾 ' + dec(b.fb * q) : ''} г</span></div>
  <button class="btn gold" data-a="bcSave">Записать</button>
  <div class="hint" style="margin-top:8px">Данные — открытая база Open Food Facts. Продукт сохранится в «Мои блюда».</div>`;
}

Object.assign(A, {
  bcG: (el) => { UI.bcG = clamp(UI.bcG + +el.dataset.v, 10, 2000); refreshSheet(); },
  bcSet: (el) => { UI.bcG = clamp(+el.dataset.v, 10, 2000); refreshSheet(); },
  bcSave: () => {
    const b = UI.bc; if (!b) return;
    if (tooFast()) return;
    // в «Мои блюда»: в следующий раз — плиткой в 1 касание и без интернета
    let f = bcFood(b.code);
    if (!f) {
      const words = norm(b.name).split(/\s+/).filter((w) => w.length >= 3);
      f = { id: 'bc_' + b.code, bc: b.code, n: b.name, brand: b.brand, ic: '🏷️', u: '100 г', g: 100, k: Math.round(b.k), p: round1(b.p), f: round1(b.f), c: round1(b.c), fb: round1(b.fb), serving: b.serving, pack: b.pack, a: [norm(b.name), ...words] };
      S.customFoods.push(f);
    }
    const e = foodEntry(f, Math.round(UI.bcG) / 100);
    closeSheet();
    act(() => { S.food.push(e); S.usage[f.id] = (S.usage[f.id] || 0) + 1; }, `🏷️ ${esc(b.name)} · ${fmt(foodKcal(e))} ккал`, () => act(() => { S.food = S.food.filter((x) => x.id !== e.id); }, 'Отменено'));
  },
  bcLabel: () => {
    if (!aiReady()) { openAiSetup(); return; }
    pickFiles('image/*', false, async (fs) => {
      try { const image = await imageToB64(fs[0], 1100); runFoodAi({ image, text: 'На фото упаковка продукта и таблица пищевой ценности. Прочитай название и значения на 100 г, посчитай одну обычную порцию.', noBarcode: true }); }
      catch (e) { toast('⚠️ ' + esc(e.message)); }
    });
  },
  bcManual: async () => {
    const c = (await askText('🏷️ Цифры под штрих-кодом', 'Например: 4870204390038', [], { no: 'Отмена', yes: 'Найти', cancel: true, max: 14 }) || '').replace(/\D/g, '');
    if (!c) return;
    if (!okCode(c)) { toast('Штрих-код — от 8 до 14 цифр'); return; }
    openBarcode(c);
  },
  cfOpen: () => openCustomFood(),
});
