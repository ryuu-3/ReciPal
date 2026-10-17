@echo off
title ReciPal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from https://nodejs.org/
  pause
  exit /b 1
)

node server.js
if errorlevel 1 pause
