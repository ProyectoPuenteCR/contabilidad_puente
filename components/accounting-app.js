'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { accounts, initialHours, initialMovements, initialSaldoSnapshot, initialInstitutions, initialInvestments } from '../lib/seed';
import ExcelTools from './excel-tools';
import InvestmentsPanel from './investments-panel';
import AuthToolbar from './auth-toolbar';
import BackupTools from './backup-tools';
import AiAnalysisPanel from './ai-analysis-panel';
import CloudDatabasePanel from './cloud-database-panel';

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

function calculateSaldo(movements, snapshot, institutions = []) {
  const byAccount = new Map();

  for (const row of movements) {
    const accountName = String(row.account || '').trim().toUpperCase();
    if (!accountName) continue;

    byAccount.set(
      accountName,
      Number(byAccount.get(accountName) || 0) +
        Number(row.income || 0) -
        Number(row.expense || 0)
    );
  }

  const configured = institutions.length
    ? institutions
    : [...new Set(movements.map((row) => String(row.account || '').trim()).filter(Boolean))]
        .map((name) => ({ name, type: 'Otro', active: true }));

  const bankRows = configured.map((item) => ({
    name: item.name,
    type: item.type || 'Otro',
    active: item.active !== false,
    value: Number(byAccount.get(String(item.name || '').toUpperCase()) || 0),
  }));

  // El saldo actual se obtiene siempre desde el Libro:
  // Entradas - Salidas de todas las cuentas configuradas.
  const grossCurrent = bankRows.reduce(
    (sum, item) => sum + Number(item.value || 0),
    0
  );

  const bankCash = Number(snapshot?.bankCash || 0);

  // "Dinero disponible": efectivo auxiliar + billeteras virtuales +
  // cuentas marcadas como Efectivo. Los bancos quedan fuera porque pueden
  // incluir capital invertido.
  const available = bankCash + bankRows
    .filter((item) => item.type === 'Billetera virtual' || item.type === 'Efectivo')
    .reduce((sum, item) => sum + Number(item.value || 0), 0);

  const investmentPrincipal = (snapshot?.investmentPrincipalParts || [])
    .reduce((sum, value) => sum + Number(value || 0), 0);
  const investmentInterest = (snapshot?.investmentInterestParts || [])
    .reduce((sum, value) => sum + Number(value || 0), 0);
  const investmentMaturity = (snapshot?.investmentMaturityParts || [])
    .reduce((sum, value) => sum + Number(value || 0), 0);

  const monthExpense = Number(snapshot?.monthExpense || 0);
  const monthIncome = Number(snapshot?.monthIncome || 0);
  const monthBalance = monthIncome - monthExpense;
  const expenseRatio = monthIncome ? monthExpense / monthIncome : 0;
  const savingMargin = monthIncome ? 1 - expenseRatio : 0;

  return {
    status: grossCurrent >= 0 ? 'POSITIVO' : 'NEGATIVO',
    grossCurrent,
    available,
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
  ['ai', 'Análisis IA'],
  ['expenses', 'Gastos'],
  ['hours', 'Horas'],
  ['settings', 'Configuración'],
];

const icons = {
  book: '▤',
  balance: '◈',
  statistics: '▥',
  ai: '✦',
  expenses: '▣',
  hours: '◷',
  settings: '⚙',
};

export default function AccountingApp({ user = null }) {
  const [section, setSection] = useState('book');
  const [movements, setMovements] = useState(initialMovements);
  const [hours, setHours] = useState(initialHours);
  const [saldoSnapshot, setSaldoSnapshot] = useState(initialSaldoSnapshot);
  const [institutions, setInstitutions] = useState(initialInstitutions);
  const [investments, setInvestments] = useState(initialInvestments);
  const [concepts, setConcepts] = useState([]);
  const [editingMovement, setEditingMovement] = useState(null);
  const [historicalEdit, setHistoricalEdit] = useState(null);
  const [zeroAdjustment, setZeroAdjustment] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [account, setAccount] = useState('TODAS');
  const [concept, setConcept] = useState('TODOS');
  const [year, setYear] = useState('TODOS');
  const [modal, setModal] = useState(null);
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  const [expenseConceptFilter, setExpenseConceptFilter] = useState('');
  const expenseTableRef = useRef(null);
  const [columnWidths, setColumnWidths] = useState(DEFAULT_WIDTHS);

  const [cloudMode, setCloudMode] = useState(false);
  const [cloudRevision, setCloudRevision] = useState(0);
  const [cloudStatus, setCloudStatus] = useState({
    configured: null,
    connected: false,
    active: false,
    revision: 0,
    ledger: { count: 0, income: 0, expense: 0, result: 0 },
  });
  const [cloudSyncState, setCloudSyncState] = useState('local');
  const [cloudConflict, setCloudConflict] = useState('');
  const [cloudMigrationReport, setCloudMigrationReport] = useState(null);
  const [cloudMigrating, setCloudMigrating] = useState(false);

  const cloudRevisionRef = useRef(0);
  const cloudPendingRef = useRef(null);
  const cloudSyncingRef = useRef(false);
  const cloudSkipNextSyncRef = useRef(false);
  const cloudSyncTimerRef = useRef(null);

  useEffect(() => {
    const storedMovements = loadStored('puente.movements', initialMovements);
    const storedHours = loadStored('puente.hours', initialHours);
    const storedSaldoSnapshot = loadStored('puente.saldoSnapshot', null);
    const storedInstitutions = loadStored('puente.institutions', initialInstitutions);
    const storedInvestments = loadStored('puente.investments', initialInvestments);
    const storedConcepts = loadStored('puente.concepts', null);
    const storedAuditLog = loadStored('puente.auditLog', []);

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
    setInvestments(Array.isArray(storedInvestments) && storedInvestments.length ? storedInvestments : initialInvestments);
    setConcepts(Array.isArray(storedConcepts) && storedConcepts.length ? storedConcepts : initialConceptList);
    setAuditLog(Array.isArray(storedAuditLog) ? storedAuditLog : []);
    setDark(loadStored('puente.dark', false));
    setCompact(loadStored('puente.compact', false));
    setColumnWidths({
      ...DEFAULT_WIDTHS,
      ...loadStored('puente.ledgerColumnWidths', {}),
    });
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !user?.email) return;

    let cancelled = false;

    async function loadCloudOnStart() {
      try {
        const response = await fetch('/api/db/snapshot', { cache: 'no-store' });
        const payload = await response.json();

        if (cancelled) return;

        if (!response.ok) {
          setCloudStatus((current) => ({
            ...current,
            configured: payload?.code !== 'DATABASE_NOT_CONFIGURED',
            connected: false,
            error: payload?.error || 'No se pudo consultar PostgreSQL.',
          }));
          return;
        }

        const nextStatus = payload.status || {
          configured: true,
          connected: true,
          active: Boolean(payload.active),
          revision: Number(payload.revision || 0),
          ledger: { count: 0, income: 0, expense: 0, result: 0 },
        };

        setCloudStatus(nextStatus);

        const revision = Number(payload.revision ?? nextStatus.revision ?? 0);
        cloudRevisionRef.current = revision;
        setCloudRevision(revision);

        if (!payload.active) {
          setCloudMode(false);
          setCloudSyncState('local');
          return;
        }

        cloudSkipNextSyncRef.current = true;

        setMovements(Array.isArray(payload.movements) ? payload.movements : []);
        setHours(Array.isArray(payload.hours) ? payload.hours : []);
        setSaldoSnapshot({
          ...initialSaldoSnapshot,
          ...(payload.saldoSnapshot || {}),
        });
        setInstitutions(Array.isArray(payload.institutions) ? payload.institutions : []);
        setInvestments(Array.isArray(payload.investments) ? payload.investments : []);
        setConcepts(Array.isArray(payload.concepts) ? payload.concepts : []);
        setAuditLog(Array.isArray(payload.auditLog) ? payload.auditLog : []);

        setCloudConflict('');
        setCloudMode(true);
        setCloudSyncState('synced');
      } catch (error) {
        if (cancelled) return;
        console.error('Cloud startup load failed', error);
        setCloudStatus((current) => ({
          ...current,
          connected: false,
          error: 'No se pudo conectar con PostgreSQL.',
        }));
      }
    }

    loadCloudOnStart();

    return () => {
      cancelled = true;
    };
  }, [ready, user?.email]);

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
    saveStored('puente.investments', investments);
  }, [investments, ready]);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.concepts', concepts);
  }, [concepts, ready]);

  useEffect(() => {
    if (!ready) return;
    saveStored('puente.auditLog', auditLog);
  }, [auditLog, ready]);

  useEffect(() => {
    if (!ready || !cloudMode || cloudConflict) return;

    if (cloudSkipNextSyncRef.current) {
      cloudSkipNextSyncRef.current = false;
      return;
    }

    cloudPendingRef.current = {
      movements,
      hours,
      saldoSnapshot,
      institutions,
      investments,
      concepts,
      auditLog,
    };

    if (cloudSyncTimerRef.current) {
      clearTimeout(cloudSyncTimerRef.current);
    }

    cloudSyncTimerRef.current = setTimeout(() => {
      runCloudSync();
    }, 900);

    return () => {
      if (cloudSyncTimerRef.current) {
        clearTimeout(cloudSyncTimerRef.current);
      }
    };
  }, [
    movements,
    hours,
    saldoSnapshot,
    institutions,
    investments,
    concepts,
    auditLog,
    ready,
    cloudMode,
    cloudConflict,
  ]);

  useEffect(() => {
    if (!ready || !user?.email) return;

    fetch('/api/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: section }),
    }).catch(() => {});
  }, [section, ready, user?.email]);

  useEffect(() => {
    setExpenseConceptFilter('');
  }, [year, account, concept, query]);

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

  const accountTimelineData = useMemo(() => {
    const sourceRows = year === 'TODOS' ? filteredWithoutYear : filtered;
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    const validRows = sourceRows.filter((row) => /^\d{4}-\d{2}/.test(String(row.date || '')));
    if (!validRows.length) {
      return { periods: [], accounts: [] };
    }

    const sortedKeys = validRows
      .map((row) => String(row.date).slice(0, 7))
      .sort();

    const firstKey = year === 'TODOS' ? sortedKeys[0] : `${year}-01`;
    const lastKey = sortedKeys[sortedKeys.length - 1];

    const [firstYear, firstMonth] = firstKey.split('-').map(Number);
    const [lastYear, lastMonth] = lastKey.split('-').map(Number);

    const periods = [];
    let cursorYear = firstYear;
    let cursorMonth = firstMonth;

    while (
      cursorYear < lastYear ||
      (cursorYear === lastYear && cursorMonth <= lastMonth)
    ) {
      const key = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}`;
      periods.push({
        key,
        label: year === 'TODOS'
          ? `${monthNames[cursorMonth - 1]} ${String(cursorYear).slice(-2)}`
          : monthNames[cursorMonth - 1],
        fullLabel: `${monthNames[cursorMonth - 1]} ${cursorYear}`,
        income: 0,
        expense: 0,
        result: 0,
        accounts: {},
      });

      cursorMonth += 1;
      if (cursorMonth > 12) {
        cursorMonth = 1;
        cursorYear += 1;
      }
    }

    const byKey = new Map(periods.map((period) => [period.key, period]));
    const accountTotals = new Map();

    for (const row of validRows) {
      const key = String(row.date).slice(0, 7);
      const period = byKey.get(key);
      if (!period) continue;

      const accountName = String(row.account || 'SIN CUENTA').trim() || 'SIN CUENTA';
      const income = Number(row.income || 0);
      const expense = Number(row.expense || 0);
      const net = income - expense;

      period.income += income;
      period.expense += expense;
      period.result += net;
      period.accounts[accountName] = Number(period.accounts[accountName] || 0) + net;

      const current = accountTotals.get(accountName) || {
        name: accountName,
        income: 0,
        expense: 0,
        net: 0,
        magnitude: 0,
      };
      current.income += income;
      current.expense += expense;
      current.net += net;
      current.magnitude += Math.abs(income) + Math.abs(expense);
      accountTotals.set(accountName, current);
    }

    const accounts = [...accountTotals.values()]
      .sort((a, b) => b.magnitude - a.magnitude);

    return { periods, accounts };
  }, [year, filteredWithoutYear, filtered]);

  const monthlyIncomeByAccount = useMemo(() => {
    if (year === 'TODOS') {
      return {
        year: null,
        accounts: [],
        months: [],
        totalsByAccount: [],
        grandTotal: 0,
      };
    }

    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];

    const accountMap = new Map();
    const monthMap = Array.from({ length: 12 }, (_, index) => ({
      index,
      label: monthNames[index],
      shortLabel: monthNames[index].slice(0, 3),
      total: 0,
      accounts: {},
    }));

    for (const row of filtered) {
      const income = Number(row.income || 0);
      if (income <= 0) continue;

      const accountName = String(row.account || 'SIN CUENTA').trim() || 'SIN CUENTA';
      const monthIndex = Number(String(row.date || '').slice(5, 7)) - 1;
      if (monthIndex < 0 || monthIndex > 11) continue;

      const accountTotal = Number(accountMap.get(accountName) || 0) + income;
      accountMap.set(accountName, accountTotal);

      monthMap[monthIndex].accounts[accountName] =
        Number(monthMap[monthIndex].accounts[accountName] || 0) + income;
      monthMap[monthIndex].total += income;
    }

    const accounts = [...accountMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    const totalsByAccount = accounts.map((name) => ({
      name,
      total: Number(accountMap.get(name) || 0),
    }));

    return {
      year,
      accounts,
      months: monthMap,
      totalsByAccount,
      grandTotal: totalsByAccount.reduce((sum, item) => sum + item.total, 0),
    };
  }, [year, filtered]);

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
    () => calculateSaldo(movements, saldoSnapshot, institutions),
    [movements, saldoSnapshot, institutions]
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

  function openHistoricalConceptEdit(item) {
    const targetConcept = item?.concept || 'Sin concepto';
    const rows = filtered.filter(
      (row) => (row.concept || 'Sin concepto') === targetConcept
    );

    if (!rows.length) return;

    const years = [...new Set(rows.map(movementYear).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));

    setHistoricalEdit({
      oldConcept: targetConcept,
      newConcept: targetConcept === 'Sin concepto' ? '' : targetConcept,
      reason: '',
      affectedIds: rows.map((row) => row.id),
      affectedCount: rows.length,
      years,
      account: account === 'TODAS' ? 'Todas' : account,
      year: year === 'TODOS' ? 'Todos' : year,
      income: item?.income || 0,
      expense: item?.expense || 0,
      result: item?.result || 0,
      rows: rows.map((row) => ({
        id: row.id,
        date: row.date || '',
        account: row.account || '',
        detail: row.detail || '',
        operation: row.operation || '',
        invoice: row.invoice || '',
        concept: row.concept || '',
        income: Number(row.income || 0),
        expense: Number(row.expense || 0),
      })),
    });
  }

  function saveHistoricalConceptEdit(payload) {
    const nextConcept = String(payload?.newConcept || '').trim();
    const reason = String(payload?.reason || '').trim();
    const editedRows = Array.isArray(payload?.rows) ? payload.rows : [];

    if (!historicalEdit || !nextConcept || reason.length < 5) return;

    const originalById = new Map(
      (historicalEdit.rows || []).map((row) => [row.id, row])
    );
    const editedById = new Map(
      editedRows.map((row) => [row.id, row])
    );
    const ids = new Set(historicalEdit.affectedIds || []);

    const valueChanges = [];
    let nextIncome = 0;
    let nextExpense = 0;

    for (const id of ids) {
      const before = originalById.get(id);
      const after = editedById.get(id) || before;
      if (!before || !after) continue;

      const beforeIncome = Number(before.income || 0);
      const beforeExpense = Number(before.expense || 0);
      const afterIncome = Math.max(0, Number(after.income || 0));
      const afterExpense = Math.max(0, Number(after.expense || 0));

      nextIncome += afterIncome;
      nextExpense += afterExpense;

      if (
        Math.abs(beforeIncome - afterIncome) > 0.0001 ||
        Math.abs(beforeExpense - afterExpense) > 0.0001
      ) {
        valueChanges.push({
          id,
          date: before.date || '',
          detail: before.detail || '',
          operation: before.operation || '',
          beforeIncome,
          beforeExpense,
          afterIncome,
          afterExpense,
        });
      }
    }

    setMovements((prev) => prev.map((row) => {
      if (!ids.has(row.id)) return row;

      const edited = editedById.get(row.id);
      return {
        ...row,
        concept: nextConcept,
        income: edited ? Math.max(0, Number(edited.income || 0)) : Number(row.income || 0),
        expense: edited ? Math.max(0, Number(edited.expense || 0)) : Number(row.expense || 0),
      };
    }));

    if (!concepts.includes(nextConcept)) {
      setConcepts((prev) => [...prev, nextConcept]
        .sort((a, b) => a.localeCompare(b, 'es')));
    }

    if (concept === historicalEdit.oldConcept) {
      setConcept(nextConcept);
    }

    const nextResult = nextIncome - nextExpense;
    const conceptChanged = nextConcept !== historicalEdit.oldConcept;

    const logEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      userName: user?.name || 'Usuario',
      userEmail: user?.email || '',
      action: valueChanges.length && conceptChanged
        ? 'Edición histórica de concepto e importes'
        : valueChanges.length
          ? 'Edición histórica de importes'
          : 'Edición histórica de concepto',
      oldConcept: historicalEdit.oldConcept,
      newConcept: nextConcept,
      reason,
      account: historicalEdit.account,
      year: historicalEdit.year,
      years: historicalEdit.years,
      affectedCount: historicalEdit.affectedCount,
      affectedIds: historicalEdit.affectedIds,
      previousIncome: Number(historicalEdit.income || 0),
      previousExpense: Number(historicalEdit.expense || 0),
      previousResult: Number(historicalEdit.result || 0),
      newIncome: nextIncome,
      newExpense: nextExpense,
      newResult: nextResult,
      changedValueCount: valueChanges.length,
      valueChanges,
    };

    setAuditLog((prev) => [logEntry, ...prev].slice(0, 1000));
    setHistoricalEdit(null);
  }

  function openZeroAdjustment() {
    const result = Number(filteredTotals.income || 0) - Number(filteredTotals.expense || 0);
    if (Math.abs(result) < 0.005 || account === 'TODAS') return;

    const filteredYears = [...new Set(filtered.map(movementYear).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));

    const selectedYear =
      year !== 'TODOS'
        ? String(year)
        : filteredYears.length === 1
          ? String(filteredYears[0])
          : String(filteredYears[filteredYears.length - 1] || new Date().getFullYear());

    const currentYear = String(new Date().getFullYear());
    const defaultDate = Number(selectedYear) < Number(currentYear)
      ? `${selectedYear}-12-31`
      : new Date().toISOString().slice(0, 10);

    setZeroAdjustment({
      account,
      year: selectedYear,
      date: defaultDate,
      resultBefore: result,
      adjustmentIncome: result < 0 ? Math.abs(result) : 0,
      adjustmentExpense: result > 0 ? result : 0,
      reason: '',
    });
  }

  function saveZeroAdjustment(payload) {
    if (!zeroAdjustment) return;

    const reason = String(payload?.reason || '').trim();
    const date = String(payload?.date || zeroAdjustment.date || '').trim();

    if (reason.length < 5 || !date) return;

    const adjustment = {
      id: crypto.randomUUID(),
      date,
      account: zeroAdjustment.account,
      folder: 'Ajustes',
      concept: 'Redondeo Banco',
      detail: `Ajuste de cierre para llevar ${zeroAdjustment.account} a resultado $ 0,00`,
      operation: `AJ-${String(zeroAdjustment.year).replace(/\D/g, '')}-${Date.now().toString().slice(-6)}`,
      income: Number(zeroAdjustment.adjustmentIncome || 0),
      expense: Number(zeroAdjustment.adjustmentExpense || 0),
      invoice: '',
      notes: reason,
    };

    setMovements((prev) => [adjustment, ...prev]);

    if (!concepts.includes('Redondeo Banco')) {
      setConcepts((prev) => [...prev, 'Redondeo Banco']
        .sort((a, b) => a.localeCompare(b, 'es')));
    }

    const logEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      userName: user?.name || 'Usuario',
      userEmail: user?.email || '',
      action: 'Ajuste contable a resultado cero',
      oldConcept: '',
      newConcept: 'Redondeo Banco',
      reason,
      account: zeroAdjustment.account,
      year: zeroAdjustment.year,
      affectedCount: 1,
      affectedIds: [adjustment.id],
      previousIncome: Number(filteredTotals.income || 0),
      previousExpense: Number(filteredTotals.expense || 0),
      previousResult: Number(zeroAdjustment.resultBefore || 0),
      newIncome: Number(filteredTotals.income || 0) + Number(adjustment.income || 0),
      newExpense: Number(filteredTotals.expense || 0) + Number(adjustment.expense || 0),
      newResult: 0,
      changedValueCount: 0,
      valueChanges: [],
      adjustmentMovement: adjustment,
    };

    setAuditLog((prev) => [logEntry, ...prev].slice(0, 1000));
    setZeroAdjustment(null);
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
    setInvestments((prev) => prev.map((investment) => (
      investment.bank === item.name ? { ...investment, bank: cleanName } : investment
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

  function toggleInstitution(id) {
    setInstitutions((prev) => prev.map((entry) => (
      entry.id === id ? { ...entry, active: entry.active === false } : entry
    )));
  }

  function deleteInstitution(id) {
    const item = institutions.find((entry) => entry.id === id);
    if (!item) return;

    const used = movements.some((row) => row.account === item.name);
    if (used) {
      alert('Esta cuenta tiene movimientos históricos. Usá "Dar de baja" para ocultarla de nuevos registros sin perder el historial.');
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
    const usage = movements.filter((row) => row.concept === name).length;
    const message = usage
      ? `El concepto tiene ${usage.toLocaleString('es-AR')} movimientos históricos. La baja lo quitará de los nuevos registros, pero no modificará el historial. ¿Continuar?`
      : `¿Eliminar el concepto "${name}"?`;

    if (confirm(message)) {
      setConcepts((prev) => prev.filter((item) => item !== name));
      if (concept === name) setConcept('TODOS');
    }
  }

  function handleImport(payload) {
    const imported = payload.movements || [];
    setMovements(imported);

    if (payload.saldoSnapshot) {
      setSaldoSnapshot((prev) => ({ ...prev, ...payload.saldoSnapshot }));
    }

    if (Array.isArray(payload.investments) && payload.investments.length) {
      setInvestments(payload.investments);
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

  async function runCloudSync() {
    if (cloudSyncingRef.current || !cloudPendingRef.current || !cloudMode) return;

    const snapshot = cloudPendingRef.current;
    cloudPendingRef.current = null;
    cloudSyncingRef.current = true;
    setCloudSyncState('syncing');

    try {
      const response = await fetch('/api/db/snapshot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevision: cloudRevisionRef.current,
          snapshot,
        }),
      });

      const payload = await response.json();

      if (response.status === 409 && payload?.code === 'REVISION_CONFLICT') {
        const message = payload.error || 'La nube tiene una versión más nueva.';
        setCloudConflict(message);
        setCloudSyncState('conflict');
        cloudPendingRef.current = null;
        return;
      }

      if (!response.ok) {
        throw new Error(payload?.error || 'CLOUD_SYNC_FAILED');
      }

      const nextRevision = Number(payload.revision || cloudRevisionRef.current);
      cloudRevisionRef.current = nextRevision;
      setCloudRevision(nextRevision);
      setCloudStatus((current) => ({
        ...current,
        connected: true,
        active: true,
        revision: nextRevision,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || user?.name || '',
        ledger: {
          count: Number(payload.summary?.count || 0),
          income: Number(payload.summary?.income || 0),
          expense: Number(payload.summary?.expense || 0),
          result:
            Number(payload.summary?.income || 0) -
            Number(payload.summary?.expense || 0),
        },
      }));
      setCloudSyncState('synced');
    } catch (error) {
      console.error('Cloud sync failed', error);
      setCloudSyncState('error');
    } finally {
      cloudSyncingRef.current = false;

      if (cloudPendingRef.current && !cloudConflict) {
        setTimeout(() => runCloudSync(), 80);
      }
    }
  }

  async function reloadFromCloud() {
    try {
      setCloudSyncState('syncing');

      const response = await fetch('/api/db/snapshot', { cache: 'no-store' });
      const payload = await response.json();

      if (!response.ok || !payload.active) {
        throw new Error(payload?.error || 'CLOUD_RELOAD_FAILED');
      }

      cloudSkipNextSyncRef.current = true;
      cloudPendingRef.current = null;

      setMovements(Array.isArray(payload.movements) ? payload.movements : []);
      setHours(Array.isArray(payload.hours) ? payload.hours : []);
      setSaldoSnapshot({
        ...initialSaldoSnapshot,
        ...(payload.saldoSnapshot || {}),
      });
      setInstitutions(Array.isArray(payload.institutions) ? payload.institutions : []);
      setInvestments(Array.isArray(payload.investments) ? payload.investments : []);
      setConcepts(Array.isArray(payload.concepts) ? payload.concepts : []);
      setAuditLog(Array.isArray(payload.auditLog) ? payload.auditLog : []);

      const nextRevision = Number(payload.revision || 0);
      cloudRevisionRef.current = nextRevision;
      setCloudRevision(nextRevision);
      setCloudStatus(payload.status || {
        configured: true,
        connected: true,
        active: true,
        revision: nextRevision,
        ledger: summarize(payload.movements || {}),
      });

      setCloudConflict('');
      setCloudMode(true);
      setCloudSyncState('synced');
    } catch (error) {
      console.error('Cloud reload failed', error);
      setCloudSyncState('error');
    }
  }

  async function migrateLocalDataToCloud() {
    if (user?.role !== 'admin') return;

    const confirmed = confirm(
      'Se copiarán los datos actuales de este navegador a PostgreSQL y se verificarán cantidad de movimientos, Entradas, Salidas y Resultado. Los datos locales no se borrarán. ¿Continuar?'
    );

    if (!confirmed) return;

    setCloudMigrating(true);
    setCloudMigrationReport(null);
    setCloudConflict('');

    const snapshot = {
      movements,
      hours,
      saldoSnapshot,
      institutions,
      investments,
      concepts,
      auditLog,
    };

    try {
      const response = await fetch('/api/db/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setCloudMigrationReport(payload);
        setCloudStatus(payload.status || cloudStatus);
        alert(payload.error || 'No se pudo completar la migración.');
        return;
      }

      const nextRevision = Number(payload.revision || 0);
      cloudRevisionRef.current = nextRevision;
      cloudSkipNextSyncRef.current = true;

      setCloudRevision(nextRevision);
      setCloudMigrationReport(payload);
      setCloudStatus(payload.status || {
        configured: true,
        connected: true,
        active: true,
        revision: nextRevision,
        ledger: payload.cloud,
      });
      setCloudMode(true);
      setCloudSyncState('synced');
    } catch (error) {
      console.error('Cloud migration failed', error);
      alert('No se pudo completar la migración a PostgreSQL.');
    } finally {
      setCloudMigrating(false);
    }
  }

  function selectExpenseConcept(name) {
    const next = expenseConceptFilter === name ? '' : name;
    setExpenseConceptFilter(next);

    requestAnimationFrame(() => {
      expenseTableRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
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
          {user && <AuthToolbar user={user} />}

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

            <InvestmentsPanel
              investments={investments}
              accounts={availableAccounts}
              onChange={setInvestments}
            />
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

            {account !== 'TODAS' && Math.abs(filteredTotals.income - filteredTotals.expense) >= 0.005 && (
              <div className="zero-adjustment-bar">
                <div>
                  <strong>Resultado pendiente: {money.format(filteredTotals.income - filteredTotals.expense)}</strong>
                  <span>
                    Podés generar un movimiento de ajuste para que el resultado real de {account} quede exactamente en $ 0,00.
                  </span>
                </div>
                <button type="button" className="secondary zero-adjustment-button" onClick={openZeroAdjustment}>
                  Ajustar a $ 0
                </button>
              </div>
            )}

            <Card title={year === 'TODOS' ? 'Evolución mensual por cuenta · todos los años' : `Evolución mensual por cuenta · ${year}`}>
              <AccountTimelineChart
                data={accountTimelineData}
                allYears={year === 'TODOS'}
              />
            </Card>

            <Card title={year === 'TODOS' ? 'Ingresos mensuales por cuenta' : `Ingresos mensuales por cuenta · ${year}`}>
              {year === 'TODOS' ? (
                <div className="monthly-account-empty">
                  Seleccioná un año para ver los ingresos mensuales separados por cuenta.
                </div>
              ) : (
                <MonthlyAccountIncomeChart data={monthlyIncomeByAccount} />
              )}
            </Card>

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
                      <tr
                        key={item.concept}
                        className="statistics-edit-row"
                        onDoubleClick={() => openHistoricalConceptEdit(item)}
                        title="Doble clic para editar la clasificación y dejar trazabilidad"
                      >
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

        {section === 'ai' && (
          <>
            <Header
              title="Análisis IA"
              subtitle="Análisis automático del Libro de contabilidad por ejercicio."
            />

            <AiAnalysisPanel
              movements={movements}
              investments={investments}
              years={availableYears}
            />
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
                <Bars
                  data={categoryExpenses}
                  selected={expenseConceptFilter}
                  onSelect={selectExpenseConcept}
                />
              </Card>

              <Card title="Participación por concepto">
                <div className="concept-share">
                  {categoryExpenses.map(([name, value]) => (
                    <button
                      type="button"
                      className={expenseConceptFilter === name
                        ? 'concept-share-row concept-share-button selected'
                        : 'concept-share-row concept-share-button'}
                      key={name}
                      onClick={() => selectExpenseConcept(name)}
                      title={`Filtrar la grilla por ${name}`}
                    >
                      <span title={name}>{name}</span>
                      <div className="concept-share-track">
                        <i style={{ width: expenseTotal ? `${Math.max(2, (value / expenseTotal) * 100)}%` : '0%' }} />
                      </div>
                      <b>{expenseTotal ? percent.format(value / expenseTotal) : '0,0 %'}</b>
                    </button>
                  ))}
                </div>
              </Card>
            </div>

            <Card>
              <div ref={expenseTableRef}>
                <ExpenseTable
                  rows={expenses}
                  compact={compact}
                  conceptFilter={expenseConceptFilter}
                  setConceptFilter={setExpenseConceptFilter}
                  onDelete={removeMovement}
                  onEdit={openEditMovement}
                />
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

            <CloudDatabasePanel
              user={user}
              status={cloudStatus}
              syncState={cloudSyncState}
              conflict={cloudConflict}
              localSummary={ledgerTotals}
              migrationReport={cloudMigrationReport}
              onMigrate={migrateLocalDataToCloud}
              onReload={reloadFromCloud}
              migrating={cloudMigrating}
            />

            <BackupTools
              user={user}
              movements={movements}
              hours={hours}
              investments={investments}
              institutions={institutions}
              concepts={concepts}
              saldoSnapshot={saldoSnapshot}
              auditLog={auditLog}
            />

            <ConfigurationPanel
              institutions={institutions}
              concepts={concepts}
              movements={movements}
              onAddInstitution={addInstitution}
              onRenameInstitution={renameInstitution}
              onToggleInstitution={toggleInstitution}
              onDeleteInstitution={deleteInstitution}
              onAddConcept={addConcept}
              onRenameConcept={renameConcept}
              onDeleteConcept={deleteConcept}
            />

            <AuditLogCard auditLog={auditLog} />
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

      {historicalEdit && (
        <HistoricalConceptModal
          edit={historicalEdit}
          conceptOptions={availableConcepts}
          onClose={() => setHistoricalEdit(null)}
          onSave={saveHistoricalConceptEdit}
        />
      )}

      {zeroAdjustment && (
        <ZeroAdjustmentModal
          adjustment={zeroAdjustment}
          onClose={() => setZeroAdjustment(null)}
          onSave={saveZeroAdjustment}
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

function Bars({ data, onSelect, selected = '' }) {
  const max = Math.max(...data.map((x) => x[1]), 1);

  return (
    <div className="bars expense-bars">
      {data.map(([name, value]) => (
        <button
          type="button"
          className={selected === name ? 'expense-bar-item selected' : 'expense-bar-item'}
          key={name}
          onClick={() => onSelect?.(name)}
          title={`Filtrar grilla por ${name}`}
        >
          <div><span title={name}>{name}</span><b>{money.format(value)}</b></div>
          <div className="bar"><i style={{ width: `${(value / max) * 100}%` }} /></div>
        </button>
      ))}
    </div>
  );
}

function ExpenseTable({
  rows,
  compact,
  conceptFilter,
  setConceptFilter,
  onDelete,
  onEdit,
}) {
  const [detailFilter, setDetailFilter] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');

  const conceptOptions = useMemo(
    () => [...new Set(rows.map((row) => String(row.concept || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es')),
    [rows]
  );

  const detailOptions = useMemo(
    () => [...new Set(rows.map((row) => String(row.detail || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es')),
    [rows]
  );

  const visibleRows = useMemo(() => {
    const conceptQuery = String(conceptFilter || '').trim().toLowerCase();
    const detailQuery = String(detailFilter || '').trim().toLowerCase();

    const filteredRows = rows.filter((row) => {
      if (
        conceptQuery &&
        !String(row.concept || '').toLowerCase().includes(conceptQuery)
      ) {
        return false;
      }

      if (
        detailQuery &&
        !String(row.detail || '').toLowerCase().includes(detailQuery)
      ) {
        return false;
      }

      return true;
    });

    const direction = sortDirection === 'asc' ? 1 : -1;

    return filteredRows.slice().sort((a, b) => {
      if (sortKey === 'expense') {
        return (Number(a.expense || 0) - Number(b.expense || 0)) * direction;
      }

      if (sortKey === 'date') {
        return String(a.date || '').localeCompare(String(b.date || '')) * direction;
      }

      return String(a[sortKey] || '').localeCompare(
        String(b[sortKey] || ''),
        'es',
        { sensitivity: 'base' }
      ) * direction;
    });
  }, [rows, conceptFilter, detailFilter, sortKey, sortDirection]);

  const visibleTotal = useMemo(
    () => visibleRows.reduce((sum, row) => sum + Number(row.expense || 0), 0),
    [visibleRows]
  );

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDirection((current) => current === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDirection(key === 'expense' || key === 'date' ? 'desc' : 'asc');
    }
  }

  function sortIndicator(key) {
    if (sortKey !== key) return '↕';
    return sortDirection === 'desc' ? '↓' : '↑';
  }

  return (
    <>
      <div className="expense-grid-summary">
        <div>
          <span>Registros visibles</span>
          <strong>{number.format(visibleRows.length)}</strong>
        </div>
        <div className="expense-grid-sum">
          <span>Suma de montos filtrados</span>
          <strong>{money.format(visibleTotal)}</strong>
        </div>
        {(conceptFilter || detailFilter) && (
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              setConceptFilter('');
              setDetailFilter('');
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div className={compact ? 'table-wrap compact-table' : 'table-wrap'}>
        <table className="expense-detail-table">
          <thead>
            <tr className="expense-sort-row">
              <th>
                <button type="button" onClick={() => toggleSort('date')}>
                  Fecha <span>{sortIndicator('date')}</span>
                </button>
              </th>
              <th>
                <button type="button" onClick={() => toggleSort('account')}>
                  Cuenta <span>{sortIndicator('account')}</span>
                </button>
              </th>
              <th>
                <button type="button" onClick={() => toggleSort('concept')}>
                  Concepto <span>{sortIndicator('concept')}</span>
                </button>
              </th>
              <th>
                <button type="button" onClick={() => toggleSort('detail')}>
                  Detalle <span>{sortIndicator('detail')}</span>
                </button>
              </th>
              <th>
                <button type="button" onClick={() => toggleSort('invoice')}>
                  Factura <span>{sortIndicator('invoice')}</span>
                </button>
              </th>
              <th>
                <button type="button" onClick={() => toggleSort('expense')}>
                  Monto <span>{sortIndicator('expense')}</span>
                </button>
              </th>
              <th></th>
            </tr>

            <tr className="expense-column-filters">
              <th></th>
              <th></th>
              <th>
                <input
                  list="expense-concept-options"
                  value={conceptFilter}
                  onChange={(event) => setConceptFilter(event.target.value)}
                  placeholder="Filtrar o escribir concepto…"
                  aria-label="Filtrar concepto"
                />
                <datalist id="expense-concept-options">
                  {conceptOptions.map((item) => <option key={item} value={item} />)}
                </datalist>
              </th>
              <th>
                <input
                  list="expense-detail-options"
                  value={detailFilter}
                  onChange={(event) => setDetailFilter(event.target.value)}
                  placeholder="Filtrar o escribir detalle…"
                  aria-label="Filtrar detalle"
                />
                <datalist id="expense-detail-options">
                  {detailOptions.map((item) => <option key={item} value={item} />)}
                </datalist>
              </th>
              <th></th>
              <th className="expense-filter-total-label">
                Σ {money.format(visibleTotal)}
              </th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {visibleRows.map((m) => (
              <tr
                key={m.id}
                className="editable-ledger-row"
                onClick={() => onEdit?.(m)}
                title="Clic para editar el movimiento"
              >
                <td>{formatDate(m.date)}</td>
                <td>{m.account}</td>
                <td>{m.concept}</td>
                <td className="expense-detail-cell" title={m.detail}>{m.detail}</td>
                <td>{m.invoice || '-'}</td>
                <td className="expense money-cell">{money.format(m.expense)}</td>
                <td>
                  <button
                    className="icon-btn danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(m.id);
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}

            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={7} className="expense-empty-row">
                  No hay gastos que coincidan con los filtros de la grilla.
                </td>
              </tr>
            )}
          </tbody>

          <tfoot className="expense-table-total">
            <tr>
              <td colSpan={5}>
                <strong>TOTAL FILTRADO</strong>
                <span>{number.format(visibleRows.length)} movimientos</span>
              </td>
              <td className="expense money-cell">
                <strong>{money.format(visibleTotal)}</strong>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function AccountTimelineChart({ data, allYears }) {
  const [chartType, setChartType] = useState('lines');
  const [hiddenSeries, setHiddenSeries] = useState(() => new Set(['__income', '__expense']));

  const periods = data?.periods || [];
  const accounts = data?.accounts || [];

  const accountColors = {
    'CREDICOOP': '#8bd648',
    'MERCADO LIBRE': '#22b7d9',
    'MERCADO LIBRE 2': '#a93b0f',
    'EFECTIVO': '#ffe900',
    'PREX': '#9c8d6b',
    'PERSONAL PAY': '#efc5bd',
  };

  const colorForAccount = (name, index) => {
    return accountColors[String(name || '').toUpperCase()] || `hsl(${(index * 47 + 18) % 360} 72% 56%)`;
  };

  const series = useMemo(() => {
    const accountSeries = accounts.map((item, index) => ({
      key: `account:${item.name}`,
      label: item.name,
      color: colorForAccount(item.name, index),
      type: 'account',
      values: periods.map((period) => Number(period.accounts?.[item.name] || 0)),
      total: Number(item.net || 0),
      magnitude: Number(item.magnitude || 0),
    }));

    const resultValues = periods.map((period) => Number(period.result || 0));

    // Tendencia logarítmica real: y = a * ln(x) + b.
    // x es 1..N (siempre positivo), por lo que admite resultados y negativos.
    let logA = 0;
    let logB = resultValues[0] || 0;

    if (resultValues.length > 1) {
      const n = resultValues.length;
      let sumLogX = 0;
      let sumY = 0;
      let sumLogXY = 0;
      let sumLogX2 = 0;

      resultValues.forEach((value, index) => {
        const logX = Math.log(index + 1);
        sumLogX += logX;
        sumY += value;
        sumLogXY += logX * value;
        sumLogX2 += logX * logX;
      });

      const denominator = n * sumLogX2 - sumLogX * sumLogX;
      if (Math.abs(denominator) > 1e-12) {
        logA = (n * sumLogXY - sumLogX * sumY) / denominator;
        logB = (sumY - logA * sumLogX) / n;
      }
    }

    const trendValues = periods.map((_, index) => logA * Math.log(index + 1) + logB);

    return [
      ...accountSeries,
      {
        key: '__result',
        label: 'Resultado total',
        color: '#f0c34e',
        type: 'result',
        values: resultValues,
        total: resultValues.reduce((sum, value) => sum + value, 0),
      },
      {
        key: '__trend',
        label: 'Tendencia resultado (log.)',
        color: '#f7d36b',
        type: 'trend',
        values: trendValues,
        total: trendValues[trendValues.length - 1] || 0,
        logA,
      },
      {
        key: '__income',
        label: 'Ingresos totales',
        color: '#10b981',
        type: 'income',
        values: periods.map((period) => Number(period.income || 0)),
        total: periods.reduce((sum, period) => sum + Number(period.income || 0), 0),
      },
      {
        key: '__expense',
        label: 'Egresos totales',
        color: '#ff4f5f',
        type: 'expense',
        values: periods.map((period) => -Number(period.expense || 0)),
        total: periods.reduce((sum, period) => sum + Number(period.expense || 0), 0),
      },
    ];
  }, [accounts, periods]);

  const visibleSeries = series.filter((item) => !hiddenSeries.has(item.key));
  const visibleLineSeries = visibleSeries.filter((item) => item.type !== 'trend' || chartType === 'lines');

  const width = Math.max(1080, periods.length * (allYears ? 62 : 78));
  const height = 390;
  const padding = { left: 74, right: 34, top: 28, bottom: 72 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const scaleValues = visibleLineSeries.flatMap((item) => item.values);
  const minValue = Math.min(0, ...scaleValues, -1);
  const maxValue = Math.max(0, ...scaleValues, 1);
  const range = Math.max(1, maxValue - minValue);

  const x = (index) => (
    periods.length <= 1
      ? padding.left + plotWidth / 2
      : padding.left + (index / (periods.length - 1)) * plotWidth
  );

  const y = (value) => padding.top + ((maxValue - value) / range) * plotHeight;
  const zeroY = y(0);

  function toggleSeries(key) {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function showAll() {
    setHiddenSeries(new Set());
  }

  function showAccountsOnly() {
    setHiddenSeries(new Set(['__income', '__expense', '__result', '__trend']));
  }

  const pieSeries = accounts
    .map((item, index) => ({
      key: `account:${item.name}`,
      label: item.name,
      color: colorForAccount(item.name, index),
      value: Number(item.magnitude || 0),
    }))
    .filter((item) => item.value > 0 && !hiddenSeries.has(item.key));

  const pieTotal = pieSeries.reduce((sum, item) => sum + item.value, 0);
  let pieCursor = 0;
  const pieStops = pieSeries.map((item) => {
    const start = pieCursor;
    const end = pieTotal ? start + (item.value / pieTotal) * 100 : start;
    pieCursor = end;
    return `${item.color} ${start}% ${end}%`;
  });

  const totalIncome = periods.reduce((sum, item) => sum + Number(item.income || 0), 0);
  const totalExpense = periods.reduce((sum, item) => sum + Number(item.expense || 0), 0);
  const totalResult = totalIncome - totalExpense;

  const trendSeries = series.find((item) => item.key === '__trend');

  return (
    <div className="concept-timeline-chart">
      <div className="concept-timeline-toolbar">
        <div>
          <strong>Eje mensual</strong>
          <span>
            {allYears
              ? 'Cada punto corresponde a un mes y año. Cada línea representa el movimiento neto mensual de una cuenta.'
              : 'Cada punto corresponde a un mes del ejercicio. Cada línea representa Entradas − Salidas de una cuenta.'}
          </span>
        </div>

        <div className="concept-chart-actions">
          <label>
            Tipo de gráfico
            <select value={chartType} onChange={(event) => setChartType(event.target.value)}>
              <option value="lines">Líneas</option>
              <option value="bars">Barras</option>
              <option value="pie">Torta</option>
              <option value="donut">Dona</option>
            </select>
          </label>
          <button type="button" className="secondary small" onClick={showAll}>Mostrar todas</button>
          <button type="button" className="secondary small" onClick={showAccountsOnly}>Solo cuentas</button>
        </div>
      </div>

      <div className="concept-series-legend">
        {series.map((item) => {
          const hidden = hiddenSeries.has(item.key);
          return (
            <button
              type="button"
              key={item.key}
              className={hidden ? 'concept-legend-item off' : 'concept-legend-item'}
              onClick={() => toggleSeries(item.key)}
              title={hidden ? `Mostrar ${item.label}` : `Ocultar ${item.label}`}
            >
              <i
                style={{
                  background: item.type === 'trend' ? 'transparent' : item.color,
                  borderTop: item.type === 'trend' ? `2px dashed ${item.color}` : 'none',
                }}
              />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {(chartType === 'lines' || chartType === 'bars') && (
        <div className="concept-chart-scroll">
          <svg
            className="concept-timeline-svg"
            viewBox={`0 0 ${width} ${height}`}
            style={{ minWidth: `${width}px` }}
            role="img"
            aria-label="Evolución mensual de todas las cuentas"
          >
            {[0, 1, 2, 3, 4].map((step) => {
              const gy = padding.top + (plotHeight / 4) * step;
              return (
                <line
                  key={step}
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={gy}
                  y2={gy}
                  className="concept-grid-line"
                />
              );
            })}

            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={zeroY}
              y2={zeroY}
              className="concept-zero-line"
            />

            {chartType === 'lines' && visibleLineSeries.map((item) => {
              const points = item.values
                .map((value, index) => `${x(index)},${y(value)}`)
                .join(' ');

              return (
                <g key={item.key}>
                  <polyline
                    points={points}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={item.type === 'trend' ? 3 : item.type === 'result' ? 3.5 : 2.2}
                    strokeDasharray={item.type === 'trend' ? '10 8' : undefined}
                    opacity={item.type === 'account' ? 0.88 : 1}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />

                  {item.type !== 'trend' && item.values.map((value, index) => (
                    <circle
                      key={`${item.key}-${periods[index]?.key}`}
                      cx={x(index)}
                      cy={y(value)}
                      r={item.type === 'account' ? 2.5 : 4}
                      fill={item.color}
                      className="concept-line-point"
                    >
                      <title>
                        {periods[index]?.fullLabel} · {item.label}: {money.format(value)}
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}

            {chartType === 'bars' && periods.map((period, periodIndex) => {
              const barSeries = visibleSeries.filter((item) => item.type !== 'trend');
              const availableWidth = periods.length > 1 ? plotWidth / periods.length : 70;
              const groupWidth = Math.min(availableWidth * 0.78, 52);
              const barWidth = Math.max(1.5, groupWidth / Math.max(barSeries.length, 1));
              const startX = x(periodIndex) - (barWidth * barSeries.length) / 2;

              return barSeries.map((item, seriesIndex) => {
                const value = Number(item.values[periodIndex] || 0);
                const valueY = y(value);
                const rectY = value >= 0 ? valueY : zeroY;
                const rectHeight = Math.max(1, Math.abs(zeroY - valueY));

                return (
                  <rect
                    key={`${period.key}-${item.key}`}
                    x={startX + seriesIndex * barWidth}
                    y={rectY}
                    width={Math.max(1, barWidth - 0.6)}
                    height={rectHeight}
                    fill={item.color}
                    opacity={item.type === 'account' ? 0.82 : 1}
                  >
                    <title>
                      {period.fullLabel} · {item.label}: {money.format(value)}
                    </title>
                  </rect>
                );
              });
            })}

            {periods.map((period, index) => (
              <text
                key={period.key}
                x={x(index)}
                y={height - 26}
                className="concept-axis-label"
                textAnchor="end"
                transform={`rotate(-45 ${x(index)} ${height - 26})`}
              >
                {period.label}
              </text>
            ))}
          </svg>
        </div>
      )}

      {(chartType === 'pie' || chartType === 'donut') && (
        <div className="concept-pie-layout">
          <div
            className={chartType === 'donut' ? 'concept-pie donut' : 'concept-pie'}
            style={{
              background: pieStops.length
                ? `conic-gradient(${pieStops.join(',')})`
                : 'var(--border)',
            }}
          >
            {chartType === 'donut' && (
              <div className="concept-donut-center">
                <small>Movimiento</small>
                <strong>{money.format(pieTotal)}</strong>
              </div>
            )}
          </div>

          <div className="concept-pie-list">
            <h4>Participación por cuenta</h4>
            <p>
              La torta/dona usa el movimiento absoluto de cada cuenta para que entradas y salidas
              no se cancelen entre sí.
            </p>
            {pieSeries.map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => toggleSeries(item.key)}
              >
                <i style={{ background: item.color }} />
                <span>{item.label}</span>
                <strong>{pieTotal ? ((item.value / pieTotal) * 100).toFixed(1) : '0,0'}%</strong>
                <small>{money.format(item.value)}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {chartType === 'lines' && trendSeries && !hiddenSeries.has('__trend') && (
        <div className="trend-explanation">
          <strong>Tendencia logarítmica del resultado</strong>
          <span>
            Se calcula sobre el resultado mensual con la ecuación y = a·ln(x) + b,
            usando cada mes como un punto independiente.
            {trendSeries.logA > 0
              ? ' La tendencia logarítmica es ascendente.'
              : trendSeries.logA < 0
                ? ' La tendencia logarítmica es descendente.'
                : ' La tendencia se mantiene prácticamente estable.'}
          </span>
        </div>
      )}

      <div className="income-expense-totals">
        <div>
          <span>Ingresos del período</span>
          <strong className="income">{money.format(totalIncome)}</strong>
        </div>
        <div>
          <span>Egresos del período</span>
          <strong className="expense">{money.format(totalExpense)}</strong>
        </div>
        <div>
          <span>Resultado</span>
          <strong className={totalResult >= 0 ? 'income' : 'expense'}>{money.format(totalResult)}</strong>
        </div>
      </div>
    </div>
  );
}

function MonthlyAccountIncomeChart({ data }) {
  const palette = [
    '#8bd648',
    '#22b7d9',
    '#a93b0f',
    '#ffe900',
    '#9c8d6b',
    '#efc5bd',
    '#7b62d9',
    '#ee8b2b',
    '#39a26f',
    '#657b91',
  ];

  const maxMonth = Math.max(
    1,
    ...data.months.map((month) => Number(month.total || 0))
  );

  return (
    <div className="monthly-account-income">
      <div className="monthly-account-head">
        <div>
          <span>Ingresos acumulados del año</span>
          <strong>{money.format(data.grandTotal || 0)}</strong>
        </div>

        <div className="monthly-account-legend">
          {data.totalsByAccount.map((account, index) => (
            <span key={account.name} title={money.format(account.total)}>
              <i style={{ background: palette[index % palette.length] }} />
              {account.name}
              <b>{money.format(account.total)}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="monthly-account-chart" role="img" aria-label="Ingresos mensuales por cuenta">
        {data.months.map((month) => {
          const height = (Number(month.total || 0) / maxMonth) * 100;
          let accumulated = 0;

          return (
            <div className="monthly-account-column" key={month.index}>
              <div className="monthly-account-value">
                {month.total > 0 ? money.format(month.total) : ''}
              </div>

              <div
                className="monthly-account-stack"
                style={{ height: `${height}%` }}
                title={`${month.label}: ${money.format(month.total || 0)}`}
              >
                {data.accounts.map((accountName, index) => {
                  const amount = Number(month.accounts[accountName] || 0);
                  if (amount <= 0 || month.total <= 0) return null;

                  const share = (amount / month.total) * 100;
                  const bottom = accumulated;
                  accumulated += share;

                  return (
                    <i
                      key={accountName}
                      style={{
                        height: `${share}%`,
                        bottom: `${bottom}%`,
                        background: palette[index % palette.length],
                      }}
                      title={`${month.label} · ${accountName}: ${money.format(amount)}`}
                    />
                  );
                })}
              </div>

              <strong>{month.shortLabel}</strong>
            </div>
          );
        })}
      </div>

      <div className="table-wrap monthly-account-table-wrap">
        <table className="monthly-account-table">
          <thead>
            <tr>
              <th>Mes</th>
              {data.accounts.map((account) => (
                <th key={account}>{account}</th>
              ))}
              <th>Total mensual</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((month) => (
              <tr key={month.index}>
                <td><strong>{month.label}</strong></td>
                {data.accounts.map((account) => (
                  <td className="income money-cell" key={account}>
                    {money.format(Number(month.accounts[account] || 0))}
                  </td>
                ))}
                <td className="income money-cell">
                  <strong>{money.format(month.total || 0)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>TOTAL AÑO</strong></td>
              {data.totalsByAccount.map((account) => (
                <td className="income money-cell" key={account.name}>
                  <strong>{money.format(account.total || 0)}</strong>
                </td>
              ))}
              <td className="income money-cell">
                <strong>{money.format(data.grandTotal || 0)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ConfigurationPanel({
  institutions,
  concepts,
  movements,
  onAddInstitution,
  onRenameInstitution,
  onToggleInstitution,
  onDeleteInstitution,
  onAddConcept,
  onRenameConcept,
  onDeleteConcept,
}) {
  const [newInstitution, setNewInstitution] = useState({ name: '', type: 'Banco' });
  const [editingInstitution, setEditingInstitution] = useState(null);
  const [newConcept, setNewConcept] = useState('');
  const [editingConcept, setEditingConcept] = useState(null);

  const institutionUsage = useMemo(() => {
    const map = {};
    for (const row of movements) {
      const key = String(row.account || '').trim();
      if (!key) continue;
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [movements]);

  const conceptUsage = useMemo(() => {
    const map = {};
    for (const row of movements) {
      const key = String(row.concept || '').trim();
      if (!key) continue;
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [movements]);

  function submitInstitution(event) {
    event.preventDefault();
    if (onAddInstitution(newInstitution.name, newInstitution.type)) {
      setNewInstitution({ name: '', type: 'Banco' });
    }
  }

  function submitConcept(event) {
    event.preventDefault();
    if (onAddConcept(newConcept)) setNewConcept('');
  }

  return (
    <div className="configuration-layout">
      <Card title="Bancos, billeteras y otros medios">
        <div className="configuration-help">
          Todo el sistema toma los nombres desde acá. Si renombrás una cuenta,
          también se actualizan los movimientos históricos que usan ese nombre.
        </div>

        <form className="config-add-form" onSubmit={submitInstitution}>
          <input
            value={newInstitution.name}
            onChange={(event) => setNewInstitution((current) => ({
              ...current,
              name: event.target.value,
            }))}
            placeholder="Nombre, por ejemplo CREDICOOP"
            required
          />
          <select
            value={newInstitution.type}
            onChange={(event) => setNewInstitution((current) => ({
              ...current,
              type: event.target.value,
            }))}
          >
            <option>Banco</option>
            <option>Billetera virtual</option>
            <option>Efectivo</option>
            <option>Otro</option>
          </select>
          <button className="primary" type="submit">＋ Agregar</button>
        </form>

        <div className="table-wrap">
          <table className="configuration-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Movimientos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((item) => {
                const editing = editingInstitution?.id === item.id;
                return (
                  <tr key={item.id}>
                    <td>
                      {editing ? (
                        <input
                          value={editingInstitution.name}
                          onChange={(event) => setEditingInstitution((current) => ({
                            ...current,
                            name: event.target.value,
                          }))}
                        />
                      ) : (
                        <strong>{item.name}</strong>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select
                          value={editingInstitution.type}
                          onChange={(event) => setEditingInstitution((current) => ({
                            ...current,
                            type: event.target.value,
                          }))}
                        >
                          <option>Banco</option>
                          <option>Billetera virtual</option>
                          <option>Efectivo</option>
                          <option>Otro</option>
                        </select>
                      ) : (
                        <span className="config-type-pill">{item.type}</span>
                      )}
                    </td>
                    <td>
                      <span className={item.active === false ? 'config-status off' : 'config-status on'}>
                        {item.active === false ? 'Baja' : 'Activo'}
                      </span>
                    </td>
                    <td>{number.format(institutionUsage[item.name] || 0)}</td>
                    <td>
                      <div className="config-actions">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              className="primary small"
                              onClick={() => {
                                onRenameInstitution(
                                  item.id,
                                  editingInstitution.name,
                                  editingInstitution.type
                                );
                                setEditingInstitution(null);
                              }}
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => setEditingInstitution(null)}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => setEditingInstitution({
                                id: item.id,
                                name: item.name,
                                type: item.type,
                              })}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => onToggleInstitution(item.id)}
                            >
                              {item.active === false ? 'Activar' : 'Dar de baja'}
                            </button>
                            <button
                              type="button"
                              className="secondary small danger-text"
                              onClick={() => onDeleteInstitution(item.id)}
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Conceptos">
        <div className="configuration-help">
          Los conceptos del Libro se administran desde esta lista. Al renombrar
          uno, se actualiza automáticamente en todos los movimientos asociados.
        </div>

        <form className="config-add-form config-add-concept" onSubmit={submitConcept}>
          <input
            value={newConcept}
            onChange={(event) => setNewConcept(event.target.value)}
            placeholder="Nuevo concepto"
            required
          />
          <button className="primary" type="submit">＋ Agregar concepto</button>
        </form>

        <div className="table-wrap config-concepts-table-wrap">
          <table className="configuration-table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Movimientos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((item) => {
                const editing = editingConcept?.original === item;
                return (
                  <tr key={item}>
                    <td>
                      {editing ? (
                        <input
                          value={editingConcept.value}
                          onChange={(event) => setEditingConcept((current) => ({
                            ...current,
                            value: event.target.value,
                          }))}
                        />
                      ) : item}
                    </td>
                    <td>{number.format(conceptUsage[item] || 0)}</td>
                    <td>
                      <div className="config-actions">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              className="primary small"
                              onClick={() => {
                                if (onRenameConcept(item, editingConcept.value)) {
                                  setEditingConcept(null);
                                }
                              }}
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => setEditingConcept(null)}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => setEditingConcept({
                                original: item,
                                value: item,
                              })}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="secondary small danger-text"
                              onClick={() => onDeleteConcept(item)}
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AuditLogCard({ auditLog }) {
  const rows = (auditLog || []).slice(0, 100);

  return (
    <Card title="Log de cambios históricos">
      <div className="configuration-help">
        Registra las modificaciones realizadas desde Estadísticas sobre ejercicios
        históricos, incluyendo usuario, motivo y cantidad de movimientos afectados.
      </div>
      <div className="table-wrap audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Anterior</th>
              <th>Nuevo</th>
              <th>Motivo</th>
              <th>Importes antes → después</th>
              <th>Filtro</th>
              <th>Registros</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.at ? new Date(row.at).toLocaleString('es-AR') : '-'}</td>
                <td>
                  <strong>{row.userName || '-'}</strong>
                  <small>{row.userEmail || ''}</small>
                </td>
                <td>{row.action || '-'}</td>
                <td>{row.oldConcept || '-'}</td>
                <td>{row.newConcept || '-'}</td>
                <td className="audit-reason" title={row.reason}>{row.reason || '-'}</td>
                <td className="audit-values">
                  <span>
                    Entrada: {money.format(row.previousIncome || 0)} → {money.format(
                      row.newIncome ?? row.previousIncome ?? 0
                    )}
                  </span>
                  <span>
                    Salida: {money.format(row.previousExpense || 0)} → {money.format(
                      row.newExpense ?? row.previousExpense ?? 0
                    )}
                  </span>
                  {Number(row.changedValueCount || 0) > 0 && (
                    <small>{number.format(row.changedValueCount)} movimiento(s) con importes corregidos</small>
                  )}
                </td>
                <td>{`${row.account || 'Todas'} / ${row.year || 'Todos'}`}</td>
                <td className="money-cell">{number.format(row.affectedCount || 0)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="audit-empty">Todavía no hay cambios históricos registrados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ZeroAdjustmentModal({ adjustment, onClose, onSave }) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(adjustment.date || '');

  const isHistorical = Number(adjustment.year) < new Date().getFullYear();
  const amount = Number(adjustment.adjustmentIncome || adjustment.adjustmentExpense || 0);
  const direction = Number(adjustment.adjustmentIncome || 0) > 0 ? 'Entrada' : 'Salida';

  function submit(event) {
    event.preventDefault();
    if (reason.trim().length < 5 || !date) return;
    onSave({ reason, date });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal zero-adjustment-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className={isHistorical ? 'historical-badge warning' : 'historical-badge'}>
              {isHistorical ? 'Ajuste de ejercicio histórico' : 'Ajuste contable'}
            </span>
            <h2>Ajustar resultado a $ 0,00</h2>
            <p>
              Se agregará un movimiento compensatorio. No se modifican ni se ocultan los movimientos originales.
            </p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit}>
          <div className="zero-adjustment-summary">
            <div>
              <small>Cuenta</small>
              <strong>{adjustment.account}</strong>
            </div>
            <div>
              <small>Resultado actual</small>
              <strong className={adjustment.resultBefore >= 0 ? 'income' : 'expense'}>
                {money.format(adjustment.resultBefore)}
              </strong>
            </div>
            <div>
              <small>Ajuste a generar</small>
              <strong>{direction} {money.format(amount)}</strong>
            </div>
            <div>
              <small>Resultado posterior</small>
              <strong className="income">{money.format(0)}</strong>
            </div>
          </div>

          <div className="form-row">
            <Field label="Fecha del ajuste">
              <input
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>

            <Field label="Concepto">
              <input value="Redondeo Banco" disabled />
            </Field>
          </div>

          <Field label={isHistorical ? 'Motivo del ajuste del ejercicio histórico *' : 'Motivo del ajuste *'}>
            <textarea
              required
              minLength={5}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej.: cierre de billetera / diferencia de redondeo conciliada contra extracto."
            />
          </Field>

          <div className="historical-warning">
            <strong>El ajuste queda auditado.</strong>
            <span>
              Se conservará el resultado anterior, el movimiento generado, el usuario, la fecha y el motivo.
            </span>
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
            <button className="primary" disabled={reason.trim().length < 5 || !date}>
              Crear ajuste y dejar en $ 0
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HistoricalConceptModal({ edit, conceptOptions, onClose, onSave }) {
  const [newConcept, setNewConcept] = useState(edit.newConcept || edit.oldConcept || '');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState(
    (edit.rows || []).map((row) => ({
      ...row,
      income: String(Number(row.income || 0)),
      expense: String(Number(row.expense || 0)),
    }))
  );

  const historicalYears = (edit.years || []).join(', ') || '-';
  const currentYear = String(new Date().getFullYear());
  const isOldExercise = (edit.years || []).some((item) => String(item) < currentYear);

  const editedTotals = useMemo(() => {
    const income = rows.reduce((sum, row) => sum + Math.max(0, Number(row.income || 0)), 0);
    const expense = rows.reduce((sum, row) => sum + Math.max(0, Number(row.expense || 0)), 0);
    return {
      income,
      expense,
      result: income - expense,
    };
  }, [rows]);

  const changedValueCount = useMemo(() => {
    const original = new Map((edit.rows || []).map((row) => [row.id, row]));

    return rows.filter((row) => {
      const before = original.get(row.id);
      if (!before) return false;

      return (
        Math.abs(Number(before.income || 0) - Number(row.income || 0)) > 0.0001 ||
        Math.abs(Number(before.expense || 0) - Number(row.expense || 0)) > 0.0001
      );
    }).length;
  }, [rows, edit.rows]);

  function updateRow(id, key, value) {
    setRows((current) => current.map((row) => (
      row.id === id ? { ...row, [key]: value } : row
    )));
  }

  function submit(event) {
    event.preventDefault();

    if (!String(newConcept || '').trim() || String(reason || '').trim().length < 5) {
      return;
    }

    onSave({
      newConcept,
      reason,
      rows: rows.map((row) => ({
        ...row,
        income: Math.max(0, Number(row.income || 0)),
        expense: Math.max(0, Number(row.expense || 0)),
      })),
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal historical-edit-modal historical-edit-modal-wide" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className={isOldExercise ? 'historical-badge warning' : 'historical-badge'}>
              {isOldExercise ? 'Ejercicio histórico' : 'Edición agrupada'}
            </span>
            <h2>Editar resumen por concepto</h2>
            <p>
              Podés corregir el concepto y también los importes de Entrada / Salida de cada
              movimiento que forma este resumen. Todo cambio requiere motivo y queda auditado.
            </p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit}>
          <div className="historical-summary-grid">
            <div><small>Ejercicio(s)</small><strong>{historicalYears}</strong></div>
            <div><small>Cuenta</small><strong>{edit.account || 'Todas'}</strong></div>
            <div>
              <small>Ingresos</small>
              <strong className="income">{money.format(editedTotals.income)}</strong>
              {Math.abs(editedTotals.income - Number(edit.income || 0)) > 0.0001 && (
                <span className="historical-delta">Antes {money.format(edit.income || 0)}</span>
              )}
            </div>
            <div>
              <small>Gastos</small>
              <strong className="expense">{money.format(editedTotals.expense)}</strong>
              {Math.abs(editedTotals.expense - Number(edit.expense || 0)) > 0.0001 && (
                <span className="historical-delta">Antes {money.format(edit.expense || 0)}</span>
              )}
            </div>
          </div>

          <div className="form-row">
            <Field label="Concepto actual">
              <input value={edit.oldConcept || ''} disabled />
            </Field>

            <Field label="Nuevo concepto">
              <input
                list="conceptos-edicion-historica"
                required
                value={newConcept}
                onChange={(event) => setNewConcept(event.target.value)}
              />
              <datalist id="conceptos-edicion-historica">
                {conceptOptions.map((item) => <option key={item} value={item} />)}
              </datalist>
            </Field>
          </div>

          <div className="historical-values-head">
            <div>
              <strong>Movimientos incluidos</strong>
              <span>{number.format(rows.length)} registros · {number.format(changedValueCount)} con importes modificados</span>
            </div>
            <div className={editedTotals.result >= 0 ? 'income' : 'expense'}>
              Resultado: <strong>{money.format(editedTotals.result)}</strong>
            </div>
          </div>

          <div className="table-wrap historical-values-table-wrap">
            <table className="historical-values-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th>Operación</th>
                  <th>Entrada ($)</th>
                  <th>Salida ($)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.date)}</td>
                    <td className="historical-detail-cell" title={row.detail}>{row.detail || '-'}</td>
                    <td>{row.operation || '-'}</td>
                    <td>
                      <input
                        className="historical-money-input income-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.income}
                        onChange={(event) => updateRow(row.id, 'income', event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="historical-money-input expense-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.expense}
                        onChange={(event) => updateRow(row.id, 'expense', event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}><strong>TOTAL EDITADO</strong></td>
                  <td className="income money-cell"><strong>{money.format(editedTotals.income)}</strong></td>
                  <td className="expense money-cell"><strong>{money.format(editedTotals.expense)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <Field label={isOldExercise ? 'Motivo de modificación del ejercicio anterior *' : 'Motivo del cambio *'}>
            <textarea
              required
              minLength={5}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej.: corrección del importe según comprobante / reclasificación contable."
            />
          </Field>

          <div className="historical-warning">
            <strong>Quedará auditado.</strong>
            <span>
              Se guardarán usuario, fecha, motivo, concepto anterior/nuevo y, para cada registro
              modificado, los importes anteriores y posteriores.
            </span>
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
            <button className="primary" disabled={!newConcept.trim() || reason.trim().length < 5}>
              Guardar cambio histórico
            </button>
          </div>
        </form>
      </div>
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
