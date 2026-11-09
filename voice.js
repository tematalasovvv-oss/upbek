/* ===== UpBek: запись голосом — «потратил 500 и съел бризоль» → трата + еда ===== */
'use strict';

let rec = null, recStream = null, recChunks = [], recTimer = null, recStart = 0;

function openVoice() {
  if (!aiReady()) { openAiSetup(); return; }
  UI.voiceRec = false; UI.voiceCancel = false;
  openSheet(renderVoice);
}
function renderVoice() {
  const on = UI.voiceRec;
  return `${sheetHead('🎤 Скажи, что было')}
  <p class="muted" style="margin-top:0">Например: <i>«Потратил 500 сом в столовой, съел бризоль и чай»</i> или <i>«Такси 250, вечером гулял 40 минут»</i>. ИИ сам разнесёт траты, еду и спорт.</p>
  <div class="voice-wrap">
    <button class="mic ${on ? 'on' : ''}" data-a="${on ? 'vStop' : 'vStart'}" aria-label="${on ? 'Остановить' : 'Начать запись'}">${on ? '■' : '🎤'}</button>
    <div class="dim" id="vTime">${on ? '0:00 · нажми, чтобы закончить' : 'Нажми и говори'}</div>
  </div>
  <div class="dim" style="margin:14px 0 6px">…или напиши (можно надиктовать 🎤 на клавиатуре):</div>
  <textarea id="vText" rows="2" placeholder="Потратил 500, съел бризоль"></textarea>
  <button class="btn gold" style="margin-top:8px" data-a="vText">Разобрать</button>`;
}
async function voiceStart() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('Запись тут недоступна — нажми 🎤 на клавиатуре и надиктуй в поле'); const t = $('#vText'); if (t) t.focus(); return;
  }
  try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('Нет доступа к микрофону — разреши его или надиктуй через клавиатуру'); return; }
  const type = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  rec = new MediaRecorder(recStream, type ? { mimeType: type } : undefined);
  recChunks = []; UI.voiceCancel = false;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  rec.onstop = async () => {
    recStream.getTracks().forEach((t) => t.stop());
    clearInterval(recTimer); UI.voiceRec = false;
    if (UI.voiceCancel || !UI.sheetFn) return;
    const blob = new Blob(recChunks, { type: rec.mimeType || type || 'audio/mp4' });
    if (Date.now() - recStart < 1200 || blob.size < 1500) { toast('Слишком коротко — скажи ещё раз'); refreshSheet(); return; }
    const audio = await fileToB64(blob);
    runVoice({ audio, mime: (blob.type || 'audio/mp4').split(';')[0] });
  };
  rec.start(); recStart = Date.now(); UI.voiceRec = true; refreshSheet();
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    const el = $('#vTime'); if (el) el.textContent = `0:${pad(s)} · нажми, чтобы закончить`;
    if (s >= 60) voiceStop();
  }, 250);
}
function voiceStop() { if (rec && rec.state !== 'inactive') rec.stop(); }
function voiceCancel() { if (UI.voiceRec) { UI.voiceCancel = true; voiceStop(); } }

