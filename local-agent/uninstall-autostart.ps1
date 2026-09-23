# Removes the Startup-folder shortcut added by install-autostart.ps1.
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup "Jarvischan Local Agent.lnk"
if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host "Removed: $shortcutPath"
} else {
  Write-Host "No autostart shortcut was installed."
}
