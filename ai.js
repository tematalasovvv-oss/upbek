/* ===== UpBek: ИИ (Google Gemini) — калории и БЖУ по фото и тексту ===== */
'use strict';

const AI_STORE = 'upbek.ai'; // ключ хранится только на этом устройстве, в облачную копию не попадает
const GEM = 'https://generativelanguage.googleapis.com/v1beta';
function aiCfg() { try { return JSON.parse(localStorage.getItem(AI_STORE) || '{}'); } catch (e) { return {}; } }
function aiSaveCfg(c) { try { localStorage.setItem(AI_STORE, JSON.stringify(c)); } catch (e) { /* ок */ } }
const aiReady = () => !!aiCfg().key;

function aiErr(m) {
  m = String(m || '');
  if (/location is not supported|not available in your (country|region)/i.test(m)) return 'Gemini недоступен в твоём регионе. Напиши мне — подключу через наш сервер.';
  if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(m)) return 'Ключ не подходит — проверь, что скопирован целиком.';
  if (/per ?day|PerDay|daily/i.test(m)) return 'Дневной лимит бесплатных запросов исчерпан — завтра снова заработает.';
  if (/overloaded|UNAVAILABLE|high demand|503/i.test(m)) return 'Gemini сейчас перегружен — попробуй через минуту.';
  if (/quota|RESOURCE_EXHAUSTED|rate|429/i.test(m)) return 'Слишком много запросов подряд — подожди минуту.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет интернета или Google недоступен.';
  if (/mime|audio/i.test(m)) return 'Не получилось разобрать запись — попробуй написать текстом.';
  return m.slice(0, 160);
}
// выбираем самую свежую стабильную модель Flash + запасные (на случай перегрузки)
async function aiPickModel(key) {
  const r = await fetch(`${GEM}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(aiErr((j.error && j.error.message) || 'HTTP ' + r.status));
  const ver = (n) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  const all = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')
    && /gemini-[\d.]+-flash/.test(m.name) && !/(image|tts|live|audio|embedding|thinking|8b)/.test(m.name) && !/(preview|exp)/.test(m.name))
    .sort((a, b) => ver(b.name) - ver(a.name) || a.name.length - b.name.length).map((m) => m.name.replace('models/', ''));
  const main = all.filter((n) => !/lite/.test(n));
  const model = main[0] || all[0] || 'gemini-2.5-flash';
  const alts = [...main.slice(1, 2), ...all.filter((n) => /lite/.test(n)).slice(0, 1)].filter((n) => n !== model);
  return { model, alts, all: [...main.slice(0, 3), ...all.filter((n) => /lite/.test(n)).slice(0, 2)] };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function aiStatus(text) { const el = document.getElementById('aiStatus'); if (el) el.textContent = text; }
// запрос с повторами: при «занято/перегружено» ждём и повторяем, потом пробуем запасную модель
async function aiCall(parts, schema) {
  const c = aiCfg();
  if (!c.key) throw new Error('NO_KEY');
  const models = [...new Set([c.model || 'gemini-2.5-flash', ...(c.alts || [])])];
  // «размышления» модели для наших задач не нужны и сильно тормозят — выключаем
  const think = (m) => (/gemini-2\.5-flash/.test(m) ? { thinkingBudget: 0 } : /gemini-3/.test(m) ? { thinkingLevel: 'low' } : null);
  let noThink = !!c.noThink;
  const mkBody = (m) => JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema, ...(!noThink && think(m) ? { thinkingConfig: think(m) } : {}) } });
  let last = '';
  for (let mi = 0; mi < models.length; mi++) {
    if (mi > 0) aiStatus('Основная модель занята — пробую запасную…');
    for (let attempt = 0; attempt < 3; attempt++) {
      let r, j = {};
      try {
        r = await fetch(`${GEM}/models/${models[mi]}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key }, body: mkBody(models[mi]) });
        j = await r.json().catch(() => ({}));
      } catch (e) { last = e.message; if (attempt < 2) { aiStatus('Нет связи — повторяю…'); await wait(2000); continue; } break; }
      if (r.ok) {
        const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
        if (!text) { last = 'ИИ не ответил — попробуй ещё раз'; continue; }
        aiCount();
        return JSON.parse(text);
      }
      last = (j.error && j.error.message) || 'HTTP ' + r.status;
      if (r.status === 400 && /think/i.test(last) && !noThink) { noThink = true; aiSaveCfg({ ...aiCfg(), noThink: true }); attempt--; continue; }
      if (![429, 500, 502, 503, 504].includes(r.status)) throw new Error(aiErr(last));
      if (/per ?day|PerDay|daily/i.test(last)) break; // дневной лимит этой модели — сразу к запасной
      const rd = ((j.error && j.error.details) || []).find((d) => d.retryDelay);
      const ms = rd ? Math.min(20000, parseFloat(rd.retryDelay) * 1000 + 500) : [2500, 6000, 0][attempt];
      if (attempt < 2) { aiStatus(`Gemini в очереди — повторю через ${Math.round(ms / 1000)} с…`); await wait(ms); }
    }
  }
  throw new Error(aiErr(last));
}
// счётчик запросов (только на этом устройстве)
function aiCount() {
  try {
    const u = JSON.parse(localStorage.getItem('upbek.aiuse') || '{}'); const d = dayKey();
    u[d] = (u[d] || 0) + 1;
    Object.keys(u).forEach((k) => { if (k < dayKey(Date.now() - 62 * DAY)) delete u[k]; });
    localStorage.setItem('upbek.aiuse', JSON.stringify(u));
  } catch (e) { /* ок */ }
}
function aiUsage() {
  try {
    const u = JSON.parse(localStorage.getItem('upbek.aiuse') || '{}'); const d = dayKey(); const m = d.slice(0, 7);
    return { today: u[d] || 0, month: Object.entries(u).filter(([k]) => k.startsWith(m)).reduce((a, [, v]) => a + v, 0) };
  } catch (e) { return { today: 0, month: 0 }; }
}

/* ---- еда ---- */
const FOOD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' }, emoji: { type: 'STRING' }, grams: { type: 'NUMBER' },
          kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, carbs: { type: 'NUMBER' }, fiber: { type: 'NUMBER' }, water_ml: { type: 'NUMBER' },
        },
        required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carbs'],
      },
    },
    comment: { type: 'STRING' },
    barcode: { type: 'STRING' },
  },
  required: ['items'],
};
function foodPrompt(hasImage, text) {
  const p = S.profile || {};
  return `Ты — нутрициолог. Пользователь живёт в Кыргызстане (частые блюда: плов, лагман, манты, самса, шорпо, бешбармак, куурдак, ашлямфу, лепёшка, боорсок, блюда столовых).
Определи каждое отдельное блюдо или продукт${hasImage ? ' на фото' : ''}, оцени вес порции в граммах и посчитай для ЭТОЙ порции калории (kcal), белки (protein), жиры (fat), углеводы (carbs) и клетчатку (fiber) в граммах.
Правила: названия короткие, по-русски; emoji — один подходящий эмодзи; числа — реалистичные средние значения для такой порции; каждое блюдо и напиток — отдельной строкой. Если на фото несколько одинаковых порций, перечисли их отдельно.
water_ml — сколько воды организм получит из этой порции: чистая вода, чай, компот, молоко ≈ 90–100% объёма, кофе ≈ 85%, сладкие напитки ≈ 90%, супы ≈ 50% объёма; алкоголь, энергетики и твёрдая еда — 0.
Если на фото чётко виден штрих-код упаковки — перепиши цифры под ним в barcode (только цифры), иначе оставь barcode пустым. Если еды нет — верни пустой items и объясни в comment. В comment одной короткой фразой можно дать совет (цель пользователя: ${GOALS[p.goal] ? GOALS[p.goal].n.toLowerCase() : 'здоровое питание'}).${text ? `\nОписание от пользователя: «${text}»` : ''}`;
}
async function imageToB64(file, max = 800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть фото')); i.src = url; });
    const k =Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72).split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}
