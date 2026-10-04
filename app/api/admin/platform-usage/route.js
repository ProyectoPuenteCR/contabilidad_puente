import { auth } from '../../../../auth';
import {
  buildPlatformUsageSummary,
  isAccessStorageConfigured,
  setUsageCapacityMb,
} from '../../../../lib/access-store';

async function requireAdmin() {
  const session = await auth();

  if (!session?.user || session.user.role !== 'admin') {
    return null;
  }

  return session;
}

export async function GET(request) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: 'No autorizado.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  try {
    const summary = await buildPlatformUsageSummary({ from, to });
    return Response.json(summary);
  } catch (error) {
    return Response.json(
      {
        error: 'No se pudieron calcular las estadísticas de uso.',
        detail: error?.message || null,
        storageConfigured: isAccessStorageConfigured(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: 'No autorizado.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const capacityMb = await setUsageCapacityMb(body?.capacityMb);

    return Response.json({
      ok: true,
      capacityMb,
    });
  } catch (error) {
    const code = error?.message || 'UNKNOWN';

    if (code === 'STORAGE_NOT_CONFIGURED') {
      return Response.json(
        { error: 'La base privada todavía no está configurada.' },
        { status: 409 }
      );
    }

    if (code === 'INVALID_CAPACITY') {
      return Response.json(
        { error: 'La capacidad ingresada no es válida.' },
        { status: 400 }
      );
    }

    return Response.json(
      { error: 'No se pudo guardar la capacidad.' },
      { status: 500 }
    );
  }
}
