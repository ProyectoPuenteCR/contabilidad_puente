'use client';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat('es-AR');

function StatusPill({ status, children }) {
  return <span className={`cloud-db-pill ${status}`}>{children}</span>;
}

export default function CloudDatabasePanel({
  user,
  status,
  syncState,
  conflict,
  localSummary,
  migrationReport,
  onMigrate,
  onReload,
  migrating,
}) {
  const connected = Boolean(status?.connected);
  const active = Boolean(status?.active);
  const cloud = status?.ledger || { count: 0, income: 0, expense: 0, result: 0 };

  const localResult = Number(localSummary?.income || 0) - Number(localSummary?.expense || 0);

  let syncLabel = 'Solo local';
  let syncTone = 'neutral';

  if (active) {
    if (syncState === 'syncing') {
      syncLabel = 'Sincronizando';
      syncTone = 'warning';
    } else if (syncState === 'conflict') {
      syncLabel = 'Conflicto';
      syncTone = 'danger';
    } else {
      syncLabel = 'Nube activa';
      syncTone = 'ok';
    }
  }

  return (
    <section className="cloud-db-card">
      <div className="cloud-db-head">
        <div>
          <span className="eyebrow">BASE CONTABLE EN LA NUBE</span>
          <h3>Neon PostgreSQL</h3>
          <p>
            PostgreSQL será la fuente central del Libro, horas, inversiones,
            cuentas, conceptos, Saldo auxiliar y auditoría contable.
          </p>
        </div>

        <div className="cloud-db-statuses">
          <StatusPill status={connected ? 'ok' : 'danger'}>
            {connected ? 'PostgreSQL conectado' : 'Sin conexión'}
          </StatusPill>
          <StatusPill status={syncTone}>{syncLabel}</StatusPill>
        </div>
      </div>

      {!status?.configured && (
        <div className="cloud-db-alert danger">
          <strong>DATABASE_URL no detectada.</strong>
          <span>
            Revisá la variable de entorno de Vercel y generá un nuevo deployment.
          </span>
        </div>
      )}

      {status?.configured && !connected && (
        <div className="cloud-db-alert danger">
          <strong>La variable existe, pero PostgreSQL no respondió.</strong>
          <span>
            Revisá el connection string de Neon y que tenga Connection Pooling habilitado.
          </span>
        </div>
      )}

      {conflict && (
        <div className="cloud-db-alert danger">
          <strong>Hay una versión más nueva en la nube.</strong>
          <span>{conflict}</span>
          <button type="button" className="secondary small" onClick={onReload}>
            Recargar datos de la nube
          </button>
        </div>
      )}

      <div className="cloud-db-comparison">
        <div className="cloud-db-side">
          <div className="cloud-db-side-title">
            <span>Este navegador</span>
            <strong>Datos locales</strong>
          </div>
          <CloudMetric label="Movimientos" value={number.format(localSummary?.count || 0)} />
          <CloudMetric label="Entradas" value={money.format(localSummary?.income || 0)} tone="income" />
          <CloudMetric label="Salidas" value={money.format(localSummary?.expense || 0)} tone="expense" />
          <CloudMetric label="Resultado" value={money.format(localResult)} tone={localResult >= 0 ? 'income' : 'expense'} />
        </div>

        <div className="cloud-db-arrow">→</div>

        <div className="cloud-db-side">
          <div className="cloud-db-side-title">
            <span>Neon PostgreSQL</span>
            <strong>{active ? 'Fuente principal' : 'Esperando migración'}</strong>
          </div>
          <CloudMetric label="Movimientos" value={number.format(cloud.count || 0)} />
          <CloudMetric label="Entradas" value={money.format(cloud.income || 0)} tone="income" />
          <CloudMetric label="Salidas" value={money.format(cloud.expense || 0)} tone="expense" />
          <CloudMetric label="Resultado" value={money.format(cloud.result || 0)} tone={Number(cloud.result || 0) >= 0 ? 'income' : 'expense'} />
        </div>
      </div>

      {connected && (
        <div className="cloud-db-meta">
          <span>
            <small>Revisión nube</small>
            <strong>{number.format(status?.revision || 0)}</strong>
          </span>
          <span>
            <small>Espacio PostgreSQL</small>
            <strong>{Number(status?.databaseMb || 0).toFixed(2)} MB</strong>
          </span>
          <span>
            <small>Última actualización</small>
            <strong>
              {status?.updatedAt
                ? new Date(status.updatedAt).toLocaleString('es-AR')
                : '-'}
            </strong>
          </span>
          <span>
            <small>Actualizado por</small>
            <strong>{status?.updatedBy || '-'}</strong>
          </span>
        </div>
      )}

      {migrationReport?.verified && (
        <div className="cloud-db-verified">
          <div>
            <strong>✓ Migración verificada</strong>
            <span>
              Cantidad de movimientos, Entradas, Salidas y Resultado coinciden
              entre el navegador y PostgreSQL.
            </span>
          </div>
          <div className="cloud-db-checks">
            <span>Movimientos ✓</span>
            <span>Entradas ✓</span>
            <span>Salidas ✓</span>
            <span>Resultado ✓</span>
          </div>
        </div>
      )}

      <div className="cloud-db-actions">
        {!active && connected && (
          <button
            type="button"
            className="primary"
            onClick={onMigrate}
            disabled={migrating || !localSummary?.count || user?.role !== 'admin'}
          >
            {migrating ? 'Migrando y verificando…' : 'Migrar datos actuales a PostgreSQL'}
          </button>
        )}

        {active && (
          <button type="button" className="secondary" onClick={onReload}>
            ↻ Recargar desde la nube
          </button>
        )}

        <p>
          Los datos locales no se eliminan durante la migración. Se conservan como
          respaldo mientras verificamos que PostgreSQL tenga exactamente los mismos totales.
        </p>
      </div>
    </section>
  );
}

function CloudMetric({ label, value, tone = '' }) {
  return (
    <div className="cloud-db-metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}
