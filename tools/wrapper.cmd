setlocal EnableDelayedExpansion
set "NODE_BIN=%NJ_NODE%"
if "%NODE_BIN%"=="" set "NODE_BIN=node"
where "%NODE_BIN%" >nul 2>nul
if errorlevel 1 (
  echo %~n0: node not found ^(looked for '%NODE_BIN%'^) 1>&2
  exit /b 127
)
set "NODE_VER="
for /f "usebackq delims=" %%v in (`"%NODE_BIN%" --version 2^>nul`) do set "NODE_VER=%%v"
set "MAJOR="
for /f "tokens=1 delims=." %%m in ("!NODE_VER:v=!") do set "MAJOR=%%m"
if "!MAJOR!"=="" (
  echo %~n0: node too old ^(requires Node.js ^>= 24^) 1>&2
  exit /b 127
)
if !MAJOR! lss 24 (
  echo %~n0: node too old ^(requires Node.js ^>= 24^) 1>&2
  exit /b 127
)
set "NODE_OPTIONS="
set "ENTRY=%~dp0..\dist\%~n0.mjs"
if not exist "%ENTRY%" (
  echo %~n0: %ENTRY% not found 1>&2
  exit /b 127
)
"%NODE_BIN%" "%ENTRY%" %*
exit /b %ERRORLEVEL%
