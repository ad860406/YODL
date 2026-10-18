#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Servidor local de descargas con yt-dlp.

Portable: requiere Python 3 + yt-dlp (+ ffmpeg para MP3/mp4).
Uso:  python servidor.py [puerto]
"""
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import yt_dlp
except ImportError:
    print("ERROR: falta yt-dlp. Ejecuta:  pip install -U yt-dlp")
    sys.exit(1)

BASE = os.path.dirname(os.path.abspath(__file__))

# Localizar deno (runtime JS de yt-dlp) aunque no este en el PATH del sistema
def _agregar_deno_al_path():
    import shutil
    if shutil.which("deno"):
        return
    candidatos = [
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages"),
        r"C:\Program Files\deno",
    ]
    for d in candidatos:
        if os.path.isdir(d):
            for raiz, _, archivos in os.walk(d):
                if "deno.exe" in archivos:
                    os.environ["PATH"] = raiz + os.pathsep + os.environ.get("PATH", "")
                    return


def _ruta_deno():
    """Devuelve la ruta del ejecutable de deno, o None si no existe."""
    import shutil
    p = shutil.which("deno")
    if p:
        return p
    candidatos = [
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages"),
        r"C:\Program Files\deno",
    ]
    for d in candidatos:
        if os.path.isdir(d):
            for raiz, _, archivos in os.walk(d):
                if "deno.exe" in archivos:
                    return os.path.join(raiz, "deno.exe")
    return None


_agregar_deno_al_path()

NETWORKS = ["Facebook", "YouTube", "TikTok", "Instagram", "X"]

NAVEGADORES = ["chrome", "edge", "brave", "firefox", "opera", "vivaldi"]

# Navegador a usar para cookies (ayuda con el bloqueo anti-bot de YouTube).
# Cambia aqui o con la variable de entorno YODL_NAVEGADOR, o "ninguno" para desactivarlo.
NAVEGADOR = os.environ.get("YODL_NAVEGADOR", "").strip().lower() or "auto"

PATTERNS = [
    ("YouTube", re.compile(r"(youtube\.com|youtu\.be)", re.I)),
    ("TikTok", re.compile(r"(tiktok\.com|vm\.tiktok)", re.I)),
    ("Facebook", re.compile(r"(facebook\.com|fb\.watch)", re.I)),
    ("Instagram", re.compile(r"(instagram\.com|instagr\.am)", re.I)),
    ("X", re.compile(r"(x\.com|twitter\.com)", re.I)),
]


def detectar_red(url):
    for nombre, patron in PATTERNS:
        if patron.search(url):
            return nombre
    return "Otros"


def folder_red(nombre):
    d = os.path.join(BASE, nombre)
    os.makedirs(d, exist_ok=True)
    return d


def navegador_usable():
    """Devuelve un navegador con cookies disponibles, o None."""
    if NAVEGADOR == "ninguno":
        return None
    candidatos = NAVEGADORES if NAVEGADOR == "auto" else [NAVEGADOR]
    for br in candidatos:
        try:
            yt_dlp.cookies.load_cookies(
                None, (br, None, None, None), ydl=yt_dlp.YoutubeDL({"quiet": True}))
            return br
        except Exception:
            continue
    return None


class Cola:
    def __init__(self):
        self.lock = threading.Lock()
        self.cond = threading.Condition(self.lock)
        self.jobs = {}
        self.pendientes = []
        self.orden = 0
        self.actual = None
        self._worker = threading.Thread(target=self._loop, daemon=True)
        self._worker.start()

    def agregar(self, url, tipo):
        with self.lock:
            self.orden += 1
            jid = self.orden
            red = detectar_red(url)
            self.jobs[jid] = {
                "id": jid,
                "url": url,
                "tipo": tipo,
                "red": red,
                "estado": "en_cola",
                "progreso": 0.0,
                "mensaje": "En cola",
                "archivo": "",
                "error": "",
            }
            self.pendientes.append(jid)
            self.cond.notify_all()
            return jid

    def _loop(self):
        while True:
            with self.cond:
                while not self.pendientes:
                    self.cond.wait()
                jid = self.pendientes.pop(0)
                self.actual = jid
            self._procesar(jid)
            with self.cond:
                self.actual = None

    def _procesar(self, jid):
        job = self.jobs[jid]
        job["estado"] = "descargando"
        job["mensaje"] = "Descargando..."
        sub = os.path.join(folder_red(job["red"]), job["tipo"])
        os.makedirs(sub, exist_ok=True)

        opts = {
            "outtmpl": os.path.join(sub, "%(title)s.%(ext)s"),
            "noplaylist": True,
            "progress_hooks": [lambda d: self._hook(d, jid)],
            "restrictfilenames": False,
            "windowsfilenames": True,
            "quiet": True,
            "no_warnings": True,
        }

        br = navegador_usable()
        if br:
            opts["cookiesfrombrowser"] = (br, None, None, None)
        archivo_cookies = os.path.join(BASE, "cookies.txt")
        if os.path.exists(archivo_cookies):
            opts["cookiefile"] = archivo_cookies
        ruta_deno = _ruta_deno()
        if ruta_deno:
            opts["js_runtimes"] = {"deno": {"path": ruta_deno}}

        if job["tipo"] == "audio":
            opts.update({
                "format": "bestaudio/best",
                "extractaudio": True,
                "audioformat": "mp3",
                "audioquality": 0,
                "postprocessor_args": ["-id3v2_version", "3"],
            })
        else:
            opts.update({
                "format": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "merge_output_format": "mp4",
            })

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(job["url"], download=True)
                titulo = info.get("title", "")
                ext = info.get("ext", job["tipo"])
                if job["tipo"] == "audio":
                    ext = "mp3"
                job["archivo"] = os.path.join(sub, f"{titulo}.{ext}")
                job["estado"] = "completado"
                job["progreso"] = 100.0
                job["mensaje"] = "Completado"
        except Exception as e:
            job["estado"] = "error"
            job["error"] = str(e)
            job["mensaje"] = "Error"

    def _hook(self, d, jid):
        job = self.jobs.get(jid)
        if not job:
            return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                job["progreso"] = round(done / total * 100, 1)
            job["mensaje"] = "Descargando: %s" % (d.get("_percent_str", "").strip() or "0%")
        elif d.get("status") == "finished":
            job["progreso"] = 100.0
            job["mensaje"] = "Procesando (convirtiendo)..."

    def estado(self):
        with self.lock:
            lista = [self.jobs[j] for j in sorted(self.jobs)]
            return {
                "actual": self.actual,
                "trabajos": lista,
            }


COLA = Cola()


class Handler(BaseHTTPRequestHandler):
    server_version = "YODL/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            p = os.path.join(BASE, "index.html")
            if os.path.exists(p):
                with open(p, "rb") as f:
                    self._send(200, f.read(), "text/html; charset=utf-8")
            else:
                self._send(404, "index.html no encontrado", "text/plain; charset=utf-8")
        elif parsed.path == "/api/estado":
            self._send(200, json.dumps(COLA.estado(), ensure_ascii=False))
        elif parsed.path == "/api/redes":
            self._send(200, json.dumps({"redes": NETWORKS}, ensure_ascii=False))
        else:
            self._send(404, "no encontrado", "text/plain; charset=utf-8")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/descargar":
            self._send(404, "no encontrado", "text/plain; charset=utf-8")
            return
        largo = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(largo) if largo else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send(400, json.dumps({"error": "JSON invalido"}))
            return
        url = (data.get("url") or "").strip()
        tipo = (data.get("tipo") or "audio").strip().lower()
        if not url:
            self._send(400, json.dumps({"error": "Falta el enlace"}))
            return
        if tipo not in ("audio", "video"):
            tipo = "audio"
        jid = COLA.agregar(url, tipo)
        self._send(200, json.dumps({"id": jid, "red": detectar_red(url), "tipo": tipo}, ensure_ascii=False))


def ip_local():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    for nombre in NETWORKS:
        folder_red(nombre)
    server = ThreadingHTTPServer(("0.0.0.0", puerto), Handler)
    print("=" * 52)
    print("  YODL - Descargas con yt-dlp")
    print(f"  Local:     http://127.0.0.1:{puerto}")
    print(f"  En tu red: http://{ip_local()}:{puerto}")
    print("  (Ctrl+C para detener)")
    print("=" * 52)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDetenido.")


if __name__ == "__main__":
    main()
