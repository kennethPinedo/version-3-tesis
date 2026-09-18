# Despliegue: dos destinos, un solo código

El sistema se despliega hoy en dos sitios distintos. **No hay dos versiones del
código**: es el mismo backend y el mismo frontend, y lo único que cambia son las
variables de entorno.

| | Render + Vercel | AWS |
|---|---|---|
| Backend | Render (`render.yaml` en la raíz) | EC2 + Docker |
| Frontend | Vercel (`frontend/vercel.json`) | S3 + CloudFront |
| Base de datos | Neon | RDS PostgreSQL |
| Coste | 0 USD | ≈ 32 USD/mes |
| Para qué sirve | El día a día y las demostraciones | La defensa: es la arquitectura de la tesis |
| Instrucciones | [`render-vercel/`](render-vercel/) | [`aws/`](aws/) |

## Por qué no hay dos copias del código

Sería lo intuitivo, y es una trampa. Cada corrección habría que aplicarla dos
veces, y en cuanto se olvidara una, las dos ramas empezarían a divergir. Las
cinco correcciones de validación de septiembre de 2026 —áreas curriculares,
expedientes, tamaño de archivo— habrían tenido que escribirse por duplicado.

El backend lee su configuración del entorno:

```python
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tesis.db")
_extra       = os.getenv("CORS_ORIGINS", "")
```

Y el frontend recibe la URL de la API al compilar:

```js
(import.meta.env.VITE_API_URL || "http://127.0.0.1:8000") + "/api"
```

Así que «dos versiones» son **dos juegos de variables**, no dos códigos.

## Las variables, una al lado de la otra

| Variable | Render + Vercel | AWS |
|---|---|---|
| `DATABASE_URL` | cadena de Neon | cadena de RDS |
| `CORS_ORIGINS` | `https://TU-APP.vercel.app` | `https://XXXX.cloudfront.net` |
| `DOCUMENTO_KEY` | **la misma en ambos** | **la misma en ambos** |
| `DOCUMENTO_PEPPER` | **la misma en ambos** | **la misma en ambos** |
| `VITE_API_URL` (al compilar) | `https://tesis-api.onrender.com` | `http://IP-DEL-SERVIDOR` |

> **`DOCUMENTO_KEY` y `DOCUMENTO_PEPPER` tienen que ser idénticas en los dos
> despliegues si comparten datos.** Son las claves con las que se cifran los
> documentos de identidad: con claves distintas, los números guardados en un
> sitio no se pueden descifrar en el otro. Nunca las generes de nuevo «para el
> despliegue nuevo».

## Trabajar con los dos a la vez

No se estorban: son infraestructuras independientes con bases distintas. Lo
único que hay que vigilar es **contra qué base apunta cada uno**, para no creer
que estás viendo los mismos datos.

Si migras a RDS y quieres conservar Render funcionando, deja Render apuntando a
Neon. Serán dos copias de los datos que se separarán desde ese momento: decide
cuál es la buena y no registres alumnos en las dos.
