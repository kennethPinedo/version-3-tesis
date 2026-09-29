#!/usr/bin/env bash
# Despliega el backend construyendo la imagen DENTRO de la instancia (fase 6).
#
#     bash deploy/aws/desplegar-backend-remoto.sh
#
# Alternativa a desplegar-backend.sh, que construye en tu maquina y envia la
# imagen. Aqui se sube solo el codigo fuente y Docker trabaja en el servidor.
#
# Por que esta version:
#   - No necesitas Docker en Windows. Docker Desktop exige WSL2, y en esta
#     maquina no esta instalado.
#   - Se transfieren ~0,3 MB de codigo en vez de ~900 MB de imagen. Por una
#     conexion domestica la diferencia son minutos frente a mas de una hora.
#   - Una transferencia corta no se corta a la mitad.
#
# La contrapartida es que la t3.small tarda mas en construir que tu Ryzen. Con
# 2 GB de RAM y 2 GB de swap llega de sobra: las dependencias pesadas (xgboost,
# scipy, shap) se instalan desde ruedas precompiladas, no se compilan.

set -euo pipefail

PILA="${PILA:-tesis-tdah}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USUARIO="ec2-user"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

IP="${IP_SERVIDOR:-$(aws cloudformation describe-stacks --stack-name "$PILA" \
      --query "Stacks[0].Outputs[?OutputKey=='IpServidor'].OutputValue" \
      --output text 2>/dev/null)}"
CLAVE_SSH="${CLAVE_SSH:-$RAIZ/$PILA.pem}"

if [[ -z "$IP" || "$IP" == "None" ]]; then
  rojo "No encuentro la IP del servidor. Define IP_SERVIDOR o crea la pila."
  exit 1
fi
[[ -f "$CLAVE_SSH" ]] || { rojo "No encuentro la clave SSH en $CLAVE_SSH"; exit 1; }

ssh_ec2() { ssh -i "$CLAVE_SSH" -o StrictHostKeyChecking=accept-new "$USUARIO@$IP" "$@"; }

echo
echo "== 1/6 - Comprobando la instancia =================================="
if ! ssh_ec2 "docker --version" >/dev/null 2>&1; then
  rojo "  falla No puedo entrar por SSH o Docker no responde en $IP"
  gris  "        Si acabas de encenderla, espera un minuto."
  gris  "        Si cambiaste de red, tu IP publica ya no coincide con la que"
  gris  "        autoriza el grupo de seguridad."
  exit 1
fi
verde "  ok    $(ssh_ec2 'docker --version')"
verde "  ok    memoria $(ssh_ec2 "free -m | awk '/Mem:/{print \$2}'") MB + swap $(ssh_ec2 "free -m | awk '/Swap:/{print \$2}'") MB"

if ! ssh_ec2 "test -f /opt/tesis/entorno.env"; then
  rojo "  falla Falta /opt/tesis/entorno.env. Ejecuta antes la fase 5:"
  gris  "          bash deploy/aws/configurar-entorno.sh"
  exit 1
fi
verde "  ok    entorno.env presente"

# El paquete "docker" de Amazon Linux 2023 no incluye el plugin de Compose, y
# tampoco esta en sus repos: "docker compose up -d" falla con un desconcertante
# "unknown shorthand flag: d". El arranque de la instancia ya lo instala, pero
# una instancia creada con una plantilla anterior no lo tendra.
if ssh_ec2 "docker compose version" >/dev/null 2>&1; then
  verde "  ok    $(ssh_ec2 'docker compose version')"
else
  gris  "  instalando el plugin de Compose, que falta en esta instancia..."
  ssh_ec2 'set -e
    P=/usr/libexec/docker/cli-plugins; sudo mkdir -p "$P"
    V=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest \
        | grep -oP "\"tag_name\":\s*\"\K[^\"]+") || V=v2.32.4
    sudo curl -fsSL "https://github.com/docker/compose/releases/download/$V/docker-compose-linux-x86_64" \
         -o "$P/docker-compose"
    sudo chmod +x "$P/docker-compose"'
  verde "  ok    $(ssh_ec2 'docker compose version')"
