@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo  ClipDropper Installer Builder
echo ============================================================
echo.

:: ============================================================
:: CODE SIGNING CONFIGURATION
:: Set SIGN_CERT to the full path of your .pfx certificate file
:: Set SIGN_PASS to your certificate password
:: Leave SIGN_CERT empty to skip signing (no certificate yet)
:: ============================================================
set SIGN_CERT=
set SIGN_PASS=

:: --- Step 1: Publish the app ---
echo [1/3] Publishing ClipDropper (Release, win-x64)...
if exist publish rmdir /s /q publish

dotnet publish ClipDropper.csproj ^
  -c Release ^
  -r win-x64 ^
  --no-self-contained ^
  -o publish ^
  --nologo

if errorlevel 1 (
  echo.
  echo ERROR: dotnet publish failed. Check errors above.
  pause
  exit /b 1
)
echo Done.
echo.

:: --- Step 2: Sign the app executable (if certificate configured) ---
if not "!SIGN_CERT!"=="" (
  echo [2/3] Signing ClipDropper.exe...
  call :sign_file "publish\ClipDropper.exe"
  if errorlevel 1 goto :sign_error
  echo Done.
  echo.
) else (
  echo [2/3] Skipping code signing ^(SIGN_CERT not set^)
  echo.
)

:: --- Step 3: Find and run Inno Setup compiler ---
echo [3/3] Compiling installer with Inno Setup...

set ISCC=
for %%P in (
  "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
  "%ProgramFiles%\Inno Setup 6\ISCC.exe"
  "%ProgramFiles(x86)%\Inno Setup 5\ISCC.exe"
  "%ProgramFiles%\Inno Setup 5\ISCC.exe"
) do (
  if exist %%P (
    set ISCC=%%P
    goto :found_iscc
  )
)

:not_found
echo.
echo ERROR: Inno Setup compiler (ISCC.exe) not found.
echo Please install Inno Setup from: https://jrsoftware.org/isinfo.php
pause
exit /b 1

:found_iscc
echo Using: !ISCC!
if not exist installer-output mkdir installer-output

!ISCC! setup.iss

if errorlevel 1 (
  echo.
  echo ERROR: Inno Setup compilation failed. Check errors above.
  pause
  exit /b 1
)

:: Sign the installer itself too
if not "!SIGN_CERT!"=="" (
  echo Signing installer...
  call :sign_file "installer-output\ClipDropper-Setup.exe"
  if errorlevel 1 goto :sign_error
  echo Done.
)

echo.
echo ============================================================
echo  SUCCESS: Installer created in installer-output\
echo ============================================================
echo.
start "" "installer-output"
pause
exit /b 0

:: ============================================================
:: Helper: find signtool.exe and sign a file
:: Usage: call :sign_file "path\to\file.exe"
:: ============================================================
:sign_file
  set SIGNTOOL=
  for /f "delims=" %%F in ('dir /b /s "%ProgramFiles(x86)%\Windows Kits\10\bin\*\x64\signtool.exe" 2^>nul') do (
    set SIGNTOOL=%%F
  )
  if "!SIGNTOOL!"=="" (
    echo ERROR: signtool.exe not found. Install Windows SDK.
    exit /b 1
  )
  "!SIGNTOOL!" sign /f "!SIGN_CERT!" /p "!SIGN_PASS!" /tr http://timestamp.certum.pl /td sha256 /fd sha256 %1
  exit /b %errorlevel%

:sign_error
  echo.
  echo ERROR: Code signing failed. Check certificate path and password.
  pause
  exit /b 1
