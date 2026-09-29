#!/usr/bin/env bash
# Pone HTTPS en la API con un certificado gratuito de Let's Encrypt.
#
# SE EJECUTA DENTRO DE LA INSTANCIA EC2:
#     scp -i clave.pem deploy/aws/configurar-https.sh ec2-user@IP:/tmp/
#     ssh -i clave.pem ec2-user@IP
#     sudo bash /tmp/configurar-https.sh mi-tesis.duckdns.org correo@ejemplo.com
#
# Por que hace falta: CloudFront sirve el frontend por HTTPS y el navegador
# bloquea que una pagina HTTPS llame a una API por HTTP. Sin esto, la
# aplicacion desplegada no funciona.
#
# Antes de ejecutarlo necesitas un subdominio apuntando a la IP de esta
# instancia. En duckdns.org es gratis y son dos minutos: creas el subdominio y
# escribes la IP. NO hace falta el token: la validacion es por HTTP, no por DNS.

set -euo pipefail

DOMINIO="${1:-}"
CORREO="${2:-}"
TESIS=/opt/tesis

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

if [[ -z "$DOMINIO" || -z "$CORREO" ]]; then
  cat <<'AYUDA'
Uso:  sudo bash configurar-https.sh <dominio> <correo>

  <dominio>  el subdominio que apunta a esta instancia, p. ej. mi-tesis.duckdns.org
  <correo>   para los avisos de caducidad del certificado

Si aun no tienes subdominio: entra en https://www.duckdns.org, inicia sesion
con Google o GitHub, escribe un nombre y pon la IP publica de esta instancia.
AYUDA
  exit 1
fi

[[ $EUID -eq 0 ]] || { rojo "Ejecutalo con sudo: necesita escribir en /etc/letsencrypt"; exit 1; }

echo
echo "══ 1/6 · Comprobaciones ══════════════════════════════════════════════"

IP_REAL=$(curl -s --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')
IP_DOMINIO=$(getent hosts "$DOMINIO" | awk '{print $1}' | head -1 || true)

verde "  ok    IP de esta instancia : $IP_REAL"
if [[ -z "$IP_DOMINIO" ]]; then
  rojo  "  falla $DOMINIO no resuelve a ninguna IP."
  gris  "        Crea el subdominio en duckdns.org y espera un minuto."
  exit 1
fi
if [[ "$IP_DOMINIO" != "$IP_REAL" ]]; then
  rojo  "  falla $DOMINIO apunta a $IP_DOMINIO, no a esta instancia."
  gris  "        Corrige la IP en duckdns.org y vuelve a intentarlo."
  exit 1
fi
verde "  ok    $DOMINIO apunta aqui"

[[ -f "$TESIS/docker-compose.yml" ]] || { rojo "  falla No encuentro $TESIS/docker-compose.yml. Despliega antes el backend."; exit 1; }
verde "  ok    el backend esta desplegado"

echo
echo "══ 2/6 · Instalando certbot ══════════════════════════════════════════"
if command -v certbot >/dev/null 2>&1; then
  verde "  ok    certbot ya estaba instalado"
else
  dnf install -y certbot >/dev/null 2>&1 || {
    gris "  el paquete no esta en los repos; se instala con pip"
    dnf install -y python3-pip >/dev/null 2>&1
    pip3 install --quiet certbot
  }
  verde "  ok    certbot instalado"
fi

echo
echo "══ 3/6 · Preparando el reto ══════════════════════════════════════════"
# Let's Encrypt pide un archivo en /.well-known/acme-challenge/ para comprobar
# que el dominio es tuyo. Nginx ya lo sirve desde esta carpeta.
mkdir -p "$TESIS/certbot/www/.well-known/acme-challenge"
chmod -R 755 "$TESIS/certbot"
echo "ok" > "$TESIS/certbot/www/.well-known/acme-challenge/prueba"

# Si el backend se desplego con una version anterior de nginx.conf, esa ruta no
# existe y el fallo pareceria un problema de red. Mejor decirlo claro.
if ! grep -q "acme-challenge" "$TESIS/nginx.conf"; then
  rojo  "  falla $TESIS/nginx.conf no sirve /.well-known/acme-challenge/"
  gris  "        Es una version anterior del archivo. Desde tu maquina:"
  gris  "          bash deploy/aws/desplegar-backend.sh"
  gris  "        y vuelve a ejecutar este script."
  exit 1
fi
verde "  ok    nginx sirve la ruta del reto"

# Recrear, no solo reiniciar: el montaje de /etc/letsencrypt y el puerto 443 se
# aplican al crear el contenedor. Si se despliego antes de esos cambios, un
# simple restart no los añade.
cd "$TESIS" && docker compose up -d >/dev/null 2>&1
sleep 3
if curl -fsS --max-time 10 "http://$DOMINIO/.well-known/acme-challenge/prueba" | grep -q ok; then
  verde "  ok    el reto es accesible desde fuera"
else
  rojo  "  falla No se alcanza http://$DOMINIO/.well-known/acme-challenge/prueba"
  gris  "        Revisa que el puerto 80 este abierto en el grupo de seguridad."
  exit 1
fi

# El contenedor debe publicar el 443 antes de configurar el certificado.
if ! docker port tesis-nginx 2>/dev/null | grep -q 443; then
  rojo  "  falla El contenedor de nginx no publica el puerto 443."
  gris  "        Copia el docker-compose.yml nuevo y recrealo:"
  gris  "          bash deploy/aws/desplegar-backend.sh   (desde tu maquina)"
  exit 1
fi
verde "  ok    el contenedor publica el 443"
rm -f "$TESIS/certbot/www/.well-known/acme-challenge/prueba"

echo
echo "══ 4/6 · Pidiendo el certificado ═════════════════════════════════════"
if [[ -d "/etc/letsencrypt/live/$DOMINIO" ]]; then
  verde "  ok    ya existe un certificado para $DOMINIO"
else
  certbot certonly \
    --webroot -w "$TESIS/certbot/www" \
    -d "$DOMINIO" \
    --email "$CORREO" \
    --agree-tos --non-interactive --no-eff-email
  verde "  ok    certificado emitido"
fi

echo
echo "══ 5/6 · Configurando nginx para HTTPS ═══════════════════════════════"
cp "$TESIS/nginx.conf" "$TESIS/nginx.conf.http.bak"

cat > "$TESIS/nginx.conf" <<NGINX
# Configuracion con HTTPS, generada por configurar-https.sh.
# La version anterior quedo en nginx.conf.http.bak.

# El puerto 80 solo sirve para dos cosas: el reto de renovacion y mandar a
# todo el mundo a HTTPS.
server {
    listen 80;
    server_name $DOMINIO;
    server_tokens off;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    http2 on;
    server_name $DOMINIO;
    server_tokens off;

    ssl_certificate     /etc/letsencrypt/live/$DOMINIO/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMINIO/privkey.pem;

    # Solo TLS 1.2 y 1.3: las versiones anteriores tienen debilidades conocidas.
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Los expedientes son PDF escaneados; el backend los limita a 10 MB, asi
    # que nginx no debe cortarlos antes con su tope de 1 MB.
    client_max_body_size 12M;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # Que el navegador recuerde usar HTTPS aunque se escriba http://
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://api:8000;
        proxy_http_version 1.1;

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Generar una prediccion con SHAP tarda unos segundos, y mas aun en la
        # primera peticion, cuando ademas hay que cargar los modelos.
        proxy_connect_timeout 15s;
        proxy_send_timeout    120s;
        proxy_read_timeout    120s;
    }

    location = / {
        proxy_pass http://api:8000/;
        access_log off;
    }
}
NGINX

