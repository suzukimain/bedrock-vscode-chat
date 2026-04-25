@echo off
setlocal

pushd "%~dp0"

echo Installing dependencies...
call npm ci
if errorlevel 1 goto :error

echo Compiling extension...
call npm run compile
if errorlevel 1 goto :error

if exist extension.vsix del /f /q extension.vsix

echo Packaging VSIX...
call npx @vscode/vsce package -o extension.vsix
if errorlevel 1 goto :error

echo Done: extension.vsix
popd
endlocal
exit /b 0

:error
set "EXIT_CODE=%errorlevel%"
popd
endlocal & exit /b %EXIT_CODE%