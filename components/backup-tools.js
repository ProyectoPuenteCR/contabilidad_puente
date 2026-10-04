'use client';

import { useState } from 'react';

function safeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function addSheet(XLSX, workbook, name, rows, widths = []) {
  const data = safeRows(rows);
  const sheet = data.length
    ? XLSX.utils.json_to_sheet(data)
    : XLSX.utils.aoa_to_sheet([['Sin datos']]);

  if (widths.length) {
    sheet['!cols'] = widths.map((wch) => ({ wch }));
  }

  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

export default function BackupTools({
  user,
  movements,
  hours,
  hourSpecialists,
  hourServices,
  investments,
  institutions,
  concepts,
  saldoSnapshot,
  auditLog,
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function exportBackup() {
    setBusy(true);
    setMessage('');

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();

      let users = [];
      let usage = null;

      if (user?.role === 'admin') {
        try {
          const [usersResponse, usageResponse] = await Promise.all([
            fetch('/api/admin/users', { cache: 'no-store' }),
            fetch('/api/admin/platform-usage', { cache: 'no-store' }),
          ]);

          if (usersResponse.ok) {
            const payload = await usersResponse.json();
            users = payload.users || [];
          }

          if (usageResponse.ok) {
            usage = await usageResponse.json();
          }
        } catch {
          // El respaldo local continúa aunque la parte administrativa falle.
        }
      }

      const now = new Date();
      const exportedAt = now.toISOString();

      addSheet(XLSX, workbook, 'Resumen', [
        { Campo: 'Fecha de respaldo', Valor: exportedAt },
        { Campo: 'Usuario', Valor: user?.name || '' },
        { Campo: 'Email', Valor: user?.email || '' },
        { Campo: 'Movimientos', Valor: safeRows(movements).length },
        { Campo: 'Horas', Valor: safeRows(hours).length },
        { Campo: 'Especialistas de horas', Valor: safeRows(hourSpecialists).length },
        { Campo: 'Servicios / Proyectos de horas', Valor: safeRows(hourServices).length },
        { Campo: 'Inversiones', Valor: safeRows(investments).length },
        { Campo: 'Cuentas configuradas', Valor: safeRows(institutions).length },
        { Campo: 'Conceptos', Valor: safeRows(concepts).length },
        { Campo: 'Registros de auditoría', Valor: safeRows(auditLog).length },
        {
          Campo: 'Nota',
          Valor: 'Archivo de respaldo integral de Contabilidad Puente. Incluye datos locales y, para administradores, información disponible de seguridad/uso.',
        },
      ], [28, 90]);

      addSheet(
        XLSX,
        workbook,
        'Libro contabilidad',
        safeRows(movements).map((row) => ({
          Fecha: row.date || '',
          Cuenta: row.account || '',
          Carpeta: row.folder || '',
          Concepto: row.concept || '',
          Detalle: row.detail || '',
          Operacion: row.operation || '',
          Entrada: Number(row.income || 0),
          Salida: Number(row.expense || 0),
          Factura: row.invoice || '',
          Observaciones: row.notes || '',
          ID: row.id || '',
        })),
        [13, 22, 22, 32, 55, 18, 16, 16, 20, 40, 38]
      );

      addSheet(
        XLSX,
        workbook,
        'Horas',
        safeRows(hours).map((row) => ({
          Fecha: row.date || '',
          Especialista: row.specialist || '',
          Servicio: row.service || '',
          Horas: Number(row.hours || 0),
          ValorHora: Number(row.hourlyRate || 0),
          Total: Number(row.hours || 0) * Number(row.hourlyRate || 0),
          Observaciones: row.notes || '',
          ID: row.id || '',
        })),
        [13, 28, 30, 12, 16, 16, 42, 38]
      );

      const serviceNameById = new Map(
        safeRows(hourServices).map((row) => [row.id, row.name || ''])
      );

      addSheet(
        XLSX,
        workbook,
        'Especialistas horas',
        safeRows(hourSpecialists).map((row) => ({
          Especialista: row.name || '',
          ServiciosAsignados: safeRows(row.serviceIds)
            .map((id) => serviceNameById.get(id))
            .filter(Boolean)
            .join(' | '),
          CantidadServicios: safeRows(row.serviceIds).length,
          Activo: row.active !== false ? 'Si' : 'No',
          ID: row.id || '',
        })),
        [36, 70, 18, 12, 38]
      );

      addSheet(
        XLSX,
        workbook,
        'Servicios horas',
        safeRows(hourServices).map((row) => ({
          ServicioProyecto: row.name || '',
          Activo: row.active !== false ? 'Si' : 'No',
          ID: row.id || '',
        })),
        [40, 12, 38]
      );

      addSheet(
        XLSX,
        workbook,
        'Inversiones',
        safeRows(investments).map((row) => ({
          Nombre: row.name || '',
          Tipo: row.type || '',
          Banco: row.bank || '',
          Capital: Number(row.principal || 0),
          Interes: Number(row.interest || 0),
          Reembolso: Number(row.reimbursement || 0),
          Vencimiento: row.maturityDate || '',
          Estado: row.status || '',
          Observaciones: row.notes || '',
          ID: row.id || '',
        })),
        [18, 18, 22, 18, 16, 18, 14, 16, 55, 38]
      );

      addSheet(
        XLSX,
        workbook,
        'Cuentas',
        safeRows(institutions).map((row) => ({
          Nombre: row.name || '',
          Tipo: row.type || '',
          Activa: row.active !== false ? 'Si' : 'No',
          ID: row.id || '',
        })),
        [28, 22, 12, 38]
      );

      addSheet(
        XLSX,
        workbook,
        'Conceptos',
        safeRows(concepts).map((item) => ({ Concepto: item })),
        [45]
      );

      addSheet(
        XLSX,
        workbook,
        'Saldo auxiliar',
        Object.entries(saldoSnapshot || {}).map(([key, value]) => ({
          Campo: key,
          Valor: typeof value === 'object' ? JSON.stringify(value) : value,
        })),
        [35, 90]
      );

      addSheet(
        XLSX,
        workbook,
        'Auditoria cambios',
        safeRows(auditLog).map((row) => ({
          Fecha: row.at || '',
          Usuario: row.userName || '',
          Email: row.userEmail || '',
          Accion: row.action || '',
          ConceptoAnterior: row.oldConcept || '',
          ConceptoNuevo: row.newConcept || '',
          Motivo: row.reason || '',
          EntradaAntes: Number(row.previousIncome || 0),
          EntradaDespues: Number(row.newIncome ?? row.previousIncome ?? 0),
          SalidaAntes: Number(row.previousExpense || 0),
          SalidaDespues: Number(row.newExpense ?? row.previousExpense ?? 0),
          ResultadoAntes: Number(row.previousResult || 0),
          ResultadoDespues: Number(row.newResult ?? row.previousResult ?? 0),
          MovimientosConImportesCorregidos: Number(row.changedValueCount || 0),
          DetalleCambiosImportes: JSON.stringify(safeRows(row.valueChanges)),
          CuentaFiltro: row.account || '',
          AnioFiltro: row.year || '',
          RegistrosAfectados: Number(row.affectedCount || 0),
          IDsAfectados: safeRows(row.affectedIds).join(', '),
          ID: row.id || '',
        })),
        [24, 24, 34, 28, 32, 32, 60, 18, 18, 18, 18, 18, 18, 22, 90, 22, 14, 18, 80, 38]
      );

      if (users.length) {
        addSheet(
          XLSX,
          workbook,
          'Usuarios acceso',
          users.map((row) => ({
            Email: row.email || '',
            Nombre: row.name || '',
            Rol: row.role || '',
            Origen: row.source || '',
            AgregadoEl: row.addedAt || '',
            AgregadoPor: row.addedBy || '',
            Revocable: row.removable ? 'Si' : 'No',
          })),
          [36, 28, 16, 24, 24, 36, 14]
        );
      }

      if (usage) {
        addSheet(XLSX, workbook, 'Uso plataforma', [
          { Metrica: 'Usuarios registrados', Valor: usage.totals?.usersRegistered ?? 0 },
          { Metrica: 'Activos últimos 30 días', Valor: usage.totals?.activeLast30Days ?? 0 },
          { Metrica: 'Accesos período', Valor: usage.totals?.accessesPeriod ?? 0 },
          { Metrica: 'Accesos mes actual', Valor: usage.totals?.accessesThisMonth ?? 0 },
          { Metrica: 'Accesos hoy', Valor: usage.totals?.accessesToday ?? 0 },
          { Metrica: 'Accesos fallidos', Valor: usage.totals?.failedAccesses ?? 0 },
          { Metrica: 'Espacio usado bytes', Valor: usage.storage?.usedBytes ?? 0 },
          { Metrica: 'Capacidad MB', Valor: usage.storage?.capacityMb ?? 0 },
          { Metrica: 'Uso %', Valor: usage.storage?.usagePct ?? 0 },
          { Metrica: 'Claves Redis', Valor: usage.storage?.keyCount ?? 0 },
        ], [35, 28]);

        addSheet(
          XLSX,
          workbook,
          'Uso por modulo',
          safeRows(usage.modules).map((row) => ({
            Modulo: row.module || '',
            Aperturas: Number(row.count || 0),
          })),
          [30, 18]
        );

        addSheet(
          XLSX,
          workbook,
          'Accesos por dia',
          safeRows(usage.accessesByDay).map((row) => ({
            Fecha: row.date || '',
            Exitosos: Number(row.success || 0),
            Fallidos: Number(row.failed || 0),
          })),
          [16, 16, 16]
        );
      }

      const filename = `Respaldo_Contabilidad_Puente_${exportedAt.slice(0, 10)}.xlsx`;
      XLSX.writeFile(workbook, filename, { compression: true });
      setMessage(`Respaldo generado: ${filename}`);
    } catch (error) {
      console.error(error);
      setMessage('No se pudo generar el respaldo completo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="backup-card">
      <div>
        <span className="eyebrow">RESPALDO</span>
        <h3>Exportación completa del sistema</h3>
        <p>
          Genera un único archivo Excel con Libro de contabilidad, horas,
          inversiones, cuentas, conceptos, especialistas, servicios/proyectos de horas, Saldo auxiliar, auditoría y,
          para administradores, seguridad y estadísticas disponibles.
        </p>
        {message && <small>{message}</small>}
      </div>

      <button type="button" className="primary" onClick={exportBackup} disabled={busy}>
        {busy ? 'Generando…' : '↓ Exportar respaldo completo'}
      </button>
    </section>
  );
}
