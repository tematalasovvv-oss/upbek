/* ===== UpBek: кредиты и кредитные карты ===== */
'use strict';

const activeLoans = () => (S.loans || []).filter((l) => !l.closed);
const loanById = (id) => (S.loans || []).find((l) => l.id === id);
function addMonths(ts, n) {
  const d = new Date(ts); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return d.getTime();
}
function nextByDay(day, after) {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  if (d.getDate() > day) d.setMonth(d.getMonth() + 1, 1);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  let t = d.getTime();
  if (after && t - after < 20 * DAY) t = addMonths(t, 1);
  return t;
}
const shortDate = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
function daysLeft(t) { const a = new Date(dayKey() + 'T12:00:00'), b = new Date(dayKey(t) + 'T12:00:00'); return Math.round((b - a) / DAY); }
function whenText(t) { const n = daysLeft(t); return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : n < 0 ? `просрочен на ${-n} дн.` : `через ${n} дн. (${shortDate(t)})`; }

function loanState(L) {
  if (L.kind === 'card') {
    const bal = balances()[L.acc] || 0;
    const debt = Math.max(0, -bal);
    const lastPay = Math.max(0, ...S.tx.filter((t) => t.type === 'tr' && t.to === L.acc).map((t) => t.t));
    return { debt, limit: L.limit || 0, avail: (L.limit || 0) + bal, next: L.payDay && debt > 0 ? { d: nextByDay(L.payDay, lastPay), pay: L.minPay || 0 } : null };
  }
  const pays = S.tx.filter((t) => t.loan === L.id && t.type === 'exp');
  const paid = sum(pays, (t) => t.amount);
  const lastPay = Math.max(0, ...pays.map((t) => t.t));
  if (L.schedule && L.schedule.length) {
    let cum = 0, n = 0;
    for (const r of L.schedule) { if (cum + r.pay <= paid + 1) { cum += r.pay; n++; } else break; }
    const total = sum(L.schedule, (r) => r.pay);
    const nx = L.schedule[n];
    return { paid, n, count: L.schedule.length, total, left: Math.max(0, total - paid), principalLeft: n ? L.schedule[n - 1].bal : L.principal, next: nx ? { d: nx.d, pay: Math.max(0, nx.pay - (paid - cum)) } : null };
  }
  const total = L.monthly && L.term ? L.monthly * L.term : L.principal || 0;
  return { paid, total, left: Math.max(0, total - paid), next: L.payDay && L.monthly && paid < total ? { d: nextByDay(L.payDay, lastPay), pay: L.monthly } : null };
}

/* ---- раздел в Казне ---- */
function loansSection() {
  const list = activeLoans();
  const debtAll = sum(list, (L) => { const s = loanState(L); return L.kind === 'card' ? s.debt : s.left; });
  return `<h2>🏦 Кредиты и кредитки <small>${list.length ? 'долг ' + som(debtAll) : ''}</small></h2>
  ${list.length ? `<div class="card list">${list.map((L) => {
    const s = loanState(L); const a = accById(L.kind === 'card' ? L.acc : L.bankAcc);
    if (L.kind === 'card') return `<button class="item" data-a="loanOpen" data-v="${L.id}"><span class="ii">💳</span><span class="grow"><div class="it">${esc(L.name)}</div><div class="is">долг ${fmt(s.debt)} из ${fmt(s.limit)} · доступно ${fmt(s.avail)}${s.next ? ' · платёж ' + whenText(s.next.d) : ''}</div>${bar(s.debt, s.limit || 1, 'red')}</span><span>›</span></button>`;
    return `<button class="item" data-a="loanOpen" data-v="${L.id}"><span class="ii">🏦</span><span class="grow"><div class="it">${esc(L.name)}${a ? ` <span class="dim">· ${esc(a.name)}</span>` : ''}</div><div class="is">осталось ${fmt(s.left)}${s.next ? ` · ${fmt(s.next.pay)} ${whenText(s.next.d)}` : s.left ? '' : ' · ✓ погашен'}</div>${bar(s.paid, s.total || 1, 'green')}</span><span>›</span></button>`;
  }).join('')}</div>` : '<div class="card empty">Добавь кредит или кредитную карту — будут видны остаток, график и напоминания о платежах.</div>'}
  <div class="row" style="margin-top:10px"><button class="btn ghost" data-a="loanAdd" data-v="loan">＋ Кредит</button><button class="btn ghost" data-a="loanAdd" data-v="card">＋ Кредитная карта</button></div>`;
}

