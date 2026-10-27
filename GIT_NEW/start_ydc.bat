@echo off
echo ============================================================
echo  LMS Server Launcher - YDC tenant (hrms.d-tech.com.pk)
echo ============================================================
echo.

:: Second copy of the backends for the YDC company, on the SAME code as
:: start_all.bat but pointed at Oracle schema HRMS_YDC:
::   Node backend  -> port 8013  (Node-LMS-Backend\.env.ydc)
::   Face backend  -> port 8012  (own FAISS index, built from HRMS_YDC)
:: The Next.js frontend (port 3000) is shared. Apache's hrms.d-tech.com.pk
:: vhost sends /api/* straight to 8013, so the frontend's own /api rewrite
:: (-> 8003, schema HRMS) is never used for that domain.
:: hrms.sysnovix.com is untouched and keeps running from start_all.bat.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "VENV=%ROOT%\LMS-Backend\.venv"

echo [1/2] Stopping existing YDC processes on ports 8012, 8013...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8012 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8012
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8013 " ^| findstr "LISTENING"') do (
    echo     Killing PID %%a on port 8013
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 3 /nobreak >nul

echo [2/2] Starting YDC servers...

:: dotenv/config honours DOTENV_CONFIG_PATH, so the Node backend reads
:: .env.ydc instead of .env without any code change.
start "YDC Backend (Node 8013)" cmd /k "cd /d %ROOT%\Node-LMS-Backend && set DOTENV_CONFIG_PATH=.env.ydc&& npm start"

:: face_login.py loads DB_* from the env file named by FACE_ENV_FILE
:: (LMS-Face-Backend\face_rec\.env.ydc -> schema HRMS_YDC). Without it the
:: service would load .env, the sysnovix schema.
start "YDC Face Backend (8012)" cmd /k "cd /d %ROOT%\LMS-Face-Backend\face_rec && set FACE_ENV_FILE=.env.ydc&& set FACE_DET_SIZE=320&& %VENV%\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8012"

echo.
echo  YDC Node Backend: http://localhost:8013  (schema HRMS_YDC)
echo  YDC Face API:     http://localhost:8012
echo  Public URL:       https://hrms.d-tech.com.pk
echo.
