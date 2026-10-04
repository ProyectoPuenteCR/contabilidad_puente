export const initialMovements = [];

export const initialHours = [];

export const initialReceivables = [];

/*
 * Inputs auxiliares de la hoja Saldo.
 * Los saldos bancarios finales se calculan desde el Libro de contabilidad.
 * No se guardan como valores fijos.
 */
export const initialSaldoSnapshot = {
  source: 'Libro de contabilidad Puente.xlsm',
  importedAt: '2026-10-03T00:00:00.000Z',

  // Saldo!I5 - "Plata en el banco (Cash)".
  bankCash: 2083383.06,

  // Datos de inversiones mostrados en la hoja Saldo.
  investmentPrincipalParts: [
    55949553.09,
    88678224.56,
  ],
  investmentInterestParts: [
    907455.77,
    1348394.92,
  ],
  investmentMaturityParts: [
    56829785.19,
    89986167.63,
  ],

  mercadoLibreCapitalization: -100000,

  // Resumen mensual del modelo de Gastos y horas.
  currentMonth: 'octubre',
  monthExpense: 18422258.94211615,
  monthIncome: 20638583,
  salaryPayments: 15126280,
};

export const initialInstitutions = [
  { id: 'credicoop', name: 'CREDICOOP', type: 'Banco', active: true },
  { id: 'mercado-libre', name: 'MERCADO LIBRE', type: 'Billetera virtual', active: true },
  { id: 'mercado-libre-2', name: 'MERCADO LIBRE 2', type: 'Billetera virtual', active: true },
  { id: 'prex', name: 'PREX', type: 'Billetera virtual', active: true },
  { id: 'personal-pay', name: 'PERSONAL PAY', type: 'Billetera virtual', active: true },
  { id: 'efectivo', name: 'EFECTIVO', type: 'Efectivo', active: true },
];

export const accounts = initialInstitutions.map((item) => item.name);
