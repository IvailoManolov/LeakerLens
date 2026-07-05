@echo off
:: Shim that strips flags VS Code 1.122+ no longer accepts before forwarding
:: to the real Code.exe. Called by @vscode/test-electron on Windows (shell:true).
node "%~dp0vscode-shim.js" %*
