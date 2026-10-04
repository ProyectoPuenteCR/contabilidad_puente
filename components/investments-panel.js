'use client';

import { useMemo, useState } from 'react';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat('es-AR');

function formatDate(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return value;
  return dateFmt.format(new Date(year, month - 1, day));
}

function todayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysUntil(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;

  const target = new Date(year, month - 1, day);
  const diff = target.getTime() - todayStart().getTime();
  return Math.ceil(diff / 86400000);
}

function isFinished(status) {
  return ['Acreditado', 'Reinvertido', 'Cancelado'].includes(status);
}

function displayStatus(investment) {
  if (isFinished(investment.status)) {
    return {
      label: investment.status,
      tone: investment.status === 'Acreditado' ? 'credited' : 'closed',
    };
  }

  const days = daysUntil(investment.maturityDate);
  if (days == null) return { label: investment.status || 'Vigente', tone: 'active' };
  if (days < 0) return { label: 'Vencido', tone: 'overdue' };
  if (days <= 7) return { label: 'Vence pronto', tone: 'warning' };
  return { label: 'Vigente', tone: 'active' };
}

function blankInvestment(accounts) {
  return {
    id: '',
    name: '',
    type: 'Plazo fijo',
    bank: accounts?.[0] || 'CREDICOOP',
    principal: '',
    interest: '',
    reimbursement: '',
    maturityDate: '',
    status: 'Vigente',
    notes: '',
    sourceInvestmentId: '',
  };
}

