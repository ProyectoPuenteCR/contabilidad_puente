const PROJECT_NAME_PATTERNS = [
  /ASOCIACION\s+CIVIL\s+PROYECTO\s+PUENTE/i,
  /ASOCIACION\s+CIVIL\s+PROYECTO\s+PUEN/i,
  /PROYECTO\s+PUENTE/i,
];

const PROJECT_CUIT_DIGITS = '30717489396';

const MONTHS = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const SUMMARY_WORDS = [
  'subtotal',
  'importe total',
  'total adeudado',
  'cargos totales',
  'pago ars',
  'iva contenido',
  'otros tributos',
  'otros impuestos',
  'cae',
  'vto cae',
  'vencimiento cae',
  'son pesos',
];

const ITEM_HEADER_WORDS = [
  'concepto',
  'descripción',
  'descripcion',
  'producto / servicio',
  'producto/servicio',
  'detalle',
  'código producto',
  'codigo producto',
];

function cleanLine(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function normalizeExtractedText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
    .join('\n');
}

export function normalizeDocumentKey(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function parseArgMoney(value) {
  const raw = String(value ?? '')
    .replace(/ARS/gi, '')
    .replace(/\$/g, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9.,-]/g, '');

  if (!raw) return 0;

  const negative = raw.startsWith('-');
  let numberPart = raw.replace(/-/g, '');

  const lastComma = numberPart.lastIndexOf(',');
  const lastDot = numberPart.lastIndexOf('.');

  let normalized = numberPart;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandSeparator = decimalSeparator === ',' ? '.' : ',';

    normalized = numberPart.split(thousandSeparator).join('');
    if (decimalSeparator === ',') {
      normalized = normalized.replace(',', '.');
    }
  } else if (lastComma >= 0) {
    const decimals = numberPart.length - lastComma - 1;
    if (decimals === 1 || decimals === 2) {
      normalized = numberPart.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = numberPart.replace(/,/g, '');
    }
  } else if (lastDot >= 0) {
    const decimals = numberPart.length - lastDot - 1;
    if (decimals === 1 || decimals === 2) {
      normalized = numberPart.replace(/,/g, '');
    } else {
      normalized = numberPart.replace(/\./g, '');
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;

  return negative ? -parsed : parsed;
}

function formatIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    y < 2000 ||
    y > 2100 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31
  ) {
    return '';
  }

  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateCandidate(value) {
  const text = cleanLine(value).toLowerCase();

  let match = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (match) {
    return formatIsoDate(match[3], match[2], match[1]);
  }

  match = text.match(
    /\b(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s*(?:de\s+)?(\d{4})\b/i
  );
  if (match) {
    return formatIsoDate(match[3], MONTHS[match[2].toLowerCase()], match[1]);
  }

  return '';
}

function firstLabeledDate(text) {
  const patterns = [
    /fecha\s+de\s+emisi[oó]n\s*:?\s*([^\n]+)/i,
    /fecha\s+del\s+recibo\s*:?\s*([^\n]+)/i,
    /fecha\s*:?\s*([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const parsed = parseDateCandidate(match[1]);
    if (parsed) return parsed;
  }

  const lines = text.split('\n');
  for (const line of lines) {
    const parsed = parseDateCandidate(line);
    if (parsed) return parsed;
  }

  return '';
}

function findProjectMention(text) {
  return PROJECT_NAME_PATTERNS.some((pattern) => pattern.test(text));
}

function looksLikeProject(value) {
  const text = String(value || '');
  return (
    PROJECT_NAME_PATTERNS.some((pattern) => pattern.test(text)) ||
    text.replace(/\D/g, '').includes(PROJECT_CUIT_DIGITS)
  );
}

function normalizeCuit(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11) return '';
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function extractExternalCuit(text) {
  const candidates = [...text.matchAll(/\b(?:CUIT|C\.U\.I\.T\.?|CUIL)\s*:?\s*([0-9]{2}\D?[0-9]{8}\D?[0-9])/gi)]
    .map((match) => normalizeCuit(match[1]))
    .filter(Boolean);

  return candidates.find((value) => value.replace(/\D/g, '') !== PROJECT_CUIT_DIGITS) || candidates[0] || '';
}

function extractDocumentNumber(text) {
  const patterns = [
    /(?:N[°ºo.]?\s*|Nro\.?\s*:?\s*)(\d{4,5}\s*[-–]\s*\d{6,8})/i,
    /Comp\.?\s*Nro\.?\s*:?\s*(\d{6,8})/i,
    /(?:FACTURA|Factura)\s*(?:N[°ºo.]?\s*)?(\d{4,5}\s*[-–]\s*\d{6,8})/i,
    /\b(INV-[A-Z0-9-]{8,})\b/i,
    /N[.º°\s]*de\s+operaci[oó]n(?:\s+de\s+Mercado\s+Pago)?\s*\n?\s*(\d{7,})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const number = cleanLine(match[1]).replace(/\s+/g, '');
    if (number) return number;
  }

  return '';
}

function extractInvoiceType(text) {
  const match = text.match(/\b([ABC])\s*(?:FACTURA|Cod\.?\s*0?\d+)/i);
  if (match) return match[1].toUpperCase();

  const reversed = text.match(/(?:FACTURA|Factura)[\s\S]{0,30}\b([ABC])\b/i);
  return reversed ? reversed[1].toUpperCase() : '';
}

function detectDocumentKind(text) {
  if (/comprobante\s+de\s+transferencia/i.test(text) || /n[.º°\s]*de\s+operaci[oó]n\s+de\s+mercado\s+pago/i.test(text)) {
    return 'Transferencia';
  }

  if (/documento\s+no\s+v[aá]lido\s+como\s+factura/i.test(text) || /\brecibo\b/i.test(text)) {
    return 'Recibo';
  }

  if (/\bfactura\b/i.test(text)) {
    return 'Factura';
  }

  return 'Comprobante';
}

function findTotalWithPattern(text, pattern) {
  const match = text.match(pattern);
  if (!match) return 0;
  return parseArgMoney(match[1]);
}

function extractTotal(text) {
  const patterns = [
    /importe\s+total\s*[:$ ]*([0-9][0-9.,]*)/i,
    /total\s+adeudado\s*ARS\s*([0-9][0-9.,]*)/i,
    /cargos\s+totales\s*ARS\s*([0-9][0-9.,]*)/i,
    /pago\s*ARS\s*([0-9][0-9.,]*)/i,
    /(?:^|\n)\s*TOTAL\s*[:$ ]*([0-9][0-9.,]*)/im,
    /\$\s*([0-9]{1,3}(?:[.][0-9]{3})+(?:,[0-9]{2})?)/,
  ];

  for (const pattern of patterns) {
    const value = findTotalWithPattern(text, pattern);
    if (value > 0) return value;
  }

  const candidates = [];
  const matches = text.matchAll(/(?:ARS\s*|\$\s*)?([0-9]{1,9}(?:[.,][0-9]{2,3})+(?:[.,][0-9]{2})?)/g);

  for (const match of matches) {
    const token = match[1];
    const value = parseArgMoney(token);

    if (
      value > 0 &&
      value < 1_000_000_000 &&
      !/^20\d{2}[.,]/.test(token)
    ) {
      candidates.push(value);
    }
  }

  return candidates.length ? Math.max(...candidates) : 0;
}

function extractSupplier(text) {
  const lines = text.split('\n').map(cleanLine).filter(Boolean);

  const labeled = [...text.matchAll(/raz[oó]n\s+social\s*:?\s*([^\n]+)/gi)]
    .map((match) => cleanLine(match[1]))
    .filter((value) => value && !looksLikeProject(value) && !/^(web|tel[eé]fono|domicilio|condici[oó]n)/i.test(value));

  if (labeled.length) return labeled[0];

  const explicitCompanies = [
    /\bStarlink Argentina S\.R\.L\.\b/i,
    /\bKURIABE S\.A\.\b/i,
    /\bELVIRA GALIMIDI\b/i,
    /\bOROZCO PEDRO JESUS\b/i,
  ];

  for (const pattern of explicitCompanies) {
    const match = text.match(pattern);
    if (match) return cleanLine(match[0]);
  }

  for (const line of lines.slice(0, 18)) {
    if (
      looksLikeProject(line) ||
      /^(factura|original|duplicado|triplicado|recibo|cod\.?|fecha|domicilio|cuit|iva|condici[oó]n|tel[eé]fono|web)/i.test(line)
    ) {
      continue;
    }

    if (
      /[A-Za-zÁÉÍÓÚÑáéíóúñ]{4}/.test(line) &&
      line.length >= 5 &&
      line.length <= 80 &&
      !/^[0-9.,$\s-]+$/.test(line)
    ) {
      return line;
    }
  }

  return '';
}

function detectDirection(text, kind) {
  if (kind === 'Transferencia') {
    if (looksLikeProject(text)) {
      const projectIndex = text.search(/PROYECTO\s+PUENTE/i);
      const originIndex = text.search(/origen/i);
      const destinationIndex = text.search(/destino/i);

      if (projectIndex >= 0 && destinationIndex >= 0 && projectIndex > destinationIndex) {
        return 'Entrada';
      }

      if (projectIndex >= 0 && originIndex >= 0 && projectIndex > originIndex) {
        return 'Salida';
      }
    }

    return 'Revisar';
  }

  const customerPatterns = [
    /cliente\s*:?\s*ASOCIACION\s+CIVIL\s+PROYECTO/i,
    /nombre\s*:?\s*ASOCIACION\s+CIVIL\s+PROYECTO/i,
    /apellido\s+y\s+nombre\s*\/\s*raz[oó]n\s+social\s*:?\s*ASOCIACION\s+CIVIL\s+PROYECTO/i,
    /raz[oó]n\s+social\s*:?\s*ASOCIACION\s+CIVIL\s+PROYECTO/i,
    /attn\s*:?\s*proyecto\s+puente/i,
  ];

  if (customerPatterns.some((pattern) => pattern.test(text))) {
    return 'Salida';
  }

  if (findProjectMention(text)) {
    return 'Salida';
  }

  return 'Revisar';
}

function moneyTokens(line) {
  const tokens = [...String(line || '').matchAll(/(?:ARS\s*|\$\s*)?([0-9]{1,9}(?:[.,][0-9]{2,3})+(?:[.,][0-9]{2})?)/g)];
  return tokens
    .map((match) => ({
      raw: match[0],
      value: parseArgMoney(match[1]),
      index: match.index || 0,
    }))
    .filter((item) => item.value > 0 && item.value < 1_000_000_000);
}

function stripNumericColumns(line) {
  return cleanLine(
    String(line || '')
      .replace(/(?:ARS\s*|\$\s*)?[0-9]{1,9}(?:[.,][0-9]{2,3})+(?:[.,][0-9]{2})?/g, ' ')
      .replace(/^\s*\d+(?:[.,]\d+)?\s+/g, ' ')
      .replace(/\b(?:0[.,]00|10[.,]5|21[.,]00|21)\b/g, ' ')
      .replace(/\s{2,}/g, ' ')
  );
}

function extractItems(text, total) {
  const lines = text.split('\n').map(cleanLine).filter(Boolean);
  const items = [];

  let inItemArea = false;
  let pendingDescription = '';

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (ITEM_HEADER_WORDS.some((word) => lower.includes(word))) {
      inItemArea = true;
      continue;
    }

    if (inItemArea && SUMMARY_WORDS.some((word) => lower.includes(word))) {
      if (items.length) break;
    }

    if (!inItemArea && !/\b(alquiler|sensor|pila|mopa|tester|gps|antena|starlink|residencial|envio|envío|placa|modulo|módulo|limp|aromat|servicio|modo de espera)\b/i.test(line)) {
      continue;
    }

    const tokens = moneyTokens(line);
    const description = stripNumericColumns(line);

    if (!tokens.length) {
      if (
        /[A-Za-zÁÉÍÓÚÑáéíóúñ]{4}/.test(description) &&
        !/^(cantidad|precio|importe|iva|bonif|cuit|fecha|domicilio|condici[oó]n|vencimiento)/i.test(description)
      ) {
        pendingDescription = pendingDescription
          ? `${pendingDescription} ${description}`.slice(0, 220)
          : description.slice(0, 220);
      }
      continue;
    }

    const amountToken = tokens[tokens.length - 1];
    const amount = amountToken.value;

    if (
      amount <= 0 ||
      (total > 0 && amount > total * 1.15) ||
      /(?:subtotal|importe total|total|iva|otros tributos|cae|cotizaci[oó]n)/i.test(line)
    ) {
      continue;
    }

    let itemDescription = description;

    if (
      !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{4}/.test(itemDescription) ||
      itemDescription.length < 4
    ) {
      itemDescription = pendingDescription;
    } else if (pendingDescription && itemDescription.length < 35) {
      itemDescription = `${pendingDescription} ${itemDescription}`;
    }

    itemDescription = cleanLine(itemDescription)
      .replace(/^(u|unidades?)\s+/i, '')
      .slice(0, 220);

    if (
      itemDescription &&
      !items.some(
        (item) =>
          item.description.toUpperCase() === itemDescription.toUpperCase() &&
          Math.abs(item.amount - amount) < 0.01
      )
    ) {
      items.push({
        description: itemDescription,
        amount,
      });
    }

    pendingDescription = '';
  }

  return items.slice(0, 20);
}

function preferredConcept(candidates, names) {
  const upper = names.map((name) => String(name || '').toUpperCase());

  for (const candidate of candidates) {
    const index = upper.findIndex((name) => name === candidate.toUpperCase());
    if (index >= 0) return names[index];
  }

  return '';
}

export function suggestAccountingConcept(parsed, conceptOptions = []) {
  const names = Array.isArray(conceptOptions) ? conceptOptions : [];
  if (!names.length) return '';

  const source = [
    parsed?.supplier,
    parsed?.detail,
    ...(parsed?.items || []).map((item) => item.description),
  ].join(' ').toLowerCase();

  if (/alquiler|locaci[oó]n/.test(source)) {
    const exact = preferredConcept(
      ['ALQUILERES INSTALACIONES', 'ALQUILER', 'Alquiler'],
      names
    );
    if (exact) return exact;
  }

  if (/salario|haberes|especialista/.test(source)) {
    const exact = preferredConcept(
      ['Salarios y pagos Especialistas', 'SALARIOS Y PAGOS ESPECIALISTAS'],
      names
    );
    if (exact) return exact;
  }

  if (/sensor|placa|pila|bater[ií]a|tester|gps|antena|mopa|limp|aromat|repuesto|material|cable|adaptador|switch|term[oó]metro/.test(source)) {
    const exact = preferredConcept(
      ['MATERIALES Y REPUESTOS', 'Compra Insumos', 'COMPRA INSUMOS'],
      names
    );
    if (exact) return exact;
  }

  if (/starlink|internet|conectividad|suscripci[oó]n|servicio/.test(source)) {
    const exact = preferredConcept(
      ['Compra Insumos', 'SERVICIOS', 'Servicios'],
      names
    );
    if (exact) return exact;
  }

  const sourceTokens = new Set(
    source
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)
  );

  let best = '';
  let bestScore = 0;

  for (const name of names) {
    const tokens = String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);

    const score = tokens.reduce(
      (sum, token) => sum + (sourceTokens.has(token) ? 1 : 0),
      0
    );

    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : '';
}

export function suggestAccount(parsed, accountOptions = []) {
  const names = Array.isArray(accountOptions) ? accountOptions : [];
  const text = String(parsed?.rawText || '').toUpperCase();

  if (/MERCADO\s*PAGO/.test(text)) {
    const preferred = preferredConcept(
      ['MERCADO LIBRE', 'MERCADO LIBRE 2'],
      names
    );
    if (preferred) return preferred;
  }

  for (const account of names) {
    if (text.includes(String(account).toUpperCase())) {
      return account;
    }
  }

  return '';
}

function buildDetail({ supplier, items, kind }) {
  const itemText = (items || [])
    .slice(0, 3)
    .map((item) => item.description)
    .filter(Boolean)
    .join(' · ');

  if (kind === 'Transferencia') {
    return itemText || 'Transferencia detectada desde comprobante';
  }

  return [supplier, itemText]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 500);
}

