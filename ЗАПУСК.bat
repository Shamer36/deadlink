@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY="%%D\python.exe""
if not defined PY for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" set "PY="%%D\python.exe""
if not defined PY for /f "delims=" %%P in ('where python 2^>nul ^| findstr /v /i "WindowsApps"') do if not defined PY set "PY="%%P""
if not defined PY (
  echo Python не найден. Установи его с https://www.python.org/downloads/ и поставь галочку "Add python.exe to PATH".
  echo Python not found > "log.txt"
  pause
  exit /b
)
echo PY=%PY% > "log.txt"
:run
if exist ".git\" (
  where git >nul 2>nul && (
    echo Проверяю обновления на GitHub...
    git pull --ff-only -q origin main 2>> "log.txt"
  )
)
echo Запускаю: %PY%
%PY% server.py 2>> "log.txt"
if errorlevel 3 if not errorlevel 4 (
  set "DL_NOBROWSER=1"
  echo.
  goto run
)
echo.
echo Сервер остановился. Если что-то пошло не так, причина записана в log.txt
pause
