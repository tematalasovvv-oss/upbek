/* ===== UpBek: пара — дуэль недели, парные квесты, «подбодрить» =====
   Партнёру уходят только проценты, уровень, серия и счётчики дней. Без денег, записей и цикла. */
'use strict';

const NUDGES = [['water', '💧', 'Попей воды'], ['food', '🍎', 'Не забудь перекусить'], ['msg', '✉️', 'Сообщение']];
// подписи для подбадриваний от старых версий приложения
const NUDGE_LABELS = { water: ['💧', 'Попей воды'], food: ['🍎', 'Не забудь перекусить'], move: ['🏃', 'Пора подвигаться'], sleep: ['😴', 'Пора спать'], proud: ['💪', 'Ты молодец!'], love: ['❤️', 'Люблю тебя'], msg: ['✉️', ''] };
const PAIR_QUESTS = [
  { id: 'water', ic: '💧', n: 'Водный союз', d: 'Оба 5 дней из 7 в норме воды', key: 'water', need: 5 },
  { id: 'move', ic: '🏃', n: 'Вместе в движении', d: 'Оба 3 активных дня (20+ мин или 6000 шагов)', key: 'move', need: 3 },
  { id: 'sleep', ic: '😴', n: 'Режим сна', d: 'Оба 4 ночи по 7+ часов', key: 'sleep', need: 4 },
];
const PAIR_XP = 50;
const pairOn = () => !!(S.pair && S.pair.code && typeof cloudReady === 'function' && cloudReady() && S.cloud && S.cloud.token);

// неделя пн–вс: средний процент дня и сколько дней закрыты вода/движение/сон
function weekMon(off) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + off * 7); return d.getTime(); }
function weekStats(off) {
  const mon = weekMon(off), start = dayKey(S.created || Date.now()), today = dayKey();
  const r = { key: dayKey(mon), avg: 0, n: 0, water: 0, move: 0, sleep: 0 };
  let tot = 0;
  for (let i = 0; i < 7; i++) {
    const k = dayKey(mon + i * DAY); if (k > today) break; if (k < start) continue;
    const d = buckets()[k] || emptyDay(), st = dayStats(d);
    tot += dayPct(k).total; r.n++;
    if (st.water >= waterNeed(st)) r.water++;
    if (st.mins >= 20 || st.steps >= 6000) r.move++;
    const sl = sleepOf(k); if (sl && sleepH(sl) >= 7) r.sleep++;
  }
  r.avg = r.n ? Math.round(tot / r.n) : 0;
  return r;
}
// фаза цикла для партнёра — только с согласия и без подробностей
function cycleShare() {
  if (typeof cycleOn !== 'function' || !cycleOn() || !CY().share) return null;
  const st = cycleStats(); if (!st.last) return null;
  const ph = st.phase[2] === 'late' ? 'care' : st.phase[2];
  return { ph, day: st.inPeriod ? st.cycleDay : null, next: ph === 'pms' && st.toNext > 0 ? st.toNext : null };
}
function pairSummary() {
  const g = game();
  const d = S.pair && S.pair.duel;
  return { cy: cycleShare(), lvl: g.L, avatar: rankOf(g.L).ic, streak: g.streak, today: dayPct(dayKey()).total, wk: weekStats(0), lw: weekStats(-1), duel: d ? { wk: d.wk, role: d.role, at: d.at, ref: d.ref || 0, stake: d.stake || '' } : null };
}
async function pairSync(force) {
  if (!pairOn()) return;
  const p = S.pair;
  // подбадривания забираем при каждом открытии — это лёгкий запрос
  const nudges = (await rpc('nudge_pull', { p_token: S.cloud.token, p_pair: p.code })) || [];
  // «duel» — служебный сигнал: партнёр бросил вызов или ответил, сразу обновляем пару
  const msgs = nudges.filter((x) => x && x.kind !== 'duel' && NUDGE_LABELS[x.kind]);
  if (nudges.some((x) => x && x.kind === 'duel')) force = true;
  if (msgs.length) { p.inbox = [...(p.inbox || []), ...msgs.map((x) => ({ from: String(x.from_name || '').slice(0, 24), kind: x.kind, msg: x.kind === 'msg' ? String(x.msg || '').slice(0, 120) : undefined, t: Date.parse(x.created_at) || Date.now(), got: Date.now() }))].slice(-10); save(true); }
  if (!force && p.synced && Date.now() - p.synced < 10 * 60000) return;
  await rpc('pair_join', { p_token: S.cloud.token, p_pair: p.code, p_name: p.name, p_summary: pairSummary() });
  const rows = (await rpc('pair_get', { p_token: S.cloud.token, p_pair: p.code })) || [];
  const mate = rows.find((r) => !r.me);
  p.mate = mate ? { name: mate.name, s: mate.summary || {}, at: Date.parse(mate.updated_at) } : null;
  p.synced = Date.now();
  // парные квесты: засчитываем, когда оба выполнили (эта и прошлая неделя)
  if (p.mate) {
    const me = pairSummary();
    for (const [mine, theirs] of [[me.wk, p.mate.s.wk], [me.lw, p.mate.s.lw]]) {
      if (!mine || !theirs || mine.key !== theirs.key) continue;
      for (const q of PAIR_QUESTS) if (mine[q.key] >= q.need && theirs[q.key] >= q.need) S.pairDone[`${mine.key}:${q.id}`] = true;
    }
  }
  save(true);
}