/* ---- добавление / изменение ---- */
function openLoanForm(kind, id) {
  const L = id ? loanById(id) : null;
  UI.ln = L ? { ...L, schedule: L.schedule ? [...L.schedule] : null, editId: L.id } : { kind, name: '', bankAcc: S.main, principal: '', rate: '', term: '', monthly: '', payDay: '', limit: '', debt: '', minPay: '', credit: false, schedule: null };
  if (L && L.kind === 'card') UI.ln.debt = Math.max(0, -(balances()[L.acc] || 0));
  openSheet(renderLoanForm);
}
const lnNum = (id) => { const el = $('#' + id); if (!el) return undefined; const v = parseFloat(String(el.value).replace(/\s/g, '').replace(',', '.')); return isNaN(v) ? '' : v; };
function readLoanForm() {
  const x = UI.ln; const nm = $('#lnName'); if (nm) x.name = nm.value.trim();
  ['principal', 'rate', 'term', 'monthly', 'payDay', 'limit', 'debt', 'minPay'].forEach((k) => { const v = lnNum('ln_' + k); if (v !== undefined) x[k] = v; });
  const cr = $('#lnCredit'); if (cr) x.credit = cr.checked;
}
function renderLoanForm() {
  const x = UI.ln, card = x.kind === 'card', ed = !!x.editId;
  const f = (k, label, ph) => `<div class="field"><label>${label}</label><input id="ln_${k}" inputmode="decimal" value="${x[k] === '' || x[k] == null ? '' : x[k]}" placeholder="${ph || ''}"></div>`;
  const sch = x.schedule && x.schedule.length ? x.schedule : null;
  return `${sheetHead(ed ? '✏️ Изменить' : card ? '💳 Кредитная карта' : '🏦 Новый кредит')}
  ${ed ? '' : `<div class="seg" style="margin-bottom:12px"><button class="${!card ? 'on' : ''}" data-a="lnKind" data-v="loan">🏦 Кредит</button><button class="${card ? 'on' : ''}" data-a="lnKind" data-v="card">💳 Кредитка</button></div>`}
  ${!card ? `<button class="btn gold" style="margin-bottom:12px" data-a="lnScan">📄 Загрузить график (PDF или скрин)</button>` : ''}
  <div class="field"><label>Название</label><input id="lnName" value="${esc(x.name)}" placeholder="${card ? 'Например: Кредитка Мбанк' : 'Например: Кредит на телефон'}"></div>
  <div class="hint" style="text-align:left">Банк</div>
  <div class="chips" style="margin-bottom:10px">${S.accounts.filter((a) => !a.credit).map((a) => `<button class="chip ${x.bankAcc === a.id ? 'on' : ''}" data-a="lnBank" data-v="${a.id}"><i class="dot" style="background:${a.color}"></i>${esc(a.name)}</button>`).join('')}</div>
  ${card ? `<div class="grid2">${f('limit', 'Кредитный лимит', '50 000')}${f('debt', 'Долг сейчас', '0')}</div><div class="grid2">${f('payDay', 'День платежа (число)', '25')}${f('minPay', 'Мин. платёж, сом', 'необязательно')}</div>
    <div class="note">Кредитка станет отдельным счётом: покупки с неё записывай как обычные траты с этого счёта, а погашение — через «Погашение кредита».</div>`
    : `<div class="grid2">${f('principal', 'Сумма кредита', '100 000')}${f('rate', 'Ставка, % годовых', '24')}</div>
    <div class="grid3">${f('term', 'Срок, мес.', '12')}${f('monthly', 'Платёж в месяц', '9 500')}${f('payDay', 'День платежа', '20')}</div>
    ${sch ? `<div class="note">📄 График: ${sch.length} платежей · ${shortDate(sch[0].d)} — ${shortDate(sch[sch.length - 1].d)} · всего к выплате ${som(sum(sch, (r) => r.pay))}${x.principal ? ` · переплата ${som(sum(sch, (r) => r.pay) - x.principal)}` : ''}</div>` : ''}
    ${ed ? '' : `<label class="checkrow"><input type="checkbox" id="lnCredit" ${x.credit ? 'checked' : ''}> Деньги пришли на счёт сегодня (запишу доход «Кредит»)</label>`}`}
  <button class="btn gold" style="margin-top:12px" data-a="lnSave">${ed ? 'Сохранить' : 'Добавить'}</button>
  ${ed ? `<button class="btn danger" style="margin-top:8px" data-a="lnClose">${card ? 'Закрыть карту' : 'Отметить погашенным / удалить'}</button>` : ''}`;
}
function saveLoan() {
  readLoanForm(); const x = UI.ln;
  if (!x.name) { toast('Впиши название'); return; }
  const card = x.kind === 'card';
  if (card && !(x.limit > 0)) { toast('Укажи кредитный лимит'); return; }
  if (!card && !(x.principal > 0) && !(x.schedule && x.schedule.length)) { toast('Укажи сумму кредита'); return; }
  const payDay = x.payDay ? clamp(Math.round(x.payDay), 1, 31) : (x.schedule && x.schedule.length ? new Date(x.schedule[0].d).getDate() : null);
  const base = { kind: x.kind, name: x.name, bankAcc: x.bankAcc, payDay };
  closeSheet();
  if (x.editId) {
    const L = loanById(x.editId);
    act(() => {
      Object.assign(L, base, card ? { limit: +x.limit || 0, minPay: +x.minPay || 0 } : { principal: +x.principal || 0, rate: +x.rate || 0, term: +x.term || 0, monthly: +x.monthly || 0, schedule: x.schedule });
      if (card) { const a = accById(L.acc); if (a) { a.name = x.name; const cur = balances()[a.id]; a.start += -(+x.debt || 0) - cur; } }
    }, 'Сохранено ✓');
    return;
  }
  const L = { id: uid(), created: Date.now(), ...base };
  if (card) {
    const bank = accById(x.bankAcc) || {};
    const acc = { id: uid(), bank: bank.bank || 'other', name: x.name, color: '#ff6b7a', start: -(+x.debt || 0), since: Date.now(), credit: true, loanId: L.id };
    Object.assign(L, { acc: acc.id, limit: +x.limit, minPay: +x.minPay || 0 });
    act(() => { S.accounts.push(acc); (S.loans = S.loans || []).push(L); }, `💳 Кредитка «${esc(x.name)}» добавлена`);
  } else {
    Object.assign(L, { principal: +x.principal || (x.schedule ? x.schedule[0].bal + x.schedule[0].princ : 0), rate: +x.rate || 0, term: +x.term || (x.schedule ? x.schedule.length : 0), monthly: +x.monthly || (x.schedule ? x.schedule[0].pay : 0), schedule: x.schedule });
    act(() => {
      (S.loans = S.loans || []).push(L);
      if (x.credit && L.principal) S.tx.push({ id: uid(), t: Date.now(), type: 'inc', amount: L.principal, acc: x.bankAcc, cat: 'loan_in', note: L.name, loan: L.id });
    }, `🏦 Кредит «${esc(x.name)}» добавлен`);
  }
}

