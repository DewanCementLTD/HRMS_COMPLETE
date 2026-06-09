@echo off
REM Start the LMS FastAPI backend
REM host 0.0.0.0 = accept connections from all network interfaces
REM (required so physical Android devices can reach the server over Wi-Fi)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
