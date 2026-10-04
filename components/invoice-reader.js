'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findPossibleDuplicate,
  parseInvoiceText,
  suggestAccountingConcept,
} from '../lib/invoice-local-parser';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fileIsPdf(file) {
  return file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}

function fileIsImage(file) {
  return /^image\//i.test(file?.type || '') || /\.(png|jpe?g|webp|bmp)$/i.test(file?.name || '');
}

async function extractPdfText(file, onProgress) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes }).promise;

  let text = '';

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    onProgress?.({
      stage: 'pdf',
      progress: pageNumber / document.numPages,
      label: `Leyendo texto PDF · página ${pageNumber}/${document.numPages}`,
    });

    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();

    let pageText = '';

    for (const item of content.items || []) {
      const value = String(item?.str || '');
      if (!value) continue;
      pageText += value;
      pageText += item?.hasEOL ? '\n' : ' ';
    }

    text += `${pageText}\n`;
  }

  return {
    text,
    pdfDocument: document,
  };
}

async function renderPdfPageToCanvas(pdfDocument, pageNumber) {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.8 });

  const maxWidth = 1900;
  const scaleDown = viewport.width > maxWidth ? maxWidth / viewport.width : 1;
  const finalViewport = scaleDown === 1
    ? viewport
    : page.getViewport({ scale: 1.8 * scaleDown });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(finalViewport.width);
  canvas.height = Math.ceil(finalViewport.height);

  const context = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: false,
  });

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport: finalViewport,
  }).promise;

  return canvas;
}

