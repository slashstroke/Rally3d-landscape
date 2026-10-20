@echo off
rem Rally 3D - Landscape edition, one-click launcher (Windows)
cd /d "%~dp0"
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8089/game/index.html"
where py >nul 2>nul
if %errorlevel%==0 (
  py serve.py 8089
) else (
  python serve.py 8089
)
