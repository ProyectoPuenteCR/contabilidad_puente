'use client';

import { useRef, useState } from 'react';

const MONTHS = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pick(row, aliases) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])
  );
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (normalized.has(key)) return normalized.get(key);
  }
  return '';
}

function parseAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return 0;

  let text = String(value).trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!text) return 0;

  if (text.includes('.') && text.includes(',')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1) {
    text = text.replace(/\./g, '');
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateToIso(value, XLSX) {
  if (!value) return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof value === 'number') {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) {
      return `${String(parts.y).padStart(4,'0')}-${String(parts.m).padStart(2,'0')}-${String(parts.d).padStart(2,'0')}`;
    }
  }

  const text = String(value).trim();
  if (!text) return '';

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${String(iso[2]).padStart(2,'0')}-${String(iso[3]).padStart(2,'0')}`;
  }

  const latam = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (latam) {
    let year = Number(latam[3]);
    if (year < 100) year += 2000;
    return `${String(year).padStart(4,'0')}-${String(latam[2]).padStart(2,'0')}-${String(latam[1]).padStart(2,'0')}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return '';
}

function movementFromRow(row, XLSX) {
  const date = dateToIso(pick(row, ['FECHA', 'Fecha']), XLSX);
  const account = String(pick(row, ['banco', 'Banco', 'Cuenta']) || '').trim();
  const folder = String(pick(row, ['Carpeta']) || '').trim();
  const concept = String(pick(row, ['Concepto']) || '').trim();
  const detail = String(pick(row, ['Detalle']) || '').trim();
  const operation = String(
    pick(row, ['operación n.º', 'operacion n', 'operación', 'operacion', 'operación n°']) || ''
  ).trim();
  const income = parseAmount(pick(row, ['Entradas (+)', 'Entradas', 'Entrada']));
  const expense = parseAmount(pick(row, ['Salidas ( - )', 'Salidas (-)', 'Salidas', 'Salida']));
  const invoice = String(pick(row, ['Factura n', 'Factura', 'Factura nº', 'Factura N°']) || '').trim();
  const notes = String(pick(row, ['OBS', 'Observaciones', 'Obs.']) || '').trim();

  const useful = date || account || folder || concept || detail || operation || income || expense || invoice || notes;
  if (!useful) return null;

  return {
    id: crypto.randomUUID(),
    date,
    account,
    folder,
    concept,
    detail,
    operation,
    income,
    expense,
    invoice,
    notes,
  };
}

function exportRows(movements) {
  let runningBalance = 0;

  return movements
    .slice()
    .sort((a, b) => {
      const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
      if (dateCompare !== 0) return dateCompare;
      return String(a.operation || '').localeCompare(String(b.operation || ''));
    })
    .map((m) => {
      const income = Number(m.income || 0);
      const expense = Number(m.expense || 0);
      runningBalance += income - expense;
      const date = m.date ? new Date(`${m.date}T12:00:00`) : null;

      return {
        Mes: date ? MONTHS[date.getMonth()] : '',
        año: date ? date.getFullYear() : '',
        banco: m.account || '',
        Carpeta: m.folder || '',
        FECHA: m.date || '',
        Concepto: m.concept || '',
        Detalle: m.detail || '',
        'operación n.º': m.operation || '',
        'Entradas (+)': income || '',
        'Salidas ( - )': expense || '',
        SALDO: runningBalance,
        'Factura n': m.invoice || '',
        OBS: m.notes || '',
      };
    });
}

function makeTemplateRows() {
  return [
    {
      Mes: 'Octubre',
      año: 2026,
      banco: 'CREDICOOP',
      Carpeta: 'Servicios',
      FECHA: '2026-10-01',
      Concepto: 'INGRESOS POR SERVICIOS',
      Detalle: 'Ejemplo de ingreso',
      'operación n.º': 'OP-0001',
      'Entradas (+)': 150000,
      'Salidas ( - )': '',
      SALDO: 150000,
      'Factura n': 'FC-0001',
      OBS: 'Fila de ejemplo',
    },
    {
      Mes: 'Octubre',
      año: 2026,
      banco: 'MERCADO LIBRE',
      Carpeta: 'Administración',
      FECHA: '2026-10-02',
      Concepto: 'SERVICIOS',
      Detalle: 'Ejemplo de egreso',
      'operación n.º': 'OP-0002',
      'Entradas (+)': '',
      'Salidas ( - )': 25000,
      SALDO: 125000,
      'Factura n': '',
      OBS: 'Fila de ejemplo',
    },
  ];
}