/* ---- совет по циклу партнёрши: первые 30 минут после первого входа за день ---- */
const MATE_CY = {
  period: ['🩸', (n, s) => `У ${n} месячные${s.day ? ` (день ${s.day})` : ''}`, 'Будь внимательнее и мягче. Тепло, чай, грелка, меньше планов на вечер. Шоколадка и забота сейчас очень кстати 🍫'],
  pms: ['🌧️', (n, s) => `У ${n} скоро месячные${s.next ? ` (через ${s.next} дн.)` : ''}`, 'Возможны усталость и перепады настроения. Больше терпения, не спорь по мелочам, предложи помощь по дому.'],
  foll: ['🌤️', (n) => `У ${n} энергия растёт`, 'Отличное время для новых планов, активного свидания и совместной тренировки.'],
  fertile: ['✨', (n) => `У ${n} пик энергии и настроения`, 'Самое время для яркого свидания или совместной активности — прогулка, каток, горы.'],
  ovu: ['✨', (n) => `У ${n} пик энергии и настроения`, 'Самое время для яркого свидания или совместной активности — прогулка, каток, горы.'],
  lut: ['🌙', (n) => `У ${n} энергия идёт на спад`, 'Больше уюта и спокойных вечеров. Хороший момент приготовить вместе что-то вкусное.'],
  care: ['💗', (n) => `${n} может быть непросто сегодня`, 'Будь внимательнее: спроси, как она себя чувствует, и предложи поддержку.'],
};
function markFirstOpen() { const k = dayKey(); if (!S.dayFirst || S.dayFirst.d !== k) { S.dayFirst = { d: k, at: Date.now() }; save(true); } }
function mateCycleCard() {
  const m = S.pair && S.pair.mate; const cy = m && m.s && m.s.cy;
  if (!cy || !MATE_CY[cy.ph]) return '';
  markFirstOpen();
  if (Date.now() - S.dayFirst.at > 30 * 60000 || S.mateCyHide === dayKey()) return '';
  const [ic, title, tip] = MATE_CY[cy.ph];
  return `<div class="card prompt mate-cy"><div class="row"><span style="font-size:28px">${ic}</span><div class="grow"><b>${esc(title(m.name, cy))}</b><div class="dim" style="margin-top:2px">${tip}</div></div><button class="x" data-a="mateCyHide">✕</button></div></div>`;
}

