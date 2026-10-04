export const initialMovements = [];

export const initialHours = [];

export const initialReceivables = [];

/*
 * Inputs copied from the original workbook.
 * Final Saldo values are NOT stored here: the web calculates them
 * with the same formulas used by the Excel workbook.
 */
export const initialSaldoSnapshot = {
  source: 'Libro de contabilidad Puente.xlsm',
  importedAt: '2026-10-03T00:00:00.000Z',

  // Saldo!I5 - manual cash available outside the invested amount.
  bankCash: 2083383.06,

  // Saldo!G28:G30 - eCheqs / future collections.
  futureReceivableItems: [
    4855225.58,
    18322229.01,
    4853882.18,
  ],

  // CONTROL DE TAREAS RRHH!H11:H13
  certification45Items: [
    { hours: 40, rate: 93263.39 },
    { hours: 28.5, rate: 93263.39 },
    { hours: 5, rate: 59006.57 },
  ],

  // Saldo!I9:J9
  investmentPrincipalParts: [
    55949553.09,
    88678224.56,
  ],

  // Saldo!I10:J10
  investmentInterestParts: [
    907455.77,
    1348394.92,
  ],

  // Saldo!I12:J12
  investmentMaturityParts: [
    56829785.19,
    89986167.63,
  ],

  // Capitalización Mercado Libre (Saldo!K5).
  mercadoLibreCapitalization: -100000,

  // Monthly model values from "Gastos y horas".
  // Balance, ratios and margin are calculated in the web.
  currentMonth: 'octubre',
  monthExpense: 18422258.94211615,
  monthIncome: 20638583,
  salaryPayments: 15126280,
};

export const accounts = [
  'CREDICOOP',
  'MERCADO LIBRE',
  'MERCADO LIBRE 2',
  'EFECTIVO',
  'PREX',
  'PERSONAL PAY',
];
