@echo off
where dotnet >/dev/null 2>&1
if %%ERRORLEVEL%% NEQ 0 (
    echo .NET 8 SDK is not installed.
    echo Download it free from: https://dotnet.microsoft.com/download/dotnet/8.0
    start https://dotnet.microsoft.com/download/dotnet/8.0
    pause
    exit /b 1
)
dotnet run --project "%%~dp0ClipDropper.csproj"