/* ---- дуэль недели: вызов → согласие партнёра → старт ----
   Каждый хранит свою сторону в сводке пары: {wk, role: inv|acc|dec, at, ref, stake}.
   Данные партнёра чужие — проверяем типы и экранируем при выводе. */
const wkKey = () => dayKey(weekMon(0));
function cleanDuel(d) {
  if (!d || typeof d !== 'object' || !['inv', 'acc', 'dec'].includes(d.role) || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.wk))) return null;
  return { wk: d.wk, role: d.role, at: +d.at || 0, ref: +d.ref || 0, stake: String(d.stake || '').slice(0, 60) };
}
function duelState() {
  const p = S.pair, m = p && p.mate; if (!m) return null;
  const k = wkKey();
  // прошлая неделя закончилась — запоминаем её дуэль для итогов
  if (p.duel && p.duel.wk < k) { if (p.duel.on) p.duelLast = { wk: p.duel.wk, stake: p.duel.stakeOn || '' }; p.duel = null; save(true); }
  const my = p.duel && p.duel.wk === k ? p.duel : null;
  const thRaw = cleanDuel(m.s && m.s.duel), th = thRaw && thRaw.wk === k ? thRaw : null;
  let st = 'none';
  if (my && my.role === 'inv') st = th && (th.role === 'acc' || th.role === 'inv') ? 'on' : th && th.role === 'dec' && th.ref === my.at ? 'declined' : 'out';
  else if (my && my.role === 'acc') st = th && th.role === 'inv' ? 'on' : 'none';
  else if (th && th.role === 'inv') st = my && my.role === 'dec' && my.ref === th.at ? 'none' : 'in';
  const invs = [my, th].filter((x) => x && x.role === 'inv').sort((a, b) => a.at - b.at);
  const stake = invs.length ? invs[0].stake : '';
  if (st === 'on' && my && (!my.on || my.stakeOn !== stake)) { my.on = true; my.stakeOn = stake; save(true); }
  return { st, stake, th, my };
}
function duelLastResult() {
  const p = S.pair, m = p && p.mate, L = p && p.duelLast; if (!m || !L) return null;
  const me = weekStats(-1), ms = m.s && m.s.lw;
  if (!ms || ms.key !== L.wk || me.key !== L.wk) return null;
  const a = me.avg, b = +ms.avg || 0;
  return { a, b, wk: L.wk, stake: L.stake, text: a === b ? '🤝 Дуэль прошлой недели — ничья' : a > b ? `🏆 Ты выиграл(а) дуэль недели: ${a}% против ${b}%` : `🏆 Дуэль недели выиграл(а) ${esc(m.name)}: ${b}% против ${a}%` };
}
function duelVs(ds) {
  const m = S.pair.mate, me = weekStats(0), ms = m.s && m.s.wk && m.s.wk.key === me.key ? m.s.wk : null, b = ms ? +ms.avg || 0 : 0;
  const lead = ms ? me.avg - b : null;
  return `<div class="duel"><div><b class="num">${me.avg}%</b><span>Ты</span></div><div class="vs">VS</div><div><b class="num">${b}%</b><span>${esc(m.name)}</span></div></div>
    <div class="dim" style="text-align:center;margin-top:6px">${lead == null ? 'Партнёр ещё не обновлял неделю' : lead > 0 ? `Ты впереди на ${lead}%` : lead < 0 ? `${esc(m.name)} впереди на ${-lead}%` : 'Пока ничья'} · средний процент дня с понедельника</div>
    ${ds.stake ? `<div class="note" style="margin-top:8px">🎯 Ставка: «${esc(ds.stake)}»</div>` : ''}`;
}
// карточка на главном экране — только когда дуэль кто-то создал
function duelCard() {
  const ds = duelState(); if (!ds) return '';
  const m = S.pair.mate;
  if (ds.st === 'in') return `<div class="card prompt duel-card"><div class="row"><span style="font-size:28px">⚔️</span><div class="grow"><b>${esc(m.name)} вызывает тебя на дуэль недели</b><div class="dim">Кто наберёт больший средний % дня до воскресенья${ds.stake ? ` · ставка: «${esc(ds.stake)}»` : ''}</div></div></div>
    <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-a="duelDecline">Отказаться</button><button class="btn gold sm" data-a="duelAccept">⚔️ Принять</button></div></div>`;
  if (ds.st === 'on') return `<button class="card duel-card duel-home" data-a="pairOpen"><div class="dim" style="text-align:center;margin-bottom:6px">⚔️ Дуэль недели</div>${duelVs(ds)}</button>`;
  if (ds.st === 'out') return `<div class="card prompt duel-card"><div class="row"><span style="font-size:24px">⏳</span><div class="grow"><b>Вызов отправлен</b><div class="dim">Ждём, когда ${esc(m.name)} примет дуэль</div></div></div></div>`;
  if (ds.st === 'declined') return `<div class="card prompt duel-card"><div class="row"><span style="font-size:24px">🏳️</span><div class="grow"><b>${esc(m.name)} отказался(ась) от дуэли</b><div class="dim">Можно бросить вызов снова в «Паре»</div></div><button class="x" data-a="duelCancel" aria-label="Скрыть">✕</button></div></div>`;
  const r = duelLastResult();
  if (r && S.pair.duelSeen !== r.wk) return `<div class="card prompt duel-card"><div class="row"><span style="font-size:24px">🏆</span><div class="grow"><b>${r.text}</b>${r.stake ? `<div class="dim">Ставка: «${esc(r.stake)}»</div>` : ''}</div><button class="x" data-a="duelSeen" aria-label="Скрыть">✕</button></div>
    <button class="btn gold sm" style="margin-top:10px" data-a="duelInvite">⚔️ Новая дуэль</button></div>`;
  return '';
}

