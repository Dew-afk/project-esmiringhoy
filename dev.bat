@echo off
rem AIsmering dev: starts the ML backend (:8000) and the React client (:5173)
rem in their own windows. Close both windows to stop. Ports must be free.
start "AIsmering backend" cmd /k "cd /d "%~dp0machine learning" && python webcam_demo.py"
start "AIsmering client" cmd /k "cd /d "%~dp0client" && npm run dev"
timeout /t 4 /nobreak >nul
start http://localhost:5173
