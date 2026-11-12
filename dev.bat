@echo off
rem AIsmering dev: starts the ML backend (:8000) and the React frontend (:5173)
rem in their own windows. Close both windows to stop. Ports must be free.
start "AIsmering ML backend" cmd /k "cd /d "%~dp0ml" && python webcam_demo.py"
start "AIsmering backend" cmd /k "cd /d "%~dp0backend" && uvicorn main:app --port 8001"
start "AIsmering frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"
timeout /t 4 /nobreak >nul
start http://localhost:5173
