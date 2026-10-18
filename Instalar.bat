@echo off
chcp 65001 >nul
title YODL - Instalador
echo ============================================
echo   YODL - Instalacion (Python + yt-dlp + ffmpeg)
echo ============================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Python no esta instalado o no esta en el PATH.
  echo Descargalo de: https://www.python.org/downloads/
  echo Marca la casilla "Add Python to PATH" durante la instalacion.
  pause
  exit /b 1
)

echo [1/4] Instalando/actualizando yt-dlp (con extras necesarios)...
python -m pip install -U "yt-dlp[default]"

echo.
echo [2/4] Instalando deno (runtime JS para YouTube)...
where deno >nul 2>nul
if %errorlevel% equ 0 (
  echo       deno ya esta instalado.
) else (
  winget install --id DenoLand.Deno --accept-source-agreements --accept-package-agreements
)

echo.
echo [3/4] Verificando ffmpeg...
where ffmpeg >nul 2>nul
if %errorlevel% equ 0 (
  echo       ffmpeg ya esta instalado.
) else (
  echo       ffmpeg NO esta instalado.
  echo       Se necesita para convertir a MP3 y unir video+audio en MP4.
  echo       Descargalo: https://www.gyan.dev/ffmpeg/builds/
  echo       (version "ffmpeg-release-essentials.zip") y agrega la carpeta bin a PATH.
)

echo.
echo [4/4] Creando carpetas...
if not exist "Facebook" mkdir "Facebook"
if not exist "YouTube" mkdir "YouTube"
if not exist "TikTok" mkdir "TikTok"
if not exist "Instagram" mkdir "Instagram"
if not exist "X" mkdir "X"

echo.
echo COOKIES (opcional pero recomendado para evitar bloqueos de YouTube):
echo   1. En Chrome instala "Get cookies.txt LOCALLY" y exporta cookies desde youtube.com
echo   2. Guarda el archivo como "cookies.txt" dentro de esta carpeta.
echo.
echo Instalacion terminada. Ejecuta Iniciar.bat para arrancar el servidor.
pause
