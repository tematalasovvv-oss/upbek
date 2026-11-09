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
  return { model, alts };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function aiStatus(text) { const el = document.getElementById('aiStatus'); if (el) el.textContent = text; }
// запрос с повторами: при «занято/перегружено» ждём и повторяем, потом пробуем запасную модель
async function aiCall(parts, schema) {
  const c = aiCfg();
  if (!c.key) throw new Error('NO_KEY');
  const models = [...new Set([c.model || 'gemini-2.5-flash', ...(c.alts || [])])];
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema } });
  let last = '';
  for (let mi = 0; mi < models.length; mi++) {
    if (mi > 0) aiStatus('Основная модель занята — пробую запасную…');
    for (let attempt = 0; attempt < 3; attempt++) {
      let r, j = {};
      try {
        r = await fetch(`${GEM}/models/${models[mi]}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key }, body });
        j = await r.json().catch(() => ({}));
      } catch (e) { last = e.message; if (attempt < 2) { aiStatus('Нет связи — повторяю…'); await wait(2000); continue; } break; }
      if (r.ok) {
        const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
        if (!text) { last = 'ИИ не ответил — попробуй ещё раз'; continue; }
        aiCount();
        return JSON.parse(text);
      }
      last = (j.error && j.error.message) || 'HTTP ' + r.status;
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
          kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, carbs: { type: 'NUMBER' },
        },
        required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carbs'],
      },
    },
    comment: { type: 'STRING' },
  },
  required: ['items'],
};
function foodPrompt(hasImage, text) {
  const p = S.profile || {};
  return `Ты — нутрициолог. Пользователь живёт в Кыргызстане (частые блюда: плов, лагман, манты, самса, шорпо, бешбармак, куурдак, ашлямфу, лепёшка, боорсок, блюда столовых).
Определи каждое отдельное блюдо или продукт${hasImage ? ' на фото' : ''}, оцени вес порции в граммах и посчитай для ЭТОЙ порции калории (kcal), белки (protein), жиры (fat) и углеводы (carbs) в граммах.
Правила: названия короткие, по-русски; emoji — один подходящий эмодзи; числа — реалистичные средние значения для такой порции; каждое блюдо и напиток — отдельной строкой. Если на фото несколько одинаковых порций, перечисли их отдельно.
Если еды нет — верни пустой items и объясни в comment. В comment одной короткой фразой можно дать совет (цель пользователя: ${GOALS[p.goal] ? GOALS[p.goal].n.toLowerCase() : 'здоровое питание'}).${text ? `\nОписание от пользователя: «${text}»` : ''}`;
}
async function imageToB64(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть фото')); i.src = url; });
    const k =Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
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
    <span class="grow"><div class="it">${esc(x.name)}</div><div class="is">~${Math.round(x.grams * x.mult)} г · Б ${Math.round(x.protein * x.mult)} · Ж ${Math.round(x.fat * x.mult)} · У ${Math.round(x.carbs * x.mult)}</div></span>
    <span class="mini-step"><button data-a="aiMult" data-v="${i}:-0.5">−</button><b>${x.mult === 1 ? '1' : round1(x.mult)}</b><button data-a="aiMult" data-v="${i}:0.5">＋</button></span>
    <b class="iv">${fmt(x.kcal * x.mult)}</b></div>`).join('')}</div>
  <div class="total" style="margin:6px 0 12px"><div class="tv num">${fmt(tot('kcal'))} ккал</div><div class="tl">Б ${Math.round(tot('protein'))} г · Ж ${Math.round(tot('fat'))} г · У ${Math.round(tot('carbs'))} г</div></div>
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
  ${c.key ? `<div class="note">Сейчас подключено: <b>${esc(c.model || '')}</b></div><button class="btn danger" style="margin-top:8px" data-a="aiOff">Отключить ИИ</button>` : ''}
  <div class="note">🔒 Ключ хранится только на этом телефоне. На бесплатном тарифе Google может использовать запросы для улучшения моделей — не фотографируй ничего личного.</div>`);
}
function aiSection() {
  const c = aiCfg(); const u = aiUsage();
  return `<h2>✨ ИИ (Gemini)</h2>
  <div class="card"><div class="row between"><div><b>${c.key ? 'Подключён' : 'Не подключён'}</b><div class="dim">${c.key ? esc(c.model || '') : 'Еда по фото, выписки, тренер недели — бесплатно'}</div></div>
  <button class="btn ${c.key ? 'ghost' : 'gold'} sm" data-a="aiSetup">${c.key ? 'Настроить' : 'Подключить'}</button></div>
  ${c.key ? `<div class="split"><div><span>Запросов сегодня</span><b class="num">${u.today}</b></div><div><span>За месяц</span><b class="num">${u.month}</b></div></div>
  <div class="note">Бесплатный ключ без карты: при лимите Google просто ответит «попробуй позже», денег не спишет. Лимиты: aistudio.google.com → Usage.</div>` : ''}
  ${c.key ? '<button class="btn ghost" style="margin-top:10px" data-a="coachOpen">🧠 Разбор недели</button>' : ''}</div>`;
}

Object.assign(A, {
  aiSetup: openAiSetup,
  aiConnect: async (el) => {
    const key = ($('#aiKey').value || '').trim();
    if (key.length < 20) { toast('Вставь ключ целиком'); return; }
    el.disabled = true; el.textContent = 'Проверяю ключ…';
    try {
      const { model, alts } = await aiPickModel(key);
      aiSaveCfg({ key, model, alts });
      closeSheet(); render(); toast(`✨ Gemini подключён (${esc(model)})`);
    } catch (e) { el.disabled = false; el.textContent = 'Подключить'; toast('⚠️ ' + esc(aiErr(e.message))); }
  },
  aiOff: () => { aiSaveCfg({}); closeSheet(); render(); toast('ИИ отключён'); },
  aiPhoto: () => {
    if (!aiReady()) { openAiSetup(); return; }
    const hint = ($('#foodText') && $('#foodText').value.trim()) || '';
    pickFiles('image/*', false, async (fs) => {
      try { const image = await imageToB64(fs[0]); runFoodAi({ image, text: hint }); } catch (e) { toast('⚠️ ' + esc(e.message)); }
    });
  },
  aiText: () => {
    if (!aiReady()) { openAiSetup(); return; }
    const text = ($('#foodText') && $('#foodText').value.trim()) || '';
    if (text.length < 2) { toast('Напиши в поле, что съел, — например «тарелка лагмана и чай»'); const i = $('#foodText'); if (i) i.focus(); return; }
    runFoodAi({ text });
  },
  aiToggle: (el) => { const x = UI.aiRes.items[+el.dataset.v]; x.on = !x.on; refreshSheet(); },
  aiMult: (el) => { const [i, d] = el.dataset.v.split(':'); const x = UI.aiRes.items[+i]; x.mult = clamp(round1(x.mult + +d), 0.5, 10); refreshSheet(); },
  aiSave: () => {
    const R = UI.aiRes; const ctx = R.ctx;
    UI.foodDay = ctx.day;
    const t = viewDayTime();
    const entries = R.items.filter((x) => x.on).map((x) => ({
      id: uid(), t, name: x.name, ic: x.emoji || '🍽️', unit: `~${Math.round(x.grams)} г`, qty: x.mult,
      k: Math.round(x.kcal), p: round1(x.protein), f: round1(x.fat), c: round1(x.carbs), ai: true, ...(ctx.link ? { tx: ctx.link } : {}),
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
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) parts.push({ inline_data: { mime_type: 'application/pdf', data: await fileToB64(f) } });
      else parts.push({ inline_data: { mime_type: 'image/jpeg', data: await imageToB64(f, 1600) } });
    }
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
  ${groups.map((g) => `<div class="day-head"><span>${dayLabel(g.k)}</span></div><div class="card list" style="margin-bottom:0">${g.items.map(([x, i]) => { const c = catOf(x.type, x.cat); return `<button class="item ${x.on ? '' : 'off'}" data-a="stToggle" data-v="${i}"><span class="ii">${x.on ? c.ic : '✕'}</span><span class="grow"><div class="it">${esc(x.note || c.n)}</div><div class="is">${c.n}${x.dup ? ' · уже есть' : ''}${x.hist ? ' · 📜' : ''} · ${hhmm(x.t)}</div></span><span class="iv ${x.type === 'inc' ? 'green' : ''}">${x.type === 'inc' ? '+' : '−'}${fmt(x.amount)}</span></button>`; }).join('')}</div>`).join('')}
  <div class="sticky-save"><button class="btn gold" data-a="stSave" ${on.length ? '' : 'disabled'}>Добавить ${on.length} в хронологию</button></div>
  <div class="hint">Нажми на операцию, чтобы снять или вернуть. Категории потом можно поправить.</div>`;
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
      day: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][i], kcal: Math.round(st.eaten), protein: Math.round(st.prot), fat: Math.round(st.fat), carbs: Math.round(st.carb),
      meals_logged: d.food.length, sleep_h: sl ? round1(sleepH(sl)) : null, sport_min: st.mins, steps: st.steps,
    });
  }
  const tx = S.tx.filter((x) => !x.hist && x.t >= w.from && x.t < w.to);
  const prevTx = S.tx.filter((x) => !x.hist && x.t >= w.from - 7 * DAY && x.t < w.from && x.type === 'exp');
  const byCat = {};
  tx.filter((x) => x.type === 'exp').forEach((x) => { const n = catOf('exp', x.cat).n.replace('­', ''); byCat[n] = (byCat[n] || 0) + x.amount; });
  const byNote = {};
  tx.filter((x) => x.type === 'exp' && x.note && !x.rec).forEach((x) => { byNote[x.note] = (byNote[x.note] || 0) + x.amount; });
  const wIn = S.weights.filter((x) => x.t >= w.from && x.t < w.to).sort((a, c) => a.t - c.t);
  return {
    profile: { sex: S.profile.sex === 'f' ? 'ж' : 'м', age: S.profile.age, height: S.profile.height, weight: round1(weightProgress().cur), goal: GOALS[S.profile.goal].n },
    targets: { kcal: t.kcal, protein: t.protein, fat: t.fat, carbs: t.carbs },
    days,
    weight: { start_of_week: wIn[0] ? wIn[0].kg : null, end_of_week: wIn.length ? wIn[wIn.length - 1].kg : null, since_start: weightProgress().delta },
    money: {
      currency: 'сом', spent: Math.round(sum(tx.filter((x) => x.type === 'exp'), (x) => x.amount)), income: Math.round(sum(tx.filter((x) => x.type === 'inc' && !x.rec), (x) => x.amount)),
      spent_prev_week: Math.round(sum(prevTx, (x) => x.amount)),
      by_category: Object.fromEntries(Object.entries(byCat).sort((a, c) => c[1] - a[1]).slice(0, 10).map(([k, v]) => [k, Math.round(v)])),
      top_places: Object.fromEntries(Object.entries(byNote).sort((a, c) => c[1] - a[1]).slice(0, 6).map(([k, v]) => [k, Math.round(v)])),
      balance_now: Math.round(sum(Object.values(balances()), (x) => x)),
    },
  };
}
const COACH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER' }, title: { type: 'STRING' }, summary: { type: 'STRING' },
    food: { type: 'ARRAY', items: { type: 'STRING' } }, money: { type: 'ARRAY', items: { type: 'STRING' } }, body: { type: 'ARRAY', items: { type: 'STRING' } },
    goals: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['title'] } },
  },
  required: ['score', 'summary', 'food', 'money', 'body', 'goals'],
};
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
- summary: 2–3 предложения — главное за неделю;
- food: 2–4 конкретных совета по рациону (что добавить или убрать, какие доступные в Кыргызстане продукты, сколько добрать белка/ккал в день);
- money: 2–4 совета по бюджету (на что ушло больше всего, где реально сэкономить и сколько сом, сравни с прошлой неделей);
- body: 1–3 совета про сон, шаги и тренировки;
- goals: ровно 3 цели на эту неделю — измеримые и достижимые (например «5 дней из 7 добрать 100 г белка»).
Без медицинских диагнозов. Если данных мало — начни с совета чаще записывать.
Данные: ${JSON.stringify(data)}`;
    const r = await aiCall([{ text: prompt }], COACH_SCHEMA);
    S.coach = [...(S.coach || []).filter((c) => c.week !== w.key), { week: w.key, at: Date.now(), ...r, goals: (r.goals || []).slice(0, 3).map((g) => ({ ...g, done: false })) }].slice(-12);
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
  if (!c || Date.now() - c.at > 8 * DAY) return '';
  const done = c.goals.filter((g) => g.done).length;
  return `<button class="card coach-card" data-a="coachOpen">
    <div class="row"><span class="coach-score">${Math.round(c.score)}<small>/10</small></span><div class="grow" style="text-align:left"><b>🧠 ${esc(c.title || 'Разбор недели')}</b><div class="dim">${esc(c.summary).slice(0, 110)}${c.summary.length > 110 ? '…' : ''}</div></div><span>›</span></div>
    <div class="dim" style="margin-top:8px;text-align:left">🎯 Цели недели: ${done} / ${c.goals.length} · +30 XP за каждую</div>
  </button>`;
}
function openCoach() {
  const c = lastCoach();
  if (!c) {
    openSheet(() => `${sheetHead('🧠 Тренер недели')}
    <p>Каждый понедельник тренер разбирает прошлую неделю: питание, сон, спорт и бюджет — и даёт 3 цели на новую неделю.</p>
    <button class="btn gold" data-a="coachNow">Разобрать прошлую неделю</button>`);
    return;
  }
  const sec = (ic, t, arr) => (arr && arr.length ? `<h3 style="font-size:15px;margin:16px 0 6px">${ic} ${t}</h3><ul class="coach-list">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  openSheet(() => `${sheetHead('🧠 ' + esc(c.title || 'Разбор недели'))}
    <div class="row"><span class="coach-score">${Math.round(c.score)}<small>/10</small></span><div class="grow">${esc(c.summary)}</div></div>
    ${sec('🍗', 'Питание', c.food)}${sec('💰', 'Бюджет', c.money)}${sec('😴', 'Сон и спорт', c.body)}
    <h3 style="font-size:15px;margin:16px 0 6px">🎯 Цели на неделю <small class="dim">+30 XP за каждую</small></h3>
    <div class="card list">${c.goals.map((g, i) => `<button class="item" data-a="coachGoal" data-v="${i}"><span class="ii">${g.done ? '✅' : '⬜'}</span><span class="grow"><div class="it" style="white-space:normal">${esc(g.title)}</div>${g.why ? `<div class="is" style="white-space:normal">${esc(g.why)}</div>` : ''}</span></button>`).join('')}</div>
    <div class="dim" style="margin-top:10px">Разбор от ${new Date(c.at).toLocaleDateString('ru-RU')} · советы ИИ, не медицинские рекомендации</div>
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
  coachOpen: openCoach,
  coachNow: async () => { closeSheet(); await coachRun(true); if (lastCoach()) openCoach(); },
  coachGoal: (el) => {
    const c = lastCoach(); const g = c.goals[+el.dataset.v];
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
  if (!c.key || c.alts) return;
  aiPickModel(c.key).then(({ alts }) => { const n = aiCfg(); if (n.key === c.key) aiSaveCfg({ ...n, alts }); }).catch(() => {});
})();
