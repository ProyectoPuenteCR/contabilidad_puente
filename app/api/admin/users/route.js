import { auth } from '../../../../auth';
import {
  addAllowedUser,
  isAccessStorageConfigured,
  listAllowedUsers,
  removeAllowedUser,
} from '../../../../lib/access-store';

async function requireAdmin() {
  const session = await auth();

  if (!session?.user || session.user.role !== 'admin') {
    return null;
  }

  return session;
}

function errorResponse(error) {
  const code = error?.message || 'UNKNOWN';

  const messages = {
    INVALID_EMAIL: 'El correo ingresado no es válido.',
    STORAGE_NOT_CONFIGURED:
      'La base privada de accesos todavía no está configurada.',
    PROTECTED_USER:
      'La cuenta administradora principal no se puede eliminar.',
    ENV_USER:
      'Esta cuenta está definida por configuración y no se puede eliminar desde la web.',
  };

  return Response.json(
    { error: messages[code] || 'No se pudo completar la operación.' },
    { status: code === 'INVALID_EMAIL' ? 400 : 409 }
  );
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: 'No autorizado.' }, { status: 403 });
  }

  return Response.json({
    users: await listAllowedUsers(),
    storageConfigured: isAccessStorageConfigured(),
  });
}

export async function POST(request) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: 'No autorizado.' }, { status: 403 });
  }

  try {
    const body = await request.json();

    const created = await addAllowedUser({
      email: body?.email,
      name: body?.name,
      addedBy: session.user.email,
    });

    return Response.json({ ok: true, user: created });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: 'No autorizado.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    await removeAllowedUser(body?.email);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