/* ---- разбор ИИ ---- */
function smartSchema() {
  const ids = [...pickCats(EXP_CATS), ...pickCats(INC_CATS)].map((c) => c[0]);
  return {
    type: 'OBJECT',
    properties: {
      transcript: { type: 'STRING' },
      transactions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        amount: { type: 'NUMBER' }, direction: { type: 'STRING', enum: ['out', 'in'] }, category: { type: 'STRING', enum: ids },
        description: { type: 'STRING' }, bank: { type: 'STRING' }, day: { type: 'STRING', enum: ['today', 'yesterday'] },
      }, required: ['amount', 'direction', 'category', 'description'] } },
      foods: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        name: { type: 'STRING' }, emoji: { type: 'STRING' }, grams: { type: 'NUMBER' }, kcal: { type: 'NUMBER' },
        protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, carbs: { type: 'NUMBER' }, day: { type: 'STRING', enum: ['today', 'yesterday'] },
      }, required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carbs'] } },
      activities: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        kind: { type: 'STRING', enum: ['walk', 'gym', 'steps'] }, minutes: { type: 'NUMBER' }, steps: { type: 'NUMBER' }, day: { type: 'STRING', enum: ['today', 'yesterday'] },
      }, required: ['kind'] } },
      comment: { type: 'STRING' },
    },
    required: ['transcript', 'transactions', 'foods'],
  };
}
function smartPrompt(isAudio, text) {
  const ex = pickCats(EXP_CATS).map((c) => `${c[0]} = ${c[2].replace('­', '')}`).join('; ');
  const inc = pickCats(INC_CATS).map((c) => `${c[0]} = ${c[2]}`).join('; ');
  const accs = S.accounts.map((a) => a.name).join(', ');
  const main = (accById(S.main) || {}).name || '';
  return `Пользователь из Кыргызстана ${isAudio ? 'наговорил голосом' : 'написал'} запись для приложения-трекера. Валюта — сом. Его счета: ${accs} (основной — ${main}).
Извлеки:
- transcript — что он сказал, дословно, по-русски;
- transactions — траты (out) и доходы (in): amount в сомах; category — из списка; description — коротко, на что/где; bank — название счёта, только если он его назвал; day — today или yesterday («вчера»);
- foods — всё, что он съел или выпил: короткое название по-русски, один эмодзи, вес порции в граммах и для этой порции kcal, protein, fat, carbs (реалистичные средние значения; учитывай местную кухню: бризоль, плов, лагман, манты, самса и т. п.);
- activities — прогулка (walk) или фитнес/тренировка (gym) в минутах, или шаги (steps).
Если деньги потрачены на еду («потратил 500 и покушал бризоль») — это трата в категории еды (canteen — столовая, fastfood — фастфуд, bar — бар, иначе food) И отдельно блюдо в foods.
Категории расходов: ${ex}.
Категории доходов: ${inc}.
Ничего не выдумывай: чего не было сказано — не добавляй. Если сумма не названа — не создавай трату.${text ? `\nТекст: «${text}»` : ''}`;
}
async function runVoice(input) {
  aiLoading(input.audio ? 'Слушаю и разбираю…' : 'Разбираю…');
  try {
    const parts = [{ text: smartPrompt(!!input.audio, input.text) }];
    if (input.audio) parts.push({ inline_data: { mime_type: input.mime, data: input.audio } });
    const r = await aiCall(parts, smartSchema());
    const okCat = (type, c) => (type === 'inc' ? INC_CATS : EXP_CATS).some((x) => x[0] === c && !x[3]);
    const findAcc = (hint) => {
      if (hint) {
        const h = norm(hint);
        const a = S.accounts.find((x) => norm(x.name).includes(h) || h.includes(norm(x.name).split(' ')[0]));
        if (a) return a.id;
        for (const [re, bank] of BANK_RE) if (re.test(hint)) { const b = S.accounts.find((x) => x.bank === bank); if (b) return b.id; }
      }
      return S.main || (S.accounts[0] && S.accounts[0].id);
    };
    UI.vRes = {
      transcript: r.transcript || input.text || '', comment: r.comment || '',
      tx: (r.transactions || []).filter((x) => +x.amount > 0).map((x) => {
        const type = x.direction === 'in' ? 'inc' : 'exp';
        return { on: true, type, amount: Math.round(+x.amount * 100) / 100, cat: okCat(type, x.category) ? x.category : type === 'inc' ? 'unknown_in' : 'unknown', note: String(x.description || '').slice(0, 60), acc: findAcc(x.bank), y: x.day === 'yesterday' };
      }),
      food: (r.foods || []).filter((x) => +x.kcal >= 0).map((x) => ({ ...x, on: true, mult: 1, y: x.day === 'yesterday' })),
      act: (r.activities || []).filter((x) => (x.kind === 'steps' ? +x.steps > 0 : +x.minutes > 0)).map((x) => ({ ...x, on: true, y: x.day === 'yesterday' })),
    };
    const v = UI.vRes;
    if (!v.tx.length && !v.food.length && !v.act.length) {
      openSheet(() => `${sheetHead('🎤 Не понял')}<p>${v.transcript ? `Я услышал: «${esc(v.transcript)}».<br>` : ''}Не нашёл ни трат, ни еды. Попробуй сказать иначе, например «потратил 300 на такси».</p><button class="btn gold" data-a="voice">Ещё раз</button>`);
      return;
    }
    openSheet(renderVoiceResult);
  } catch (e) {
    openSheet(() => `${sheetHead('🎤 Голос')}<p class="red">⚠️ ${esc(e.message === 'NO_KEY' ? 'Сначала подключи Gemini' : aiErr(e.message))}</p><button class="btn ghost" data-a="voice">Попробовать ещё</button>`);
  }
}
function renderVoiceResult() {
  const v = UI.vRes;
  const n = v.tx.filter((x) => x.on).length + v.food.filter((x) => x.on).length + v.act.filter((x) => x.on).length;
  const yd = (x) => (x.y ? ' · вчера' : '');
  return `${sheetHead('🎤 Вот что я понял')}
  ${v.transcript ? `<div class="heard">«${esc(v.transcript)}»</div>` : ''}
  ${v.tx.length ? `<h3 class="vh">💸 Деньги</h3><div class="card list">${v.tx.map((x, i) => { const c = catOf(x.type, x.cat); const a = accById(x.acc); return `<button class="item ${x.on ? '' : 'off'}" data-a="vTog" data-v="tx:${i}"><span class="ii">${x.on ? c.ic : '✕'}</span><span class="grow"><div class="it">${esc(x.note || c.n)}</div><div class="is">${c.n.replace('­', '')} · ${esc(a ? a.name : '—')}${yd(x)}</div></span><span class="iv ${x.type === 'inc' ? 'green' : ''}">${x.type === 'inc' ? '+' : '−'}${fmt(x.amount)}</span></button>`; }).join('')}</div>` : ''}
  ${v.food.length ? `<h3 class="vh">🍗 Еда</h3><div class="card list">${v.food.map((x, i) => `<div class="item aiitem ${x.on ? '' : 'off'}"><button class="ii" data-a="vTog" data-v="food:${i}">${x.on ? esc(x.emoji || '🍽️') : '✕'}</button><span class="grow"><div class="it">${esc(x.name)}</div><div class="is">~${Math.round(x.grams * x.mult)} г · Б ${Math.round(x.protein * x.mult)} · Ж ${Math.round(x.fat * x.mult)} · У ${Math.round(x.carbs * x.mult)}${yd(x)}</div></span><span class="mini-step"><button data-a="vMult" data-v="${i}:-0.5">−</button><b>${x.mult === 1 ? '1' : round1(x.mult)}</b><button data-a="vMult" data-v="${i}:0.5">＋</button></span><b class="iv">${fmt(x.kcal * x.mult)}</b></div>`).join('')}</div>` : ''}
  ${v.act.length ? `<h3 class="vh">🏃 Спорт</h3><div class="card list">${v.act.map((x, i) => { const A2 = actById(x.kind); return `<button class="item ${x.on ? '' : 'off'}" data-a="vTog" data-v="act:${i}"><span class="ii">${x.on ? A2.ic : '✕'}</span><span class="grow"><div class="it">${A2.n}</div><div class="is">${x.kind === 'steps' ? fmt(x.steps) + ' шагов' : Math.round(x.minutes) + ' мин'}${yd(x)}</div></span></button>`; }).join('')}</div>` : ''}
  ${v.comment ? `<div class="note">💡 ${esc(v.comment)}</div>` : ''}
  <button class="btn gold" style="margin-top:12px" data-a="vSave" ${n ? '' : 'disabled'}>Записать${n ? ` (${n})` : ''}</button>
  <div class="hint" style="margin-top:8px">Нажми на строку, чтобы убрать. Категорию и счёт потом можно поправить в Казне.</div>`;
}