async function aiFood({ text, image }) {
  const parts = [{ text: foodPrompt(!!image, text) }];
  if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
  return aiCall(parts, FOOD_SCHEMA);
}

/* ---- окна ---- */
function aiLoading(label) {
  openSheet(() => `${sheetHead('✨ ИИ думает')}<div class="ai-wait"><div class="spinner"></div><div class="muted">${label}</div><div class="dim" id="aiStatus"></div></div>`);
}
// выбор файлов: поле добавляется в страницу — иначе iPhone после камеры иногда «теряет» фото
function pickFiles(accept, multiple, cb) {
  const old = document.getElementById('upbekFile'); if (old) old.remove();
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept; i.multiple = !!multiple; i.id = 'upbekFile';
  i.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  i.addEventListener('change', () => { const fs = [...(i.files || [])]; i.remove(); if (fs.length) cb(fs); });
  document.body.appendChild(i);
  i.click();
}
async function runFoodAi(input) {
  const ctx = { link: UI.linkTx, day: UI.foodDay };
  aiLoading(input.image ? 'Разглядываю тарелку…' : 'Считаю калории и БЖУ…');
  try {
    const r = await aiFood(input);
    UI.linkTx = ctx.link; UI.foodDay = ctx.day;
    // ИИ прочитал цифры штрих-кода — сначала пробуем точные данные из базы продуктов
    const code = String(r.barcode || '').replace(/\D/g, '');
    if (!input.noBarcode && typeof okCode === 'function' && okCode(code)) {
      try { const prod = bcFood(code) ? null : await offLookup(code); if (prod || bcFood(code)) { openBarcode(code, prod); return; } } catch (e) { /* нет в базе — считаем как фото еды */ }
    }
    UI.aiRes = { items: (r.items || []).map((x) => ({ ...x, on: true, mult: 1 })), comment: r.comment || '', ctx };
    if (!UI.aiRes.items.length) { openSheet(() => `${sheetHead('✨ ИИ')}<p>${esc(r.comment || 'Не нашёл еду. Попробуй другое фото или опиши словами.')}</p><button class="btn" data-a="foodSheet" data-v="food" data-keep="1">Назад</button>`); return; }
    openSheet(renderAiResult);
  } catch (e) {
    const msg = e.message === 'NO_KEY' ? 'Сначала подключи Gemini' : aiErr(e.message);
    openSheet(() => `${sheetHead('✨ ИИ')}<p class="red">⚠️ ${esc(msg)}</p><button class="btn ghost" data-a="foodSheet" data-v="food" data-keep="1">Назад</button>`);
  }
}
function renderAiResult() {
  const R = UI.aiRes;
  const on = R.items.filter((x) => x.on);
  const tot = (k) => sum(on, (x) => (x[k] || 0) * x.mult);
  return `${sheetHead('✨ Что я вижу')}
  ${UI.linkTx ? '<div class="hint">Отметь только своё — остальное сними галочкой</div>' : ''}
  <div class="card list">${R.items.map((x, i) => `<div class="item aiitem ${x.on ? '' : 'off'}">
    <button class="ii" data-a="aiToggle" data-v="${i}">${x.on ? esc(x.emoji || '🍽️') : '✕'}</button>
    <span class="grow"><div class="it">${esc(x.name)}</div><div class="is">~${Math.round(x.grams * x.mult)} г · Б ${Math.round(x.protein * x.mult)} · Ж ${Math.round(x.fat * x.mult)} · У ${Math.round(x.carbs * x.mult)}${x.fiber > 0 ? ` · 🌾 ${dec(x.fiber * x.mult)}` : ''}${x.water_ml > 0 ? ` · 💧 ${Math.round(x.water_ml * x.mult)} мл` : ''}</div></span>
    <span class="mini-step"><button data-a="aiMult" data-v="${i}:-0.5">−</button><b>${x.mult === 1 ? '1' : round1(x.mult)}</b><button data-a="aiMult" data-v="${i}:0.5">＋</button></span>
    <b class="iv">${fmt(x.kcal * x.mult)}</b>
    <button class="fav-btn${x.fav ? ' on' : ''}" data-a="aiFav" data-v="${i}" aria-label="${x.fav ? 'Уже в моих блюдах' : 'Сохранить в мои блюда'}" aria-pressed="${!!x.fav}">${x.fav ? '★' : '☆'}</button></div>`).join('')}</div>
  <div class="hint" style="margin:-4px 0 10px">☆ — сохранить блюдо в «Мои блюда», чтобы потом добавлять в 1 касание</div>
  <div class="total" style="margin:6px 0 12px"><div class="tv num">${fmt(tot('kcal'))} ккал</div><div class="tl">Б ${Math.round(tot('protein'))} г · Ж ${Math.round(tot('fat'))} г · У ${Math.round(tot('carbs'))} г${tot('fiber') > 0 ? ` · 🌾 ${dec(tot("fiber"))} г` : ''}${tot('water_ml') > 0 ? ` · 💧 ${fmt(tot('water_ml'))} мл` : ''}</div></div>
  ${R.adding ? '<div class="note" style="margin-bottom:12px"><span class="spinner sm"></span> Считаю добавленное блюдо…</div>' : ''}
  <button class="btn ghost" style="margin-bottom:12px" data-a="aiAdd" ${R.adding ? 'disabled' : ''}>＋ Добавить блюдо</button>
  ${R.comment ? `<div class="note" style="margin-bottom:12px">💡 ${esc(R.comment)}</div>` : ''}
  <button class="btn gold" data-a="aiSave" ${on.length ? '' : 'disabled'}>Записать${on.length ? ` (${on.length})` : ''}</button>
  <div class="hint" style="margin-top:8px">Цифры — оценка ИИ. ＋/− меняют порцию.</div>`;
}
function openAiSetup() {
  const c = aiCfg();
  openSheet(() => `${sheetHead('✨ Подключить Gemini')}
  <div class="help">
    <p>Gemini посчитает калории и БЖУ по фото тарелки или описанию. Бесплатно — нужен только ключ Google (1 минута):</p>
    <ol>
      <li>Открой <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" class="gold"><b>aistudio.google.com/apikey</b></a> и войди в Google.</li>
      <li>Нажми <b>«Create API key»</b> и скопируй ключ (начинается с <b>AIza…</b>).</li>
      <li>Вставь его сюда:</li>
    </ol>
  </div>
  <input id="aiKey" placeholder="AIza…" autocomplete="off" autocapitalize="off" spellcheck="false" value="">
  <button class="btn gold" style="margin-top:10px" data-a="aiConnect">Подключить</button>
  ${c.key ? `<h3 class="vh">Модель</h3>
  <div class="card list">${(c.all && c.all.length ? c.all : [c.model]).map((m) => `<button class="item" data-a="aiModel" data-v="${esc(m)}"><span class="ii">${m === c.model ? '✅' : (/lite/.test(m) ? '⚡' : '⭐')}</span><span class="grow"><div class="it">${esc(m)}</div><div class="is">${/lite/.test(m) ? 'самая быстрая, чуть менее точная' : 'точная, рекомендуемая'}</div></span></button>`).join('')}</div>
  <div class="note">Если ИИ отвечает медленно — выбери ⚡ «lite». Модели Pro умнее, но заметно медленнее и с маленьким бесплатным лимитом, поэтому их здесь нет.</div>
  <button class="btn danger" style="margin-top:8px" data-a="aiOff">Отключить ИИ</button>` : ''}
  <div class="note">🔒 Ключ хранится только на этом телефоне. На бесплатном тарифе Google может использовать запросы для улучшения моделей — не фотографируй ничего личного.</div>`);
}
function openAiSheet() { openSheet(() => `${sheetHead('✨ ИИ (Gemini)')}${aiSection(true)}${coachHistory()}`); }
function coachHistory() {
  const list = (S.coach || []).map((c, i) => ({ c, i })).sort((a, b) => (b.c.week > a.c.week ? 1 : b.c.week < a.c.week ? -1 : b.c.at - a.c.at));
  return `<h3 class="vh">🧠 Разборы недели</h3>
  ${list.length ? `<div class="card list">${list.map(({ c, i }) => { const mon = new Date(c.week + 'T12:00:00'); const sun = new Date(mon.getTime() + 6 * DAY); return `<button class="item" data-a="coachOpen" data-v="${i}"><span class="ii coach-mini">${Math.round(c.score)}</span><span class="grow"><div class="it">${esc(c.title || 'Разбор недели')}</div><div class="is">${mon.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${sun.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · цели ${c.goals.filter((g) => g.done).length}/${c.goals.length}</div></span><span>›</span></button>`; }).join('')}</div>` : '<div class="card empty">Первый разбор появится в понедельник</div>'}
  ${aiReady() ? '<button class="btn ghost" style="margin-top:10px" data-a="coachNow">🔄 Разобрать прошлую неделю сейчас</button>' : ''}`;
}
function aiSection(inSheet) {
  const c = aiCfg(); const u = aiUsage();
  return `${inSheet ? '' : '<h2>✨ ИИ (Gemini)</h2>'}
  <div class="card"><div class="row between"><div><b>${c.key ? 'Подключён' : 'Не подключён'}</b><div class="dim">${c.key ? esc(c.model || '') : 'Еда по фото, выписки, тренер недели — бесплатно'}</div></div>
  <button class="btn ${c.key ? 'ghost' : 'gold'} sm" data-a="aiSetup">${c.key ? 'Настроить' : 'Подключить'}</button></div>
  ${c.key ? `<div class="split"><div><span>Запросов сегодня</span><b class="num">${u.today}</b></div><div><span>За месяц</span><b class="num">${u.month}</b></div></div>
  <div class="note">Бесплатный ключ без карты: при лимите Google просто ответит «попробуй позже», денег не спишет. Лимиты: aistudio.google.com → Usage.</div>` : ''}
</div>`;
}

