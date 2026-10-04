import { auth } from '../../../../auth';
import {
  getCloudStatus,
  isCloudDatabaseConfigured,
} from '../../../../lib/cloud-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  if (!isCloudDatabaseConfigured()) {
    return Response.json({
      configured: false,
      connected: false,
      active: false,
      revision: 0,
      message: 'DATABASE_URL no está configurada en este deployment.',
    });
  }

  try {
    const status = await getCloudStatus();
    return Response.json(status);
  } catch (error) {
    console.error('Cloud database status error', error);
    return Response.json(
      {
        configured: true,
        connected: false,
        active: false,
        error: 'No se pudo conectar con PostgreSQL.',
        code: error?.message || 'DATABASE_CONNECTION_ERROR',
      },
      { status: 500 }
    );
  }
}
