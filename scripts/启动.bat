@echo off
cd /d "%~dp0"

rem 这个文件按顺序做四件事：
rem   1 等 DeepSeek Harness 起来，并把 config.json 的 dsh.baseUrl 对齐
rem   2 等 SnowLuma 的 OneBot WS 端口 127.0.0.1:3001
rem   3 起端口看门狗（DSH 中途重启会自动让桥接重连）
rem   4 起桥接本体（崩溃 5 秒后自动重启，关窗口即停止）
rem 顺序错一步，QQ 上就只会收到「系统服务重启中」。

where node >nul 2>nul
if errorlevel 1 goto nonode

echo [启动] 第1步：等 DeepSeek Harness 就绪并自动对齐端口...
set TRY=0
:waitdsh
node scripts\sync-dsh-port.mjs
if not errorlevel 1 goto dshok
set /a TRY+=1
if %TRY% geq 60 goto dshfail
ping -n 6 127.0.0.1 >nul
goto waitdsh

:nonode
echo [启动] 找不到 node 命令。请确认安装时把 Node 加进了 PATH。
pause
exit /b 1

:dshfail
echo.
echo [启动] 等了 5 分钟还是没找到正在运行的 DSH。
echo         请先打开 DeepSeek Harness（桌面那个窗口），再双击本文件。
pause
exit /b 1

:dshok
echo.
echo [启动] 第2步：等 SnowLuma 的 OneBot WS（127.0.0.1:3001）...
set STRY=0
:waitws
netstat -ano -p tcp | findstr /C:":3001 " | findstr /C:"LISTENING" >nul 2>nul
if not errorlevel 1 goto wsok
set /a STRY+=1
if %STRY% geq 36 goto wsfail
ping -n 6 127.0.0.1 >nul
goto waitws

:wsfail
echo.
echo [启动] 等了 3 分钟，SnowLuma 的 3001 还没起来。
echo         请先双击 D:\SnowLuma\launcher.bat，
echo         等黑窗口出现 listening 127.0.0.1:5099，再双击本文件。
pause
exit /b 1

:wsok
echo.
echo [启动] 第3步：启动端口看门狗...
start "dsh-port-watch" /min node scripts\watch-dsh-port.mjs
echo [启动] 第4步：启动桥接（关窗口即停止）...
echo.
call start.bat