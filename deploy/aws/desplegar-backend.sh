#!/usr/bin/env bash
# Despliega el backend en la instancia EC2.
#
# Se ejecuta DESDE TU MÁQUINA, en la raíz del repositorio:
#     bash deploy/aws/desplegar-backend.sh
#
# Construye la imagen aquí y la envía por SSH. Se hace así, y no construyendo
# dentro de la instancia, porque compilar las dependencias en una t3.small es
# lento y puede quedarse sin memoria.

set -euo pipefail

# ── Configuración: rellena esto con las salidas de la pila ───────────────────
IP_SERVIDOR="${IP_SERVIDOR:-}"          # salida «IpServidor»
CLAVE_SSH="${CLAVE_SSH:-}"              # ruta a tu archivo .pem
USUARIO="ec2-user"

if [[ -z "$IP_SERVIDOR" || -z "$CLAVE_SSH" ]]; then
  cat <<'AYUDA'
Faltan datos. Defínelos antes de ejecutar:

    export IP_SERVIDOR=52.x.x.x              # salida IpServidor de la pila
    export CLAVE_SSH=~/.ssh/tesis-tdah.pem   # la clave que descargaste
    bash deploy/aws/desplegar-backend.sh

AYUDA
  exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

ssh_ec2() { ssh -i "$CLAVE_SSH" -o StrictHostKeyChecking=accept-new "$USUARIO@$IP_SERVIDOR" "$@"; }

echo "── 1/5 · Construyendo la imagen ──────────────────────────────────────"
docker build -f deploy/aws/Dockerfile -t tesis-api:latest .

echo
echo "── 2/5 · Comprobando la imagen antes de enviarla ─────────────────────"
# Vale más descubrir aquí que falta libgomp1 que a mitad del despliegue.
docker run --rm tesis-api:latest python -c "
import xgboost, shap, sklearn, fastapi
print(f'  xgboost {xgboost.__version__} · shap {shap.__version__} · fastapi {fastapi.__version__}')
print('  las dependencias cargan correctamente')
"

echo
echo "── 3/5 · Enviando la imagen a la instancia ───────────────────────────"
echo "   (son unos 900 MB comprimidos; tarda varios minutos)"
docker save tesis-api:latest | gzip -1 | ssh_ec2 "gunzip | docker load"

echo
echo "── 4/5 · Copiando la configuración ───────────────────────────────────"
scp -i "$CLAVE_SSH" deploy/aws/docker-compose.yml "$USUARIO@$IP_SERVIDOR:/tmp/"
scp -i "$CLAVE_SSH" deploy/aws/nginx.conf         "$USUARIO@$IP_SERVIDOR:/tmp/"
ssh_ec2 "sudo mv /tmp/docker-compose.yml /tmp/nginx.conf /opt/tesis/ && sudo chown root:root /opt/tesis/*"

echo
echo "── 5/5 · Levantando los contenedores ─────────────────────────────────"
ssh_ec2 "cd /opt/tesis && sudo docker compose up -d && sleep 20 && sudo docker compose ps"

echo
echo "── Comprobación final ────────────────────────────────────────────────"
if curl -fsS --max-time 20 "http://$IP_SERVIDOR/" >/dev/null 2>&1; then
  echo "   La API responde en http://$IP_SERVIDOR/"
  curl -s --max-time 20 "http://$IP_SERVIDOR/"
  echo
else
  echo "   La API todavía no responde. Revisa los registros:"
  echo "     ssh -i $CLAVE_SSH $USUARIO@$IP_SERVIDOR 'sudo docker compose -f /opt/tesis/docker-compose.yml logs api'"
  exit 1
fi
