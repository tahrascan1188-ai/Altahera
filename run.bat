@echo off
title Altahera Management System Launcher
chcp 65001 > nul
cd /d "%~dp0"

echo ===================================================
echo     نظام إدارة مركز الطاهرة للأشعة والتحاليل
echo ===================================================
echo.

echo [1/3] التحقق من حزم التشغيل (Dependencies)...
if not exist node_modules (
    echo [!] المجلد node_modules غير موجود. جاري تثبيت الحزم المطلوبة...
    call npm install
) else (
    echo [✓] حزم التشغيل مثبتة بالفعل.
)
echo.

echo [2/3] فتح متصفح النظام...
start "" http://localhost:3000
echo.

echo [3/3] جاري تشغيل السيرفر المركزي...
node server.js
pause
