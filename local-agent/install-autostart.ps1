# Adds a shortcut to the current user's Startup folder so the Jarvischan
# local agent launches automatically at login, minimized to the taskbar.
# Run install-autostart.bat (double-click) rather than this file directly.
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup "Jarvischan Local Agent.lnk"
$targetPath = Join-Path $PSScriptRoot "start-agent.bat"

$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7   # minimized
$shortcut.Description = "Jarvischan local agent — lets the Jarvischan web page open apps/files on this computer"
$shortcut.Save()

Write-Host "Installed: $shortcutPath"
Write-Host "The agent will start automatically (minimized) next time you log in."
Write-Host "To undo this, run uninstall-autostart.bat."
