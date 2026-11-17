/* ===== UpBek: женский цикл (логика как во Flo) — всё считается на телефоне, без ИИ =====
   Данные о цикле не отправляются ни в ИИ, ни в рейтинг, ни партнёру — только в зашифрованную копию. */
'use strict';

const CY = () => (S.cycle = S.cycle || { on: false, periods: [], days: {}, set: { cycleLen: 28, periodLen: 5 } });
const cycleOn = () => !!(S.profile && S.profile.sex === 'f' && CY().on);
const kT = (k) => new Date(k + 'T12:00:00').getTime();
const kAdd = (k, n) => dayKey(kT(k) + n * DAY);
const kDiff = (a, b) => Math.round((kT(b) - kT(a)) / DAY);

const FLOW = [['none', '—', 'Нет'], ['spot', '🩸', 'Мажущие'], ['light', '💧', 'Слабые'], ['medium', '💧💧', 'Средние'], ['heavy', '💧💧💧', 'Обильные']];
const SYMPTOMS = [['cramps', '😣', 'Спазмы'], ['head', '🤕', 'Головная боль'], ['bloat', '🎈', 'Вздутие'], ['breast', '💗', 'Боль в груди'], ['acne', '🔴', 'Акне'], ['tired', '🥱', 'Усталость'], ['sweet', '🍫', 'Тяга к сладкому'], ['back', '🦴', 'Боль в спине'], ['nausea', '🤢', 'Тошнота'], ['insomnia', '🌙', 'Бессонница']];
const MOODS = [['calm', '😌', 'Спокойная'], ['happy', '🥰', 'Счастливая'], ['energy', '⚡', 'Энергичная'], ['irritable', '😤', 'Раздражение'], ['sad', '😢', 'Грусть'], ['anxious', '😰', 'Тревога'], ['apathy', '😶', 'Апатия'], ['swings', '🎢', 'Перепады']];

