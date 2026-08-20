@echo off
REM Direct launcher for face service - NO activate.bat overhead
REM This calls Python directly with the correct path

cd /d "%~dp0"

REM Set the correct Python path - FULL PATH, NO activate script
set PYTHON_EXE=c:\ERP_SYSTEMS\HRMS_LMS_APP\GIT_NEW\LMS-Backend\.venv\Scripts\python.exe

REM Verify Python exists
if not exist "%PYTHON_EXE%" (
    echo ERROR: Python not found at:
    echo %PYTHON_EXE%
    pause
    exit /b 1
)

REM Run uvicorn directly with Python
"%PYTHON_EXE%" -m uvicorn api:app --host 0.0.0.0 --port 8002 --reload

pause
