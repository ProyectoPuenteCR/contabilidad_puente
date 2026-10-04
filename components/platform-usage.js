'use client';

import { useEffect, useMemo, useState } from 'react';

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function subtractDays(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

function formatKb(value) {
  const number = Number(value || 0);
  if (number >= 1024) return `${(number / 1024).toFixed(2)} MB`;
  return `${number.toFixed(1)} KB`;
}

function formatMb(value) {
  const number = Number(value || 0);
  return `${number.toFixed(2)} MB`;
}

const moduleLabels = {
  book: 'Libro de contabilidad',
  balance: 'Saldo',
  statistics: 'Estadísticas',
  expenses: 'Gastos',
  hours: 'Horas',
  settings: 'Configuración',
  login: 'Login',
  admin: 'Administración',
};

const palette = [
  '#2377f2',
  '#ff5f7e',
  '#ff9f43',
  '#f6c64e',
  '#35b7c7',
  '#7a62dd',
  '#8fa8c0',
  '#4ea3df',
];

export default function PlatformUsage() {
  const [from, setFrom] = useState(subtractDays(29));
  const [to, setTo] = useState(isoDate(new Date()));
  const [reference, setReference] = useState('30');
  const [capacityMb, setCapacityMb] = useState('256');
  const [retentionDays, setRetentionDays] = useState('180');
  const [data, setData] = useState(null);
  const [browserStorage, setBrowserStorage] = useState({
    localBytes: 0,
    originUsage: 0,
    originQuota: 0,
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setMessage('');

    try {
      const response = await fetch(
        `/api/admin/platform-usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: 'no-store' }
      );

      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || 'No se pudieron cargar las métricas.');
        return;
      }

      setData(payload);
      setCapacityMb(String(payload.storage?.capacityMb || 256));
    } catch {
      setMessage('No se pudieron cargar las métricas.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();

    async function measureBrowserStorage() {
      let localBytes = 0;

      try {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (!key || !key.startsWith('puente.')) continue;
          const value = localStorage.getItem(key) || '';
          localBytes += new Blob([key, value]).size;
        }
      } catch {}

      let originUsage = 0;
      let originQuota = 0;

      try {
        if (navigator.storage?.estimate) {
          const estimate = await navigator.storage.estimate();
          originUsage = Number(estimate.usage || 0);
          originQuota = Number(estimate.quota || 0);
        }
      } catch {}

      setBrowserStorage({ localBytes, originUsage, originQuota });
    }

    measureBrowserStorage();
  }, []);

  function applyReference(value) {
    setReference(value);

    if (value === '7') {
      setFrom(subtractDays(6));
      setTo(isoDate(new Date()));
    } else if (value === '30') {
      setFrom(subtractDays(29));
      setTo(isoDate(new Date()));
    } else if (value === '90') {
      setFrom(subtractDays(89));
      setTo(isoDate(new Date()));
    } else if (value === '365') {
      setFrom(subtractDays(364));
      setTo(isoDate(new Date()));
    }
  }

  async function saveCapacity() {
    setBusy(true);
    setMessage('');

    try {
      const response = await fetch('/api/admin/platform-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capacityMb: Number(capacityMb) }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || 'No se pudo guardar la capacidad.');
        return;
      }

      setMessage('Capacidad de referencia actualizada.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function optimize() {
    if (!confirm(
      `Se eliminarán de la auditoría de uso los eventos anteriores a ${retentionDays} días. ¿Continuar?`
    )) {
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const response = await fetch('/api/admin/platform-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compact',
          retentionDays: Number(retentionDays),
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || 'No se pudo optimizar la auditoría.');
        return;
      }

      setMessage(
        `Auditoría compactada: ${payload.removed || 0} eventos eliminados, ${payload.remaining || 0} conservados.`
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  const maxDaily = useMemo(() => {
    const rows = data?.accessesByDay || [];
    return Math.max(1, ...rows.map((item) => Number(item.success || 0) + Number(item.failed || 0)));
  }, [data]);

  const donut = useMemo(() => {
    const modules = data?.modules || [];
    const total = modules.reduce((sum, item) => sum + Number(item.count || 0), 0);
    if (!total) return { background: '#e9eef5', items: [] };

    let cursor = 0;
    const stops = [];
    const items = modules.slice(0, 8).map((item, index) => {
      const share = Number(item.count || 0) / total;
      const start = cursor;
      const end = cursor + share * 100;
      cursor = end;
      const color = palette[index % palette.length];
      stops.push(`${color} ${start}% ${end}%`);

      return {
        ...item,
        color,
        percent: share * 100,
      };
    });

    return {
      background: `conic-gradient(${stops.join(',')})`,
      items,
    };
  }, [data]);

  const usagePct = Math.min(100, Number(data?.storage?.usagePct || 0));

  return (
    <div className="usage-page">
      <section className="usage-toolbar">
        <div className="usage-filter">
          <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label>
            Capacidad configurada (MB)
            <input
              type="number"
              min="1"
              step="1"
              value={capacityMb}
              onChange={(event) => setCapacityMb(event.target.value)}
            />
          </label>
          <label>
            Compactar auditoría después de (días)
            <input
              type="number"
              min="1"
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
            />
          </label>
          <label>
            Referencia
            <select value={reference} onChange={(event) => applyReference(event.target.value)}>
              <option value="7">Últimos 7 días</option>
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="365">Último año</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
        </div>

        <div className="usage-toolbar-actions">
          <button type="button" className="secondary" onClick={saveCapacity} disabled={busy}>
            Guardar capacidad
          </button>
          <button type="button" className="primary" onClick={load} disabled={busy}>
            {busy ? 'Actualizando…' : 'Actualizar / Analizar espacio'}
          </button>
          <button type="button" className="secondary danger-text" onClick={optimize} disabled={busy}>
            Optimizar auditoría
          </button>
        </div>
      </section>

      {message && <div className="access-message">{message}</div>}

      {!data?.storageConfigured && (
        <div className="access-warning">
          <strong>La base privada no está conectada</strong>
          <span>Las métricas de capacidad requieren Upstash Redis configurado en Vercel.</span>
        </div>
      )}

      <section className="usage-kpis">
        <UsageKpi label="Usuarios registrados" value={data?.totals?.usersRegistered ?? 0} note="Total" />
        <UsageKpi label="Activos últimos 30 días" value={data?.totals?.activeLast30Days ?? 0} note="Con actividad" />
        <UsageKpi label="Accesos período" value={data?.totals?.accessesPeriod ?? 0} note="Exitosos" />
        <UsageKpi label="Accesos mes actual" value={data?.totals?.accessesThisMonth ?? 0} note="Exitosos" />
        <UsageKpi label="Accesos hoy" value={data?.totals?.accessesToday ?? 0} note="Exitosos" />
        <UsageKpi label="Accesos fallidos" value={data?.totals?.failedAccesses ?? 0} note="En el período" />
        <UsageKpi label="Espacio usado" value={formatKb(data?.storage?.usedKb || 0)} note="Estimado" />
        <UsageKpi label="Espacio restante" value={formatMb(data?.storage?.remainingMb || 0)} note="Estimado" />
        <UsageKpi label="Uso base" value={`${usagePct.toFixed(2)}%`} note={`${data?.storage?.keyCount || 0} claves`} />
        <UsageKpi
          label="Datos contables locales"
          value={formatKb(browserStorage.localBytes / 1024)}
          note="Este navegador"
        />
      </section>

      <section className="usage-capacity-card">
        <div className="usage-capacity-head">
          <div>
            <h3>Capacidad de la base de datos</h3>
            <span className={usagePct >= 85 ? 'usage-health danger' : usagePct >= 65 ? 'usage-health warning' : 'usage-health normal'}>
              {usagePct >= 85 ? 'Crítico' : usagePct >= 65 ? 'Atención' : 'Normal'}
            </span>
          </div>
          <strong>{usagePct.toFixed(2)}%</strong>
        </div>

        <div className="usage-progress">
          <i style={{ width: `${usagePct}%` }} />
        </div>

        <div className="usage-capacity-stats">
          <span><small>Utilizado estimado</small><b>{formatKb(data?.storage?.usedKb || 0)}</b></span>
          <span><small>Disponible estimado</small><b>{formatMb(data?.storage?.remainingMb || 0)}</b></span>
          <span><small>Capacidad configurada</small><b>{formatMb(data?.storage?.capacityMb || 0)}</b></span>
          <span><small>Claves</small><b>{data?.storage?.keyCount || 0}</b></span>
        </div>

        <p>
          El cálculo es una estimación basada en las claves y payloads de Redis de este sistema.
          Configurá arriba la capacidad real de tu plan para usarlo como alarma preventiva.
        </p>
      </section>

      <section className="usage-local-storage-card">
        <div>
          <h3>Datos contables guardados en este navegador</h3>
          <p>
            Actualmente el Libro, horas, inversiones, configuración y auditoría se conservan
            en almacenamiento local del navegador. Este bloque mide ese espacio por separado
            de Redis para no confundir ambas capacidades.
          </p>
        </div>
        <div className="usage-local-storage-values">
          <span><small>Claves Puente</small><strong>{formatKb(browserStorage.localBytes / 1024)}</strong></span>
          <span><small>Uso total del origen</small><strong>{formatMb(browserStorage.originUsage / 1024 / 1024)}</strong></span>
          <span><small>Cuota estimada navegador</small><strong>{formatMb(browserStorage.originQuota / 1024 / 1024)}</strong></span>
        </div>
      </section>

      <div className="usage-grid">
        <section className="usage-chart-card">
          <h3>Accesos por día</h3>
          <p>Ingresos exitosos y fallidos dentro del período.</p>

          <div className="usage-bars">
            {(data?.accessesByDay || []).length === 0 && (
              <div className="usage-empty">Todavía no hay accesos auditados en este período.</div>
            )}

            {(data?.accessesByDay || []).map((item) => {
              const successHeight = (Number(item.success || 0) / maxDaily) * 100;
              const failedHeight = (Number(item.failed || 0) / maxDaily) * 100;
              return (
                <div className="usage-day" key={item.date} title={item.date}>
                  <div className="usage-day-bars">
                    <i className="success" style={{ height: `${successHeight}%` }} />
                    <i className="failed" style={{ height: `${failedHeight}%` }} />
                  </div>
                  <span>{item.date.slice(5)}</span>
                </div>
              );
            })}
          </div>

          <div className="usage-chart-legend">
            <span><i className="success" /> Exitosos</span>
            <span><i className="failed" /> Fallidos</span>
          </div>
        </section>

        <section className="usage-chart-card">
          <h3>Uso por módulo</h3>
          <p>Pantallas abiertas por usuarios durante el período.</p>

          <div className="usage-donut-layout">
            <div className="usage-donut" style={{ background: donut.background }}>
              <div><strong>{(data?.modules || []).reduce((sum, item) => sum + Number(item.count || 0), 0)}</strong><span>aperturas</span></div>
            </div>

            <div className="usage-module-list">
              {donut.items.map((item) => (
                <div key={item.module}>
                  <i style={{ background: item.color }} />
                  <span>{moduleLabels[item.module] || item.module}</span>
                  <strong>{item.count}</strong>
                  <small>{item.percent.toFixed(1)}%</small>
                </div>
              ))}
              {donut.items.length === 0 && (
                <div className="usage-empty">Todavía no hay actividad por módulo.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function UsageKpi({ label, value, note }) {
  return (
    <div className="usage-kpi">
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{note}</span>
    </div>
  );
}
