'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { accounts, initialHours, initialMovements, initialSaldoSnapshot, initialInstitutions } from '../lib/seed';
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

function calculateSaldo(movements, snapshot) {
  const byBank = new Map();

  for (const row of movements) {
    const bank = String(row.account || '').trim().toUpperCase();
    if (!bank) continue;
    byBank.set(
      bank,
      Number(byBank.get(bank) || 0) +
        Number(row.income || 0) -
        Number(row.expense || 0)
    );
  }

  const bankValue = (name) => Number(byBank.get(name) || 0);

  const futureReceivables = (snapshot?.futureReceivableItems || [])
    .reduce((sum, value) => sum + Number(value || 0), 0);

  const certification45 = (snapshot?.certification45Items || [])
    .reduce(
      (sum, item) =>
        sum + Number(item?.hours || 0) * Number(item?.rate || 0),
      0
    );

  const investmentPrincipal = (snapshot?.investmentPrincipalParts || [])
    .reduce((sum, value) => sum + Number(value || 0), 0);
  const investmentInterest = (snapshot?.investmentInterestParts || [])
    .reduce((sum, value) => sum + Number(value || 0), 0);
  const investmentMaturity = (snapshot?.investmentMaturityParts || [])
    .reduce((sum, value) => sum + Number(value || 0), 0);

  // Excel Saldo!C10:C14
  const actualBanks = {
    CREDICOOP: bankValue('CREDICOOP'),
    'MERCADO LIBRE': bankValue('MERCADO LIBRE'),
    'MERCADO LIBRE 2': bankValue('MERCADO LIBRE 2'),
    EFECTIVO: bankValue('EFECTIVO'),
    PREX: bankValue('PREX'),
  };

  // Excel Saldo!C4 = SUM(C10:C13)
  const grossCurrent =
    actualBanks.CREDICOOP +
    actualBanks['MERCADO LIBRE'] +
    actualBanks['MERCADO LIBRE 2'] +
    actualBanks.EFECTIVO;

  // Excel Saldo!C3 = C4 + E26, E26 = SUM(G28:G30)
  const grossPlusReceivables = grossCurrent + futureReceivables;

  const bankCash = Number(snapshot?.bankCash || 0);

  // Excel Saldo!C6 = SUM(I5 + D11 + C13 + D12)
  const available =
    bankCash +
    actualBanks['MERCADO LIBRE'] +
    actualBanks.EFECTIVO +
    actualBanks['MERCADO LIBRE 2'];

  // Excel control column D/E.
  const controlBanks = {
    CREDICOOP: investmentMaturity + bankCash, // D10 = L12 + I5
    'MERCADO LIBRE': actualBanks['MERCADO LIBRE'],
    'MERCADO LIBRE 2': actualBanks['MERCADO LIBRE 2'],
    EFECTIVO: actualBanks.EFECTIVO,
    PREX: actualBanks.PREX,
    'PERSONAL PAY': 0,
  };

  const bankRows = [
    { name: 'CREDICOOP', value: actualBanks.CREDICOOP },
    { name: 'MERCADO LIBRE', value: actualBanks['MERCADO LIBRE'] },
    { name: 'MERCADO LIBRE 2', value: actualBanks['MERCADO LIBRE 2'] },
    { name: 'EFECTIVO', value: actualBanks.EFECTIVO },
    { name: 'PREX', value: actualBanks.PREX },
    // C15 is blank in the original workbook.
    { name: 'PERSONAL PAY', value: null },
  ].map((bank) => {
    const calculation = Number(controlBanks[bank.name] || 0);
    const balance = bank.value == null ? 0 : calculation - bank.value;
    return { ...bank, calculation, balance };
  });

  const monthExpense = Number(snapshot?.monthExpense || 0);
  const monthIncome = Number(snapshot?.monthIncome || 0);
  const monthBalance = monthIncome - monthExpense;
  const expenseRatio = monthIncome ? monthExpense / monthIncome : 0;
  const savingMargin = monthIncome ? 1 - expenseRatio : 0;

  return {
    status: grossCurrent === 0 ? 'NEGATIVO' : 'POSITIVO',
    grossCurrent,
    grossPlusReceivables,
    available,
    futureReceivables,
    certification45,
    bankRows,
    banks: bankRows.map(({ name, value }) => ({ name, value })),
    bankCash,
    currentMonth: snapshot?.currentMonth || '',
    monthExpense,
    monthIncome,
    monthBalance,
    expenseRatio,
    savingMargin,
    salaryPayments: Number(snapshot?.salaryPayments || 0),
    mercadoLibreCapitalization: Number(snapshot?.mercadoLibreCapitalization || 0),
    investmentPrincipal,
    investmentInterest,
    investmentMaturity,
  };
}

