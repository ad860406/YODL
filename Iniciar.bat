@echo off
chcp 65001 >nul
title YODL - Servidor
cd /d "%~dp0"
python servidor.py
pause
