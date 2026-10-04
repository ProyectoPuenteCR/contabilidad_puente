'use client';

import { useEffect, useMemo, useState } from 'react';
import { accounts, initialHours, initialMovements } from '../lib/seed';
import ExcelTools from './excel-tools';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percent = new Intl.NumberFormat('es-AR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const number = new Intl.NumberFormat('es-AR');

const dateFmt = new Intl.DateTimeFormat('es-AR');

const DEFAULT_WIDTHS = {
  date: 110,
  account: 165,
  folder: 190,
  concept: 260,
  detail: 390,
  operation: 150,
  income: 170,
  expense: 170,
  invoice: 160,
  actions: 56,
};

function formatDate(value) {
  if (!value) return '-';
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return value;
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

function saveStored(key, value) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
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

function movementYear(movement) {
  const match = String(movement?.date || '').match(/^(\d{4})/);
  return match ? match[1] : '';
}

function summarize(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.income += Number(row.income || 0);
      acc.expense += Number(row.expense || 0);
      acc.count += 1;
      return acc;
    },
    { income: 0, expense: 0, count: 0 }
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
  const [saldoSnapshot, setSaldoSnapshot] = useState(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [account, setAccount] = useState('TODAS');
  const [concept, setConcept] = useState('TODOS');
  const [year, setYear] = useState('TODOS');
  const [modal, setModal] = useState(null);
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  const [columnWidths, setColumnWidths] = useState(DEFAULT_WIDTHS);

  useEffect(() => {
    const storedMovements = loadStored('puente.movements', initialMovements);
    const storedHours = loadStored('puente.hours', initialHours);

    setMovements(isLegacyDemoMovements(storedMovements) ? [] : storedMovements);
    setHours(isLegacyDemoHours(storedHours) ? [] : storedHours);
    setSaldoSnapshot(loadStored('puente.saldoSnapshot', null));
    setDark(loadStored('puente.dark', false));
    setCompact(loadStored('puente.compact', false));
    setColumnWidths({
      ...DEFAULT_WIDTHS,
      ...loadStored('puente.ledgerColumnWidths', {}),
    });
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.movements', movements);
  }, [movements, ready]);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.hours', hours);
  }, [hours, ready]);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.saldoSnapshot', saldoSnapshot);
  }, [saldoSnapshot, ready]);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.dark', dark);
  }, [dark, ready]);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.compact', compact);
  }, [compact, ready]);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.ledgerColumnWidths', columnWidths);
  }, [columnWidths, ready]);

  const availableAccounts = useMemo(
    () => [...new Set([...accounts, ...movements.map((m) => m.account).filter(Boolean)])]
      .sort((a, b) => a.localeCompare(b, 'es')),
    [movements]
  );

  const availableConcepts = useMemo(
    () => [...new Set(movements.map((m) => String(m.concept || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es')),
    [movements]
  );

  const availableYears = useMemo(
    () => [...new Set(movements.map(movementYear).filter(Boolean))]
      .sort((a, b) => Number(b) - Number(a)),
    [movements]
  );

  const filteredWithoutYear = useMemo(() => {
    const q = query.trim().toLowerCase();

    return movements.filter((x) => {
      if (account !== 'TODAS' && x.account !== account) return false;
      if (concept !== 'TODOS' && x.concept !== concept) return false;

      if (q) {
        const match = [x.detail, x.concept, x.folder, x.operation, x.invoice, x.account]
          .some((v) => String(v || '').toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [movements, query, account, concept]);

  const filtered = useMemo(
    () => filteredWithoutYear
      .filter((x) => year === 'TODOS' || movementYear(x) === year)
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    [filteredWithoutYear, year]
  );

  const filteredTotals = useMemo(() => summarize(filtered), [filtered]);

  const expenses = useMemo(
    () => filtered.filter((x) => Number(x.expense || 0) > 0),
    [filtered]
  );

  const expenseTotal = useMemo(
    () => expenses.reduce((sum, row) => sum + Number(row.expense || 0), 0),
    [expenses]
  );

  const categoryExpenses = useMemo(() => {
    const map = {};

    for (const row of expenses) {
      const key = row.concept || 'Sin categoría';
      map[key] = (map[key] || 0) + Number(row.expense || 0);
    }

    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [expenses]);

  const yearlyStats = useMemo(() => {
    const map = {};

    for (const row of filteredWithoutYear) {
      const y = movementYear(row);
      if (!y) continue;

      if (!map[y]) {
        map[y] = { year: y, income: 0, expense: 0, count: 0 };
      }

      map[y].income += Number(row.income || 0);
      map[y].expense += Number(row.expense || 0);
      map[y].count += 1;
    }

    return Object.values(map)
      .map((item) => ({
        ...item,
        result: item.income - item.expense,
      }))
      .sort((a, b) => Number(b.year) - Number(a.year));
  }, [filteredWithoutYear]);

  const expenseAverage = expenses.length ? expenseTotal / expenses.length : 0;

  const grossCurrent = saldoSnapshot?.grossCurrent;
  const currentBalanceLabel = saldoSnapshot
    ? money.format(grossCurrent || 0)
    : 'Reimportar Excel';

  function saveMovement(data) {
    setMovements((prev) => [{ id: crypto.randomUUID(), ...data }, ...prev]);
    setModal(null);
  }

  function saveHours(data) {
    setHours((prev) => [{ id: crypto.randomUUID(), ...data }, ...prev]);
    setModal(null);
  }

  function removeMovement(id) {
    if (confirm('¿Eliminar este movimiento?')) {
      setMovements((prev) => prev.filter((x) => x.id !== id));
    }
  }

  function removeHour(id) {
    if (confirm('¿Eliminar este registro de horas?')) {
      setHours((prev) => prev.filter((x) => x.id !== id));
    }
  }

  function handleImport(payload) {
    setMovements(payload.movements || []);
    setSaldoSnapshot(payload.saldoSnapshot || null);
    setAccount('TODAS');
    setConcept('TODOS');
    setYear('TODOS');
    setQuery('');
  }

  function resetColumnWidths() {
    setColumnWidths(DEFAULT_WIDTHS);
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
            <button
              key={id}
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              <span className="nav-icon">{icons[id]}</span>{label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button onClick={() => setDark((value) => !value)}>
            {dark ? '☀' : '◐'} {dark ? 'Tema claro' : 'Tema oscuro'}
          </button>
          <small>Proyecto Puente · v0.4</small>
        </div>
      </aside>

      <main>
        {section === 'book' && (
          <>
            <Header
              title="Libro de contabilidad"
              subtitle="Resumen y administración de todos los movimientos del proyecto."
              action="Nuevo movimiento"
              onAction={() => setModal('movement')}
            />

            <div className="grid-4">
              <Metric
                label={year === 'TODOS' ? 'Ingresos · todos los años' : `Ingresos · ${year}`}
                value={money.format(filteredTotals.income)}
                tone="green"
              />
              <Metric
                label={year === 'TODOS' ? 'Gastos · todos los años' : `Gastos · ${year}`}
                value={money.format(filteredTotals.expense)}
                tone="red"
              />
              <Metric
                label="Saldo actual bruto"
                value={currentBalanceLabel}
                tone="blue"
                hint={saldoSnapshot ? 'Tomado de la hoja Saldo' : 'Reimporte el Excel original'}
              />
              <Metric
                label="Movimientos visibles"
                value={number.format(filtered.length)}
                tone="amber"
              />
            </div>

            <ExcelTools
              movements={movements}
              saldoSnapshot={saldoSnapshot}
              onImport={handleImport}
            />

            <Filters
              query={query}
              setQuery={setQuery}
              account={account}
              setAccount={setAccount}
              accountOptions={availableAccounts}
              concept={concept}
              setConcept={setConcept}
              conceptOptions={availableConcepts}
              year={year}
              setYear={setYear}
              yearOptions={availableYears}
              compact={compact}
              setCompact={setCompact}
              onResetColumns={resetColumnWidths}
            />

            <Card>
              <LedgerTable
                rows={filtered}
                compact={compact}
                columnWidths={columnWidths}
                setColumnWidths={setColumnWidths}
                onDelete={removeMovement}
              />
            </Card>
          </>
        )}

        {section === 'balance' && (
          <>
            <Header
              title="Saldo"
              subtitle="Indicadores importados de la hoja Saldo del libro original."
            />

            {!saldoSnapshot ? (
              <div className="data-warning">
                Reimporte el archivo original para incorporar la hoja <strong>Saldo</strong>.
                Los movimientos ya cargados no contienen estos indicadores.
              </div>
            ) : (
              <>
                <section className="hero-balance">
                  <div>
                    <span>Saldo actual bruto total</span>
                    <strong>{money.format(saldoSnapshot.grossCurrent)}</strong>
                    <small>Incluye inversiones · valor de la hoja Saldo</small>
                  </div>
                  <div className="hero-icon">▰</div>
                </section>

                <div className="grid-4">
                  <Metric
                    label="Saldo bruto + eCheq a cobrar"
                    value={money.format(saldoSnapshot.grossPlusReceivables)}
                    tone="blue"
                  />
                  <Metric
                    label="Dinero disponible"
                    value={money.format(saldoSnapshot.available)}
                    tone="green"
                  />
                  <Metric
                    label="Futuros cobros"
                    value={money.format(saldoSnapshot.futureReceivables)}
                    tone="amber"
                  />
                  <Metric
                    label="Certificación a registrar (45 D)"
                    value={money.format(saldoSnapshot.certification45)}
                    tone="blue"
                  />
                </div>

                <div className="grid-2">
                  <Card title="Bancos · valor actual">
                    <div className="balance-list">
                      {(saldoSnapshot.banks || []).map((bank) => (
                        <div key={bank.name}>
                          <span>{bank.name}</span>
                          <strong>{money.format(bank.value)}</strong>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card title={`Mes en curso · ${saldoSnapshot.currentMonth || '-'}`}>
                    <div className="balance-list">
                      <div><span>Gasto de este mes</span><strong className="expense">{money.format(saldoSnapshot.monthExpense)}</strong></div>
                      <div><span>Ingresos brutos</span><strong className="income">{money.format(saldoSnapshot.monthIncome)}</strong></div>
                      <div><span>Saldo del mes</span><strong>{money.format(saldoSnapshot.monthBalance)}</strong></div>
                      <div><span>Gasto sobre ingresos</span><strong>{percent.format(saldoSnapshot.expenseRatio || 0)}</strong></div>
                      <div><span>Margen de ahorro</span><strong>{percent.format(saldoSnapshot.savingMargin || 0)}</strong></div>
                      <div><span>Pagos en salarios</span><strong>{money.format(saldoSnapshot.salaryPayments)}</strong></div>
                    </div>
                  </Card>
                </div>

                <div className="grid-3">
                  <Metric
                    label="Monto invertido"
                    value={money.format(saldoSnapshot.investmentPrincipal || 0)}
                    tone="blue"
                  />
                  <Metric
                    label="Interés estimado"
                    value={money.format(saldoSnapshot.investmentInterest || 0)}
                    tone="green"
                  />
                  <Metric
                    label="Monto a reembolsar"
                    value={money.format(saldoSnapshot.investmentMaturity || 0)}
                    tone="amber"
                  />
                </div>
              </>
            )}
          </>
        )}

        {section === 'expenses' && (
          <>
            <Header
              title="Gastos"
              subtitle="Análisis de egresos por año, cuenta y concepto."
              action="Nuevo gasto"
              onAction={() => setModal('expense')}
            />

            <Filters
              query={query}
              setQuery={setQuery}
              account={account}
              setAccount={setAccount}
              accountOptions={availableAccounts}
              concept={concept}
              setConcept={setConcept}
              conceptOptions={availableConcepts}
              year={year}
              setYear={setYear}
              yearOptions={availableYears}
              compact={compact}
              setCompact={setCompact}
              showColumnReset={false}
            />

            <div className="grid-4">
              <Metric
                label={year === 'TODOS' ? 'Gastos · todos los años' : `Gastos · ${year}`}
                value={money.format(expenseTotal)}
                tone="red"
              />
              <Metric
                label="Cantidad de egresos"
                value={number.format(expenses.length)}
                tone="blue"
              />
              <Metric
                label="Promedio por egreso"
                value={money.format(expenseAverage)}
                tone="amber"
              />
              <Metric
                label="Mayor concepto"
                value={categoryExpenses[0]?.[0] || '-'}
                tone="green"
              />
            </div>

            {year === 'TODOS' && yearlyStats.length > 0 && (
              <section className="year-section">
                <div className="section-head-inline">
                  <div>
                    <h3>Comparativa por año</h3>
                    <p>Los totales acumulados se separan para no mezclar períodos.</p>
                  </div>
                </div>

                <div className="year-metrics">
                  {yearlyStats.map((item) => (
                    <button
                      type="button"
                      className="year-card"
                      key={item.year}
                      onClick={() => setYear(item.year)}
                    >
                      <span className="year-card-title">{item.year}</span>
                      <span><small>Gastos</small><strong className="expense">{money.format(item.expense)}</strong></span>
                      <span><small>Ingresos</small><strong className="income">{money.format(item.income)}</strong></span>
                      <span><small>Resultado del año</small><strong>{money.format(item.result)}</strong></span>
                      <span><small>Movimientos</small><strong>{number.format(item.count)}</strong></span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="grid-2">
              <Card title={year === 'TODOS' ? 'Gastos por concepto · todos los años' : `Gastos por concepto · ${year}`}>
                <Bars data={categoryExpenses} />
              </Card>

              <Card title="Participación por concepto">
                <div className="concept-share">
                  {categoryExpenses.map(([name, value]) => (
                    <div className="concept-share-row" key={name}>
                      <span title={name}>{name}</span>
                      <div className="concept-share-track">
                        <i style={{ width: expenseTotal ? `${Math.max(2, (value / expenseTotal) * 100)}%` : '0%' }} />
                      </div>
                      <b>{expenseTotal ? percent.format(value / expenseTotal) : '0,0 %'}</b>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card>
              <div className={compact ? 'table-wrap compact-table' : 'table-wrap'}>
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Cuenta</th><th>Concepto</th><th>Detalle</th>
                      <th>Factura</th><th>Monto</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((m) => (
                      <tr key={m.id}>
                        <td>{formatDate(m.date)}</td>
                        <td>{m.account}</td>
                        <td>{m.concept}</td>
                        <td>{m.detail}</td>
                        <td>{m.invoice || '-'}</td>
                        <td className="expense money-cell">{money.format(m.expense)}</td>
                        <td><button className="icon-btn danger" onClick={() => removeMovement(m.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {section === 'hours' && (
          <>
            <Header
              title="Horas"
              subtitle="Registro de horas trabajadas por especialista y servicio."
              action="Registrar horas"
              onAction={() => setModal('hours')}
            />

            <div className="grid-3">
              <Metric
                label="Horas registradas"
                value={hours.reduce((s, x) => s + Number(x.hours || 0), 0).toLocaleString('es-AR')}
                tone="blue"
              />
              <Metric
                label="Costo valorizado"
                value={money.format(hours.reduce((s, x) => s + Number(x.hours || 0) * Number(x.hourlyRate || 0), 0))}
                tone="amber"
              />
              <Metric
                label="Especialistas"
                value={String(new Set(hours.map((x) => x.specialist)).size)}
                tone="green"
              />
            </div>

            <Card>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Fecha</th><th>Especialista</th><th>Servicio / Proyecto</th><th>Horas</th><th>Valor hora</th><th>Total</th><th>Observaciones</th><th></th></tr>
                  </thead>
                  <tbody>
                    {hours.slice().sort((a, b) => b.date.localeCompare(a.date)).map((h) => (
                      <tr key={h.id}>
                        <td>{formatDate(h.date)}</td><td>{h.specialist}</td><td>{h.service}</td>
                        <td><b>{h.hours}</b></td><td>{money.format(h.hourlyRate)}</td>
                        <td>{money.format(h.hours * h.hourlyRate)}</td><td>{h.notes}</td>
                        <td><button className="icon-btn danger" onClick={() => removeHour(h.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </main>

      {modal && (
        <Modal
          type={modal}
          onClose={() => setModal(null)}
          onMovement={saveMovement}
          onHours={saveHours}
          conceptOptions={availableConcepts}
          accountOptions={availableAccounts}
        />
      )}
    </div>
  );
}

function Header({ title, subtitle, action, onAction }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1><p>{subtitle}</p></div>
      {action && <button className="primary" onClick={onAction}>＋ {action}</button>}
    </header>
  );
}

function Metric({ label, value, tone, hint }) {
  return (
    <div className="metric">
      <span className={'metric-icon ' + tone}>
        {tone === 'green' ? '↗' : tone === 'red' ? '↘' : tone === 'amber' ? '◇' : '▣'}
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {hint && <em>{hint}</em>}
      </div>
    </div>
  );
}

function Filters({
  query,
  setQuery,
  account,
  setAccount,
  accountOptions,
  concept,
  setConcept,
  conceptOptions,
  year,
  setYear,
  yearOptions,
  compact,
  setCompact,
  onResetColumns,
  showColumnReset = true,
}) {
  return (
    <div className="filters filters-advanced">
      <select value={year} onChange={(e) => setYear(e.target.value)} title="Filtrar por año">
        <option value="TODOS">Todos los años</option>
        {yearOptions.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>

      <select value={account} onChange={(e) => setAccount(e.target.value)} title="Filtrar por cuenta">
        <option value="TODAS">Todas las cuentas</option>
        {accountOptions.map((item) => <option key={item}>{item}</option>)}
      </select>

      <select value={concept} onChange={(e) => setConcept(e.target.value)} title="Filtrar por concepto">
        <option value="TODOS">Todos los conceptos</option>
        {conceptOptions.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar concepto, detalle, operación, factura..."
      />

      <button
        type="button"
        className={compact ? 'secondary filter-button selected' : 'secondary filter-button'}
        onClick={() => setCompact((value) => !value)}
      >
        {compact ? 'Vista compacta ✓' : 'Vista compacta'}
      </button>

      {showColumnReset && (
        <button type="button" className="secondary filter-button" onClick={onResetColumns}>
          Restablecer columnas
        </button>
      )}
    </div>
  );
}

function LedgerTable({ rows, compact, columnWidths, setColumnWidths, onDelete }) {
  const columns = [
    { key: 'date', label: 'Fecha', min: 85 },
    { key: 'account', label: 'Cuenta', min: 110 },
    { key: 'folder', label: 'Carpeta', min: 100 },
    { key: 'concept', label: 'Concepto', min: 130 },
    { key: 'detail', label: 'Detalle', min: 160 },
    { key: 'operation', label: 'Operación', min: 100 },
    { key: 'income', label: 'Entrada', min: 120 },
    { key: 'expense', label: 'Salida', min: 120 },
    { key: 'invoice', label: 'Factura', min: 100 },
    { key: 'actions', label: '', min: 45 },
  ];

  const tableWidth = columns.reduce(
    (sum, column) => sum + Number(columnWidths[column.key] || DEFAULT_WIDTHS[column.key]),
    0
  );

  function startResize(event, column) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = Number(columnWidths[column.key] || DEFAULT_WIDTHS[column.key]);

    function onMove(moveEvent) {
      const next = Math.max(column.min, startWidth + moveEvent.clientX - startX);
      setColumnWidths((prev) => ({ ...prev, [column.key]: Math.round(next) }));
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-columns');
    }

    document.body.classList.add('resizing-columns');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div className={compact ? 'table-wrap compact-table' : 'table-wrap'}>
      <table className="ledger-table" style={{ width: tableWidth }}>
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.key}
              style={{ width: columnWidths[column.key] || DEFAULT_WIDTHS[column.key] }}
            />
          ))}
        </colgroup>

        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>
                {column.label}
                {column.key !== 'actions' && (
                  <span
                    className="column-resizer"
                    onMouseDown={(event) => startResize(event, column)}
                    title="Arrastrar para ajustar ancho"
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{formatDate(m.date)}</td>
              <td><span className="pill blue">{m.account}</span></td>
              <td className="truncate-cell" title={m.folder}>{m.folder}</td>
              <td className="truncate-cell" title={m.concept}>{m.concept}</td>
              <td className="truncate-cell" title={m.detail}>{m.detail}</td>
              <td>{m.operation || '-'}</td>
              <td className="income money-cell">{m.income ? money.format(m.income) : '-'}</td>
              <td className="expense money-cell">{m.expense ? money.format(m.expense) : '-'}</td>
              <td className="truncate-cell" title={m.invoice}>{m.invoice || '-'}</td>
              <td><button className="icon-btn danger" onClick={() => onDelete(m.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, children }) {
  return <section className="card">{title && <h3>{title}</h3>}{children}</section>;
}

function Bars({ data }) {
  const max = Math.max(...data.map((x) => x[1]), 1);

  return (
    <div className="bars">
      {data.map(([name, value]) => (
        <div key={name}>
          <div><span title={name}>{name}</span><b>{money.format(value)}</b></div>
          <div className="bar"><i style={{ width: `${(value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Modal({ type, onClose, onMovement, onHours, conceptOptions, accountOptions }) {
  const isHours = type === 'hours';
  const isExpense = type === 'expense';

  const [form, setForm] = useState(isHours ? {
    date: new Date().toISOString().slice(0, 10),
    specialist: '',
    service: '',
    hours: '',
    hourlyRate: '',
    notes: '',
  } : {
    date: new Date().toISOString().slice(0, 10),
    account: accountOptions[0] || 'CREDICOOP',
    folder: '',
    concept: '',
    detail: '',
    operation: '',
    income: '',
    expense: '',
    invoice: '',
    notes: '',
  });

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  function submit(event) {
    event.preventDefault();

    if (isHours) {
      onHours({
        ...form,
        hours: Number(form.hours || 0),
        hourlyRate: Number(form.hourlyRate || 0),
      });
      return;
    }

    const data = {
      ...form,
      income: Number(form.income || 0),
      expense: Number(form.expense || 0),
    };

    if (isExpense) {
      data.income = 0;
      if (!data.expense) return;
    }

    onMovement(data);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{isHours ? 'Registrar horas' : isExpense ? 'Nuevo gasto' : 'Nuevo movimiento'}</h2>
            <p>Complete los datos del registro.</p>
          </div>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit}>
          {isHours ? (
            <>
              <Field label="Fecha"><input type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
              <Field label="Especialista"><input required value={form.specialist} onChange={(e) => set('specialist', e.target.value)} /></Field>
              <Field label="Servicio / Proyecto"><input required value={form.service} onChange={(e) => set('service', e.target.value)} /></Field>
              <div className="form-row">
                <Field label="Horas"><input type="number" step="0.5" required value={form.hours} onChange={(e) => set('hours', e.target.value)} /></Field>
                <Field label="Valor hora"><input type="number" required value={form.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} /></Field>
              </div>
              <Field label="Observaciones"><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            </>
          ) : (
            <>
              <div className="form-row">
                <Field label="Fecha"><input type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
                <Field label="Cuenta">
                  <select value={form.account} onChange={(e) => set('account', e.target.value)}>
                    {accountOptions.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </Field>
              </div>

              <div className="form-row">
                <Field label="Carpeta"><input value={form.folder} onChange={(e) => set('folder', e.target.value)} /></Field>
                <Field label="Concepto">
                  <input
                    list="conceptos-contabilidad"
                    required
                    value={form.concept}
                    onChange={(e) => set('concept', e.target.value)}
                  />
                  <datalist id="conceptos-contabilidad">
                    {conceptOptions.map((item) => <option value={item} key={item} />)}
                  </datalist>
                </Field>
              </div>

              <Field label="Detalle"><input required value={form.detail} onChange={(e) => set('detail', e.target.value)} /></Field>

              <div className="form-row">
                <Field label="Operación"><input value={form.operation} onChange={(e) => set('operation', e.target.value)} /></Field>
                <Field label="Factura"><input value={form.invoice} onChange={(e) => set('invoice', e.target.value)} /></Field>
              </div>

              {isExpense ? (
                <Field label="Monto del gasto ($)">
                  <input type="number" min="0" step="0.01" required value={form.expense} onChange={(e) => set('expense', e.target.value)} />
                </Field>
              ) : (
                <div className="form-row">
                  <Field label="Entrada ($)"><input type="number" min="0" step="0.01" value={form.income} onChange={(e) => set('income', e.target.value)} /></Field>
                  <Field label="Salida ($)"><input type="number" min="0" step="0.01" value={form.expense} onChange={(e) => set('expense', e.target.value)} /></Field>
                </div>
              )}

              <Field label="Observaciones"><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
            <button className="primary">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
