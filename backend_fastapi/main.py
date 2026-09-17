from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
import os

from database import engine, Base
import alumnos.models  # noqa: F401 — registra todos los modelos ORM antes de create_all
from alumnos.routers import alumnos, encuestas, notas, predicciones, expedientes, auth

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

# Columnas del documento de identidad y del nivel educativo.
for _col, _ddl in [
    ("nivel", "ALTER TABLE alumnos ADD COLUMN nivel VARCHAR(20) DEFAULT 'Secundaria'"),
    ("tipo_documento", "ALTER TABLE alumnos ADD COLUMN tipo_documento VARCHAR(20)"),
    ("documento_cifrado", "ALTER TABLE alumnos ADD COLUMN documento_cifrado VARCHAR(255)"),
    ("documento_huella", "ALTER TABLE alumnos ADD COLUMN documento_huella VARCHAR(64)"),
]:
    if "alumnos" in _tablas and _col not in _columnas("alumnos"):
        with engine.connect() as _conn:
            _conn.execute(text(_ddl))
            _conn.commit()
        _insp = inspect(engine)
        print(f"[migracion] alumnos.{_col} creada.")

# El índice único sobre la huella se crea aparte: si ya existe, no pasa nada.
if "alumnos" in _tablas and "documento_huella" in _columnas("alumnos"):
    with engine.connect() as _conn:
        try:
            _conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_alumnos_documento_huella "
                "ON alumnos (documento_huella)"))
            _conn.commit()
        except Exception:
            pass

# Normaliza los grados heredados: convivían "2° de Secundaria" con "2°" suelto,
# y el filtro los trataba como valores distintos porque lo eran.
if "alumnos" in _tablas and "nivel" in _columnas("alumnos"):
    with engine.connect() as _conn:
        try:
            _conn.execute(text("""
                UPDATE alumnos
                   SET nivel = CASE
                         WHEN grado ILIKE '%primaria%' THEN 'Primaria'
                         ELSE 'Secundaria'
                       END
                 WHERE nivel IS NULL OR nivel = ''
            """))
            # Los grados sin nivel explícito ("2°") pasan a la forma completa.
            _conn.execute(text("""
                UPDATE alumnos
                   SET grado = TRIM(grado) || ' de ' || nivel
                 WHERE grado NOT ILIKE '%primaria%' AND grado NOT ILIKE '%secundaria%'
            """))
            _conn.commit()
            print("[migracion] grados normalizados a la forma «N° de Nivel».")
        except Exception as _e:
            print(f"[migracion] grados: {_e}")

# Siembra las cuentas institucionales la primera vez. Conserva las
# credenciales que ya usaba el equipo, pero marcadas para cambio obligatorio.
from database import SessionLocal
from alumnos.services import auth_service as _auth
with SessionLocal() as _db:
    _creadas = _auth.sembrar_usuarios_iniciales(_db)
    if _creadas:
        print(f"[auth] {_creadas} cuenta(s) creada(s) con cambio de contraseña obligatorio.")

app = FastAPI(title="Tesis API", version="3.0.0")

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

# El router de autenticación es público: sin él nadie podría iniciar sesión.
app.include_router(auth.router, prefix="/api")

# Todo lo demás exige una sesión válida. Son datos clínicos y académicos de
# menores: no pueden quedar accesibles llamando a la API sin credenciales.
from fastapi import Depends
from alumnos.routers.auth import sesion_requerida

_protegido = [Depends(sesion_requerida)]
app.include_router(alumnos.router, prefix="/api", dependencies=_protegido)
app.include_router(encuestas.router, prefix="/api", dependencies=_protegido)
app.include_router(notas.router, prefix="/api", dependencies=_protegido)
app.include_router(predicciones.router, prefix="/api", dependencies=_protegido)
app.include_router(expedientes.router, prefix="/api", dependencies=_protegido)


@app.get("/")
def root():
    return {"status": "ok", "message": "Tesis API corriendo con FastAPI"}
