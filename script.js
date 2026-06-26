/* ============================== DATA / STATE ============================== */
const PALETTE = ["#2BC4A8","#E8B94B","#FF7A59","#5B8DEF","#9B8AFB","#54C7E8","#D9C18B","#7FD9A4","#F2A6C9","#C2C2F0"];
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const PRESETS = {
  arquiteto: { label:"Arquiteto(a) / Projetista", income:["Projetos","Comissão","Acompanhamento de Projeto"], expense:["Aluguel do Escritório","Materiais e Impressões","Transporte","Marketing","Impostos","Outros"] },
  carros:    { label:"Vendedor(a) de Carros", income:["Venda de Carros","Comissão","Outros"], expense:["Combustível","Documentação","Marketing","Comissão de Terceiros","Impostos","Outros"] },
  generico:  { label:"Genérico / Outro negócio", income:["Vendas","Serviços","Outros"], expense:["Aluguel","Fornecedores","Transporte","Marketing","Impostos","Outros"] }
};

const now = new Date();
let state = {
  ready:false,
  profileName:"Meu Negócio",
  categories:{ income:[], expense:[] },
  transactions:[],
  goals:{},
  selYear: now.getFullYear(),
  selMonth: now.getMonth()
};
let charts = { expense:null, income:null, trend:null };
let txModalType = 'income';
let txEditingId = null;
let saveTimer = null;