export default function InvoiceReader({
  accountOptions = [],
  conceptOptions = [],
  movements = [],
  onImport,
}) {
  const inputRef = useRef(null);
  const ocrWorkerRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    return () => {
      if (ocrWorkerRef.current) {
        ocrWorkerRef.current.terminate().catch(() => {});
        ocrWorkerRef.current = null;
      }
    };
  }, []);

  const totals = useMemo(() => documents.reduce(
    (acc, document) => {
      if (document.imported) {
        acc.imported += 1;
      } else if (document.direction === 'Entrada') {
        acc.income += Number(document.total || 0);
      } else if (document.direction === 'Salida') {
        acc.expense += Number(document.total || 0);
      } else {
        acc.review += 1;
      }
      return acc;
    },
    { income: 0, expense: 0, review: 0, imported: 0 }
  ), [documents]);

  async function getOcrWorker(fileName) {
    if (ocrWorkerRef.current) return ocrWorkerRef.current;

    const { createWorker } = await import('tesseract.js');

    const worker = await createWorker('spa', 1, {
      logger(message) {
        const numericProgress = Number(message?.progress || 0);
        setProgress({
          stage: 'ocr',
          progress: numericProgress,
          label: `${fileName || 'Comprobante'} · ${message?.status || 'OCR local'}`,
        });
      },
    });

    ocrWorkerRef.current = worker;
    return worker;
  }

  async function runOcr(source, fileName) {
    const worker = await getOcrWorker(fileName);
    const result = await worker.recognize(source);
    return String(result?.data?.text || '');
  }

  async function readOneFile(file) {
    if (!fileIsPdf(file) && !fileIsImage(file)) {
      throw new Error('Formato no admitido. Usá PDF, JPG, PNG, WEBP o BMP.');
    }

    let rawText = '';
    let extraction = 'Texto PDF';

    if (fileIsPdf(file)) {
      const pdfResult = await extractPdfText(file, (state) => setProgress({
        ...state,
        label: `${file.name} · ${state.label}`,
      }));

      rawText = pdfResult.text;

      // Si el PDF es un escaneo o tiene muy poco texto seleccionable,
      // se renderizan localmente hasta 3 páginas y se aplica OCR en el navegador.
      if (rawText.replace(/\s/g, '').length < 120) {
        extraction = 'OCR local de PDF';
        const pages = Math.min(pdfResult.pdfDocument.numPages, 3);
        let ocrText = '';

        for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
          setProgress({
            stage: 'ocr',
            progress: (pageNumber - 1) / pages,
            label: `${file.name} · preparando OCR página ${pageNumber}/${pages}`,
          });

          const canvas = await renderPdfPageToCanvas(pdfResult.pdfDocument, pageNumber);
          ocrText += `${await runOcr(canvas, file.name)}\n`;
          canvas.width = 1;
          canvas.height = 1;
        }

        rawText = ocrText;
      }
    } else {
      extraction = 'OCR local de imagen';
      rawText = await runOcr(file, file.name);
    }

    const parsed = parseInvoiceText(rawText, {
      fileName: file.name,
      accountOptions,
      conceptOptions,
    });

    const duplicate = findPossibleDuplicate(parsed, movements);

    return {
      id: crypto.randomUUID(),
      ...parsed,
      extraction,
      duplicate,
      allowDuplicate: false,
      imported: false,
      error: '',
    };
  }

  async function processFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;

    setReading(true);

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];

        setProgress({
          stage: 'start',
          progress: 0,
          label: `Procesando ${index + 1}/${files.length} · ${file.name}`,
        });

        try {
          const document = await readOneFile(file);
          setDocuments((current) => [...current, document]);
        } catch (error) {
          setDocuments((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              fileName: file.name,
              kind: 'Comprobante',
              invoiceType: '',
              documentNumber: '',
              date: '',
              supplier: '',
              supplierCuit: '',
              total: 0,
              direction: 'Revisar',
              account: '',
              concept: '',
              folder: 'Facturas',
              detail: '',
              notes: '',
              items: [],
              confidence: 0,
              extraction: 'No leído',
              duplicate: null,
              allowDuplicate: false,
              imported: false,
              error: error?.message || 'No se pudo leer el comprobante.',
            },
          ]);
        }
      }
    } finally {
      setReading(false);
      setProgress(null);

      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  function patchDocument(id, patch) {
    setDocuments((current) => current.map((document) => {
      if (document.id !== id) return document;

      const next = {
        ...document,
        ...patch,
      };

      if (Object.prototype.hasOwnProperty.call(patch, 'detail')) {
        next.concept = next.concept || suggestAccountingConcept(next, conceptOptions);
      }

      next.duplicate = findPossibleDuplicate(next, movements);
      return next;
    }));
  }

  function removeDocument(id) {
    setDocuments((current) => current.filter((document) => document.id !== id));
  }

  function canImport(document) {
    return (
      !document.imported &&
      !document.error &&
      Boolean(document.date) &&
      Boolean(document.account) &&
      Boolean(document.concept) &&
      Number(document.total || 0) > 0 &&
      ['Entrada', 'Salida'].includes(document.direction) &&
      (!document.duplicate || document.allowDuplicate)
    );
  }

  function importDocument(document) {
    if (!canImport(document)) return;

    const isTransfer = document.kind === 'Transferencia';

    const movement = {
      date: document.date,
      account: document.account,
      folder: document.folder || (isTransfer ? 'Transferencias' : 'Facturas'),
      concept: document.concept,
      detail: String(document.detail || document.supplier || document.kind || 'Comprobante').slice(0, 700),
      operation: isTransfer ? document.documentNumber : '',
      income: document.direction === 'Entrada' ? Number(document.total || 0) : 0,
      expense: document.direction === 'Salida' ? Number(document.total || 0) : 0,
      invoice: isTransfer ? '' : document.documentNumber,
      notes: [
        'Importado desde Leer facturas.',
        'El archivo se procesó localmente y no fue almacenado.',
        document.supplierCuit ? `CUIT emisor: ${document.supplierCuit}` : '',
        document.kind ? `Tipo: ${document.kind}${document.invoiceType ? ` ${document.invoiceType}` : ''}` : '',
      ].filter(Boolean).join(' '),
    };

    onImport?.(movement, {
      source: 'invoice-reader',
      fileName: document.fileName,
      extraction: document.extraction,
      kind: document.kind,
      supplier: document.supplier,
      supplierCuit: document.supplierCuit,
      confidence: document.confidence,
      itemCount: document.items?.length || 0,
    });

    patchDocument(document.id, { imported: true });
  }

  function importAllReady() {
    documents
      .filter(canImport)
      .forEach(importDocument);
  }

  const readyCount = documents.filter(canImport).length;

  return (
    <div className="invoice-reader-page">
      <section className="invoice-reader-privacy">
        <div className="invoice-reader-shield">✓</div>
        <div>
          <strong>Lectura local · el comprobante no se almacena</strong>
          <p>
            Los PDF y las fotos se procesan en este navegador. La plataforma guarda
            únicamente los datos que confirmes al importar al Libro de contabilidad.
          </p>
        </div>
      </section>

      <section
        className={dragging ? 'invoice-drop-zone dragging' : 'invoice-drop-zone'}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          processFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          hidden
          onChange={(event) => processFiles(event.target.files)}
        />

        <div className="invoice-drop-icon">▧</div>
        <h2>Soltá facturas, recibos o comprobantes acá</h2>
        <p>
          PDF con texto, PDF escaneado, JPG, PNG o WEBP. También podés seleccionar
          varios archivos juntos.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => inputRef.current?.click()}
          disabled={reading}
        >
          {reading ? 'Leyendo comprobantes…' : 'Seleccionar comprobantes'}
        </button>
      </section>

      {progress && (
        <section className="invoice-reader-progress">
          <div>
            <strong>{progress.label}</strong>
            <span>{Math.round(Number(progress.progress || 0) * 100)}%</span>
          </div>
          <div className="invoice-reader-progress-track">
            <i style={{ width: `${Math.max(3, Number(progress.progress || 0) * 100)}%` }} />
          </div>
        </section>
      )}

      <section className="invoice-reader-summary">
        <div>
          <span>Comprobantes leídos</span>
          <strong>{documents.length}</strong>
        </div>
        <div>
          <span>Entradas pendientes</span>
          <strong className="income">{money.format(totals.income)}</strong>
        </div>
        <div>
          <span>Salidas pendientes</span>
          <strong className="expense">{money.format(totals.expense)}</strong>
        </div>
        <div>
          <span>Requieren revisión</span>
          <strong>{totals.review}</strong>
        </div>
      </section>

      {documents.length > 0 && (
        <div className="invoice-reader-batch-actions">
          <div>
            <strong>Revisión antes de importar</strong>
            <span>
              Corregí cualquier dato detectado antes de enviarlo al Libro.
            </span>
          </div>

          <button
            type="button"
            className="primary"
            disabled={!readyCount}
            onClick={importAllReady}
          >
            Importar listos ({readyCount})
          </button>
        </div>
      )}

      <div className="invoice-reader-list">
        {documents.map((document) => (
          <InvoiceDraftCard
            key={document.id}
            document={document}
            accountOptions={accountOptions}
            conceptOptions={conceptOptions}
            onChange={(patch) => patchDocument(document.id, patch)}
            onRemove={() => removeDocument(document.id)}
            onImport={() => importDocument(document)}
            canImport={canImport(document)}
          />
        ))}
      </div>
    </div>
  );
}

