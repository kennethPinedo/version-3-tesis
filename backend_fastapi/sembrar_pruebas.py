"""Llena una base de datos VACIA con estudiantes ficticios, para pruebas.

Por que existe
--------------
Los 39 estudiantes reales de la tesis son menores identificables: nombre,
documento, contacto y evaluacion clinica. Esos registros no pueden viajar en un
repositorio, asi que no hay forma de clonar el proyecto en otra maquina y tener
datos con los que probar.

Este script los sustituye. Toma el dataset sintetico que ya vive en el
repositorio (dataset_tdah_bimestral_500.csv, 500 registros generados, sin
ninguna persona real detras) y construye estudiantes completos a partir de el:
encuesta EDAH, notas de los cuatro bimestres, inasistencias con fecha y
prediccion. El resultado se comporta como la base real —los mismos rangos, las
mismas distribuciones— pero no describe a nadie.

Como se usa
-----------
    cd backend_fastapi
    python sembrar_pruebas.py                 # 40 estudiantes en la BD del .env
    python sembrar_pruebas.py --cantidad 15
    python sembrar_pruebas.py --limpiar       # retira SOLO lo que sembro

Es reproducible: con la misma semilla salen exactamente los mismos estudiantes,
de modo que un caso de prueba que falla en una maquina falla igual en otra.

Proteccion
----------
Se niega a escribir si la base ya tiene estudiantes, y se niega dos veces si el
host parece ser Neon o RDS. Un seed disparado por error contra la base real
mezclaria alumnos inventados con los de la tesis, y distinguirlos despues
obligaria a revisarlos uno por uno.
"""
from __future__ import annotations

import argparse
import csv
import os
import random
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402

from database import SessionLocal, engine  # noqa: E402
from alumnos.models import Alumno, Asistencia, Encuesta, Nota  # noqa: E402
from alumnos.services import cripto_service as cripto  # noqa: E402
from alumnos.services import generar_prediccion_alumno  # noqa: E402

DATASET = Path(__file__).resolve().parent.parent / "dataset_tdah_bimestral_500.csv"

# Marca de agua: todo lo que siembra este script lleva este contacto, y --limpiar
# lo usa para retirar exactamente lo suyo sin tocar nada mas.
MARCA = "Apoderado de prueba 900000000"

# DNI ficticios. El 99 inicial no se emite en Peru, asi que ninguno de estos
# numeros puede coincidir con el documento real de una persona.
DNI_BASE = 99000000

SEMILLA = 20260929

NOMBRES = [
    "Ana", "Luis", "Rosa", "Carlos", "Maria", "Jorge", "Elena", "Miguel",
    "Sofia", "Diego", "Carmen", "Andres", "Lucia", "Pedro", "Julia", "Raul",
    "Paula", "Victor", "Nora", "Hugo",
]
APELLIDOS = [
    "Quispe", "Rojas", "Mendoza", "Huaman", "Vargas", "Castro", "Flores",
    "Ramos", "Chavez", "Salazar", "Ccahuana", "Pariona", "Cordova", "Lujan",
    "Ticona", "Zarate", "Ayala", "Bustamante", "Nolasco", "Yupanqui",
]
GENEROS = ["Masculino", "Femenino", "No especificado"]

# Areas nucleares. Se usan tres de las once del plan para que el promedio se
# calcule sin generar 44 notas por estudiante.
AREAS = ["Matematica", "Comunicacion", "Ciencia y Tecnologia"]

# El dataset ordena los items como HI(5) + DA(5) + TC(10). Es el mismo orden que
# usa prediccion_service al armar el vector, y cambiarlo aqui desplazaria las
# subescalas sin que ningun error lo delatase.
def _mapear_items(fila: dict) -> dict:
    items = [int(fila[f"Item_{i:02d}"]) for i in range(1, 21)]
    campos = {}
    for i in range(5):
        campos[f"HI{i + 1}"] = items[i]
        campos[f"DA{i + 1}"] = items[5 + i]
    for i in range(10):
        campos[f"TC{i + 1}"] = items[10 + i]
    return campos


def _dias_lectivos(cuantos: int, hasta: date, azar: random.Random) -> list[date]:
    """Fechas de lunes a viernes, dentro del ano lectivo y nunca futuras.

    El sistema rechaza sabados, domingos y fechas por venir, asi que sembrar una
    de esas dejaria la base en un estado que la propia aplicacion no admite.
    """
    inicio = date(hasta.year, 3, 1)
    if inicio > hasta:
        inicio = hasta - timedelta(days=180)
    candidatas = []
    d = inicio
    while d <= hasta:
        if d.weekday() < 5:
            candidatas.append(d)
        d += timedelta(days=1)
    if not candidatas:
        return []
    return sorted(azar.sample(candidatas, min(cuantos, len(candidatas))))


def _destino() -> str:
    """Host de la base a la que se va a escribir, sin credenciales."""
    return re.sub(r"//[^@]*@", "//***@", str(engine.url))


def _es_produccion() -> bool:
    host = str(engine.url).lower()
    return "neon.tech" in host or "rds.amazonaws.com" in host


