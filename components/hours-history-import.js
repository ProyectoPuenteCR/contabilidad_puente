'use client';

import { useRef, useState } from 'react';
import { extractHistoricalHours } from './excel-tools';

export default function HoursHistoryImport({ onImport }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file) {
    if (!file) return;

    setBusy(true);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, {
        type: 'array',
        cellDates: true,
        cellFormula: true,
      });

      const history = extractHistoricalHours(workbook);

      if (!history.hours.length) {
        throw new Error('No se encontraron históricos reconocibles en la hoja "Gastos y horas".');
      }

      const totalHours = history.hours.reduce(
        (sum, row) => sum + Number(row.hours || 0),
        0
      );

      const ok = window.confirm(
        `Se encontraron ${history.hours.length.toLocaleString('es-AR')} registros históricos ` +
        `del ejercicio ${history.year}, con ${totalHours.toLocaleString('es-AR', { maximumFractionDigits: 2 })} horas.\n\n` +
        'Se combinarán con las horas actuales sin borrar el Libro de contabilidad ni duplicar registros ya importados. ¿Continuar?'
      );

      if (!ok) return;

      onImport?.(history);

      window.alert(
        `Históricos procesados: ${history.hours.length.toLocaleString('es-AR')} registros · ` +
        `${totalHours.toLocaleString('es-AR', { maximumFractionDigits: 2 })} horas · ejercicio ${history.year}.`
      );
    } catch (error) {
      console.error(error);
      window.alert(error?.message || 'No se pudieron importar los históricos de horas.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="hours-history-import">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        hidden
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      <div>
        <strong>Históricos del Excel original</strong>
        <span>
          Importa solamente la matriz de la hoja “Gastos y horas”; no reemplaza movimientos del Libro.
        </span>
      </div>

      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Leyendo históricos…' : '↑ Importar históricos de horas'}
      </button>
    </div>
  );
}
