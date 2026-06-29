@echo off
:: 強制將 Windows CMD 視窗切換為 UTF-8 編碼，徹底根除繁體中文亂碼與 Emoji 破碎問題
chcp 65001 >nul

echo ===================================================
echo       JT Testing AI Agent - Windows Installer
echo ===================================================
echo.

:: 1. 檢查核心檔案是否存在
if not exist "%~dp0bundle.cjs" (
    echo [ERROR] bundle.cjs not found in this folder!
    echo Please make sure bundle.cjs is in the same folder as this bat file.
    echo.
    pause
    exit /b
)

:: 2. 建立 AppData 專案目錄並複製檔案
echo Deploying files to AppData...
set "DEST_DIR=%APPDATA%\JT Testing AI Agent"
mkdir "%DEST_DIR%" 2>nul
copy /y "%~dp0bundle.cjs" "%DEST_DIR%\bundle.cjs" >nul

:: 3. 建立啟動外殼 launcher.bat (內部同樣注入 chcp 65001 確保背景通訊不因編碼卡死)
echo Creating background launcher...
echo @echo off > "%DEST_DIR%\launcher.bat"
echo chcp 65001 ^>nul >> "%DEST_DIR%\launcher.bat"
echo cd /d "%%~dp0" >> "%DEST_DIR%\launcher.bat"
echo node bundle.cjs --native-host >> "%DEST_DIR%\launcher.bat"

:: 4. 建立 Native Messaging JSON 設定檔
echo Generating Chrome communication config...
echo { > "%DEST_DIR%\com.jt_testing.bridge_launcher.json"
echo   "name": "com.jt_testing.bridge_launcher", >> "%DEST_DIR%\com.jt_testing.bridge_launcher.json"
echo   "description": "JT Testing AI Agent bridge launcher", >> "%DEST_DIR%\com.jt_testing.bridge_launcher.json"
echo   "path": "%DEST_DIR:\=\\%\\launcher.bat", >> "%DEST_DIR%\com.jt_testing.bridge_launcher.json"
echo   "type": "stdio", >> "%DEST_DIR%\com.jt_testing.bridge_launcher.json"
echo   "allowed_origins": ["chrome-extension://gbodpgijbhekommdppfcgebacbpmedcj/"] >> "%DEST_DIR%\com.jt_testing.bridge_launcher.json"
echo } >> "%DEST_DIR%\com.jt_testing.bridge_launcher.json"

:: 5. 寫入 Windows 登錄表
echo Registering Native Messaging Host to Windows Registry...
set "REG_BASE=HKCU\Software"
reg add "%REG_BASE%\Google\Chrome\NativeMessagingHosts\com.jt_testing.bridge_launcher" /ve /d "%DEST_DIR%\com.jt_testing.bridge_launcher.json" /f >nul 2>nul
reg add "%REG_BASE%\Google\Chrome Beta\NativeMessagingHosts\com.jt_testing.bridge_launcher" /ve /d "%DEST_DIR%\com.jt_testing.bridge_launcher.json" /f >nul 2>nul
reg add "%REG_BASE%\Chromium\NativeMessagingHosts\com.jt_testing.bridge_launcher" /ve /d "%DEST_DIR%\com.jt_testing.bridge_launcher.json" /f >nul 2>nul

echo.
echo ===================================================
echo   [SUCCESS] JT Testing AI Agent Installed!
echo   ⚠️ IMPORTANT: Please RESTART your Chrome browser.
echo ===================================================
pause