# YODL — Descargador web con yt-dlp

Descarga **audio (MP3)** y **video (MP4)** de varias redes sociales desde una interfaz web local. Solo pegas los enlaces, elige el tipo de descarga y el servidor se encarga del resto: detecta la red social y guarda cada archivo en su carpeta, con descargas en cola y progreso en tiempo real.

Incluye además una **extensión de Chrome** que detecta los videos visibles en la página y los descarga usando tu sesión iniciada (resuelve contenido que yt-dlp no puede extraer, como las Stories de Facebook).

## Redes sociales soportadas

| Red social | Carpeta |
|---|---|
| YouTube | `YouTube/` |
| TikTok | `TikTok/` |
| Facebook | `Facebook/` |
| Instagram | `Instagram/` |
| X (Twitter) | `X/` |

Cada red tiene subcarpetas `audio/` y `video/`.

## Características

- Pega uno o varios enlaces a la vez (uno por línea).
- Detecta automáticamente la red social del enlace.
- Descarga en cola (uno tras otro) para no saturar el servidor.
- Progreso en vivo por tarea (porcentaje, estado, error).
- Audio a MP3 y video a MP4 (hasta 1080p).
- Portable: copia la carpeta a cualquier PC y funciona.
- Accesible desde cualquier equipo de tu red local.

## Requisitos

- **Python 3.9+**
- **ffmpeg** (para convertir a MP3 y unir video+audio) — [gyan.dev/ffmpeg](https://www.gyan.dev/ffmpeg/builds/)
- **Deno 2.3+** (runtime JS que usa yt-dlp para YouTube) — [deno.com](https://deno.com)

## Instalación

### Windows (rápido)

1. Instala Python y agrégalo al PATH.
2. Haz doble clic en **`Instalar.bat`** — instala yt-dlp, deno y crea las carpetas.
3. (Recomendado) Exporta tus cookies de YouTube para evitar bloqueos anti-bot (ver abajo).
4. Haz doble clic en **`Iniciar.bat`**.

### Manual

```bash
pip install -U "yt-dlp[default]"
# instala deno: https://docs.deno.com/runtime/getting_started/installation/
python servidor.py 8080
```

## Uso

1. Ejecuta `Iniciar.bat` (o `python servidor.py [puerto]`, por defecto `8080`).
2. Abre en el navegador: `http://127.0.0.1:8080`
3. Pega los enlaces (uno por línea), elige **Solo audio (MP3)** o **Solo video (MP4)** y haz clic en **Agregar a la cola**.
4. Los archivos aparecen en las carpetas de su red social.

Desde otra PC de la misma red puedes usar `http://IP_DE_ESTA_PC:8080` (el servidor muestra la IP al arrancar).

## Extensión de Chrome

Para contenido que solo es visible dentro de tu sesión (por ejemplo **Stories de Facebook**, que expiran y requieren login), la extensión `extension/` detecta el video en la página y lo descarga con tus cookies.

**Instalación:**
1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (esquina superior derecha).
3. Clic en **Cargar descomprimida** y selecciona la carpeta `extension/` del proyecto.
4. Ve a la página con el video (la historia Facebook, un reel, etc.) y ábrela para que se reproduzca.
5. Clic en el icono de YODL → verás los videos detectados:
   - **Descargar MP4**: lo baja directo a tu carpeta de Descargas con tu sesión.
   - **Enviar MP3 a YODL**: lo agrega a la cola del servidor (necesita el servidor iniciado).

> Nota: la extensión solo detecta videos con URL directa (`<video src>`). Si el video usa `blob:`/DRM no aparecerá.

## Cookies de YouTube (recomendado)

YouTube a veces bloquea descargas sin sesión con *"Sign in to confirm you're not a bot"*. Para evitarlo:

1. En Chrome, instala la extensión **Get cookies.txt LOCALLY**.
2. Entra a `youtube.com` con tu sesión iniciada.
3. Haz clic en la extensión → **Export**, y guarda el archivo como `cookies.txt`.
4. Colócalo en la raíz del proyecto (junto a `servidor.py`).

> **Importante:** `cookies.txt` contiene tus tokens de sesión.
> Está en `.gitignore` — **nunca lo subas a GitHub**.

## Configuración

Puedes cambiar el navegador que usa el servidor para leer cookies con la variable de entorno `YODL_NAVEGADOR` (valores: `auto`, `chrome`, `edge`, `firefox`, etc., o `ninguno`). Por defecto `auto`.

## Estructura del proyecto

```
YODL/
├── servidor.py        # Servidor HTTP local + cola de descargas
├── index.html         # Interfaz web
├── Iniciar.bat        # Arranca el servidor (Windows)
├── Instalar.bat       # Instala dependencias (Windows)
├── cookies.txt        # (opcional, NO subir a GitHub)
├── .gitignore
├── Facebook/          # audio/ y video/
├── YouTube/
├── TikTok/
├── Instagram/
└── X/
```

## Endpoints de la API

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Interfaz web |
| `GET` | `/api/estado` | Estado de la cola y trabajos |
| `GET` | `/api/redes` | Lista de redes soportadas |
| `POST` | `/api/descargar` | Agrega `{url, tipo: "audio"\|"video"}` a la cola |

## Aviso legal

Este proyecto usa **yt-dlp**, una herramienta de código abierto para descargar contenido multimedia de sitios públicos. Respeta siempre los términos de servicio de cada plataforma y las leyes de derechos de autor aplicables. Descarga únicamente contenido que tengas derecho a descargar.

## Licencia

[MIT](LICENSE)