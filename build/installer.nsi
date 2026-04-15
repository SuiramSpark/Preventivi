; Custom installer script for Preventivi
; Uses WriteUninstaller directly to avoid the electron-builder uninstaller extraction step
; (which Windows Defender blocks on unsigned builds)

Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory

!include "common.nsh"
!include "MUI2.nsh"
!include "multiUser.nsh"
!include "allowOnlyOneInstallerInstance.nsh"

!ifdef INSTALL_MODE_PER_ALL_USERS
  RequestExecutionLevel admin
!else
  RequestExecutionLevel user
!endif

Var appExe
Var launchLink

!ifdef ONE_CLICK
  !include "oneClick.nsh"
!else
  !include "assistedInstaller.nsh"
!endif

!insertmacro addLangs

!ifmacrodef customHeader
  !insertmacro customHeader
!endif

Function .onInit
  Call setInstallSectionSpaceRequired

  SetOutPath $INSTDIR
  ${LogSet} on

  !ifmacrodef preInit
    !insertmacro preInit
  !endif

  !ifdef DISPLAY_LANG_SELECTOR
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro check64BitAndSetRegView

  !ifdef ONE_CLICK
    !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  !else
    ${IfNot} ${UAC_IsInnerInstance}
      !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
    ${EndIf}
  !endif

  !insertmacro initMultiUser

  !ifmacrodef customInit
    !insertmacro customInit
  !endif

  !ifmacrodef addLicenseFiles
    InitPluginsDir
    !insertmacro addLicenseFiles
  !endif
FunctionEnd

!include "installUtil.nsh"

; Include installer.nsh for macros (extractEmbeddedAppPackage, registryAddInstallInfo,
; addStartMenuLink, addDesktopLink, etc.)
; NOTE: installApplicationFiles macro is defined here but we do NOT call it —
; we use WriteUninstaller instead of embedding a pre-built uninstaller.
!include "installer.nsh"

; Define un._GetProcessInfo for the WriteUninstaller approach.
; Normally this is only compiled when BUILD_UNINSTALLER is set, but we need it
; so that uninstaller sections can call GetProcessInfo (which calls un._GetProcessInfo).
Function un._GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd

!macro doStartApp
  HideWindow
  !insertmacro StartApp
!macroend

Section "install" INSTALL_SECTION_ID
  !ifndef INSTALL_MODE_PER_ALL_USERS
    !ifndef ONE_CLICK
      ${if} $hasPerMachineInstallation == "1"
      ${andIf} ${Silent}
        ${ifNot} ${UAC_IsAdmin}
          ShowWindow $HWNDPARENT ${SW_HIDE}
          !insertmacro UAC_RunElevated
          ${Switch} $0
            ${Case} 0
              ${Break}
            ${Case} 1223
              ${Break}
            ${Default}
              MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "Unable to elevate, error $0"
              ${Break}
          ${EndSwitch}
          Quit
        ${else}
          !insertmacro setInstallModePerAllUsers
        ${endIf}
      ${endIf}
    !endif
  !endif

  !ifdef ONE_CLICK
    !ifdef HEADER_ICO
      File /oname=$PLUGINSDIR\installerHeaderico.ico "${HEADER_ICO}"
    !endif
    ${IfNot} ${Silent}
      !ifdef HEADER_ICO
        SpiderBanner::Show /MODERN /ICON "$PLUGINSDIR\installerHeaderico.ico"
      !else
        SpiderBanner::Show /MODERN
      !endif
      FindWindow $0 "#32770" "" $hwndparent
      FindWindow $0 "#32770" "" $hwndparent $0
      GetDlgItem $0 $0 1000
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$(installing)"
      StrCpy $1 $hwndparent
      System::Call 'user32::ShutdownBlockReasonCreate(${SYSTYPE_PTR}r1, w "$(installing)")'
    ${endif}
    !insertmacro CHECK_APP_RUNNING
  !else
    ${ifNot} ${UAC_IsInnerInstance}
      !insertmacro CHECK_APP_RUNNING
    ${endif}
  !endif

  ; Imposta $newDesktopLink, $newStartMenuLink ecc. — VA chiamato prima di tutto
  !insertmacro setLinkVars

  Var /GLOBAL keepShortcuts
  StrCpy $keepShortcuts "false"
  !insertMacro setIsTryToKeepShortcuts
  ${if} $isTryToKeepShortcuts == "true"
    ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts
    ${if} $R1 == "true"
    ${andIf} ${FileExists} "$appExe"
      StrCpy $keepShortcuts "true"
    ${endIf}
  ${endif}

  !insertmacro uninstallOldVersion SHELL_CONTEXT
  !insertmacro handleUninstallResult SHELL_CONTEXT

  ${if} $installMode == "all"
    !insertmacro uninstallOldVersion HKEY_CURRENT_USER
    !insertmacro handleUninstallResult HKEY_CURRENT_USER
  ${endIf}

  SetOutPath $INSTDIR

  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  !ifdef UNINSTALLER_ICON
    File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
  !endif

  ; Extract embedded app package (the .7z archive)
  !insertmacro extractEmbeddedAppPackage

  ; Electron always uses per-user app data
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}
  !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}

  ; Write the uninstaller directly — no pre-built uninstaller needed
  WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"

  !insertmacro registryAddInstallInfo
  !insertmacro addStartMenuLink $keepShortcuts
  !insertmacro addDesktopLink $keepShortcuts

  ${if} ${FileExists} "$newStartMenuLink"
    StrCpy $launchLink "$newStartMenuLink"
  ${else}
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endIf}

  !ifmacrodef registerFileAssociations
    !insertmacro registerFileAssociations
  !endif

  !ifmacrodef customInstall
    !insertmacro customInstall
  !endif

  !ifdef ONE_CLICK
    !ifdef RUN_AFTER_FINISH
      ${ifNot} ${Silent}
      ${orIf} ${isForceRun}
        !insertmacro doStartApp
      ${endIf}
    !else
      ${if} ${isForceRun}
        !insertmacro doStartApp
      ${endIf}
    !endif
    !insertmacro quitSuccess
  !else
    ${if} ${isForceRun}
    ${andIf} ${Silent}
      !insertmacro doStartApp
    ${endIf}
  !endif
SectionEnd

Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd

; Include uninstaller sections.
; We temporarily define BUILD_UNINSTALLER so that the GetProcessInfo macro
; (inside _CHECK_APP_RUNNING → un.checkAppRunning) calls un._GetProcessInfo
; instead of _GetProcessInfo — NSIS requires un. functions to only call un. functions.
!define BUILD_UNINSTALLER
!include "uninstaller.nsh"
!undef BUILD_UNINSTALLER