const nav = [
  ['book', 'Libro de contabilidad'],
  ['balance', 'Saldo'],
  ['statistics', 'Estadísticas'],
  ['expenses', 'Gastos'],
  ['hours', 'Horas'],
  ['settings', 'Configuración'],
];

const icons = {
  book: '▤',
  balance: '◈',
  statistics: '▥',
  expenses: '▣',
  hours: '◷',
  settings: '⚙',
};

export default function AccountingApp() {
  const [section, setSection] = useState('book');
  const [movements, setMovements] = useState(initialMovements);
  const [hours, setHours] = useState(initialHours);
  const [saldoSnapshot, setSaldoSnapshot] = useState(initialSaldoSnapshot);
  const [institutions, setInstitutions] = useState(initialInstitutions);
  const [concepts, setConcepts] = useState([]);
  const [editingMovement, setEditingMovement] = useState(null);
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
    const storedSaldoSnapshot = loadStored('puente.saldoSnapshot', null);
    const storedInstitutions = loadStored('puente.institutions', initialInstitutions);
    const storedConcepts = loadStored('puente.concepts', null);

    const cleanMovements = isLegacyDemoMovements(storedMovements) ? [] : storedMovements;
    const movementAccounts = [...new Set(cleanMovements.map((m) => String(m.account || '').trim()).filter(Boolean))];
    const configuredNames = new Set((storedInstitutions || []).map((item) => String(item.name || '').toUpperCase()));
    const autoInstitutions = movementAccounts
      .filter((name) => !configuredNames.has(name.toUpperCase()))
      .map((name) => ({
        id: `auto-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        type: 'Otro',
        active: true,
      }));

    const initialConceptList = [...new Set(
      cleanMovements.map((m) => String(m.concept || '').trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'es'));

    setMovements(cleanMovements);
    setHours(isLegacyDemoHours(storedHours) ? [] : storedHours);
    setSaldoSnapshot({ ...initialSaldoSnapshot, ...(storedSaldoSnapshot || {}) });
    setInstitutions([...(storedInstitutions || initialInstitutions), ...autoInstitutions]);
    setConcepts(Array.isArray(storedConcepts) && storedConcepts.length ? storedConcepts : initialConceptList);
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

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.institutions', institutions);
  }, [institutions, ready]);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.concepts', concepts);
  }, [concepts, ready]);

  const availableAccounts = useMemo(
    () => institutions
      .filter((item) => item.active !== false)
      .map((item) => item.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es')),
    [institutions]
  );

  const availableConcepts = useMemo(
    () => concepts.slice().sort((a, b) => a.localeCompare(b, 'es')),
    [concepts]
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

  const ledgerTotals = useMemo(() => {
    const totals = summarize(movements);
    const result = totals.income - totals.expense;
    const expenseRatio = totals.income ? totals.expense / totals.income : 0;
    const savingMargin = totals.income ? result / totals.income : 0;

    return {
      ...totals,
      result,
      expenseRatio,
      savingMargin,
    };
  }, [movements]);

  const ledgerAnnualStats = useMemo(() => {
    const map = {};

    for (const row of movements) {
      const y = movementYear(row);
      if (!y) continue;

      if (!map[y]) {
        map[y] = {
          year: y,
          income: 0,
          expense: 0,
          count: 0,
        };
      }

      map[y].income += Number(row.income || 0);
      map[y].expense += Number(row.expense || 0);
      map[y].count += 1;
    }

    return Object.values(map)
      .map((item) => {
        const result = item.income - item.expense;
        return {
          ...item,
          result,
          expenseRatio: item.income ? item.expense / item.income : 0,
          savingMargin: item.income ? result / item.income : 0,
        };
      })
      .sort((a, b) => Number(b.year) - Number(a.year));
  }, [movements]);

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

  const statisticsConcepts = useMemo(() => {
    const map = {};

    for (const row of filtered) {
      const key = row.concept || 'Sin concepto';
      if (!map[key]) map[key] = { concept: key, income: 0, expense: 0, count: 0 };
      map[key].income += Number(row.income || 0);
      map[key].expense += Number(row.expense || 0);
      map[key].count += 1;
    }

    return Object.values(map)
      .map((item) => ({ ...item, result: item.income - item.expense }))
      .sort((a, b) => (b.income + b.expense) - (a.income + a.expense))
      .slice(0, 12);
  }, [filtered]);

  const saldoCalculated = useMemo(
    () => calculateSaldo(movements, saldoSnapshot),
    [movements, saldoSnapshot]
  );

  const currentBalanceLabel = money.format(
    saldoCalculated.grossCurrent || 0
  );

  function saveMovement(data) {
    if (editingMovement?.id) {
      setMovements((prev) => prev.map((row) => (
        row.id === editingMovement.id
          ? { ...row, ...data, id: editingMovement.id }
          : row
      )));
    } else {
      setMovements((prev) => [{ id: crypto.randomUUID(), ...data }, ...prev]);
    }

    if (data.account && !institutions.some((item) => item.name === data.account)) {
      setInstitutions((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: data.account,
          type: 'Otro',
          active: true,
        },
      ]);
    }

    if (data.concept && !concepts.includes(data.concept)) {
      setConcepts((prev) => [...prev, data.concept].sort((a, b) => a.localeCompare(b, 'es')));
    }

    setEditingMovement(null);
    setModal(null);
  }

  function openNewMovement() {
    setEditingMovement(null);
    setModal('movement');
  }

  function openEditMovement(row) {
    setEditingMovement(row);
    setModal('movement');
  }

  function closeModal() {
    setModal(null);
    setEditingMovement(null);
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

  function openStatistics(accountName = 'TODAS') {
    setAccount(accountName || 'TODAS');
    setConcept('TODOS');
    setYear('TODOS');
    setQuery('');
    setSection('statistics');
  }

  function renameInstitution(id, nextName, nextType) {
    const item = institutions.find((entry) => entry.id === id);
    const cleanName = String(nextName || '').trim();
    if (!item || !cleanName) return;

    const duplicate = institutions.some(
      (entry) => entry.id !== id && entry.name.toUpperCase() === cleanName.toUpperCase()
    );
    if (duplicate) {
      alert('Ya existe una cuenta con ese nombre.');
      return;
    }

    setInstitutions((prev) => prev.map((entry) => (
      entry.id === id ? { ...entry, name: cleanName, type: nextType || entry.type } : entry
    )));
    setMovements((prev) => prev.map((row) => (
      row.account === item.name ? { ...row, account: cleanName } : row
    )));

    if (account === item.name) setAccount(cleanName);
  }

  function addInstitution(name, type) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return false;

    if (institutions.some((entry) => entry.name.toUpperCase() === cleanName.toUpperCase())) {
      alert('Ya existe una cuenta con ese nombre.');
      return false;
    }

    setInstitutions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: cleanName,
        type: type || 'Otro',
        active: true,
      },
    ]);
    return true;
  }

  function deleteInstitution(id) {
    const item = institutions.find((entry) => entry.id === id);
    if (!item) return;

    const used = movements.some((row) => row.account === item.name);
    if (used) {
      alert('No se puede eliminar porque existen movimientos asociados. Renombrala o reasigná primero esos movimientos.');
      return;
    }

    if (confirm(`¿Eliminar ${item.name} de Configuración?`)) {
      setInstitutions((prev) => prev.filter((entry) => entry.id !== id));
    }
  }

  function renameConcept(oldName, nextName) {
    const cleanName = String(nextName || '').trim();
    if (!cleanName || oldName === cleanName) return true;

    if (concepts.some((item) => item !== oldName && item.toUpperCase() === cleanName.toUpperCase())) {
      alert('Ya existe un concepto con ese nombre.');
      return false;
    }

    setConcepts((prev) => prev.map((item) => item === oldName ? cleanName : item)
      .sort((a, b) => a.localeCompare(b, 'es')));
    setMovements((prev) => prev.map((row) => (
      row.concept === oldName ? { ...row, concept: cleanName } : row
    )));
    if (concept === oldName) setConcept(cleanName);
    return true;
  }

  function addConcept(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return false;

    if (concepts.some((item) => item.toUpperCase() === cleanName.toUpperCase())) {
      alert('Ya existe ese concepto.');
      return false;
    }

    setConcepts((prev) => [...prev, cleanName].sort((a, b) => a.localeCompare(b, 'es')));
    return true;
  }

  function deleteConcept(name) {
    const used = movements.some((row) => row.concept === name);
    if (used) {
      alert('No se puede eliminar porque existen movimientos asociados. Podés renombrarlo desde Configuración.');
      return;
    }

    if (confirm(`¿Eliminar el concepto "${name}"?`)) {
      setConcepts((prev) => prev.filter((item) => item !== name));
    }
  }

  function handleImport(payload) {
    const imported = payload.movements || [];
    setMovements(imported);

    if (payload.saldoSnapshot) {
      setSaldoSnapshot((prev) => ({ ...prev, ...payload.saldoSnapshot }));
    }

    const importedAccounts = [...new Set(imported.map((row) => String(row.account || '').trim()).filter(Boolean))];
    const importedConcepts = [...new Set(imported.map((row) => String(row.concept || '').trim()).filter(Boolean))];

    setInstitutions((prev) => {
      const existing = new Set(prev.map((item) => item.name.toUpperCase()));
      return [
        ...prev,
        ...importedAccounts
          .filter((name) => !existing.has(name.toUpperCase()))
          .map((name) => ({
            id: crypto.randomUUID(),
            name,
            type: 'Otro',
            active: true,
          })),
      ];
    });

    setConcepts((prev) => [...new Set([...prev, ...importedConcepts])]
      .sort((a, b) => a.localeCompare(b, 'es')));

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
        <div className="brand brand-official">
          <div className="brand-logo-card">
            <Image
              src="/logo-proyecto-puente.webp"
              alt="Proyecto Puente"
              width={420}
              height={273}
              className="brand-logo-image"
              priority
            />
          </div>
          <div className="brand-product">
            <strong>Contabilidad</strong>
            <span>Proyecto Puente</span>
          </div>
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
              onAction={openNewMovement}
            />

            <div className="grid-2 book-main-metrics">
              <Metric
                label="Saldo actual bruto total"
                value={currentBalanceLabel}
                tone="blue"
                hint="Calculado desde el Libro de contabilidad"
                onClick={() => setSection('balance')}
              />
              <Metric
                label="Dinero disponible"
                value={money.format(saldoCalculated.available || 0)}
                tone="green"
                hint="Resumen de disponibilidad actual"
                onClick={() => setSection('balance')}
              />
            </div>

            <section className="book-balance-labels" aria-label="Saldos por cuenta">
              <div className="bank-labels">
                {saldoCalculated.banks.map((bank) => (
                  <button
                    type="button"
                    className={`bank-label bank-label-button bank-${String(bank.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    key={bank.name}
                    onClick={() => openStatistics(bank.name)}
                    title={`Ver resumen de ${bank.name}`}
                  >
                    <span>{bank.name}</span>
                    <strong>{bank.value == null ? '' : money.format(bank.value)}</strong>
                  </button>
                ))}
              </div>
            </section>

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
                onEdit={openEditMovement}
                showFilteredTotals={concept !== 'TODOS'}
                filteredLabel={concept}
                totals={filteredTotals}
              />
            </Card>
          </>
        )}

        {section === 'balance' && (
          <>
            <Header
              title="Saldo"
              subtitle="Posición financiera actual calculada desde el Libro de contabilidad."
            />

            <section className="hero-balance">
              <div>
                <span>Saldo actual bruto total</span>
                <strong>{money.format(saldoCalculated.grossCurrent)}</strong>
                <small>Suma de los saldos bancarios configurados en el Libro.</small>
              </div>
              <div className="hero-icon">▰</div>
            </section>

            <div className="grid-2">
              <Metric
                label="Saldo actual bruto total"
                value={money.format(saldoCalculated.grossCurrent)}
                tone="blue"
              />
              <Metric
                label="Dinero disponible"
                value={money.format(saldoCalculated.available)}
                tone="green"
              />
            </div>

            <div className="grid-2">
              <Card title="Cuentas · valor actual">
                <div className="saldo-bank-table">
                  <div className="saldo-bank-head">
                    <span>Cuenta</span>
                    <span>Tipo</span>
                    <span>Valor actual</span>
                    <span>Resumen</span>
                  </div>
                  {saldoCalculated.bankRows.map((bank) => {
                    const configured = institutions.find((item) => item.name === bank.name);
                    return (
                      <button
                        type="button"
                        className="saldo-bank-row saldo-bank-row-button"
                        key={bank.name}
                        onClick={() => openStatistics(bank.name)}
                      >
                        <strong>{bank.name}</strong>
                        <span>{configured?.type || 'Sin clasificar'}</span>
                        <span>{bank.value == null ? '' : money.format(bank.value)}</span>
                        <span className="balance-ok">Ver estadísticas →</span>
                      </button>
                    );
                  })}
                </div>
              </Card>

              <Card title={`Mes en curso · ${saldoCalculated.currentMonth || '-'}`}>
                <div className="balance-list">
                  <div><span>Gasto de este mes</span><strong className="expense">{money.format(saldoCalculated.monthExpense)}</strong></div>
                  <div><span>Ingresos brutos</span><strong className="income">{money.format(saldoCalculated.monthIncome)}</strong></div>
                  <div><span>Saldo del mes</span><strong>{money.format(saldoCalculated.monthBalance)}</strong></div>
                  <div><span>Gasto sobre ingresos</span><strong>{percent.format(saldoCalculated.expenseRatio || 0)}</strong></div>
                  <div><span>Margen de ahorro</span><strong>{percent.format(saldoCalculated.savingMargin || 0)}</strong></div>
                  <div><span>Pagos en salarios</span><strong>{money.format(saldoCalculated.salaryPayments)}</strong></div>
                </div>
              </Card>
            </div>

            <div className="grid-3">
              <Metric
                label="Monto invertido"
                value={money.format(saldoCalculated.investmentPrincipal || 0)}
                tone="blue"
              />
              <Metric
                label="Interés estimado"
                value={money.format(saldoCalculated.investmentInterest || 0)}
                tone="green"
              />
              <Metric
                label="Monto a reembolsar"
                value={money.format(saldoCalculated.investmentMaturity || 0)}
                tone="amber"
              />
            </div>
          </>
        )}

        {section === 'statistics' && (
          <>
            <Header
              title="Estadísticas"
              subtitle={account === 'TODAS'
                ? 'Análisis del Libro de contabilidad por año, cuenta y concepto.'
                : `Resumen de ${account} · podés cambiar los filtros cuando quieras.`}
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
                label={year === 'TODOS' ? 'Ingresos del filtro' : `Ingresos · ${year}`}
                value={money.format(filteredTotals.income)}
                tone="green"
              />
              <Metric
                label={year === 'TODOS' ? 'Gastos del filtro' : `Gastos · ${year}`}
                value={money.format(filteredTotals.expense)}
                tone="red"
              />
              <Metric
                label="Resultado"
                value={money.format(filteredTotals.income - filteredTotals.expense)}
                tone={(filteredTotals.income - filteredTotals.expense) >= 0 ? 'green' : 'red'}
              />
              <Metric
                label="Movimientos"
                value={number.format(filteredTotals.count)}
                tone="blue"
              />
            </div>

            <Card title="Evolución anual">
              <div className="table-wrap">
                <table className="annual-balance-table">
                  <thead>
                    <tr>
                      <th>Año</th>
                      <th>Ingresos</th>
                      <th>Gastos</th>
                      <th>Resultado</th>
                      <th>Movimientos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyStats.map((item) => (
                      <tr key={item.year}>
                        <td><strong>{item.year}</strong></td>
                        <td className="income money-cell">{money.format(item.income)}</td>
                        <td className="expense money-cell">{money.format(item.expense)}</td>
                        <td className={`money-cell ${item.result >= 0 ? 'income' : 'expense'}`}>
                          {money.format(item.result)}
                        </td>
                        <td className="money-cell">{number.format(item.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Resumen por concepto">
              <div className="table-wrap">
                <table className="statistics-concept-table">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Ingresos</th>
                      <th>Gastos</th>
                      <th>Resultado</th>
                      <th>Movimientos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statisticsConcepts.map((item) => (
                      <tr key={item.concept}>
                        <td>{item.concept}</td>
                        <td className="income money-cell">{money.format(item.income)}</td>
                        <td className="expense money-cell">{money.format(item.expense)}</td>
                        <td className={`money-cell ${item.result >= 0 ? 'income' : 'expense'}`}>
                          {money.format(item.result)}
                        </td>
                        <td className="money-cell">{number.format(item.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
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
                label={year === 'TODOS' ? 'Total de gastos filtrados' : `Gastos · ${year}`}
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
              <Card title={year === 'TODOS' ? 'Gastos por concepto · período filtrado' : `Gastos por concepto · ${year}`}>
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

        {section === 'settings' && (
          <>
            <Header
              title="Configuración"
              subtitle="Administración de cuentas y conceptos utilizados en toda la aplicación."
            />

            <ConfigurationPanel
              institutions={institutions}
              concepts={concepts}
              movements={movements}
              onAddInstitution={addInstitution}
              onRenameInstitution={renameInstitution}
              onDeleteInstitution={deleteInstitution}
              onAddConcept={addConcept}
              onRenameConcept={renameConcept}
              onDeleteConcept={deleteConcept}
            />
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
          onClose={closeModal}
          onMovement={saveMovement}
          onHours={saveHours}
          conceptOptions={availableConcepts}
          accountOptions={availableAccounts}
          initialMovement={editingMovement}
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

function Metric({ label, value, tone, hint, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={onClick ? 'metric metric-clickable' : 'metric'}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <span className={'metric-icon ' + tone}>
        {tone === 'green' ? '↗' : tone === 'red' ? '↘' : tone === 'amber' ? '◇' : '▣'}
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {hint && <em>{hint}</em>}
      </div>
    </Tag>
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

function LedgerTable({
  rows,
  compact,
  columnWidths,
  setColumnWidths,
  onDelete,
  onEdit,
  showFilteredTotals = false,
  filteredLabel = '',
  totals = { income: 0, expense: 0 },
}) {
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
            <tr key={m.id} className="editable-ledger-row" onClick={() => onEdit?.(m)} title="Clic para editar">
              <td>{formatDate(m.date)}</td>
              <td><span className="pill blue">{m.account}</span></td>
              <td className="truncate-cell" title={m.folder}>{m.folder}</td>
              <td className="truncate-cell" title={m.concept}>{m.concept}</td>
              <td className="truncate-cell" title={m.detail}>{m.detail}</td>
              <td>{m.operation || '-'}</td>
              <td className="income money-cell">{m.income ? money.format(m.income) : '-'}</td>
              <td className="expense money-cell">{m.expense ? money.format(m.expense) : '-'}</td>
              <td className="truncate-cell" title={m.invoice}>{m.invoice || '-'}</td>
              <td><button className="icon-btn danger" onClick={(event) => { event.stopPropagation(); onDelete(m.id); }}>×</button></td>
            </tr>
          ))}
        </tbody>

        {showFilteredTotals && (
          <tfoot className="ledger-filter-total">
            <tr>
              <td colSpan={6}>
                <strong>Total del concepto</strong>
                <span title={filteredLabel}>{filteredLabel}</span>
              </td>
              <td className="income money-cell">{money.format(totals.income || 0)}</td>
              <td className="expense money-cell">{money.format(totals.expense || 0)}</td>
              <td colSpan={2}>
                <span className="ledger-filter-count">{number.format(rows.length)} registros</span>
              </td>
            </tr>
          </tfoot>
        )}
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

function Modal({ type, onClose, onMovement, onHours, conceptOptions, accountOptions, initialMovement }) {
  const isHours = type === 'hours';
  const isExpense = type === 'expense';
  const isEditingMovement = !isHours && !isExpense && Boolean(initialMovement?.id);

  const [form, setForm] = useState(isHours ? {
    date: new Date().toISOString().slice(0, 10),
    specialist: '',
    service: '',
    hours: '',
    hourlyRate: '',
    notes: '',
  } : initialMovement ? {
    date: initialMovement.date || new Date().toISOString().slice(0, 10),
    account: initialMovement.account || accountOptions[0] || 'CREDICOOP',
    folder: initialMovement.folder || '',
    concept: initialMovement.concept || '',
    detail: initialMovement.detail || '',
    operation: initialMovement.operation || '',
    income: initialMovement.income || '',
    expense: initialMovement.expense || '',
    invoice: initialMovement.invoice || '',
    notes: initialMovement.notes || '',
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
            <h2>{isHours ? 'Registrar horas' : isExpense ? 'Nuevo gasto' : isEditingMovement ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
            <p>{isEditingMovement ? 'Modificá el registro y guardá los cambios.' : 'Complete los datos del registro.'}</p>
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
