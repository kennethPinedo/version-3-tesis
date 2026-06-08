from datetime import date, datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Date
from database import Base


class Alumno(Base):
    __tablename__ = "alumnos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    edad = Column(Integer, nullable=False)
    grado = Column(String(10), nullable=False)
    anio_cursada = Column(Integer, default=2024)
    contacto_emergente = Column(String(20), nullable=False)
    condicion_social = Column(String(10), default="NINGUNA")
    genero = Column(String(20), default="No especificado")


class Encuesta(Base):
    __tablename__ = "encuestas"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False)
    # Déficit de Atención (DA1-DA5) — escala 0-3, max 15
    DA1 = Column(Integer, nullable=False)
    DA2 = Column(Integer, nullable=False)
    DA3 = Column(Integer, nullable=False)
    DA4 = Column(Integer, nullable=False)
    DA5 = Column(Integer, nullable=False)
    # Hiperactividad e Impulsividad (HI1-HI5) — escala 0-3, max 15
    HI1 = Column(Integer, nullable=False)
    HI2 = Column(Integer, nullable=False)
    HI3 = Column(Integer, nullable=False)
    HI4 = Column(Integer, nullable=False)
    HI5 = Column(Integer, nullable=False)
    # Trastorno de Conducta (TC1-TC10) — escala 0-3, max 30
    TC1 = Column(Integer, nullable=False)
    TC2 = Column(Integer, nullable=False)
    TC3 = Column(Integer, nullable=False)
    TC4 = Column(Integer, nullable=False)
    TC5 = Column(Integer, nullable=False)
    TC6 = Column(Integer, nullable=False)
    TC7 = Column(Integer, nullable=False)
    TC8 = Column(Integer, nullable=False)
    TC9 = Column(Integer, nullable=False)
    TC10 = Column(Integer, nullable=False)
    fecha_aplicacion = Column(Date, default=date.today)


class Nota(Base):
    __tablename__ = "notas"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False)
    asignatura = Column(String(100), nullable=False)
    calificacion_literal = Column(String(2), nullable=False)
    fecha_registro = Column(Date, default=date.today)


class PrediccionAcademica(Base):
    __tablename__ = "predicciones"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False)
    promedio_notas = Column(Float, nullable=False)
    nivel_riesgo = Column(String(10), nullable=False)
    probabilidad = Column(Float, nullable=True)
    prediccion_notas = Column(String, nullable=False)
    condiciones_psicoeducativas = Column(String, nullable=False)
    fecha_prediccion = Column(DateTime, default=datetime.utcnow)


class ExpedientePsicologico(Base):
    __tablename__ = "expedientes"

    id = Column(Integer, primary_key=True, index=True)
    alumno_id = Column(Integer, ForeignKey("alumnos.id"), nullable=False)
    nivel_preocupacion = Column(Integer, nullable=False)
    archivo_pdf = Column(String, nullable=False)
    fecha_registro = Column(DateTime, default=datetime.utcnow)
