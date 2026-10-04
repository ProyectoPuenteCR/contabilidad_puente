import { auth } from '../../../../auth';
import {
  activateCloudDatabase,
  getCloudStatus,
  summarizeMovements,
  writeCloudSnapshot,
} from '../../../../lib/cloud-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function almostEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.01;
}

export async function POST(request) {
  const session = await auth();

  if (!session?.user || session.user.role !== 'admin') {
    return Response.json({ error: 'Solo un administrador puede iniciar la migración.' }, { status: 403 });
  }

  try {
    const statusBefore = await getCloudStatus();

    if (!statusBefore.connected) {
      return Response.json(
        { error: 'PostgreSQL no está disponible.' },
        { status: 409 }
      );
    }

    if (statusBefore.active || statusBefore.ledger.count > 0) {
      return Response.json(
        {
          error: 'La base PostgreSQL ya contiene información. No se realizará una migración inicial encima de datos existentes.',
          code: 'DATABASE_NOT_EMPTY',
          status: statusBefore,
        },
        { status: 409 }
      );
    }

    const body = await request.json();
    const snapshot = body?.snapshot || {};
    const localSummary = summarizeMovements(snapshot.movements);

    if (!localSummary.count) {
      return Response.json(
        { error: 'No hay movimientos locales para migrar.' },
        { status: 400 }
      );
    }

    const written = await writeCloudSnapshot({
      snapshot,
      actor: session.user.email || session.user.name || 'admin',
      baseRevision: statusBefore.revision,
      activate: false,
    });

    const statusAfterWrite = await getCloudStatus();

    const verification = {
      count: statusAfterWrite.ledger.count === localSummary.count,
      income: almostEqual(statusAfterWrite.ledger.income, localSummary.income),
      expense: almostEqual(statusAfterWrite.ledger.expense, localSummary.expense),
      result: almostEqual(
        statusAfterWrite.ledger.result,
        localSummary.income - localSummary.expense
      ),
    };

    const verified = Object.values(verification).every(Boolean);

    if (!verified) {
      return Response.json(
        {
          error: 'La copia llegó a PostgreSQL, pero la validación de totales no coincide. La base NO fue activada.',
          code: 'VERIFICATION_FAILED',
          verified: false,
          verification,
          local: {
            ...localSummary,
            result: localSummary.income - localSummary.expense,
          },
          cloud: statusAfterWrite.ledger,
          revision: written.revision,
        },
        { status: 409 }
      );
    }

    const activation = await activateCloudDatabase({
      baseRevision: written.revision,
      actor: session.user.email || session.user.name || 'admin',
    });

    const finalStatus = await getCloudStatus();

    return Response.json({
      ok: true,
      verified: true,
      verification,
      local: {
        ...localSummary,
        result: localSummary.income - localSummary.expense,
      },
      cloud: finalStatus.ledger,
      revision: activation.revision,
      status: finalStatus,
    });
  } catch (error) {
    console.error('Cloud migration error', error);

    if (error?.code === 'REVISION_CONFLICT' || error?.message === 'REVISION_CONFLICT') {
      return Response.json(
        {
          error: 'La base cambió durante la migración. Recargá el estado e intentá nuevamente.',
          code: 'REVISION_CONFLICT',
        },
        { status: 409 }
      );
    }

    return Response.json(
      {
        error: 'No se pudo completar la migración a PostgreSQL.',
        code: error?.message || 'MIGRATION_ERROR',
      },
      { status: 500 }
    );
  }
}
