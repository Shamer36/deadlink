@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Deadlink - токен tuna
echo Скопируй токен из личного кабинета tuna.am и вставь сюда (правой кнопкой мыши), потом Enter.
set /p TOK=Токен: 
tuna.exe config save-token %TOK%
echo.
echo Готово. Теперь запускай ТУННЕЛЬ.bat
pause