/* ---- карточка кредита ---- */
function openLoan(id) { UI.loanId = id; openSheet(renderLoan); }
function renderLoan() {
  const L = loanById(UI.loanId); if (!L) return sheetHead('Кредит');
  const s = loanState(L);
  if (L.kind === 'card') {
    const ops = S.tx.filter((t) => t.acc === L.acc || t.to === L.acc).sort((a, b) => b.t - a.t).slice(0, 15);
    return `${sheetHead('💳 ' + esc(L.name))}
    <div class="split" style="margin-top:0"><div><span>Долг</span><b class="red num">${fmt(s.debt)}</b></div><div><span>Доступно</span><b class="green num">${fmt(s.avail)}</b></div></div>
    <div style="margin:10px 0">${bar(s.debt, s.limit || 1, 'red')}<div class="dim" style="margin-top:4px">Лимит ${som(s.limit)}${s.next ? ` · платёж ${whenText(s.next.d)}${s.next.pay ? ', минимум ' + fmt(s.next.pay) : ''}` : ''}</div></div>
    ${s.debt > 0 ? `<button class="btn gold" data-a="loanPay" data-v="${L.id}">💸 Погасить кредитку</button>` : ''}
    ${ops.length ? `<h3 class="vh">Операции</h3><div class="card list">${ops.map(txRow).join('')}</div>` : ''}
    <button class="btn ghost" style="margin-top:10px" data-a="loanEdit" data-v="${L.id}">✏️ Изменить</button>`;
  }
  const rows = L.schedule || [];
  let cum = 0;
  return `${sheetHead('🏦 ' + esc(L.name))}
  <div class="split" style="margin-top:0"><div><span>Осталось выплатить</span><b class="num">${fmt(s.left)}</b></div><div><span>Уже выплачено</span><b class="green num">${fmt(s.paid)}</b></div></div>
  <div style="margin:10px 0">${bar(s.paid, s.total || 1, 'green')}<div class="dim" style="margin-top:4px">${L.principal ? `Взято ${som(L.principal)}` : ''}${L.rate ? ` · ${L.rate}% годовых` : ''}${s.count ? ` · платежей ${s.n} из ${s.count}` : L.term ? ` · ${L.term} мес.` : ''}${s.total && L.principal ? ` · переплата ${som(s.total - L.principal)}` : ''}</div></div>
  ${s.next ? `<div class="note" style="margin-bottom:10px">📅 Следующий платёж: <b>${fmt(s.next.pay)} сом</b> — ${whenText(s.next.d)}</div><button class="btn gold" data-a="loanPay" data-v="${L.id}">💸 Внести платёж</button>` : '<div class="note">✓ Кредит выплачен</div>'}
  ${rows.length ? `<h3 class="vh">График платежей</h3><div class="sched"><div class="sr sh"><span>Дата</span><span>Платёж</span><span>Долг</span><span>%</span><span>Остаток</span></div>${rows.map((r) => { cum += r.pay; const done = cum <= s.paid + 1; return `<div class="sr ${done ? 'done' : ''} ${s.next && r.d === s.next.d ? 'nx' : ''}"><span>${done ? '✓ ' : ''}${new Date(r.d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span><span>${fmt(r.pay)}</span><span>${fmt(r.princ)}</span><span>${fmt(r.int)}</span><span>${fmt(r.bal)}</span></div>`; }).join('')}</div>` : `<button class="btn ghost" style="margin-top:10px" data-a="lnScanFor" data-v="${L.id}">📄 Загрузить график (PDF или скрин)</button>`}
  <button class="btn ghost" style="margin-top:10px" data-a="loanEdit" data-v="${L.id}">✏️ Изменить</button>`;
}

/* ---- платёж ---- */
function payLoan(id) {
  const L = loanById(id); if (!L) return;
  const s = loanState(L);
  const from = S.accounts.find((a) => a.id === L.bankAcc && !a.credit) ? L.bankAcc : S.main;
  if (L.kind === 'card') {
    UI.money = { mode: 'tr', amount: String(Math.round(s.debt) || 0), acc: from, to: L.acc, cat: null, note: 'Погашение кредитки', day: 0 };
  } else {
    UI.money = { mode: 'exp', amount: String(Math.round((s.next && s.next.pay) || L.monthly || 0)), acc: from, to: null, cat: 'debt', note: L.name, day: 0, loan: L.id };
  }
  openSheet(renderMoneySheet);
}
// выбор кредита при «Погашение кредита»
function askPick(html, options) {
  return new Promise((res) => {
    const el = document.createElement('div'); el.className = 'askbox';
    el.innerHTML = `<div class="askcard"><div class="asktext">${html}</div><div class="card list" style="margin:0 0 12px">${options.map((o) => `<button class="item" data-pick="${o.id}"><span class="ii">${o.ic}</span><span class="grow"><div class="it">${esc(o.label)}</div>${o.sub ? `<div class="is">${esc(o.sub)}</div>` : ''}</span></button>`).join('')}</div><button class="btn ghost" data-r="0">Отмена</button></div>`;
    el.addEventListener('click', (e) => {
      const p = e.target.closest('[data-pick]'); const b = e.target.closest('[data-r]');
      if (!p && !b) return; el.remove(); res(p ? p.dataset.pick : null);
    });
    document.body.appendChild(el);
  });
}
async function pickLoanFor(tx) {
  const list = activeLoans(); if (!list.length) return 'none';
  const id = await askPick(`🏦 Что гасишь — <b>${fmt(tx.amount)} сом</b>?`, list.map((L) => {
    const s = loanState(L);
    return { id: L.id, ic: L.kind === 'card' ? '💳' : '🏦', label: L.name, sub: L.kind === 'card' ? `долг ${fmt(s.debt)}` : `осталось ${fmt(s.left)}${s.next ? ' · платёж ' + fmt(s.next.pay) : ''}` };
  }));
  return id;
}

