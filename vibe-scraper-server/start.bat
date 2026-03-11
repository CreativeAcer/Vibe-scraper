@echo off
cd /d "%~dp0"
where python >nul 2>&1 || (
    echo Python not found. Install from https://python.org/downloads
    pause
    exit /b 1
)
echo Installing dependencies...
pip install -r requirements.txt -q
echo.
echo Starting Vibe Scraper Server on http://localhost:7823 ...
echo Press Ctrl+C to stop.
echo.
python server.py
pause