export default function InvestmentsPanel({
  investments,
  accounts,
  onChange,
}) {
  const [form, setForm] = useState(null);

  const summary = useMemo(() => {
    const active = investments.filter((item) => !isFinished(item.status));
    const principal = active.reduce((sum, item) => sum + Number(item.principal || 0), 0);
    const interest = active.reduce((sum, item) => sum + Number(item.interest || 0), 0);
    const reimbursement = active.reduce((sum, item) => sum + Number(item.reimbursement || 0), 0);

    const next = active
      .filter((item) => item.maturityDate)
      .slice()
      .sort((a, b) => String(a.maturityDate).localeCompare(String(b.maturityDate)))[0] || null;

    return {
      active,
      principal,
      interest,
      reimbursement,
      next,
    };
  }, [investments]);

  function openNew() {
    setForm(blankInvestment(accounts));
  }

  function openEdit(item) {
    setForm({
      ...item,
      sourceInvestmentId: '',
    });
  }

  function save(event) {
    event.preventDefault();
    if (!form) return;

    const clean = {
      id: form.id || crypto.randomUUID(),
      name: String(form.name || '').trim() || 'PLAZO FIJO',
      type: 'Plazo fijo',
      bank: form.bank || accounts?.[0] || 'CREDICOOP',
      principal: Number(form.principal || 0),
      interest: Number(form.interest || 0),
      reimbursement: Number(form.reimbursement || 0),
      maturityDate: form.maturityDate || '',
      status: form.status || 'Vigente',
      notes: String(form.notes || '').trim(),
    };

    let next = investments.some((item) => item.id === clean.id)
      ? investments.map((item) => item.id === clean.id ? clean : item)
      : [...investments, clean];

    if (form.sourceInvestmentId) {
      next = next.map((item) => (
        item.id === form.sourceInvestmentId
          ? { ...item, status: 'Reinvertido' }
          : item
      ));
    }

    onChange(next);
    setForm(null);
  }

  function markCredited(item) {
    if (!confirm(`¿Marcar ${item.name} como acreditado? Esto no genera un movimiento contable automático.`)) {
      return;
    }

    onChange(investments.map((row) => (
      row.id === item.id ? { ...row, status: 'Acreditado' } : row
    )));
  }

  function reinvest(item) {
    const nextNumber = investments.length + 1;
    setForm({
      ...blankInvestment(accounts),
      name: `PLAZO F${nextNumber}`,
      bank: item.bank || accounts?.[0] || 'CREDICOOP',
      principal: Number(item.reimbursement || 0),
      notes: `Reinversión originada desde ${item.name}.`,
      sourceInvestmentId: item.id,
    });
  }

  function remove(item) {
    if (!confirm(`¿Eliminar ${item.name}? Esta acción solo elimina el registro de inversión y no modifica el Libro de contabilidad.`)) {
      return;
    }

    onChange(investments.filter((row) => row.id !== item.id));
  }

  return (
    <section className="investment-section">
      <div className="investment-section-head">
        <div>
          <span className="investment-eyebrow">INVERSIONES</span>
          <h3>Plazos fijos</h3>
          <p>
            Seguimiento informativo. Estos importes ya están contemplados en la base
            del Libro de contabilidad y <strong>no se vuelven a sumar al saldo actual</strong>.
          </p>
        </div>
        <button type="button" className="primary" onClick={openNew}>
          ＋ Nuevo plazo fijo
        </button>
      </div>

      <div className="investment-metrics">
        <div>
          <small>Capital invertido activo</small>
          <strong>{money.format(summary.principal)}</strong>
        </div>
        <div>
          <small>Interés informado</small>
          <strong>{money.format(summary.interest)}</strong>
        </div>
        <div>
          <small>Monto a reembolsar</small>
          <strong>{money.format(summary.reimbursement)}</strong>
        </div>
        <div>
          <small>Próximo vencimiento</small>
          <strong>{summary.next ? formatDate(summary.next.maturityDate) : '-'}</strong>
          <span>
            {summary.next
              ? (() => {
                  const days = daysUntil(summary.next.maturityDate);
                  if (days == null) return '';
                  if (days < 0) return `Vencido hace ${Math.abs(days)} días`;
                  if (days === 0) return 'Vence hoy';
                  return `Faltan ${days} días`;
                })()
              : ''}
          </span>
        </div>
      </div>

      <div className="table-wrap investment-table-wrap">
        <table className="investment-table">
          <thead>
            <tr>
              <th>Plazo</th>
              <th>Banco</th>
              <th>Capital</th>
              <th>Interés</th>
              <th>A reembolsar</th>
              <th>Vencimiento</th>
              <th>Faltan</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {investments
              .slice()
              .sort((a, b) => String(a.maturityDate || '').localeCompare(String(b.maturityDate || '')))
              .map((item) => {
                const status = displayStatus(item);
                const days = daysUntil(item.maturityDate);

                return (
                  <tr key={item.id} onClick={() => openEdit(item)} className="investment-edit-row">
                    <td><strong>{item.name}</strong></td>
                    <td>{item.bank || '-'}</td>
                    <td className="money-cell">{money.format(Number(item.principal || 0))}</td>
                    <td className="money-cell">{money.format(Number(item.interest || 0))}</td>
                    <td className="money-cell"><strong>{money.format(Number(item.reimbursement || 0))}</strong></td>
                    <td>{formatDate(item.maturityDate)}</td>
                    <td>
                      {isFinished(item.status)
                        ? '-'
                        : days == null
                          ? '-'
                          : days < 0
                            ? `-${Math.abs(days)}`
                            : days}
                    </td>
                    <td>
                      <span className={`investment-status ${status.tone}`}>
                        {status.label}
                      </span>
                    </td>
                    <td>
                      <div className="investment-actions" onClick={(event) => event.stopPropagation()}>
                        {!isFinished(item.status) && (
                          <>
                            <button type="button" className="secondary small" onClick={() => markCredited(item)}>
                              Acreditado
                            </button>
                            <button type="button" className="secondary small" onClick={() => reinvest(item)}>
                              Reinvertir
                            </button>
                          </>
                        )}
                        <button type="button" className="secondary small" onClick={() => openEdit(item)}>
                          Editar
                        </button>
                        <button type="button" className="secondary small danger-text" onClick={() => remove(item)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-backdrop" onMouseDown={() => setForm(null)}>
          <div className="modal investment-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>{form.id ? 'Editar plazo fijo' : form.sourceInvestmentId ? 'Reinvertir plazo fijo' : 'Nuevo plazo fijo'}</h2>
                <p>
                  La inversión se registra como seguimiento y no modifica automáticamente
                  el Libro de contabilidad.
                </p>
              </div>
              <button className="icon-btn" type="button" onClick={() => setForm(null)}>×</button>
            </div>

            <form onSubmit={save}>
              <div className="form-row">
                <label className="field">
                  <span>Nombre / Plazo</span>
                  <input
                    required
                    value={form.name}
                    placeholder="PLAZO F3"
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>Banco</span>
                  <select
                    value={form.bank}
                    onChange={(event) => setForm((current) => ({ ...current, bank: event.target.value }))}
                  >
                    {accounts.map((account) => <option key={account}>{account}</option>)}
                  </select>
                </label>
              </div>

              <div className="form-row">
                <label className="field">
                  <span>Capital invertido ($)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.principal}
                    onChange={(event) => setForm((current) => ({ ...current, principal: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>Interés informado ($)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.interest}
                    onChange={(event) => setForm((current) => ({ ...current, interest: event.target.value }))}
                  />
                </label>
              </div>

              <div className="form-row">
                <label className="field">
                  <span>Monto a reembolsar ($)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.reimbursement}
                    onChange={(event) => setForm((current) => ({ ...current, reimbursement: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>Fecha de vencimiento</span>
                  <input
                    type="date"
                    required
                    value={form.maturityDate}
                    onChange={(event) => setForm((current) => ({ ...current, maturityDate: event.target.value }))}
                  />
                </label>
              </div>

              <label className="field">
                <span>Estado administrativo</span>
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                >
                  <option>Vigente</option>
                  <option>Acreditado</option>
                  <option>Reinvertido</option>
                  <option>Cancelado</option>
                </select>
              </label>

              <label className="field">
                <span>Observaciones</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>

              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setForm(null)}>
                  Cancelar
                </button>
                <button className="primary">
                  Guardar plazo fijo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
