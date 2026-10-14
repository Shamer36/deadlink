@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Deadlink - туннель
echo Сначала должен быть запущен ЗАПУСК.bat (сервер сайта).
echo Ниже появится адрес вида https://candid-fox-2104.ru.tuna.am - открой его на телефоне.
echo Закроешь это окно - адрес перестанет работать.
echo.
if exist tuna.exe (
  tuna.exe http 8000 --subdomain=candid-fox-2104
) else (
  echo Не нашёл tuna.exe в папке DEADLINK.
)
echo.
pause
