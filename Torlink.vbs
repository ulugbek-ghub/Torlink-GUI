Option Explicit

' Double-click entry point for Torlink on Windows.
' First run: shows the setup window (downloads Node.js if needed, installs and
' builds the app). Later runs: starts Torlink hidden and opens the browser.

Dim fso, shell, root, quote, psExe, setupScript, launchScript
Dim installed, command, code

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
quote = Chr(34)

psExe = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fso.FileExists(psExe) Then
    psExe = "powershell.exe"
End If

setupScript = root & "\scripts\setup-windows.ps1"
launchScript = root & "\scripts\launch-windows.ps1"

If Not fso.FileExists(launchScript) Then
    MsgBox "Torlink is incomplete: this folder is missing the launcher" & vbCrLf & _
           quote & "scripts\launch-windows.ps1" & quote & "." & vbCrLf & vbCrLf & _
           "Torlink looked in:" & vbCrLf & root & vbCrLf & vbCrLf & _
           "Extract the whole Torlink download to a normal folder (do not run it from inside the ZIP), " & _
           "keep Torlink.vbs next to the scripts folder, and try again. If the file exists but was " & _
           "removed by Windows, check your antivirus quarantine.", vbCritical, "Torlink"
    WScript.Quit 1
End If

installed = fso.FileExists(root & "\.runtime\installed") And _
            fso.FileExists(root & "\server\index.js") And _
            fso.FileExists(root & "\node_modules\torlnk\dist\cli.cjs") And _
            fso.FileExists(root & "\dist\index.html")

If Not installed Then
    If Not fso.FileExists(setupScript) Then
        MsgBox "Torlink is incomplete: this folder is missing the setup script" & vbCrLf & _
               quote & "scripts\setup-windows.ps1" & quote & "." & vbCrLf & vbCrLf & _
               "Torlink looked in:" & vbCrLf & root & vbCrLf & vbCrLf & _
               "Extract the whole Torlink download to a normal folder (do not run it from inside the ZIP), " & _
               "keep Torlink.vbs next to the scripts folder, and try again.", vbCritical, "Torlink"
        WScript.Quit 1
    End If

    ' First run. Keep the window visible so the user can see progress.
    command = quote & psExe & quote & " -NoProfile -ExecutionPolicy Bypass -File " & quote & setupScript & quote & " -NoLaunch"

    On Error Resume Next
    code = shell.Run(command, 1, True)
    If Err.Number <> 0 Then
        MsgBox "Windows could not start PowerShell." & vbCrLf & vbCrLf & _
               "Torlink needs Windows 10 or newer.", vbCritical, "Torlink setup failed"
        WScript.Quit 1
    End If
    On Error GoTo 0

    If code <> 0 Then
        MsgBox "Torlink setup did not finish." & vbCrLf & vbCrLf & _
               "Run " & quote & "Setup Torlink.bat" & quote & " to see what went wrong." & vbCrLf & _
               "Details: " & root & "\.runtime\logs\setup.log", vbCritical, "Torlink setup failed"
        WScript.Quit code
    End If
End If

' Start hidden. launch-windows.ps1 shows a dialog if the server fails to start.
command = quote & psExe & quote & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & quote & launchScript & quote

On Error Resume Next
shell.Run command, 0, False
If Err.Number <> 0 Then
    MsgBox "Windows could not start Torlink." & vbCrLf & vbCrLf & _
           "Open " & quote & "Start Torlink.bat" & quote & " to see the error.", vbCritical, "Torlink"
    WScript.Quit 1
End If
On Error GoTo 0

WScript.Quit 0
