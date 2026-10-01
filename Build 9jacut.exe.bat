@echo off
setlocal

set "PROJECT_DIR=%~dp0"
for %%I in ("%PROJECT_DIR%..") do set "PARENT_DIR=%%~fI"
set "EXE_NAME=9jacut.exe"

echo ============================================
echo   Building 9jacut  -  please wait
echo   (your project files are kept)
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

echo.
echo Done! %EXE_NAME% is in:
echo   %PARENT_DIR%
echo Your project files were NOT touched. Share only the .exe.
pause
exit
