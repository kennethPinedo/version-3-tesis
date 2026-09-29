# Datos de prueba

40 estudiantes **ficticios**, con su evaluación EDAH, sus notas y sus
inasistencias. Sirven para probar el sistema en cualquier máquina sin tocar la
base de datos real.

## Por qué existen

Los 39 estudiantes reales de la tesis son menores identificables: nombre,
documento, contacto de emergencia y evaluación clínica. Esos registros no pueden
vivir en un repositorio, así que al clonar el proyecto no había con qué probar y
la única salida era apuntar a la base de producción y escribir sobre los datos
de la tesis.

Estos los sustituyen. Salen del dataset sintético `dataset_tdah_bimestral_500.csv`
(500 registros generados, sin ninguna persona real detrás), así que reproducen
los mismos rangos y distribuciones que la base real sin describir a nadie.

Los DNI empiezan por `99`, un prefijo que no se emite en Perú: ninguno puede
coincidir con el documento de una persona.

## Los archivos

| Archivo | Filas | Contenido |
|---|---|---|
| `alumnos.csv` | 40 | Datos del estudiante, incluido el DNI ficticio en claro |
| `encuestas_edah.csv` | 40 | Los 20 ítems de la escala, en escala 0–3 |
| `notas.csv` | 480 | Tres áreas por cada uno de los cuatro bimestres |
| `asistencias.csv` | 232 | Faltas con fecha, solo en días lectivos pasados |

En `encuestas_edah.csv` las columnas van intercaladas (`HI1, DA1, HI2, DA2…`)
porque ese es el orden del dataset de origen: `HI(5) + DA(5) + TC(10)`, el mismo
que usan el entrenamiento y `prediccion_service` al armar el vector.

## Cómo cargarlos

No se importan a mano. Los genera y los carga el mismo script:

```bash
cd backend_fastapi
python sembrar_pruebas.py            # crea los 40 en la base de datos
python sembrar_pruebas.py --limpiar  # retira solo lo que sembró
```

Sin `DATABASE_URL` definida usa un SQLite local, así que funciona sin internet.
Y si detecta que la base es Neon o RDS **se niega a escribir**, porque ahí están
los estudiantes reales: mezclarlos obligaría a separarlos uno por uno después.

## Estos CSV son salida, no fuente

Se regeneran con:

```bash
python sembrar_pruebas.py --exportar
```

Están versionados para poder revisarlos sin ejecutar nada, pero **no se editan a
mano**: la fuente de verdad es `sembrar_pruebas.py`. Si se tocaran aquí, el
archivo describiría a unos estudiantes y la base contendría otros.

La semilla está fijada, así que siempre salen los mismos: el alumno 1 es
«Ana Huaman 01», 12 años, 1 inasistencia. Por eso un caso de prueba que falla en
una máquina falla igual en otra.
