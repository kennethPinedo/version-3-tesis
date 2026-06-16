"""
Migración de base de datos: agrega las columnas nuevas sin borrar datos existentes.
Ejecutar UNA sola vez: python migrar_db.py
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "tesis.db")

def columna_existe(cursor, tabla, columna):
    cursor.execute(f"PRAGMA table_info({tabla})")
    return any(row[1] == columna for row in cursor.fetchall())

conn = sqlite3.connect(DB_PATH)
cur  = conn.cursor()

migraciones = [
    ("encuestas", "inasistencias", "INTEGER NOT NULL DEFAULT 0"),
    ("notas",     "bimestre",      "INTEGER NOT NULL DEFAULT 1"),
]

for tabla, columna, definicion in migraciones:
    if not columna_existe(cur, tabla, columna):
        cur.execute(f"ALTER TABLE {tabla} ADD COLUMN {columna} {definicion}")
        print(f"OK Columna '{columna}' agregada a '{tabla}'")
    else:
        print(f"- Columna '{columna}' ya existe en '{tabla}' (sin cambios)")

conn.commit()
conn.close()
print("\nMigración completada.")
