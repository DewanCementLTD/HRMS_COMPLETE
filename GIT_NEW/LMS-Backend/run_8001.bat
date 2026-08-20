@echo off
REM Start the LMS FastAPI backend on port 8001 (production).
REM Uses serve.py (SelectorEventLoop fix for the WinError 64 accept bug) and
REM auto-restarts if the server process ever exits for any reason.
cd /d "%~dp0"
:loop
".venv\Scripts\python.exe" serve.py
echo [%date% %time%] Server exited with code %ERRORLEVEL% - restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop
