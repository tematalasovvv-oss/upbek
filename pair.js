/* ===== UpBek: пара — дуэль недели, парные квесты, «подбодрить» =====
   Партнёру уходят только проценты, уровень, серия и счётчики дней. Без денег, записей и цикла. */
'use strict';

const NUDGES = [['water', '💧', 'Попей воды'], ['food', '🍗', 'Не забудь поесть'], ['move', '🏃', 'Пора подвигаться'], ['sleep', '😴', 'Пора спать'], ['proud', '💪', 'Ты молодец!'], ['love', '❤️', 'Люблю тебя']];
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
function pairSummary() {
  const g = game();
  return { lvl: g.L, avatar: rankOf(g.L).ic, streak: g.streak, today: dayPct(dayKey()).total, wk: weekStats(0), lw: weekStats(-1), stake: (S.pair && S.pair.stake) || '', stakeAt: (S.pair && S.pair.stakeAt) || 0 };
}
async function pairSync(force) {
  if (!pairOn()) return;
  const p = S.pair;
  // подбадривания забираем при каждом открытии — это лёгкий запрос
  const nudges = (await rpc('nudge_pull', { p_token: S.cloud.token, p_pair: p.code })) || [];
  if (nudges.length) { p.inbox = [...(p.inbox || []), ...nudges.map((x) => ({ from: x.from_name, kind: x.kind, t: Date.parse(x.created_at) }))].slice(-10); save(true); }
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

/* ---- главная: полученные подбадривания ---- */
function pairCards() {
  const inbox = (S.pair && S.pair.inbox) || [];
  if (!inbox.length) return '';
  return inbox.slice(-3).reverse().map((x, i) => { const nd = NUDGES.find((n) => n[0] === x.kind) || ['', '💌', '']; return `<div class="card prompt nudge-card"><div class="row"><span style="font-size:28px">${nd[1]}</span><div class="grow"><b>${esc(x.from)}: ${nd[2]}</b><div class="dim">${dayLabel(dayKey(x.t))}, ${hhmm(x.t)}</div></div><button class="x" data-a="nudgeSeen" data-v="${inbox.length - 1 - i}">✓</button></div></div>`; }).join('');
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
  const lead = sameWk ? me.wk.avg - ms.wk.avg : null;
  const lastRes = ms.lw && ms.lw.key === me.lw.key && (me.lw.avg || ms.lw.avg) ? (me.lw.avg === ms.lw.avg ? '🤝 Прошлая неделя — ничья' : me.lw.avg > ms.lw.avg ? `🏆 Прошлую неделю выиграл(а) ты: ${me.lw.avg}% против ${ms.lw.avg}%` : `🏆 Прошлую неделю выиграл(а) ${esc(m.name)}: ${ms.lw.avg}% против ${me.lw.avg}%`) : '';
  const stake = (ms.stakeAt || 0) > (p.stakeAt || 0) ? ms.stake : p.stake;
  const qRow = (q) => {
    const a = me.wk[q.key] || 0, b = sameWk ? (ms.wk[q.key] || 0) : 0, done = S.pairDone[`${me.wk.key}:${q.id}`];
    return `<div class="quest ${done ? 'done' : ''}"><div class="qi">${q.ic}</div><div class="grow"><div class="qt">${q.n}</div><div class="qd">${q.d}</div>
      <div class="pq"><span>Ты</span>${bar(a, q.need, 'gold')}<b class="num">${a}/${q.need}</b></div>
      <div class="pq"><span>${esc(m.name).slice(0, 8)}</span>${bar(b, q.need, 'blue')}<b class="num">${b}/${q.need}</b></div></div><div class="xp">+${PAIR_XP}</div></div>`;
  };
  return `${sheetHead('💑 ' + esc(p.name) + ' & ' + esc(m.name))}
  <div class="split" style="margin-top:0">
    <div><span>Ты · сегодня</span><b class="num">${me.today}%</b><div class="dim">ур. ${me.lvl} · 🔥 ${me.streak}</div></div>
    <div><span>${esc(m.name)} · сегодня</span><b class="num">${ms.today || 0}%</b><div class="dim">ур. ${ms.lvl || 1} · 🔥 ${ms.streak || 0}</div></div>
  </div>

  <h3 class="vh">⚔️ Дуэль недели</h3>
  <div class="card">
    <div class="duel"><div><b class="num">${me.wk.avg}%</b><span>Ты</span></div><div class="vs">VS</div><div><b class="num">${sameWk ? ms.wk.avg : 0}%</b><span>${esc(m.name)}</span></div></div>
    <div class="dim" style="text-align:center;margin-top:6px">${lead == null ? 'Партнёр ещё не обновлял неделю' : lead > 0 ? `Ты впереди на ${lead}%` : lead < 0 ? `${esc(m.name)} впереди на ${-lead}%` : 'Пока ничья'} · средний процент дня с понедельника</div>
    ${lastRes ? `<div class="note" style="margin-top:8px">${lastRes}${stake ? ` · ставка: «${esc(stake)}»` : ''}</div>` : ''}
    <div class="row" style="margin-top:10px"><input id="pairStake" maxlength="60" placeholder="Ставка, напр.: проигравший готовит ужин" value="${esc(stake || '')}"><button class="btn ghost sm" data-a="pairStake">OK</button></div>
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
  pairStake: async () => { S.pair.stake = ($('#pairStake').value || '').trim().slice(0, 60); S.pair.stakeAt = Date.now(); save(); try { await pairSync(true); } catch (e) { /* ок */ } toast('⚔️ Ставка сохранена'); refreshSheet(); },
  pairLeave: async () => {
    if (!(await ask('Выйти из пары? Дуэль и парные квесты остановятся.', 'Выйти', 'Отмена'))) return;
    try { await rpc('pair_leave', { p_token: S.cloud.token, p_pair: S.pair.code }); } catch (e) { /* ок */ }
    S.pair = null; save(); refreshSheet(); render();
  },
  nudge: async (el) => {
    if (tooFast()) return;
    const nd = NUDGES.find((n) => n[0] === el.dataset.v);
    try { await rpc('nudge_send', { p_token: S.cloud.token, p_pair: S.pair.code, p_kind: nd[0] }); toast(`${nd[1]} Отправлено: «${nd[2]}»`); }
    catch (e) { toast(/too many/.test(e.message) ? 'На сегодня хватит подбадриваний 😉' : '⚠️ ' + esc(e.message)); }
  },
  nudgeSeen: (el) => { const i = +el.dataset.v; S.pair.inbox.splice(i, 1); save(); render(); },
});

// обновляем пару при открытии приложения и после сохранения в облако (не чаще раза в 10 минут)
setTimeout(() => pairSync(false).then(() => render()).catch(() => {}), 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pairSync(false).then(() => { if (!UI.sheetFn) render(); }).catch(() => {}); });
