@echo off
echo ============================================================
echo  LMS Backend Launcher (FastAPI + Face + CV Watcher)
echo ============================================================
echo.

:: -- Step 0: Locate the deployment and set paths ---
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "DATA_ROOT=C:\Software\HRMS_LMS_APP"
set "VENV=%ROOT%\LMS-Backend\.venv"
set "EMP_DOCS_ROOT=%DATA_ROOT%\EMP_DOCS"
set "COMP_LOGO_ROOT=%DATA_ROOT%\COMP_LOGO"

echo Deployment root: %ROOT%
echo Data root:       %DATA_ROOT%
echo.

:: -- Step 1: Kill the backend auto-restart loop FIRST ---
echo [1/4] Stopping old processes...
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run_8001' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing restart-loop PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'serve\.py' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing serve.py PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 2: Kill anything holding ports 8001, 8002 ---
echo [2/4] Stopping existing processes on ports 8001, 8002...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8001 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8001
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8002 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8002
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 3: Kill CV watcher ---
echo [3/4] Stopping existing CV watcher (if any)...
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'cv_watcher\.py' -and $_.CommandLine -notmatch 'powershell' }).ProcessId"') do (
    echo     Killing CV watcher PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: -- Step 4: Wait for ports to clear ---
echo [4/4] Waiting 3 seconds for ports to clear...
timeout /t 3 /nobreak >nul

:: -- Preflight check ---
if not exist "%VENV%\Scripts\python.exe" (
    echo.
    echo   [MISSING] Python venv: %VENV%
    echo             Create it:  C:\Python310\python.exe -m venv "%VENV%"
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Starting Backend Services Only
echo ============================================================
echo.

:: -- LMS Backend (FastAPI, port 8001) ---
echo Starting LMS Backend on port 8001...
start "LMS Backend" cmd /k "cd /d %ROOT%\LMS-Backend && call %ROOT%\LMS-Backend\run_8001.bat"

:: -- CV Recruitment Watcher ---
echo Starting CV Recruitment Watcher (AI screening)...
start "CV Watcher" cmd /k "cd /d %ROOT%\LMS-Backend\AI && call %VENV%\Scripts\activate.bat && python cv_watcher.py"

:: -- Face Recognition Backend (FastAPI, port 8002) ---
:: Use direct Python call instead of activate.bat to avoid path confusion
echo Starting Face Backend on port 8002...
start "Face Backend" cmd /k "cd /d %ROOT%\LMS-Face-Backend\face_rec && %VENV%\Scripts\python.exe -m uvicorn api:app --host 0.0.0.0 --port 8002"

echo.
echo All backend services started in separate windows.
echo.
echo  FastAPI Backend: http://localhost:8001 - API docs at /docs
echo  Face API:       http://localhost:8002
echo  CV Watcher:     (no port) - See "CV Watcher" window for logs
echo.
pause
