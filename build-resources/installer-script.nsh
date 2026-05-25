; NeuroChat NSIS custom installer script
; Adds Windows Firewall exceptions for NeuroChat ports

; Kill any running instance before files are replaced
!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "NeuroChat.exe" /T'
  Sleep 1000
!macroend

!macro customInstall
  ; Remove old rules (port-based and app-based)
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat UDP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat WS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat File"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat App"'

  ; Fixed-port rules (UDP discovery, WebSocket, file transfer)
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NeuroChat UDP"  protocol=UDP localport=45678 action=allow dir=in'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NeuroChat WS"   protocol=TCP localport=45679 action=allow dir=in'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NeuroChat File" protocol=TCP localport=45680 action=allow dir=in'

  ; App-level rule: allows WebRTC media (ephemeral UDP ports used by the browser engine)
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NeuroChat App" program="$INSTDIR\NeuroChat.exe" action=allow dir=in protocol=any'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat UDP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat WS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat File"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat App"'
!macroend
