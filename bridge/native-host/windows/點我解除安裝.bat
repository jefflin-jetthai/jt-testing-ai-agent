@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo       JT Testing AI Agent - Windows Uninstaller
echo ===================================================
echo.

set "DEST_DIR=%APPDATA%\JT Testing AI Agent"

:: 1. 刪除 Windows 登錄表機碼
echo Removing registry entries...
set "REG_BASE=HKCU\Software"
reg delete "%REG_BASE%\Google\Chrome\NativeMessagingHosts\com.jt_testing.bridge_launcher" /f >nul 2>nul
reg delete "%REG_BASE%\Google\Chrome Beta\NativeMessagingHosts\com.jt_testing.bridge_launcher" /f >nul 2>nul
reg delete "%REG_BASE%\Chromium\NativeMessagingHosts\com.jt_testing.bridge_launcher" /f >nul 2>nul

:: 2. 刪除 AppData 裡面的專案資料夾 (含 run.js, bundle.cjs, launcher.bat)
echo Removing files from AppData...
if exist "%DEST_DIR%" (
    rmdir /s /q "%DEST_DIR%" >nul 2>nul
)

echo.
echo ===================================================
echo   [SUCCESS] Uninstallation completed successfully!
echo   NOTE: Please RESTART your Chrome browser.
echo ===================================================
pause