@echo off
chcp 936 >nul
setlocal
title 部署自动脚本（qq-bridge）

set "BRIDGE=%~1"
if "%BRIDGE%"=="" set /p BRIDGE=桥接目录（直接回车 = D:\qq-bridge）：
if "%BRIDGE%"=="" set "BRIDGE=D:\qq-bridge"

if not exist "%BRIDGE%\src\bridge.js" (
  echo [X] 这个目录不是 qq-bridge：%BRIDGE%
  echo     里面应该有 src\bridge.js
  pause
  exit /b 1
)

echo [1/3] 复制 启动.bat ...
copy /y "%~dp0启动.bat" "%BRIDGE%\启动.bat" >nul
if errorlevel 1 echo   [X] 复制失败

echo [2/3] 复制端口对齐脚本 ...
if not exist "%BRIDGE%\scripts" mkdir "%BRIDGE%\scripts"
copy /y "%~dp0sync-dsh-port.mjs" "%BRIDGE%\scripts\sync-dsh-port.mjs" >nul
copy /y "%~dp0watch-dsh-port.mjs" "%BRIDGE%\scripts\watch-dsh-port.mjs" >nul

echo [3/3] 修 cwd 提示词变量 ...
where node >nul 2>nul
if errorlevel 1 (
  echo   [!] 没找到 node，已跳过。装好 Node 后手动跑：
  echo       node "%~dp0fix-preset-cwd.mjs" "%BRIDGE%"
) else (
  node "%~dp0fix-preset-cwd.mjs" "%BRIDGE%"
)

echo.
echo 部署完成。日常只需双击：%BRIDGE%\启动.bat
echo 注意：改过预设就要重启一次 DSH。
pause
