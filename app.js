/* ===== UpBek — жизнь как РПГ ===== */
'use strict';

const STORE = 'upbek.v1';
const DAY = 864e5;

/* ---------- утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n || 0).toLocaleString('ru-RU');
const som = (n) => fmt(n) + ' сом';
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round1 = (n) => Math.round(n * 10) / 10;
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hhmm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const short = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return round1(n / 1e6).toLocaleString('ru-RU') + 'м';
  if (a >= 1e4) return Math.round(n / 1e3) + 'к';
  return fmt(n);
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_N = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
function dayLabel(key) {
  const today = dayKey(), yest = dayKey(Date.now() - DAY);
  if (key === today) return 'Сегодня';
  if (key === yest) return 'Вчера';
  const d = new Date(key + 'T12:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function mealName(t) {
  const h = new Date(t).getHours();
  if (h >= 5 && h < 11) return 'Завтрак';
  if (h >= 11 && h < 16) return 'Обед';
  if (h >= 17 && h < 22) return 'Ужин';
  return 'Перекус';
}
const wordRe = {};
function hasWord(s, w) { // слово w начинается с начала слова в s
  const re = wordRe[w] || (wordRe[w] = new RegExp('(^|[^а-яa-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return re.test(s);
}
function wholeWord(s, w) {
  return new RegExp('(^|[^а-яa-z])' + w + '([^а-яa-z]|$)').test(s);
}

/* ---------- данные ---------- */
function fresh() {
  return { v: 1, profile: null, accounts: [], main: null, tx: [], food: [], act: [], weights: [], customFoods: [], usage: {}, sleep: [], bedMarks: [], cloud: null, coach: [], sleepSkip: null, recSkip: null, lastHidden: null, lastLevel: 1, seenAch: [], created: Date.now() };
}
function load() {
  try { const raw = localStorage.getItem(STORE); if (raw) return Object.assign(fresh(), JSON.parse(raw)); } catch (e) { /* пусто */ }
  return fresh();
}
let S = load();
function save(noCloud) {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { toast('⚠️ Не получилось сохранить данные'); }
  if (!noCloud && typeof cloudSchedule === 'function') cloudSchedule();
}
/* ---------- темы ---------- */
const THEMES = [
  { id: 'classic', n: 'Классика', d: 'Тёмная фэнтези-РПГ', sw: ['#0d1020', '#8b6cff', '#f6c453'] },
  { id: 'comic', n: 'Комикс', d: 'Мультивселенная: полутона, неон, «БАМ!»', sw: ['#0b0614', '#ff2e88', '#00e5ff', '#ffe14d'] },
];
function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = id === 'comic' ? '#0b0614' : '#0d1020';
}
const UI = { tab: 'hero', foodDay: 0, allFoods: false, money: null, sheetFn: null, ob: { step: 1, d: {}, banks: { mbank: { on: true, bal: '' } }, main: 'mbank' } };

/* ---------- расчёты: тело ---------- */
function targets(p = S.profile) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'f' ? -161 : 5);
  const base = bmr * (p.life || 1.2);
  const g = GOALS[p.goal] || GOALS.keep;
  const kcal = +p.kcalOverride || Math.round((base + g.adj) / 50) * 50;
  const protein = +p.proteinOverride || Math.round(p.weight * g.prot);
  const fat = Math.round(p.weight * 1.0);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), base: Math.round(base), kcal, protein, fat, carbs };
}
const foodKcal = (e) => e.k * e.qty;
const foodProt = (e) => e.p * e.qty;
const allFoods = () => [...S.customFoods, ...FOODS];
const foodById = (id) => allFoods().find((f) => f.id === id);

function dayStats(d) {
  const sport = d.act.filter((a) => !a.steps);
  return {
    eaten: sum(d.food, foodKcal),
    prot: sum(d.food, foodProt),
    fat: sum(d.food, (e) => (e.f || 0) * e.qty),
    carb: sum(d.food, (e) => (e.c || 0) * e.qty),
    actK: sum(d.act, (a) => a.kcal),
    mins: sum(sport, (a) => a.min),
    steps: sum(d.act, (a) => a.steps),
  };
}
function questsOf(d) {
  const t = targets(), st = dayStats(d), goal = S.profile.goal;
  const need = t.kcal + Math.round(st.actK);
  const kcalOk = goal === 'lose' ? st.eaten >= need * 0.8 && st.eaten <= need * 1.05 : st.eaten >= need * 0.9;
  const pct = need ? Math.round((st.eaten / need) * 100) : 0;
  return [
    { id: 'kcal', ic: '🍗', t: goal === 'lose' ? 'Держи норму' : 'Накорми героя', d: `${fmt(st.eaten)} / ${fmt(need)} ккал · ${pct}%`, xp: 40, done: kcalOk },
    { id: 'prot', ic: '🥩', t: 'Белковый щит', d: `${Math.round(st.prot)} / ${t.protein} г белка`, xp: 30, done: st.prot >= t.protein },
    { id: 'move', ic: '🏋️', t: 'Тренировка дня', d: st.mins || st.steps ? `${st.mins} мин · ${fmt(st.steps)} шагов` : '20+ минут прогулки/фитнеса или 6000 шагов', xp: 30, done: st.mins >= 20 || st.steps >= 6000 },
    { id: 'sleep', ic: '😴', t: 'Выспись', d: d.sl.length ? `Сон ${fmtH(sleepH(d.sl[0]))} · нужно 7–10 ч` : 'Запиши сон: 7–10 часов', xp: 25, done: d.sl.length > 0 && sleepH(d.sl[0]) >= 7 && sleepH(d.sl[0]) <= 10 },
    { id: 'log', ic: '📒', t: 'Летописец', d: `Записано приёмов пищи: ${Math.min(d.food.length, 3)} / 3`, xp: 15, done: d.food.length >= 3 },
    { id: 'gold', ic: '💰', t: 'Казначей', d: d.tx.length ? `Записей в казне: ${d.tx.length}` : 'Запиши трату или сверь баланс', xp: 20, done: d.tx.length > 0 },
  ];
}

/* ---------- расчёты: деньги ---------- */
function balances() {
  const m = {};
  S.accounts.forEach((a) => (m[a.id] = +a.start || 0));
  S.tx.forEach((t) => {
    if (t.hist) return; // операции до начала учёта — только для хронологии
    if (t.type === 'exp') { if (t.acc in m) m[t.acc] -= t.amount; }
    else if (t.type === 'inc') { if (t.acc in m) m[t.acc] += t.amount; }
    else { if (t.acc in m) m[t.acc] -= t.amount; if (t.to in m) m[t.to] += t.amount; }
  });
  return m;
}
const accById = (id) => S.accounts.find((a) => a.id === id);
const accSince = (a) => (a && a.since) || S.created || 0;
function catOf(type, id) {
  const list = type === 'inc' ? INC_CATS : EXP_CATS;
  const c = list.find((x) => x[0] === id);
  return c ? { id: c[0], ic: c[1], n: c[2] } : { id, ic: '📦', n: 'Другое' };
}
const isUnsorted = (t) => t.cat === 'unknown' || t.cat === 'unknown_in';

/* ---------- игра ---------- */
function levelFromXp(xp) {
  let L = 1, acc = 0, need = 100;
  while (xp >= acc + need) { acc += need; L++; need = 100 + 50 * (L - 1); }
  return { L, cur: xp - acc, need };
}
function rankOf(L) { let r = RANKS[0]; for (const x of RANKS) if (L >= x[0]) r = x; return { n: r[1], ic: r[2] }; }
const emptyDay = () => ({ food: [], act: [], tx: [], w: [], sl: [] });
function buckets() {
  const b = {};
  const get = (k) => b[k] || (b[k] = emptyDay());
  S.food.forEach((e) => get(dayKey(e.t)).food.push(e));
  S.act.forEach((e) => get(dayKey(e.t)).act.push(e));
  S.tx.forEach((e) => { if (!e.hist) get(dayKey(e.t)).tx.push(e); });
  S.weights.forEach((e) => get(dayKey(e.t)).w.push(e));
  S.sleep.forEach((e) => get(dayKey(e.wake)).sl.push(e));
  return b;
}
function weightProgress() {
  const p = S.profile; const ws = [...S.weights].sort((a, b) => a.t - b.t);
  const start = p.startWeight || (ws[0] ? ws[0].kg : p.weight);
  const cur = ws.length ? ws[ws.length - 1].kg : p.weight;
  const delta = round1(cur - start);
  return { start, cur, delta, gain: p.goal === 'lose' ? -delta : delta };
}
const ACH = [
  ['first', '🌱', 'Первый шаг', (g) => g.entries >= 1],
  ['streak3', '🔥', '3 дня подряд', (g) => g.best >= 3],
  ['streak7', '⚡', '7 дней подряд', (g) => g.best >= 7],
  ['streak30', '🌟', '30 дней подряд', (g) => g.best >= 30],
  ['feed7', '🍖', '7 дней в норме', (g) => g.kcalDays >= 7],
  ['prot7', '🥩', '7 дней белка', (g) => g.protDays >= 7],
  ['gym10', '🏋️', '10 тренировок', (g) => g.workouts >= 10],
  ['perfect', '✨', 'Идеальный день', (g) => g.perfect >= 1],
  ['kg1', '⚖️', (g) => (S.profile.goal === 'lose' ? '−1 кг' : '+1 кг массы'), (g) => S.profile.goal !== 'keep' && g.wp.gain >= 1],
  ['kg3', '🦾', (g) => (S.profile.goal === 'lose' ? '−3 кг' : '+3 кг массы'), (g) => S.profile.goal !== 'keep' && g.wp.gain >= 3],
  ['rec', '🧮', 'Первая сверка', (g) => g.recs >= 1],
  ['sleep7', '🌙', '7 ночей 7+ часов', (g) => g.goodSleep >= 7],
  ['lvl5', '🎖️', 'Уровень 5', (g) => g.L >= 5],
  ['lvl10', '🏅', 'Уровень 10', (g) => g.L >= 10],
  ['perfect7', '👑', '7 идеальных дней', (g) => g.perfect >= 7],
  ['rich', '💎', 'Казна 100 000', (g) => g.total >= 100000],
];
const achName = (a, g) => (typeof a[2] === 'function' ? a[2](g) : a[2]);