Object.assign(A, {
  aiSetup: openAiSetup,
  aiConnect: async (el) => {
    const key = ($('#aiKey').value || '').trim();
    if (key.length < 20) { toast('Вставь ключ целиком'); return; }
    el.disabled = true; el.textContent = 'Проверяю ключ…';
    try {
      const { model, alts, all } = await aiPickModel(key);
      aiSaveCfg({ key, model, alts, all });
      closeSheet(); render(); toast(`✨ Gemini подключён (${esc(model)})`);
    } catch (e) { el.disabled = false; el.textContent = 'Подключить'; toast('⚠️ ' + esc(aiErr(e.message))); }
  },
  aiModel: (el) => {
    const c = aiCfg(); const m = el.dataset.v; const all = c.all || [c.model];
    aiSaveCfg({ ...c, model: m, alts: all.filter((x) => x !== m).slice(0, 2) });
    refreshSheet(); toast(`✨ Модель: ${esc(m)}`);
  },
  aiOff: () => { aiSaveCfg({}); closeSheet(); render(); toast('ИИ отключён'); },
  // «Фото еды / штрих-код»: сначала ищем штрих-код прямо на телефоне, нет — считаем фото еды через ИИ
  aiPhoto: () => {
    const hint = ($('#foodText') && $('#foodText').value.trim()) || '';
    pickFiles('image/*', false, async (fs) => {
      const ctx = { link: UI.linkTx, day: UI.foodDay };
      aiLoading('Ищу штрих-код…');
      let code = null;
      try { code = await decodeBarcode(fs[0]); } catch (e) { /* сканер не загрузился — идём через ИИ */ }
      UI.linkTx = ctx.link; UI.foodDay = ctx.day;
      if (code) { openBarcode(code); return; }
      if (!aiReady()) {
        openSheet(() => `${sheetHead('📷 Фото еды / штрих-код')}<p class="muted" style="margin-top:0">Штрих-код на фото не нашёлся. Сфотографируй его ближе и ровнее — или введи цифры. Для фото блюда нужен ИИ.</p>
        <button class="btn gold" data-a="aiPhoto">📷 Ещё раз</button><button class="btn ghost" style="margin-top:8px" data-a="bcManual">🔢 Ввести цифры штрих-кода</button><button class="btn ghost" style="margin-top:8px" data-a="aiSetup">✨ Подключить ИИ</button>`);
        return;
      }
      try { const image = await imageToB64(fs[0]); runFoodAi({ image, text: hint }); } catch (e) { toast('⚠️ ' + esc(e.message)); }
    });
  },
  aiText: () => {
    if (!aiReady()) { openAiSetup(); return; }
    const text = ($('#foodText') && $('#foodText').value.trim()) || '';
    if (text.length < 2) { toast('Напиши в поле, что съел, — например «тарелка лагмана и чай»'); const i = $('#foodText'); if (i) i.focus(); return; }
    runFoodAi({ text });
  },
  // ＋ Добавить блюдо к готовому расчёту: сначала ищем в меню UpBek, незнакомое досчитывает ИИ
  aiAdd: async () => {
    const R = UI.aiRes; if (!R || R.adding) return;
    const top = allFoods().filter((f) => !f.water && S.usage[f.id]).sort((a, b) => S.usage[b.id] - S.usage[a.id]).slice(0, 6).map((f) => shortName(f.n));
    const text = await askText('＋ <b>Что ещё было?</b><br><span class="dim">Например: «хлеб 2 куска, чай с сахаром». Блюда из меню посчитаю сразу, остальное — ИИ.</span>', 'Название и количество', top, { no: 'Отмена', yes: 'Добавить', cancel: true, max: 120 });
    if (!text) return;
    const parts = parseFood(text), unknown = [];
    for (const x of parts) {
      if (x.f && !x.f.water) R.items.push({ name: shortName(x.f.n), emoji: x.f.ic, grams: (x.f.g || 0) * x.qty, kcal: x.f.k * x.qty, protein: x.f.p * x.qty, fat: (x.f.f || 0) * x.qty, carbs: (x.f.c || 0) * x.qty, fiber: (x.f.fb || 0) * x.qty, water_ml: (x.f.hyd || 0) * x.qty, on: true, mult: 1, local: true });
      else if (x.f && x.f.water) R.items.push({ name: 'Вода', emoji: '💧', grams: x.f.water * x.qty, kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, water_ml: x.f.water * x.qty, on: true, mult: 1, local: true });
      else if (x.custom) R.items.push({ name: x.name, emoji: '🍽️', grams: 0, kcal: x.k, protein: 0, fat: 0, carbs: 0, fiber: 0, on: true, mult: 1, local: true });
      else if (x.bad) unknown.push(x.bad);
    }
    refreshSheet();
    if (!unknown.length) { toast('＋ Добавлено к расчёту'); return; }
    if (!aiReady()) { toast('Не нашёл в меню: ' + esc(unknown.join(', '))); return; }
    R.adding = true; refreshSheet();
    try {
      const r = await aiFood({ text: unknown.join(', ') });
      (r.items || []).forEach((x) => R.items.push({ ...x, on: true, mult: 1 }));
      toast((r.items || []).length ? '✨ Добавлено к расчёту' : 'ИИ не узнал блюдо — опиши иначе');
    } catch (e) { toast('⚠️ ' + esc(aiErr(e.message))); }
    R.adding = false;
    if (UI.aiRes === R && UI.sheetFn === renderAiResult) refreshSheet();
  },
  aiFav: (el) => {
    const x = UI.aiRes && UI.aiRes.items[+el.dataset.v]; if (!x) return;
    if (x.fav) { toast('⭐ Уже в «Моих блюдах»'); return; }
    const n = String(x.name || 'Блюдо').slice(0, 50), m = x.mult || 1, g = Math.round((x.grams || 0) * m);
    const words = norm(n).split(/\s+/).filter((w) => w.length >= 3);
    const f = { id: 'c_' + uid(), n, ic: safeIc(x.emoji), u: g ? `порция ${g} г` : 'порция', g, k: Math.round(x.kcal * m), p: round1(x.protein * m), f: round1(x.fat * m), c: round1(x.carbs * m), fb: round1((x.fiber || 0) * m), ...(x.water_ml > 0 ? { hyd: Math.round(x.water_ml * m) } : {}), a: [norm(n), ...words] };
    S.customFoods.push(f); x.fav = true; save(); refreshSheet();
    toast(`⭐ «${esc(n)}» — в моих блюдах`);
  },
  aiToggle: (el) => { const x = UI.aiRes.items[+el.dataset.v]; x.on = !x.on; refreshSheet(); },
  aiMult: (el) => { const [i, d] = el.dataset.v.split(':'); const x = UI.aiRes.items[+i]; x.mult = clamp(round1(x.mult + +d), 0.5, 10); refreshSheet(); },
  aiSave: () => {
    const R = UI.aiRes; const ctx = R.ctx;
    UI.foodDay = ctx.day;
    const t = viewDayTime();
    const entries = R.items.filter((x) => x.on).map((x) => ({
      id: uid(), t, name: String(x.name || '').slice(0, 60), ic: safeIc(x.emoji), unit: `~${Math.round(x.grams)} г`, qty: x.mult,
      k: Math.round(x.kcal), p: round1(x.protein), f: round1(x.fat), c: round1(x.carbs), ...(x.fiber > 0 ? { fb: round1(x.fiber) } : {}), ...(x.water_ml > 0 ? { hyd: Math.round(x.water_ml) } : {}), ...(x.local ? {} : { ai: true }), ...(ctx.link ? { tx: ctx.link } : {}),
    }));
    const ids = entries.map((e) => e.id);
    closeSheet();
    act(() => S.food.push(...entries), `✨ Записано: ${entries.length} · ${fmt(sum(entries, foodKcal))} ккал`, () => act(() => { S.food = S.food.filter((x) => !ids.includes(x.id)); }, 'Отменено'));
  },
});

