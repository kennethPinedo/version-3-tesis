from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
import os

from database import engine, Base
import alumnos.models  # noqa: F401 — registra todos los modelos ORM antes de create_all
from alumnos.routers import alumnos, encuestas, notas, predicciones, expedientes

# Migración: elimina tabla encuestas con esquema antiguo (A1-A10/B1-B10) para recrearla.
# En PostgreSQL una sentencia fallida aborta la transacción, así que se comprueba el
# esquema con el inspector en vez de provocar el error a propósito.
_insp = inspect(engine)
_tablas = set(_insp.get_table_names())


def _columnas(tabla: str) -> set:
    if tabla not in _tablas:
        return set()
    return {c["name"] for c in _insp.get_columns(tabla)}


if "A1" in _columnas("encuestas"):
    with engine.connect() as _conn:
        _conn.execute(text("DROP TABLE encuestas"))
        _conn.commit()
    _insp = inspect(engine)
    _tablas = set(_insp.get_table_names())

Base.metadata.create_all(bind=engine)

# ── Migraciones de columnas sobre tablas ya existentes ───────────────────────
# create_all() crea tablas nuevas, pero NO agrega columnas a las que ya existen.
# Cada ALTER va en su propia transacción para que un fallo no arrastre al resto
# (en PostgreSQL una sentencia fallida invalida toda la transacción abierta).
_cols_alumnos = _columnas("alumnos")

if "alumnos" in _tablas and "genero" not in _cols_alumnos:
    with engine.connect() as _conn:
        _conn.execute(text(
            "ALTER TABLE alumnos ADD COLUMN genero VARCHAR(30) DEFAULT 'No especificado'"
        ))
        _conn.commit()

# Las inasistencias pasan de la encuesta EDAH al alumno (módulo independiente
# "Control de Inasistencias"). Al crear la columna se rellena con el último valor
# registrado en la encuesta del alumno para no perder los datos históricos.
if "alumnos" in _tablas and "inasistencias" not in _cols_alumnos:
    with engine.connect() as _conn:
        _conn.execute(text(
            "ALTER TABLE alumnos ADD COLUMN inasistencias INTEGER NOT NULL DEFAULT 0"
        ))
        _conn.commit()

    if "inasistencias" in _columnas("encuestas"):
        with engine.connect() as _conn:
            _conn.execute(text("""
                UPDATE alumnos SET inasistencias = COALESCE((
                    SELECT e.inasistencias FROM encuestas e
                    WHERE e.alumno_id = alumnos.id
                    ORDER BY e.fecha_aplicacion DESC, e.id DESC LIMIT 1
                ), 0)
            """))
            _conn.commit()
        print("[migración] alumnos.inasistencias creada y rellenada desde encuestas.")
    else:
        print("[migración] alumnos.inasistencias creada.")

app = FastAPI(title="Tesis API", version="2.0.0")

# CORS: en desarrollo se permite localhost. En producción se agregan los dominios
# del frontend desplegado mediante la variable de entorno CORS_ORIGINS
# (separados por coma), por ejemplo: "https://mi-tesis.vercel.app".
_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
_extra = os.getenv("CORS_ORIGINS", "")
if _extra:
    _origins += [o.strip() for o in _extra.split(",") if o.strip()]

# allow_origin_regex acepta cualquier subdominio de Vercel (producción y previews,
# cuya URL cambia en cada despliegue). Se puede afinar con la variable CORS_ORIGIN_REGEX.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app"),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_MEDIA_DIR = os.path.join(os.path.dirname(__file__), "media")
os.makedirs(_MEDIA_DIR, exist_ok=True)
app.mount("/media", StaticFiles(directory=_MEDIA_DIR), name="media")

app.include_router(alumnos.router, prefix="/api")
app.include_router(encuestas.router, prefix="/api")
app.include_router(notas.router, prefix="/api")
app.include_router(predicciones.router, prefix="/api")
app.include_router(expedientes.router, prefix="/api")


@app.get("/")
def root():
    return {"status": "ok", "message": "Tesis API corriendo con FastAPI"}