fi

echo
echo "== 2/6 - Empaquetando el codigo ===================================="
cd "$RAIZ"
PAQUETE="$(mktemp -u).tar.gz"
trap 'rm -f "$PAQUETE"' EXIT

# Se excluye lo mismo que .dockerignore. El entorno virtual son ~730 MB que la
# imagen reconstruye por su cuenta, y el .env local NO debe viajar: la
# instancia usa el suyo, con la cadena de RDS y no la de Neon.
tar czf "$PAQUETE" \
  --exclude='.venv' --exclude='venv' --exclude='__pycache__' \
  --exclude='*.pyc' --exclude='media' --exclude='*.db' --exclude='*.db.bak*' \
  --exclude='.env' \
  backend_fastapi deploy/aws/Dockerfile deploy/aws/docker-compose.yml deploy/aws/nginx.conf

verde "  ok    $(du -h "$PAQUETE" | cut -f1) a enviar"

echo
echo "== 3/6 - Enviando =================================================="
scp -i "$CLAVE_SSH" -q "$PAQUETE" "$USUARIO@$IP:/tmp/tesis-fuente.tar.gz"
ssh_ec2 "sudo rm -rf /opt/tesis/fuente && sudo mkdir -p /opt/tesis/fuente \
         && sudo tar xzf /tmp/tesis-fuente.tar.gz -C /opt/tesis/fuente \
         && rm -f /tmp/tesis-fuente.tar.gz"
verde "  ok    codigo desplegado en /opt/tesis/fuente"

echo
echo "== 4/6 - Construyendo la imagen en el servidor ====================="
gris "  La primera vez tarda 4-8 minutos: descarga python:3.13-slim y las"
gris "  dependencias. Las siguientes reutilizan la cache y son mucho mas rapidas."
echo
ssh_ec2 "cd /opt/tesis/fuente && sudo docker build -f deploy/aws/Dockerfile -t tesis-api:latest . 2>&1 | tail -25"

echo
echo "== 5/6 - Comprobando la imagen ====================================="
# Vale mas descubrir aqui que falta libgomp1 que a mitad del arranque.
ssh_ec2 "sudo docker run --rm tesis-api:latest python -c \"
import xgboost, shap, sklearn, fastapi
print(f'  xgboost {xgboost.__version__} - shap {shap.__version__} - fastapi {fastapi.__version__}')
print('  las dependencias cargan correctamente')
\""

echo
echo "== 6/6 - Levantando los contenedores ==============================="
ssh_ec2 "sudo cp /opt/tesis/fuente/deploy/aws/docker-compose.yml /opt/tesis/ \
         && sudo cp /opt/tesis/fuente/deploy/aws/nginx.conf /opt/tesis/ \
         && sudo mkdir -p /opt/tesis/certbot/www \
         && cd /opt/tesis && sudo docker compose up -d && sleep 20 && sudo docker compose ps"

echo
echo "== Comprobacion final =============================================="
if curl -fsS --max-time 30 "http://$IP/" >/dev/null 2>&1; then
  verde "  La API responde en http://$IP/"
  curl -s --max-time 30 "http://$IP/"
  echo
  cat <<SIGUIENTE

  Siguiente: migrar los datos de Neon a RDS (fase 7).

      ssh -i $(basename "$CLAVE_SSH") $USUARIO@$IP
      sudo bash /opt/tesis/fuente/deploy/aws/migrar-neon-a-rds.sh

SIGUIENTE
else
  rojo "  La API todavia no responde. Registros de los ultimos 30 renglones:"
  ssh_ec2 "cd /opt/tesis && sudo docker compose logs --tail 30 api"
  exit 1
fi
