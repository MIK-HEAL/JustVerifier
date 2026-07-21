!macro customUnInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-runtime-cache-uninstall.ps1"'
!macroend