/* =====================================================================
   ВЫПИСКА БАНКА: PDF или скриншоты → операции по дням
   ===================================================================== */
function fileToB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('Не удалось прочитать файл'));
    r.readAsDataURL(file);
  });
}
const pickCats = (list) => list.filter((c) => !c[3]);
function stmtSchema() {
  const ids = [...pickCats(EXP_CATS), ...pickCats(INC_CATS)].map((c) => c[0]);
  return {
    type: 'OBJECT',
    properties: {
      bank: { type: 'STRING' },
      transactions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            date: { type: 'STRING' }, time: { type: 'STRING' }, amount: { type: 'NUMBER' },
            direction: { type: 'STRING', enum: ['out', 'in'] }, description: { type: 'STRING' },
            category: { type: 'STRING', enum: ids },
          },
          required: ['date', 'amount', 'direction', 'description', 'category'],
        },
      },
      comment: { type: 'STRING' },
    },
    required: ['transactions'],
  };
}
function stmtPrompt(acc) {
  const y = new Date().getFullYear();
  const ex = pickCats(EXP_CATS).map((c) => `${c[0]} = ${c[2].replace('­', '')}`).join('; ');
  const inc = pickCats(INC_CATS).map((c) => `${c[0]} = ${c[2]}`).join('; ');
  return `Это выписка или скриншоты истории операций банка «${acc.name}» (Кыргызстан, валюта — сом, KGS).
Извлеки ВСЕ операции. Для каждой: date — YYYY-MM-DD (если год не указан — ${y}); time — HH:MM, если есть; amount — положительное число в сомах; direction — out (списание, оплата, перевод от меня, снятие) или in (зачисление, пополнение, перевод мне, возврат); description — коротко: магазин, получатель или назначение; category — самая подходящая из списка.
Категории расходов: ${ex}.
Категории доходов: ${inc}.
Если не уверен в категории — unknown (для расходов) или unknown_in (для доходов). Не придумывай операции, пропускай строки итогов и остатков. Если скриншоты перекрываются, не дублируй одну и ту же операцию.`;
}
function openStmt() {
  if (!aiReady()) { openAiSetup(); return; }
  UI.stAcc = UI.stAcc || S.main || (S.accounts[0] && S.accounts[0].id);
  openSheet(() => `${sheetHead('📥 Выписка из банка')}
  <p class="muted" style="margin-top:0">Загрузи <b>PDF-выписку</b> или <b>скриншоты истории</b> из приложения банка. ИИ найдёт все операции и разнесёт по дням и категориям. Ты проверишь — и они попадут в хронологию.</p>
  <div class="hint" style="text-align:left">Какой это счёт?</div>
  <div class="chips wrap" style="margin-bottom:12px">${S.accounts.map((a) => `<button class="chip ${UI.stAcc === a.id ? 'on' : ''}" data-a="stAcc" data-v="${a.id}"><i class="dot" style="background:${a.color}"></i>${esc(a.name)}</button>`).join('')}</div>
  <button class="btn gold" data-a="stPick">📎 Выбрать PDF или скриншоты</button>
  <div class="note">Как получить: в приложении банка → история / выписка → «Скачать PDF», или сделай скриншоты списка операций (можно несколько за раз).<br>Операции раньше начала учёта (${new Date(accSince(accById(UI.stAcc))).toLocaleDateString('ru-RU')}) попадут в хронологию, но баланс не изменят.</div>`);
}
async function runStmt(files) {
  const acc = accById(UI.stAcc);
  aiLoading(`Читаю выписку (${files.length} ${files.length === 1 ? 'файл' : 'файла'})… Это может занять до минуты.`);
  try {
    const parts = [{ text: stmtPrompt(acc) }];
    for (const f of files.slice(0, 12)) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        let t = '';
        if (typeof pdfText === 'function') { try { aiStatus('Достаю текст из PDF…'); t = await pdfText(f); } catch (e) { t = ''; } }
        if (t.replace(/\s/g, '').length > 80) parts.push({ text: 'Текст выписки:\n' + t.slice(0, 80000) });
        else parts.push({ inline_data: { mime_type: 'application/pdf', data: await fileToB64(f) } });
      } else parts.push({ inline_data: { mime_type: 'image/jpeg', data: await imageToB64(f, 1600) } });
    }
    aiStatus('Gemini разбирает операции…');
    const r = await aiCall(parts, stmtSchema());
    const since = accSince(acc);
    const okCat = (type, c) => (type === 'inc' ? INC_CATS : EXP_CATS).some((x) => x[0] === c && !x[3]);
    const rows = (r.transactions || []).map((x) => {
      const type = x.direction === 'in' ? 'inc' : 'exp';
      const tm = /^\d{1,2}:\d{2}$/.test(x.time || '') ? x.time.padStart(5, '0') : '12:00';
      const t = Date.parse(`${x.date}T${tm}:00`);
      const amount = Math.round(Math.abs(+x.amount) * 100) / 100;
      if (!t || !amount) return null;
      const cat = okCat(type, x.category) ? x.category : type === 'inc' ? 'unknown_in' : 'unknown';
      const dup = S.tx.find((y) => y.acc === acc.id && y.type === type && Math.abs(y.amount - amount) < 0.01 && Math.abs(y.t - t) < 36 * 36e5);
      return { t, type, amount, cat, note: String(x.description || '').slice(0, 60), dup: !!dup, on: !dup, hist: t < since };
    }).filter(Boolean).sort((a, b) => b.t - a.t);
    if (!rows.length) { openSheet(() => `${sheetHead('📥 Выписка')}<p>${esc(r.comment || 'Не нашёл операций. Попробуй другой файл или скриншот почётче.')}</p><button class="btn ghost" data-a="stmt">Назад</button>`); return; }
    UI.stRows = rows; UI.stComment = r.comment || '';
    openSheet(renderStmt);
  } catch (e) {
    openSheet(() => `${sheetHead('📥 Выписка')}<p class="red">⚠️ ${esc(e.message === 'NO_KEY' ? 'Сначала подключи Gemini' : aiErr(e.message))}</p><button class="btn ghost" data-a="stmt">Назад</button>`);
  }
}
function renderStmt() {
  const rows = UI.stRows, on = rows.filter((x) => x.on);
  const out = sum(on.filter((x) => x.type === 'exp'), (x) => x.amount), inn = sum(on.filter((x) => x.type === 'inc'), (x) => x.amount);
  const dups = rows.filter((x) => x.dup).length, hist = on.filter((x) => x.hist).length;
  const first = rows[rows.length - 1].t, last = rows[0].t;
  const groups = [];
  rows.forEach((x, i) => { const k = dayKey(x.t); let g = groups[groups.length - 1]; if (!g || g.k !== k) groups.push((g = { k, items: [] })); g.items.push([x, i]); });
  return `${sheetHead('📥 Нашёл операции')}
  <div class="split" style="margin-top:0"><div><span>Расходы</span><b class="red num">−${fmt(out)}</b></div><div><span>Доходы</span><b class="green num">+${fmt(inn)}</b></div></div>
  <div class="dim" style="margin:8px 0">${rows.length} операций · ${new Date(first).toLocaleDateString('ru-RU')} — ${new Date(last).toLocaleDateString('ru-RU')}${dups ? ` · ${dups} уже были (сняты)` : ''}${hist ? ` · ${hist} до начала учёта (📜 без влияния на баланс)` : ''}</div>
  ${UI.stComment ? `<div class="note" style="margin-bottom:8px">💡 ${esc(UI.stComment)}</div>` : ''}
  ${groups.map((g) => `<div class="day-head"><span>${dayLabel(g.k)}</span></div><div class="card list" style="margin-bottom:0">${g.items.map(([x, i]) => { const c = catOf(x.type, x.cat); return `<div class="item ${x.on ? '' : 'off'}"><button class="ii" data-a="stToggle" data-v="${i}">${x.on ? c.ic : '✕'}</button><button class="rowbtn" data-a="rowEdit" data-v="st:${i}"><span class="grow"><div class="it">${esc(x.note || c.n)}</div><div class="is">${c.n.replace('\u00AD', '')}${x.dup ? ' · уже есть' : ''}${x.hist ? ' · 📜' : ''} · ${hhmm(x.t)} · <span class="gold">✏️</span></div></span><span class="iv ${x.type === 'inc' ? 'green' : ''}">${x.type === 'inc' ? '+' : '−'}${fmt(x.amount)}</span></button></div>`; }).join('')}</div>`).join('')}
  <div class="sticky-save"><button class="btn gold" data-a="stSave" ${on.length ? '' : 'disabled'}>Добавить ${on.length} в хронологию</button></div>
  <div class="hint">Значок слева — снять или вернуть операцию. Нажми на строку, чтобы поменять категорию или сумму.</div>`;
}