cd "$TESIS" && docker compose restart nginx >/dev/null 2>&1
sleep 4
verde "  ok    nginx escucha en 443"

echo
echo "══ 6/6 · Renovacion automatica ═══════════════════════════════════════"
# El certificado dura 90 dias. Este temporizador lo renueva a los 60 y recarga
# nginx solo si hubo renovacion.
cat > /etc/cron.daily/renovar-certificado-tesis <<'CRON'
#!/bin/bash
# El PATH de cron es minimo. Si certbot se instalo con pip esta en
# /usr/local/bin, que cron no mira, y la renovacion fallaria en silencio.
export PATH=/usr/local/bin:/usr/bin:/bin

# Sin --webroot: certbot recuerda como se emitio el certificado y reusa esa
# misma via. El deploy-hook solo corre si de verdad hubo renovacion.
certbot renew --quiet \
  --deploy-hook "cd /opt/tesis && docker compose restart nginx"
CRON
chmod +x /etc/cron.daily/renovar-certificado-tesis
verde "  ok    renovacion diaria instalada"

echo
echo "══ Comprobacion final ════════════════════════════════════════════════"
if curl -fsS --max-time 20 "https://$DOMINIO/" | grep -q '"status"'; then
  verde "  La API responde por HTTPS:"
  curl -s --max-time 20 "https://$DOMINIO/"
  echo
  CAD=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$DOMINIO/fullchain.pem" | cut -d= -f2)
  gris "  certificado valido hasta: $CAD"
else
  rojo "  La API no responde por HTTPS. Registros:"
  cd "$TESIS" && docker compose logs --tail 25 nginx
  exit 1
fi

cat <<SIGUIENTE

  Ya puedes compilar el frontend con la URL definitiva:

    export VITE_API_URL=https://$DOMINIO
    bash deploy/aws/desplegar-frontend.sh

  Y anade ese dominio a CORS_ORIGINS si aun no esta:

    sudo nano /opt/tesis/entorno.env
    cd /opt/tesis && sudo docker compose up -d --force-recreate api

  Tiene que ser "up -d --force-recreate", no "restart": restart vuelve a
  arrancar el proceso pero el contenedor conserva el entorno con el que se
  creo, asi que los cambios de entorno.env no le llegan. El sintoma es
  desconcertante: el archivo tiene el valor nuevo y la aplicacion sigue con
  el viejo.

SIGUIENTE
