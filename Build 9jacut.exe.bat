@echo off
setlocal

set "PROJECT_DIR=%~dp0"
for %%I in ("%PROJECT_DIR%..") do set "PARENT_DIR=%%~fI"
set "EXE_NAME=9jacut.exe"

echo ============================================
echo   Building 9jacut  -  please wait
echo   (this window will close itself when done)
echo ============================================
echo.

cd /d "%PROJECT_DIR%"

echo Installing dependencies ^(this can take a few minutes^)...
call npm install
if errorlevel 1 (
  echo.
  echo Something went wrong during setup. This window will stay open -
  echo please take a screenshot of this text and send it back.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\electron-builder.cmd" (
  echo.
  echo Setup did not fully complete ^(electron-builder is still missing^).
  echo This window will stay open - please take a screenshot of this text
  echo and send it back.
  pause
  exit /b 1
)

echo Building the app...
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
call npm run dist
if errorlevel 1 (
  echo.
  echo Something went wrong during the build. This window will stay open -
  echo please take a screenshot of this text and send it back.
  pause
  exit /b 1
)

if not exist "dist\%EXE_NAME%" (
  echo.
  echo Build finished but the .exe wasn't found where expected.
  echo Please take a screenshot of this text and send it back.
  pause
  exit /b 1
)

echo.
echo Build succeeded. Copying %EXE_NAME% to %PARENT_DIR% ...
copy /y "dist\%EXE_NAME%" "%PARENT_DIR%\%EXE_NAME%" >nul

echo Cleaning up project files, keeping only %EXE_NAME% ...
cd /d "%PARENT_DIR%"

REM Delete the whole project folder (source, node_modules, this script)
REM a couple seconds after this window closes, so nothing is left behind
REM except the finished .exe.
start "" cmd /c "timeout /t 3 >nul & rmdir /s /q ""%PROJECT_DIR%"""

echo.
echo Done! %EXE_NAME% is now in:
echo   %PARENT_DIR%
echo That's the only file left - safe to share with friends.
echo This window will close in 6 seconds.
timeout /t 6 >nul
exit
