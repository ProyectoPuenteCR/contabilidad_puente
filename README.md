# Contabilidad Puente

Aplicación web de contabilidad de Proyecto Puente, desplegada en Vercel.

## Seguridad implementada

El sistema soporta:

- Inicio de sesión con Google OAuth.
- Cuenta administradora principal:
  `brechasdigitales@proyecto-puente.org`.
- Lista privada de cuentas Google autorizadas.
- Administración de accesos desde `/admin/accesos`.
- Códigos de emergencia de un solo uso.
- Código maestro de emergencia opcional mediante variable de entorno.
- Sesiones JWT con duración máxima de 12 horas.
- Validación de correo verificado por Google.
- Límite de intentos del acceso de emergencia cuando Redis está disponible.

La contraseña de Google nunca pasa por la aplicación.

## 1. Configurar OAuth de Google

En Google Cloud Console:

1. Crear o seleccionar un proyecto.
2. Configurar la pantalla de consentimiento OAuth.
3. Crear una credencial **OAuth Client ID** de tipo **Web application**.
4. Agregar como URI de redirección autorizada:

```
https://TU-DOMINIO/api/auth/callback/google
```

Para desarrollo local:

```
http://localhost:3000/api/auth/callback/google
```

Copiar el Client ID y Client Secret.

## 2. Variables de entorno en Vercel

En el proyecto de Vercel, agregar para Production:

```
AUTH_SECRET=<secreto-largo-aleatorio>
AUTH_GOOGLE_ID=<google-client-id>
AUTH_GOOGLE_SECRET=<google-client-secret>
AUTH_ADMIN_EMAIL=brechasdigitales@proyecto-puente.org
```

Para generar `AUTH_SECRET` puede utilizarse:

```bash
npx auth secret
```

No guardar secretos reales dentro del repositorio.

Mientras estas tres variables no estén configuradas, la aplicación queda en **Modo de instalación** para evitar un bloqueo accidental. Al configurarlas y desplegar nuevamente, el acceso queda protegido automáticamente.

## 3. Usuarios Google adicionales

Para administrar cuentas desde la web se utiliza Upstash Redis.

En Vercel:

1. Abrir el proyecto.
2. Ir a **Storage / Marketplace**.
3. Crear o conectar **Upstash for Redis**.
4. Vincularlo a `contabilidad_puente`.
5. Confirmar que Vercel agregó las variables de Redis.
6. Volver a desplegar.

Una vez conectado, ingresar con la cuenta administradora y abrir:

```
/admin/accesos
```

Desde esa pantalla se pueden autorizar o revocar cuentas Google.

También existe la variable opcional:

```
AUTH_ALLOWED_EMAILS=usuario1@gmail.com,usuario2@proyecto-puente.org
```

Las cuentas definidas ahí son fijas y no se pueden eliminar desde la interfaz.

## 4. Código de emergencia

Desde **Seguridad y accesos** el administrador puede generar códigos de recuperación.

Características:

- se muestran una sola vez;
- se almacenan únicamente como SHA-256;
- son de un solo uso;
- al utilizarlos se inicia una sesión como administrador;
- se pueden revocar todos desde la pantalla de seguridad.

### Código maestro opcional

Puede configurarse un código maestro independiente de Redis mediante:

```
AUTH_EMERGENCY_CODE_HASH=<sha256>
```

El valor debe ser el SHA-256 hexadecimal del código convertido a mayúsculas y sin espacios laterales.

Ejemplo para calcular el hash localmente:

```bash
node -e "const crypto=require('crypto'); const code='TU-CODIGO-SEGURO'.trim().toUpperCase(); console.log(crypto.createHash('sha256').update(code).digest('hex'))"
```

Solo se guarda el hash en Vercel; no el código original.

## Variables

Ver `.env.example` para la lista completa de variables soportadas.
