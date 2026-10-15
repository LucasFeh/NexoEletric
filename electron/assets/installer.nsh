; Incluido no instalador NSIS pelo electron-builder (package.json » build.nsis.include).
;
; O instalador padrao do electron-builder sempre se apresenta como instalacao nova. Aqui
; ele primeiro olha o que ja esta neste computador (a versao gravada na chave de
; desinstalacao do usuario) e age de acordo:
;   - versao mais velha instalada  -> e uma ATUALIZACAO: pergunta "atualizar de X para Y?"
;   - a mesma versao               -> nao reinstala: oferece abrir o app (ou reparar)
;   - versao mais nova instalada   -> recusa voltar para tras
;   - nada instalado               -> instalacao normal
; Nada disso roda na atualizacao automatica (o app chama o instalador com --updated) nem
; em instalacao silenciosa (/S): la ninguem esta olhando para clicar.
;
; Em qualquer caso, projetos, bibliotecas, a pasta de trabalho (C:\EletricHUB ou
; C:\NexoEletric) e as configuracoes (%APPDATA%\NexoEletric) ficam como estao: a troca e so
; do programa.
;
; EletricHUB -> NexoEletric (1.9.0). O appId nao mudou, entao a chave de desinstalacao (o GUID
; dele) e a mesma: o electron-builder acha o EletricHUB instalado e roda o desinstalador dele
; em silencio (uninstallOldVersion, com --updated: os dados ficam) antes de copiar o novo, e
; troca o atalho EletricHUB.lnk pelo NexoEletric.lnk. Nao fica nada lado a lado. So a PASTA
; ficaria com o nome antigo, porque o instalador reaproveita a InstallLocation gravada: o
; customInit troca "...\EletricHUB" por "...\NexoEletric" (o desinstalador antigo continua
; recebendo a pasta antiga, que ele mesmo le do registro).

!include "WordFunc.nsh"
!include "FileFunc.nsh"

; Com um customCheckAppRunning definido, o electron-builder deixa de incluir o que o
; _CHECK_APP_RUNNING padrao usa (allowOnlyOneInstallerInstance.nsh): declarado aqui.
!include "getProcessInfo.nsh"
Var pid
; so no instalador: o desinstalador nunca o usa (variavel sem uso e erro no NSIS do electron-builder)
!ifndef BUILD_UNINSTALLER
  Var nexoPastaAntiga
!endif

!macro customInit
  ; a pasta do EletricHUB (ate a 1.8.x) vira a do NexoEletric
  StrCpy $nexoPastaAntiga ""
  ${GetFileName} "$INSTDIR" $R7
  ${if} $R7 == "EletricHUB"
  ${andIf} "${APP_FILENAME}" != "EletricHUB"
    StrCpy $nexoPastaAntiga "$INSTDIR"
    ${GetParent} "$INSTDIR" $R6
    StrCpy $INSTDIR "$R6\${APP_FILENAME}"
  ${endIf}
  ${ifNot} ${isUpdated}
  ${andIfNot} ${Silent}
    ; instalacao por maquina grava em HKLM; por usuario, em HKCU
    ReadRegStr $R9 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${if} $R9 == ""
      ReadRegStr $R9 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${endIf}
    ${if} $R9 != ""
      ${VersionCompare} "$R9" "${VERSION}" $R8
      ${if} $R8 == 0
        MessageBox MB_YESNOCANCEL|MB_ICONINFORMATION "O ${PRODUCT_NAME} ${VERSION} já está instalado e atualizado neste computador.$\r$\n$\r$\nSim: abrir o ${PRODUCT_NAME}$\r$\nNão: reinstalar esta mesma versão (reparar a instalação)$\r$\nCancelar: sair sem mudar nada" IDYES altiumhub_abrir IDNO altiumhub_segue
        Quit
      ${elseIf} $R8 == 1
        MessageBox MB_YESNO|MB_ICONINFORMATION "Já está instalada uma versão mais nova do ${PRODUCT_NAME} ($R9).$\r$\nEste instalador é da ${VERSION} e não vai substituí-la.$\r$\n$\r$\nAbrir o ${PRODUCT_NAME} instalado?" IDYES altiumhub_abrir
        Quit
      ${else}
        MessageBox MB_OKCANCEL|MB_ICONQUESTION "Atualizar o ${PRODUCT_NAME} da versão $R9 para a ${VERSION}?$\r$\n$\r$\nProjetos, bibliotecas, a pasta de trabalho e as configurações continuam como estão." IDOK altiumhub_segue
        Quit
      ${endIf}

      altiumhub_abrir:
        ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
          Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
        ${endIf}
        Quit

      altiumhub_segue:
    ${endIf}
  ${endIf}
!macroend

; App aberto durante a instalacao. O padrao do electron-builder avisa e MATA o processo:
; uma vista com edicao nao salva perderia a edicao, e o hub (python) morreria sem o app
; derruba-lo. Aqui o instalador primeiro pede para o app fechar como o X da janela faz
; (taskkill sem /F = WM_CLOSE): as vistas perguntam pelo que nao foi salvo, e o app so sai
; depois de parar o hub. So se ele continuar aberto e que o padrao entra.
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ; o EletricHUB.exe da pasta antiga (troca de nome): pede para fechar como o X da janela e
  ; espera ate 20 s; o que sobrar, o desinstalador antigo fecha do jeito dele
  !ifndef BUILD_UNINSTALLER
  ${if} $nexoPastaAntiga != ""
  ${andIf} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -C "$$p = @(Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$nexoPastaAntiga', 'CurrentCultureIgnoreCase') -and $$_.Name -eq 'EletricHUB.exe'}); $$p | % { taskkill.exe /PID $$_.ProcessId }; $$n = 0; while (($$n -lt 40) -and ($$p | ? { Get-Process -Id $$_.ProcessId -ErrorAction SilentlyContinue })) { Start-Sleep -Milliseconds 500; $$n++ }"`
    Pop $R2
  ${endIf}
  !endif
  ${ifNot} ${isUpdated}
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      altiumhub_fecha:
        ; so os processos DESTA instalacao (caminho dentro de $INSTDIR), o mesmo criterio do
        ; FIND_PROCESS. O AltiumHub.exe e o nome do exe ate a 1.0.2: a atualizacao que troca o
        ; nome encontra o app antigo aberto.
        ; FIND_PROCESS: um outro programa com o mesmo nome de exe nao e tocado
        ${if} $IsPowerShellAvailable == 0
          nsExec::Exec `"$PowerShellPath" -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase') -and ($$_.Name -eq '${APP_EXECUTABLE_FILENAME}' -or $$_.Name -eq 'AltiumHub.exe')} | % { taskkill.exe /PID $$_.ProcessId }"`
        ${else}
          nsExec::Exec `"$CmdPath" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}" /IM "AltiumHub.exe" /FI "USERNAME eq %USERNAME%"`
        ${endIf}
        Pop $R2
        StrCpy $R1 0
      altiumhub_espera:
        Sleep 500
        IntOp $R1 $R1 + 1
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
        ${andIf} $R1 < 40
          Goto altiumhub_espera
        ${endIf}
      ${if} $R0 == 0
      ${andIfNot} ${Silent}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "O ${PRODUCT_NAME} continua aberto — provavelmente há uma edição não salva numa vista.$\r$\n$\r$\nSalve, feche o ${PRODUCT_NAME} e clique em Repetir." IDRETRY altiumhub_fecha
        Quit
      ${endIf}
    ${endIf}
  ${endIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend
