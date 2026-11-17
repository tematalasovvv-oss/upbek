/* ===== UpBek: рейтинг друзей (без финансов) ===== */
'use strict';

// процент дня: среднее по 5 показателям, каждый не больше 100%
function dayPct(key) {
  const d = buckets()[key] || emptyDay();
  const t = targets(), st = dayStats(d);
  const c = (x) => clamp(Math.round((x || 0) * 100), 0, 100);
  const need = t.kcal + Math.round(st.actK);
  const kcal = S.profile.goal === 'lose' && st.eaten > need ? c(1 - (st.eaten - need) / need) : c(st.eaten / need);
  const sl = sleepOf(key);
  const r = {
    kcal, prot: c(st.prot / t.protein), water: c(st.water / waterNeed(st)),
    sleep: sl ? clamp(Math.round((sleepH(sl) / 8) * 100), 0, 100) : 0,
    move: c(Math.max(st.mins / 30, st.steps / 8000)),
  };
  r.total = Math.round((r.kcal + r.prot + r.water + r.sleep + r.move) / 5);
  return r;
}
// среднее за N дней (сегодня включительно), но не раньше начала пользования UpBek
function periodPct(n) {
  const start = dayKey(S.created || Date.now());
  const days = [];
  for (let i = 0; i < n; i++) { const k = dayKey(Date.now() - i * DAY); if (k >= start) days.push(dayPct(k)); }
  if (!days.length) days.push(dayPct(dayKey()));
  const avg = (f) => Math.round(sum(days, (x) => x[f]) / days.length);
  return { total: avg('total'), kcal: avg('kcal'), prot: avg('prot'), water: avg('water'), sleep: avg('sleep'), move: avg('move'), days: days.length };
}
const PCT_LABELS = [['kcal', '🍗', 'Калории'], ['prot', '🥩', 'Белок'], ['water', '💧', 'Вода'], ['sleep', '😴', 'Сон'], ['move', '🏃', 'Движение']];

/* ---- сервер ---- */
const boardOn = () => typeof cloudReady === 'function' && cloudReady() && S.cloud && S.cloud.token;
const newGroupCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(6)); r.forEach((x) => (s += a[x % a.length])); return s; };
async function boardPush(force) {
  const b = S.board; if (!boardOn() || !b || !b.grp) return;
  if (!force && b.pushed && Date.now() - b.pushed < 10 * 60000) return;
  const g = game(), w = periodPct(7), m = periodPct(30), td = dayPct(dayKey());
  await rpc('board_push', { p_token: S.cloud.token, p_group: b.grp, p_name: b.name, p_avatar: rankOf(g.L).ic, p_level: g.L, p_streak: g.streak, p_s7: w.total, p_s30: m.total, p_today: td.total, p_detail: { w, m } });
  b.pushed = Date.now(); save(true);
}
async function boardLoad() {
  const b = S.board; if (!boardOn() || !b || !b.grp) return [];
  return (await rpc('board_list', { p_token: S.cloud.token, p_group: b.grp })) || [];
}

/* ---- превью в «Ещё» ---- */
function ratingPreview() {
  const w = periodPct(7), td = dayPct(dayKey());
  return `<h2>🏆 Рейтинг</h2>
  <button class="card rating-card" data-a="ratingOpen">
    <div class="row"><span class="coach-score">${w.total}<small>%</small></span><div class="grow" style="text-align:left"><b>Твой средний день за неделю</b><div class="dim">Сегодня: ${td.total}% · ${S.board && S.board.grp ? 'группа ' + esc(S.board.grp) : 'создай группу и позови друзей'}</div></div><span>›</span></div>
  </button>`;
}