function styleSheet(sheet) {
  sheet['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 13 },
    { wch: 28 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    { wch: 16 }, { wch: 18 }, { wch: 32 },
  ];
  sheet['!autofilter'] = { ref: sheet['!ref'] };
}

export default function ExcelTools({ movements, onImport }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function importExcel(file) {
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

      const preferred = workbook.SheetNames.find(
        (name) => normalizeHeader(name) === 'libro de contabilidad'
      );
      const sheetName = preferred || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      if (!sheet) throw new Error('No se encontró una hoja para importar.');

      const rawRows = XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        raw: true,
      });

      const validRows = rawRows
        .map((row) => movementFromRow(row, XLSX))
        .filter(Boolean)
        .filter((m) => m.date || m.account || m.concept || m.detail || m.income || m.expense);

      if (!validRows.length) {
        throw new Error('El archivo no contiene movimientos reconocibles.');
      }

      const confirmText =
        `Se encontraron ${validRows.length.toLocaleString('es-AR')} movimientos en la hoja "${sheetName}".\n\n` +
        'Aceptar reemplazará los movimientos actualmente guardados en este navegador.';

      if (!window.confirm(confirmText)) return;

      onImport(validRows);
      window.alert(
        `Importación completada: ${validRows.length.toLocaleString('es-AR')} movimientos cargados.`
      );
    } catch (error) {
      console.error(error);
      window.alert(error?.message || 'No se pudo importar el archivo Excel.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function exportExcel() {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const rows = exportRows(movements);
      const sheet = XLSX.utils.json_to_sheet(rows, {
        header: [
          'Mes','año','banco','Carpeta','FECHA','Concepto','Detalle',
          'operación n.º','Entradas (+)','Salidas ( - )','SALDO','Factura n','OBS'
        ],
      });
      styleSheet(sheet);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Libro de contabilidad');
      XLSX.writeFile(workbook, 'Libro_contabilidad_Puente_export.xlsx', {
        compression: true,
      });
    } catch (error) {
      console.error(error);
      window.alert('No se pudo exportar el archivo Excel.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.json_to_sheet(makeTemplateRows(), {
        header: [
          'Mes','año','banco','Carpeta','FECHA','Concepto','Detalle',
          'operación n.º','Entradas (+)','Salidas ( - )','SALDO','Factura n','OBS'
        ],
      });
      styleSheet(sheet);

      const info = XLSX.utils.aoa_to_sheet([
        ['Plantilla de importación - Proyecto Puente'],
        ['La aplicación busca preferentemente la hoja "Libro de contabilidad".'],
        ['Campos principales reconocidos: FECHA, banco/Cuenta, Carpeta, Concepto, Detalle, operación n.º, Entradas (+), Salidas ( - ), Factura n y OBS.'],
        ['FECHA puede estar como fecha de Excel, DD/MM/AAAA o AAAA-MM-DD.'],
        ['Entradas y Salidas deben ser importes numéricos.'],
        ['SALDO, Mes y año son opcionales para la importación.'],
        ['Al importar, la aplicación muestra la cantidad detectada antes de reemplazar los movimientos actuales.'],
      ]);
      info['!cols'] = [{ wch: 120 }];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Libro de contabilidad');
      XLSX.utils.book_append_sheet(workbook, info, 'Instrucciones');
      XLSX.writeFile(workbook, 'Plantilla_importacion_Contabilidad_Puente.xlsx', {
        compression: true,
      });
    } catch (error) {
      console.error(error);
      window.alert('No se pudo generar la plantilla.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="excel-tools">
      <input
        ref={inputRef}
        className="excel-file-input"
        type="file"
        accept=".xlsx,.xls,.xlsm"
        onChange={(event) => importExcel(event.target.files?.[0])}
      />
      <button type="button" className="secondary excel-button" onClick={() => inputRef.current?.click()} disabled={busy}>
        ↑ Importar Excel
      </button>
      <button type="button" className="secondary excel-button" onClick={exportExcel} disabled={busy || movements.length === 0}>
        ↓ Exportar Excel
      </button>
      <button type="button" className="secondary excel-button" onClick={downloadTemplate} disabled={busy}>
        ⧉ Descargar plantilla
      </button>
      <span className="excel-count">
        {movements.length.toLocaleString('es-AR')} movimientos cargados
      </span>
    </div>
  );
}
