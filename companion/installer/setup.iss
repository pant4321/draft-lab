[Setup]
AppId=DraftEdgeCompanion
AppName=DraftEdge Companion
AppVersion={#AppVersion}
AppPublisher=DraftEdge
AppPublisherURL=https://draftedge.website/
DefaultDirName={localappdata}\Programs\DraftEdge Companion
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
AppMutex=Local\DraftLabCompanion
RestartApplications=no
ChangesAssociations=yes
UninstallDisplayIcon={app}\DraftLab.exe
SetupIconFile=..\..\web\public\favicon.ico
OutputBaseFilename=DraftEdgeCompanionSetup
WizardStyle=modern

[Files]
#ifdef BundlePath
Source: "{#BundlePath}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#else
Source: "{#ExecutablePath}"; DestDir: "{app}"; DestName: "DraftLab.exe"; Flags: ignoreversion
#endif

[Icons]
Name: "{userprograms}\DraftEdge Companion"; Filename: "{app}\DraftLab.exe"; WorkingDir: "{app}"

[Registry]
Root: HKCU; Subkey: "Software\Classes\draftedge"; ValueType: string; ValueData: "URL:DraftEdge Companion"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\draftedge"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\draftedge\shell\open\command"; ValueType: string; ValueData: """{app}\DraftLab.exe"" --activate ""%1"""

[Run]
Filename: "{app}\DraftLab.exe"; Description: "Open DraftEdge Companion"; Flags: nowait postinstall skipifsilent

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  RunName = 'DraftEdge Companion';
  TraySwitch = ' --start-in-tray';

function StartupExecutable: String;
begin
  Result := '"' + ExpandConstant('{app}\DraftLab.exe') + '"';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Command: String;
begin
  if CurStep = ssPostInstall then
    if RegQueryStringValue(HKCU, RunKey, RunName, Command) then
      if CompareText(Command, StartupExecutable) = 0 then
        if Length(StartupExecutable + TraySwitch) <= 260 then
          RegWriteStringValue(HKCU, RunKey, RunName, StartupExecutable + TraySwitch);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Command: String;
begin
  if CurUninstallStep = usUninstall then
    if RegQueryStringValue(HKCU, RunKey, RunName, Command) then
      if (CompareText(Command, StartupExecutable) = 0) or
         (CompareText(Command, StartupExecutable + TraySwitch) = 0) then
        RegDeleteValue(HKCU, RunKey, RunName);
end;
