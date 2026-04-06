@echo off
echo === Killing all VS Code processes ===
taskkill /IM "Code.exe" /F 2>nul
taskkill /IM "claude.exe" /F 2>nul
timeout /t 3 /nobreak >nul

echo === Clearing VS Code caches ===
rmdir /s /q "%APPDATA%\Code\Service Worker" 2>nul
rmdir /s /q "%APPDATA%\Code\Cache" 2>nul
rmdir /s /q "%APPDATA%\Code\CachedData" 2>nul
rmdir /s /q "%APPDATA%\Code\GPUCache" 2>nul
rmdir /s /q "%APPDATA%\Code\User\workspaceStorage" 2>nul

echo === Clearing Claude Code extension state ===
rmdir /s /q "%APPDATA%\Code\User\globalStorage\anthropic.claude-code" 2>nul

echo === Reopening VS Code ===
"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" "C:\Users\Alfred\NeuraReport"
echo Done!
