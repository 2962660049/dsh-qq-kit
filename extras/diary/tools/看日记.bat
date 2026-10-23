@echo off
chcp 65001 >nul
title 小鲸鱼 · 看日记

rem 双击就能翻她的日记（最近 5 条）
rem 想看某一天：该天在 packages\companion\data\diary\YYYY-MM-DD.md

cd /d "%~dp0\.."
set "DIARY=packages\companion\src\diary.js"

where node >nul 2>nul
if errorlevel 1 (
  echo 没找到 node - 先跑一遍 tools\安装.bat
  pause
  exit /b 1
)

echo.
echo ── 最近 5 条 ──
node "%DIARY%" list -n 5
echo.
echo ── 一共写了多少 ──
node "%DIARY%" stats
echo.
pause
