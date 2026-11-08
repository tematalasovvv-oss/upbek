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
  if (/quota|RESOURCE_EXHAUSTED|rate/i.test(m)) return 'Лимит бесплатных запросов исчерпан — попробуй чуть позже.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет интернета или Google недоступен.';
  return m.slice(0, 160);
}
// выбираем самую свежую стабильную модель Flash, доступную по ключу
async function aiPickModel(key) {
  const r = await fetch(`${GEM}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(aiErr((j.error && j.error.message) || 'HTTP ' + r.status));
  const ver = (n) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  const ok = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')
    && /gemini-[\d.]+-flash/.test(m.name) && !/(lite|image|tts|live|audio|embedding|thinking|8b)/.test(m.name));
  const stable = ok.filter((m) => !/(preview|exp)/.test(m.name));
  const list = (stable.length ? stable : ok).sort((a, b) => ver(b.name) - ver(a.name) || a.name.length - b.name.length);
  return list.length ? list[0].name.replace('models/', '') : 'gemini-2.5-flash';
}
async function aiCall(parts, schema) {
  const c = aiCfg();
  if (!c.key) throw new Error('NO_KEY');
  const r = await fetch(`${GEM}/models/${c.model || 'gemini-2.5-flash'}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(aiErr((j.error && j.error.message) || 'HTTP ' + r.status));
  const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('ИИ не ответил — попробуй ещё раз');
  return JSON.parse(text);
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
async function imageToB64(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть фото')); i.src = url; });
    const max = 1024, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
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
  openSheet(() => `${sheetHead('✨ ИИ считает')}<div class="ai-wait"><div class="spinner"></div><div class="muted">${label}</div></div>`);
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
  const c = aiCfg();
  return `<h2>✨ ИИ (Gemini)</h2>
  <div class="card"><div class="row between"><div><b>${c.key ? 'Подключён' : 'Не подключён'}</b><div class="dim">${c.key ? esc(c.model || '') + ' · калории и БЖУ по фото и тексту' : 'Калории и БЖУ по фото еды — бесплатно'}</div></div>
  <button class="btn ${c.key ? 'ghost' : 'gold'} sm" data-a="aiSetup">${c.key ? 'Настроить' : 'Подключить'}</button></div></div>`;
}

Object.assign(A, {
  aiSetup: openAiSetup,
  aiConnect: async (el) => {
    const key = ($('#aiKey').value || '').trim();
    if (key.length < 20) { toast('Вставь ключ целиком'); return; }
    el.disabled = true; el.textContent = 'Проверяю ключ…';
    try {
      const model = await aiPickModel(key);
      aiSaveCfg({ key, model });
      closeSheet(); render(); toast(`✨ Gemini подключён (${esc(model)})`);
    } catch (e) { el.disabled = false; el.textContent = 'Подключить'; toast('⚠️ ' + esc(aiErr(e.message))); }
  },
  aiOff: () => { aiSaveCfg({}); closeSheet(); render(); toast('ИИ отключён'); },
  aiPhoto: () => {
    if (!aiReady()) { openAiSetup(); return; }
    const hint = ($('#foodText') && $('#foodText').value.trim()) || '';
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async () => {
      const f = i.files && i.files[0]; if (!f) return;
      try { const image = await imageToB64(f); runFoodAi({ image, text: hint }); } catch (e) { toast('⚠️ ' + esc(e.message)); }
    };
    i.click();
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
