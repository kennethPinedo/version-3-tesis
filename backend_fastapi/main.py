from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
import os

from database import engine, Base
import alumnos.models  # noqa: F401 — registra todos los modelos ORM antes de create_all
from alumnos.routers import alumnos, encuestas, notas, predicciones, expedientes

# Migración: elimina tabla encuestas con esquema antiguo (A1-A10/B1-B10) para recrearla
with engine.connect() as _conn:
    try:
        _conn.execute(text("SELECT A1 FROM encuestas LIMIT 1"))
        _conn.execute(text("DROP TABLE encuestas"))
        _conn.commit()
    except Exception:
        pass  # Tabla ya tiene nuevo esquema o no existe todavía

Base.metadata.create_all(bind=engine)

# Migración: agrega columna genero si no existe en tablas creadas anteriormente
with engine.connect() as _conn:
    try:
        _conn.execute(text("ALTER TABLE alumnos ADD COLUMN genero VARCHAR(20) DEFAULT 'No especificado'"))
        _conn.commit()
    except Exception:
        pass  # La columna ya existe

app = FastAPI(title="Tesis API", version="1.0.0")

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
