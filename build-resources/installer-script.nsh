; NeuroChat NSIS custom installer script
;
; Firewall rules are NOT set here: this installer runs asInvoker (no admin
; rights, required for silent per-user install/auto-update), so netsh calls
; would silently fail every time. Firewall provisioning is handled instead
; by the GPO machine-level startup script (scripts/gpo/1-limpieza-startup.bat)
; and, as a single-attempt fallback, by the app itself (src/main/index.js).

; Kill any running instance before files are replaced
!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "NeuroChat.exe" /T'
  Sleep 1000
!macroend
