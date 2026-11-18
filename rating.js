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
    fiber: c(st.fiber / t.fiber),
  };
  r.total = Math.round((r.kcal + r.prot + r.water + r.sleep + r.move + r.fiber) / 6);
  return r;
}
// среднее за N дней (сегодня включительно), но не раньше начала пользования UpBek
function periodPct(n) {
  const start = dayKey(S.created || Date.now());
  const days = [];
  for (let i = 0; i < n; i++) { const k = dayKey(Date.now() - i * DAY); if (k >= start) days.push(dayPct(k)); }
  if (!days.length) days.push(dayPct(dayKey()));
  const avg = (f) => Math.round(sum(days, (x) => x[f]) / days.length);
  return { total: avg('total'), kcal: avg('kcal'), prot: avg('prot'), water: avg('water'), sleep: avg('sleep'), move: avg('move'), fiber: avg('fiber'), days: days.length };
}
const PCT_LABELS = [['kcal', '🍗', 'Калории'], ['prot', '🥩', 'Белок'], ['water', '💧', 'Вода'], ['sleep', '😴', 'Сон'], ['move', '🏃', 'Движение'], ['fiber', '🌾', 'Клетчатка']];

/* ---- сервер: один общий рейтинг для всех пользователей ---- */
const GLOBAL_BOARD = 'GLOBAL';
const boardOn = () => typeof cloudReady === 'function' && cloudReady() && S.cloud && S.cloud.token;
function boardInit() {
  if (!S.profile) return;
  const b = S.board || {};
  // старые группы по коду больше не используются — переезжаем в общий рейтинг
  if (b.grp && b.grp !== GLOBAL_BOARD && boardOn()) rpc('board_leave', { p_token: S.cloud.token, p_group: b.grp }).catch(() => {});
  S.board = { grp: GLOBAL_BOARD, name: (b.name || S.profile.name || 'Герой').slice(0, 24), hidden: !!b.hidden, pushed: b.grp === GLOBAL_BOARD ? b.pushed : 0 };
}
async function boardPush(force) {
  if (!S.board || S.board.grp !== GLOBAL_BOARD) boardInit();
  const b = S.board; if (!boardOn() || !b || b.hidden) return;
  if (!force && b.pushed && Date.now() - b.pushed < 10 * 60000) return;
  const g = game(), w = periodPct(7), m = periodPct(30), td = dayPct(dayKey());
  await rpc('board_push', { p_token: S.cloud.token, p_group: GLOBAL_BOARD, p_name: b.name, p_avatar: rankOf(g.L).ic, p_level: g.L, p_streak: g.streak, p_s7: w.total, p_s30: m.total, p_today: td.total, p_detail: {} }); // разбивку по калориям/сну/воде на сервер не отправляем
  b.pushed = Date.now(); save(true);
}
async function boardLoad() {
  if (!boardOn() || !S.board || S.board.hidden) return [];
  return (await rpc('board_list', { p_token: S.cloud.token, p_group: GLOBAL_BOARD })) || [];
}

/* ---- превью в «Ещё» ---- */
function ratingPreview() {
  const w = periodPct(7), td = dayPct(dayKey());
  const place = UI.rList && UI.rList.length ? [...UI.rList].sort((a, b) => b.s7 - a.s7).findIndex((x) => x.me) + 1 : 0;
  return `<h2>🏆 Рейтинг</h2>
  <button class="card rating-card" data-a="ratingOpen">
    <div class="row"><span class="coach-score">${w.total}<small>%</small></span><div class="grow" style="text-align:left"><b>Твой средний день за неделю</b><div class="dim">Сегодня: ${td.total}%${place ? ` · ${place} место из ${UI.rList.length}` : ' · общий рейтинг всех героев'}</div></div><span>›</span></div>
  </button>`;
}

