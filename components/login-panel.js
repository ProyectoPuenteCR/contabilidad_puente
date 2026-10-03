'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

const errorText = {
  AccessDenied:
    'Esta cuenta de Google no está autorizada para ingresar.',
  OAuthSignin:
    'No se pudo iniciar el acceso con Google. Revise la configuración OAuth.',
  OAuthCallback:
    'Google no pudo completar la autenticación.',
  CredentialsSignin:
    'El código de emergencia no es válido o ya fue utilizado.',
};

export default function LoginPanel({
  initialError,
  authConfigured,
}) {
  const [showEmergency, setShowEmergency] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(
    errorText[initialError] || ''
  );
  const [loading, setLoading] = useState(false);

  async function googleLogin() {
    setError('');
    setLoading(true);

    try {
      await signIn('google', { redirectTo: '/' });
    } catch {
      setError('No se pudo abrir el acceso de Google.');
      setLoading(false);
    }
  }

  async function emergencyLogin(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn('emergency', {
        code,
        redirect: false,
        redirectTo: '/',
      });

      if (!result?.ok) {
        setError(
          'El código de emergencia no es válido, fue utilizado o está bloqueado temporalmente.'
        );
        setLoading(false);
        return;
      }

      window.location.assign(result.url || '/');
    } catch {
      setError('No se pudo validar el código de emergencia.');
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">P</div>
          <div>
            <strong>Proyecto Puente</strong>
            <span>Contabilidad</span>
          </div>
        </div>

        <div className="login-copy">
          <span className="login-kicker">Acceso seguro</span>
          <h1>Ingresar al sistema</h1>
          <p>
            Utilizá una cuenta de Google autorizada. La contraseña
            permanece siempre en Google y no es almacenada por
            Proyecto Puente.
          </p>
        </div>

        {!authConfigured && (
          <div className="setup-warning">
            <strong>Autenticación pendiente de configuración</strong>
            <span>
              Falta cargar AUTH_SECRET, AUTH_GOOGLE_ID y
              AUTH_GOOGLE_SECRET en Vercel.
            </span>
          </div>
        )}

        {error && <div className="login-error">{error}</div>}

        <button
          type="button"
          className="google-button"
          onClick={googleLogin}
          disabled={loading || !authConfigured}
        >
          <span className="google-g">G</span>
          Continuar con Google
        </button>

        <div className="login-divider">
          <span>acceso alternativo</span>
        </div>

        {!showEmergency ? (
          <button
            type="button"
            className="emergency-link"
            onClick={() => setShowEmergency(true)}
          >
            Usar código de emergencia
          </button>
        ) : (
          <form
            className="emergency-form"
            onSubmit={emergencyLogin}
          >
            <label>
              Código de emergencia
              <input
                type="password"
                autoComplete="one-time-code"
                placeholder="PP-XXXX-XXXX-..."
                value={code}
                onChange={(event) =>
                  setCode(event.target.value)
                }
                required
              />
            </label>

            <button
              className="primary"
              disabled={loading || !code.trim()}
            >
              {loading ? 'Validando…' : 'Ingresar con código'}
            </button>

            <button
              type="button"
              className="text-button"
              onClick={() => {
                setShowEmergency(false);
                setCode('');
              }}
            >
              Volver
            </button>
          </form>
        )}

        <p className="login-security-note">
          El código de emergencia está reservado para recuperación
          administrativa y los códigos generados desde el sistema son
          de un solo uso.
        </p>
      </section>
    </main>
  );
}