// конец месячных: записанный или «обычная длительность», но не дальше сегодня
function perEnd(p, periodLen) { return p.end || [kAdd(p.start, periodLen - 1), dayKey()].sort()[0]; }
function normPeriods() {
  const c = CY(); const pl = c.set.periodLen;
  const ps = c.periods.filter((p) => p && p.start).sort((a, b) => (a.start < b.start ? -1 : 1));
  const out = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (last && p.start <= kAdd(perEnd(last, pl), 1)) { const e = [perEnd(last, pl), perEnd(p, pl)].sort()[1]; last.end = p.end || last.end ? e : null; }
    else out.push({ start: p.start, end: p.end || null });
  }
  c.periods = out;
}
function cycleStats() {
  const c = CY(); const ps = [...c.periods].sort((a, b) => (a.start < b.start ? -1 : 1));
  const lens = [];
  for (let i = 1; i < ps.length; i++) { const L = kDiff(ps[i - 1].start, ps[i].start); if (L >= 15 && L <= 60) lens.push(L); }
  const recent = lens.slice(-6);
  const cycleLen = recent.length ? Math.round(sum(recent, (x) => x) / recent.length) : c.set.cycleLen;
  const plens = ps.filter((p) => p.end).map((p) => kDiff(p.start, p.end) + 1).filter((x) => x >= 1 && x <= 12).slice(-6);
  const periodLen = plens.length ? Math.round(sum(plens, (x) => x) / plens.length) : c.set.periodLen;
  const today = dayKey();
  const last = ps[ps.length - 1] || null;
  if (!last) return { cycleLen, periodLen, lens: recent, ps };
  const lastEnd = perEnd(last, periodLen);
  const inPeriod = today >= last.start && today <= lastEnd && (last.end || kDiff(last.start, today) < 12);
  const cycleDay = kDiff(last.start, today) + 1;
  let nextStart = kAdd(last.start, cycleLen);
  const late = !inPeriod && nextStart < today ? kDiff(nextStart, today) : 0;
  const ov = kAdd(nextStart, -14);
  const fertile = [kAdd(ov, -5), kAdd(ov, 1)];
  const toNext = kDiff(today, nextStart);
  let phase;
  if (inPeriod) phase = ['🩸', 'Менструация', 'period'];
  else if (late) phase = ['⏳', `Задержка ${late} дн.`, 'late'];
  else if (today === ov) phase = ['🥚', 'Овуляция (прогноз)', 'ovu'];
  else if (today >= fertile[0] && today <= fertile[1]) phase = ['🌱', 'Фертильное окно', 'fertile'];
  else if (today < fertile[0]) phase = ['🌤️', 'Фолликулярная фаза', 'foll'];
  else if (toNext <= 5) phase = ['🌧️', 'Скоро месячные (ПМС)', 'pms'];
  else phase = ['🌙', 'Лютеиновая фаза', 'lut'];
  const vari = recent.length >= 3 ? Math.max(...recent) - Math.min(...recent) : null;
  return { cycleLen, periodLen, lens: recent, ps, last, lastEnd, inPeriod, cycleDay, nextStart, late, ov, fertile, toNext, phase, vari };
}
// что за день в календаре: месячные (записанные / прогноз), фертильные дни, овуляция
function dayKind(k, st) {
  const c = CY();
  if (c.periods.some((p) => k >= p.start && k <= perEnd(p, st.periodLen))) return 'period';
  if (!st.last) return '';
  // идущие месячные: оставшиеся дни — прогноз
  if (st.inPeriod && !st.last.end && k > dayKey() && k <= kAdd(st.last.start, st.periodLen - 1)) return 'ppred';
  let first = st.late ? dayKey() : st.nextStart;
  for (let i = 0; i < 4; i++) {
    const s = kAdd(first, i * st.cycleLen);
    if (k >= s && k <= kAdd(s, st.periodLen - 1) && k > st.lastEnd) return 'ppred';
    const ov = kAdd(s, -14);
    if (k === ov && k > st.lastEnd) return 'ovu';
    if (k >= kAdd(ov, -5) && k <= kAdd(ov, 1) && k > st.lastEnd) return 'fertile';
  }
  return '';
}
function setPeriodDay(k, on) {
  const c = CY(); const pl = c.set.periodLen;
  if (on) {
    const p = c.periods.find((x) => k >= kAdd(x.start, -1) && k <= kAdd(perEnd(x, pl), 1));
    if (p) { if (k < p.start) p.start = k; if (k > perEnd(p, pl) || (p.end && k > p.end)) p.end = k; }
    else c.periods.push({ start: k, end: k < dayKey() ? k : null });
  } else {
    const i = c.periods.findIndex((x) => k >= x.start && k <= perEnd(x, pl)); if (i < 0) return;
    const p = c.periods[i], e = perEnd(p, pl);
    if (k === p.start && k === e) c.periods.splice(i, 1);
    else if (k === p.start) p.start = kAdd(k, 1);
    else if (k === e) p.end = kAdd(k, -1);
    else { c.periods.splice(i, 1, { start: p.start, end: kAdd(k, -1) }, { start: kAdd(k, 1), end: e }); }
  }
  normPeriods();
}

