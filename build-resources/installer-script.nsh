; NeuroChat NSIS custom installer script
; Adds Windows Firewall exceptions for NeuroChat ports

!macro customInstall
  ; Add firewall rules for all three ports
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat UDP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat WS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat File"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NeuroChat UDP"  protocol=UDP localport=45678 action=allow dir=in'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NeuroChat WS"   protocol=TCP localport=45679 action=allow dir=in'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NeuroChat File" protocol=TCP localport=45680 action=allow dir=in'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat UDP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat WS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NeuroChat File"'
!macroend
