@echo off
setlocal

pushd "%~dp0"

if not exist extension.vsix (
    echo extension.vsix not found. Run build-vsix.bat first.
    popd
    endlocal
    exit /b 1
)

set "CODE_CMD="
for /f "delims=" %%I in ('where code 2^>nul') do (
    if not defined CODE_CMD set "CODE_CMD=%%I"
)

if not defined CODE_CMD (
    set "CODE_CMD=%LocalAppData%\Programs\Microsoft VS Code\bin\code.cmd"
    if not exist "%CODE_CMD%" (
        set "CODE_CMD=%LocalAppData%\Programs\Microsoft VS Code\Code.exe"
        if not exist "%CODE_CMD%" (
            echo Could not find VS Code command or executable.
            popd
            endlocal
            exit /b 1
        )
    )
)

echo Installing extension.vsix into VS Code...
"%CODE_CMD%" --install-extension "%CD%\extension.vsix" --force
set "EXIT_CODE=%errorlevel%"

popd
endlocal & exit /b %EXIT_CODE%