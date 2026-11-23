/* ===== UpBek: блокнот благодарности =====
   По желанию: в настройках включается напоминание (карточка на главной в выбранный час, 1 час).
   Записи хранятся только на телефоне и в зашифрованной облачной копии — в ИИ, рейтинг и паре не уходят. */
'use strict';

const gratOn = () => !!(S.prefs && S.prefs.grat && S.prefs.grat.on);
const gratHour = () => { const h = S.prefs && S.prefs.grat && +S.prefs.grat.hour; return h >= 5 && h <= 23 ? h : 9; };
const gratList = () => (Array.isArray(S.grat) ? S.grat : []);
const gratToday = () => gratList().filter((g) => dayKey(g.t) === dayKey());
const gratDays = () => new Set(gratList().map((g) => dayKey(g.t))).size;
const GRAT_HINTS = ['Вкусный завтрак', 'Тёплый разговор', 'Хорошая погода', 'Здоровье близких', 'Сделал(а) тренировку', 'Спокойный вечер'];

// карточка на главной: только в выбранный час, если сегодня ещё нет записи
function gratCard() {
  if (!gratOn() || gratToday().length || (S.prefs.grat.skip === dayKey())) return '';
  const h = new Date().getHours(); if (h !== gratHour()) return '';
  return `<div class="card prompt grat-card"><div class="row"><span style="font-size:28px">🙏</span><div class="grow"><b>За что ты сегодня благодарен(а)?</b><div class="dim">Одна строчка — и день начинается теплее</div></div><button class="x" data-a="gratSkip" aria-label="Скрыть">✕</button></div>
  <div class="row" style="margin-top:10px"><input id="gratQuick" maxlength="200" placeholder="Например: за вкусный завтрак" autocomplete="off"><button class="btn gold sm" data-a="gratQuickSave">Записать</button></div></div>`;
}

function openGrat() { openSheet(renderGrat); }
function renderGrat() {
  const g = (S.prefs && S.prefs.grat) || {};
  const list = [...gratList()].sort((a, b) => b.t - a.t);
  const days = []; list.forEach((x) => { const k = dayKey(x.t); let d = days[days.length - 1]; if (!d || d.k !== k) days.push((d = { k, items: [] })); d.items.push(x); });
  return `${sheetHead('🙏 Блокнот благодарности')}
  <div class="field"><label>За что ты благодарен(а) сегодня?</label><textarea id="gratText" rows="3" maxlength="200" placeholder="Можно несколько мелочей — каждая с новой строки"></textarea></div>
  <div class="chips wrap" style="margin-bottom:10px">${GRAT_HINTS.map((x) => `<button class="chip" data-a="gratHint" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
  <button class="btn gold" data-a="gratSave">Записать</button>

  <h3 class="vh">⏰ Напоминание</h3>
  <div class="card">
    <label class="checkrow"><input type="checkbox" ${g.on ? 'checked' : ''} data-a="gratToggle"> Напоминать на главной</label>
    ${g.on ? `<div class="dim" style="margin:10px 0 6px">Во сколько (карточка висит 1 час):</div><div class="chips wrap">${[7, 8, 9, 10, 12, 20, 21, 22].map((h) => `<button class="chip${gratHour() === h ? ' on' : ''}" data-a="gratHour" data-v="${h}">${h}:00–${h + 1}:00</button>`).join('')}</div>` : ''}
  </div>
  <div class="note">Чтобы iPhone сам напоминал открыть UpBek: «Напоминания» → новое «Благодарность (UpBek)» → ${gratHour()}:00 → «Повтор: ежедневно». Записи видишь только ты — они не уходят в ИИ, рейтинг и партнёру.</div>

  <h3 class="vh">📖 Записи <small class="dim">${gratDays()} дн. · +5 XP за день</small></h3>
  ${days.length ? days.slice(0, 30).map((d) => `<div class="day-head"><span>${dayLabel(d.k)}</span></div><div class="card list grat-list">${d.items.map((x) => `<div class="item"><span class="ii">🙏</span><span class="grow"><div class="it grat-text">${esc(x.text)}</div><div class="is">${hhmm(x.t)}</div></span><button class="btn ghost sm" data-a="gratDel" data-v="${x.id}" aria-label="Удалить">✕</button></div>`).join('')}</div>`).join('') : '<div class="empty">Пока пусто. Начни с одной мелочи 🌱</div>'}`;
}
function gratAdd(text) {
  const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 5);
  if (!lines.length) { toast('Напиши хотя бы одну мелочь'); return false; }
  const first = !gratToday().length;
  const items = lines.map((l) => ({ id: uid(), t: Date.now(), text: l.slice(0, 200) }));
  act(() => { S.grat = [...gratList(), ...items].slice(-500); }, first ? '🙏 Записано · +5 XP' : '🙏 Записано');
  return true;
}

Object.assign(A, {
  gratOpen: openGrat,
  gratSave: () => { if (gratAdd(($('#gratText') || {}).value)) refreshSheet(); },
  gratQuickSave: () => { gratAdd(($('#gratQuick') || {}).value); },
  gratHint: (el) => { const t = $('#gratText'); if (!t) return; t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + el.dataset.v; t.focus(); },
  gratDel: async (el) => { if (!(await ask('Удалить эту запись?', 'Удалить', 'Отмена'))) return; act(() => { S.grat = gratList().filter((x) => x.id !== el.dataset.v); }, 'Удалено'); refreshSheet(); },
  gratToggle: () => { const g = { ...((S.prefs && S.prefs.grat) || {}) }; g.on = !g.on; g.hour = g.hour || 9; S.prefs = { ...(S.prefs || {}), grat: g }; save(); refreshSheet(); render(); toast(g.on ? `⏰ Напомню в ${gratHour()}:00` : 'Напоминание выключено'); },
  gratHour: (el) => { S.prefs.grat = { ...S.prefs.grat, hour: +el.dataset.v }; save(); refreshSheet(); render(); },
  gratSkip: () => { S.prefs.grat = { ...S.prefs.grat, skip: dayKey() }; save(); render(); },
});
// карточка должна появиться и исчезнуть по часам, даже если приложение открыто
setInterval(() => { if (!document.hidden && !UI.sheetFn && UI.tab === 'hero' && gratOn()) { const has = !!document.querySelector('.grat-card'); const want = !!gratCard(); if (has !== want) render(); } }, 60000);