function game() {
  const b = buckets();
  const keys = Object.keys(b).sort();
  let xp = 0, perfect = 0, kcalDays = 0, protDays = 0;
  const todayK = dayKey();
  for (const k of keys) {
    const d = b[k];
    xp += 0;
    xp += Math.min(d.food.length, 8) * 5 + Math.min(d.tx.length, 10) * 4 + Math.min(d.act.length, 3) * 10 + (d.w.length ? 10 : 0) + (d.sl.length ? 5 : 0);
    const q = questsOf(d);
    let all = true;
    q.forEach((x) => { if (x.done) xp += x.xp; else all = false; });
    if (all) { xp += 25; perfect++; }
    if (q[0].done) kcalDays++;
    if (q[1].done) protDays++;
  }
  xp += sum(S.coach || [], (c) => (c.goals || []).filter((x) => x.done).length * 30);
  // серия
  let streak = 0; const t = new Date(); t.setHours(12, 0, 0, 0);
  if (!b[dayKey(t)]) t.setDate(t.getDate() - 1);
  while (b[dayKey(t)]) { streak++; t.setDate(t.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const dt = new Date(k + 'T12:00:00');
    run = prev && Math.round((dt - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = dt;
  }
  const bal = balances();
  const total = sum(Object.values(bal), (x) => x);
  const g = {
    xp, ...levelFromXp(xp), streak, best, perfect, kcalDays, protDays,
    entries: S.food.length + S.tx.length + S.act.length + S.weights.length + S.sleep.length,
    goodSleep: S.sleep.filter((x) => sleepH(x) >= 7 && sleepH(x) <= 10).length,
    workouts: S.act.filter((a) => !a.steps && a.min >= 15).length,
    txCount: S.tx.length, recs: S.tx.filter((x) => x.rec).length,
    wp: weightProgress(), bal, total,
    today: b[todayK] || emptyDay(),
  };
  g.ach = ACH.filter((a) => a[3](g)).map((a) => a[0]);
  return g;
}

/* ---------- действия с XP ---------- */
function act(mutate, msg, undo) {
  const before = game();
  mutate();
  save();
  const after = game();
  const dx = after.xp - before.xp;
  render();
  if (UI.sheetFn) refreshSheet();
  if (msg) toast(msg + (dx > 0 ? ` <span class="xp-pop">+${dx} XP</span>` : ''), undo);
  progress(after);
}
function progress(g) {
  if (g.L > S.lastLevel) { S.lastLevel = g.L; save(); levelUp(g); }
  else if (g.L < S.lastLevel) { S.lastLevel = g.L; save(); }
  const fresh = g.ach.filter((id) => !S.seenAch.includes(id));
  if (fresh.length) {
    S.seenAch.push(...fresh); save();
    const a = ACH.find((x) => x[0] === fresh[0]);
    setTimeout(() => toast(`🏆 Достижение: ${a[1]} ${esc(achName(a, g))}`), 1600);
  }
}
function levelUp(g) {
  const r = rankOf(g.L);
  const el = document.createElement('div');
  el.className = 'levelup';
  el.innerHTML = `<div class="box"><div class="big">${r.ic}</div><h2>Уровень ${g.L}!</h2><div class="muted">Ранг: <b class="gold">${r.n}</b></div><p class="dim" style="margin-top:24px">Нажми, чтобы продолжить</p></div>`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

/* ---------- toast ---------- */
let toastTimer, toastUndo;
function toast(html, undo) {
  const t = $('#toast');
  toastUndo = undo || null;
  t.innerHTML = `<span>${html}</span>${undo ? '<button data-a="undo">Отменить</button>' : ''}`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 4500 : 3000);
}

/* ---------- подтверждение и защита от двойных нажатий ---------- */
function ask(html, yes = 'Да', no = 'Нет') {
  return new Promise((res) => {
    const el = document.createElement('div'); el.className = 'askbox';
    el.innerHTML = `<div class="askcard"><div class="asktext">${html}</div><div class="row"><button class="btn ghost" data-r="0">${no}</button><button class="btn gold" data-r="1">${yes}</button></div></div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b && e.target !== el) return;
      el.remove(); res(!!(b && b.dataset.r === '1'));
    });
    document.body.appendChild(el);
  });
}
let lastAddAt = 0;
function tooFast() {
  const now = Date.now();
  if (now - lastAddAt < 1000) { toast('⏳ Секунду…'); return true; }
  lastAddAt = now; return false;
}

/* ---------- sheet ---------- */
function openSheet(fn) {
  UI.sheetFn = fn;
  const sh = $('#sheet'), bd = $('#backdrop');
  sh.innerHTML = fn();
  sh.scrollTop = 0;
  bd.classList.remove('hidden'); sh.classList.remove('hidden');
  requestAnimationFrame(() => { bd.classList.add('show'); sh.classList.add('show'); });
}
function refreshSheet() {
  if (!UI.sheetFn) return;
  const sh = $('#sheet'); const st = sh.scrollTop;
  sh.innerHTML = UI.sheetFn(); sh.scrollTop = st;
}
function closeSheet() {
  UI.sheetFn = null; UI.linkTx = null; UI.allCats = false;
  const sh = $('#sheet'), bd = $('#backdrop');
  sh.classList.remove('show'); bd.classList.remove('show');
  setTimeout(() => { if (!UI.sheetFn) { sh.classList.add('hidden'); bd.classList.add('hidden'); sh.innerHTML = ''; } }, 260);
}
const sheetHead = (title) => `<div class="grabber"></div><h3>${title}<button class="x" data-a="close">✕</button></h3>`;

/* ================= РЕНДЕР ================= */
function render() {
  const v = $('#view');
  const tabbar = $('.tabbar');
  if (!S.profile) { tabbar.classList.add('hidden'); v.innerHTML = renderOnboarding(); return; }
  tabbar.classList.remove('hidden');
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.v === UI.tab));
  v.innerHTML = { hero: renderHero, body: renderBody, money: renderMoney, me: renderMe }[UI.tab]();
}

function ring(val, max, size = 112, stroke = 11, color = 'url(#rg)') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = clamp(max ? val / max : 0, 0, 1);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0b43c"/><stop offset="1" stop-color="#ffdf8a"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#0b0e1d" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" style="transition:stroke-dashoffset .6s"/></svg>`;
}
const bar = (val, max, cls = '') => `<div class="bar thin ${cls}"><i style="width:${clamp(max ? (val / max) * 100 : 0, 0, 100)}%"></i></div>`;

function todayCard(d) {
  const t = targets(), st = dayStats(d);
  const need = t.kcal + Math.round(st.actK);
  const spent = t.base + st.actK;
  const balance = st.eaten - spent;
  const goal = S.profile.goal;
  const balCls = goal === 'bulk' ? (balance >= 0 ? 'green' : 'red') : goal === 'lose' ? (balance <= 0 ? 'green' : 'red') : '';
  return `<div class="card today">
    <div class="ring">${ring(st.eaten, need)}<div class="c"><b class="num">${fmt(st.eaten)}</b><span>из ${fmt(need)} ккал</span></div></div>
    <div class="grow">
      <div class="mini"><div class="row"><span>🥩 Белок</span><b class="num">${Math.round(st.prot)} / ${t.protein} г</b></div>${bar(st.prot, t.protein, 'red')}
        <div class="macros"><span>Жиры <b class="num">${Math.round(st.fat)}</b>/${t.fat}</span><span>Углеводы <b class="num">${Math.round(st.carb)}</b>/${t.carbs}</span></div></div>
      <div class="mini"><div class="row"><span>🔥 Потрачено</span><b class="num">${fmt(spent)} ккал</b></div>${bar(st.actK, 600, 'blue')}<div class="dim" style="margin-top:3px">организм ${fmt(t.base)} + спорт ${fmt(st.actK)}</div></div>
      <div class="mini" style="margin:0"><div class="row"><span>⚖️ Баланс</span><b class="num ${balCls}">${balance > 0 ? '+' : ''}${fmt(balance)} ккал</b></div></div>
    </div>
  </div>`;
}

/* ---------- Сон ---------- */
const minsOfDay = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const sleepH = (s) => (s.wake - s.bed) / 36e5;
const fmtH = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} ч ${pad(m % 60)} м`; };
function median(arr) { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; }
function sleepGuess(off = 0) {
  const recent = S.sleep.slice(-14);
  const bedRel = median(recent.map((s) => (minsOfDay(s.bed) + 720) % 1440)) ?? (23 * 60 + 30 + 720) % 1440;
  const wakeM = median(recent.map((s) => minsOfDay(s.wake))) ?? 7 * 60 + 30;
  const now = new Date();
  let wake = new Date(Date.now() + off * DAY);
  if (off === 0 && now.getHours() >= 4 && now.getHours() < 12) { wake.setSeconds(0, 0); wake.setMinutes(Math.floor(wake.getMinutes() / 5) * 5); }
  else wake.setHours(0, wakeM, 0, 0);
  wake = wake.getTime();
  const noon = new Date(wake); noon.setHours(12, 0, 0, 0);
  if (noon.getTime() > wake) noon.setDate(noon.getDate() - 1);
  let bed = noon.getTime() + bedRel * 60000;
  // если вчера вечером последним действием был UpBek — берём это время
  const lh = S.lastHidden;
  if (off === 0 && lh && wake - lh >= 3 * 36e5 && wake - lh <= 14 * 36e5 && lh > noon.getTime()) bed = Math.round(lh / 300000) * 300000;
  if (bed > wake - 3 * 36e5) bed = wake - 8 * 36e5;
  return { bed, wake };
}
function sleepOf(key) { return S.sleep.find((s) => dayKey(s.wake) === key) || null; }
function energyOf(s) { return s ? Math.round(clamp(sleepH(s) / 8, 0, 1) * 100) : null; }

/* ---------- напоминалки: сон утром, сверка утром/вечером ---------- */
function recDue() {
  const h = new Date().getHours();
  const evening = h >= 20 || h < 2, morning = h >= 8 && h < 12;
  if (!evening && !morning) return null;
  const last = Math.max(0, ...S.tx.filter((t) => t.rec).map((t) => t.t));
  if (Date.now() - last < 6 * 36e5) return null;
  if (S.recSkip && Date.now() - S.recSkip < 6 * 36e5) return null;
  return evening ? 'Вечерняя' : 'Утренняя';
}
function promptCards() {
  let out = '';
  const h = new Date().getHours();
  if (h >= 4 && h < 15 && !sleepOf(dayKey()) && S.sleepSkip !== dayKey()) {
    const s = sleepGuess(0);
    out += `<div class="card prompt">
      <div class="row"><span style="font-size:30px">☀️</span><div class="grow"><b>Доброе утро! Так спал?</b><div class="dim">😴 ${hhmm(s.bed)} → ${hhmm(s.wake)} · ${fmtH(sleepH(s))}</div></div><button class="x" data-a="slSkip">✕</button></div>
      <div class="row" style="margin-top:10px"><button class="btn gold" data-a="slQuick">✓ Да</button><button class="btn ghost" data-a="foodSheet" data-v="sleep">Поправить</button></div></div>`;
  }
  const rd = recDue();
  if (rd && S.accounts.length) {
    out += `<div class="card prompt">
      <div class="row"><span style="font-size:30px">🧮</span><div class="grow"><b>${rd} сверка</b><div class="dim">Открой банк и впиши балансы — 20 секунд. Всё, что забыл записать, посчитается само.</div></div><button class="x" data-a="recSkip">✕</button></div>
      <button class="btn gold" style="margin-top:10px" data-a="rec">Сверить балансы</button></div>`;
  }
  return out;
}

/* ---------- Герой ---------- */
function attr(ic, name, pct, cls, sub) {
  return `<div class="attr"><span class="ai">${ic}</span><div class="grow"><div class="row between"><b>${name}</b><span class="dim">${sub}</span></div><div class="bar ${cls}"><i style="width:${clamp(pct || 0, 0, 100)}%"></i></div></div><b class="ap num">${pct == null ? '—' : pct + '%'}</b></div>`;
}
function renderHero() {
  const g = game(), p = S.profile, r = rankOf(g.L);
  const st = dayStats(g.today), t = targets();
  const need = t.kcal + Math.round(st.actK);
  const hp = need ? Math.round((st.eaten / need) * 100) : 0;
  const weekAgo = Date.now() - 7 * DAY;
  const weekMins = sum(S.act.filter((a) => a.t > weekAgo && !a.steps), (a) => a.min);
  const form = Math.round((weekMins / 150) * 100);
  const sl = sleepOf(dayKey()); const sh = sl ? sleepH(sl) : null;
  const status = sh == null ? null : sh >= 7 ? ['⚡', 'Бодрость', 'buff'] : sh < 6 ? ['😴', 'Не выспался', 'debuff'] : ['🙂', 'Норм', ''];
  const q = questsOf(g.today);
  const qDone = q.filter((x) => x.done).length;
  const unsorted = S.tx.filter(isUnsorted).length;
  const achs = ACH.filter((a) => g.ach.includes(a[0]));
  const mainAcc = accById(S.main) || S.accounts[0];
  return `
  <div class="char">
    <div class="hero">
      <div class="avatar">${r.ic}<span class="lvl-badge">${g.L}</span>${status && status[2] === 'debuff' ? '<span class="zz">💤</span>' : ''}</div>
      <div class="grow">
        <div class="hero-name">${esc(p.name || 'Герой')}</div>
        <div class="hero-rank">${r.n} · ${GOALS[p.goal].n}</div>
        <div class="bar gold" style="margin-top:8px"><i style="width:${(g.cur / g.need) * 100}%"></i></div>
        <div class="xp-text"><span>${g.cur} / ${g.need} XP</span><span>до ур. ${g.L + 1}</span></div>
      </div>
    </div>
    <div class="attrs">
      ${attr('❤️', 'Сытость', hp, 'red', `${fmt(st.eaten)} / ${fmt(need)} ккал`)}
      ${attr('⚡', 'Энергия', energyOf(sl), 'blue', sh == null ? 'запиши сон' : 'сон ' + fmtH(sh))}
      ${attr('💪', 'Форма', form, 'green', `${weekMins} / 150 мин за 7 дней`)}
    </div>
    <div class="char-foot">
      ${mainAcc ? `<button class="pill" data-a="tab" data-v="money"><i class="dot" style="background:${mainAcc.color}"></i> ${esc(mainAcc.name)}: <b class="num">${fmt(g.bal[mainAcc.id])} сом</b></button>` : ''}
      <span class="pill">🔥 ${g.streak} ${g.streak === 1 ? 'день' : 'дн.'} подряд</span>
      ${status ? `<span class="pill ${status[2]}">${status[0]} ${status[1]}</span>` : ''}
    </div>
  </div>

  ${promptCards()}
  ${typeof coachCard === 'function' ? coachCard() : ''}

  <div class="quick">
    <button class="qa" data-a="money" data-v="exp"><span class="ic">💰</span>Деньги</button>
    <button class="qa" data-a="foodSheet" data-v="food"><span class="ic">🍗</span>Еда</button>
    <button class="qa" data-a="sport"><span class="ic">🏃</span>Спорт</button>
    <button class="qa" data-a="foodSheet" data-v="sleep"><span class="ic">😴</span>Сон</button>
  </div>

  ${unsorted ? `<button class="alert" style="margin-top:12px" data-a="sortNext"><span style="font-size:22px">❓</span><span class="grow">Записей без категории: <b>${unsorted}</b><br><span class="dim">Нажми, чтобы разобрать</span></span><span>›</span></button>` : ''}

  <h2>Квесты дня <small>${qDone} / ${q.length}${qDone === q.length ? ' · +25 бонус ✨' : ''}</small></h2>
  <div class="card">
    ${q.map((x) => `<div class="quest ${x.done ? 'done' : ''}"><div class="qi">${x.ic}</div><div class="grow"><div class="qt">${x.t}</div><div class="qd">${x.d}</div></div><div class="xp">+${x.xp}</div></div>`).join('')}
  </div>

  <h2>Сегодня <small>потрачено ${som(sum(g.today.tx.filter((x) => x.type === 'exp'), (x) => x.amount))}</small></h2>
  ${todayCard(g.today)}

  <h2>Достижения <small>${achs.length} / ${ACH.length}</small></h2>
  ${achs.length ? `<div class="chips">${achs.map((a) => `<span class="chip on">${a[1]} ${esc(achName(a, g))}</span>`).join('')}</div>` : '<div class="dim">Сделай первую запись — и получишь первое достижение 🌱</div>'}
  <button class="btn ghost sm" style="margin-top:10px" data-a="tab" data-v="me">Все достижения ›</button>
  `;
}

/* ---------- Тело: еда, спорт, вес ---------- */
function viewDayKey() { return dayKey(Date.now() + UI.foodDay * DAY); }
function viewDayTime() { // время записи для выбранного дня
  if (UI.foodDay === 0) return Date.now();
  const d = new Date(Date.now() + UI.foodDay * DAY); return d.getTime();
}
function sortedFoods() {
  return allFoods().map((f, i) => ({ f, i, u: S.usage[f.id] || 0 })).sort((a, b) => b.u - a.u || a.i - b.i).map((x) => x.f);
}
function tileHtml(f) {
  return `<button class="tile" data-a="addFood" data-v="${f.id}"><span class="ic">${f.ic}</span><span class="tn">${esc(f.n)}</span><span class="tk">${fmt(f.k * (f.dq || 1))} ккал</span></button>`;
}
function tilesHtml(filter) {
  let list = sortedFoods();
  if (filter) {
    const q = norm(filter);
    const hit = list.filter((f) => hasWord(norm(f.n), q) || f.a.some((a) => a.startsWith(q) || q.startsWith(a)));
    if (hit.length) return hit.slice(0, 12).map(tileHtml).join('');
  }
  return list.slice(0, UI.allFoods ? 999 : 9).map(tileHtml).join('');
}
function renderBody() {
  const key = viewDayKey();
  const b = buckets(); const d = b[key] || emptyDay();
  const food = [...d.food].sort((a, c) => a.t - c.t);
  const acts = [...d.act].sort((a, c) => a.t - c.t);
  const wp = weightProgress();
  const isToday = UI.foodDay === 0;
  return `
  <h1>Тело</h1>
  <div class="daynav">
    <button data-a="day" data-v="-1">‹</button>
    <b>${dayLabel(key)}</b>
    <button data-a="day" data-v="1" ${isToday ? 'style="visibility:hidden"' : ''}>›</button>
  </div>
  ${todayCard(d)}
  <div class="quick">
    <button class="qa" data-a="foodSheet" data-v="food" data-keep="1"><span class="ic">🍗</span>Еда</button>
    <button class="qa" data-a="sport" data-keep="1"><span class="ic">🏃</span>Спорт</button>
    <button class="qa" data-a="foodSheet" data-v="sleep" data-keep="1"><span class="ic">😴</span>Сон</button>
    <button class="qa" data-a="foodSheet" data-v="weight" data-keep="1"><span class="ic">⚖️</span>Вес</button>
  </div>
  ${isToday ? '' : `<div class="hint" style="margin-top:8px">Записи добавятся на ${dayLabel(key).toLowerCase()}</div>`}

  <h2>Съедено <small>${fmt(sum(food, foodKcal))} ккал · ${Math.round(sum(food, foodProt))} г белка</small></h2>
  <div class="card list">
    ${food.length ? food.map((e) => `<button class="item" data-a="editFood" data-v="${e.id}"><span class="ii">${e.ic || '🍽️'}</span><span class="grow"><div class="it">${esc(e.name)}${e.qty !== 1 ? ` × ${round1(e.qty)}` : ''}</div><div class="is">${mealName(e.t)} · ${hhmm(e.t)} · Б ${Math.round(foodProt(e))} · Ж ${Math.round((e.f || 0) * e.qty)} · У ${Math.round((e.c || 0) * e.qty)}${e.ai ? ' · ✨' : ''}</div></span><span class="iv">${fmt(foodKcal(e))}</span></button>`).join('') : '<div class="empty">Пока пусто. Нажми «Еда» выше.</div>'}
  </div>

  <h2>Активность <small>${fmt(sum(acts, (a) => a.kcal))} ккал</small></h2>
  <div class="card list">
    ${acts.length ? acts.map((a) => { const A = actById(a.kind); return `<button class="item" data-a="editAct" data-v="${a.id}"><span class="ii">${A.ic}</span><span class="grow"><div class="it">${A.n}</div><div class="is">${hhmm(a.t)} · ${a.steps ? fmt(a.steps) + ' шагов' : a.min + ' мин'}</div></span><span class="iv">−${fmt(a.kcal)}</span></button>`; }).join('') : '<div class="empty">Прогулка, фитнес и шаги появятся здесь.</div>'}
  </div>

  <h2>Сон</h2>
  ${sleepCard(key)}

  <h2>Вес <small>${S.profile.goal !== 'keep' ? `с начала ${wp.delta > 0 ? '+' : ''}${wp.delta} кг` : ''}</small></h2>
  <div class="card">
    <div class="row between"><div><div class="dim">Сейчас</div><b style="font-size:24px">${round1(wp.cur)} кг</b></div><button class="btn sm" data-a="foodSheet" data-v="weight" data-keep="1">Записать вес</button></div>
    ${weightChart()}
    ${S.profile.goal === 'bulk' ? '<div class="note">Здоровый темп набора: +0,25–0,5 кг в неделю. Быстрее — обычно уходит в жир.</div>' : S.profile.goal === 'lose' ? '<div class="note">Комфортный темп: −0,3–0,7 кг в неделю.</div>' : ''}
  </div>`;
}
const actById = (id) => ACTS.find((x) => x.id === id) || { id, ic: '🏃', n: 'Активность', met: 5 };
function sleepCard(key) {
  const s = sleepOf(key);
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(dayKey(new Date(key + 'T12:00:00').getTime() - i * DAY));
  return `<div class="card">
    <div class="row between"><div><div class="dim">${key === dayKey() ? 'Прошлая ночь' : 'Ночь перед ' + dayLabel(key).toLowerCase()}</div><b style="font-size:24px">${s ? fmtH(sleepH(s)) : '—'}</b>${s ? `<div class="dim">${hhmm(s.bed)} → ${hhmm(s.wake)}</div>` : ''}</div>
    <button class="btn sm" data-a="foodSheet" data-v="sleep" data-keep="1">${s ? 'Изменить' : 'Записать'}</button></div>
    <div class="sleepbars">${days.map((k) => { const x = sleepOf(k); const h = x ? sleepH(x) : 0; const d = new Date(k + 'T12:00:00'); return `<div><i style="height:${clamp((h / 10) * 54, 2, 54)}px;${h && h < 6 ? 'background:linear-gradient(180deg,#ffb36b,#ff7a45)' : ''}${!h ? ';background:var(--line)' : ''}"></i>${h ? round1(h) : '·'}<br>${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()]}</div>`; }).join('')}</div>
    <div class="note">Мышцы растут во сне. 7–9 часов → ⚡ Энергия героя и +25 XP.</div>
  </div>`;
}

/* ---------- окна: ＋, еда, спорт ---------- */
function openHub() {
  openSheet(() => `${sheetHead('Что записать?')}
  <div class="hub3">
    <button class="big3" data-a="money" data-v="exp"><span class="ic">💰</span><span><b>Деньги</b><small>расход · доход · перевод</small></span></button>
    <button class="big3" data-a="foodSheet" data-v="food"><span class="ic">🍗</span><span><b>Еда</b><small>что съел · шаги · вес · сон</small></span></button>
    <button class="big3" data-a="sport"><span class="ic">🏃</span><span><b>Спорт</b><small>прогулка · фитнес</small></span></button>
  </div>`);
}
const FS_TABS = [['food', '🍽️ Еда'], ['steps', '👣 Шаги'], ['weight', '⚖️ Вес'], ['sleep', '😴 Сон']];
function initFoodSub(sub) {
  UI.fs = sub;
  if (sub === 'weight') UI.w = round1(weightProgress().cur);
  if (sub === 'sleep') { const ex = sleepOf(viewDayKey()); UI.sl = ex ? { ...ex } : sleepGuess(UI.foodDay); }
}
function openFoodSheet(sub = 'food', keepDay = false) {
  if (!keepDay) UI.foodDay = 0;
  initFoodSub(sub);
  openSheet(renderFoodSheet);
  if (sub === 'food') setTimeout(() => { const i = $('#foodText'); if (i && !matchMedia('(pointer:coarse)').matches) i.focus(); }, 300);
}
function renderFoodSheet() {
  const head = `<div class="grabber"></div><div class="row" style="margin-bottom:12px"><div class="seg grow">${FS_TABS.map(([k, l]) => `<button class="${UI.fs === k ? 'on' : ''}" data-a="fs" data-v="${k}">${l}</button>`).join('')}</div><button class="x" data-a="close">✕</button></div>`
    + (UI.foodDay ? `<div class="hint">Запишется на ${dayLabel(viewDayKey()).toLowerCase()}</div>` : '');
  if (UI.fs === 'steps') {
    return `${head}<p class="muted" style="margin-top:0">Сколько шагов за день? Цифра есть в приложении «Здоровье» на iPhone.</p>
    <div class="chips wrap">${[3000, 5000, 8000, 10000, 12000, 15000].map((o) => `<button class="chip big" data-a="stepsSave" data-v="${o}">${fmt(o)}</button>`).join('')}</div>
    <div class="row" style="margin-top:14px"><input id="stepsCustom" inputmode="numeric" placeholder="Своё число шагов"><button class="btn sm" style="padding:12px 16px" data-a="stepsSave" data-v="custom">OK</button></div>
    <div class="note">6000+ шагов закрывают квест «Тренировка дня».</div>`;
  }
  if (UI.fs === 'weight') {
    return `${head}
    <div class="stepper"><button data-a="wStep" data-v="-0.1">−</button><b class="num" id="wVal">${UI.w.toFixed(1)}</b><button data-a="wStep" data-v="0.1">＋</button></div>
    <div class="chips" style="justify-content:center;margin-bottom:14px"><button class="chip" data-a="wStep" data-v="-1">−1 кг</button><button class="chip" data-a="wStep" data-v="-0.5">−0,5</button><button class="chip" data-a="wStep" data-v="0.5">+0,5</button><button class="chip" data-a="wStep" data-v="1">+1 кг</button></div>
    <button class="btn gold" data-a="wSave">Сохранить · +10 XP</button>
    <div class="note">Взвешивайся утром натощак — так цифры честнее.</div>`;
  }
  if (UI.fs === 'sleep') {
    const s = UI.sl, h = sleepH(s);
    const tp = (k, label) => `<div class="tp"><button data-a="slAdj" data-v="${k}:-60">−1ч</button><button data-a="slAdj" data-v="${k}:-15">−15</button><div class="grow" style="text-align:center"><div class="dim">${label}</div><b class="num">${hhmm(s[k])}</b></div><button data-a="slAdj" data-v="${k}:15">+15</button><button data-a="slAdj" data-v="${k}:60">+1ч</button></div>`;
    return `${head}
    <div class="total" style="margin:2px 0 12px"><div class="tv">${fmtH(h)}</div><div class="tl">${h >= 7 && h <= 10 ? '⚡ Отличный сон — +25 XP' : h < 6 ? '😴 Маловато — герой устанет' : h > 10 ? '🛌 Многовато' : '🙂 Неплохо, но лучше 7+ ч'}</div></div>
    ${tp('bed', '😴 Уснул')}
    ${tp('wake', '☀️ Проснулся')}
    <button class="btn gold" style="margin-top:6px" data-a="slSave">Сохранить</button>
    ${s.id ? '<button class="btn danger" style="margin-top:8px" data-a="slDel">Удалить</button>' : ''}
    <div class="note">Время подставлено по твоим привычкам и по тому, когда ты вчера последний раз закрыл UpBek. Поправь кнопками, если не так.</div>`;
  }
  const lt = UI.linkTx && S.tx.find((t) => t.id === UI.linkTx);
  const linked = lt ? S.food.filter((f) => f.tx === lt.id) : [];
  const anyUsage = Object.values(S.usage).some((n) => n > 0);
  return `${head}
  ${lt ? `<div class="linkbar"><span style="font-size:24px">${catOf('exp', lt.cat).ic}</span><span class="grow"><b>${catOf('exp', lt.cat).n} · ${fmt(lt.amount)} сом</b><br><span class="dim">${linked.length ? `Отмечено: ${linked.length} · ${fmt(sum(linked, foodKcal))} ккал` : 'Что ты съел? Отметь только своё'}</span></span><button class="btn sm ${linked.length ? 'gold' : 'ghost'}" data-a="close">${linked.length ? 'Готово' : 'Пропустить'}</button></div>` : ''}
  <div class="airow"><button class="btn gold" data-a="aiPhoto">📷 Фото еды</button><button class="btn ghost" data-a="aiText">✨ Посчитать ИИ</button></div>
  <input id="foodText" placeholder="Напиши: 2 яйца, лепёшка, чай" autocomplete="off" enterkeyhint="done">
  <div id="foodParse" class="parse"></div>
  ${anyUsage ? '<div class="dim" style="margin:10px 0 -2px">⭐ Сначала — то, что ты ешь чаще</div>' : ''}
  <div id="foodTiles" class="tiles" style="margin-top:10px">${tilesHtml('')}</div>
  <div class="row" style="margin-top:8px">
    <button class="btn ghost sm" data-a="allFoods">${UI.allFoods ? 'Свернуть' : 'Все блюда (' + allFoods().length + ')'}</button>
    <button class="btn ghost sm" data-a="customFood">＋ Своё блюдо</button>
  </div>
  <div class="dim" style="margin:14px 0 7px">Лень считать? Нажми примерно:</div>
  <div class="approx">${APPROX.map((a) => `<button data-a="approx" data-v="${a.id}"><b>${a.k}</b><span>${a.n}</span></button>`).join('')}</div>`;
}
function openSport(keepDay = false) {
  if (!keepDay) UI.foodDay = 0;
  UI.sp = UI.sp || 'walk';
  openSheet(() => `<div class="grabber"></div>
  <div class="row" style="margin-bottom:12px"><div class="seg grow">${ACTS.filter((a) => !a.steps).map((a) => `<button class="${UI.sp === a.id ? 'on' : ''}" data-a="spKind" data-v="${a.id}">${a.ic} ${a.n}</button>`).join('')}</div><button class="x" data-a="close">✕</button></div>
  ${UI.foodDay ? `<div class="hint">Запишется на ${dayLabel(viewDayKey()).toLowerCase()}</div>` : ''}
  <p class="muted" style="margin-top:0">Сколько минут? Нажми — и готово.</p>
  <div class="chips wrap">${[10, 15, 20, 30, 45, 60, 90].map((o) => `<button class="chip big" data-a="spSave" data-v="${o}">${o} мин</button>`).join('')}</div>
  <div class="row" style="margin-top:14px"><input id="spCustom" inputmode="numeric" placeholder="Своё число минут"><button class="btn sm" style="padding:12px 16px" data-a="spSave" data-v="custom">OK</button></div>
  ${UI.sp === 'gym' ? '<div class="note">После перерыва: первые 2–3 недели — лёгкие веса и техника, нагрузку поднимай постепенно.</div>' : '<div class="note">20+ минут закрывают квест «Тренировка дня».</div>'}`);
}
function weightChart() {
  const ws = [...S.weights].sort((a, b) => a.t - b.t).slice(-30);
  if (ws.length < 2) return '<div class="dim" style="margin-top:8px">График появится после двух взвешиваний. Взвешивайся утром, раз в неделю.</div>';
  const W = 320, H = 110, P = 8;
  const min = Math.min(...ws.map((w) => w.kg)) - 0.5, max = Math.max(...ws.map((w) => w.kg)) + 0.5;
  const t0 = ws[0].t, t1 = ws[ws.length - 1].t || t0 + 1;
  const x = (t) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (kg) => H - P - ((kg - min) / (max - min)) * (H - 2 * P);
  const pts = ws.map((w) => `${x(w.t).toFixed(1)},${y(w.kg).toFixed(1)}`).join(' ');
  return `<div class="chart" style="margin-top:10px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="#f6c453" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${ws.map((w) => `<circle cx="${x(w.t)}" cy="${y(w.kg)}" r="3" fill="#f6c453"/>`).join('')}
  </svg><div class="row between dim"><span>${round1(ws[0].kg)} кг</span><span>${round1(ws[ws.length - 1].kg)} кг</span></div></div>`;
}

/* ---- распознавание текста еды (бесплатно, без интернета) ---- */
function findFood(s) {
  let best = null, bl = 0;
  for (const f of allFoods()) for (const a of f.a) if (a.length > bl && hasWord(s, a)) { best = f; bl = a.length; }
  return best;
}
function parseChunk(raw) {
  let s = ' ' + norm(raw).trim() + ' ';
  if (!s.trim()) return null;
  const kc = s.match(/(\d+)\s*(ккал|кал|kcal)/);
  if (kc) {
    const name = raw.replace(/(\d+)\s*(ккал|кал|kcal)/i, '').trim() || 'Еда';
    return { custom: true, name: name[0].toUpperCase() + name.slice(1), k: +kc[1], p: 0, qty: 1 };
  }
  let grams = null, qty = null;
  const gm = s.match(/(\d+(?:[.,]\d+)?)\s*(г|гр|грамм[а-я]*|g|мл|ml)(?![а-яa-z])/);
  if (gm) { grams = parseFloat(gm[1].replace(',', '.')); s = s.replace(gm[0], ' '); }
  const nm = s.match(/(\d+(?:[.,]\d+)?)/);
  if (nm) { qty = parseFloat(nm[1].replace(',', '.')); s = s.replace(nm[0], ' '); }
  else for (const w in NUM_WORDS) if (wholeWord(s, w)) { qty = NUM_WORDS[w]; break; }
  const f = findFood(s);
  if (!f) return { bad: raw.trim() };
  if (grams && f.g) qty = grams / f.g;
  return { f, qty: round1(qty || f.dq || 1) };
}
function parseFood(text) {
  return text.split(/[,;\n+]|\s+и\s+|\s+плюс\s+/i).map(parseChunk).filter(Boolean);
}
function updateFoodPreview() {
  const inp = $('#foodText'); if (!inp) return;
  const text = inp.value.trim();
  const box = $('#foodParse');
  const parts = text ? parseFood(text) : [];
  const ok = parts.filter((p) => !p.bad);
  if (!text) box.innerHTML = '';
  else {
    const total = sum(ok, (p) => (p.custom ? p.k : p.f.k * p.qty));
    box.innerHTML = parts.map((p) => p.bad
      ? `<div class="pi bad"><span>❔ «${esc(p.bad)}» — не знаю. Допиши «${esc(p.bad)} 300 ккал»</span></div>`
      : p.custom ? `<div class="pi"><span>🍽️ ${esc(p.name)}</span><b>${fmt(p.k)}</b></div>`
        : `<div class="pi"><span>${p.f.ic} ${esc(p.f.n)} × ${round1(p.qty)} <span class="dim">(${p.f.u})</span></span><b>${fmt(p.f.k * p.qty)}</b></div>`).join('')
      + (ok.length ? `<button class="btn gold" style="margin-top:10px" data-a="saveText">Записать · ${fmt(total)} ккал</button>` : '')
      + (parts.some((x) => x.bad) ? '<button class="btn ghost" style="margin-top:8px" data-a="aiText">✨ Не знаю блюдо — посчитать с ИИ</button>' : '');
  }
  const last = norm(text.split(/[,;\n+]/).pop()).replace(/[\d.,]+\s*(г|гр|мл|шт)?(?![а-я])/g, ' ').trim();
  $('#foodTiles').innerHTML = tilesHtml(last.length >= 2 ? last : '');
}
function foodEntry(f, qty) {
  const e = { id: uid(), t: viewDayTime(), fid: f.id, name: f.n, ic: f.ic, unit: f.u, qty, k: f.k, p: f.p, f: f.f || 0, c: f.c || 0 };
  if (UI.linkTx) e.tx = UI.linkTx;
  return e;
}

/* ---------- Казна ---------- */
function renderMoney() {
  const g = game(), bal = g.bal;
  const now = new Date();
  const ms = new Date(now.getFullYear(), now.getMonth() + (UI.mOff || 0), 1);
  const me = new Date(ms.getFullYear(), ms.getMonth() + 1, 1);
  const fAcc = UI.mAcc || null;
  const monthTx = S.tx.filter((t) => t.t >= ms.getTime() && t.t < me.getTime() && (!fAcc || t.acc === fAcc || t.to === fAcc));
  const inc = sum(monthTx.filter((t) => t.type === 'inc' && !t.rec), (t) => t.amount);
  const exp = sum(monthTx.filter((t) => t.type === 'exp'), (t) => t.amount);
  const byCat = {};
  monthTx.filter((t) => t.type === 'exp').forEach((t) => (byCat[t.cat] = (byCat[t.cat] || 0) + t.amount));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;
  const unsorted = S.tx.filter(isUnsorted).length;
  const accs = [...S.accounts].sort((a, b) => (b.id === S.main) - (a.id === S.main));
  const mName = `${MONTHS_N[ms.getMonth()]}${ms.getFullYear() !== now.getFullYear() ? ' ' + ms.getFullYear() : ''}`;

  const list = [...monthTx].sort((a, b) => b.t - a.t);
  const groups = [];
  list.forEach((t) => { const k = dayKey(t.t); let gr = groups[groups.length - 1]; if (!gr || gr.k !== k) groups.push((gr = { k, items: [] })); gr.items.push(t); });

  return `
  <h1>Казна</h1>
  <div class="card">
    <div class="total"><div class="tl">Всего золота сейчас</div><div class="tv num">${som(g.total)}</div></div>
  </div>
  <div class="accs">
    ${accs.map((a) => `<button class="acc" style="--c:${a.color}" data-a="acc" data-v="${a.id}">${a.id === S.main ? '<span class="star">★</span>' : ''}<div class="an">${esc(a.name)}</div><div class="av">${fmt(bal[a.id])}</div></button>`).join('')}
    <button class="acc" data-a="addAcc" style="--c:var(--line)"><div class="an">Новый счёт</div><div class="av muted">＋</div></button>
  </div>
  <div class="row3" style="margin-top:12px">
    <button class="btn ghost" data-a="rec">🧮 Сверка</button>
    <button class="btn ghost" data-a="money" data-v="tr">🔁 Перевод</button>
    <button class="btn ghost" data-a="stmt">📥 Выписка</button>
  </div>
  <div class="note">Забыл записывать? «📥 Выписка» — загрузи PDF или скриншоты из банка, ИИ сам разнесёт операции по дням. «🧮 Сверка» — впиши реальный баланс, разница запишется.</div>

  ${unsorted ? `<button class="alert" style="margin-top:14px" data-a="sortNext"><span style="font-size:22px">❓</span><span class="grow">Ждут категорию: <b>${unsorted}</b></span><span>Разобрать ›</span></button>` : ''}

  <h2>Хронология</h2>
  <div class="daynav">
    <button data-a="mMonth" data-v="-1">‹</button>
    <b>${mName}</b>
    <button data-a="mMonth" data-v="1" ${(UI.mOff || 0) >= 0 ? 'style="visibility:hidden"' : ''}>›</button>
  </div>
  <div class="chips" style="margin-bottom:10px"><button class="chip ${!fAcc ? 'on' : ''}" data-a="mFilter" data-v="">Все счета</button>${S.accounts.map((a) => `<button class="chip ${fAcc === a.id ? 'on' : ''}" data-a="mFilter" data-v="${a.id}"><i class="dot" style="background:${a.color}"></i>${esc(a.name)}</button>`).join('')}</div>
  <div class="card">
    <div class="split" style="margin-top:0">
      <div><span>Пришло</span><b class="green num">+${fmt(inc)}</b></div>
      <div><span>Ушло</span><b class="red num">−${fmt(exp)}</b></div>
    </div>
    ${cats.length ? `<div style="margin-top:14px">${cats.map(([id, v]) => { const c = catOf('exp', id); return `<div class="catbar"><div class="row"><span>${c.ic} ${c.n}</span><b class="num">${fmt(v)} · ${Math.round((v / (exp || 1)) * 100)}%</b></div>${bar(v, maxCat, 'gold')}</div>`; }).join('')}</div>` : ''}
  </div>
  ${groups.length ? groups.map((gr) => {
    const out = sum(gr.items.filter((t) => t.type === 'exp'), (t) => t.amount);
    return `<div class="day-head"><span>${dayLabel(gr.k)}</span><span>${out ? '−' + fmt(out) : ''}</span></div><div class="card list" style="margin-bottom:0">${gr.items.map(txRow).join('')}</div>`;
  }).join('') : '<div class="card empty">В этом месяце записей нет.<br>Жми ＋ внизу или загрузи выписку.</div>'}
  `;
}
function txRow(t) {
  const a = accById(t.acc);
  if (t.type === 'tr') {
    const b = accById(t.to);
    return `<button class="item" data-a="editTx" data-v="${t.id}"><span class="ii">🔁</span><span class="grow"><div class="it">Перевод</div><div class="is">${esc(a ? a.name : '—')} → ${esc(b ? b.name : '—')}${t.note ? ' · ' + esc(t.note) : ''}</div></span><span class="iv" style="color:var(--blue)">${fmt(t.amount)}</span></button>`;
  }
  const c = catOf(t.type, t.cat);
  const unsorted = isUnsorted(t);
  const lf = S.food.filter((f) => f.tx === t.id);
  const eat = (lf.length ? ` · 🍗 ${fmt(sum(lf, foodKcal))} ккал` : '') + (t.hist ? ' · 📜 до учёта' : t.imp ? ' · 📥' : '');
  return `<button class="item" data-a="editTx" data-v="${t.id}"><span class="ii">${c.ic}</span><span class="grow"><div class="it">${unsorted ? '<span class="badge">?</span> ' : ''}${esc(t.note || c.n)}</div><div class="is">${t.note ? c.n + ' · ' : ''}${esc(a ? a.name : '—')} · ${hhmm(t.t)}${eat}</div></span><span class="iv ${t.type === 'inc' ? 'green' : ''}">${t.type === 'inc' ? '+' : '−'}${fmt(t.amount)}</span></button>`;
}

/* ---- окно записи денег ---- */
function openMoney(opts = {}) {
  if (!S.accounts.length) { toast('Сначала добавь счёт'); return; }
  const ed = opts.id ? S.tx.find((t) => t.id === opts.id) : null;
  const main = S.main || S.accounts[0].id;
  if (ed) {
    const diff = Math.round((new Date(dayKey()).getTime() - new Date(dayKey(ed.t)).getTime()) / DAY);
    UI.money = { mode: ed.type, amount: String(ed.amount), acc: ed.acc, to: ed.to || null, cat: ed.cat, note: ed.note || '', day: diff === 0 ? 0 : diff === 1 ? 1 : null, editId: ed.id, t: ed.t };
  } else {
    UI.money = { mode: opts.mode || 'exp', amount: '0', acc: main, to: null, cat: null, note: '', day: 0 };
  }
  fixTransferTo();
  openSheet(renderMoneySheet);
}
function fixTransferTo() {
  const m = UI.money;
  if (m.mode === 'tr' && (!m.to || m.to === m.acc)) { const o = S.accounts.find((a) => a.id !== m.acc); m.to = o ? o.id : null; }
}
const accChips = (action, sel) => S.accounts.map((a) => `<button class="chip ${a.id === sel ? 'on' : ''}" data-a="${action}" data-v="${a.id}"><i class="dot" style="background:${a.color}"></i>${esc(a.name)}</button>`).join('');
function amountHtml() { const m = UI.money; return `${fmt(+m.amount)}<small>сом</small>`; }
function renderMoneySheet() {
  const m = UI.money, ed = !!m.editId;
  const cats = sortedCats(m.mode, m.cat);
  UI.freq = !ed && m.mode !== 'tr' ? frequentTx(m.mode) : [];
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];
  return `<div class="grabber"></div>
  <div class="row" style="margin-bottom:4px"><div class="seg grow">${[['exp', 'Расход'], ['inc', 'Доход'], ['tr', 'Перевод']].map(([k, l]) => `<button class="${k} ${m.mode === k ? 'on' : ''}" data-a="mMode" data-v="${k}">${l}</button>`).join('')}</div><button class="x" data-a="close">✕</button></div>
  <div id="mAmount" class="amount ${m.mode}">${amountHtml()}</div>
  <div class="chips">${accChips('mAcc', m.acc)}</div>
  ${m.mode === 'tr' ? `<div class="hint" style="margin-top:8px">↓ куда</div><div class="chips">${accChips('mTo', m.to)}</div>` : ''}
  ${UI.freq.length ? `<div class="chips" style="margin-top:8px"><span class="dim" style="align-self:center">⚡ Часто:</span>${UI.freq.map((f, i) => `<button class="chip" data-a="mFreq" data-v="${i}">${catOf(m.mode, f.cat).ic} ${fmt(f.amount)}</button>`).join('')}</div>` : ''}
  ${m.mode !== 'tr' ? `<div class="cats">${cats.map((c) => c === 'more' ? `<button class="cat more" data-a="mMore"><span class="ic">${UI.allCats ? '▴' : '⋯'}</span><span>${UI.allCats ? 'Свернуть' : 'Ещё'}</span></button>` : `<button class="cat ${m.cat === c[0] ? 'on' : ''}" data-a="mCat" data-v="${c[0]}"><span class="ic">${c[1]}</span><span>${c[2]}</span></button>`).join('')}</div>` : ''}
  <div class="row" style="margin-top:${m.mode === 'tr' ? 12 : 0}px">
    <div class="seg" style="flex:none"><button class="${m.day === 0 ? 'on' : ''}" data-a="mDay" data-v="0">Сегодня</button><button class="${m.day === 1 ? 'on' : ''}" data-a="mDay" data-v="1">Вчера</button></div>
    <input id="mNote" class="grow" placeholder="Заметка" value="${esc(m.note)}" autocomplete="off" style="padding:8px 10px">
  </div>
  <div class="keypad">${keys.map((k) => `<button class="key ${k === '⌫' || k === '000' ? 'fn' : ''}" data-a="mKey" data-v="${k}">${k}</button>`).join('')}</div>
  ${m.mode === 'tr' || ed
    ? `<button class="btn gold" style="margin-top:10px" data-a="mSave">${ed ? 'Сохранить' : 'Перевести'}</button>`
    : '<div class="hint" style="margin-top:10px">Набери сумму → нажми категорию. Всё ✨</div>'}
  ${ed ? '<button class="btn danger" style="margin-top:8px" data-a="mDel">Удалить запись</button>' : ''}`;
}
// категории: сначала самые частые за 120 дней
function catUsage(type) {
  const since = Date.now() - 120 * DAY, u = {};
  S.tx.forEach((t) => { if (t.type === type && t.t > since && !t.rec) u[t.cat] = (u[t.cat] || 0) + 1; });
  return u;
}
function sortedCats(mode, sel) {
  const base = mode === 'inc' ? INC_CATS : EXP_CATS;
  const u = catUsage(mode);
  const pinned = base.find((c) => c[0].startsWith('unknown'));
  const list = base.filter((c) => !c[3] && c !== pinned).map((c, i) => ({ c, i, n: u[c[0]] || 0 })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.c);
  const extra = base.find((c) => c[3] && c[0] === sel);
  if (list.length <= 11 || UI.allCats) return [...list, ...(extra ? [extra] : []), pinned, ...(list.length > 11 ? ['more'] : [])];
  const top = list.slice(0, 10);
  const selC = base.find((c) => c[0] === sel);
  if (selC && !top.includes(selC) && selC !== pinned) top[9] = selC;
  return [...top, pinned, 'more'];
}
// частые траты: одинаковые категория + сумма + счёт, 2+ раза за 90 дней
function frequentTx(type) {
  const since = Date.now() - 90 * DAY, m = {};
  S.tx.filter((t) => t.type === type && !t.rec && t.t > since && !isUnsorted(t)).forEach((t) => {
    const k = t.cat + '|' + t.amount + '|' + t.acc;
    (m[k] = m[k] || { cat: t.cat, amount: t.amount, acc: t.acc, n: 0, last: 0 }).n++;
    m[k].last = Math.max(m[k].last, t.t);
  });
  return Object.values(m).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 5);
}
const isEatCat = (type, cat) => type === 'exp' && !!(EXP_CATS.find((c) => c[0] === cat) || [])[4];

function moneyTime() {
  const m = UI.money;
  if (m.day === 0) return m.editId && dayKey(m.t) === dayKey() ? m.t : Date.now();
  if (m.day === 1) return m.editId && dayKey(m.t) === dayKey(Date.now() - DAY) ? m.t : Date.now() - DAY;
  return m.t;
}
async function saveMoney() {
  const m = UI.money;
  const amount = +m.amount;
  if (!amount) { const el = $('#mAmount'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); return; }
  if (m.mode === 'tr' && (!m.to || m.to === m.acc)) { toast('Выбери другой счёт, куда переводишь'); return; }
  if (m.mode !== 'tr' && !m.cat) { toast('Выбери категорию'); return; }
  const tx = { id: m.editId || uid(), t: moneyTime(), type: m.mode, amount, acc: m.acc, cat: m.mode === 'tr' ? null : m.cat, note: m.note.trim() };
  if (m.mode === 'tr') tx.to = m.to;
  const old = m.editId ? S.tx.find((t) => t.id === m.editId) : null;
  if (old && old.rec) tx.rec = true;
  if (old && old.imp) { tx.imp = true; if (old.hist) tx.hist = true; }
  if (!old) {
    if (tooFast()) return;
    const dup = S.tx.find((t) => !t.rec && t.type === tx.type && t.amount === tx.amount && t.cat === tx.cat && t.acc === tx.acc && Math.abs(t.t - tx.t) < 5 * 60000);
    if (dup && !(await ask(`Такая же запись уже есть: <b>${tx.type === 'inc' ? '+' : '−'}${fmt(tx.amount)} · ${tx.type === 'tr' ? 'перевод' : catOf(tx.type, tx.cat).n}</b> в ${hhmm(dup.t)}.<br>Записать ещё раз?`, 'Да, ещё раз', 'Нет'))) return;
  }
  closeSheet();
  if (old) {
    act(() => { S.tx = S.tx.map((t) => (t.id === old.id ? tx : t)); }, 'Сохранено ✓');
  } else {
    const a = accById(tx.acc);
    const label = tx.type === 'tr' ? `🔁 ${fmt(amount)} → ${esc(accById(tx.to).name)}` : `${tx.type === 'inc' ? '+' : '−'}${fmt(amount)} · ${catOf(tx.type, tx.cat).ic} ${catOf(tx.type, tx.cat).n} · ${esc(a.name)}`;
    act(() => S.tx.push(tx), label, () => act(() => { S.tx = S.tx.filter((t) => t.id !== tx.id); S.food = S.food.filter((f) => f.tx !== tx.id); }, 'Отменено'));
    if (isEatCat(tx.type, tx.cat) && dayKey(tx.t) === dayKey()) {
      setTimeout(() => { openFoodSheet('food'); UI.linkTx = tx.id; refreshSheet(); }, 280);
    }
  }
}

/* ---- сверка баланса ---- */
function openRec() {
  const bal = balances();
  openSheet(() => `${sheetHead('🧮 Сверка баланса')}
  <p class="muted" style="margin-top:0;font-size:14px">Открой приложение банка и впиши, сколько там <b>реально</b>. Разница запишется как «Неучтённое». Пустые поля не трогаем.</p>
  ${S.accounts.map((a) => `<div class="bankrow"><span class="bn"><i class="dot" style="background:${a.color}"></i><span><div>${esc(a.name)}</div><div class="dim">в UpBek: ${fmt(bal[a.id])}</div></span></span><input data-rec="${a.id}" inputmode="numeric" placeholder="${fmt(bal[a.id])}"></div>`).join('')}
  <button class="btn gold" style="margin-top:8px" data-a="recSave">Сверить</button>`);
}
function saveRec() {
  const bal = balances(); const add = [];
  $$('[data-rec]').forEach((i) => {
    const raw = i.value.replace(/[^\d.,-]/g, '').replace(',', '.');
    if (raw === '') return;
    const real = Math.round(parseFloat(raw)); if (isNaN(real)) return;
    const id = i.dataset.rec; const diff = real - bal[id];
    if (Math.abs(diff) < 1) { add.push({ id: uid(), t: Date.now(), type: 'inc', amount: 0, acc: id, cat: 'found', note: 'Сверка: всё сходится', rec: true, zero: true }); return; }
    add.push({ id: uid(), t: Date.now(), type: diff < 0 ? 'exp' : 'inc', amount: Math.abs(diff), acc: id, cat: diff < 0 ? 'lost' : 'found', note: diff < 0 ? 'Сверка: неучтённые траты' : 'Сверка: неучтённый доход', rec: true });
  });
  if (!add.length) { toast('Впиши хотя бы один баланс'); return; }
  closeSheet();
  const real = add.filter((x) => !x.zero);
  act(() => S.tx.push(...add), real.length ? `Сверено. Разница: ${real.map((x) => (x.type === 'exp' ? '−' : '+') + fmt(x.amount)).join(', ')}` : 'Всё сходится! 👌');
}

/* ---- счета ---- */
function openAcc(id) {
  const a = accById(id); const bal = balances();
  const used = S.tx.some((t) => t.acc === id || t.to === id);
  openSheet(() => `${sheetHead(`<span><i class="dot" style="background:${a.color}"></i> ${esc(a.name)}</span>`)}
  <div class="total" style="margin-bottom:14px"><div class="tl">Баланс</div><div class="tv num">${som(bal[id])}</div></div>
  <div class="field"><label>Название</label><input id="accName" value="${esc(a.name)}"></div>
  <div class="field"><label>Начальный баланс (с которого начал учёт)</label><input id="accStart" inputmode="numeric" value="${a.start || 0}"></div>
  ${S.main !== id ? '<button class="btn ghost" style="margin-bottom:8px" data-a="accMain" data-v="' + id + '">★ Сделать основным</button>' : '<div class="note" style="margin-bottom:8px">★ Основной счёт — выбирается при записи автоматически</div>'}
  <button class="btn" data-a="accSave" data-v="${id}">Сохранить</button>
  ${!used && S.accounts.length > 1 ? `<button class="btn danger" style="margin-top:8px" data-a="accDel" data-v="${id}">Удалить счёт</button>` : ''}`);
}
function openAddAcc() {
  UI.newAcc = UI.newAcc || 'mbank';
  openSheet(() => `${sheetHead('Новый счёт')}
  <div class="chips wrap" style="margin-bottom:12px">${BANKS.map((b) => `<button class="chip ${UI.newAcc === b.id ? 'on' : ''}" data-a="newAccBank" data-v="${b.id}"><i class="dot" style="background:${b.color}"></i>${b.name}</button>`).join('')}</div>
  <div class="field"><label>Название</label><input id="naName" value="${esc(BANKS.find((b) => b.id === UI.newAcc).name)}"></div>
  <div class="field"><label>Сколько сейчас на счёте</label><input id="naBal" inputmode="numeric" placeholder="0"></div>
  <button class="btn gold" data-a="addAccSave">Добавить</button>`);
}

/* ---- еда: правка, своё блюдо ---- */
function openEditFood(id) {
  const e = S.food.find((x) => x.id === id); if (!e) return;
  openSheet(() => `${sheetHead(`${e.ic || '🍽️'} ${esc(e.name)}`)}
  <div class="dim" style="text-align:center">${fmt(e.k)} ккал · Б ${round1(e.p)} · Ж ${round1(e.f || 0)} · У ${round1(e.c || 0)} — за ${esc(e.unit || 'порцию')}</div>
  <div class="stepper"><button data-a="fqty" data-v="-0.5">−</button><b class="num">${round1(e.qty)}</b><button data-a="fqty" data-v="0.5">＋</button></div>
  <div class="total" style="margin-bottom:14px"><div class="tv num" style="font-size:28px">${fmt(foodKcal(e))} ккал</div><div class="tl">Б ${Math.round(foodProt(e))} г · Ж ${Math.round((e.f || 0) * e.qty)} г · У ${Math.round((e.c || 0) * e.qty)} г</div></div>
  <button class="btn" data-a="close">Готово</button>
  <button class="btn danger" style="margin-top:8px" data-a="fdel">Удалить</button>`);
  UI.editFood = id;
}
function openCustomFood() {
  openSheet(() => `${sheetHead('⭐ Своё блюдо')}
  <p class="muted" style="margin-top:0;font-size:14px">Сохранится в плитки — дальше добавляешь в 1 касание. Калории можно посмотреть на упаковке или прикинуть.</p>
  <div class="field"><label>Название</label><input id="cfName" placeholder="Напр.: Мамин плов"></div>
  <div class="grid2">
    <div class="field"><label>Ккал за порцию</label><input id="cfK" inputmode="numeric" placeholder="500"></div>
    <div class="field"><label>Белок, г</label><input id="cfP" inputmode="decimal" placeholder="20"></div>
  </div>
  <button class="btn gold" data-a="cfSave">Сохранить и записать</button>
  ${S.customFoods.length ? `<h2>Мои блюда</h2><div class="card list">${S.customFoods.map((f) => `<div class="item"><span class="ii">⭐</span><span class="grow"><div class="it">${esc(f.n)}</div><div class="is">${f.k} ккал · ${f.p} г белка</div></span><button class="btn danger sm" data-a="cfDel" data-v="${f.id}">✕</button></div>`).join('')}</div>` : ''}`);
}

/* ---- активность ---- */
function actKcal(A, val) {
  const kg = weightProgress().cur;
  return A.steps ? Math.round(val * 0.04 * (kg / 70)) : Math.round((A.met * kg * val) / 60);
}

function saveSleep(s) {
  const h = sleepH(s); const key = dayKey(s.wake);
  act(() => { S.sleep = S.sleep.filter((x) => x.id !== s.id && dayKey(x.wake) !== key); S.sleep.push({ id: s.id || uid(), bed: s.bed, wake: s.wake }); },
    `😴 Сон ${fmtH(h)} записан${h >= 7 && h <= 10 ? ' · ⚡ бодрость' : ''}`);
}

/* ---------- Ещё: профиль, счета, данные ---------- */
function renderMe() {
  const g = game(), p = S.profile, t = targets(), bal = g.bal;
  return `
  <h1>Ещё</h1>
  <div class="card">
    <div class="row between"><div class="row"><div class="avatar" style="width:52px;height:52px;font-size:28px;border-radius:16px">${rankOf(g.L).ic}</div><div><b style="font-size:17px">${esc(p.name)}</b><div class="dim">${p.age} лет · ${p.height} см · ${round1(weightProgress().cur)} кг</div></div></div>
    <button class="btn ghost sm" data-a="profile">Изменить</button></div>
    <div class="split">
      <div><span>Норма калорий</span><b class="num">${fmt(t.kcal)} ккал</b></div>
      <div><span>Норма белка</span><b class="num">${t.protein} г</b></div>
    </div>
    <div class="dim" style="margin-top:8px">Цель: ${GOALS[p.goal].n}. Обмен веществ ${fmt(t.bmr)} ккал, с образом жизни ${fmt(t.base)}. Спорт добавляется к норме автоматически.</div>
  </div>

  <h2>Достижения <small>${g.ach.length} / ${ACH.length}</small></h2>
  <div class="achs">${ACH.map((a) => `<div class="ach ${g.ach.includes(a[0]) ? '' : 'lock'}"><span class="ic">${a[1]}</span><span>${esc(achName(a, g))}</span></div>`).join('')}</div>

  <h2>Счета</h2>
  <div class="card list">
    ${S.accounts.map((a) => `<button class="item" data-a="acc" data-v="${a.id}"><span class="ii"><i class="dot" style="background:${a.color};width:12px;height:12px"></i></span><span class="grow"><div class="it">${esc(a.name)} ${a.id === S.main ? '<span class="gold">★</span>' : ''}</div></span><span class="iv">${fmt(bal[a.id])}</span></button>`).join('')}
    <button class="item" data-a="addAcc"><span class="ii">＋</span><span class="grow it">Добавить счёт</span></button>
  </div>

  <h2>🎨 Тема</h2>
  <div class="themes">${THEMES.map((t) => `<button class="opt theme-opt ${(document.documentElement.dataset.theme || 'classic') === t.id ? 'on' : ''}" data-a="theme" data-v="${t.id}"><span class="sw">${t.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span><b>${t.n}</b><span>${t.d}</span></button>`).join('')}</div>

  ${typeof aiSection === 'function' ? aiSection() : ''}

  ${typeof cloudSection === 'function' ? cloudSection() : ''}

  <h2>Данные</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-a="export">📤 Резервная копия</button><button class="btn ghost" data-a="import">📥 Загрузить</button></div>
    <div class="note">Раз в неделю сохраняй копию (в «Файлы» или Telegram «Избранное»): если удалить иконку или почистить Safari, данные пропадут.</div>
    <button class="btn ghost" style="margin-top:10px" data-a="appUpdate">🔄 Обновить приложение</button>
    <button class="btn danger" style="margin-top:10px" data-a="clearRecords">🧹 Очистить записи (профиль и счета останутся)</button>
    <button class="btn danger" style="margin-top:8px" data-a="reset">Стереть всё и начать заново</button>
  </div>
  <p class="dim" style="text-align:center;margin-top:20px">UpBek v2.3 · ${S.food.length + S.tx.length + S.act.length} записей</p>
  `;
}
function profileForm(p) {
  return `
  <div class="field"><label>Имя героя</label><input id="pName" value="${esc(p.name || '')}" placeholder="Как тебя зовут?"></div>
  <div class="field"><label>Пол</label><div class="seg"><button class="${p.sex !== 'f' ? 'on' : ''}" data-a="pSex" data-v="m">Мужской</button><button class="${p.sex === 'f' ? 'on' : ''}" data-a="pSex" data-v="f">Женский</button></div></div>
  <div class="grid3">
    <div class="field"><label>Возраст</label><input id="pAge" inputmode="numeric" value="${p.age || ''}" placeholder="лет"></div>
    <div class="field"><label>Рост, см</label><input id="pH" inputmode="numeric" value="${p.height || ''}" placeholder="см"></div>
    <div class="field"><label>Вес, кг</label><input id="pW" inputmode="decimal" value="${p.weight || ''}" placeholder="кг"></div>
  </div>`;
}
function goalForm(p) {
  return `<div class="field"><label>Цель</label>${Object.entries(GOALS).map(([k, g]) => `<button class="opt ${p.goal === k ? 'on' : ''}" data-a="pGoal" data-v="${k}"><b>${g.n}</b><span>${g.d}</span></button>`).join('')}</div>
  <div class="field"><label>Образ жизни (без учёта спорта)</label>${LIFESTYLES.map((l) => `<button class="opt ${p.life === l.v ? 'on' : ''}" data-a="pLife" data-v="${l.v}"><b>${l.n}</b><span>${l.d}</span></button>`).join('')}</div>`;
}
function readProfileInputs(p) {
  const n = (id) => { const el = $('#' + id); return el ? parseFloat(String(el.value).replace(',', '.')) : NaN; };
  if ($('#pName')) p.name = $('#pName').value.trim();
  ['pAge:age', 'pH:height', 'pW:weight', 'pK:kcalOverride', 'pP:proteinOverride'].forEach((s) => {
    const [id, key] = s.split(':'); if (!$('#' + id)) return;
    const v = n(id); p[key] = isNaN(v) ? (key.endsWith('Override') ? null : p[key]) : v;
  });
}
function openProfile() {
  UI.pd = JSON.parse(JSON.stringify(S.profile));
  openSheet(() => {
    const p = UI.pd; const t = targets({ ...p, kcalOverride: null, proteinOverride: null });
    return `${sheetHead('Профиль героя')}${profileForm(p)}${goalForm(p)}
    <div class="grid2">
      <div class="field"><label>Своя норма ккал</label><input id="pK" inputmode="numeric" value="${p.kcalOverride || ''}" placeholder="авто: ${t.kcal}"></div>
      <div class="field"><label>Своя норма белка, г</label><input id="pP" inputmode="numeric" value="${p.proteinOverride || ''}" placeholder="авто: ${t.protein}"></div>
    </div>
    <button class="btn gold" data-a="pSave">Сохранить</button>`;
  });
}
function profileError(p) {
  if (!(p.age >= 10 && p.age <= 100)) return { f: 'pAge', m: p.age ? `Возраст ${p.age}? Укажи от 10 до 100 лет` : 'Укажи возраст' };
  if (!(p.height >= 120 && p.height <= 230)) return { f: 'pH', m: p.height ? `Рост ${p.height} см? Укажи от 120 до 230 см` : 'Укажи рост в сантиметрах' };
  if (!(p.weight >= 30 && p.weight <= 250)) return { f: 'pW', m: p.weight ? `Вес ${p.weight} кг? Похоже на опечатку — укажи от 30 до 250 кг` : 'Укажи вес в килограммах' };
  return null;
}
function validProfile(p) { return !profileError(p); }
function showProfileError(p) {
  const e = profileError(p); if (!e) return false;
  $$('.field input').forEach((i) => i.classList.remove('bad'));
  const el = $('#' + e.f); if (el) { el.classList.add('bad'); el.focus(); }
  toast('⚠️ ' + e.m);
  return true;
}

/* ---------- Онбординг ---------- */
function renderOnboarding() {
  const o = UI.ob, d = o.d;
  const steps = `<div class="steps">${[1, 2, 3].map((i) => `<i class="${o.step >= i ? 'on' : ''}"></i>`).join('')}</div>`;
  const head = `<div class="ob"><div class="logo">Up<span>Bek</span></div><div class="sub">Прокачай себя, как героя игры ⚔️</div>${steps}`;
  if (o.step === 1) {
    return `${head}<div class="card">${profileForm(d)}</div>
    <button class="btn gold" data-a="obNext">Дальше →</button>
    <button class="btn ghost" style="margin-top:10px" data-a="obRestore">♻️ У меня уже есть код восстановления</button></div>`;
  }
  if (o.step === 2) {
    const t = d.goal && d.life ? targets(d) : null;
    return `${head}<div class="card">${goalForm(d)}</div>
    ${t ? `<div class="target-box"><span class="muted">Твоя норма в день</span><b class="num">${fmt(t.kcal)} ккал</b><span class="muted">и ${t.protein} г белка · спорт добавляется сверху</span></div>` : ''}
    <div class="row"><button class="btn ghost" data-a="obBack" style="flex:0 0 64px">←</button><button class="btn gold grow" data-a="obNext">Дальше →</button></div></div>`;
  }
  return `${head}<div class="card">
    <p style="margin-top:0">Отметь свои банки и впиши, сколько на них <b>сейчас</b>. Звёздочка ★ — основной счёт.</p>
    ${BANKS.map((b) => { const s = o.banks[b.id] || {}; return `<div class="bankrow">
      <button class="st ${o.main === b.id ? 'on' : ''}" data-a="obMain" data-v="${b.id}" ${s.on ? '' : 'style="visibility:hidden"'}>${o.main === b.id ? '★' : '☆'}</button>
      <button class="bn" data-a="obBank" data-v="${b.id}"><span style="font-size:20px">${s.on ? '✅' : '⬜'}</span><i class="dot" style="background:${b.color}"></i>${b.name}</button>
      <input data-ob-bal="${b.id}" inputmode="numeric" placeholder="сом" value="${esc(s.bal || '')}" ${s.on ? '' : 'disabled style="opacity:.3"'}></div>`; }).join('')}
  </div>
  <div class="row"><button class="btn ghost" data-a="obBack" style="flex:0 0 64px">←</button><button class="btn gold grow" data-a="obFinish">Начать игру ⚔️</button></div></div>`;
}

/* ================= ОБРАБОТЧИКИ ================= */
const A = {
  close: closeSheet,
  undo: () => { $('#toast').classList.remove('show'); if (toastUndo) { const f = toastUndo; toastUndo = null; f(); } },
  tab: (el) => { UI.tab = el.dataset.v; closeSheet(); render(); window.scrollTo(0, 0); },
  hub: openHub,

  // деньги
  money: (el) => openMoney({ mode: el.dataset.v }),
  editTx: (el) => openMoney({ id: el.dataset.v }),
  sortNext: () => { const t = [...S.tx].filter(isUnsorted).sort((a, b) => b.t - a.t)[0]; if (t) openMoney({ id: t.id }); },
  mMode: (el) => { const m = UI.money; m.mode = el.dataset.v; if (!m.editId || m.cat === null || (m.mode === 'inc') !== INC_CATS.some((c) => c[0] === m.cat)) m.cat = null; fixTransferTo(); refreshSheet(); },
  mAcc: (el) => { UI.money.acc = el.dataset.v; fixTransferTo(); refreshSheet(); },
  mTo: (el) => { UI.money.to = el.dataset.v; refreshSheet(); },
  mDay: (el) => { UI.money.day = +el.dataset.v; refreshSheet(); },
  mKey: (el) => {
    const m = UI.money, k = el.dataset.v;
    if (k === '⌫') m.amount = m.amount.length > 1 ? m.amount.slice(0, -1) : '0';
    else if (m.amount.length < 10) m.amount = m.amount === '0' ? (k === '000' ? '0' : k) : m.amount + k;
    $('#mAmount').innerHTML = amountHtml();
  },
  mCat: (el) => { UI.money.cat = el.dataset.v; if (UI.money.editId) refreshSheet(); else saveMoney(); },
  mSave: saveMoney,
  mMonth: (el) => { UI.mOff = Math.min(0, (UI.mOff || 0) + +el.dataset.v); render(); },
  mFilter: (el) => { UI.mAcc = el.dataset.v || null; render(); },
  mMore: () => { UI.allCats = !UI.allCats; refreshSheet(); },
  mFreq: (el) => { const f = UI.freq[+el.dataset.v]; if (!f) return; const m = UI.money; m.cat = f.cat; m.amount = String(f.amount); if (accById(f.acc)) m.acc = f.acc; saveMoney(); },
  mDel: () => { const id = UI.money.editId; const old = S.tx.find((t) => t.id === id); closeSheet(); act(() => { S.tx = S.tx.filter((t) => t.id !== id); }, 'Удалено', () => act(() => S.tx.push(old), 'Восстановлено')); },
  rec: openRec,
  recSave: saveRec,
  acc: (el) => openAcc(el.dataset.v),
  accMain: (el) => { S.main = el.dataset.v; save(); closeSheet(); render(); toast('★ Основной счёт выбран'); },
  accSave: (el) => {
    const a = accById(el.dataset.v);
    a.name = $('#accName').value.trim() || a.name;
    a.start = Math.round(parseFloat($('#accStart').value.replace(/\s/g, '').replace(',', '.')) || 0);
    save(); closeSheet(); render(); toast('Сохранено ✓');
  },
  accDel: (el) => { if (!confirm('Удалить счёт?')) return; S.accounts = S.accounts.filter((a) => a.id !== el.dataset.v); if (S.main === el.dataset.v) S.main = S.accounts[0].id; save(); closeSheet(); render(); },
  addAcc: openAddAcc,
  newAccBank: (el) => { UI.newAcc = el.dataset.v; refreshSheet(); },
  addAccSave: () => {
    const b = BANKS.find((x) => x.id === UI.newAcc);
    const a = { id: uid(), bank: b.id, name: $('#naName').value.trim() || b.name, color: b.color, since: Date.now(), start: Math.round(parseFloat(($('#naBal').value || '0').replace(/\s/g, '').replace(',', '.')) || 0) };
    S.accounts.push(a); if (!S.main) S.main = a.id; save(); closeSheet(); render(); toast(`Счёт «${esc(a.name)}» добавлен`);
  },

  // тело
  day: (el) => { UI.foodDay = Math.min(0, UI.foodDay + +el.dataset.v); render(); },
  allFoods: () => { UI.allFoods = !UI.allFoods; refreshSheet(); },
  addFood: async (el) => {
    const f = foodById(el.dataset.v); if (!f) return;
    if (tooFast()) return;
    const key = viewDayKey();
    const same = S.food.filter((x) => x.fid === f.id && dayKey(x.t) === key).sort((a, b) => b.t - a.t);
    if (same.length) {
      const n = sum(same, (x) => x.qty);
      const ok = await ask(`${f.ic} <b>${esc(f.n)}</b> уже записано ${dayLabel(key).toLowerCase()} в ${hhmm(same[0].t)} (${round1(n)} ${esc(f.u)}).<br>Записать ещё?`, 'Да, ещё', 'Нет');
      if (!ok) return;
      lastAddAt = Date.now();
    }
    const e = foodEntry(f, f.dq || 1);
    const inp = $('#foodText'); if (inp) inp.value = '';
    act(() => { S.food.push(e); S.usage[f.id] = (S.usage[f.id] || 0) + 1; }, `${f.ic} ${esc(f.n)} · ${fmt(foodKcal(e))} ккал`, () => act(() => { S.food = S.food.filter((x) => x.id !== e.id); S.usage[f.id] = Math.max(0, (S.usage[f.id] || 1) - 1); }, 'Отменено'));
  },
  approx: async (el) => {
    const a = APPROX.find((x) => x.id === el.dataset.v);
    if (tooFast()) return;
    const recent = S.food.find((x) => x.name === `${a.n} (примерно)` && Date.now() - x.t < 60 * 60000 && UI.foodDay === 0);
    if (recent && !(await ask(`🍽️ «${a.n}» уже записан в ${hhmm(recent.t)}.<br>Записать ещё один приём пищи?`, 'Да', 'Нет'))) return;
    const e = { id: uid(), t: viewDayTime(), name: `${a.n} (примерно)`, ic: '🍽️', unit: 'приём пищи', qty: 1, k: a.k, p: a.p, f: a.f || 0, c: a.c || 0 };
    if (UI.linkTx) e.tx = UI.linkTx;
    act(() => S.food.push(e), `🍽️ ${a.n} · ~${a.k} ккал`, () => act(() => { S.food = S.food.filter((x) => x.id !== e.id); }, 'Отменено'));
  },
  saveText: () => {
    if (tooFast()) return;
    const parts = parseFood($('#foodText').value).filter((p) => !p.bad);
    const t = viewDayTime();
    const entries = parts.map((p) => (p.custom
      ? { id: uid(), t, name: p.name, ic: '🍽️', unit: 'порция', qty: 1, k: p.k, p: 0, ...(UI.linkTx ? { tx: UI.linkTx } : {}) }
      : { ...foodEntry(p.f, p.qty), t }));
    const ids = entries.map((e) => e.id);
    closeSheet();
    act(() => { S.food.push(...entries); parts.forEach((p) => { if (p.f) S.usage[p.f.id] = (S.usage[p.f.id] || 0) + 1; }); },
      `Записано: ${entries.length} · ${fmt(sum(entries, foodKcal))} ккал`, () => act(() => { S.food = S.food.filter((x) => !ids.includes(x.id)); }, 'Отменено'));
  },
  editFood: (el) => openEditFood(el.dataset.v),
  fqty: (el) => { const e = S.food.find((x) => x.id === UI.editFood); if (!e) return; const q = Math.max(0.5, round1(e.qty + +el.dataset.v)); act(() => { e.qty = q; }); refreshSheet(); },
  fdel: () => { const e = S.food.find((x) => x.id === UI.editFood); closeSheet(); act(() => { S.food = S.food.filter((x) => x.id !== e.id); }, 'Удалено', () => act(() => S.food.push(e), 'Восстановлено')); },
  customFood: openCustomFood,
  cfSave: () => {
    const n = $('#cfName').value.trim(); const k = parseFloat($('#cfK').value); const p = parseFloat(($('#cfP').value || '0').replace(',', '.')) || 0;
    if (!n || !k) { toast('Впиши название и калории'); return; }
    const words = norm(n).split(/\s+/).filter((w) => w.length >= 3);
    const f = { id: 'c_' + uid(), n, ic: '⭐', u: 'порция', g: 0, k: Math.round(k), p: round1(p), a: [norm(n), ...words] };
    const e = foodEntry(f, 1);
    closeSheet();
    act(() => { S.customFoods.push(f); S.food.push(e); S.usage[f.id] = 5; }, `⭐ ${esc(n)} сохранено и записано`);
  },
  cfDel: (el) => { S.customFoods = S.customFoods.filter((f) => f.id !== el.dataset.v); save(); refreshSheet(); render(); },
  // ＋ / окна
  foodSheet: (el) => { const keep = !!el.dataset.keep; if (UI.sheetFn && !keep) { initFoodSub(el.dataset.v); UI.foodDay = 0; openSheet(renderFoodSheet); return; } openFoodSheet(el.dataset.v, keep); },
  fs: (el) => { initFoodSub(el.dataset.v); refreshSheet(); },
  sport: (el) => openSport(!!el.dataset.keep),
  spKind: (el) => { UI.sp = el.dataset.v; refreshSheet(); },
  spSave: (el) => {
    const Ak = actById(UI.sp);
    const val = el.dataset.v === 'custom' ? parseInt($('#spCustom').value, 10) : +el.dataset.v;
    if (!val || val <= 0 || val > 600) { toast('Впиши число минут'); return; }
    const e = { id: uid(), t: viewDayTime(), kind: Ak.id, min: val, kcal: actKcal(Ak, val) };
    closeSheet();
    act(() => S.act.push(e), `${Ak.ic} ${Ak.n} ${val} мин · −${fmt(e.kcal)} ккал`, () => act(() => { S.act = S.act.filter((x) => x.id !== e.id); }, 'Отменено'));
  },
  stepsSave: (el) => {
    const val = el.dataset.v === 'custom' ? parseInt($('#stepsCustom').value, 10) : +el.dataset.v;
    if (!val || val <= 0 || val > 100000) { toast('Впиши число шагов'); return; }
    const key = viewDayKey(); const Ak = actById('steps');
    const e = { id: uid(), t: viewDayTime(), kind: 'steps', steps: val, kcal: actKcal(Ak, val) };
    closeSheet();
    // шаги за день — одна запись, новая заменяет старую
    act(() => { S.act = S.act.filter((x) => !(x.steps && dayKey(x.t) === key)); S.act.push(e); }, `👣 ${fmt(val)} шагов · −${fmt(e.kcal)} ккал`);
  },
  editAct: (el) => {
    const e = S.act.find((x) => x.id === el.dataset.v); const Ak = actById(e.kind);
    openSheet(() => `${sheetHead(`${Ak.ic} ${Ak.n}`)}<div class="total" style="margin-bottom:14px"><div class="tv">${e.steps ? fmt(e.steps) + ' шагов' : e.min + ' мин'}</div><div class="tl">−${fmt(e.kcal)} ккал · ${hhmm(e.t)}</div></div>
      <button class="btn danger" data-a="actDel" data-v="${e.id}">Удалить</button>`);
  },
  actDel: (el) => { const e = S.act.find((x) => x.id === el.dataset.v); closeSheet(); act(() => { S.act = S.act.filter((x) => x.id !== e.id); }, 'Удалено', () => act(() => S.act.push(e), 'Восстановлено')); },
  wStep: (el) => { UI.w = clamp(round1(UI.w + +el.dataset.v), 30, 250); $('#wVal').textContent = UI.w.toFixed(1); },
  wSave: () => {
    const kg = UI.w; const k = viewDayKey(); const t = viewDayTime();
    closeSheet();
    act(() => {
      if (!S.profile.startWeight) S.profile.startWeight = S.profile.weight;
      S.weights = S.weights.filter((w) => dayKey(w.t) !== k);
      S.weights.push({ id: uid(), t, kg });
      const last = [...S.weights].sort((a, b) => b.t - a.t)[0];
      S.profile.weight = last.kg;
    }, `⚖️ ${kg.toFixed(1)} кг записано`);
  },
  slAdj: (el) => {
    const [k, d] = el.dataset.v.split(':'); const s = { ...UI.sl }; s[k] += +d * 60000;
    if (s.wake - s.bed < 36e5 || s.wake - s.bed > 18 * 36e5) { toast('Сон должен быть от 1 до 18 часов'); return; }
    if (k === 'wake' && s.wake > Date.now() + 5 * 60000) { toast('Ещё не наступило 🙂'); return; }
    UI.sl = s; refreshSheet();
  },
  slSave: () => { const s = UI.sl; closeSheet(); saveSleep(s); },
  slQuick: () => saveSleep(sleepGuess(0)),
  slDel: () => { const id = UI.sl.id; const old = S.sleep.find((x) => x.id === id); closeSheet(); act(() => { S.sleep = S.sleep.filter((x) => x.id !== id); }, 'Удалено', () => act(() => S.sleep.push(old), 'Восстановлено')); },
  slSkip: () => { S.sleepSkip = dayKey(); save(); render(); },
  recSkip: () => { S.recSkip = Date.now(); save(); render(); },

  // профиль
  profile: openProfile,
  pSex: (el) => { const p = S.profile && UI.sheetFn ? UI.pd : UI.ob.d; readProfileInputs(p); p.sex = el.dataset.v; S.profile && UI.sheetFn ? refreshSheet() : render(); },
  pGoal: (el) => { const p = S.profile && UI.sheetFn ? UI.pd : UI.ob.d; readProfileInputs(p); p.goal = el.dataset.v; S.profile && UI.sheetFn ? refreshSheet() : render(); },
  pLife: (el) => { const p = S.profile && UI.sheetFn ? UI.pd : UI.ob.d; readProfileInputs(p); p.life = +el.dataset.v; S.profile && UI.sheetFn ? refreshSheet() : render(); },
  pSave: () => {
    const p = UI.pd; readProfileInputs(p);
    if (showProfileError(p)) return;
    const wChanged = p.weight !== S.profile.weight;
    closeSheet();
    act(() => {
      S.profile = p;
      if (wChanged) { const k = dayKey(); S.weights = S.weights.filter((w) => dayKey(w.t) !== k); S.weights.push({ id: uid(), t: Date.now(), kg: p.weight }); }
    }, 'Профиль обновлён ✓');
  },

  // онбординг
  obNext: () => {
    const o = UI.ob, d = o.d;
    if (o.step === 1) {
      readProfileInputs(d);
      if (!d.sex) d.sex = 'm';
      if (showProfileError(d)) return;
      if (!d.goal) d.goal = 'bulk';
      if (!d.life) d.life = 1.2;
    }
    o.step++; render(); window.scrollTo(0, 0);
  },
  obBack: () => { UI.ob.step--; render(); },
  obBank: (el) => { const b = UI.ob.banks; const id = el.dataset.v; b[id] = b[id] || { bal: '' }; b[id].on = !b[id].on; if (b[id].on && !b[UI.ob.main]?.on) UI.ob.main = id; if (!b[id].on && UI.ob.main === id) { const n = Object.keys(b).find((k) => b[k].on); UI.ob.main = n || null; } render(); },
  obMain: (el) => { UI.ob.main = el.dataset.v; render(); },
  obFinish: () => {
    const o = UI.ob;
    const chosen = BANKS.filter((b) => o.banks[b.id]?.on);
    if (!chosen.length) { toast('Отметь хотя бы один счёт'); return; }
    const d = o.d;
    S.profile = { name: d.name || 'Герой', sex: d.sex || 'm', age: d.age, height: d.height, weight: d.weight, startWeight: d.weight, goal: d.goal || 'bulk', life: d.life || 1.2, kcalOverride: null, proteinOverride: null };
    S.accounts = chosen.map((b) => ({ id: b.id, bank: b.id, name: b.name, color: b.color, since: Date.now(), start: Math.round(parseFloat(String(o.banks[b.id].bal || '0').replace(/\s/g, '').replace(',', '.')) || 0) }));
    S.main = o.main && o.banks[o.main]?.on ? o.main : S.accounts[0].id;
    S.weights = [{ id: uid(), t: Date.now(), kg: d.weight }];
    S.lastLevel = 1;
    save(); UI.tab = 'hero'; render();
    toast('Добро пожаловать в UpBek! ⚔️');
    if (typeof cloudStart === 'function') cloudStart();
    progress(game());
  },

  theme: (el) => {
    const id = el.dataset.v;
    try { localStorage.setItem('upbek.theme', id); } catch (e) { /* ок */ }
    applyTheme(id); render();
    toast(id === 'comic' ? '💥 БАМ! Тема «Комикс»' : '⚔️ Тема «Классика»');
  },

  // данные
  export: async () => {
    const json = JSON.stringify(S, null, 1);
    const name = `upbek-${dayKey()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'UpBek — резервная копия' }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  import: () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = async () => {
      try {
        const d = JSON.parse(await i.files[0].text());
        if (!d || !d.profile || !Array.isArray(d.tx)) throw new Error('bad');
        if (!confirm('Заменить текущие данные данными из копии?')) return;
        S = Object.assign(fresh(), d); save(); render(); toast('Данные загружены ✓');
      } catch (e) { toast('Это не похоже на копию UpBek'); }
    };
    i.click();
  },
  clearRecords: async () => {
    const n = S.food.length + S.tx.length + S.act.length + S.sleep.length + S.weights.length;
    if (!(await ask(`Удалить все записи (${n}): еду, траты, спорт, сон и вес?<br>Профиль, счета и их начальные балансы останутся. <b>Отменить нельзя.</b>`, 'Удалить', 'Отмена'))) return;
    const w = S.profile.weight;
    S.food = []; S.tx = []; S.act = []; S.sleep = []; S.bedMarks = []; S.coach = []; S.usage = {}; S.seenAch = []; S.lastLevel = 1;
    S.weights = [{ id: uid(), t: Date.now(), kg: w }]; S.profile.startWeight = w;
    save(); render(); toast('🧹 Записи удалены. Начинаем с чистого листа!');
  },
  appUpdate: async () => {
    toast('🔄 Обновляю…');
    try {
      if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
      if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.update();
    } catch (e) { /* ок */ }
    setTimeout(() => location.reload(), 400);
  },
  reset: () => {
    if (!confirm('Точно стереть ВСЕ данные? Это нельзя отменить.')) return;
    if (!confirm('Последний шанс: стираем?')) return;
    S = fresh(); save(); UI.ob = { step: 1, d: {}, banks: { mbank: { on: true, bal: '' } }, main: 'mbank' }; UI.tab = 'hero'; render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const fn = A[el.dataset.a];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'foodText') updateFoodPreview();
  else if (el.id === 'mNote' && UI.money) UI.money.note = el.value;
  else if (el.dataset.obBal) { const b = UI.ob.banks[el.dataset.obBal]; if (b) b.bal = el.value; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'foodText') { e.preventDefault(); if ($('[data-a="saveText"]')) A.saveText(); else e.target.blur(); }
});
$('#backdrop').addEventListener('click', closeSheet);
document.addEventListener('visibilitychange', () => { if (document.hidden && S.profile) { S.lastHidden = Date.now(); save(); return; } if (!document.hidden && !UI.sheetFn && document.activeElement?.tagName !== 'INPUT') render(); });

/* ---------- старт ---------- */
applyTheme(document.documentElement.dataset.theme || 'classic');
render();
if (S.profile) progress(game());
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
