@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Enable-MobileAccess.ps1"
if errorlevel 1 echo Nao foi possivel preparar o acesso. Confira a permissao de administrador e a interface de rede.
pause
