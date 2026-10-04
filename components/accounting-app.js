'use client';

import { useEffect, useMemo, useState } from 'react';
import { accounts, initialHours, initialMovements, initialReceivables } from '../lib/seed';
import ExcelTools from './excel-tools';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat('es-AR');

function formatDate(value) {
  if (!value) return '-';
  const [y, m, d] = value.split('-').map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
}

function loadStored(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function isLegacyDemoMovements(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.every(
    (row) => String(row?.notes || '').toLowerCase().includes('dato demostrativo')
  );
}

function isLegacyDemoHours(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.every(
    (row) => String(row?.notes || '').toLowerCase().includes('jornada demostrativa')
  );
}

const nav = [
  ['book', 'Libro de contabilidad'],
  ['balance', 'Saldo'],
  ['expenses', 'Gastos'],
  ['hours', 'Horas'],
];

const icons = {
  book: '▤',
  balance: '◈',
  expenses: '▣',
  hours: '◷',
};

export default function AccountingApp() {
  const [section, setSection] = useState('book');
  const [movements, setMovements] = useState(initialMovements);
  const [hours, setHours] = useState(initialHours);
  const [receivables] = useState(initialReceivables);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [account, setAccount] = useState('TODAS');
  const [modal, setModal] = useState(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const storedMovements = loadStored('puente.movements', initialMovements);
    const storedHours = loadStored('puente.hours', initialHours);
    setMovements(isLegacyDemoMovements(storedMovements) ? [] : storedMovements);
    setHours(isLegacyDemoHours(storedHours) ? [] : storedHours);
    setDark(loadStored('puente.dark', false));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem('puente.movements', JSON.stringify(movements));
  }, [movements, ready]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem('puente.hours', JSON.stringify(hours));
  }, [hours, ready]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem('puente.dark', JSON.stringify(dark));
  }, [dark, ready]);

  const totals = useMemo(() => {
    const income = movements.reduce((s, x) => s + Number(x.income || 0), 0);
    const expense = movements.reduce((s, x) => s + Number(x.expense || 0), 0);
    return { income, expense, balance: income - expense };
  }, [movements]);

  const availableAccounts = useMemo(() => (
    [...new Set([...accounts, ...movements.map((m) => m.account).filter(Boolean)])]
      .sort((a, b) => a.localeCompare(b))
  ), [movements]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movements
      .filter(x => account === 'TODAS' || x.account === account)
      .filter(x => !q || [x.detail, x.concept, x.folder, x.operation, x.invoice, x.account]
        .some(v => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [movements, query, account]);

  const expenses = useMemo(
    () => filtered.filter(x => Number(x.expense || 0) > 0),
    [filtered]
  );

  const accountBalances = useMemo(() => {
    const map = {};
    accounts.forEach(a => map[a] = 0);
    movements.forEach(m => {
      map[m.account] = (map[m.account] || 0) + Number(m.income || 0) - Number(m.expense || 0);
    });
    return Object.entries(map).filter(([, value]) => value !== 0);
  }, [movements]);

  const categoryExpenses = useMemo(() => {
    const map = {};
    movements.forEach(m => {
      if (Number(m.expense || 0) > 0) {
        const key = m.concept || 'Sin categoría';
        map[key] = (map[key] || 0) + Number(m.expense);
      }
    });
    return Object.entries(map).sort((a,b) => b[1] - a[1]).slice(0,6);
  }, [movements]);

  function saveMovement(data) {
    setMovements(prev => [{ id: crypto.randomUUID(), ...data }, ...prev]);
    setModal(null);
  }

  function saveHours(data) {
    setHours(prev => [{ id: crypto.randomUUID(), ...data }, ...prev]);
    setModal(null);
  }

  function removeMovement(id) {
    if (confirm('¿Eliminar este movimiento?')) {
      setMovements(prev => prev.filter(x => x.id !== id));
    }
  }

  function removeHour(id) {
    if (confirm('¿Eliminar este registro de horas?')) {
      setHours(prev => prev.filter(x => x.id !== id));
    }
  }

  return (
    <div className={dark ? 'app dark' : 'app'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div><strong>Proyecto Puente</strong><span>Contabilidad</span></div>
        </div>
        <nav>
          {nav.map(([id, label]) => (
            <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>
              <span className="nav-icon">{icons[id]}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setDark(v => !v)}>{dark ? '☀' : '◐'} {dark ? 'Tema claro' : 'Tema oscuro'}</button>
          <small>Proyecto Puente · v0.1</small>
        </div>
      </aside>

      <main>
        {section === 'book' && (
          <>
            <Header title="Libro de contabilidad" subtitle="Resumen y administración de todos los movimientos del proyecto." action="Nuevo movimiento" onAction={() => setModal('movement')} />
            <Kpis totals={totals} count={movements.length} />
            <ExcelTools movements={movements} onImport={setMovements} />
            <Filters query={query} setQuery={setQuery} account={account} setAccount={setAccount} options={availableAccounts} />
            <Card>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Fecha</th><th>Cuenta</th><th>Carpeta</th><th>Concepto</th><th>Detalle</th><th>Operación</th><th>Entrada</th><th>Salida</th><th>Factura</th><th></th></tr></thead>
                  <tbody>
                    {filtered.map(m => (
                      <tr key={m.id}>
                        <td>{formatDate(m.date)}</td>
                        <td><span className="pill blue">{m.account}</span></td>
                        <td>{m.folder}</td><td>{m.concept}</td><td>{m.detail}</td><td>{m.operation || '-'}</td>
                        <td className="income">{m.income ? money.format(m.income) : '-'}</td>
                        <td className="expense">{m.expense ? money.format(m.expense) : '-'}</td>
                        <td>{m.invoice || '-'}</td>
                        <td><button className="icon-btn danger" onClick={() => removeMovement(m.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {section === 'balance' && (
          <>
            <Header title="Saldo" subtitle="Posición consolidada y saldos por cuenta." />
            <section className="hero-balance">
              <div><span>Saldo contable actual</span><strong>{money.format(totals.balance)}</strong><small>Ingresos menos egresos registrados</small></div>
              <div className="hero-icon">▰</div>
            </section>
            <div className="grid-3">
              <Metric label="Ingresos acumulados" value={money.format(totals.income)} tone="green" />
              <Metric label="Gastos acumulados" value={money.format(totals.expense)} tone="red" />
              <Metric label="Cobros futuros cargados" value={money.format(receivables.reduce((s,x)=>s+x.amount,0))} tone="blue" />
            </div>
            <div className="grid-2">
              <Card title="Saldo por cuenta">
                <div className="balance-list">
                  {accountBalances.map(([name,value]) => <div key={name}><span>{name}</span><strong className={value < 0 ? 'expense' : ''}>{money.format(value)}</strong></div>)}
                </div>
              </Card>
              <Card title="Próximos valores / cobros">
                <div className="balance-list">
                  {receivables.map(x => <div key={x.id}><span><b>{formatDate(x.dueDate)}</b><br/><small>{x.description}</small></span><strong>{money.format(x.amount)}</strong></div>)}
                </div>
              </Card>
            </div>
          </>
        )}

        {section === 'expenses' && (
          <>
            <Header title="Gastos" subtitle="Control, clasificación y análisis de egresos." action="Nuevo gasto" onAction={() => setModal('expense')} />
            <div className="grid-3">
              <Metric label="Gastos acumulados" value={money.format(totals.expense)} tone="red" />
              <Metric label="Cantidad de gastos" value={String(movements.filter(x=>x.expense>0).length)} tone="blue" />
              <Metric label="Mayor categoría" value={categoryExpenses[0]?.[0] || '-'} tone="amber" />
            </div>
            <div className="grid-2">
              <Card title="Gastos por categoría">
                <Bars data={categoryExpenses} />
              </Card>
              <Card title="Distribución">
                <div className="donut-wrap">
                  <div className="donut"><span>{money.format(totals.expense)}</span></div>
                  <div className="legend">
                    {categoryExpenses.map(([name,value]) => <div key={name}><span>{name}</span><b>{totals.expense ? Math.round(value/totals.expense*100) : 0}%</b></div>)}
                  </div>
                </div>
              </Card>
            </div>
            <Filters query={query} setQuery={setQuery} account={account} setAccount={setAccount} options={availableAccounts} />
            <Card>
              <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Cuenta</th><th>Concepto</th><th>Detalle</th><th>Factura</th><th>Monto</th><th></th></tr></thead>
              <tbody>{expenses.map(m=><tr key={m.id}><td>{formatDate(m.date)}</td><td>{m.account}</td><td>{m.concept}</td><td>{m.detail}</td><td>{m.invoice||'-'}</td><td className="expense">{money.format(m.expense)}</td><td><button className="icon-btn danger" onClick={()=>removeMovement(m.id)}>×</button></td></tr>)}</tbody></table></div>
            </Card>
          </>
        )}

        {section === 'hours' && (
          <>
            <Header title="Horas" subtitle="Registro de horas trabajadas por especialista y servicio." action="Registrar horas" onAction={() => setModal('hours')} />
            <div className="grid-3">
              <Metric label="Horas registradas" value={hours.reduce((s,x)=>s+Number(x.hours||0),0).toLocaleString('es-AR')} tone="blue" />
              <Metric label="Costo valorizado" value={money.format(hours.reduce((s,x)=>s+Number(x.hours||0)*Number(x.hourlyRate||0),0))} tone="amber" />
              <Metric label="Especialistas" value={String(new Set(hours.map(x=>x.specialist)).size)} tone="green" />
            </div>
            <Card>
              <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Especialista</th><th>Servicio / Proyecto</th><th>Horas</th><th>Valor hora</th><th>Total</th><th>Observaciones</th><th></th></tr></thead>
              <tbody>{hours.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(h=><tr key={h.id}><td>{formatDate(h.date)}</td><td>{h.specialist}</td><td>{h.service}</td><td><b>{h.hours}</b></td><td>{money.format(h.hourlyRate)}</td><td>{money.format(h.hours*h.hourlyRate)}</td><td>{h.notes}</td><td><button className="icon-btn danger" onClick={()=>removeHour(h.id)}>×</button></td></tr>)}</tbody></table></div>
            </Card>
          </>
        )}
      </main>

      {modal && <Modal type={modal} onClose={()=>setModal(null)} onMovement={saveMovement} onHours={saveHours} />}
    </div>
  );
}

function Header({title,subtitle,action,onAction}) {
  return <header className="page-head"><div><h1>{title}</h1><p>{subtitle}</p></div>{action && <button className="primary" onClick={onAction}>＋ {action}</button>}</header>;
}

function Kpis({totals,count}) {
  return <div className="grid-4"><Metric label="Ingresos totales" value={money.format(totals.income)} tone="green"/><Metric label="Gastos totales" value={money.format(totals.expense)} tone="red"/><Metric label="Saldo actual" value={money.format(totals.balance)} tone="blue"/><Metric label="Movimientos" value={count.toLocaleString('es-AR')} tone="amber"/></div>;
}

function Metric({label,value,tone}) {
  return <div className="metric"><span className={'metric-icon '+tone}>{tone==='green'?'↗':tone==='red'?'↘':tone==='amber'?'◇':'▣'}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function Filters({query,setQuery,account,setAccount,options=accounts}) {
  return <div className="filters">
    <select value={account} onChange={e=>setAccount(e.target.value)}><option value="TODAS">Todas las cuentas</option>{options.map(a=><option key={a}>{a}</option>)}</select>
    <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar concepto, detalle, operación..." />
  </div>;
}

function Card({title,children}) {
  return <section className="card">{title && <h3>{title}</h3>}{children}</section>;
}

function Bars({data}) {
  const max = Math.max(...data.map(x=>x[1]),1);
  return <div className="bars">{data.map(([name,value])=><div key={name}><div><span>{name}</span><b>{money.format(value)}</b></div><div className="bar"><i style={{width:(value/max*100)+'%'}}/></div></div>)}</div>;
}

function Modal({type,onClose,onMovement,onHours}) {
  const isHours = type === 'hours';
  const isExpense = type === 'expense';
  const [form,setForm] = useState(isHours ? {
    date:new Date().toISOString().slice(0,10), specialist:'', service:'', hours:'', hourlyRate:'', notes:''
  } : {
    date:new Date().toISOString().slice(0,10), account:'CREDICOOP', folder:'', concept:'', detail:'', operation:'', income:'', expense:'', invoice:'', notes:''
  });
  const set = (k,v)=>setForm(x=>({...x,[k]:v}));

  function submit(e) {
    e.preventDefault();
    if (isHours) {
      onHours({...form,hours:Number(form.hours||0),hourlyRate:Number(form.hourlyRate||0)});
    } else {
      const data={...form,income:Number(form.income||0),expense:Number(form.expense||0)};
      if (isExpense) { data.income=0; if(!data.expense) return; }
      onMovement(data);
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><div><h2>{isHours?'Registrar horas':isExpense?'Nuevo gasto':'Nuevo movimiento'}</h2><p>Complete los datos del registro.</p></div><button className="icon-btn" onClick={onClose}>×</button></div>
    <form onSubmit={submit}>
      {isHours ? <>
        <Field label="Fecha"><input type="date" required value={form.date} onChange={e=>set('date',e.target.value)}/></Field>
        <Field label="Especialista"><input required value={form.specialist} onChange={e=>set('specialist',e.target.value)}/></Field>
        <Field label="Servicio / Proyecto"><input required value={form.service} onChange={e=>set('service',e.target.value)}/></Field>
        <div className="form-row"><Field label="Horas"><input type="number" step="0.5" required value={form.hours} onChange={e=>set('hours',e.target.value)}/></Field><Field label="Valor hora"><input type="number" required value={form.hourlyRate} onChange={e=>set('hourlyRate',e.target.value)}/></Field></div>
        <Field label="Observaciones"><textarea value={form.notes} onChange={e=>set('notes',e.target.value)}/></Field>
      </> : <>
        <div className="form-row"><Field label="Fecha"><input type="date" required value={form.date} onChange={e=>set('date',e.target.value)}/></Field><Field label="Cuenta"><select value={form.account} onChange={e=>set('account',e.target.value)}>{accounts.map(a=><option key={a}>{a}</option>)}</select></Field></div>
        <div className="form-row"><Field label="Carpeta"><input value={form.folder} onChange={e=>set('folder',e.target.value)}/></Field><Field label="Concepto"><input required value={form.concept} onChange={e=>set('concept',e.target.value)}/></Field></div>
        <Field label="Detalle"><input required value={form.detail} onChange={e=>set('detail',e.target.value)}/></Field>
        <div className="form-row"><Field label="Operación"><input value={form.operation} onChange={e=>set('operation',e.target.value)}/></Field><Field label="Factura"><input value={form.invoice} onChange={e=>set('invoice',e.target.value)}/></Field></div>
        {isExpense ? <Field label="Monto del gasto"><input type="number" min="0" required value={form.expense} onChange={e=>set('expense',e.target.value)}/></Field> :
        <div className="form-row"><Field label="Entrada"><input type="number" min="0" value={form.income} onChange={e=>set('income',e.target.value)}/></Field><Field label="Salida"><input type="number" min="0" value={form.expense} onChange={e=>set('expense',e.target.value)}/></Field></div>}
        <Field label="Observaciones"><textarea value={form.notes} onChange={e=>set('notes',e.target.value)}/></Field>
      </>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary">Guardar</button></div>
    </form>
  </div></div>;
}

function Field({label,children}) { return <label className="field"><span>{label}</span>{children}</label>; }
