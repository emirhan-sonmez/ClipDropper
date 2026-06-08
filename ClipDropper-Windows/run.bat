@echo off
echo Building ClipDropper...
dotnet build "%~dp0ClipDropper.csproj" -c Release --nologo -v quiet
if %errorlevel% neq 0 (
    echo Build failed. Press any key to exit.
    pause >nul
    exit /b 1
)
echo Starting ClipDropper...
start "" "%~dp0bin\Release\net8.0-windows10.0.19041.0\ClipDropper.exe"
