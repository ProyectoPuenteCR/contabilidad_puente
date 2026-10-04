'use client';

import { useMemo, useState } from 'react';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat('es-AR');

function movementYear(row) {
  return String(row?.date || '').slice(0, 4);
}

function buildSummary(year, movements, investments) {
  const rows = movements.filter((row) => movementYear(row) === String(year));
  const totalIncome = rows.reduce((sum, row) => sum + Number(row.income || 0), 0);
  const totalExpense = rows.reduce((sum, row) => sum + Number(row.expense || 0), 0);
  const result = totalIncome - totalExpense;

  const conceptMap = new Map();
  const accountMap = new Map();
  const monthMap = new Map();

  let withInvoice = 0;
  let withoutInvoice = 0;
  let expenseWithInvoice = 0;
  let expenseWithoutInvoice = 0;

  for (const row of rows) {
    const concept = String(row.concept || 'Sin concepto').trim() || 'Sin concepto';
    const account = String(row.account || 'Sin cuenta').trim() || 'Sin cuenta';
    const month = String(row.date || '').slice(0, 7) || 'Sin fecha';
    const income = Number(row.income || 0);
    const expense = Number(row.expense || 0);

    const conceptStats = conceptMap.get(concept) || { concept, income: 0, expense: 0, count: 0 };
    conceptStats.income += income;
    conceptStats.expense += expense;
    conceptStats.count += 1;
    conceptMap.set(concept, conceptStats);

    const accountStats = accountMap.get(account) || { account, income: 0, expense: 0, result: 0, count: 0 };
    accountStats.income += income;
    accountStats.expense += expense;
    accountStats.result += income - expense;
    accountStats.count += 1;
    accountMap.set(account, accountStats);

    const monthStats = monthMap.get(month) || { month, income: 0, expense: 0, result: 0 };
    monthStats.income += income;
    monthStats.expense += expense;
    monthStats.result += income - expense;
    monthMap.set(month, monthStats);

    const hasInvoice = Boolean(String(row.invoice || '').trim());
    if (hasInvoice) {
      withInvoice += 1;
      expenseWithInvoice += expense;
    } else {
      withoutInvoice += 1;
      expenseWithoutInvoice += expense;
    }
  }

  const activeInvestments = investments
    .filter((item) => !['Acreditado', 'Reinvertido', 'Cancelado'].includes(item.status))
    .map((item) => ({
      name: item.name,
      bank: item.bank,
      principal: Number(item.principal || 0),
      reimbursement: Number(item.reimbursement || 0),
      maturityDate: item.maturityDate || '',
      status: item.status || 'Vigente',
    }))
    .sort((a, b) => String(a.maturityDate).localeCompare(String(b.maturityDate)));

  return {
    year: String(year),
    totals: {
      income: totalIncome,
      expense: totalExpense,
      result,
      marginPct: totalIncome ? (result / totalIncome) * 100 : 0,
      movements: rows.length,
    },
    topExpenseConcepts: [...conceptMap.values()]
      .filter((item) => item.expense > 0)
      .sort((a, b) => b.expense - a.expense)
      .slice(0, 10),
    topIncomeConcepts: [...conceptMap.values()]
      .filter((item) => item.income > 0)
      .sort((a, b) => b.income - a.income)
      .slice(0, 10),
    accounts: [...accountMap.values()]
      .sort((a, b) => Math.abs(b.result) - Math.abs(a.result)),
    monthly: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    invoices: {
      withInvoice,
      withoutInvoice,
      coveragePct: rows.length ? (withInvoice / rows.length) * 100 : 0,
      expenseWithInvoice,
      expenseWithoutInvoice,
    },
    investments: activeInvestments,
  };
}

