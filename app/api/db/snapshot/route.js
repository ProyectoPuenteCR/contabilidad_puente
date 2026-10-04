import { auth } from '../../../../auth';
import {
  getCloudStatus,
  readCloudSnapshot,
  writeCloudSnapshot,
} from '../../../../lib/cloud-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const status = await getCloudStatus();

    if (!status.active) {
      return Response.json({
        active: false,
        revision: status.revision,
        status,
      });
    }

    const snapshot = await readCloudSnapshot();
    return Response.json({
      ...snapshot,
      status,
    });
  } catch (error) {
    console.error('Cloud snapshot read error', error);
    return Response.json(
      {
        error: 'No se pudo leer la base contable en la nube.',
        code: error?.message || 'DATABASE_READ_ERROR',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const currentStatus = await getCloudStatus();

    if (!currentStatus.active) {
      return Response.json(
        { error: 'La base todavía no fue activada como fuente principal.' },
        { status: 409 }
      );
    }

    const body = await request.json();
    const baseRevision = Number(body?.baseRevision);

    if (!Number.isFinite(baseRevision)) {
      return Response.json(
        { error: 'Falta la revisión base de la sincronización.' },
        { status: 400 }
      );
    }

    const result = await writeCloudSnapshot({
      snapshot: body?.snapshot || {},
      actor: session.user.email || session.user.name || 'usuario',
      baseRevision,
      activate: false,
    });

    return Response.json({
      ok: true,
      revision: result.revision,
      summary: result.summary,
    });
  } catch (error) {
    if (error?.code === 'REVISION_CONFLICT' || error?.message === 'REVISION_CONFLICT') {
      const status = await getCloudStatus().catch(() => null);
      return Response.json(
        {
          error: 'La base cambió desde otro navegador. Recargá los datos de la nube antes de guardar.',
          code: 'REVISION_CONFLICT',
          revision: status?.revision ?? null,
        },
        { status: 409 }
      );
    }

    console.error('Cloud snapshot write error', error);
    return Response.json(
      {
        error: 'No se pudieron sincronizar los datos contables con PostgreSQL.',
        code: error?.message || 'DATABASE_WRITE_ERROR',
      },
      { status: 500 }
    );
  }
}