/* ============================== HELPERS ============================== */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function fmtBRL(n){ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n||0); }
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function makeCategories(names){ return names.map((n,i) => ({ id: uid(), name: n, color: PALETTE[i % PALETTE.length] })); }
function nextPaletteColor(type){
  const used = state.categories[type].length;
  return PALETTE[used % PALETTE.length];
}
function addMonths(dateStr, n){
  const [y,m,d] = dateStr.split('-').map(Number);
  let totalMonth = (m - 1) + n;
  let ty = y + Math.floor(totalMonth / 12);
  let tm = ((totalMonth % 12) + 12) % 12;
  const lastDay = new Date(ty, tm + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  return ty + '-' + String(tm + 1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
}
function txInMonth(y, m){
  return state.transactions.filter(t => {
    const [ty, tm] = t.date.split('-').map(Number);
    return ty === y && (tm - 1) === m;
  });
}
function catById(type, id){ return state.categories[type].find(c => c.id === id); }

/* ============================== STORAGE ADAPTER ============================== */
/* Dentro do Claude.ai usa window.storage; fora (VSCode, hospedado, etc.) usa localStorage do navegador. */
const storage = (window.storage) ? window.storage : {
  async get(key){
    const v = localStorage.getItem('fluxo:' + key);
    if (v === null) throw new Error('not found');
    return { key, value: v };
  },
  async set(key, value){
    localStorage.setItem('fluxo:' + key, value);
    return { key, value };
  },
  async delete(key){
    localStorage.removeItem('fluxo:' + key);
    return { key, deleted: true };
  }
};

/* ============================== STORAGE ============================== */
async function loadAll(){
  let cfg = null, tx = [], goals = {};
  try { const r = await storage.get('config'); if (r && r.value) cfg = JSON.parse(r.value); } catch(e) {}
  try { const r = await storage.get('transactions'); if (r && r.value) tx = JSON.parse(r.value); } catch(e) {}
  try { const r = await storage.get('goals'); if (r && r.value) goals = JSON.parse(r.value); } catch(e) {}
  state.transactions = Array.isArray(tx) ? tx : [];
  state.goals = goals || {};
  if (cfg && cfg.categories && (cfg.categories.income.length || cfg.categories.expense.length)) {
    state.profileName = cfg.profileName || "Meu Negócio";
    state.categories = cfg.categories;
    state.ready = true;
    renderApp();
  } else {
    renderPresetPicker();
  }
}
async function saveConfig(){
  try { await storage.set('config', JSON.stringify({ profileName: state.profileName, categories: state.categories }), false); }
  catch(e) { console.error('Erro ao salvar configuração', e); }
}
async function saveTransactions(){
  try { await storage.set('transactions', JSON.stringify(state.transactions), false); }
  catch(e) { console.error('Erro ao salvar lançamentos', e); }
}
async function saveGoals(){
  try { await storage.set('goals', JSON.stringify(state.goals), false); }
  catch(e) { console.error('Erro ao salvar metas', e); }
}
function debouncedSaveConfig(){ clearTimeout(saveTimer); saveTimer = setTimeout(saveConfig, 500); }

/* ============================== PRESET PICKER (first run) ============================== */
function renderPresetPicker(){
  const opts = Object.keys(PRESETS).map(key => {
    const p = PRESETS[key];
    return `<button class="preset-opt" data-action="choose-preset" data-preset="${key}">
      <b>${escapeHtml(p.label)}</b>
      <span>Entradas: ${p.income.join(', ')}</span>
    </button>`;
  }).join('');
  document.getElementById('app').innerHTML = `
    <div class="center-screen">
      <div class="card preset-card">
        <div class="brand">Flu<span>xo</span></div>
        <p class="muted" style="margin-top:10px;font-size:13.5px;line-height:1.6;">
          Antes de começar, me diga qual modelo de entradas se parece mais com o seu negócio.
          Você pode renomear, criar ou remover categorias depois, em Configurações.
        </p>
        <div class="preset-grid">${opts}</div>
      </div>
    </div>`;
}
function choosePreset(key){
  const p = PRESETS[key];
  state.categories.income = makeCategories(p.income);
  state.categories.expense = makeCategories(p.expense);
  if (key !== 'generico') state.profileName = p.label;
  state.ready = true;
  saveConfig();
  renderApp();
}

/* ============================== COMPUTATION ============================== */
function computeMonth(y, m){
  const monthTx = txInMonth(y, m);
  const incomeTx = monthTx.filter(t => t.type === 'income');
  const expenseTx = monthTx.filter(t => t.type === 'expense');
  const totalIncome = incomeTx.reduce((s,t) => s + t.amount, 0);
  const totalExpense = expenseTx.reduce((s,t) => s + t.amount, 0);
  const incomeByCat = state.categories.income.map(c => ({ ...c, total: incomeTx.filter(t => t.categoryId === c.id).reduce((s,t) => s + t.amount, 0) }));
  const expenseByCat = state.categories.expense.map(c => ({ ...c, total: expenseTx.filter(t => t.categoryId === c.id).reduce((s,t) => s + t.amount, 0) }));
  return { monthTx, incomeTx, expenseTx, totalIncome, totalExpense, saldo: totalIncome - totalExpense, incomeByCat, expenseByCat };
}
function buildInsight(cur, y, m){
  let py = y, pm = m - 1; if (pm < 0) { pm = 11; py--; }
  const prev = computeMonth(py, pm);
  if (cur.totalIncome === 0 && cur.totalExpense === 0) {
    return "👋 Comece registrando as entradas e despesas deste mês para ver seus números aqui.";
  }
  let biggest = null;
  cur.expenseByCat.forEach(c => {
    const prevC = prev.expenseByCat.find(p => p.id === c.id);
    if (prevC && prevC.total > 0 && c.total > prevC.total) {
      const pct = ((c.total - prevC.total) / prevC.total) * 100;
      if (pct > 15 && (!biggest || pct > biggest.pct)) biggest = { name: c.name, pct: Math.round(pct) };
    }
  });
  if (biggest) {
    return `💡 Seus gastos com <b>${escapeHtml(biggest.name)}</b> subiram <b>${biggest.pct}%</b> em relação a ${MONTHS[pm]}.`;
  }
  if (cur.saldo < 0) {
    return `⚠️ As despesas superaram as entradas em <b>${fmtBRL(Math.abs(cur.saldo))}</b> este mês.`;
  }
  if (prev.saldo !== 0 && cur.saldo > prev.saldo) {
    return `✅ Você guardou <b>${fmtBRL(cur.saldo)}</b> este mês — ${fmtBRL(cur.saldo - prev.saldo)} a mais que em ${MONTHS[pm]}.`;
  }
  return `✅ Você guardou <b>${fmtBRL(cur.saldo)}</b> este mês. Considere reservar uma parte como sua reserva de emergência.`;
}
function trendData(y, m){
  const labels = [], saldos = [];
  for (let i = 5; i >= 0; i--) {
    let mm = m - i, yy = y;
    while (mm < 0) { mm += 12; yy--; }
    const c = computeMonth(yy, mm);
    labels.push(MONTHS_SHORT[mm]);
    saldos.push(Math.round(c.saldo * 100) / 100);
  }
  return { labels, saldos };
}

/* ============================== RENDER: DASHBOARD ============================== */
function renderApp(){
  const y = state.selYear, m = state.selMonth;
  const cur = computeMonth(y, m);

  const flowSegs = cur.incomeByCat.filter(c => c.total > 0);
  const flowHtml = cur.totalIncome > 0
    ? `<div class="flow-strip">${flowSegs.map(c => `<div class="flow-seg" style="width:${(c.total/cur.totalIncome*100).toFixed(2)}%;background:${c.color}" title="${escapeHtml(c.name)}: ${fmtBRL(c.total)}"></div>`).join('')}</div>`
    : `<div class="flow-empty">Nenhuma entrada registrada em ${MONTHS[m]}</div>`;

  const chipHtml = cur.incomeByCat.map(c => `
    <div class="chip"><span class="dot" style="background:${c.color}"></span>${escapeHtml(c.name)} <span class="amt">${fmtBRL(c.total)}</span></div>
  `).join('');

  const saldoColor = cur.saldo >= 0 ? 'var(--gold)' : 'var(--danger)';

  const expCats = cur.expenseByCat.filter(c => c.total > 0);
  const incCats = cur.incomeByCat.filter(c => c.total > 0);

  const expenseChartHtml = expCats.length ? `
    <div class="donut-wrap">
      <canvas id="chart-expense"></canvas>
      <div class="donut-center"><div class="v">${fmtBRL(cur.totalExpense)}</div><div class="l">total saídas</div></div>
    </div>
    <div class="legend">${expCats.map(c => `<div class="legend-row"><span class="name"><span class="dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</span><span class="mono">${fmtBRL(c.total)}<span class="pct">${Math.round(c.total/cur.totalExpense*100)}%</span></span></div>`).join('')}</div>
  ` : `<div class="chart-empty">Sem despesas registradas<br>em ${MONTHS[m]}</div>`;

  const incomeChartHtml = incCats.length ? `
    <div class="donut-wrap">
      <canvas id="chart-income"></canvas>
      <div class="donut-center"><div class="v">${fmtBRL(cur.totalIncome)}</div><div class="l">total entradas</div></div>
    </div>
    <div class="legend">${incCats.map(c => `<div class="legend-row"><span class="name"><span class="dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</span><span class="mono">${fmtBRL(c.total)}<span class="pct">${Math.round(c.total/cur.totalIncome*100)}%</span></span></div>`).join('')}</div>
  ` : `<div class="chart-empty">Sem entradas registradas<br>em ${MONTHS[m]}</div>`;

  const goalEntries = Object.keys(state.goals).filter(id => catById('expense', id));
  const goalsHtml = goalEntries.length ? goalEntries.map(id => {
    const c = catById('expense', id);
    const goal = state.goals[id];
    const spent = (cur.expenseByCat.find(e => e.id === id) || {total:0}).total;
    const pct = goal > 0 ? Math.round(spent / goal * 100) : 0;
    const barColor = pct > 100 ? 'var(--danger)' : (pct >= 80 ? 'var(--gold)' : 'var(--income)');
    return `<div class="goal-row">
      <div class="top">
        <span class="name"><span class="dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</span>
        <span class="nums">${fmtBRL(spent)} / ${fmtBRL(goal)} <button class="goal-remove" data-action="remove-goal" data-id="${id}" title="Remover meta">✕</button></span>
      </div>
      <div class="bar-bg"><div class="bar-fill" style="width:${Math.min(pct,100)}%;background:${barColor}"></div></div>
    </div>`;
  }).join('') : `<div class="empty" style="padding:14px 0;">Defina um limite mensal para alguma categoria de despesa e acompanhe aqui.</div>`;

  const sortedTx = cur.monthTx.slice().sort((a,b) => b.date.localeCompare(a.date));
  const ledgerHtml = sortedTx.length ? sortedTx.map(t => {
    const c = catById(t.type, t.categoryId);
    const [yy,mm,dd] = t.date.split('-');
    return `<div class="ledger-row">
      <div class="date">${dd}/${mm}</div>
      <div>
        <div class="cat-name"><span class="dot" style="background:${c ? c.color : '#666'}"></span>${c ? escapeHtml(c.name) : '—'}</div>
        ${t.description ? `<div class="desc">${escapeHtml(t.description)}</div>` : ''}
      </div>
      <div class="${t.type==='income'?'amt-in':'amt-out'}">${t.type==='income'?'+':'−'} ${fmtBRL(t.amount)}</div>
      <div class="row-actions">
        <button class="icon-btn" data-action="edit-tx" data-id="${t.id}" title="Editar">✎</button>
        <button class="icon-btn" data-action="delete-tx" data-id="${t.id}" title="Excluir">🗑</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty">Nenhum lançamento em ${MONTHS[m]} ainda.<br><br><button class="btn btn-primary" data-action="add-tx">+ Adicionar o primeiro</button></div>`;

  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="brand">Flu<span>xo</span><small>${escapeHtml(state.profileName)}</small></div>
      <div class="topbar-actions">
        <div class="month-nav">
          <button data-action="prev-month" aria-label="Mês anterior">‹</button>
          <span class="label">${MONTHS[m]} ${y}</span>
          <button data-action="next-month" aria-label="Próximo mês">›</button>
        </div>
        <button class="icon-btn" data-action="open-settings" title="Configurações" style="font-size:17px;">⚙</button>
      </div>
    </header>

    <div class="hero">
      <div class="card flow-card">
        <h3>Entradas de ${MONTHS[m]}</h3>
        ${flowHtml}
        <div class="chip-row">${chipHtml || '<span class="muted" style="font-size:12.5px;">Nenhuma categoria de entrada configurada.</span>'}</div>
      </div>
      <div class="card saldo-card">
        <label>Faturamento líquido do mês</label>
        <div class="big" style="color:${saldoColor}">${fmtBRL(cur.saldo)}</div>
        <div class="sub">Entradas ${fmtBRL(cur.totalIncome)}<br>Despesas ${fmtBRL(cur.totalExpense)}</div>
      </div>
    </div>

    <div class="insight"><div>${buildInsight(cur, y, m)}</div></div>

    <div class="charts-grid">
      <div class="card chart-card">
        <h3>Despesas por categoria</h3>
        ${expenseChartHtml}
      </div>
      <div class="card chart-card">
        <h3>Entradas por categoria</h3>
        ${incomeChartHtml}
      </div>
    </div>

    <div class="card trend-card" style="margin-bottom:16px;">
      <h3 style="font-size:14px;color:var(--text-muted);font-weight:700;margin-bottom:14px;">Evolução do saldo — últimos 6 meses</h3>
      <canvas id="chart-trend" height="70"></canvas>
    </div>

    <div class="card goals-card" style="margin-bottom:16px;">
      <div class="gh"><h3>Metas de gastos</h3><button class="btn btn-ghost" data-action="add-goal" style="font-size:12.5px;">+ Definir meta</button></div>
      ${goalsHtml}
    </div>

    <div class="card ledger-card">
      <div class="lh">
        <h3>Lançamentos de ${MONTHS[m]}</h3>
        <div class="ledger-actions">
          <button class="btn btn-ghost" data-action="export-csv" style="font-size:12.5px;">⬇ Exportar CSV</button>
          <button class="btn btn-primary" data-action="add-tx" style="font-size:12.5px;">+ Novo lançamento</button>
        </div>
      </div>
      ${ledgerHtml}
    </div>

    <div class="footnote">Seus dados são salvos automaticamente, de forma privada para você.</div>
  `;

  renderCharts(cur, expCats, incCats, y, m);
}

/* ============================== CHARTS ============================== */
function renderCharts(cur, expCats, incCats, y, m){
  if (charts.expense) { charts.expense.destroy(); charts.expense = null; }
  if (charts.income) { charts.income.destroy(); charts.income = null; }
  if (charts.trend) { charts.trend.destroy(); charts.trend = null; }

  const baseDonutOpts = {
    cutout:'70%',
    plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx) => ' ' + ctx.label + ': ' + fmtBRL(ctx.parsed) } } },
    animation:{ duration:500 },
    maintainAspectRatio:false
  };

  const elExp = document.getElementById('chart-expense');
  if (elExp && expCats.length) {
    charts.expense = new Chart(elExp, {
      type:'doughnut',
      data:{ labels: expCats.map(c=>c.name), datasets:[{ data: expCats.map(c=>c.total), backgroundColor: expCats.map(c=>c.color), borderWidth:0, hoverOffset:6 }] },
      options: baseDonutOpts
    });
  }
  const elInc = document.getElementById('chart-income');
  if (elInc && incCats.length) {
    charts.income = new Chart(elInc, {
      type:'doughnut',
      data:{ labels: incCats.map(c=>c.name), datasets:[{ data: incCats.map(c=>c.total), backgroundColor: incCats.map(c=>c.color), borderWidth:0, hoverOffset:6 }] },
      options: baseDonutOpts
    });
  }

  const elTrend = document.getElementById('chart-trend');
  if (elTrend) {
    const t = trendData(y, m);
    charts.trend = new Chart(elTrend, {
      type:'bar',
      data:{ labels: t.labels, datasets:[{ data: t.saldos, backgroundColor: t.saldos.map(v => v >= 0 ? '#E8B94B' : '#FF5468'), borderRadius:6, maxBarThickness:36 }] },
      options:{
        maintainAspectRatio:false,
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx) => ' Saldo: ' + fmtBRL(ctx.parsed.y) } } },
        scales:{
          y:{ grid:{ color:'rgba(255,255,255,.06)' }, ticks:{ color:'#8FA3A3', font:{ size:10 }, callback:(v)=>fmtBRL(v) } },
          x:{ grid:{ display:false }, ticks:{ color:'#8FA3A3', font:{ size:11 } } }
        }
      }
    });
  }
}

/* ============================== TRANSACTION MODAL ============================== */
function categoryOptions(type){
  const list = state.categories[type];
  if (!list.length) return `<option value="">Nenhuma categoria — crie em Configurações</option>`;
  return list.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}
function openTxModal(id){
  txEditingId = id || null;
  const editing = id ? state.transactions.find(t => t.id === id) : null;
  txModalType = editing ? editing.type : 'income';

  const html = `
    <h3>${editing ? 'Editar lançamento' : 'Novo lançamento'}</h3>
    <div class="seg-toggle">
      <button data-action="tx-type" data-type="income" class="${txModalType==='income'?'active':''}">Entrada</button>
      <button data-action="tx-type" data-type="expense" class="${txModalType==='expense'?'active':''}">Despesa</button>
    </div>
    <div class="field"><label>Categoria</label><select id="tx-category">${categoryOptions(txModalType)}</select></div>
    <div class="field"><label>Valor (R$)</label><input id="tx-amount" type="number" min="0.01" step="0.01" placeholder="0,00" value="${editing ? editing.amount : ''}"></div>
    <div class="field"><label>Data</label><input id="tx-date" type="date" value="${editing ? editing.date : todayStr()}"></div>
    <div class="field"><label>Descrição (opcional)</label><input id="tx-desc" type="text" placeholder="Ex: Projeto Casa Verde" value="${editing ? escapeHtml(editing.description||'') : ''}"></div>
    ${!editing ? `
    <div class="recurring-row"><input type="checkbox" id="tx-recurring"><label style="margin:0;text-transform:none;letter-spacing:0;font-weight:500;color:var(--text);" for="tx-recurring">Repetir nos próximos meses</label></div>
    <div class="field" id="tx-recurring-months-wrap" style="display:none;"><label>Repetir por quantos meses (incluindo este)</label><input id="tx-recurring-months" type="number" min="2" max="24" value="3"></div>
    ` : ''}
    <div class="tx-error" id="tx-error"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-action="close-modal">Cancelar</button>
      <button class="btn btn-primary" data-action="save-tx">Salvar</button>
    </div>
  `;
  openModal(html);
  if (editing) document.getElementById('tx-category').value = editing.categoryId;
}
function saveTxFromModal(){
  const categoryId = document.getElementById('tx-category').value;
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const date = document.getElementById('tx-date').value;
  const description = document.getElementById('tx-desc').value.trim();
  const err = document.getElementById('tx-error');

  if (!categoryId) { err.textContent = 'Escolha uma categoria.'; return; }
  if (!amount || amount <= 0) { err.textContent = 'Informe um valor válido maior que zero.'; return; }
  if (!date) { err.textContent = 'Escolha uma data.'; return; }

  if (txEditingId) {
    const t = state.transactions.find(x => x.id === txEditingId);
    Object.assign(t, { type: txModalType, categoryId, amount, date, description });
  } else {
    const recurring = document.getElementById('tx-recurring') && document.getElementById('tx-recurring').checked;
    const months = recurring ? Math.max(2, Math.min(24, parseInt(document.getElementById('tx-recurring-months').value) || 2)) : 1;
    for (let i = 0; i < months; i++) {
      state.transactions.push({ id: uid(), type: txModalType, categoryId, amount, date: i === 0 ? date : addMonths(date, i), description });
    }
  }
  saveTransactions();
  closeModal();
  renderApp();
}
function deleteTx(id){
  if (!confirm('Excluir este lançamento?')) return;
  state.transactions = state.transactions.filter(t => t.id !== id);
  saveTransactions();
  renderApp();
}

/* ============================== GOAL MODAL ============================== */
function openGoalModal(){
  const list = state.categories.expense;
  if (!list.length) { alert('Crie uma categoria de despesa primeiro, em Configurações.'); return; }
  const html = `
    <h3>Definir meta de gasto mensal</h3>
    <div class="field"><label>Categoria de despesa</label>
      <select id="goal-category">${list.map(c => `<option value="${c.id}" ${state.goals[c.id]?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Limite mensal (R$)</label><input id="goal-amount" type="number" min="1" step="0.01" placeholder="0,00"></div>
    <div class="tx-error" id="goal-error"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-action="close-modal">Cancelar</button>
      <button class="btn btn-primary" data-action="save-goal">Salvar meta</button>
    </div>
  `;
  openModal(html);
}
function saveGoalFromModal(){
  const id = document.getElementById('goal-category').value;
  const amount = parseFloat(document.getElementById('goal-amount').value);
  if (!amount || amount <= 0) { document.getElementById('goal-error').textContent = 'Informe um valor válido.'; return; }
  state.goals[id] = amount;
  saveGoals();
  closeModal();
  renderApp();
}
function removeGoal(id){
  delete state.goals[id];
  saveGoals();
  renderApp();
}

/* ============================== SETTINGS MODAL ============================== */
function categoryEditRows(type){
  return state.categories[type].map(c => `
    <div class="cat-edit-row">
      <button class="swatch" style="background:${c.color}" data-action="cycle-color" data-type="${type}" data-id="${c.id}" title="Trocar cor"></button>
      <input type="text" value="${escapeHtml(c.name)}" data-action-input="rename-cat" data-type="${type}" data-id="${c.id}">
      <button class="icon-btn" data-action="delete-cat" data-type="${type}" data-id="${c.id}" title="Excluir">🗑</button>
    </div>
  `).join('');
}
function openSettingsModal(){
  const presetButtons = Object.keys(PRESETS).map(k => `<button class="btn preset-mini" data-action="apply-preset" data-preset="${k}">${escapeHtml(PRESETS[k].label)}</button>`).join('');
  const html = `
    <h3>Configurações</h3>
    <div class="field"><label>Nome do negócio / perfil</label><input id="profile-name" type="text" value="${escapeHtml(state.profileName)}"></div>

    <div class="section-title">Aplicar modelo pronto</div>
    <div class="preset-mini-row">${presetButtons}</div>
    <div class="muted" style="font-size:11.5px;margin-bottom:4px;">Isso substitui as categorias atuais (os lançamentos continuam salvos).</div>

    <div class="section-title">Categorias de entrada</div>
    <div id="income-cat-list">${categoryEditRows('income')}</div>
    <div class="add-cat-row"><input type="text" id="new-income-cat-name" placeholder="Nova categoria de entrada"><button class="btn" data-action="add-cat" data-type="income">+ Adicionar</button></div>

    <div class="section-title">Categorias de despesa</div>
    <div id="expense-cat-list">${categoryEditRows('expense')}</div>
    <div class="add-cat-row"><input type="text" id="new-expense-cat-name" placeholder="Nova categoria de despesa"><button class="btn" data-action="add-cat" data-type="expense">+ Adicionar</button></div>

    <div class="divider"></div>
    <div class="section-title">Dados</div>
    <div class="danger-zone">
      <button class="btn" data-action="export-csv">⬇ Exportar tudo em CSV</button>
      <button class="btn btn-danger" data-action="reset-data">Apagar todos os dados</button>
    </div>

    <div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Concluído</button></div>
  `;
  openModal(html, true);
}
function addCategory(type){
  const inputId = type === 'income' ? 'new-income-cat-name' : 'new-expense-cat-name';
  const input = document.getElementById(inputId);
  const name = input.value.trim();
  if (!name) return;
  state.categories[type].push({ id: uid(), name, color: nextPaletteColor(type) });
  saveConfig();
  openSettingsModal();
}
function deleteCategory(type, id){
  const inUse = state.transactions.some(t => t.type === type && t.categoryId === id);
  if (inUse) { alert('Essa categoria tem lançamentos associados e não pode ser excluída. Edite ou remova os lançamentos primeiro.'); return; }
  state.categories[type] = state.categories[type].filter(c => c.id !== id);
  if (type === 'expense') delete state.goals[id];
  saveConfig();
  saveGoals();
  openSettingsModal();
}
function cycleColor(type, id, btnEl){
  const cat = catById(type, id);
  const idx = PALETTE.indexOf(cat.color);
  cat.color = PALETTE[(idx + 1) % PALETTE.length];
  btnEl.style.background = cat.color;
  debouncedSaveConfig();
}
function applyPreset(key){
  if (!confirm('Isso vai substituir suas categorias atuais. Os lançamentos existentes continuam salvos, mas podem ficar sem categoria correspondente. Continuar?')) return;
  const p = PRESETS[key];
  state.categories.income = makeCategories(p.income);
  state.categories.expense = makeCategories(p.expense);
  state.goals = {};
  saveConfig();
  saveGoals();
  closeModal();
  renderApp();
}
function resetAllData(){
  if (!confirm('Isso vai apagar TODOS os seus lançamentos, categorias e metas. Essa ação não pode ser desfeita. Tem certeza?')) return;
  storage.delete('config').catch(()=>{});
  storage.delete('transactions').catch(()=>{});
  storage.delete('goals').catch(()=>{});
  state.transactions = [];
  state.goals = {};
  state.categories = { income:[], expense:[] };
  state.ready = false;
  closeModal();
  renderPresetPicker();
}

/* ============================== CSV EXPORT ============================== */
function exportCSV(){
  const rows = [['Data','Tipo','Categoria','Descrição','Valor']];
  state.transactions.slice().sort((a,b) => a.date.localeCompare(b.date)).forEach(t => {
    const c = catById(t.type, t.categoryId);
    rows.push([
      t.date.split('-').reverse().join('/'),
      t.type === 'income' ? 'Entrada' : 'Despesa',
      c ? c.name : '—',
      t.description || '',
      t.amount.toFixed(2).replace('.', ',')
    ]);
  });
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(';')).join('\r\n');
  const blob = new Blob(["﻿" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fluxo-financeiro.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================== MODAL GENERIC ============================== */
function openModal(html, wide){
  closeModal();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.id = 'overlay';
  ov.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  const firstInput = ov.querySelector('input[type=text], input[type=number], select');
  if (firstInput) firstInput.focus();
}
function closeModal(){
  const ov = document.getElementById('overlay');
  if (ov) ov.remove();
  txEditingId = null;
}

/* ============================== MONTH NAV ============================== */
function changeMonth(delta){
  let m = state.selMonth + delta, y = state.selYear;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  state.selMonth = m; state.selYear = y;
  renderApp();
}

/* ============================== GLOBAL EVENT DELEGATION ============================== */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'choose-preset') choosePreset(el.dataset.preset);
  else if (a === 'prev-month') changeMonth(-1);
  else if (a === 'next-month') changeMonth(1);
  else if (a === 'open-settings') openSettingsModal();
  else if (a === 'close-modal') closeModal();
  else if (a === 'add-tx') openTxModal(null);
  else if (a === 'edit-tx') openTxModal(el.dataset.id);
  else if (a === 'delete-tx') deleteTx(el.dataset.id);
  else if (a === 'save-tx') saveTxFromModal();
  else if (a === 'tx-type') {
    txModalType = el.dataset.type;
    document.querySelectorAll('[data-action="tx-type"]').forEach(b => b.classList.toggle('active', b.dataset.type === txModalType));
    document.getElementById('tx-category').innerHTML = categoryOptions(txModalType);
  }
  else if (a === 'add-goal') openGoalModal();
  else if (a === 'save-goal') saveGoalFromModal();
  else if (a === 'remove-goal') removeGoal(el.dataset.id);
  else if (a === 'export-csv') exportCSV();
  else if (a === 'apply-preset') applyPreset(el.dataset.preset);
  else if (a === 'add-cat') addCategory(el.dataset.type);
  else if (a === 'delete-cat') deleteCategory(el.dataset.type, el.dataset.id);
  else if (a === 'cycle-color') cycleColor(el.dataset.type, el.dataset.id, el);
  else if (a === 'reset-data') resetAllData();
});
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'tx-recurring') {
    document.getElementById('tx-recurring-months-wrap').style.display = e.target.checked ? 'block' : 'none';
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'profile-name') { state.profileName = t.value; debouncedSaveConfig(); }
  else if (t.dataset && t.dataset.actionInput === 'rename-cat') {
    const cat = catById(t.dataset.type, t.dataset.id);
    if (cat) { cat.name = t.value; debouncedSaveConfig(); }
  }
});

/* ============================== INIT ============================== */
loadAll();
