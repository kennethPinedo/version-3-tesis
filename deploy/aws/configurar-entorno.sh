#!/usr/bin/env bash
# Escribe /opt/tesis/entorno.env en la instancia (fase 5).
#
#     bash deploy/aws/configurar-entorno.sh
#
# Lee el endpoint de RDS de la propia pila y las claves de cifrado del .env
# local, pide la contrasena de la base y lo envia todo por SSH. Las claves
# nunca se imprimen en pantalla ni quedan en el historial del shell.
#
# Por que las claves tienen que ser LAS MISMAS que en backend_fastapi/.env: los
# numeros de documento estan cifrados con DOCUMENTO_KEY y su huella de
# unicidad se calcula con DOCUMENTO_PEPPER. Con claves distintas, los datos que
# se migren de Neon quedan ilegibles para siempre.

set -euo pipefail

PILA="${PILA:-tesis-tdah}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USUARIO="ec2-user"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

echo
echo "== 1/4 - Datos de la pila ==========================================="

salida() {
  aws cloudformation describe-stacks --stack-name "$PILA" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null
}

IP="${IP_SERVIDOR:-$(salida IpServidor)}"
ENDPOINT_BD="$(salida EndpointBaseDatos)"
BUCKET_EXP="$(salida BucketExpedientesNombre)"

if [[ -z "$IP" || "$IP" == "None" ]]; then
  rojo "  falla No encuentro la pila \"$PILA\". Crea la infraestructura primero."
  exit 1
fi
verde "  ok    servidor      $IP"
verde "  ok    base de datos $ENDPOINT_BD"
verde "  ok    expedientes   $BUCKET_EXP"

CLAVE_SSH="${CLAVE_SSH:-$RAIZ/$PILA.pem}"
[[ -f "$CLAVE_SSH" ]] || { rojo "  falla No encuentro la clave SSH en $CLAVE_SSH"; exit 1; }
verde "  ok    clave SSH     $(basename "$CLAVE_SSH")"

echo
echo "== 2/4 - Claves de cifrado del .env local ==========================="

ENV_LOCAL="$RAIZ/backend_fastapi/.env"
[[ -f "$ENV_LOCAL" ]] || { rojo "  falla No existe $ENV_LOCAL"; exit 1; }

leer_clave() {
  # Toma el valor tal cual, quitando comillas y espacios de los extremos.
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_LOCAL" \
    | head -1 | sed 's/^["'"'"']//; s/["'"'"']$//' | tr -d '\r'
}

DOC_KEY="$(leer_clave DOCUMENTO_KEY)"
DOC_PEPPER="$(leer_clave DOCUMENTO_PEPPER)"

[[ -n "$DOC_KEY"    ]] || { rojo "  falla DOCUMENTO_KEY no esta en el .env local";    exit 1; }
[[ -n "$DOC_PEPPER" ]] || { rojo "  falla DOCUMENTO_PEPPER no esta en el .env local"; exit 1; }
verde "  ok    DOCUMENTO_KEY     ${#DOC_KEY} caracteres"
verde "  ok    DOCUMENTO_PEPPER  ${#DOC_PEPPER} caracteres"

echo
echo "== 3/4 - Contrasena de la base de datos ============================="

if [[ -n "${CLAVE_BD:-}" ]]; then
  gris "  usando CLAVE_BD del entorno"
else
  # -s: no se muestra al teclear, para que no quede en la pantalla ni en una
  # captura. Es la que genero crear-infraestructura.sh en su paso 4.
  read -rsp "  Contrasena de la base (la del paso 4, no se vera): " CLAVE_BD
  echo
fi
[[ -n "$CLAVE_BD" ]] || { rojo "  falla Sin contrasena no se puede formar DATABASE_URL"; exit 1; }

USUARIO_BD="$(aws cloudformation describe-stacks --stack-name "$PILA" \
  --query "Stacks[0].Parameters[?ParameterKey=='UsuarioBD'].ParameterValue" --output text)"

echo
echo "== 4/4 - Enviando la configuracion =================================="

# Se construye en un archivo temporal con permisos cerrados y se borra al
# salir, pase lo que pase.
TMP="$(mktemp)"
chmod 600 "$TMP"
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<ENTORNO
# Generado por deploy/aws/configurar-entorno.sh. No se sube al repositorio.

DATABASE_URL=postgresql://${USUARIO_BD}:${CLAVE_BD}@${ENDPOINT_BD}:5432/estudiantes

# Origenes autorizados del navegador. Se completa en la fase 8 con el
# subdominio de la API y en la 9 con el dominio de CloudFront, separados por
# coma. Vacio = solo los origenes locales que trae main.py por defecto.
CORS_ORIGINS=${CORS_ORIGINS:-}

# Sin previews que autorizar en AWS: se anula el patron de Vercel que viene
# por defecto, para no dejar abierto cualquier *.vercel.app.
CORS_ORIGIN_REGEX=\$^

# LAS MISMAS que en backend_fastapi/.env. Cambiarlas deja ilegibles los
# numeros de documento ya cifrados.
DOCUMENTO_KEY=${DOC_KEY}
DOCUMENTO_PEPPER=${DOC_PEPPER}

BUCKET_EXPEDIENTES=${BUCKET_EXP}
ENTORNO

scp -i "$CLAVE_SSH" -o StrictHostKeyChecking=accept-new -q "$TMP" "$USUARIO@$IP:/tmp/entorno.env"
ssh -i "$CLAVE_SSH" -o StrictHostKeyChecking=accept-new "$USUARIO@$IP" \
  "sudo mv /tmp/entorno.env /opt/tesis/entorno.env \
   && sudo chown root:root /opt/tesis/entorno.env \
   && sudo chmod 600 /opt/tesis/entorno.env"
verde "  ok    /opt/tesis/entorno.env escrito (root, 600)"

echo
gris "  Comprobando que la instancia alcanza la base de datos..."
# psql acepta la URL entera, asi que no hay que desmontarla para sacar la
# contrasena: intentar trocearla a mano fallaba y hacia parecer rota una
# configuracion que estaba bien.
if ssh -i "$CLAVE_SSH" "$USUARIO@$IP" \
     'sudo bash -c '"'"'set -a; . /opt/tesis/entorno.env; set +a; psql "$DATABASE_URL" -tAc "select version()"'"'"'' \
     2>/dev/null | grep -q PostgreSQL; then
  verde "  ok    la instancia se conecta a PostgreSQL"
else
  rojo "  aviso No pude confirmar la conexion a la base."
  gris  "        Suele ser la contrasena. Compruebalo a mano:"
  gris  "          ssh -i $(basename "$CLAVE_SSH") $USUARIO@$IP"
  gris  "          psql -h $ENDPOINT_BD -U $USUARIO_BD -d estudiantes"
fi

cat <<SIGUIENTE

  Siguiente: desplegar el backend.

      export IP_SERVIDOR=$IP
      export CLAVE_SSH="$CLAVE_SSH"
      bash deploy/aws/desplegar-backend.sh

SIGUIENTE
