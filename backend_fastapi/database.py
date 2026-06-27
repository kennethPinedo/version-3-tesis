import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Carga las variables de un archivo .env local (si existe) antes de leerlas.
# En producción (Render, etc.) las variables se definen en el panel del proveedor.
load_dotenv()

# La URL de la base de datos se lee del entorno (variable DATABASE_URL).
#  - En PRODUCCIÓN: se define DATABASE_URL con la cadena de PostgreSQL
#    (ej. postgresql://usuario:clave@host:5432/basedatos) → los datos PERSISTEN.
#  - En DESARROLLO local: si no se define, usa SQLite (no requiere instalar nada).
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tesis.db")

# Algunos proveedores (Render, Heroku) entregan la URL como "postgres://",
# pero SQLAlchemy requiere el prefijo "postgresql://".
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# connect_args con check_same_thread SOLO aplica a SQLite. Para PostgreSQL se usa
# pool_pre_ping, que reabre conexiones caídas (importante en la nube).
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