/* ---- график из PDF/скрина через Gemini ---- */
const LOAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' }, bank: { type: 'STRING' }, principal: { type: 'NUMBER' }, rate: { type: 'NUMBER' }, term_months: { type: 'NUMBER' }, monthly_payment: { type: 'NUMBER' },
    schedule: { type: 'ARRAY', items: { type: 'OBJECT', properties: { date: { type: 'STRING' }, payment: { type: 'NUMBER' }, principal: { type: 'NUMBER' }, interest: { type: 'NUMBER' }, balance: { type: 'NUMBER' } }, required: ['date', 'payment'] } },
    comment: { type: 'STRING' },
  },
  required: ['schedule'],
};
async function scanLoan(files, forId) {
  aiLoading('Читаю график платежей…');
  try {
    const parts = [{ text: `Это график платежей по кредиту (Кыргызстан, валюта — сом). Извлеки: name — короткое название кредита (если есть, например «Потребительский кредит»); bank — банк; principal — сумма кредита; rate — ставка % годовых; term_months — срок в месяцах; monthly_payment — обычный ежемесячный платёж; schedule — ВСЕ строки графика: date (YYYY-MM-DD), payment (сумма платежа), principal (основной долг в платеже), interest (проценты), balance (остаток долга после платежа). Не выдумывай: чего нет в документе — не заполняй.` }];
    for (const f of files.slice(0, 8)) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) parts.push({ inline_data: { mime_type: 'application/pdf', data: await fileToB64(f) } });
      else parts.push({ inline_data: { mime_type: 'image/jpeg', data: await imageToB64(f, 1600) } });
    }
    const r = await aiCall(parts, LOAN_SCHEMA);
    const sch = (r.schedule || []).map((x) => ({ d: Date.parse(x.date + 'T12:00:00'), pay: Math.round(+x.payment || 0), princ: Math.round(+x.principal || 0), int: Math.round(+x.interest || 0), bal: Math.round(+x.balance || 0) })).filter((x) => x.d && x.pay > 0).sort((a, b) => a.d - b.d);
    if (!sch.length) throw new Error(r.comment || 'Не нашёл график в файле — попробуй скрин почётче');
    if (forId) { UI.ln = { ...loanById(forId), editId: forId }; }
    const x = UI.ln;
    x.schedule = sch;
    if (!x.name && r.name) x.name = r.name;
    if (!x.principal) x.principal = Math.round(+r.principal || (sch[0].bal + sch[0].princ) || 0);
    if (!x.rate && r.rate) x.rate = +r.rate;
    x.term = x.term || +r.term_months || sch.length;
    x.monthly = x.monthly || Math.round(+r.monthly_payment || sch[0].pay);
    x.payDay = x.payDay || new Date(sch[0].d).getDate();
    if (r.bank) { const a = S.accounts.find((ac) => !ac.credit && norm(r.bank).includes(norm(ac.name).split(' ')[0])); if (a) x.bankAcc = a.id; }
    openSheet(renderLoanForm);
    toast(`📄 Нашёл ${sch.length} платежей — проверь и сохрани`);
  } catch (e) {
    openSheet(() => `${sheetHead('📄 График')}<p class="red">⚠️ ${esc(e.message === 'NO_KEY' ? 'Сначала подключи Gemini' : aiErr(e.message))}</p><button class="btn ghost" data-a="lnBack">Назад</button>`);
  }
}