Object.assign(A, {
  voice: openVoice,
  vStart: voiceStart,
  vStop: voiceStop,
  vText: () => { const t = ($('#vText') && $('#vText').value.trim()) || ''; if (t.length < 3) { toast('Напиши или надиктуй, что было'); return; } runVoice({ text: t }); },
  vTog: (el) => { const [k, i] = el.dataset.v.split(':'); const x = UI.vRes[k][+i]; x.on = !x.on; refreshSheet(); },
  vMult: (el) => { const [i, d] = el.dataset.v.split(':'); const x = UI.vRes.food[+i]; x.mult = clamp(round1(x.mult + +d), 0.5, 10); refreshSheet(); },
  vSave: () => {
    if (tooFast()) return;
    const v = UI.vRes; const now = Date.now();
    const tOf = (x) => (x.y ? now - DAY : now);
    const txs = v.tx.filter((x) => x.on).map((x) => ({ id: uid(), t: tOf(x), type: x.type, amount: x.amount, acc: x.acc, cat: x.cat, note: x.note, voice: true }));
    const eatTx = txs.find((x) => isEatCat(x.type, x.cat));
    const foods = v.food.filter((x) => x.on).map((x) => ({
      id: uid(), t: tOf(x), name: x.name, ic: x.emoji || '🍽️', unit: `~${Math.round(x.grams)} г`, qty: x.mult,
      k: Math.round(x.kcal), p: round1(x.protein), f: round1(x.fat), c: round1(x.carbs), ai: true,
      ...(eatTx && dayKey(eatTx.t) === dayKey(tOf(x)) ? { tx: eatTx.id } : {}),
    }));
    const acts = v.act.filter((x) => x.on).map((x) => {
      const Ak = actById(x.kind);
      const e = { id: uid(), t: tOf(x), kind: x.kind };
      if (x.kind === 'steps') { e.steps = Math.round(x.steps); e.kcal = actKcal(Ak, e.steps); } else { e.min = Math.round(x.minutes); e.kcal = actKcal(Ak, e.min); }
      return e;
    });
    const parts = [txs.length && `${txs.length} ${txs.length === 1 ? 'трата' : 'записи в казне'}`, foods.length && `${foods.length} еда · ${fmt(sum(foods, foodKcal))} ккал`, acts.length && `${acts.length} спорт`].filter(Boolean);
    const ids = new Set([...txs, ...foods, ...acts].map((x) => x.id));
    closeSheet();
    act(() => { S.tx.push(...txs); S.food.push(...foods); S.act.push(...acts); }, `🎤 Записано: ${parts.join(', ')}`,
      () => act(() => { S.tx = S.tx.filter((x) => !ids.has(x.id)); S.food = S.food.filter((x) => !ids.has(x.id)); S.act = S.act.filter((x) => !ids.has(x.id)); }, 'Отменено'));
  },
});
// закрыли окно во время записи — останавливаем микрофон
const _closeSheet = A.close;
A.close = () => { voiceCancel(); _closeSheet(); };
document.getElementById('backdrop').addEventListener('click', voiceCancel);
