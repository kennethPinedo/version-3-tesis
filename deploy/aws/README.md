# Despliegue en AWS — EC2 + RDS + S3/CloudFront

Manual completo para poner el sistema en AWS siguiendo la capa de tecnología de
la tesis. Está pensado para seguirse de arriba abajo, sin saltarse pasos.

> **Antes de empezar: esto cuesta dinero.** Tu cuenta ya no tiene capa gratuita,
> así que se factura desde la primera hora. Lee la sección de costes.

El orden importa en dos puntos, y los dos suelen costar un despliegue repetido:

- **Los datos antes del frontend** (fase 7 antes de la 9): si la base de RDS
  está vacía, lo que ves en la interfaz no distingue un fallo de conexión de una
  base sin alumnos.
- **El HTTPS antes del frontend** (fase 8 antes de la 9): la URL de la API se
  compila dentro del JavaScript. Si la compilas en `http://` y luego pones el
  certificado, hay que compilar y subir otra vez.

---

## 1. Costes reales

Precios de la región `us-east-1`, funcionando 24 h al día durante un mes
completo. Tipo de cambio aproximado: 1 USD ≈ S/ 3,75.

| Recurso | Configuración | USD/mes | S//mes |
|---|---|---:|---:|
| EC2 servidor de aplicaciones | t3.small (2 vCPU, 2 GB) | 15,18 | 57 |
| Disco del servidor | 20 GB gp3 | 1,60 | 6 |
| RDS PostgreSQL | db.t4g.micro | 12,41 | 47 |
| Almacenamiento de la base | 20 GB gp3 | 2,30 | 9 |
| IP fija | asociada a una instancia encendida | 0,00 | 0 |
| S3 | menos de 1 GB | 0,10 | 0 |
| CloudFront | tráfico de una tesis | 0,50 | 2 |
| **Total** | | **≈ 32** | **≈ 120** |

### Cómo gastar bastante menos

**Apaga lo que no uses.** Una instancia detenida no se factura (el disco sí,
~1,60 USD/mes). Si solo la necesitas para la defensa y algunas pruebas:

```bash
aws ec2 stop-instances  --instance-ids i-xxxxxxxx    # deja de cobrar el cómputo
aws rds  stop-db-instance --db-instance-identifier tesis-tdah-postgres
aws ec2 start-instances --instance-ids i-xxxxxxxx    # cuando lo necesites
```

> RDS se vuelve a encender solo a los 7 días, aunque no hagas nada. Es un límite
> de AWS, no un fallo.

Encendido solo 4 horas al día: **≈ 9 USD/mes (S/ 34)**.

**Si `t3.micro` te sirve**, bajas unos 7,60 USD/mes más. El riesgo es real: las
librerías de predicción (`xgboost`, `shap`, `scipy`) ocupan varios cientos de MB
y en 1 GB de memoria el servicio queda al límite. La plantilla crea un archivo
de intercambio de 2 GB que lo salva, a costa de lentitud. **Recomendación:
empieza en `t3.small`; si ves que va sobrado, cámbialo luego.**

### Alerta de facturación — hazlo primero

La plantilla crea una alarma que avisa al superar 40 USD, pero necesita que
actives las alertas de facturación **a mano y antes**:

1. Consola AWS → tu nombre (arriba a la derecha) → **Billing and Cost Management**
2. **Billing preferences** → marcar **Receive CloudWatch billing alerts**
3. Guardar. Solo funciona en la región **us-east-1**.

---

## 2. Qué se va a crear

```
                    ┌─────────────── AWS Cloud ────────────────────┐
  Navegador         │                                              │
      │             │   ┌────────────┐      ┌──────────────────┐   │
      ├─ interfaz ──┼──▶│ CloudFront │─────▶│ S3 (React build) │   │
      │             │   └────────────┘      └──────────────────┘   │
      │             │                                              │
      │             │   ┌──────────────── EC2 t3.small ────────┐   │
      └─ API ───────┼──▶│  nginx :80  ──▶  FastAPI :8000       │   │
                    │   │                  (Docker)            │   │
                    │   └───────────┬──────────────┬───────────┘   │
                    │               │              │               │
                    │               ▼              ▼               │
                    │   ┌────────────────────┐  ┌──────────────┐   │
                    │   │ RDS PostgreSQL     │  │ S3 expedien- │   │
                    │   │ (sin IP pública)   │  │ tes (PDF)    │   │
                    │   └────────────────────┘  └──────────────┘   │
                    └──────────────────────────────────────────────┘
```