/* ---- карточка на странице «Тело» ---- */
function cycleCard() {
  if (!S.profile || S.profile.sex !== 'f') return '';
  if (!CY().on) return `<h2>🌸 Цикл</h2><div class="card"><div class="row"><span style="font-size:28px">🌸</span><div class="grow"><b>Отслеживать цикл</b><div class="dim">Прогноз месячных, овуляции и фертильных дней</div></div></div><button class="btn gold" style="margin-top:10px" data-a="cySetup">Включить</button></div>`;
  const st = cycleStats();
  if (!st.last) return `<h2>🌸 Цикл</h2><div class="card"><div class="dim">Отметь начало месячных — и появится прогноз.</div><button class="btn gold" style="margin-top:10px" data-a="cyStart">🩸 Месячные начались</button></div>`;
  const pct = clamp((st.cycleDay / st.cycleLen) * 100, 0, 100);
  const nextTxt = st.inPeriod ? `Месячные: день ${st.cycleDay}` : st.late ? `Ожидались ${new Date(kT(st.nextStart)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : `Месячные через ${st.toNext} дн. · ${new Date(kT(st.nextStart)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
  const todayLog = CY().days[dayKey()];
  return `<h2>🌸 Цикл <small>день ${st.cycleDay} из ~${st.cycleLen}</small></h2>
  <div class="card cycle-card ph-${st.phase[2]}">
    <div class="row"><span class="cy-ic">${st.phase[0]}</span><div class="grow"><b>${st.phase[1]}</b><div class="dim">${nextTxt}</div></div></div>
    <div class="cy-track" style="background:linear-gradient(90deg,#ff6b7a 0 ${Math.round((st.periodLen / st.cycleLen) * 100)}%,var(--bg2) 0 ${Math.round(((st.cycleLen - 19) / st.cycleLen) * 100)}%,#3ddc97 0 ${Math.round(((st.cycleLen - 13) / st.cycleLen) * 100)}%,var(--bg2) 0)"><i style="width:${pct}%"></i><span class="cy-ov" style="left:${clamp(((st.cycleLen - 14) / st.cycleLen) * 100, 0, 100)}%"></span></div>
    ${!st.inPeriod ? `<div class="dim" style="margin-top:6px">🌱 Фертильное окно: ${new Date(kT(st.fertile[0])).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${new Date(kT(st.fertile[1])).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>` : ''}
    ${todayLog && ((todayLog.sym || []).length || (todayLog.mood || []).length) ? `<div class="dim" style="margin-top:6px">Сегодня: ${[...(todayLog.mood || []).map((m) => (MOODS.find((x) => x[0] === m) || [])[1]), ...(todayLog.sym || []).map((s) => (SYMPTOMS.find((x) => x[0] === s) || [])[1])].join(' ')}</div>` : ''}
    <div class="row" style="margin-top:12px">
      ${st.inPeriod ? '<button class="btn ghost sm" style="flex:1" data-a="cyEnd">Закончились</button>' : '<button class="btn gold sm" style="flex:1" data-a="cyStart">🩸 Начались</button>'}
      <button class="btn ghost sm" style="flex:1" data-a="cyDay" data-v="${dayKey()}">📝 Самочувствие</button>
      <button class="btn ghost sm" style="flex:1" data-a="cyCal">📅</button>
    </div>
  </div>`;
}

/* ---- настройка (как первые вопросы во Flo) ---- */
function openCycleSetup() {
  UI.cyS = UI.cyS || { last: kAdd(dayKey(), -14), cl: CY().set.cycleLen, pl: CY().set.periodLen };
  openSheet(() => `${sheetHead('🌸 Настройка цикла')}
  <div class="field"><label>Когда начались последние месячные?</label><input type="date" id="cyLast" max="${dayKey()}" value="${UI.cyS.last}"></div>
  <div class="field"><label>Обычная длина цикла (от начала до начала)</label><div class="stepper" style="margin:4px 0"><button data-a="cyAdj" data-v="cl:-1">−</button><b class="num">${UI.cyS.cl} дн.</b><button data-a="cyAdj" data-v="cl:1">＋</button></div></div>
  <div class="field"><label>Сколько обычно длятся месячные</label><div class="stepper" style="margin:4px 0"><button data-a="cyAdj" data-v="pl:-1">−</button><b class="num">${UI.cyS.pl} дн.</b><button data-a="cyAdj" data-v="pl:1">＋</button></div></div>
  <button class="btn gold" data-a="cySave">Сохранить</button>
  <div class="note">Не знаешь точно — оставь 28 и 5: прогноз уточнится сам после 2–3 циклов. Прогноз — оценка, а не метод контрацепции.</div>`);
}

/* ---- календарь ---- */
function openCycleCal() { UI.cyM = UI.cyM || 0; openSheet(renderCycleCal); }
function renderCycleCal() {
  const st = cycleStats();
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + (UI.cyM || 0));
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  const pad0 = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < pad0; i++) cells.push('<span></span>');
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const kind = dayKind(k, st); const log = CY().days[k];
    const has = log && (log.flow && log.flow !== 'none' || (log.sym || []).length || (log.mood || []).length || log.note);
    cells.push(`<button class="cy-d ${kind} ${k === dayKey() ? 'today' : ''} ${k > dayKey() ? 'future' : ''}" data-a="cyDay" data-v="${k}">${d}${has ? '<i></i>' : ''}</button>`);
  }
  const cyc = st.lens.length ? st.lens.join(', ') : '—';
  return `${sheetHead('📅 Календарь цикла')}
  <div class="daynav"><button data-a="cyMonth" data-v="-1">‹</button><b>${MONTHS_N[m]} ${y}</b><button data-a="cyMonth" data-v="1">›</button></div>
  <div class="cy-grid cy-head">${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => `<span>${d}</span>`).join('')}</div>
  <div class="cy-grid">${cells.join('')}</div>
  <div class="cy-legend"><span><i class="period"></i>месячные</span><span><i class="ppred"></i>прогноз</span><span><i class="fertile"></i>фертильные</span><span><i class="ovu"></i>овуляция</span></div>
  <div class="card" style="margin-top:12px">
    <div class="split" style="margin-top:0"><div><span>Средний цикл</span><b class="num">${st.cycleLen} дн.</b></div><div><span>Месячные</span><b class="num">${st.periodLen} дн.</b></div></div>
    <div class="dim" style="margin-top:8px">Последние циклы: ${cyc}${st.vari != null ? ` · ${st.vari <= 7 ? '✓ регулярный' : '⚠️ нерегулярный — разброс ' + st.vari + ' дн.'}` : ''}</div>
  </div>
  <div class="card">
    <label class="checkrow"><input type="checkbox" ${CY().share ? 'checked' : ''} data-a="cyShare"> 💑 Делиться фазой цикла с партнёром</label>
    <div class="dim">${S.pair && S.pair.mate ? `Партнёр (${esc(S.pair.mate.name)}) увидит утром только фазу и совет, как тебя поддержать. Симптомы, даты и заметки не передаются.` : 'Станет доступно, когда вы свяжетесь в «Паре» (Ещё → Настройки → Пара).'}</div>
  </div>
  <div class="row"><button class="btn ghost sm" data-a="cySetup">⚙️ Настройки цикла</button><button class="btn ghost sm" data-a="cyOff">Выключить</button></div>
  <div class="note">Нажми на день, чтобы отметить выделения, симптомы и настроение. Прогноз — оценка, не метод контрацепции. Если задержка больше 7 дней или боли сильные — к врачу.</div>`;
}
/* ---- отметка дня ---- */
function openCycleDay(k) { UI.cyK = k; openSheet(renderCycleDay); }
function renderCycleDay() {
  const k = UI.cyK, log = CY().days[k] || {}, st = cycleStats();
  const inP = dayKind(k, st) === 'period';
  const flow = log.flow || (inP ? 'medium' : 'none');
  const chips = (list, sel, act) => `<div class="chips wrap">${list.map(([id, ic, n]) => `<button class="chip ${sel.includes(id) ? 'on' : ''}" data-a="${act}" data-v="${id}">${ic} ${n}</button>`).join('')}</div>`;
  return `${sheetHead(`🌸 ${dayLabel(k)}`)}
  <h3 class="vh">🩸 Выделения</h3>${chips(FLOW, [flow], 'cyFlow')}
  <h3 class="vh">Симптомы</h3>${chips(SYMPTOMS, log.sym || [], 'cySym')}
  <h3 class="vh">Настроение</h3>${chips(MOODS, log.mood || [], 'cyMood')}
  <div class="field" style="margin-top:12px"><label>Заметка</label><input id="cyNote" value="${esc(log.note || '')}" maxlength="200" placeholder="Необязательно"></div>
  <button class="btn gold" data-a="cyDayDone">Готово</button>`;
}
function cyLog(k) { const c = CY(); return (c.days[k] = c.days[k] || {}); }
function cyClean(k) { const c = CY(), d = c.days[k]; if (d && (!d.flow || d.flow === 'none') && !(d.sym || []).length && !(d.mood || []).length && !d.note) delete c.days[k]; }

Object.assign(A, {
  cySetup: openCycleSetup,
  cyAdj: (el) => { const [k, d] = el.dataset.v.split(':'); const v = $('#cyLast'); if (v && v.value) UI.cyS.last = v.value; UI.cyS[k] = clamp(UI.cyS[k] + +d, k === 'cl' ? 18 : 2, k === 'cl' ? 45 : 10); refreshSheet(); },
  cySave: () => {
    const v = $('#cyLast'); const last = (v && v.value) || UI.cyS.last;
    const c = CY();
    closeSheet();
    act(() => {
      c.on = true; c.set = { cycleLen: UI.cyS.cl, periodLen: UI.cyS.pl };
      if (last && !c.periods.some((p) => p.start === last)) { c.periods.push({ start: last, end: kDiff(last, dayKey()) >= UI.cyS.pl ? kAdd(last, UI.cyS.pl - 1) : null }); normPeriods(); }
    }, '🌸 Цикл настроен — прогноз готов');
  },
  cyStart: () => {
    const k = dayKey(); const st = cycleStats();
    if (st.last && kDiff(st.last.start, k) < 10 && !st.last.end) { toast('Месячные уже отмечены'); return; }
    act(() => { CY().periods.push({ start: k, end: null }); normPeriods(); const d = cyLog(k); d.flow = d.flow && d.flow !== 'none' ? d.flow : 'medium'; }, '🩸 Отмечено. Береги себя 💗');
  },
  cyEnd: () => {
    const st = cycleStats(); if (!st.last) return;
    act(() => { const p = CY().periods.find((x) => x.start === st.last.start); p.end = dayKey(); normPeriods(); }, '✓ Месячные закончились');
  },
  cyCal: openCycleCal,
  cyShare: () => {
    const c = CY(); c.share = !c.share; save();
    if (typeof pairSync === 'function') pairSync(true).catch(() => {});
    refreshSheet(); toast(c.share ? '💑 Партнёр будет видеть фазу цикла' : 'Фаза цикла больше не передаётся');
  },
  cyMonth: (el) => { UI.cyM = (UI.cyM || 0) + +el.dataset.v; refreshSheet(); },
  cyDay: (el) => openCycleDay(el.dataset.v),
  cyFlow: (el) => {
    const k = UI.cyK, f = el.dataset.v;
    act(() => { cyLog(k).flow = f; setPeriodDay(k, f !== 'none' && f !== 'spot'); cyClean(k); }); refreshSheet();
  },
  cySym: (el) => { const d = cyLog(UI.cyK), s = new Set(d.sym || []); s.has(el.dataset.v) ? s.delete(el.dataset.v) : s.add(el.dataset.v); act(() => { d.sym = [...s]; cyClean(UI.cyK); }); refreshSheet(); },
  cyMood: (el) => { const d = cyLog(UI.cyK), s = new Set(d.mood || []); s.has(el.dataset.v) ? s.delete(el.dataset.v) : s.add(el.dataset.v); act(() => { d.mood = [...s]; cyClean(UI.cyK); }); refreshSheet(); },
  cyDayDone: () => { const n = $('#cyNote'); const k = UI.cyK; act(() => { cyLog(k).note = n ? n.value.trim().slice(0, 200) : ''; cyClean(k); }, '✓ Сохранено'); closeSheet(); },
  cyOff: async () => {
    if (!(await ask('Выключить отслеживание цикла? Записи сохранятся, их можно будет включить снова.', 'Выключить', 'Отмена'))) return;
    closeSheet(); act(() => { CY().on = false; }, 'Отслеживание цикла выключено');
  },
});
