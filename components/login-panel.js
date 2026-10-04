'use client';

import Image from 'next/image';
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
    <main className="pp-login-shell">
      <section className="pp-login-story">
        <div className="pp-login-logo-card">
          <Image
            src="/logo-proyecto-puente.webp"
            alt="Proyecto Puente"
            width={420}
            height={273}
            className="pp-login-logo"
            priority
          />
        </div>

        <div className="pp-login-story-copy">
          <span className="pp-login-eyebrow">
            CONTABILIDAD · PROYECTO PUENTE
          </span>

          <h1>
            Cada movimiento,
            <span> una decisión mejor.</span>
          </h1>

          <p>
            Centralizamos movimientos, saldos, gastos y horas para que
            la gestión financiera del proyecto sea clara, segura y
            trazable.
          </p>

          <div className="pp-login-feature-list">
            <div><span>▤</span> Libro de contabilidad centralizado</div>
            <div><span>◈</span> Saldos e indicadores financieros</div>
            <div><span>▣</span> Gastos por año y concepto</div>
            <div><span>◷</span> Registro de horas del equipo</div>
          </div>
        </div>

        <div className="pp-login-story-footer">
          <strong>PROYECTO PUENTE</strong>
          <span>Conectamos personas con oportunidades.</span>
        </div>

        <div className="pp-login-rings pp-login-ring-1" />
        <div className="pp-login-rings pp-login-ring-2" />
        <div className="pp-login-rings pp-login-ring-3" />
      </section>

      <section className="pp-login-access">
        <div className="pp-login-mobile-logo">
          <Image
            src="/logo-proyecto-puente.webp"
            alt="Proyecto Puente"
            width={420}
            height={273}
            priority
          />
        </div>

        <div className="pp-login-access-card">
          <div className="pp-login-security-icon" aria-hidden="true">
            <span>✓</span>
          </div>

          <span className="pp-login-welcome">BIENVENIDO AL EQUIPO</span>

          <h2>
            Tu trabajo hace
            <br />
            la diferencia<span>.</span>
          </h2>

          <p className="pp-login-access-copy">
            Ingresá para administrar la contabilidad de Proyecto Puente.
          </p>

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
            className="pp-google-button"
            onClick={googleLogin}
            disabled={loading || !authConfigured}
          >
            <span className="pp-google-g">G</span>
            <span>
              {loading && !showEmergency
                ? 'Conectando con Google…'
                : 'Continuar con Google'}
            </span>
            <span className="pp-google-arrow">→</span>
          </button>

          <div className="pp-authorized-note">
            <span>✓</span>
            Solo cuentas autorizadas de Proyecto Puente.
          </div>

          <button
            type="button"
            className="pp-emergency-trigger"
            onClick={() => {
              setError('');
              setShowEmergency((value) => !value);
            }}
          >
            {showEmergency
              ? 'Ocultar acceso de emergencia'
              : 'Usar código de emergencia'}
            <span>→</span>
          </button>

          {showEmergency && (
            <form
              className="pp-emergency-form"
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

              <small>
                Uso reservado para recuperación administrativa.
                Los códigos generados desde el sistema son de un solo uso.
              </small>
            </form>
          )}

          <div className="pp-login-access-footer">
            <span>Acceso protegido con Google OAuth</span>
            <b>Contabilidad Puente</b>
          </div>
        </div>
      </section>
    </main>
  );
}
