import { auth } from '../../../../auth';
import {
  emergencyCodeCount,
  generateEmergencyCode,
  isAccessStorageConfigured,
  revokeEmergencyCodes,
} from '../../../../lib/access-store';

async function requireAdmin() {
  const session = await auth();

  if (!session?.user || session.user.role !== 'admin') {
    return null;
  }

  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: 'No autorizado.' }, { status: 403 });
  }

  return Response.json({
    storageConfigured: isAccessStorageConfigured(),
    activeCodes: await emergencyCodeCount(),
  });
}

export async function POST() {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: 'No autorizado.' }, { status: 403 });
  }

  try {
    const code = await generateEmergencyCode();

    return Response.json({
      ok: true,
      code,
      activeCodes: await emergencyCodeCount(),
    });
  } catch (error) {
    if (error?.message === 'STORAGE_NOT_CONFIGURED') {
      return Response.json(
        { error: 'La base privada de accesos todavía no está configurada.' },
        { status: 409 }
      );
    }

    return Response.json(
      { error: 'No se pudo generar el código.' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: 'No autorizado.' }, { status: 403 });
  }

  try {
    await revokeEmergencyCodes();
    return Response.json({ ok: true, activeCodes: 0 });
  } catch (error) {
    if (error?.message === 'STORAGE_NOT_CONFIGURED') {
      return Response.json(
        { error: 'La base privada de accesos todavía no está configurada.' },
        { status: 409 }
      );
    }

    return Response.json(
      { error: 'No se pudieron revocar los códigos.' },
      { status: 500 }
    );
  }
}