export function parseInvoiceText(rawText, {
  fileName = '',
  conceptOptions = [],
  accountOptions = [],
} = {}) {
  const text = normalizeExtractedText(rawText);
  const kind = detectDocumentKind(text);
  const total = extractTotal(text);
  const supplier = extractSupplier(text);
  const items = extractItems(text, total);
  const direction = detectDirection(text, kind);

  const parsed = {
    fileName,
    rawText: text,
    kind,
    invoiceType: extractInvoiceType(text),
    documentNumber: extractDocumentNumber(text),
    date: firstLabeledDate(text),
    supplier,
    supplierCuit: extractExternalCuit(text),
    total,
    direction,
    account: '',
    concept: '',
    folder: kind === 'Transferencia' ? 'Transferencias' : 'Facturas',
    detail: '',
    notes: '',
    items,
    confidence: 0,
  };

  parsed.detail = buildDetail(parsed);
  parsed.account = suggestAccount(parsed, accountOptions);
  parsed.concept = suggestAccountingConcept(parsed, conceptOptions);

  const checks = [
    Boolean(parsed.date),
    Boolean(parsed.documentNumber),
    Boolean(parsed.supplier),
    parsed.total > 0,
    parsed.direction !== 'Revisar',
  ];

  parsed.confidence = Math.round(
    (checks.filter(Boolean).length / checks.length) * 100
  );

  return parsed;
}

export function findPossibleDuplicate(parsed, movements = []) {
  const documentKey = normalizeDocumentKey(parsed?.documentNumber);
  const total = Number(parsed?.total || 0);

  return (Array.isArray(movements) ? movements : []).find((row) => {
    const invoiceKey = normalizeDocumentKey(row?.invoice);
    const operationKey = normalizeDocumentKey(row?.operation);
    const amount = Number(row?.income || 0) + Number(row?.expense || 0);

    const sameDocument = Boolean(documentKey) &&
      (invoiceKey === documentKey || operationKey === documentKey);

    const sameAmount = total > 0 && Math.abs(amount - total) < 0.01;
    const sameDate = !parsed?.date || !row?.date || parsed.date === row.date;

    return sameDocument || (sameAmount && sameDate && parsed?.supplier && String(row?.detail || '').toUpperCase().includes(String(parsed.supplier).toUpperCase()));
  }) || null;
}