/* =====================================================================
   ИИ-ТРЕНЕР НЕДЕЛИ: по понедельникам — разбор питания, сна и бюджета
   ===================================================================== */
function lastWeek() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const prev = new Date(mon); prev.setDate(mon.getDate() - 7);
  return { from: prev.getTime(), to: mon.getTime(), key: dayKey(prev) };
}
function weekData(w) {
  const t = targets(), b = buckets();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const k = dayKey(w.from + i * DAY + 12 * 36e5), d = b[k] || emptyDay(), st = dayStats(d), sl = sleepOf(k);
    days.push({
      day: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][i], kcal: Math.round(st.eaten), kcal_need: t.kcal + Math.round(st.actK), protein: Math.round(st.prot), fat: Math.round(st.fat), carbs: Math.round(st.carb),
      fiber: round1(st.fiber), water_ml: Math.round(st.water), water_need: waterNeed(st),
      meals_logged: d.food.length, sleep_h: sl ? round1(sleepH(sl)) : null, night_wakeups: sl ? (sl.wk || []).length : null, sport_min: st.mins, steps: st.steps,
      spent: Math.round(sum(d.tx.filter((x) => x.type === 'exp' && !x.hist), (x) => x.amount)),
    });
  }
  const tx = S.tx.filter((x) => !x.hist && x.t >= w.from && x.t < w.to);
  const prevTx = S.tx.filter((x) => !x.hist && x.t >= w.from - 7 * DAY && x.t < w.from && x.type === 'exp');
  const byCat = {};
  tx.filter((x) => x.type === 'exp').forEach((x) => { const n = catOf('exp', x.cat).n.replace('­', ''); byCat[n] = (byCat[n] || 0) + x.amount; });
  const byNote = {};
  tx.filter((x) => x.type === 'exp' && x.note && !x.rec).forEach((x) => { byNote[x.note] = (byNote[x.note] || 0) + x.amount; });
  const wIn = S.weights.filter((x) => x.t >= w.from && x.t < w.to).sort((a, c) => a.t - c.t);
  // готовые факты — чтобы ИИ не пропустил важное (пересып, ни разу не добранные нормы, переедание)
  const logged = days.filter((d) => d.meals_logged);
  const slept = days.filter((d) => d.sleep_h != null);
  const maxDay = logged.reduce((m, d) => (!m || d.kcal > m.kcal ? d : m), null);
  const facts = {
    days_with_food_logged: logged.length,
    days_kcal_in_norm: logged.filter((d) => d.kcal >= d.kcal_need * 0.9 && d.kcal <= d.kcal_need * 1.1).length,
    days_overeating_over_115pct: logged.filter((d) => d.kcal > d.kcal_need * 1.15).map((d) => `${d.day}: ${d.kcal} из ${d.kcal_need}`),
    max_kcal_day: maxDay ? `${maxDay.day}: ${maxDay.kcal} ккал` : null,
    days_protein_reached: logged.filter((d) => d.protein >= t.protein).length,
    days_fiber_reached: logged.filter((d) => d.fiber >= t.fiber).length,
    days_water_reached: days.filter((d) => d.water_ml >= d.water_need).length,
    days_sleep_7_to_9h: slept.filter((d) => d.sleep_h >= 7 && d.sleep_h <= 9.5).length,
    oversleep_days_over_10h: slept.filter((d) => d.sleep_h > 10).map((d) => `${d.day}: ${d.sleep_h} ч`),
    short_sleep_days_under_6h: slept.filter((d) => d.sleep_h < 6).map((d) => `${d.day}: ${d.sleep_h} ч`),
    nights_with_wakeups: slept.filter((d) => d.night_wakeups).length,
    days_with_sport_or_6000_steps: days.filter((d) => d.sport_min >= 20 || d.steps >= 6000).length,
    // «ни разу не добрал» — только по тому, что реально записывалось (пустые дни — пропуск учёта, а не провал)
    never_reached: [
      ['калории', logged.length >= 2, logged.some((d) => d.kcal >= d.kcal_need * 0.9 && d.kcal <= d.kcal_need * 1.1)],
      ['белок', logged.length >= 2, logged.some((d) => d.protein >= t.protein)],
      ['клетчатка', logged.length >= 2, logged.some((d) => d.fiber >= t.fiber)],
      ['вода', days.filter((d) => d.water_ml > 0).length >= 2, days.some((d) => d.water_ml >= d.water_need)],
      ['сон 7–9 ч', slept.length >= 2, slept.some((d) => d.sleep_h >= 7 && d.sleep_h <= 9.5)],
    ].filter(([, enough, hit]) => enough && !hit).map(([n]) => n),
  };
  const incCat = {};
  tx.filter((x) => x.type === 'inc' && !x.rec).forEach((x) => { const n = catOf('inc', x.cat).n.replace('­', ''); incCat[n] = (incCat[n] || 0) + x.amount; });
  const bigExp = tx.filter((x) => x.type === 'exp').sort((a, c) => c.amount - a.amount).slice(0, 5).map((x) => `${catOf('exp', x.cat).n.replace('­', '')}${x.note ? ' (' + String(x.note).slice(0, 30) + ')' : ''}: ${Math.round(x.amount)}`);
  const debts = typeof debtsSummary === 'function' ? debtsSummary().filter((d) => d.gave - d.back > 0.5).slice(0, 5).map((d) => `${String(d.name).slice(0, 20)}: ${Math.round(d.gave - d.back)}`) : [];
  const loansLeft = (S.loans || []).map((l) => ({ name: String(l.name || '').slice(0, 30), left: typeof loanState === 'function' ? Math.round((() => { const st = loanState(l); return st.left != null ? st.left : st.debt || 0; })()) : null })).filter((l) => l.left);
  return {
    facts,
    work: { mental_load: ['лёгкая', 'средняя', 'высокая'][+S.profile.mind || 0], stress: ['низкий', 'средний', 'высокий'][+S.profile.stress || 0] },
    profile: { sex: S.profile.sex === 'f' ? 'ж' : 'м', age: S.profile.age, height: S.profile.height, weight: round1(weightProgress().cur), goal: GOALS[S.profile.goal].n },
    targets: { kcal: t.kcal, protein: t.protein, fat: t.fat, carbs: t.carbs, fiber: t.fiber, water_ml: t.water, sleep_h: '7–9' },
    days,
    weight: { start_of_week: wIn[0] ? wIn[0].kg : null, end_of_week: wIn.length ? wIn[wIn.length - 1].kg : null, since_start: weightProgress().delta },
    money: {
      currency: 'сом', spent: Math.round(sum(tx.filter((x) => x.type === 'exp'), (x) => x.amount)), income: Math.round(sum(tx.filter((x) => x.type === 'inc' && !x.rec), (x) => x.amount)),
      spent_prev_week: Math.round(sum(prevTx, (x) => x.amount)),
      by_category: Object.fromEntries(Object.entries(byCat).sort((a, c) => c[1] - a[1]).slice(0, 10).map(([k, v]) => [k, Math.round(v)])),
      top_places: Object.fromEntries(Object.entries(byNote).sort((a, c) => c[1] - a[1]).slice(0, 6).map(([k, v]) => [k, Math.round(v)])),
      balance_now: Math.round(sum(Object.values(balances()), (x) => x)),
      income_by_category: Object.fromEntries(Object.entries(incCat).map(([k, v]) => [k, Math.round(v)])),
      biggest_expenses: bigExp,
      daily_spent: days.map((d) => `${d.day}: ${d.spent}`),
      savings_rate_pct: (() => { const inc = sum(tx.filter((x) => x.type === 'inc' && !x.rec), (x) => x.amount), sp = sum(tx.filter((x) => x.type === 'exp'), (x) => x.amount); return inc ? Math.round(((inc - sp) / inc) * 100) : null; })(),
      people_owe_me: debts,
      loans_left: loansLeft,
    },
  };
}
const COACH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER' }, title: { type: 'STRING' }, summary: { type: 'STRING' },
    alerts: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 1, maxItems: 6 },
    food: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 4, maxItems: 7 }, money: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 4, maxItems: 7 }, body: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 2, maxItems: 5 },
    goals: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['title'] } },
    adjust: { type: 'ARRAY', items: { type: 'OBJECT', properties: { param: { type: 'STRING', enum: ['kcal', 'protein', 'water'] }, value: { type: 'NUMBER' }, why: { type: 'STRING' } }, required: ['param', 'value', 'why'] } },
  },
  required: ['score', 'summary', 'alerts', 'food', 'money', 'body', 'goals'],
};
// предложения норм: убираем «2300 → 2300», мелочь и нереальные значения
function cleanAdjust(list) {
  const t = targets();
  const cur = { kcal: t.kcal, protein: t.protein, water: t.water };
  const lim = { kcal: [1200, 5000, 100], protein: [40, 300, 10], water: [1000, 5000, 200] }; // мин, макс, минимальный шаг
  return (list || []).map((a) => ({ ...a, value: Math.round(+a.value) })).filter((a) => {
    const L = lim[a.param]; if (!L || !Number.isFinite(a.value)) return false;
    return a.value >= L[0] && a.value <= L[1] && Math.abs(a.value - cur[a.param]) >= L[2];
  }).map((a) => ({ ...a, from: cur[a.param] }));
}
async function coachRun(force) {
  if (!aiReady() || UI.coachBusy || !S.profile) return;
  const w = lastWeek();
  if (!force && (S.coach || []).some((c) => c.week === w.key)) return;
  const data = weekData(w);
  const hasData = data.days.some((d) => d.meals_logged || d.sleep_h || d.sport_min) || data.money.spent;
  if (!hasData) { if (force) toast('За прошлую неделю почти нет записей — разбирать нечего'); return; }
  UI.coachBusy = true; if (UI.tab === 'hero' && !UI.sheetFn) render();
  try {
    const prompt = `Ты — тренер и финансовый наставник героя в RPG-приложении UpBek (Кыргызстан, валюта сом). Говори на «ты», дружелюбно, кратко, только по делу и с цифрами из данных.
Ниже данные пользователя за прошлую неделю (пн–вс). Дни без записей — это пропуски учёта, а не голод.
Дай:
- score: оценка недели 1–10;
- title: заголовок недели в 3–5 слов (в игровом стиле);
- summary: 2–3 предложения — главное за неделю, с цифрами;
ВАЖНО: каждый пункт — 1–2 предложения и обязательно с конкретной цифрой из данных (ккал, граммы, литры, часы, сомы, дни из 7). Без общих фраз вроде «питайся правильно».
- alerts: 1–5 коротких предупреждений по фактам из facts — ОБЯЗАТЕЛЬНО упомяни: каждую норму из never_reached («за неделю ни разу не добрал воду» и т.п.); каждый день из oversleep_days_over_10h (пересып тоже вреден: вялость, пропущенные дела, сбитый режим — скажи прямо); дни недосыпа; дни переедания из days_overeating_over_115pct с цифрами; ночные пробуждения, если их много. Если всё хорошо — 1 позитивный пункт;
- food: 3–6 конкретных советов по питанию с цифрами: средние калории/белок/жиры/углеводы/клетчатка против нормы, в какие дни был перебор или недобор, сколько записано приёмов пищи, чем добрать белок и клетчатку из доступных в Кыргызстане продуктов;
- money: 3–6 пунктов по казне с цифрами в сомах: доходы и расходы за неделю, процент сбережений (savings_rate_pct), топ-категории и самые крупные траты, в какой день потрачено больше всего, сравнение с прошлой неделей, долги людей и кредиты, где реально сэкономить и сколько;
- body: 2–4 совета про сон (длительность, пересып, пробуждения), шаги и тренировки; учитывай work (умственная нагрузка и стресс: при высоком стрессе — режим сна, перекусы без сахара, прогулки);
- goals: ровно 3 цели на эту неделю — измеримые и достижимые (например «5 дней из 7 добрать 100 г белка»);
- adjust: 0–3 предложения поменять дневные нормы (param: kcal — калории, protein — белок в граммах, water — вода в мл; value — НОВОЕ значение в день, оно ДОЛЖНО отличаться от текущего в targets минимум на 100 ккал / 10 г / 200 мл, иначе не предлагай; why — коротко почему). Предлагай, только если данные это подтверждают: например, вес не растёт при наборе массы — поднять kcal на 150–250; воды стабильно мало — скорректировать норму. Текущие нормы — в targets.
Без медицинских диагнозов. Если данных мало — начни с совета чаще записывать.
Данные: ${JSON.stringify(data)}`;
    const r = await aiCall([{ text: prompt }], COACH_SCHEMA);
    S.coach = [...(S.coach || []).filter((c) => c.week !== w.key), { week: w.key, at: Date.now(), v: APP_VER, ...r, adjust: cleanAdjust(r.adjust), goals: (r.goals || []).slice(0, 3).map((g) => ({ ...g, done: false })) }].slice(-12);
    save(); UI.coachBusy = false; if (!UI.sheetFn) render();
    toast('🧠 Разбор недели готов');
  } catch (e) {
    UI.coachBusy = false; if (!UI.sheetFn) render();
    if (force) toast('⚠️ ' + esc(aiErr(e.message)));
  }
}
const lastCoach = () => (S.coach || []).slice(-1)[0] || null;
function coachCard() {
  if (UI.coachBusy) return `<div class="card prompt"><div class="row"><div class="spinner" style="width:28px;height:28px;border-width:3px"></div><div class="grow"><b>🧠 Тренер разбирает твою неделю…</b><div class="dim">Пару секунд</div></div></div></div>`;
  const c = lastCoach();
  if (!c || c.week !== lastWeek().key) return '';
  if (new Date().getDay() !== 1 && dayKey(c.at) !== dayKey()) return '';
  const done = c.goals.filter((g) => g.done).length;
  return `<button class="card coach-card" data-a="coachOpen" data-v="${S.coach.length - 1}">
    <div class="row"><span class="coach-score">${Math.round(c.score)}<small>/10</small></span><div class="grow" style="text-align:left"><b>🧠 ${esc(c.title || 'Разбор недели')}</b><div class="dim">${esc(c.summary).slice(0, 110)}${c.summary.length > 110 ? '…' : ''}</div></div><span>›</span></div>
    <div class="dim" style="margin-top:8px;text-align:left">🎯 Цели недели: ${done} / ${c.goals.length} · +30 XP за каждую</div>
  </button>`;
}
// «Неделя в цифрах» — считается на телефоне, без ИИ: видно всё, даже если ИИ ответил кратко
function coachTable(weekKey) {
  const from = new Date(weekKey + 'T00:00:00').getTime(); if (!from) return '';
  const d = weekData({ from, to: from + 7 * DAY, key: weekKey }), t = targets();
  const days = d.days, has = (x) => x.meals_logged || x.sleep_h != null || x.water_ml || x.spent;
  if (!days.some(has)) return '';
  const cell = (v, ok, bad) => `<td class="${ok ? 'ok' : bad ? 'bad' : ''}">${v}</td>`;
  const rows = days.map((x) => `<tr><th>${x.day}</th>${x.meals_logged ? cell(fmt(x.kcal), x.kcal >= x.kcal_need * 0.9 && x.kcal <= x.kcal_need * 1.1, x.kcal > x.kcal_need * 1.15) + cell(x.protein, x.protein >= t.protein) + cell(dec(x.fiber), x.fiber >= t.fiber) : '<td class="na" colspan="3">—</td>'}${cell(x.water_ml ? dec(x.water_ml / 1000) : '—', x.water_ml >= x.water_need)}${cell(x.sleep_h != null ? dec(x.sleep_h) : '—', x.sleep_h >= 7 && x.sleep_h <= 9.5, x.sleep_h != null && (x.sleep_h > 10 || x.sleep_h < 6))}${cell(x.spent ? fmt(x.spent) : '—')}</tr>`).join('');
  const f = d.facts, m = d.money;
  return `<h3 class="vh">📊 Неделя в цифрах</h3>
  <div class="card ctab-wrap"><table class="ctab"><thead><tr><th></th><th>ккал</th><th>белок</th><th>🌾</th><th>вода, л</th><th>сон, ч</th><th>траты</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="ctab-legend"><span><i class="ok"></i>в норме</span><span><i class="bad"></i>перебор / пересып</span></div>
  <div class="split" style="margin-top:10px"><div><span>Доходы</span><b class="num green">+${fmt(m.income)}</b></div><div><span>Расходы</span><b class="num red">−${fmt(m.spent)}</b></div></div>
  <div class="dim" style="margin-top:8px">Нормы: ${fmt(t.kcal)} ккал · белок ${t.protein} г · клетчатка ${t.fiber} г · вода ${dec(t.water / 1000)} л · сон 7–9 ч${m.savings_rate_pct != null ? ` · отложено ${m.savings_rate_pct}% дохода` : ''}${f.days_with_food_logged ? ` · еда записана ${f.days_with_food_logged} дн. из 7` : ''}</div></div>`;
}
function openCoach(idx) {
  if (idx == null || !S.coach || !S.coach[idx]) idx = (S.coach || []).length - 1;
  UI.coachIdx = idx;
  const c = idx >= 0 ? S.coach[idx] : null;
  if (!c) {
    openSheet(() => `${sheetHead('🧠 Тренер недели')}
    <p>Каждый понедельник тренер разбирает прошлую неделю: питание, сон, спорт и бюджет — и даёт 3 цели на новую неделю.</p>
    <button class="btn gold" data-a="coachNow">Разобрать прошлую неделю</button>`);
    return;
  }
  const sec = (ic, t, arr) => (arr && arr.length ? `<h3 class="vh">${ic} ${t}</h3><ul class="coach-list">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  openSheet(() => `${sheetHead('🧠 ' + esc(c.title || 'Разбор недели'))}
    <div class="row"><span class="coach-score">${Math.round(c.score)}<small>/10</small></span><div class="grow">${esc(c.summary)}</div></div>
    ${(c.alerts || []).length ? `<div class="coach-alerts"><b>⚠️ Обрати внимание</b><ul class="coach-list">${c.alerts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${coachTable(c.week)}
    ${sec('🍗', 'Питание', c.food)}${sec('💰', 'Казна', c.money)}${sec('😴', 'Сон и спорт', c.body)}
    ${cleanAdjust(c.adjust).length ? `<h3 class="vh">📈 Предлагаю поменять нормы</h3><div class="card list">${cleanAdjust(c.adjust).map((a, i) => { const lab = { kcal: ['🍗', 'Калории', 'ккал', targets().kcal], protein: ['🥩', 'Белок', 'г', targets().protein], water: ['💧', 'Вода', 'мл', targets().water] }[a.param] || ['⚙️', a.param, '', 0]; const applied = false; return `<div class="item"><span class="ii">${lab[0]}</span><span class="grow"><div class="it">${lab[1]}: ${fmt(lab[3])} → <b class="gold">${fmt(a.value)} ${lab[2]}</b></div><div class="is" style="white-space:normal">${esc(a.why)}</div></span>${applied ? '<span class="green">✓</span>' : `<button class="btn gold sm" data-a="coachApply" data-v="${i}">Применить</button>`}</div>`; }).join('')}</div>` : ''}
    <h3 class="vh">🎯 Цели на неделю <small class="dim">+30 XP за каждую</small></h3>
    <div class="card list">${c.goals.map((g, i) => `<button class="item" data-a="coachGoal" data-v="${i}"><span class="ii">${g.done ? '✅' : '⬜'}</span><span class="grow"><div class="it" style="white-space:normal">${esc(g.title)}</div>${g.why ? `<div class="is" style="white-space:normal">${esc(g.why)}</div>` : ''}</span></button>`).join('')}</div>
    <div class="dim" style="margin-top:10px">Разбор от ${new Date(c.at).toLocaleDateString('ru-RU')} · UpBek v${esc(c.v || 'старая версия')} · советы ИИ, не медицинские рекомендации</div>
    <button class="btn ghost" style="margin-top:10px" data-a="coachNow">🔄 Разобрать заново</button>`);
}

Object.assign(A, {
  stmt: openStmt,
  stAcc: (el) => { UI.stAcc = el.dataset.v; refreshSheet(); },
  stPick: () => {
    pickFiles('application/pdf,image/*', true, (fs) => runStmt(fs));
  },
  stToggle: (el) => { const x = UI.stRows[+el.dataset.v]; x.on = !x.on; refreshSheet(); },
  stSave: () => {
    if (!UI.stRows) return;
    const acc = UI.stAcc;
    const add = UI.stRows.filter((x) => x.on).map((x) => ({ id: uid(), t: x.t, type: x.type, amount: x.amount, acc, cat: x.cat, note: x.note, imp: true, ...(x.hist ? { hist: true } : {}) }));
    const ids = add.map((x) => x.id);
    UI.stRows = null;
    closeSheet();
    UI.tab = 'money'; UI.mAcc = null; UI.mOff = 0;
    act(() => S.tx.push(...add), `📥 Добавлено ${add.length} операций`, () => act(() => { S.tx = S.tx.filter((x) => !ids.includes(x.id)); }, 'Отменено'));
  },
  coachOpen: (el) => openCoach(el && el.dataset && el.dataset.v != null ? +el.dataset.v : null),
  aiSheet: openAiSheet,
  coachApply: (el) => {
    const c = S.coach[UI.coachIdx] || lastCoach(); const a = c && cleanAdjust(c.adjust)[+el.dataset.v]; if (!a) return;
    const key = { kcal: 'kcalOverride', protein: 'proteinOverride', water: 'waterOverride' }[a.param]; if (!key) return;
    const v = Math.round(+a.value); if (!(v > 0)) return;
    act(() => { S.profile[key] = v; }, `📈 Новая норма: ${fmt(v)} ${a.param === 'kcal' ? 'ккал' : a.param === 'protein' ? 'г белка' : 'мл воды'}`);
    refreshSheet();
  },
  coachNow: async () => { closeSheet(); await coachRun(true); if (lastCoach()) openCoach(); },
  coachGoal: (el) => {
    const c = S.coach[UI.coachIdx] || lastCoach(); const g = c.goals[+el.dataset.v];
    const willDone = !g.done;
    act(() => { g.done = willDone; }, willDone ? '🎯 Цель выполнена!' : null);
    refreshSheet();
  },
});

// разбор недели — сам, в понедельник (или при первом запуске на неделе)
setTimeout(() => coachRun(false), 2500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => coachRun(false), 1500); });

// у тех, кто подключил ИИ раньше, ещё нет запасных моделей — дозаписываем тихо
(function fillAlts() {
  const c = aiCfg();
  if (!c.key || (c.alts && c.all)) return;
  aiPickModel(c.key).then(({ alts, all }) => { const n = aiCfg(); if (n.key === c.key) aiSaveCfg({ ...n, alts: n.alts || alts, all }); }).catch(() => {});
})();
