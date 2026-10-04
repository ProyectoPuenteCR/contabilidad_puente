import { auth } from '../../../auth';
import { logUsageEvent } from '../../../lib/access-store';

export async function POST(request) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const module = String(body?.module || 'app').trim().slice(0, 80) || 'app';

    await logUsageEvent({
      email: session.user.email,
      type: 'module',
      module,
      success: true,
      details: {
        role: session.user.role || 'user',
      },
    });

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
}