export default function AiAnalysisPanel({ movements, investments, years }) {
  const [selectedYear, setSelectedYear] = useState(years?.[0] || String(new Date().getFullYear()));
  const [analysis, setAnalysis] = useState(null);
  const [engine, setEngine] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const summary = useMemo(
    () => buildSummary(selectedYear, movements, investments),
    [selectedYear, movements, investments]
  );

  async function analyze() {
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error || 'No se pudo realizar el análisis.');
        return;
      }

      setAnalysis(payload.analysis);
      setEngine(payload.engine || '');
      setModel(payload.model || '');
    } catch {
      setError('No se pudo conectar con el asistente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-analysis-page">
      <section className="ai-hero">
        <div>
          <span className="ai-eyebrow">ANÁLISIS IA</span>
          <h2>Asistente financiero de Proyecto Puente</h2>
          <p>
            Un asistente revisa tus ingresos, gastos, cuentas, facturas y vencimientos,
            y te dice qué estás haciendo bien, qué conviene revisar y cómo mejorar.
            Es una orientación automática: no reemplaza a un contador o asesor.
          </p>
        </div>

        <div className="ai-controls">
          <label>
            Año de análisis
            <select value={selectedYear} onChange={(event) => {
              setSelectedYear(event.target.value);
              setAnalysis(null);
            }}>
              {(years || []).map((year) => <option key={year}>{year}</option>)}
            </select>
          </label>

          <button type="button" className="primary" onClick={analyze} disabled={busy || !summary.totals.movements}>
            {busy ? 'Analizando…' : '✦ Analizar año'}
          </button>
        </div>
      </section>

      <div className="ai-privacy-note">
        <strong>Privacidad:</strong>
        <span>
          El agente recibe métricas agregadas. No se envían detalles, observaciones,
          números de factura ni nombres contenidos en el campo Detalle.
        </span>
      </div>

      <section className="ai-kpis">
        <AiKpi label="Ingresos" value={money.format(summary.totals.income)} tone="green" />
        <AiKpi label="Gastos" value={money.format(summary.totals.expense)} tone="red" />
        <AiKpi label="Resultado" value={money.format(summary.totals.result)} tone={summary.totals.result >= 0 ? 'green' : 'red'} />
        <AiKpi label="Movimientos" value={number.format(summary.totals.movements)} />
        <AiKpi label="Cobertura de facturas" value={`${summary.invoices.coveragePct.toFixed(1)}%`} />
      </section>

      {error && <div className="ai-error">{error}</div>}

      {!analysis && !error && (
        <section className="ai-empty">
          <div className="ai-orb">✦</div>
          <h3>Elegí un año y ejecutá el análisis</h3>
          <p>
            El asistente buscará tendencias, concentración de gastos, comportamiento de cuentas,
            documentación faltante y vencimientos próximos.
          </p>
        </section>
      )}

      {analysis && (
        <>
          <div className="ai-engine-bar">
            <span>
              Motor: <strong>{engine === 'gemini' ? 'Gemini Flash-Lite' : 'Análisis local gratuito'}</strong>
              {model ? ` · ${model}` : ''}
            </span>
            <small>Año {selectedYear}</small>
          </div>

          <section className="ai-summary-card">
            <span>RESUMEN EJECUTIVO</span>
            <h3>{analysis.title || `Análisis ${selectedYear}`}</h3>
            <p>{analysis.summary}</p>
          </section>

          <div className="ai-analysis-grid">
            <AiListCard
              title="Qué estás haciendo bien"
              icon="✓"
              tone="positive"
              items={analysis.strengths}
            />
            <AiListCard
              title="Qué conviene revisar"
              icon="!"
              tone="warning"
              items={analysis.alerts}
            />
          </div>

          <AiListCard
            title="Cómo mejorar"
            icon="→"
            tone="recommendation"
            items={analysis.recommendations}
            numbered
          />

          {Array.isArray(analysis.observations) && analysis.observations.length > 0 && (
            <AiListCard
              title="Observaciones del asistente"
              icon="i"
              tone="neutral"
              items={analysis.observations}
            />
          )}
        </>
      )}
    </div>
  );
}

function AiKpi({ label, value, tone = '' }) {
  return (
    <div className="ai-kpi">
      <small>{label}</small>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function AiListCard({ title, icon, tone, items, numbered = false }) {
  const rows = Array.isArray(items) ? items : [];

  return (
    <section className={`ai-list-card ${tone}`}>
      <div className="ai-list-title"><span>{icon}</span><h3>{title}</h3></div>
      {rows.length ? (
        <ol className={numbered ? 'numbered' : ''}>
          {rows.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ol>
      ) : (
        <p className="ai-no-findings">Sin observaciones relevantes para este punto.</p>
      )}
    </section>
  );
}