function InvoiceDraftCard({
  document,
  accountOptions,
  conceptOptions,
  onChange,
  onRemove,
  onImport,
  canImport,
}) {
  const confidenceTone =
    document.confidence >= 80
      ? 'ok'
      : document.confidence >= 50
        ? 'warning'
        : 'danger';

  return (
    <section className={document.imported ? 'invoice-draft imported' : 'invoice-draft'}>
      <div className="invoice-draft-head">
        <div>
          <span className="invoice-file-name">{document.fileName}</span>
          <div className="invoice-draft-badges">
            <span className="invoice-badge">{document.kind}</span>
            {document.invoiceType && <span className="invoice-badge">Tipo {document.invoiceType}</span>}
            <span className={`invoice-badge confidence ${confidenceTone}`}>
              Lectura {document.confidence}%
            </span>
            <span className="invoice-badge local">{document.extraction}</span>
            {document.imported && <span className="invoice-badge imported">Importado ✓</span>}
          </div>
        </div>

        <button type="button" className="icon-btn danger" onClick={onRemove}>×</button>
      </div>

      {document.error ? (
        <div className="invoice-reader-error">{document.error}</div>
      ) : (
        <>
          {document.duplicate && !document.imported && (
            <div className="invoice-duplicate-warning">
              <div>
                <strong>Posible duplicado en el Libro</strong>
                <span>
                  Ya existe un movimiento similar
                  {document.duplicate.invoice ? ` · factura ${document.duplicate.invoice}` : ''}
                  {document.duplicate.date ? ` · ${document.duplicate.date}` : ''}.
                </span>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={document.allowDuplicate}
                  onChange={(event) => onChange({ allowDuplicate: event.target.checked })}
                />
                Importar igualmente
              </label>
            </div>
          )}

          <div className="invoice-draft-grid">
            <label>
              Fecha
              <input
                type="date"
                value={document.date || ''}
                onChange={(event) => onChange({ date: event.target.value })}
              />
            </label>

            <label>
              Entrada / Salida
              <select
                value={document.direction || 'Revisar'}
                onChange={(event) => onChange({ direction: event.target.value })}
              >
                <option value="Revisar">Revisar</option>
                <option value="Salida">Salida / gasto</option>
                <option value="Entrada">Entrada / ingreso</option>
              </select>
            </label>

            <label>
              Cuenta
              <select
                value={document.account || ''}
                onChange={(event) => onChange({ account: event.target.value })}
              >
                <option value="">Seleccionar cuenta…</option>
                {accountOptions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label>
              Monto total
              <input
                type="number"
                step="0.01"
                min="0"
                value={Number(document.total || 0)}
                onChange={(event) => onChange({ total: Number(event.target.value || 0) })}
              />
            </label>

            <label>
              Nº factura / operación
              <input
                value={document.documentNumber || ''}
                onChange={(event) => onChange({ documentNumber: event.target.value })}
                placeholder="Ej. 0003-00000141"
              />
            </label>

            <label>
              Emisor / proveedor
              <input
                value={document.supplier || ''}
                onChange={(event) => onChange({ supplier: event.target.value })}
                placeholder="Razón social"
              />
            </label>

            <label>
              CUIT emisor
              <input
                value={document.supplierCuit || ''}
                onChange={(event) => onChange({ supplierCuit: event.target.value })}
                placeholder="00-00000000-0"
              />
            </label>

            <label>
              Carpeta
              <input
                value={document.folder || ''}
                onChange={(event) => onChange({ folder: event.target.value })}
                placeholder="Facturas"
              />
            </label>
          </div>

          <div className="invoice-accounting-row">
            <label>
              Concepto contable
              <input
                list={`invoice-concepts-${document.id}`}
                value={document.concept || ''}
                onChange={(event) => onChange({ concept: event.target.value })}
                placeholder="Seleccioná o escribí un concepto…"
              />
              <datalist id={`invoice-concepts-${document.id}`}>
                {conceptOptions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>

            <label>
              Detalle que irá al Libro
              <textarea
                rows={2}
                value={document.detail || ''}
                onChange={(event) => onChange({ detail: event.target.value })}
                placeholder="Descripción del comprobante"
              />
            </label>
          </div>

          <div className="invoice-items-block">
            <div className="invoice-items-head">
              <div>
                <strong>Conceptos / ítems detectados</strong>
                <span>
                  Se muestran para controlar la lectura. El Libro recibe el total confirmado arriba.
                </span>
              </div>
              <strong>{document.items?.length || 0} ítems</strong>
            </div>

            {document.items?.length ? (
              <div className="table-wrap invoice-items-table">
                <table>
                  <thead>
                    <tr>
                      <th>Descripción detectada</th>
                      <th>Monto detectado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.items.map((item, index) => (
                      <tr key={`${document.id}-item-${index}`}>
                        <td>{item.description}</td>
                        <td className="money-cell">{money.format(item.amount || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="invoice-no-items">
                No se pudieron separar los ítems con seguridad. Revisá proveedor, monto total,
                concepto y detalle antes de importar.
              </div>
            )}
          </div>

          <details className="invoice-raw-text">
            <summary>Ver texto detectado</summary>
            <pre>{document.rawText || 'Sin texto.'}</pre>
          </details>

          <div className="invoice-draft-footer">
            <div>
              {document.direction === 'Entrada' && (
                <span className="invoice-direction income">
                  Entrada {money.format(document.total || 0)}
                </span>
              )}
              {document.direction === 'Salida' && (
                <span className="invoice-direction expense">
                  Salida {money.format(document.total || 0)}
                </span>
              )}
              {document.direction === 'Revisar' && (
                <span className="invoice-direction review">
                  Falta confirmar Entrada / Salida
                </span>
              )}
            </div>

            <button
              type="button"
              className="primary"
              disabled={!canImport}
              onClick={onImport}
            >
              {document.imported ? 'Importado ✓' : 'Importar al Libro'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