/* ---- страница рейтинга ---- */
function openRating() { UI.rPer = UI.rPer || 7; openSheet(renderRating); refreshBoard(); }
async function refreshBoard() {
  if (!boardOn()) return;
  if (!S.board || S.board.grp !== GLOBAL_BOARD) boardInit();
  if (S.board.hidden) return;
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
    <div class="dim" style="margin-top:8px">Процент дня — среднее по 6 показателям (каждый максимум 100%). Финансы не учитываются. Дней в расчёте: ${my.days}.</div>
  </div>`;
  const seg = `<div class="seg" style="margin-bottom:12px"><button class="${per === 7 ? 'on' : ''}" data-a="rPer" data-v="7">7 дней</button><button class="${per === 30 ? 'on' : ''}" data-a="rPer" data-v="30">30 дней</button></div>`;
  if (!boardOn()) return `${sheetHead('🏆 Рейтинг')}${seg}${mine}<div class="note">Общий рейтинг работает через облако (Настройки → Резервное копирование).</div>`;
  const b = S.board || {};
  const me = `<div class="card">
    <div class="field" style="margin-bottom:8px"><label>Твоё имя в рейтинге</label><div class="row"><input id="rName" value="${esc(b.name || '')}" maxlength="24"><button class="btn ghost sm" style="padding:11px 12px" data-a="rName">OK</button></div></div>
    <label class="checkrow"><input type="checkbox" id="rHidden" ${b.hidden ? 'checked' : ''} data-a="rHide"> Скрыть меня из рейтинга</label>
    <div class="dim">В рейтинге видны только имя, уровень, серия и проценты. Деньги и записи не передаются.</div>
  </div>`;
  if (b.hidden) return `${sheetHead('🏆 Рейтинг')}${seg}${mine}${me}<div class="note">Ты скрыт — общий рейтинг виден только участникам. Сними галочку, чтобы вернуться.</div>`;
  const list = (UI.rList || []).map((x) => ({ ...x, sc: Math.round(+(per === 7 ? x.s7 : x.s30) || 0) })).sort((a, c) => c.sc - a.sc);
  const myPlace = list.findIndex((x) => x.me) + 1;
  return `${sheetHead('🏆 Общий рейтинг')}${seg}
  ${myPlace ? `<div class="hint" style="text-align:left;margin:-4px 0 8px">Ты на <b class="gold">${myPlace} месте</b> из ${list.length}</div>` : ''}
  <div class="card list">
    ${UI.rBusy && !UI.rList ? '<div class="empty">Загружаю…</div>' : ''}
    ${UI.rErr ? `<div class="empty red">⚠️ ${esc(UI.rErr)}</div>` : ''}
    ${list.map((x, i) => `<div class="item ${x.me ? 'me-row' : ''}"><span class="ii place">${['🥇', '🥈', '🥉'][i] || i + 1}</span><span class="grow"><div class="it">${esc(x.avatar || '')} ${esc(x.name)}${x.me ? ' <span class="dim">(ты)</span>' : ''}</div><div class="is">ур. ${x.level || 1} · 🔥 ${x.streak || 0} дн. · сегодня ${Math.round(+x.today || 0)}%</div></span><b class="num ${i === 0 ? 'gold' : ''}" style="font-size:18px">${x.sc}%</b></div>`).join('')}
  </div>
  <button class="btn ghost sm" style="margin:10px 0" data-a="rRefresh">🔄 Обновить</button>
  ${mine}${me}`;
}

Object.assign(A, {
  ratingOpen: openRating,
  rPer: (el) => { UI.rPer = +el.dataset.v; refreshSheet(); },
  rRefresh: refreshBoard,
  rName: async () => {
    const name = ($('#rName').value || '').trim().slice(0, 24); if (!name) { toast('Впиши имя'); return; }
    S.board.name = name; save(); await refreshBoard(); toast('✓ Имя в рейтинге обновлено');
  },
  rHide: async (el) => {
    const hide = !S.board.hidden;
    if (hide) { try { await rpc('board_leave', { p_token: S.cloud.token, p_group: GLOBAL_BOARD }); } catch (e) { /* ок */ } UI.rList = null; }
    S.board.hidden = hide; S.board.pushed = 0; save();
    if (!hide) await refreshBoard(); else refreshSheet();
    toast(hide ? 'Ты скрыт из рейтинга' : '🏆 Ты снова в рейтинге');
  },
});

// при открытии приложения (не чаще раза в 10 минут) отправляем свои проценты
setTimeout(() => { boardInit(); boardPush(false).catch(() => {}); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) boardPush(false).catch(() => {}); });