**Decisiones de seguridad que ya vienen tomadas:**

- La base de datos **no tiene IP pública**. Solo acepta conexiones desde el
  grupo de seguridad del servidor de aplicaciones.
- Los buckets de S3 bloquean todo acceso público. CloudFront llega al del
  frontend mediante OAC; nadie más.
- Disco y base de datos **cifrados en reposo**.
- La base y el bucket de expedientes llevan `DeletionPolicy: Retain`: **no se
  borran aunque elimines la pila**.
- El contenedor no corre como root.

---

## 3. Requisitos previos

| Qué | Cómo comprobarlo |
|---|---|
| AWS CLI configurado | `aws sts get-caller-identity` |
| Docker en tu máquina | `docker --version` |
| Un par de claves SSH | Lo crea el script; no hay que hacer nada |
| Tu IP pública | `curl -s https://checkip.amazonaws.com` |
| Un subdominio para la API | Gratis en [duckdns.org](https://www.duckdns.org); se usa en la fase 8 |

> **Usa un usuario IAM, no la cuenta raíz.** Si solo tienes la raíz, crea un
> usuario con la política `AdministratorAccess` y configura la CLI con él.

---

## 4. Crear la infraestructura

### Camino corto (recomendado)

```bash
bash deploy/aws/crear-infraestructura.sh
```

Comprueba los requisitos, descubre la VPC y las subredes por su cuenta, crea el
par de claves SSH si no existe, restringe el acceso a tu IP, genera la
contraseña de la base, **te muestra lo que vas a pagar y pide confirmación**
antes de crear nada. Si la pila ya existe, lo dice y no la duplica.

### Si AWS no ha verificado tu cuenta para CloudFront

En cuentas nuevas, AWS bloquea CloudFront hasta revisarlas a mano. El error solo
aparece **al crear la distribución**, a los ocho minutos, y tumba la pila entera:

```
Your account must be verified before you can add new CloudFront resources.
```

El script lo detecta **antes** de empezar y, si está bloqueado, crea la pila sin
el frontend estático. Servidor, base de datos y expedientes se crean con
normalidad, y las fases 5 a 8 funcionan igual. Solo queda pendiente la 9.

Para desbloquearlo: **Support → Create case → Account and billing** (gratis en el
plan Basic), servicio `Account`, y pega el mensaje de error con tu ID de cuenta.
Suelen tardar entre unas horas y 48 h.

Cuando respondan:

```bash
bash deploy/aws/anadir-cloudfront.sh
```

Comprueba que la verificación esté concedida y **actualiza** la pila añadiendo
solo los cuatro recursos que faltan. No recrea la instancia, ni la base, ni los
expedientes. Si algo falla, CloudFormation revierte y lo que ya funcionaba sigue
en pie.

Para forzar una u otra opción a mano:

```bash
CREAR_CLOUDFRONT=no bash deploy/aws/crear-infraestructura.sh
```

### Camino manual

Si prefieres controlar cada parámetro, desde la raíz del repositorio:

```bash
aws cloudformation create-stack \
  --stack-name tesis-tdah \
  --template-body file://deploy/aws/infraestructura.yaml \
  --capabilities CAPABILITY_IAM \
  --parameters \
      ParameterKey=VpcId,ParameterValue=vpc-xxxxxxxx \
      ParameterKey=SubnetIds,ParameterValue=\"subnet-aaaa,subnet-bbbb\" \
      ParameterKey=ClaveSSH,ParameterValue=tesis-tdah \
      ParameterKey=IpAdministracion,ParameterValue=$(curl -s https://checkip.amazonaws.com)/32 \
      ParameterKey=ClaveBD,ParameterValue='PonAquiUnaClaveLarga123'
```

Para obtener la VPC y las subredes:

```bash
aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text

aws ec2 describe-subnets --filters Name=vpc-id,Values=vpc-xxxxxxxx \
  --query 'Subnets[*].[SubnetId,AvailabilityZone]' --output table
```

Elige **dos subredes de zonas distintas**: RDS lo exige.

Tarda **10-15 minutos**, casi todo esperando a la base de datos:

```bash
aws cloudformation wait stack-create-complete --stack-name tesis-tdah
aws cloudformation describe-stacks --stack-name tesis-tdah \
  --query 'Stacks[0].Outputs' --output table
```

Apunta las salidas: las necesitas en todos los pasos siguientes.

---

## 5. Configurar las variables del servidor

Entra por SSH y completa el archivo de entorno:

```bash
ssh -i tesis-tdah.pem ec2-user@<IpServidor>
sudo nano /opt/tesis/entorno.env
```

```ini
DATABASE_URL=postgresql://tesisadmin:TU_CLAVE@<EndpointBaseDatos>:5432/estudiantes
CORS_ORIGINS=https://<dominio de CloudFront>
# En la fase 8 se añade aquí también el subdominio de la API, separado por coma.
DOCUMENTO_KEY=<la misma que en tu .env local>
DOCUMENTO_PEPPER=<la misma que en tu .env local>
```

> **Las claves de cifrado tienen que ser LAS MISMAS que las de tu `.env`
> actual.** Si generas otras nuevas, los documentos de identidad ya guardados
> **no se podrán descifrar nunca más**. Cópialas de
> `backend_fastapi/.env`.

---

## 6. Desplegar el backend

Desde tu máquina, en la raíz del repositorio:

```bash
export IP_SERVIDOR=<IpServidor>
export CLAVE_SSH=~/.ssh/tesis-tdah.pem
bash deploy/aws/desplegar-backend.sh
```

Construye la imagen localmente, comprueba que `xgboost` y `shap` cargan, la
envía por SSH y levanta los contenedores. Son unos 900 MB: tarda.

Al terminar, `http://<IpServidor>/` debe responder:

```json
{"status":"ok","message":"Tesis API corriendo con FastAPI"}
```

---

## 7. Migrar los datos de Neon a RDS

> **Este es el paso delicado.** El script **no borra nada en Neon** y guarda una
> copia completa antes de tocar RDS. Aun así, no elimines nada en Neon hasta
> haber probado la aplicación entera contra RDS.

```bash
scp -i tesis-tdah.pem deploy/aws/migrar-neon-a-rds.sh ec2-user@<IpServidor>:/tmp/
ssh -i tesis-tdah.pem ec2-user@<IpServidor>

export URL_NEON='<la cadena de tu .env actual>'
export URL_RDS='postgresql://tesisadmin:TU_CLAVE@<EndpointBaseDatos>:5432/estudiantes'
bash /tmp/migrar-neon-a-rds.sh
```

Cuenta las filas antes y después y **compara las cifras**. Si no coinciden, se
detiene y te dice qué falta, sin haber tocado Neon.

Referencia de lo que debe migrar (a 17 de septiembre de 2026):

| Tabla | Filas |
|---|---:|
| alumnos | 35 |
| notas | 291 |
| encuestas | 28 |
| predicciones | 49 |
| usuarios | 3 |

Después, reinicia el backend para que use la base nueva:

```bash
cd /opt/tesis && sudo docker compose up -d --force-recreate api
```

---

## 8. Poner HTTPS en la API

**Este paso va antes del frontend, no después.** CloudFront sirve la interfaz
por HTTPS, y el navegador bloquea que una página HTTPS llame a una API por
HTTP: es la regla del *contenido mixto*. Si compilas el frontend apuntando a
`http://<IpServidor>`, la aplicación se abrirá pero ninguna petición saldrá, y
tendrás que repetir la fase del frontend entera. Con el backend ya en marcha,
este es el momento en que conoces la URL definitiva de la API.

### 8.1 Un subdominio que apunte a la instancia

Let's Encrypt no emite certificados para una IP, así que hace falta un nombre.
Si no tienes dominio propio, [duckdns.org](https://www.duckdns.org) da uno
gratis en dos minutos: inicias sesión con Google o GitHub, escribes un nombre
(por ejemplo `tesis-tdah`) y pones la IP pública de la instancia.

Queda un dominio del tipo `tesis-tdah.duckdns.org`. **No necesitas el token de
DuckDNS**: la validación de Let's Encrypt es por HTTP, no por DNS — basta con
que el nombre resuelva a la IP.

> Usa la **IP elástica** de la pila, no la IP temporal de la instancia. La
> plantilla ya crea una precisamente para que el certificado no se rompa al
> reiniciar.

Comprueba que el DNS ya se propagó:

```bash
nslookup tesis-tdah.duckdns.org        # debe devolver la IP elástica
```

### 8.2 Ejecutar el script en la instancia

```bash
scp -i tesis-tdah.pem deploy/aws/configurar-https.sh ec2-user@<IpServidor>:/tmp/
ssh -i tesis-tdah.pem ec2-user@<IpServidor>
sudo bash /tmp/configurar-https.sh tesis-tdah.duckdns.org tu-correo@ejemplo.com
```

Qué hace, en orden: comprueba que el dominio apunte de verdad aquí, instala
certbot, deja un archivo de prueba y verifica que se alcanza desde fuera, pide
el certificado, reescribe `nginx.conf` para el puerto 443 (guardando el
anterior en `nginx.conf.http.bak`), reinicia nginx e instala la renovación
automática. Si algo falla, se detiene antes de tocar la configuración que ya
funcionaba.

El certificado dura 90 días y se renueva solo a los 60, mediante
`/etc/cron.daily/renovar-certificado-tesis`.

### 8.3 Añadir el dominio a CORS

El backend solo acepta peticiones de los orígenes que tenga declarados:

```bash
sudo nano /opt/tesis/entorno.env
# CORS_ORIGINS=https://<dominio CloudFront>,https://tesis-tdah.duckdns.org
cd /opt/tesis && sudo docker compose up -d --force-recreate api
```

Comprobación:

```bash
curl https://tesis-tdah.duckdns.org/          # {"status":"ok", ...}
curl -I http://tesis-tdah.duckdns.org/        # 301 hacia https
```

> **Si no quieres subdominio**, la alternativa es poner CloudFront delante de
> la API también, con un segundo *origin* apuntando a la IP: CloudFront ofrece
> HTTPS al usuario y habla HTTP con la instancia. No está en la plantilla
> porque obliga a decidir el reparto de rutas entre los dos *origins*.

---

## 9. Desplegar el frontend

```bash
export BUCKET_FRONTEND=<BucketFrontendNombre>
export ID_DISTRIBUCION=<IdDistribucion>
export VITE_API_URL=https://tesis-tdah.duckdns.org   # SIN «/api» al final
bash deploy/aws/desplegar-frontend.sh
```

> **`VITE_API_URL` no lleva `/api`.** El cliente lo añade por su cuenta
> (`frontend/src/lib/api.js`). Si lo pones, las peticiones irán a `/api/api` y
> devolverán 404. El script lo rechaza si te equivocas.

> La URL queda **compilada dentro** del JavaScript. Cambiarla más adelante
> obliga a volver a ejecutar este script; no es una variable de entorno que el
> navegador lea al arrancar.

---

## 10. Comprobar que todo funciona

```bash
curl https://tesis-tdah.duckdns.org/                   # la API responde
curl -I https://<dominio CloudFront>                   # la interfaz se sirve
curl -s -X POST https://tesis-tdah.duckdns.org/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"usuario":"admin","password":"..."}'            # la base responde
```

Y en el navegador: entrar, abrir el Dashboard General, generar una predicción
y descargar un expediente.

---

## 11. Apagar todo

```bash
# Parar sin destruir (deja de cobrar el cómputo, conserva los datos)
aws ec2 stop-instances --instance-ids <id>
aws rds stop-db-instance --db-instance-identifier tesis-tdah-postgres

# Eliminar la pila. La base de datos y el bucket de expedientes SOBREVIVEN
# (DeletionPolicy: Retain) y hay que borrarlos a mano si de verdad los quieres
# fuera. Es deliberado: son los datos de la tesis.
aws cloudformation delete-stack --stack-name tesis-tdah
```

---

## Archivos de esta carpeta

| Archivo | Para qué |
|---|---|
| `crear-infraestructura.sh` | Crea toda la pila: comprueba, avisa del coste y ejecuta |
| `infraestructura.yaml` | Define los 15 recursos de AWS |
| `Dockerfile` | Imagen del backend (construir desde la raíz del repo) |
| `docker-compose.yml` | Cómo corren nginx y la API en la instancia |
| `nginx.conf` | Proxy inverso, límites de subida y cabeceras |
| `desplegar-backend.sh` | Construye, envía y levanta el backend |
| `configurar-https.sh` | Pide el certificado de Let's Encrypt y pasa nginx a 443 |
| `anadir-cloudfront.sh` | Añade el frontend a una pila creada sin CloudFront |
| `desplegar-frontend.sh` | Compila React, sube a S3 e invalida la caché |
| `migrar-neon-a-rds.sh` | Copia los datos, comparando filas antes y después |
