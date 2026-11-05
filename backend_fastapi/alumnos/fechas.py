"""Serializacion de fechas con hora hacia el cliente."""
from datetime import datetime, timezone
from typing import Optional


def iso_utc(valor: Optional[datetime]) -> Optional[str]:
    """ISO 8601 diciendo explicitamente que la hora es UTC.

    Las columnas DateTime se guardan con datetime.utcnow(), que devuelve una
    hora UTC SIN zona horaria. Al serializarla con isoformat() salia
    «2026-11-02T02:10:00», y JavaScript interpreta una marca sin zona como hora
    LOCAL: una prediccion generada a las 21:10 en Lima aparecia como las 02:10
    del dia siguiente, cinco horas adelantada y con la fecha cambiada.

    Marcarla como UTC deja que el navegador la convierta a la hora del usuario,
    que es lo que esperaba ver.
    """
    if valor is None:
        return None
    if valor.tzinfo is None:
        valor = valor.replace(tzinfo=timezone.utc)
    return valor.isoformat()
