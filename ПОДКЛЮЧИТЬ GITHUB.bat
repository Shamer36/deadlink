@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Deadlink - подключение к GitHub
set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
where git >nul 2>nul
if errorlevel 1 (
  echo Git не установлен. Сейчас попробую поставить его через winget.
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  echo.
  echo Если установка прошла, закрой это окно и запусти ПОДКЛЮЧИТЬ GITHUB.bat ещё раз.
  echo Если winget не сработал, скачай Git вручную: https://git-scm.com/download/win
  pause
  exit /b
)
if exist ".git\" (
  echo Папка уже подключена к GitHub.
  git status -sb
  pause
  exit /b
)
echo Подключаю папку к https://github.com/Shamer36/deadlink ...
git init -q
git remote add origin https://github.com/Shamer36/deadlink.git
git fetch -q origin main
if errorlevel 1 (
  echo Не получилось скачать репозиторий. Проверь интернет и запусти ещё раз.
  rmdir /s /q .git
  pause
  exit /b
)
git checkout -q -f -B main origin/main
git branch -q --set-upstream-to=origin/main main
echo.
echo Готово. База, аккаунты, обложки и треки остались на месте, их в GitHub нет.
echo Теперь закрой окно сервера и запусти ЗАПУСК.bat: сайт будет сам подтягивать обновления.
pause