/* ---- главная: дуэль и полученные подбадривания ---- */
// сообщение висит на главной 1 час после получения или пока не нажмут ✓
const NUDGE_TTL = 60 * 60000;
const nudgeLive = (x) => Date.now() - (x.got || x.t || 0) < NUDGE_TTL;
function pairCards() {
  const inbox = (S.pair && S.pair.inbox) || [];
  if (inbox.length && !inbox.every(nudgeLive)) { S.pair.inbox = inbox.filter(nudgeLive); save(true); return pairCards(); }
  return duelCard() + inbox.slice(-3).reverse().map((x, i) => {
    const nd = NUDGE_LABELS[x.kind] || ['💌', ''];
    const text = x.kind === 'msg' ? `«${esc(x.msg || '')}»` : nd[1];
    return `<div class="card prompt nudge-card"><div class="row"><span style="font-size:28px">${nd[0]}</span><div class="grow"><b>${esc(x.from)}: ${text}</b><div class="dim">${dayLabel(dayKey(x.t))}, ${hhmm(x.t)}</div></div><button class="x" data-a="nudgeSeen" data-v="${inbox.length - 1 - i}" aria-label="Прочитано">✓</button></div></div>`;
  }).join('');
}

/* ---- окно «Пара» ---- */
function openPair() { openSheet(renderPair); pairSync(true).then(() => { if (UI.sheetFn === renderPair) refreshSheet(); render(); }).catch((e) => { UI.pairErr = String(e.message || e).slice(0, 120); if (UI.sheetFn === renderPair) refreshSheet(); }); }
function renderPair() {
  if (!(typeof cloudReady === 'function' && cloudReady() && S.cloud && S.cloud.token)) return `${sheetHead('💑 Пара')}<div class="note">Для пары нужна облачная копия (Настройки → Резервное копирование).</div>`;
  const p = S.pair;
  if (!p || !p.code) {
    return `${sheetHead('💑 Пара')}
    <p class="muted" style="margin-top:0">Свяжитесь по коду — и будет дуэль недели, общие квесты и «подбодрить» в одно касание. Партнёр видит только проценты, уровень и серию — без денег, записей и цикла.</p>
    <div class="field"><label>Твоё имя для партнёра</label><input id="pairName" maxlength="24" value="${esc((S.profile && S.profile.name) || '')}"></div>
    <div class="row"><button class="btn gold" data-a="pairCreate">＋ Создать пару</button><button class="btn ghost" data-a="pairJoin">🔑 Ввести код</button></div>`;
  }
  const me = pairSummary(), m = p.mate;
  if (!m) {
    return `${sheetHead('💑 Пара')}
    <div class="card" style="text-align:center"><div class="dim">Код пары</div><b class="num" style="font-size:30px;letter-spacing:3px">${esc(p.code)}</b>
    <div class="dim" style="margin-top:6px">Ждём партнёра: ему нужно открыть Ещё → Настройки → Пара → «Ввести код»</div>
    <button class="btn gold" style="margin-top:12px" data-a="pairShare">Отправить код</button></div>
    ${UI.pairErr ? `<div class="note red">⚠️ ${esc(UI.pairErr)}</div>` : ''}
    <button class="btn ghost sm" data-a="pairRefresh">🔄 Проверить</button> <button class="btn ghost sm" data-a="pairLeave">Отменить пару</button>`;
  }
  const ms = m.s || {};
  const sameWk = ms.wk && ms.wk.key === me.wk.key;
  const ds = duelState(), lastR = duelLastResult();
  const duelBlock = ds.st === 'on' ? duelVs(ds)
    : ds.st === 'in' ? `<div style="text-align:center"><b>${esc(m.name)} вызывает тебя на дуэль</b>${ds.stake ? `<div class="dim">Ставка: «${esc(ds.stake)}»</div>` : ''}</div><div class="row" style="margin-top:10px"><button class="btn ghost" data-a="duelDecline">Отказаться</button><button class="btn gold" data-a="duelAccept">⚔️ Принять</button></div>`
    : ds.st === 'out' ? `<div style="text-align:center"><b>⏳ Ждём ответа ${esc(m.name)}</b>${ds.stake ? `<div class="dim">Ставка: «${esc(ds.stake)}»</div>` : ''}</div><button class="btn ghost sm" style="margin-top:10px" data-a="duelCancel">Отменить вызов</button>`
    : `<div class="dim" style="text-align:center">${ds.st === 'declined' ? `${esc(m.name)} отказался(ась). ` : ''}Брось вызов на эту неделю: побеждает тот, у кого выше средний процент дня с понедельника по воскресенье. Дуэль начнётся, когда ${esc(m.name)} примет вызов.</div><button class="btn gold" style="margin-top:10px" data-a="duelInvite">⚔️ Бросить вызов</button>`;
  const qRow = (q) => {
    const a = me.wk[q.key] || 0, b = sameWk ? (+ms.wk[q.key] || 0) : 0, done = S.pairDone[`${me.wk.key}:${q.id}`];
    return `<div class="quest ${done ? 'done' : ''}"><div class="qi">${q.ic}</div><div class="grow"><div class="qt">${q.n}</div><div class="qd">${q.d}</div>
      <div class="pq"><span>Ты</span>${bar(a, q.need, 'gold')}<b class="num">${a}/${q.need}</b></div>
      <div class="pq"><span>${esc(String(m.name).slice(0, 8))}</span>${bar(b, q.need, 'blue')}<b class="num">${b}/${q.need}</b></div></div><div class="xp">+${PAIR_XP}</div></div>`;
  };
  return `${sheetHead('💑 ' + esc(p.name) + ' & ' + esc(m.name))}
  <div class="split" style="margin-top:0">
    <div><span>Ты · сегодня</span><b class="num">${me.today}%</b><div class="dim">ур. ${me.lvl} · 🔥 ${me.streak}</div></div>
    <div><span>${esc(m.name)} · сегодня</span><b class="num">${+ms.today || 0}%</b><div class="dim">ур. ${+ms.lvl || 1} · 🔥 ${+ms.streak || 0}</div></div>
  </div>

  <h3 class="vh">⚔️ Дуэль недели</h3>
  <div class="card">
    ${duelBlock}
    ${lastR ? `<div class="note" style="margin-top:8px">${lastR.text}${lastR.stake ? ` · ставка: «${esc(lastR.stake)}»` : ''}</div>` : ''}
  </div>

  <h3 class="vh">🤝 Парные квесты недели</h3>
  <div class="card">${PAIR_QUESTS.map(qRow).join('')}</div>

  <h3 class="vh">💌 Подбодрить ${esc(m.name)}</h3>
  <div class="nudges">${NUDGES.map(([k, ic, n]) => `<button class="tile" data-a="nudge" data-v="${k}"><span class="ic">${ic}</span><span class="tn">${n}</span></button>`).join('')}</div>

  <div class="row" style="margin-top:12px"><button class="btn ghost sm" data-a="pairRefresh">🔄 Обновить</button><button class="btn ghost sm" data-a="pairLeave">Выйти из пары</button></div>
  <div class="dim" style="margin-top:6px">Код пары: ${esc(p.code)} · данные партнёра обновляются при открытии приложения</div>`;
}

