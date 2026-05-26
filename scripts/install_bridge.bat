@echo off
title AWP Print Bridge - Setup
echo ============================================================
echo   AWP Inventory - Print Bridge Setup
echo   Brother QL-800
echo ============================================================
echo.
echo This will install the print bridge and set it to run
echo automatically every time this computer starts.
echo.
pause

:: ── Check Python ─────────────────────────────────────────────────────────────
echo Checking for Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Python is not installed.
    echo Please download and install Python from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo Then run this setup again.
    echo.
    pause
    exit /b 1
)
python --version
echo Python found. OK.
echo.

:: ── Install packages ─────────────────────────────────────────────────────────
echo Installing required packages...
python -m pip install --upgrade pip --quiet
python -m pip install flask flask-cors brother_ql pillow "python-barcode[images]" libusb pyusb pywin32
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Package installation failed. Check your internet connection and try again.
    pause
    exit /b 1
)
echo Packages installed. OK.
echo.

:: ── Find bridge.py location ───────────────────────────────────────────────────
set "BRIDGE=%~dp0bridge.py"
if not exist "%BRIDGE%" (
    echo ERROR: Could not find bridge.py in the same folder as this setup file.
    echo Make sure bridge.py and install_bridge.bat are in the same folder.
    pause
    exit /b 1
)
echo Bridge script found: %BRIDGE%
echo.

:: ── Create the startup wrapper script ────────────────────────────────────────
set "WRAPPER=%~dp0start_bridge.bat"
echo Creating startup wrapper...
(
    echo @echo off
    echo cd /d "%~dp0"
    echo :loop
    echo python "%BRIDGE%"
    echo echo Bridge stopped - restarting in 5 seconds...
    echo timeout /t 5 /nobreak ^>nul
    echo goto loop
) > "%WRAPPER%"
echo Wrapper created. OK.
echo.

:: ── Register Windows Scheduled Task ──────────────────────────────────────────
echo Registering startup task...
schtasks /delete /tn "AWP Print Bridge" /f >nul 2>&1

schtasks /create ^
  /tn "AWP Print Bridge" ^
  /tr "cmd.exe /c \"%WRAPPER%\"" ^
  /sc onstart ^
  /ru SYSTEM ^
  /rl HIGHEST ^
  /f ^
  /delay 0001:00

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Could not register startup task. Try right-clicking this file
    echo and selecting "Run as administrator".
    pause
    exit /b 1
)
echo Startup task registered. OK.
echo.

:: ── Start it now ─────────────────────────────────────────────────────────────
echo Starting the print bridge now...
schtasks /run /tn "AWP Print Bridge"
echo.
echo ============================================================
echo   SETUP COMPLETE
echo ============================================================
echo.
echo The print bridge is now running and will start automatically
echo every time this computer boots up.
echo.
echo You can verify it is working by opening the AWP Inventory
echo app and checking for the green dot on the Labels page.
echo.
echo IP Address: 192.168.40.220
echo Port:       5757
echo.
pause