/* ---- страница рейтинга ---- */
function openRating() { UI.rPer = UI.rPer || 7; UI.rList = null; openSheet(renderRating); refreshBoard(); }
async function refreshBoard() {
  if (!S.board || !S.board.grp || !boardOn()) return;
  UI.rBusy = true; refreshSheet();
  try { await boardPush(true); UI.rList = await boardLoad(); UI.rErr = null; }
  catch (e) { UI.rErr = String(e.message || e).slice(0, 120); }
  UI.rBusy = false; if (UI.sheetFn === renderRating) refreshSheet();
}
function renderRating() {
  const per = UI.rPer || 7, my = periodPct(per);
  const mine = `<div class="card">
    <div class="row between"><b>Мой средний день · ${per} дн.</b><b class="gold num" style="font-size:22px">${my.total}%</b></div>
    ${PCT_LABELS.map(([k, ic, n]) => `<div class="mini" style="margin-top:8px"><div class="row"><span>${ic} ${n}</span><b class="num">${my[k]}%</b></div>${bar(my[k], 100, k === 'water' ? 'blue' : k === 'kcal' ? 'gold' : k === 'prot' ? 'red' : 'green')}</div>`).join('')}
    <div class="dim" style="margin-top:8px">Процент дня — среднее по 5 показателям (каждый максимум 100%). Финансы не учитываются. Дней в расчёте: ${my.days}.</div>
  </div>`;
  const seg = `<div class="seg" style="margin-bottom:12px"><button class="${per === 7 ? 'on' : ''}" data-a="rPer" data-v="7">7 дней</button><button class="${per === 30 ? 'on' : ''}" data-a="rPer" data-v="30">30 дней</button></div>`;
  if (!boardOn()) return `${sheetHead('🏆 Рейтинг')}${seg}${mine}<div class="note">Для рейтинга с друзьями нужна облачная копия (Настройки → Резервное копирование).</div>`;
  if (!S.board || !S.board.grp) {
    return `${sheetHead('🏆 Рейтинг')}${seg}${mine}
    <h3 class="vh">Соревнуйся с друзьями</h3>
    <div class="field"><label>Твоё имя в рейтинге</label><input id="rName" value="${esc((S.board && S.board.name) || S.profile.name || '')}" maxlength="24"></div>
    <div class="row"><button class="btn gold" data-a="rCreate">＋ Создать группу</button><button class="btn ghost" data-a="rJoinAsk">🔑 Войти по коду</button></div>
    <div class="note">Видны только имя, уровень, серия и проценты. Траты и деньги не передаются. Группу видят только те, у кого есть код.</div>`;
  }
  const list = (UI.rList || []).map((x) => ({ ...x, sc: Math.round(+(per === 7 ? x.s7 : x.s30) || 0) })).sort((a, b) => b.sc - a.sc);
  return `${sheetHead('🏆 Рейтинг')}${seg}
  <div class="card list">
    ${UI.rBusy && !UI.rList ? '<div class="empty">Загружаю…</div>' : ''}
    ${UI.rErr ? `<div class="empty red">⚠️ ${esc(UI.rErr)}</div>` : ''}
    ${list.map((x, i) => `<div class="item ${x.me ? 'me-row' : ''}"><span class="ii place">${['🥇', '🥈', '🥉'][i] || i + 1}</span><span class="grow"><div class="it">${esc(x.avatar || '')} ${esc(x.name)}${x.me ? ' <span class="dim">(ты)</span>' : ''}</div><div class="is">ур. ${x.level || 1} · 🔥 ${x.streak || 0} дн. · сегодня ${Math.round(+x.today || 0)}%</div></span><b class="num ${i === 0 ? 'gold' : ''}" style="font-size:18px">${x.sc}%</b></div>`).join('')}
  </div>
  ${mine}
  <div class="card"><div class="row between"><div><div class="dim">Код группы</div><b class="num" style="font-size:22px;letter-spacing:2px">${esc(S.board.grp)}</b></div><button class="btn gold sm" data-a="rShare">Пригласить</button></div>
  <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-a="rRefresh">🔄 Обновить</button><button class="btn ghost sm" data-a="rLeave">Выйти из группы</button></div></div>`;
}

Object.assign(A, {
  ratingOpen: openRating,
  rPer: (el) => { UI.rPer = +el.dataset.v; refreshSheet(); },
  rRefresh: refreshBoard,
  rCreate: async () => {
    const name = ($('#rName').value || '').trim().slice(0, 24); if (!name) { toast('Впиши имя'); return; }
    S.board = { grp: newGroupCode(), name }; save();
    await refreshBoard(); toast('🏆 Группа создана — пригласи друзей кодом');
  },
  rJoinAsk: async () => {
    const name = ($('#rName').value || '').trim().slice(0, 24); if (!name) { toast('Впиши имя'); return; }
    const code = (await askText('🔑 Код группы от друга', 'Например: K7M2QX')).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { if (code) toast('Код — 6 символов'); return; }
    S.board = { grp: code, name }; save();
    await refreshBoard(); toast('🏆 Ты в группе!');
  },
  rShare: async () => {
    const text = `Давай соревноваться в UpBek! Открой ${location.origin + location.pathname} → Ещё → Рейтинг → «Войти по коду»: ${S.board.grp}`;
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    copyText(text, 'Приглашение');
  },
  rLeave: async () => {
    if (!(await ask('Выйти из группы? Тебя уберут из рейтинга.', 'Выйти', 'Отмена'))) return;
    try { await rpc('board_leave', { p_token: S.cloud.token, p_group: S.board.grp }); } catch (e) { /* ок */ }
    S.board = { name: S.board.name }; save(); UI.rList = null; refreshSheet();
  },
});

// раз в 10 минут при открытии приложения отправляем свои проценты
setTimeout(() => boardPush(false).catch(() => {}), 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) boardPush(false).catch(() => {}); });