Object.assign(A, {
  pairOpen: openPair,
  pairRefresh: async () => { try { await pairSync(true); UI.pairErr = null; } catch (e) { UI.pairErr = String(e.message || e).slice(0, 120); } refreshSheet(); render(); },
  pairCreate: async () => {
    const name = ($('#pairName').value || '').trim().slice(0, 24); if (!name) { toast('Впиши имя'); return; }
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code = ''; crypto.getRandomValues(new Uint8Array(6)).forEach((x) => (code += a[x % a.length]));
    S.pair = { code, name, inbox: [] }; save();
    try { await pairSync(true); toast('💑 Пара создана — отправь код партнёру'); } catch (e) { toast('⚠️ ' + esc(e.message)); }
    refreshSheet();
  },
  pairJoin: async () => {
    const name = ($('#pairName').value || '').trim().slice(0, 24); if (!name) { toast('Впиши имя'); return; }
    const code = (await askText('🔑 Код пары от партнёра', 'Например: K7M2QX')).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { if (code) toast('Код — 6 символов'); return; }
    S.pair = { code, name, inbox: [] }; save();
    try { await pairSync(true); toast(S.pair.mate ? `💑 Вы в паре с ${esc(S.pair.mate.name)}!` : '💑 Код принят — ждём партнёра'); }
    catch (e) { const full = /pair full/.test(e.message); S.pair = null; save(); toast(full ? '⚠️ В этой паре уже двое' : '⚠️ ' + esc(e.message)); }
    refreshSheet();
  },
  pairShare: async () => {
    const text = `Давай будем парой в UpBek 💑 Открой ${location.origin + location.pathname} → Ещё → Настройки → Пара → «Ввести код»: ${S.pair.code}`;
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    copyText(text, 'Код');
  },
  duelInvite: async () => {
    const m = S.pair && S.pair.mate; if (!m) return;
    const stake = await askText(`⚔️ <b>Дуэль недели с ${esc(m.name)}</b><br><span class="dim">Ставка — по желанию. Дуэль начнётся, когда партнёр примет вызов.</span>`, 'Ставка, напр.: проигравший готовит ужин', ['Проигравший готовит ужин', 'Проигравший моет посуду', 'Массаж 15 минут', 'Кино на выбор победителя'], { no: 'Отмена', yes: '⚔️ Вызвать', cancel: true, max: 60 });
    if (stake == null) return;
    S.pair.duel = { wk: wkKey(), role: 'inv', at: Date.now(), stake: stake.slice(0, 60) }; S.pair.duelSeen = (duelLastResult() || {}).wk || S.pair.duelSeen; save();
    await duelPush('⚔️ Вызов отправлен — ждём ответа');
  },
  duelAccept: async () => { const ds = duelState(); if (!ds || !ds.th) return; S.pair.duel = { wk: wkKey(), role: 'acc', at: Date.now(), ref: ds.th.at }; save(); await duelPush('⚔️ Дуэль началась! Удачи'); },
  duelDecline: async () => { const ds = duelState(); if (!ds || !ds.th) return; if (!(await ask('Отказаться от дуэли на этой неделе?', 'Отказаться', 'Отмена'))) return; S.pair.duel = { wk: wkKey(), role: 'dec', at: Date.now(), ref: ds.th.at }; save(); await duelPush('Дуэль отклонена'); },
  duelCancel: async () => { S.pair.duel = null; save(); await duelPush(''); },
  duelSeen: () => { const r = duelLastResult(); S.pair.duelSeen = r ? r.wk : null; save(); render(); },
  pairLeave: async () => {
    if (!(await ask('Выйти из пары? Дуэль и парные квесты остановятся.', 'Выйти', 'Отмена'))) return;
    try { await rpc('pair_leave', { p_token: S.cloud.token, p_pair: S.pair.code }); } catch (e) { /* ок */ }
    S.pair = null; save(); refreshSheet(); render();
  },
  nudge: async (el) => {
    const nd = NUDGES.find((n) => n[0] === el.dataset.v); if (!nd) return;
    let msg = null;
    if (nd[0] === 'msg') {
      msg = await askText(`✉️ Сообщение для ${esc(S.pair.mate ? S.pair.mate.name : 'партнёра')}`, 'Напиши пару слов…', [], { no: 'Отмена', yes: 'Отправить', cancel: true, max: 120 });
      if (!msg) return;
    } else if (tooFast()) return;
    try { await rpc('nudge_send', { p_token: S.cloud.token, p_pair: S.pair.code, p_kind: nd[0], p_msg: msg }); toast(`${nd[1]} Отправлено${msg ? '' : `: «${nd[2]}»`}`); }
    catch (e) { toast(/too many/.test(e.message) ? 'На сегодня хватит подбадриваний 😉' : '⚠️ ' + esc(e.message)); }
  },
  mateCyHide: () => { S.mateCyHide = dayKey(); save(true); render(); },
  nudgeSeen: (el) => { const i = +el.dataset.v; S.pair.inbox.splice(i, 1); save(); render(); },
});

