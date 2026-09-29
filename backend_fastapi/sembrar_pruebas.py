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
from alumnos.routers.notas import ASIGNATURAS_VALIDAS  # noqa: E402
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
#
# Los nombres se toman del catalogo del sistema, con sus tildes. El seed escribe
# por el ORM y no pasa por la validacion de la API, asi que escribir
# «Matematica» colaria un area que el propio sistema rechaza: normalizar_asignatura
# compara en minusculas pero no quita tildes, y esa nota quedaria fuera del plan
# de estudios sin que nada avisara.
AREAS = [ASIGNATURAS_VALIDAS[6], ASIGNATURAS_VALIDAS[4], ASIGNATURAS_VALIDAS[7]]

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


def generar(cantidad: int) -> list[dict]:
    """Construye los estudiantes en memoria, sin tocar ninguna base.

    Es la UNICA fuente: tanto sembrar() como exportar() consumen esta lista. Si
    cada uno los construyera por su lado, bastaria con consumir el generador
    aleatorio en distinto orden para que el CSV describiera a unos estudiantes y
    la base contuviera otros, sin que nada lo delatase.
    """
    with DATASET.open(encoding="utf-8-sig", newline="") as f:
        filas = list(csv.DictReader(f))

    azar = random.Random(SEMILLA)
    muestra = azar.sample(filas, min(cantidad, len(filas)))
    hoy = date.today()
    alumnos: list[dict] = []

    for n, fila in enumerate(muestra):
        ident = n + 1
        edad = azar.choice([11, 12])
        genero = azar.choice(GENEROS)
        fechas = _dias_lectivos(int(float(fila.get("Inasistencias") or 0)), hoy, azar)

        notas = []
        for bim in (1, 2, 3, 4):
            literal = str(fila[f"Nota_B{bim}"]).strip().upper()
            if literal in ("AD", "A", "B", "C"):
                for area in AREAS:
                    notas.append({"bimestre": bim, "asignatura": area,
                                  "calificacion": literal})

        alumnos.append({
            "id": ident,
            "nombre": NOMBRES[n % len(NOMBRES)],
            "apellido": f"{APELLIDOS[(n * 7 + 3) % len(APELLIDOS)]} {ident:02d}",
            "edad": edad,
            "nivel": "Secundaria",
            "grado": 1,
            "anio_cursada": hoy.year,
            "genero": genero,
            "tipo_documento": "DNI",
            "numero_documento": str(DNI_BASE + n),
            "contacto_emergente": MARCA,
            # El total tiene que cuadrar con las fechas efectivamente generadas,
            # no con la cifra del CSV: si el ano lectivo no daba para tantos dias
            # lectivos, son menos. Es el numero que consume el modelo de riesgo.
            "inasistencias": len(fechas),
            "items": _mapear_items(fila),
            "notas": notas,
            "fechas_falta": [f.isoformat() for f in fechas],
            "fecha_aplicacion": hoy.isoformat(),
        })
    return alumnos


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

        creados = 0
        for datos in generar(cantidad):
            numero = datos["numero_documento"]
            a = Alumno(
                nombre=datos["nombre"],
                apellido=datos["apellido"],
                edad=datos["edad"],
                nivel=datos["nivel"],
                grado=f"{datos['grado']}° de {datos['nivel']}",
                anio_cursada=datos["anio_cursada"],
                contacto_emergente=datos["contacto_emergente"],
                genero=datos["genero"],
                tipo_documento=datos["tipo_documento"],
                documento_cifrado=cripto.cifrar(numero),
                documento_huella=cripto.huella(numero),
                inasistencias=datos["inasistencias"],
                inasistencias_previas=0,
            )
            db.add(a)
            db.flush()

            db.add(Encuesta(
                alumno_id=a.id, inasistencias=0, informante=None,
                fecha_aplicacion=date.fromisoformat(datos["fecha_aplicacion"]),
                **datos["items"],
            ))
            for nota in datos["notas"]:
                db.add(Nota(alumno_id=a.id, asignatura=nota["asignatura"],
                            calificacion_literal=nota["calificacion"],
                            bimestre=nota["bimestre"]))
            for f in datos["fechas_falta"]:
                db.add(Asistencia(alumno_id=a.id, fecha=date.fromisoformat(f),
                                  estado="No asistió", registrado_por="seed"))
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


def exportar(cantidad: int, carpeta: Path) -> int:
    """Escribe en CSV los estudiantes que sembraria, sin tocar ninguna base.

    Sirve para poder revisarlos antes de cargarlos, y para que el juego de datos
    de prueba sea visible en el repositorio en lugar de existir solo como una
    consecuencia de ejecutar el script. Se genera desde aqui, no a mano, para que
    los archivos no puedan contradecir a lo que el seed hace de verdad.
    """
    if not DATASET.exists():
        print(f"No encuentro el dataset: {DATASET}")
        return 1

    alumnos, encuestas, notas, asistencias = [], [], [], []
    for datos in generar(cantidad):
        ident = datos["id"]
        alumnos.append({k: datos[k] for k in (
            "id", "nombre", "apellido", "edad", "nivel", "grado", "anio_cursada",
            "genero", "tipo_documento", "numero_documento", "contacto_emergente",
            "inasistencias")})
        encuestas.append({"alumno_id": ident, **datos["items"],
                          "fecha_aplicacion": datos["fecha_aplicacion"]})
        for nota in datos["notas"]:
            notas.append({"alumno_id": ident, **nota})
        for f in datos["fechas_falta"]:
            asistencias.append({"alumno_id": ident, "fecha": f,
                                "estado": "No asistió"})

    carpeta.mkdir(parents=True, exist_ok=True)
    for nombre, filas_csv in (
        ("alumnos.csv", alumnos), ("encuestas_edah.csv", encuestas),
        ("notas.csv", notas), ("asistencias.csv", asistencias),
    ):
        destino = carpeta / nombre
        with destino.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(filas_csv[0].keys()))
            w.writeheader()
            w.writerows(filas_csv)
        print(f"  {destino.name:20s} {len(filas_csv):4d} filas")

    print(f"\nExportado a {carpeta}")
    print("Son datos inventados: los DNI empiezan por 99, que no se emite en Peru.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cantidad", type=int, default=40,
                   help="cuantos estudiantes sembrar (por omision 40)")
    p.add_argument("--limpiar", action="store_true",
                   help="retira solo los estudiantes que sembro este script")
    p.add_argument("--exportar", metavar="CARPETA", nargs="?",
                   const="../datos_prueba", default=None,
                   help="escribe los estudiantes en CSV sin tocar ninguna base")
    p.add_argument("--forzar", action="store_true",
                   help="siembra aunque la base ya tenga estudiantes")
    p.add_argument("--acepto-produccion", action="store_true",
                   help="permite escribir en Neon o RDS (no lo uses sin pensarlo)")
    args = p.parse_args()

    if args.limpiar:
        return limpiar()
    if args.exportar is not None:
        return exportar(args.cantidad, Path(args.exportar))
    return sembrar(args.cantidad, args.forzar, args.acepto_produccion)


if __name__ == "__main__":
    raise SystemExit(main())
