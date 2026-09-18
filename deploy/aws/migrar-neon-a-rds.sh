#!/usr/bin/env bash
# Copia la base de datos de Neon a RDS.
#
# Se ejecuta DENTRO DE LA INSTANCIA EC2, porque RDS no es accesible desde
# Internet: solo se llega desde dentro de la VPC.
#
#     scp -i clave.pem deploy/aws/migrar-neon-a-rds.sh ec2-user@IP:/tmp/
#     ssh -i clave.pem ec2-user@IP
#     export URL_NEON='postgresql://...neon.tech/...?sslmode=require'
#     export URL_RDS='postgresql://tesisadmin:CLAVE@...rds.amazonaws.com:5432/estudiantes'
#     bash /tmp/migrar-neon-a-rds.sh
#
# NO BORRA NADA EN NEON. Solo lee. Si algo sale mal, el origen sigue intacto y
# basta con devolver DATABASE_URL a la cadena de Neon.

set -euo pipefail

URL_NEON="${URL_NEON:-}"
URL_RDS="${URL_RDS:-}"
COPIA="/opt/tesis/respaldo-neon-$(date +%Y%m%d-%H%M%S).sql"

if [[ -z "$URL_NEON" || -z "$URL_RDS" ]]; then
  echo "Faltan URL_NEON y URL_RDS. Mira la cabecera de este archivo."
  exit 1
fi

command -v pg_dump >/dev/null || { echo "Falta pg_dump: sudo dnf install -y postgresql16"; exit 1; }

echo "══ 1/5 · Inventario del ORIGEN (Neon) ════════════════════════════════"
# Se cuentan las filas antes y después: es la única forma de saber si la copia
# quedó completa, más fiable que confiar en que el comando no dio error.
CONTEO_SQL="SELECT 'alumnos', COUNT(*) FROM alumnos
      UNION ALL SELECT 'notas', COUNT(*) FROM notas
      UNION ALL SELECT 'encuestas', COUNT(*) FROM encuestas
      UNION ALL SELECT 'predicciones', COUNT(*) FROM predicciones
      UNION ALL SELECT 'expedientes', COUNT(*) FROM expedientes
      UNION ALL SELECT 'usuarios', COUNT(*) FROM usuarios
      ORDER BY 1;"
psql "$URL_NEON" -c "$CONTEO_SQL" | tee /tmp/conteo-origen.txt

echo
echo "══ 2/5 · Volcando Neon a un archivo ══════════════════════════════════"
sudo mkdir -p /opt/tesis && sudo chown "$USER" /opt/tesis
# --no-owner y --no-privileges: los roles de Neon no existen en RDS y, sin
# esto, la restauración falla con errores de propietario desconocido.
pg_dump "$URL_NEON" \
  --no-owner --no-privileges --no-acl \
  --format=plain --encoding=UTF8 \
  --file="$COPIA"

echo "   copia guardada en $COPIA ($(du -h "$COPIA" | cut -f1))"
echo "   GUÁRDALA. Es tu respaldo aunque la migración se tuerza."

echo
echo "══ 3/5 · Comprobando que RDS está vacío ══════════════════════════════"
EXISTENTES=$(psql "$URL_RDS" -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
if [[ "$EXISTENTES" -gt 0 ]]; then
  echo "   AVISO: RDS ya tiene $EXISTENTES tabla(s)."
  echo "   Restaurar encima puede duplicar filas o chocar con las claves."
  read -rp "   ¿Continuar de todos modos? (escribe SI): " RESPUESTA
  [[ "$RESPUESTA" == "SI" ]] || { echo "   cancelado"; exit 1; }
fi

echo
echo "══ 4/5 · Restaurando en RDS ══════════════════════════════════════════"
# ON_ERROR_STOP: si una sentencia falla, se detiene ahí en lugar de seguir y
# dejar una base a medias que parece correcta.
psql "$URL_RDS" --set ON_ERROR_STOP=on --quiet --file="$COPIA"

echo
echo "══ 5/5 · Comparando origen y destino ═════════════════════════════════"
psql "$URL_RDS" -c "$CONTEO_SQL" | tee /tmp/conteo-destino.txt

echo
if diff <(grep -E '^\s+\w+\s+\|' /tmp/conteo-origen.txt) \
        <(grep -E '^\s+\w+\s+\|' /tmp/conteo-destino.txt) >/dev/null; then
  echo "   LAS CIFRAS COINCIDEN. La migración está completa."
  echo
  echo "   Siguiente paso: pon la cadena de RDS en /opt/tesis/entorno.env"
  echo "   y reinicia:  cd /opt/tesis && sudo docker compose restart api"
  echo
  echo "   NO borres nada en Neon hasta haber probado la aplicación entera"
  echo "   contra RDS: entrar, ver el panel, generar una predicción."
else
  echo "   LAS CIFRAS NO COINCIDEN. Revisa las diferencias:"
  diff /tmp/conteo-origen.txt /tmp/conteo-destino.txt || true
  echo
  echo "   Neon sigue intacto. No cambies DATABASE_URL hasta resolverlo."
  exit 1
fi