// после действия в дуэли: отправляем свою сторону и сигнал партнёру, чтобы он увидел сразу
async function duelPush(msg) {
  try { await pairSync(true); await rpc('nudge_send', { p_token: S.cloud.token, p_pair: S.pair.code, p_kind: 'duel', p_msg: null }); if (msg) toast(msg); }
  catch (e) { toast('⚠️ Не удалось связаться с сервером — попробую при следующем открытии'); }
  if (UI.sheetFn) refreshSheet(); render();
}

// обновляем пару при открытии приложения и после сохранения в облако (не чаще раза в 10 минут)
markFirstOpen();
// с утра данные партнёра должны быть свежими — первое открытие дня синхронизирует сразу
setTimeout(() => pairSync(!S.pair || !S.pair.synced || dayKey(S.pair.synced) !== dayKey()).then(() => { if (!UI.sheetFn) render(); }).catch(() => {}), 1500);
setInterval(() => {
  if (document.hidden || UI.sheetFn || UI.tab !== 'hero') return;
  const cyOld = S.dayFirst && Date.now() - S.dayFirst.at > 30 * 60000 && document.querySelector('.mate-cy');
  const nOld = S.pair && (S.pair.inbox || []).some((x) => !nudgeLive(x));
  if (cyOld || nOld) render();
}, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { markFirstOpen(); pairSync(!S.pair || !S.pair.synced || dayKey(S.pair.synced) !== dayKey()).then(() => { if (!UI.sheetFn) render(); }).catch(() => {}); } });