/* ---- напоминания на главной ---- */
function loanPrompts() {
  return activeLoans().map((L) => ({ L, s: loanState(L) })).filter(({ s }) => s.next && daysLeft(s.next.d) <= 3 && daysLeft(s.next.d) >= -10)
    .slice(0, 2).map(({ L, s }) => `<div class="card prompt"><div class="row"><span style="font-size:28px">${L.kind === 'card' ? '💳' : '🏦'}</span><div class="grow"><b>Платёж: ${esc(L.name)}</b><div class="dim">${s.next.pay ? fmt(s.next.pay) + ' сом · ' : ''}${whenText(s.next.d)}</div></div></div>
    <button class="btn gold" style="margin-top:10px" data-a="loanPay" data-v="${L.id}">💸 Оплатить и записать</button></div>`).join('');
}

Object.assign(A, {
  loanAdd: (el) => openLoanForm(el.dataset.v || 'loan'),
  loanOpen: (el) => openLoan(el.dataset.v),
  loanEdit: (el) => openLoanForm(null, el.dataset.v),
  loanPay: (el) => payLoan(el.dataset.v),
  lnKind: (el) => { readLoanForm(); UI.ln.kind = el.dataset.v; refreshSheet(); },
  lnBank: (el) => { readLoanForm(); UI.ln.bankAcc = el.dataset.v; refreshSheet(); },
  lnSave: saveLoan,
  lnBack: () => openSheet(renderLoanForm),
  lnScan: () => { readLoanForm(); if (!aiReady()) { openAiSetup(); return; } pickFiles('application/pdf,image/*', true, (fs) => scanLoan(fs)); },
  lnScanFor: (el) => { if (!aiReady()) { openAiSetup(); return; } const id = el.dataset.v; pickFiles('application/pdf,image/*', true, (fs) => scanLoan(fs, id)); },
  lnClose: async () => {
    const L = loanById(UI.ln.editId); if (!L) return;
    const hasOps = S.tx.some((t) => t.loan === L.id || (L.acc && (t.acc === L.acc || t.to === L.acc)));
    if (!(await ask(hasOps ? `Закрыть «${esc(L.name)}»? Он пропадёт из списка, история платежей останется.` : `Удалить «${esc(L.name)}»?`, hasOps ? 'Закрыть' : 'Удалить', 'Отмена'))) return;
    closeSheet();
    act(() => {
      if (hasOps) { L.closed = Date.now(); }
      else { S.loans = S.loans.filter((x) => x.id !== L.id); if (L.acc) { S.accounts = S.accounts.filter((a) => a.id !== L.acc); if (S.main === L.acc) S.main = S.accounts[0] && S.accounts[0].id; } }
    }, hasOps ? 'Закрыто' : 'Удалено');
  },
});
