@echo off
set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%LOCALAPPDATA%\Programs\Git\ucrt64\bin;%PATH%"
cd /d "%~dp0"
echo ========================================================
echo Pushing IOT-networking to GitHub...
echo ========================================================
git push -u origin main
echo ========================================================
pause
