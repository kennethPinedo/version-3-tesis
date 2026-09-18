# Despliegue en Render + Vercel + Neon

Es el despliegue que ya tienes funcionando y **no cuesta nada**. Sirve para el
día a día, para enseñar avances y como respaldo si algo se tuerce en AWS.

Los archivos de configuración **no están en esta carpeta**: cada plataforma los
busca en una ruta concreta y moverlos rompería el despliegue.

| Archivo | Dónde está | Quién lo lee |
|---|---|---|
| `render.yaml` | raíz del repositorio | Render |
| `vercel.json` | `frontend/` | Vercel |

---

## 1. Backend en Render

Render lee `render.yaml` y crea el servicio solo. Lo que define:

```yaml
rootDir: backend_fastapi
buildCommand: pip install --upgrade pip && pip install -r requirements.txt
startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
healthCheckPath: /
```

### Variables que hay que poner a mano

Están marcadas con `sync: false` porque **no deben subirse al repositorio**. Se
completan en el panel: servicio → **Environment**.

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La cadena de Neon, con `?sslmode=require` |
| `CORS_ORIGINS` | `https://TU-APP.vercel.app` |
| `DOCUMENTO_KEY` | La de tu `backend_fastapi/.env` |
| `DOCUMENTO_PEPPER` | La de tu `backend_fastapi/.env` |

> **`DOCUMENTO_KEY` y `DOCUMENTO_PEPPER` no están todavía en `render.yaml`.**
> Se añadieron al proyecto en septiembre de 2026, después de configurar Render.
> **Si no las defines, el servidor genera unas temporales al arrancar y los
> documentos de identidad que se guarden dejarán de poder leerse en el siguiente
> reinicio.** Es lo primero que deberías revisar en el panel.

### El plan gratuito se duerme

Render apaga el servicio tras 15 minutos sin tráfico. La primera petición
después tarda **30-50 segundos** en responder mientras arranca.

Para una demostración en vivo, abre la aplicación **cinco minutos antes** para
que el servidor ya esté despierto. Es la causa más habitual de que «la
aplicación no cargue» delante de un jurado.

---

## 2. Frontend en Vercel

`frontend/vercel.json` ya define todo lo necesario:

```json
{
  "framework": "vite",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

El `rewrites` es lo que hace que las rutas internas funcionen al recargar la
página en lugar de devolver un 404.

### Variable de compilación

En el proyecto de Vercel → **Settings → Environment Variables**:

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://TU-API.onrender.com` |

> **Sin `/api` al final.** El cliente lo añade por su cuenta
> (`frontend/src/lib/api.js`). Si lo pones, las peticiones irían a `/api/api`.

Vite congela las variables `VITE_*` **en el momento de compilar**. Si la cambias,
hay que volver a desplegar: no basta con guardarla.

---

## 3. Base de datos en Neon

Es donde viven hoy los datos reales: 35 alumnos, 291 notas, 28 encuestas y
49 predicciones (a 17 de septiembre de 2026).

Neon también suspende la base por inactividad en el plan gratuito. La primera
consulta la despierta, lo que suma un par de segundos a la primera carga.

---

## 4. Desplegar un cambio

Ambas plataformas despliegan solas al recibir un `push` en `main`:

```bash
git push version3 main
git push tsisver4 main
```

Render reconstruye el backend y Vercel el frontend, sin más intervención.

Para ver cómo va: panel de Render → **Logs**; panel de Vercel → **Deployments**.

---

## 5. Comprobar que sigue en pie

```bash
curl https://TU-API.onrender.com/
# {"status":"ok","message":"Tesis API corriendo con FastAPI"}
```

Si tarda 40 segundos, es que estaba dormido: no es un fallo.

---

## Qué revisar antes de una defensa

- [ ] `DOCUMENTO_KEY` y `DOCUMENTO_PEPPER` definidas en Render (ver aviso arriba)
- [ ] `CORS_ORIGINS` apunta al dominio real de Vercel
- [ ] Abrir la aplicación 5 minutos antes para despertar el servicio
- [ ] Entrar, ver el Dashboard General y generar una predicción
- [ ] Descargar un expediente (usa `window.open`, y algunos navegadores lo bloquean)
