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
SetupIconFile=..\assets\draftlab.ico
OutputBaseFilename=DraftEdgeCompanionSetup
WizardStyle=modern

[Files]
Source: "{#ExecutablePath}"; DestDir: "{app}"; DestName: "DraftLab.exe"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\DraftEdge Companion"; Filename: "{app}\DraftLab.exe"; WorkingDir: "{app}"

[Registry]
Root: HKCU; Subkey: "Software\Classes\draftedge"; ValueType: string; ValueData: "URL:DraftEdge Companion"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\draftedge"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\draftedge\shell\open\command"; ValueType: string; ValueData: """{app}\DraftLab.exe"" --activate ""%1"""

[Run]
Filename: "{app}\DraftLab.exe"; Description: "Open DraftEdge Companion"; Flags: nowait postinstall skipifsilent