def sembrar(cantidad: int, forzar: bool, acepto_produccion: bool) -> int:
    if not DATASET.exists():
        print(f"No encuentro el dataset: {DATASET}")
        return 1

    print(f"Base de datos destino: {_destino()}")

    if _es_produccion() and not acepto_produccion:
        print(
            "\nEsa base es la de produccion (Neon o RDS), donde estan los "
            "estudiantes reales de la tesis.\nSembrar ahi mezclaria alumnos "
            "inventados con los reales y separarlos despues obligaria a "
            "revisarlos de uno en uno.\n\nSi de verdad es lo que quieres, "
            "repite con --acepto-produccion."
        )
        return 2

    db = SessionLocal()
    try:
        existentes = db.query(Alumno).count()
        if existentes and not forzar:
            print(
                f"\nLa base ya tiene {existentes} estudiante(s). El seed esta "
                "pensado para una base vacia.\nSi quieres anadirlos de todas "
                "formas, repite con --forzar."
            )
            return 3

        with DATASET.open(encoding="utf-8-sig", newline="") as f:
            filas = list(csv.DictReader(f))

        azar = random.Random(SEMILLA)
        muestra = azar.sample(filas, min(cantidad, len(filas)))
        anio = date.today().year
        hoy = date.today()
        creados = 0

        for n, fila in enumerate(muestra):
            nombre = NOMBRES[n % len(NOMBRES)]
            apellido = APELLIDOS[(n * 7 + 3) % len(APELLIDOS)]
            numero = str(DNI_BASE + n)

            nivel, grado_num = "Secundaria", 1
            a = Alumno(
                nombre=nombre,
                apellido=f"{apellido} {n + 1:02d}",
                edad=azar.choice([11, 12]),
                nivel=nivel,
                grado=f"{grado_num}° de {nivel}",
                anio_cursada=anio,
                contacto_emergente=MARCA,
                genero=azar.choice(GENEROS),
                tipo_documento="DNI",
                documento_cifrado=cripto.cifrar(numero),
                documento_huella=cripto.huella(numero),
                inasistencias=0,
                inasistencias_previas=0,
            )
            db.add(a)
            db.flush()

            db.add(Encuesta(
                alumno_id=a.id, inasistencias=0, informante=None,
                fecha_aplicacion=hoy, **_mapear_items(fila),
            ))

            for bim in (1, 2, 3, 4):
                literal = str(fila[f"Nota_B{bim}"]).strip().upper()
                if literal not in ("AD", "A", "B", "C"):
                    continue
                for area in AREAS:
                    db.add(Nota(alumno_id=a.id, asignatura=area,
                                calificacion_literal=literal, bimestre=bim))

            faltas = int(float(fila.get("Inasistencias") or 0))
            fechas = _dias_lectivos(faltas, hoy, azar)
            for f in fechas:
                db.add(Asistencia(alumno_id=a.id, fecha=f, estado="No asistió",
                                  registrado_por="seed"))
            # El total es lo que consume el modelo de riesgo, y tiene que cuadrar
            # con las fechas que se acaban de sembrar, no con la cifra del CSV:
            # si el ano lectivo no daba para tantos dias lectivos, son menos.
            a.inasistencias = len(fechas)
            creados += 1

        db.commit()

        predichos = 0
        for a in db.query(Alumno).filter(Alumno.contacto_emergente == MARCA).all():
            try:
                generar_prediccion_alumno(db, a.id)
                predichos += 1
            except Exception:
                # Sin notas suficientes todavia no es predecible. No es un fallo
                # del seed: el estudiante queda igualmente registrado.
                pass
        db.commit()

        print(f"\n{creados} estudiante(s) sembrado(s), {predichos} con prediccion.")
        print(f"Todos llevan el contacto «{MARCA}»: asi los reconoces y asi los retira --limpiar.")
        return 0
    finally:
        db.close()


def limpiar() -> int:
    print(f"Base de datos destino: {_destino()}")
    db = SessionLocal()
    try:
        ids = [a.id for a in db.query(Alumno).filter(Alumno.contacto_emergente == MARCA).all()]
        if not ids:
            print("No hay estudiantes sembrados por este script.")
            return 0
        marcadores = ", ".join(f":i{n}" for n in range(len(ids)))
        params = {f"i{n}": v for n, v in enumerate(ids)}
        for tabla, col in (
            ("ediciones_encuesta", None), ("encuestas", "alumno_id"),
            ("predicciones", "alumno_id"), ("notas", "alumno_id"),
            ("asistencias", "alumno_id"), ("historial_inasistencias", "alumno_id"),
            ("expedientes", "alumno_id"),
        ):
            try:
                if tabla == "ediciones_encuesta":
                    db.execute(text(
                        "DELETE FROM ediciones_encuesta WHERE encuesta_id IN "
                        f"(SELECT id FROM encuestas WHERE alumno_id IN ({marcadores}))"
                    ), params)
                else:
                    db.execute(text(f"DELETE FROM {tabla} WHERE {col} IN ({marcadores})"), params)
            except Exception:
                # La tabla puede no existir segun la antiguedad de la base.
                db.rollback()
        db.execute(text(f"DELETE FROM alumnos WHERE id IN ({marcadores})"), params)
        db.commit()
        print(f"Retirados {len(ids)} estudiante(s) de prueba con todo su historial.")
        return 0
    finally:
        db.close()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cantidad", type=int, default=40,
                   help="cuantos estudiantes sembrar (por omision 40)")
    p.add_argument("--limpiar", action="store_true",
                   help="retira solo los estudiantes que sembro este script")
    p.add_argument("--forzar", action="store_true",
                   help="siembra aunque la base ya tenga estudiantes")
    p.add_argument("--acepto-produccion", action="store_true",
                   help="permite escribir en Neon o RDS (no lo uses sin pensarlo)")
    args = p.parse_args()

    if args.limpiar:
        return limpiar()
    return sembrar(args.cantidad, args.forzar, args.acepto_produccion)


if __name__ == "__main__":
    raise SystemExit(main())
