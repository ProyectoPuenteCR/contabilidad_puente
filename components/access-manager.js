'use client';

import { useEffect, useState } from 'react';

export default function AccessManager() {
  const [users, setUsers] = useState([]);
  const [storageConfigured, setStorageConfigured] =
    useState(false);
  const [activeCodes, setActiveCodes] = useState(0);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [usersResponse, emergencyResponse] =
      await Promise.all([
        fetch('/api/admin/users', { cache: 'no-store' }),
        fetch('/api/admin/emergency', {
          cache: 'no-store',
        }),
      ]);

    if (usersResponse.ok) {
      const data = await usersResponse.json();
      setUsers(data.users || []);
      setStorageConfigured(Boolean(data.storageConfigured));
    }

    if (emergencyResponse.ok) {
      const data = await emergencyResponse.json();
      setActiveCodes(Number(data.activeCodes || 0));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addUser(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || 'No se pudo agregar la cuenta.');
      setBusy(false);
      return;
    }

    setEmail('');
    setName('');
    setMessage('Cuenta Google autorizada correctamente.');
    await load();
    setBusy(false);
  }

  async function removeUser(userEmail) {
    if (
      !window.confirm(
        `¿Revocar el acceso de ${userEmail}?`
      )
    ) {
      return;
    }

    setBusy(true);
    setMessage('');

    const response = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail }),
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || 'No se pudo revocar el acceso.');
    } else {
      setMessage('Acceso revocado.');
      await load();
    }

    setBusy(false);
  }

  async function generateCode() {
    setBusy(true);
    setMessage('');
    setRecoveryCode('');

    const response = await fetch('/api/admin/emergency', {
      method: 'POST',
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(
        data.error || 'No se pudo generar el código.'
      );
      setBusy(false);
      return;
    }

    setRecoveryCode(data.code);
    setActiveCodes(Number(data.activeCodes || 0));
    setMessage(
      'Código creado. Guardalo ahora: no se volverá a mostrar.'
    );
    setBusy(false);
  }

  async function revokeCodes() {
    if (
      !window.confirm(
        '¿Revocar todos los códigos de emergencia activos?'
      )
    ) {
      return;
    }

    setBusy(true);

    const response = await fetch('/api/admin/emergency', {
      method: 'DELETE',
    });

    const data = await response.json();

    if (response.ok) {
      setActiveCodes(0);
      setRecoveryCode('');
      setMessage('Todos los códigos fueron revocados.');
    } else {
      setMessage(
        data.error || 'No se pudieron revocar los códigos.'
      );
    }

    setBusy(false);
  }

  async function copyCode() {
    if (!recoveryCode) return;
    await navigator.clipboard.writeText(recoveryCode);
    setMessage('Código copiado al portapapeles.');
  }

  return (
    <div className="access-grid">
      {!storageConfigured && (
        <div className="access-warning">
          <strong>
            Falta conectar la base privada de accesos
          </strong>
          <span>
            La cuenta administradora principal ya funciona, pero
            para agregar otros usuarios y crear códigos de un solo
            uso hay que vincular Upstash Redis al proyecto en
            Vercel.
          </span>
        </div>
      )}

      {message && (
        <div className="access-message">{message}</div>
      )}

      <section className="access-card">
        <div className="access-card-head">
          <div>
            <span className="eyebrow">
              Cuentas Google
            </span>
            <h2>Usuarios autorizados</h2>
            <p>
              Solo estos correos pueden completar el inicio de
              sesión con Google.
            </p>
          </div>
        </div>

        <form className="access-form" onSubmit={addUser}>
          <label>
            Nombre
            <input
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="Nombre o referencia"
            />
          </label>
          <label>
            Cuenta Google
            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="usuario@gmail.com"
              required
            />
          </label>
          <button
            className="primary"
            disabled={busy || !storageConfigured}
          >
            Autorizar cuenta
          </button>
        </form>

        <div className="access-user-list">
          {users.map((user) => (
            <div
              className="access-user-row"
              key={user.email}
            >
              <div className="access-user-main">
                <span className="access-user-icon">
                  {(user.name || user.email)
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <div>
                  <strong>
                    {user.name || user.email}
                  </strong>
                  <span>{user.email}</span>
                </div>
              </div>

              <div className="access-user-actions">
                <span
                  className={
                    user.role === 'admin'
                      ? 'role-badge admin'
                      : 'role-badge'
                  }
                >
                  {user.role === 'admin'
                    ? 'Administrador'
                    : 'Usuario'}
                </span>

                {user.removable && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() =>
                      removeUser(user.email)
                    }
                    disabled={busy}
                  >
                    Revocar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="access-card">
        <div className="access-card-head">
          <div>
            <span className="eyebrow">
              Recuperación
            </span>
            <h2>Códigos de emergencia</h2>
            <p>
              Permiten ingresar como administrador si Google no
              está disponible. Cada código generado aquí funciona
              una sola vez.
            </p>
          </div>
          <span className="code-count">
            {activeCodes} activos
          </span>
        </div>

        <div className="emergency-actions">
          <button
            className="primary"
            type="button"
            onClick={generateCode}
            disabled={busy || !storageConfigured}
          >
            Generar código
          </button>
          <button
            className="secondary"
            type="button"
            onClick={revokeCodes}
            disabled={
              busy ||
              !storageConfigured ||
              activeCodes === 0
            }
          >
            Revocar todos
          </button>
        </div>

        {recoveryCode && (
          <div className="recovery-code">
            <span>
              Guardá este código en un lugar seguro
            </span>
            <strong>{recoveryCode}</strong>
            <button
              type="button"
              className="secondary"
              onClick={copyCode}
            >
              Copiar
            </button>
          </div>
        )}

        <div className="security-list">
          <div>
            <strong>Google primero</strong>
            <span>
              El acceso normal usa la identidad y controles de
              seguridad de Google.
            </span>
          </div>
          <div>
            <strong>Sin contraseñas locales</strong>
            <span>
              La aplicación nunca conoce ni almacena la contraseña
              de Google.
            </span>
          </div>
          <div>
            <strong>Recuperación controlada</strong>
            <span>
              Los códigos se guardan como hash y se invalidan al
              usarlos.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
