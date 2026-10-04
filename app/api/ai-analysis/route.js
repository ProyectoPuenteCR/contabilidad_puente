import { auth } from '../../../auth';

export const runtime = 'nodejs';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function finite(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function sanitizeText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function sanitizeSummary(input) {
  const summary = input && typeof input === 'object' ? input : {};

  return {
    year: sanitizeText(summary.year, 4),
    totals: {
      income: finite(summary.totals?.income),
      expense: finite(summary.totals?.expense),
      result: finite(summary.totals?.result),
      marginPct: finite(summary.totals?.marginPct),
      movements: Math.max(0, Math.round(finite(summary.totals?.movements))),
    },
    topExpenseConcepts: (summary.topExpenseConcepts || []).slice(0, 10).map((item) => ({
      concept: sanitizeText(item?.concept),
      expense: finite(item?.expense),
      count: Math.max(0, Math.round(finite(item?.count))),
    })),
    topIncomeConcepts: (summary.topIncomeConcepts || []).slice(0, 10).map((item) => ({
      concept: sanitizeText(item?.concept),
      income: finite(item?.income),
      count: Math.max(0, Math.round(finite(item?.count))),
    })),
    accounts: (summary.accounts || []).slice(0, 20).map((item) => ({
      account: sanitizeText(item?.account),
      income: finite(item?.income),
      expense: finite(item?.expense),
      result: finite(item?.result),
      count: Math.max(0, Math.round(finite(item?.count))),
    })),
    monthly: (summary.monthly || []).slice(0, 12).map((item) => ({
      month: sanitizeText(item?.month, 7),
      income: finite(item?.income),
      expense: finite(item?.expense),
      result: finite(item?.result),
    })),
    invoices: {
      withInvoice: Math.max(0, Math.round(finite(summary.invoices?.withInvoice))),
      withoutInvoice: Math.max(0, Math.round(finite(summary.invoices?.withoutInvoice))),
      coveragePct: finite(summary.invoices?.coveragePct),
      expenseWithInvoice: finite(summary.invoices?.expenseWithInvoice),
      expenseWithoutInvoice: finite(summary.invoices?.expenseWithoutInvoice),
    },
    investments: (summary.investments || []).slice(0, 12).map((item) => ({
      name: sanitizeText(item?.name),
      bank: sanitizeText(item?.bank),
      principal: finite(item?.principal),
      reimbursement: finite(item?.reimbursement),
      maturityDate: sanitizeText(item?.maturityDate, 10),
      status: sanitizeText(item?.status, 30),
    })),
  };
}

function localAnalysis(summary) {
  const { totals, invoices } = summary;
  const strengths = [];
  const alerts = [];
  const recommendations = [];
  const observations = [];

  if (totals.result > 0) {
    strengths.push(
      `El año cerró con resultado positivo de ARS ${totals.result.toLocaleString('es-AR', { maximumFractionDigits: 0 })}, equivalente a un margen aproximado de ${totals.marginPct.toFixed(1)}% sobre los ingresos.`
    );
  } else if (totals.result === 0) {
    strengths.push('El ejercicio quedó equilibrado entre ingresos y gastos.');
  }

  if (invoices.coveragePct >= 80) {
    strengths.push(
      `La cobertura de movimientos con factura es alta: ${invoices.coveragePct.toFixed(1)}% de los registros tiene comprobante informado.`
    );
  }

  const topExpense = summary.topExpenseConcepts[0];
  if (topExpense && totals.expense > 0) {
    const concentration = (topExpense.expense / totals.expense) * 100;
    if (concentration >= 35) {
      alerts.push(
        `El concepto "${topExpense.concept}" concentra aproximadamente ${concentration.toFixed(1)}% del gasto anual. Conviene revisar si esa concentración es esperada.`
      );
    } else {
      strengths.push('Los gastos no muestran una concentración extrema en un único concepto principal.');
    }
  }

  if (totals.result < 0) {
    alerts.push(
      `El resultado del ejercicio es negativo en ARS ${Math.abs(totals.result).toLocaleString('es-AR', { maximumFractionDigits: 0 })}.`
    );
  }

  if (invoices.withoutInvoice > 0) {
    alerts.push(
      `Hay ${invoices.withoutInvoice.toLocaleString('es-AR')} movimientos sin número de factura informado.`
    );
    recommendations.push('Revisar los movimientos sin factura y completar el comprobante cuando corresponda para mejorar la trazabilidad documental.');
  }

  const negativeAccounts = summary.accounts
    .filter((item) => item.result < 0)
    .sort((a, b) => a.result - b.result)
    .slice(0, 3);

  if (negativeAccounts.length) {
    alerts.push(
      `Las cuentas con mayor resultado negativo son: ${negativeAccounts.map((item) => item.account).join(', ')}.`
    );
  }

  const now = new Date();
  const soon = summary.investments.filter((item) => {
    if (!item.maturityDate) return false;
    const due = new Date(`${item.maturityDate}T12:00:00Z`);
    const days = Math.ceil((due.getTime() - now.getTime()) / 86400000);
    return days >= 0 && days <= 30;
  });

  if (soon.length) {
    observations.push(
      `Hay ${soon.length} inversión(es) con vencimiento dentro de los próximos 30 días: ${soon.map((item) => item.name).join(', ')}.`
    );
    recommendations.push('Definir antes del vencimiento si los fondos se acreditarán a disponibilidad o se reinvertirán.');
  }

  if (!recommendations.length) {
    recommendations.push('Mantener una revisión mensual de ingresos, gastos y resultado para detectar desvíos antes del cierre anual.');
  }

  recommendations.push('Comparar los principales conceptos de gasto con el año anterior para identificar aumentos estructurales y gastos extraordinarios.');
  recommendations.push('Mantener conciliadas las cuentas y billeteras contra sus extractos, especialmente al cierre de cada mes.');

  if (!strengths.length) {
    strengths.push('El libro tiene información suficiente para construir indicadores por año, cuenta y concepto.');
  }

  if (!alerts.length) {
    alerts.push('No aparecen alertas estructurales fuertes en las métricas agregadas de este ejercicio.');
  }

  return {
    title: `Lectura automática del ejercicio ${summary.year}`,
    summary: totals.result >= 0
      ? `El ejercicio muestra ingresos por ARS ${totals.income.toLocaleString('es-AR', { maximumFractionDigits: 0 })}, gastos por ARS ${totals.expense.toLocaleString('es-AR', { maximumFractionDigits: 0 })} y un resultado positivo. El foco debería estar en la trazabilidad documental y en controlar la concentración de gastos.`
      : `El ejercicio muestra ingresos por ARS ${totals.income.toLocaleString('es-AR', { maximumFractionDigits: 0 })}, gastos por ARS ${totals.expense.toLocaleString('es-AR', { maximumFractionDigits: 0 })} y un resultado negativo. Conviene revisar las categorías y cuentas que explican el desvío.`,
    strengths: strengths.slice(0, 5),
    alerts: alerts.slice(0, 5),
    recommendations: recommendations.slice(0, 6),
    observations: observations.slice(0, 4),
  };
}

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts.map((part) => part?.text || '').join('').trim();
    if (text) return text;
  }
  return '';
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }

  const summary = sanitizeSummary(body?.summary);

  if (!summary.year || summary.totals.movements <= 0) {
    return Response.json(
      { error: 'No hay movimientos suficientes para analizar ese año.' },
      { status: 400 }
    );
  }

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const model = String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  if (!apiKey) {
    return Response.json({
      engine: 'local',
      model: 'reglas locales',
      analysis: localAnalysis(summary),
      note: 'GEMINI_API_KEY no configurada. Se utilizó el analizador local gratuito.',
    });
  }

  const prompt = `
Actuás como asistente de análisis de gestión para Proyecto Puente.
Analizá exclusivamente las métricas agregadas del ejercicio contable que recibís.
No inventes importes, facturas, vencimientos ni hechos que no estén en los datos.
No reemplazás a un contador, auditor ni asesor financiero.

Objetivos:
1. Explicar brevemente el estado general del ejercicio.
2. Identificar entre 2 y 5 fortalezas concretas.
3. Identificar entre 2 y 5 puntos a revisar.
4. Dar entre 3 y 6 recomendaciones prácticas y prudentes.
5. Señalar vencimientos o particularidades relevantes si aparecen.
6. Considerar ingresos, gastos, resultado, cuentas, conceptos, cobertura de facturas y vencimientos.
7. No recomendar inversiones financieras específicas ni decisiones tributarias.
8. Escribir en español de Argentina, claro y profesional.

Respondé solamente JSON válido con esta estructura:
{
  "title": "string",
  "summary": "string",
  "strengths": ["string"],
  "alerts": ["string"],
  "recommendations": ["string"],
  "observations": ["string"]
}

DATOS DEL EJERCICIO:
${JSON.stringify(summary)}
  `.trim();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 1800,
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      console.error('Gemini API error', response.status, payload);
      return Response.json({
        engine: 'local',
        model: 'reglas locales',
        analysis: localAnalysis(summary),
        note: 'Gemini no respondió correctamente. Se utilizó el analizador local.',
      });
    }

    const text = extractGeminiText(payload);
    if (!text) {
      throw new Error('EMPTY_GEMINI_RESPONSE');
    }

    const parsed = JSON.parse(text);

    return Response.json({
      engine: 'gemini',
      model,
      analysis: {
        title: sanitizeText(parsed?.title, 180),
        summary: sanitizeText(parsed?.summary, 1600),
        strengths: (parsed?.strengths || []).slice(0, 6).map((item) => sanitizeText(item, 500)),
        alerts: (parsed?.alerts || []).slice(0, 6).map((item) => sanitizeText(item, 500)),
        recommendations: (parsed?.recommendations || []).slice(0, 7).map((item) => sanitizeText(item, 500)),
        observations: (parsed?.observations || []).slice(0, 5).map((item) => sanitizeText(item, 500)),
      },
    });
  } catch (error) {
    console.error('AI analysis failed', error);

    return Response.json({
      engine: 'local',
      model: 'reglas locales',
      analysis: localAnalysis(summary),
      note: 'Se utilizó el analizador local por una falla temporal del proveedor de IA.',
    });
  }
}
