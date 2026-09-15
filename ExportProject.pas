{ ..................................................................................................................... }
{ .  AltiumPCBMirror - ExportProject.pas                                                                              . }
{ .                                                                                                                   . }
{ .  Espelha o ESQUEMA do projeto focado para o workspace central:                                                    . }
{ .    Projects\<nome>\schematic.js  (formato schmirror-v2, unidade MIL, um item por linha)                           . }
{ .  e atualiza o indice projects.js.                                                                                 . }
{ .                                                                                                                   . }
{ .  A PCB e espelhada pelo ExportBoard (rode-o com o .PcbDoc focado).                                                . }
{ .                                                                                                                   . }
{ .  Como executar: DXP >> Run Script >> ExportProject  (com o projeto aberto/focado)                                 . }
{ ..................................................................................................................... }

const
  // Onde ESTA MAQUINA diz qual e a raiz do workspace (ver o bloco HOME mais abaixo).
  // SCRIPT_HOME e PROJECTS_DIR sairam do const e viraram var, preenchidas no comeco
  // do procedimento principal: o caminho e da maquina, nao do codigo. Aqui tudo roda
  // local; o servidor so entra depois do deploy, e quem diz isso e o home.txt.
  HOME_CFG_DIR = 'C:\ProgramData\AltiumPCBMirror';
  HOME_CFG = 'C:\ProgramData\AltiumPCBMirror\home.txt';
  // Marca que prova que um caminho e MESMO o workspace, e nao so uma pasta que existe.
  HOME_MARCA = 'AI-GUIDE.md';

var
  // Preenchidas por HubHome(0) na PRIMEIRA linha do procedimento principal. Eram const,
  // e const nao se reatribui em DelphiScript - por isso estao aqui. Nada que use as duas
  // pode rodar antes daquela linha (ResolveProjectDir, ListProjectDirs, o indice...).
  SCRIPT_HOME: String;
  PROJECTS_DIR: String;
  HomeOrigem: String;  // de onde veio SCRIPT_HOME; sai na mensagem de erro de gravacao
  SkippedDocs: Integer;
  ScanInfo: String; // diagnostico do ultimo ListProjectDirs (aparece nos dialogos)
  // estado do filtro de carimbo (ver bloco "carimbo da folha" mais abaixo)
  StampKeys: TStringList;  // chave texto+posicao dos rotulos do carimbo da folha corrente
  TplPath: String;         // .SchDot ja lido (cache entre folhas do mesmo projeto)
  TplTexts: TStringList;   // textos dos rotulos desse .SchDot
  StampDropped: Integer;   // rotulos de carimbo que ficaram fora do espelho
  // Contagem por tipo de item. Existe porque a omissao do ePort passou despercebida por
  // meses: sem numero na tela, "nao exportou" e "nao tinha" sao indistinguiveis.
  NComp, NWire, NLabel, NPower, NPort, NJunc, NText, NNoErc: Integer;
  NCompPar: Integer;        // componentes que trouxeram parametro de identidade
                            // (OdooId/MPN/...): e o que liga a lista ao cadastro do Odoo
  SheetsMeasured: Integer;  // folhas cuja medida real o Altium entregou
  PortWarn: String;        // primeira propriedade de Port que o Altium recusou (se houver)
  StampByObj: Integer;     // folhas em que a sonda do objeto eTemplate trouxe material
  StampByTpl: Integer;     // folhas em que a sonda do .SchDot trouxe material
  StampBlind: Integer;     // folhas em que nenhuma das duas respondeu
                           // (as duas rodam juntas, entao ByObj e ByTpl se somam)

{ helpers JSON identicos aos do ExportLibs.pas — copie JF, JB, JS, AddItem daquele arquivo }
{ e os mapeamentos RotDegOf (TRotationBy90 -> 0/90/180/270) tambem. }

function JF(v: Double): String;
begin
  Result := StringReplace(FloatToStr(v), ',', '.', MkSet(rfReplaceAll, rfIgnoreCase));
end;

function JB(v: Boolean): String;
begin
  if v then
    Result := 'true'
  else
    Result := 'false';
end;

function JS(v: String): String;
var
  i: Integer;
  c: String;
begin
  Result := '"';
  for i := 1 to Length(v) do
  begin
    c := v[i];
    case Ord(v[i]) of
      34:
        Result := Result + '\"';
      92:
        Result := Result + '\\';
      8:
        Result := Result + '\b';
      9:
        Result := Result + '\t';
      10:
        Result := Result + '\n';
      12:
        Result := Result + '\f';
      13:
        Result := Result + '\r';
    else
      begin
        if (Ord(v[i]) < 32) or (Ord(v[i]) > 125) then
          Result := Result + '\u' + IntToHex(Ord(v[i]), 4)
        else
          Result := Result + c;
      end;
    end;
  end;
  Result := Result + '"';
end;

function ML(v: Integer): String;
begin
  Result := JF(CoordToMils(v));
end;

// TColor do Delphi e BGR, nao RGB: o byte BAIXO e o VERMELHO. Trocar a ordem faz a port
// amarela do Altium chegar azul no hub, e ninguem percebe ate abrir a tela.
// Sai em MAIUSCULA porque e o que o IntToHex ja da: o hub aceita as duas caixas
// (hub-draw.corDePort), e nao vale acrescentar dependencia de RTL a um script que so
// compila dentro do Altium para ganhar cosmetica.
function HexDeCor(c: Integer): String;
begin
  Result := '#' + IntToHex(c and $FF, 2) +
                  IntToHex((c shr 8) and $FF, 2) +
                  IntToHex((c shr 16) and $FF, 2);
end;

function RotDegOf(o: TRotationBy90): Integer;
begin
  Result := 0;
  if o = eRotate90 then
    Result := 90
  else if o = eRotate180 then
    Result := 180
  else if o = eRotate270 then
    Result := 270;
end;

procedure AddItem(Section: TStringList; Line: String);
begin
  if Section.Count > 0 then
    Section.Add(',' + Line)
  else
    Section.Add(Line);
end;

{ ========================= HOME (raiz do workspace, por maquina) ========================= }
{ Onde fica o workspace deixou de ser constante no codigo: cada maquina diz a sua em        }
{ C:\ProgramData\AltiumPCBMirror\home.txt -- uma "chave=valor" por linha; linha vazia e      }
{ linha comecando por ';' ou '#' sao ignoradas. Chaves: home (obrigatoria), schlib e         }
{ pcblib (opcionais, so o BuildSchematic usa). Aqui tudo roda local; o servidor so entra     }
{ depois do deploy -- e quem diz qual e o caso e o home.txt DESTA maquina, nao o script.     }
{ ProgramData porque e POR MAQUINA, abre no Bloco de Notas e nao depende de variavel de      }
{ ambiente (GetEnvironmentVariable nao esta entre as primitivas provadas neste engine).      }
{                                                                                           }
{ Este bloco e DUPLICADO, com o mesmo texto, nos quatro .pas -- de proposito. O .PrjScr nao  }
{ ganha unidade nova e resolucao entre unidades do DelphiScript do Altium nao da para testar }
{ fora do Altium; quatro copias identicas custam menos que descobrir la dentro que a chamada }
{ cruzada nao resolve. (Mesmo motivo do odoolista.py, que duplica le_var_js "de proposito".) }
{ Mudou aqui, mude nos quatro com o mesmo texto.                                             }

// Tira barra(s) do fim: 'D:\x\' e 'D:\x' tem de dar o mesmo caminho. Length > 1 no teste
// para nao comer a barra de uma raiz escrita como '\' e nem a primeira de um UNC.
function SemBarraFinal(s: String): String;
begin
  Result := Trim(s);
  while (Length(Result) > 1) and (Result[Length(Result)] = '\') do
    Result := Copy(Result, 1, Length(Result) - 1);
end;

// Validar uma raiz = achar a marca DENTRO dela. E FileExists de proposito (primitiva
// provada neste engine): DirectoryExists aceitaria qualquer pasta que exista, e uma pasta
// que existe mas nao e o workspace tem de ser recusada. A marca e o AI-GUIDE.md porque ele
// mora na raiz, e versionado, e nenhuma outra pasta da maquina tem um.
function HomeValida(Raiz: String): Boolean;
begin
  Result := False;
  if Raiz = '' then
    Exit;
  Result := FileExists(Raiz + '\' + HOME_MARCA);
end;

// Valor de uma chave do home.txt ('' se o arquivo nao existe ou a chave nao esta la).
function HomeCfgGet(Chave: String): String;
var
  L: TStringList;
  i, p: Integer;
  Linha, K: String;
begin
  Result := '';
  if not FileExists(HOME_CFG) then
    Exit;
  L := TStringList.Create;
  try
    L.LoadFromFile(HOME_CFG);
  except
    L.Clear; // ilegivel vale como "esta maquina ainda nao foi configurada"
  end;
  for i := 0 to L.Count - 1 do
  begin
    Linha := Trim(L[i]);
    if Linha = '' then
      continue;
    if (Linha[1] = ';') or (Linha[1] = '#') then
      continue;
    p := Pos('=', Linha);
    if p = 0 then
      continue;
    K := Trim(Copy(Linha, 1, p - 1));
    // sem break de proposito: a ULTIMA linha vence. E o que se espera de arquivo
    // editado a mao, onde a linha nova costuma ser acrescentada no fim.
    if UpperCase(K) = UpperCase(Chave) then
      Result := Trim(Copy(Linha, p + 1, Length(Linha) - p));
  end;
  L.Free;
end;

// Grava/atualiza uma chave no home.txt preservando as outras linhas e os comentarios.
// False = nao deu para gravar (a execucao segue; so vai procurar de novo da proxima vez).
function HomeCfgSet(Chave, Valor: String): Boolean;
var
  L, Ou: TStringList;
  i, p: Integer;
  Linha, K: String;
  Achou, EhAChave: Boolean;
begin
  Result := False;
  L := TStringList.Create;
  if FileExists(HOME_CFG) then
  begin
    try
      L.LoadFromFile(HOME_CFG);
    except
      L.Clear;
    end;
  end;
  Ou := TStringList.Create;
  if L.Count = 0 then
  begin
    Ou.Add('; AltiumPCBMirror - configuracao DESTA maquina. Edite no Bloco de Notas.');
    Ou.Add('; Uma "chave=valor" por linha; linha vazia ou comecando por ; ou # e ignorada.');
    Ou.Add(';   home   = raiz do workspace (a pasta que tem o AI-GUIDE.md)  [obrigatoria]');
    Ou.Add(';   schlib = .SchLib da casa                                    [opcional]');
    Ou.Add(';   pcblib = .PcbLib da casa                                    [opcional]');
  end;
  Achou := False;
  for i := 0 to L.Count - 1 do
  begin
    Linha := L[i];
    K := Trim(Linha);
    EhAChave := False;
    if (K <> '') and (K[1] <> ';') and (K[1] <> '#') then
    begin
      p := Pos('=', K);
      if p > 0 then
        EhAChave := UpperCase(Trim(Copy(K, 1, p - 1))) = UpperCase(Chave);
    end;
    if EhAChave then
    begin
      if not Achou then
        Ou.Add(Chave + '=' + Valor);
      Achou := True;
    end
    else
      Ou.Add(Linha);
  end;
  if not Achou then
    Ou.Add(Chave + '=' + Valor);
  try
    ForceDirectories(HOME_CFG_DIR);
    Ou.SaveToFile(HOME_CFG);
    Result := True;
  except
    Result := False;
  end;
  Ou.Free;
  L.Free;
end;

// Anota no home.txt a raiz que acabou de ser achada, para a proxima execucao nao procurar
// de novo. Falhar aqui nao impede nada -- mas calar seria mentir sobre o que ficou gravado.
procedure HomeCfgAnota(Raiz: String);
begin
  if not HomeCfgSet('home', Raiz) then
    ShowMessage('Achei o workspace em:' + #13#10 + Raiz + #13#10#13#10 +
      'Nao consegui anotar isso em ' + HOME_CFG + ' -' + #13#10 +
      'da proxima vez vou procurar de novo. (Esta rodada funciona assim mesmo.)');
end;

// Raiz do workspace PARA ESTA MAQUINA, nesta ordem:
//   1) a chave home do home.txt, se validar;
//   2) os candidatos conhecidos, em ordem -- o primeiro que validar e GRAVADO no home.txt;
//   3) InputBox, validando a resposta e gravando.
// '' = nao deu para resolver; quem chamou aborta SEM escrever nada.
// Tem parametro de proposito: some do menu Run Script (como AddAlmoxLibs e OpenSchLib).
function HubHome(Dummy: Integer): String;
var
  Cand: TStringList;
  i: Integer;
  Raiz, Resposta, Tentei: String;
begin
  Result := '';
  HomeOrigem := '';

  Raiz := SemBarraFinal(HomeCfgGet('home'));
  if Raiz <> '' then
  begin
    // A LINHA ESCRITA A MAO MANDA, mesmo quando ela nao responde agora.
    //
    // Cair nos candidatos aqui, e anotar o vencedor, era o pior dos mundos: bastava o
    // servidor estar fora do ar, ou o share ainda nao ter montado quando o Altium subiu,
    // para a configuracao manual ser TROCADA sozinha -- e no dia seguinte o script gravava
    // noutro lugar sem ninguem ter mexido em nada. Configuracao que se reescreve sozinha e
    // pior que caminho cravado, porque o cravado pelo menos nao mente.
    //
    // Entao: raiz configurada que nao responde e ERRO para o usuario resolver, nunca um
    // convite para o script escolher por ele. A procura automatica so existe para a maquina
    // que ainda NAO tem a chave home=.
    if HomeValida(Raiz) then
    begin
      HomeOrigem := HOME_CFG;
      Result := Raiz;
      Exit;
    end;
    ShowMessage('O ' + HOME_CFG + ' aponta para:' + #13#10 +
      '   ' + Raiz + #13#10#13#10 +
      'Nao achei o ' + HOME_MARCA + ' la dentro.' + #13#10#13#10 +
      'Se o caminho esta certo, o lugar pode estar fora do ar ou o share pode nao estar' + #13#10 +
      'montado -- abra a pasta no Explorador para conferir.' + #13#10 +
      'Se o caminho esta errado, corrija a linha home= nesse arquivo.' + #13#10#13#10 +
      'NAO vou procurar sozinho: a sua configuracao fica como esta. NADA foi escrito.');
    Result := '';
    Exit;
  end;

  Tentei := '';

  { A ORDEM E O SERVIDOR PRIMEIRO, e isso foi medido doendo: com o \\LUCAS-PC na frente, }
  { o Altium achava a bancada (que esta no ar) e parava ali -- lia e escrevia no workspace }
  { de desenvolvimento em vez do que esta publicado no servidor. O \\LUCAS-PC saiu da      }
  { lista: ele e o nome de UMA maquina, e quem manda hoje e a release no share do .192.    }
  { Sobraram os dois nomes do MESMO servidor: o IP e o nome SMB dele. Nada mais aponta    }
  { para a maquina de ninguem -- o D: local saiu junto, porque tambem era endereco da     }
  { bancada. A HomeValida ainda exige o AI-GUIDE.md la dentro, entao pasta parecida nao   }
  { passa, e quem precisar de outro lugar escreve home= no home.txt.                      }
  { Quem precisar de outro lugar escreve home= no home.txt: ele vence esta lista inteira.  }
  Cand := TStringList.Create;
  Cand.Add('\\192.168.15.192\altiumhub\current');
  Cand.Add('\\ODOO\altiumhub\current');
  for i := 0 to Cand.Count - 1 do
  begin
    if HomeValida(Cand[i]) then
    begin
      Result := Cand[i];
      HomeOrigem := 'candidato embutido no script';
      HomeCfgAnota(Result);
      Cand.Free;
      Exit;
    end;
    Tentei := Tentei + '   ' + Cand[i] + #13#10;
  end;
  Cand.Free;

  Resposta := SemBarraFinal(InputBox('AltiumPCBMirror',
    'Nao achei o workspace do AltiumPCBMirror nesta maquina.' + #13#10 +
    'Procurei o ' + HOME_MARCA + ' em:' + #13#10 + Tentei +
    'Digite a RAIZ do workspace (a pasta que tem o ' + HOME_MARCA + '):',
    '\\192.168.15.192\altiumhub\current'));
  if HomeValida(Resposta) then
  begin
    Result := Resposta;
    HomeOrigem := 'o caminho que voce digitou agora';
    HomeCfgAnota(Result);
    Exit;
  end;
  if Resposta <> '' then
    Tentei := Tentei + '   ' + Resposta + '   (o que voce digitou)' + #13#10;

  ShowMessage('Nao achei a raiz do workspace AltiumPCBMirror nesta maquina.' + #13#10 +
    'Procurei o ' + HOME_MARCA + ' em:' + #13#10 + Tentei + #13#10 +
    'Crie ou corrija ' + HOME_CFG + ' com a linha:' + #13#10 +
    '   home=<a pasta que tem o ' + HOME_MARCA + '>' + #13#10#13#10 +
    'NADA foi escrito.');
  Result := '';
end;

// Grava o arquivo e, se o Windows recusar, diz QUAL caminho falhou, DE ONDE esse caminho
// veio e o que fazer -- em vez da excecao crua do Delphi ("Cannot create file ... Acesso
// negado"), que nem sequer diz que o culpado e a raiz do workspace. False = nao gravou.
function SalvaOuExplica(L: TStringList; Caminho: String): Boolean;
begin
  Result := True;
  try
    L.SaveToFile(Caminho);
  except
    Result := False;
    // Nao afirme a causa: o Windows devolve "Acesso negado" tambem para arquivo aberto
    // noutro programa e para pasta sem permissao. Liste o que conferir, na ordem em que
    // costuma ser -- a raiz errada e de longe a primeira.
    ShowMessage('Nao consegui gravar:' + #13#10 + Caminho + #13#10#13#10 +
      'Raiz em uso: ' + SCRIPT_HOME + #13#10 +
      '   (veio de ' + HomeOrigem + ')' + #13#10#13#10 +
      'Confira, nesta ordem:' + #13#10 +
      '   1. essa raiz e mesmo a desta maquina? se nao, corrija a linha home= em' + #13#10 +
      '      ' + HOME_CFG + #13#10 +
      '   2. o arquivo esta aberto noutro programa?' + #13#10 +
      '   3. a pasta aceita gravacao do seu usuario?');
  end;
end;

{ ============================== fim HOME ============================== }

{ ======================= PROJ-HELPERS (workspace central) ======================= }

// nome do arquivo sem pasta e sem extensao
function BaseName(Path: String): String;
var
  s: String;
  p: Integer;
begin
  s := ExtractFileName(Path);
  p := Length(s);
  while (p > 0) and (s[p] <> '.') do
    p := p - 1;
  if p > 1 then
    s := Copy(s, 1, p - 1);
  Result := s;
end;

// StrToInt sem excecao (0 se invalido)
function SafeStrToInt(s: String): Integer;
var
  i: Integer;
begin
  Result := 0;
  s := Trim(s);
  if s = '' then
    Exit;
  for i := 1 to Length(s) do
  begin
    if (Ord(s[i]) < 48) or (Ord(s[i]) > 57) then
    begin
      Result := 0;
      Exit;
    end;
    Result := Result * 10 + (Ord(s[i]) - 48);
  end;
end;

// true se Projects\<Name> e uma pasta de projeto. Usa FileExists (primitiva provada
// neste engine); DirectoryExists entra so como reforco.
function ProjectDirExists(Name: String): Boolean;
var
  d: String;
begin
  d := PROJECTS_DIR + '\' + Name;
  Result := FileExists(d + '\schematic.js') or FileExists(d + '\board.js') or
            FileExists(d + '\changes.js') or FileExists(d + '\pcb-list.csv') or
            FileExists(d + '\build-report.txt') or FileExists(d + '\apply-report.txt') or
            DirectoryExists(d);
end;

// valor de "name":"..." numa linha do projects.js ('' se a linha nao tiver).
// DESFAZ os escapes \uXXXX gravados por JS(): sem isso um projeto com acento
// (ex. "Cartao" com til) nunca casa com a pasta e some do indice na regravacao.
function NameFieldOf(Line: String): String;
var
  p, l: Integer;
  Hex: String;
begin
  Result := '';
  p := Pos('"name":"', Line);
  if p = 0 then
    Exit;
  p := p + 8;
  l := Length(Line);
  while (p <= l) and (Line[p] <> '"') do
  begin
    if Line[p] = '\' then
    begin
      p := p + 1;
      if p > l then
        break;
      case Ord(Line[p]) of
        110:
          Result := Result + #10;
        116:
          Result := Result + #9;
        117:
          begin
            Hex := Copy(Line, p + 1, 4);
            Result := Result + Chr(StrToInt('$' + Hex));
            p := p + 4;
          end;
      else
        Result := Result + Line[p];
      end;
    end
    else
      Result := Result + Line[p];
    p := p + 1;
  end;
end;

procedure AddDirUnique(Dirs: TStringList; Name: String);
var
  i: Integer;
begin
  if Name = '' then
    Exit;
  for i := 0 to Dirs.Count - 1 do
    if AnsiCompareText(Dirs[i], Name) = 0 then
      Exit;
  Dirs.Add(Name);
end;

// Lista as pastas de Projects\.
// scan-v4: NAO depende de enumeracao (FindFirst nao lista pastas neste engine).
// Fonte primaria = nomes do proprio projects.js, cada um confirmado com FileExists;
// a varredura entra so como bonus, para achar pasta que ainda nao esta no indice.
procedure ListProjectDirs(Dirs: TStringList);
var
  Src: TStringList;
  SR: TSearchRec;
  i, r, nIdx, nScan: Integer;
  nm: String;
begin
  Dirs.Clear;
  nIdx := 0;
  if FileExists(SCRIPT_HOME + '\projects.js') then
  begin
    Src := TStringList.Create;
    Src.LoadFromFile(SCRIPT_HOME + '\projects.js');
    for i := 0 to Src.Count - 1 do
    begin
      nm := NameFieldOf(Src[i]);
      if (nm <> '') and ProjectDirExists(nm) then
      begin
        AddDirUnique(Dirs, nm);
        nIdx := nIdx + 1;
      end;
    end;
    Src.Free;
  end;
  nScan := 0;
  r := FindFirst(PROJECTS_DIR + '\*', faAnyFile, SR);
  while r = 0 do
  begin
    if (SR.Name <> '.') and (SR.Name <> '..') and ProjectDirExists(SR.Name) then
    begin
      AddDirUnique(Dirs, SR.Name);
      nScan := nScan + 1;
    end;
    r := FindNext(SR);
  end;
  FindClose(SR);
  Dirs.Sort;
  ScanInfo := 'scan-v4 indice=' + IntToStr(nIdx) + ' varredura=' + IntToStr(nScan) +
    ' total=' + IntToStr(Dirs.Count);
end;

// nome do projeto focado no Workspace ('' se nenhum / Free Documents)
function FocusedProjectName(Dummy: Integer): String;
var
  WS: IWorkspace;
  Prj: IProject;
begin
  Result := '';
  WS := GetWorkspace;
  if WS = nil then
    Exit;
  Prj := WS.DM_FocusedProject;
  if Prj = nil then
    Exit;
  Result := BaseName(Prj.DM_ProjectFileName);
  if Result = 'Free Documents' then
    Result := '';
end;

// Casa WantedName com uma pasta de Projects\ (case-insensitive).
// Nao achou: CreateIfMissing cria; senao pergunta com lista numerada. '' = cancelado.
function ResolveProjectDir(WantedName: String; CreateIfMissing: Boolean): String;
var
  Dirs: TStringList;
  i, Choice: Integer;
  ListStr, Answer: String;
begin
  Result := '';
  ForceDirectories(PROJECTS_DIR);
  // caminho rapido: casa pelo nome sem depender de listagem
  if (WantedName <> '') and ProjectDirExists(WantedName) then
  begin
    Result := PROJECTS_DIR + '\' + WantedName;
    Exit;
  end;
  Dirs := TStringList.Create;
  ListProjectDirs(Dirs);
  Dirs.Sort;
  if WantedName <> '' then
    for i := 0 to Dirs.Count - 1 do
      if AnsiCompareText(Dirs[i], WantedName) = 0 then
      begin
        Result := PROJECTS_DIR + '\' + Dirs[i];
        Dirs.Free;
        Exit;
      end;
  if CreateIfMissing and (WantedName <> '') then
  begin
    Result := PROJECTS_DIR + '\' + WantedName;
    ForceDirectories(Result);
    Dirs.Free;
    Exit;
  end;
  if Dirs.Count = 0 then
  begin
    Answer := Trim(InputBox('AltiumPCBMirror',
      'Nao consegui listar as pastas de ' + PROJECTS_DIR + '.' + #13#10 +
      '[' + ScanInfo + ']' + #13#10 +
      'Digite o NOME da pasta do projeto (ou cancele):', WantedName));
    if Answer = '' then
    begin
      Dirs.Free;
      Exit;
    end;
    if ProjectDirExists(Answer) then
      Result := PROJECTS_DIR + '\' + Answer
    else
      ShowMessage('Nao achei ' + PROJECTS_DIR + '\' + Answer);
    Dirs.Free;
    Exit;
  end;
  ListStr := 'Projeto "' + WantedName + '" nao encontrado em Projects\.' + #13#10 +
    'Digite o NUMERO do projeto a usar:' + #13#10;
  for i := 0 to Dirs.Count - 1 do
    ListStr := ListStr + IntToStr(i + 1) + ' = ' + Dirs[i] + #13#10;
  Answer := InputBox('AltiumPCBMirror', ListStr, '1');
  Choice := SafeStrToInt(Answer);
  if (Choice >= 1) and (Choice <= Dirs.Count) then
    Result := PROJECTS_DIR + '\' + Dirs[Choice - 1];
  Dirs.Free;
end;

// Regenera o indice projects.js varrendo Projects\
procedure RegenerateProjectsIndex(EnsureName: String);
var
  Dirs, Ou: TStringList;
  i: Integer;
  d, line: String;
  Gravou: Boolean;
begin
  Dirs := TStringList.Create;
  ListProjectDirs(Dirs);
  if (EnsureName <> '') and ProjectDirExists(EnsureName) then
    AddDirUnique(Dirs, EnsureName);
  Dirs.Sort;
  if Dirs.Count = 0 then
  begin
    Dirs.Free; // nada confirmado - preserva o indice atual em vez de zera-lo
    Exit;
  end;
  Ou := TStringList.Create;
  Ou.Add('var projects = [');
  for i := 0 to Dirs.Count - 1 do
  begin
    d := PROJECTS_DIR + '\' + Dirs[i];
    line := '{"name":' + JS(Dirs[i]) +
      ',"files":{"schematic":' + JB(FileExists(d + '\schematic.js')) +
      ',"board":' + JB(FileExists(d + '\board.js')) +
      ',"changes":' + JB(FileExists(d + '\changes.js')) +
      ',"buildreport":' + JB(FileExists(d + '\build-report.txt')) +
      ',"applyreport":' + JB(FileExists(d + '\apply-report.txt')) + '}' +
      ',"indexed":' + JS(DateTimeToStr(Now)) + '}';
    if i < Dirs.Count - 1 then
      line := line + ',';
    Ou.Add(line);
  end;
  Ou.Add('];');
  Gravou := SalvaOuExplica(Ou, SCRIPT_HOME + '\projects.js');
  Ou.Free;
  Dirs.Free;
end;
{ ===================== fim PROJ-HELPERS ===================== }

{ ------------------------------- mapeamentos Sch ------------------------------- }

// Medida da folha em mil.
//
// POR QUE ISTO EXISTE: o "A4" do Altium (estilo nomeado) mede 11500x7600 mil, mas os
// templates da casa sao folha CUSTOM do tamanho ISO de verdade (297x210 mm =
// 11693x8268). Mandando so o NOME do estilo, o hub desenhava 11500x7600 e o conteudo
// ia ate 11690x8270 - por isso apareciam componentes fora da pagina. Pior no
// PRJ-UR-DI261924, cuja folha e uma A3 custom (conteudo ate 16137x11011) exportada
// como "A4".
//
// Entao mandamos o numero, nao o nome. UseCustomSheet/CustomX/CustomY sao PROPRIEDADES
// (erro em tempo de execucao, nao de compilacao): cada uma em try/except, e se nada
// responder saem zeros e o hub cai na tabela por nome, como antes.
procedure SheetSizeMils(SchDoc: ISch_Document; var W: Double; var H: Double);
var
  Custom: Boolean;
begin
  W := 0;
  H := 0;
  Custom := False;
  try
    Custom := SchDoc.UseCustomSheet;
  except
    Custom := False;
  end;
  if Custom then
  begin
    try
      W := CoordToMils(SchDoc.CustomX);
      H := CoordToMils(SchDoc.CustomY);
    except
      W := 0;
      H := 0;
    end;
  end
  else
  begin
    // folha de estilo nomeado: o proprio Altium sabe dizer o retangulo dela
    try
      W := CoordToMils(SchDoc.SheetSizeX);
      H := CoordToMils(SchDoc.SheetSizeY);
    except
      W := 0;
      H := 0;
    end;
  end;
  if (W < 0) or (H < 0) then
  begin
    W := 0;
    H := 0;
  end;
end;

function SheetSizeName(style: Integer): String;
begin
  if style = eSheetA3 then
    Result := 'A3'
  else if style = eSheetA2 then
    Result := 'A2'
  else if style = eSheetA1 then
    Result := 'A1'
  else if style = eSheetA then
    Result := 'A'
  else if style = eSheetB then
    Result := 'B'
  else if style = eSheetC then
    Result := 'C'
  else
    Result := 'A4';
end;

function PowerStyleName(style: Integer): String;
begin
  if style = ePowerGndPower then
    Result := 'GndPower'
  else if style = ePowerGndSignal then
    Result := 'GndSignal'
  else if style = ePowerGndEarth then
    Result := 'GndEarth'
  else if style = ePowerCircle then
    Result := 'Circle'
  else if style = ePowerArrow then
    Result := 'Arrow'
  else if style = ePowerWave then
    Result := 'Wave'
  else
    Result := 'Bar';
end;

// NAO existe PortStyleName/PortIOName aqui, de proposito.
//
// A primeira versao usava constantes (ePortLeft, ePortNone_Vertical, ...) e o Altium
// recusou: "Undeclared identifier: ePortNone_Vertical". Nao ha, neste repositorio nem
// nesta maquina, fonte confiavel para os nomes dessas constantes - e cada chute custa
// uma rodada do usuario dentro do Altium.
//
// O inteiro cru nao tem esse problema: e exatamente o que o .SchDoc grava (|Style=4|,
// |IOType=3|), atravessa o espelho sem perda e volta igual pelo BuildSchematic, mesmo
// para um estilo que este script nao conheca. O significado de cada numero mora no
// AI-GUIDE e e preenchido conferindo um projeto real - nao chutando.

// footprint atual (modelo PCBLIB IsCurrent; senao o primeiro PCBLIB; senao '')
function CurrentFootprintOf(Comp: TObject): String;
var
  Iter, Impl: TObject;
  FirstFp: String;
begin
  Result := '';
  FirstFp := '';
  Iter := Comp.SchIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eImplementation));
  Impl := Iter.FirstSchObject;
  while Impl <> nil do
  begin
    if UpperCase(Impl.ModelType) = 'PCBLIB' then
    begin
      if FirstFp = '' then
        FirstFp := Impl.ModelName;
      if Impl.IsCurrent then
      begin
        Result := Impl.ModelName;
        break;
      end;
    end;
    Impl := Iter.NextSchObject;
  end;
  Comp.SchIterator_Destroy(Iter);
  if Result = '' then
    Result := FirstFp;
end;

// POR QUE OS PARAMETROS VOLTAM
//
// O componente do almoxarifado nasce na .SchLib com OdooId/ValorId/MPN/Encapsulamento
// declarados (schlib_escritor.py), e o BuildSchematic ja escreve o campo plano "params"
// como parametro do componente no Altium (AplicaParams). Faltava o caminho de VOLTA: sem
// ele o OdooId morria no primeiro round-trip, e a lista que o hub manda para o Odoo ficava
// sem o id da variante — o unico casamento que nao depende de texto.
//
// So a IDENTIDADE volta. Estoque, Local e Custo sao fotografia do almoxarifado, mudam
// sozinhos e fariam o schematic.js mudar a cada export sem que nada do desenho tenha
// mudado; quem sabe o saldo e o espelho das Libs, nao o esquema.
const
  PARAMS_IDENTIDADE = ';ODOOID;VALORID;MPN;ENCAPSULAMENTO;VALUE;MOUSER;';

// ';' e '=' sao os separadores do campo plano - dentro de um valor eles viram ','
// (mesma limpeza do schframe.js, para o que sai daqui voltar igual pelo BuildSchematic).
// A ASPA sai junto, e nao e preciosismo: o AI-GUIDE proibe a sequencia aspas-dois-pontos
// dentro de string, e o serializeSchematic do hub RECUSA O ARQUIVO INTEIRO quando a acha -
// um Value de display como  10.1": 1024 x 600  faria a vista Esquema nao salvar mais nada.
function ParamSafe(v: String): String;
begin
  Result := StringReplace(v, ';', ',', MkSet(rfReplaceAll));
  Result := StringReplace(Result, '=', ',', MkSet(rfReplaceAll));
  Result := StringReplace(Result, '|', ',', MkSet(rfReplaceAll));
  Result := StringReplace(Result, '"', '''', MkSet(rfReplaceAll));
end;

// "Chave=Valor;Chave=Valor" com os parametros de identidade do componente ('' se nenhum).
function ParamsOf(Comp: TObject): String;
var
  Iter, Par: TObject;
  Nome, Valor: String;
begin
  Result := '';
  Iter := Comp.SchIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eParameter));
  Par := Iter.FirstSchObject;
  while Par <> nil do
  begin
    Nome := Trim(Par.Name);
    Valor := Trim(Par.Text);
    // valor que comeca por '=' e formula nao resolvida do Altium: nao diz nada e nao casa
    if (Nome <> '') and (Valor <> '') and (Copy(Valor, 1, 1) <> '=') and
       (Pos(';' + UpperCase(Nome) + ';', PARAMS_IDENTIDADE) > 0) then
    begin
      if Result <> '' then
        Result := Result + ';';
      Result := Result + ParamSafe(Nome) + '=' + ParamSafe(Valor);
    end;
    Par := Iter.NextSchObject;
  end;
  Comp.SchIterator_Destroy(Iter);
end;

{ ------------------------------- carimbo da folha (template) ------------------------------- }

// POR QUE ESTE FILTRO EXISTE
// O carimbo da folha e feito de eLabel - os mesmos "DESEN.", "VERIF.", "=Revisao",
// "=Arquivo" que aparecem no rodape de todo desenho da casa - e o iterador de
// DOCUMENTO devolve esses rotulos junto com os textos que o projetista escreveu.
// Medido nos espelhos ja gravados em Projects\: 328 dos 416 itens {"t":"text"} sao
// carimbo (26 a 29 por folha), e em 6 das 14 folhas o texto exportado e 100%
// carimbo. Isso nao e o esquema: e a folha em que ele foi desenhado.
//
// COMO O ALTIUM MARCA O CARIMBO (lido nos .SchDoc reais, nao suposto)
// Aplicar um .SchDot grava no .SchDoc um registro |RECORD=39| (Template) com o
// caminho do template em FileName, e cada primitiva copiada dele recebe OwnerIndex
// apontando para esse registro. Medido em SCH - DI261924(A).SchDoc: 29 rotulos com
// OwnerIndex=1 (o RECORD=39 de A3_DiEletrons.SchDot) e 14 rotulos SEM OwnerIndex
// nenhum - ATERRAMENTO, CLOCK, MENU, +12V, DISPLAY... que sao do projetista e tem
// que continuar saindo. Mesma marcacao em SCH-LED-DI261898.SchDoc (29/29 com
// OwnerIndex=1) e no ESQUEMA_1.SchDoc do TCMS_Reader2 (26/26). A folha (RECORD=31)
// ainda guarda TemplateFileName e ShowTemplateGraphics.
//
// ARMADILHA: IsNotAccesible (a grafia com um 's' so e a da Altium) NAO serve. No
// arquivo real ele marca o desenho INTERNO dos simbolos e o proprio RECORD=39 - os
// filhos do template nao o carregam. Filtrar por ele deixaria o carimbo inteiro
// passar e ainda comeria o desenho dos componentes.
//
// DUAS SONDAS, NENHUMA ASSUMIDA
// A API de script nao publica OwnerIndex (ISch_GraphicalObject so expoe OwnerPartId
// e OwnerPartDisplayMode), entao o filtro reconstroi a mesma resposta por dois
// caminhos:
//   1) descer no objeto eTemplate da folha e listar os rotulos que pertencem a ele;
//   2) abrir o .SchDot que TemplateFileName aponta e casar os rotulos pelo texto.
// As duas rodam JUNTAS e o rotulo cai fora se QUALQUER uma o reconhecer - nao e
// cascata. O motivo: as duas so sabem descartar o que o proprio template entrega,
// entao nenhuma delas consegue comer um texto do projetista por engano, e somar as
// respostas so aumenta o alcance. Cascata teria um buraco silencioso: se a sonda 1
// achasse o objeto eTemplate mas devolvesse enderecos que nao casam com os do
// iterador de documento, ela "responderia" sem descartar nada e a 2 nunca correria.
// Se as duas falharem, a folha sai como antes (com carimbo) e o dialogo final
// avisa - nunca em silencio.
//
// EFEITO COLATERAL da sonda 2: ela abre o .SchDot no servidor de esquema (mesma
// primitiva que ja carrega as folhas do projeto) e nao o fecha - nao ha primitiva
// de fechar comprovada neste engine. O template pode ficar listado entre os
// documentos abertos do Altium; e so fechar na mao, nada e gravado nele.

// Chave de um rotulo: texto + posicao em Coord.
// NAO use I_ObjectAddress para isso. Neste engine ele volta como Dispatch e
// IntToStr estoura "EVariantTypeCastError: Could not convert variant of type
// (Dispatch) into type (Boolean)" - medido, no primeiro rotulo do carimbo.
// Texto+posicao e a mesma chave que o BuildSchematic ja usa em FindLabelAt, e
// serve melhor aqui: nao depende de o iterador do template e o do documento
// devolverem o MESMO wrapper para o mesmo objeto.
function LabelKey(L: TObject): String;
begin
  Result := L.Text + '|' + IntToStr(L.Location.X) + '|' + IntToStr(L.Location.Y);
end;

// Sonda 1: os rotulos que pertencem ao objeto eTemplate da folha.
function StampByTemplateObject(SchDoc: ISch_Document; Keys: TStringList): Integer;
var
  DocIter, TplIter, Tpl, L: TObject;
begin
  Result := 0;
  DocIter := nil;
  try
    DocIter := SchDoc.SchIterator_Create;
  except
    DocIter := nil;
  end;
  if DocIter = nil then
    Exit;
  try
    DocIter.AddFilter_ObjectSet(MkSet(eTemplate));
    Tpl := DocIter.FirstSchObject;
    while Tpl <> nil do
    begin
      TplIter := nil;
      try
        TplIter := Tpl.SchIterator_Create;
      except
        TplIter := nil;
      end;
      if TplIter <> nil then
      begin
        TplIter.AddFilter_ObjectSet(MkSet(eLabel));
        L := TplIter.FirstSchObject;
        while L <> nil do
        begin
          Keys.Add(LabelKey(L));
          Result := Result + 1;
          L := TplIter.NextSchObject;
        end;
        Tpl.SchIterator_Destroy(TplIter);
      end;
      Tpl := DocIter.NextSchObject;
    end;
  except
    // engine que nao aceita eTemplate no filtro, ou que nao desce no template:
    // fica com o que deu e a sonda 2 assume
  end;
  SchDoc.SchIterator_Destroy(DocIter);
end;

// Sonda 2: os textos dos rotulos do .SchDot que a folha aponta em TemplateFileName.
// Cacheado entre folhas - um projeto costuma usar um template so (e as folhas A3 e
// A4 da casa tem carimbos diferentes, dai o cache ser por caminho e nao por projeto).
function LoadStampTexts(SchDoc: ISch_Document): Integer;
var
  Path: String;
  TplDoc: ISch_Document;
  Iter, L: TObject;
begin
  Result := 0;
  Path := '';
  try
    Path := SchDoc.TemplateFileName;
  except
    Path := '';
  end;
  Path := Trim(Path);
  if Path = '' then
  begin
    TplPath := '';
    TplTexts.Clear;
    Exit;
  end;
  if AnsiCompareText(Path, TplPath) = 0 then
  begin
    Result := TplTexts.Count;
    Exit;
  end;
  TplPath := '';
  TplTexts.Clear;
  if not FileExists(Path) then
    Exit; // template numa maquina que este PC nao enxerga
  TplDoc := nil;
  try
    TplDoc := SchServer.GetSchDocumentByPath(Path);
    if TplDoc = nil then
      TplDoc := SchServer.LoadSchDocumentByPath(Path);
  except
    TplDoc := nil;
  end;
  if TplDoc = nil then
    Exit;
  Iter := TplDoc.SchIterator_Create;
  if Iter = nil then
    Exit;
  Iter.AddFilter_ObjectSet(MkSet(eLabel));
  L := Iter.FirstSchObject;
  while L <> nil do
  begin
    if TplTexts.IndexOf(L.Text) < 0 then
      TplTexts.Add(L.Text);
    L := Iter.NextSchObject;
  end;
  TplDoc.SchIterator_Destroy(Iter);
  TplPath := Path;
  Result := TplTexts.Count;
end;

// Roda as duas sondas nesta folha e anota quem trouxe material.
procedure PrepareStampFilter(SchDoc: ISch_Document);
var
  nObj, nTpl: Integer;
begin
  StampKeys.Clear;
  nObj := StampByTemplateObject(SchDoc, StampKeys);
  nTpl := LoadStampTexts(SchDoc); // deixa TplTexts em dia com o template DESTA folha
  if nObj > 0 then
    StampByObj := StampByObj + 1;
  if nTpl > 0 then
    StampByTpl := StampByTpl + 1;
  if (nObj = 0) and (nTpl = 0) then
    StampBlind := StampBlind + 1;
end;

// True se este eLabel e do carimbo - e portanto nao entra no espelho.
// Basta uma das sondas reconhecer: as duas so apontam o que o template entregou.
function IsStampLabel(Prim: TObject): Boolean;
begin
  Result := False;
  if StampKeys.Count > 0 then
    Result := StampKeys.IndexOf(LabelKey(Prim)) >= 0;
  if (not Result) and (TplTexts.Count > 0) then
    Result := TplTexts.IndexOf(Prim.Text) >= 0;
end;

{ ------------------------------- exportacao de uma folha ------------------------------- }

procedure ExportSheet(Path: String; ItemsL: TStringList);
var
  SchDoc: ISch_Document;
  Iterator, Prim: TObject;
  SheetName, s, pts, CompPars: String;
  PortNome: String;
  PortCor: String;                       // ',"fill":...' montado so com o que o Altium deu
  PortSty, PortIo: Integer;
  PortFill, PortTxt, PortBrd: Integer;   // TColor BGR; -1 = a propriedade nao foi lida
  PortW, ShW, ShH: Double;
  k: Integer;
begin
  SchDoc := SchServer.GetSchDocumentByPath(Path);
  if SchDoc = nil then
    SchDoc := SchServer.LoadSchDocumentByPath(Path);
  if SchDoc = nil then
  begin
    SkippedDocs := SkippedDocs + 1;
    Exit;
  end;
  SheetName := BaseName(Path);
  PrepareStampFilter(SchDoc);

  // w/h = medida medida no Altium; 0 quer dizer "nao consegui ler" e o hub cai na
  // tabela por nome. O size continua saindo: serve de rotulo e de compatibilidade.
  SheetSizeMils(SchDoc, ShW, ShH);
  if (ShW > 0) and (ShH > 0) then
    SheetsMeasured := SheetsMeasured + 1;
  AddItem(ItemsL, '{"t":"sheet","name":' + JS(SheetName) +
    ',"size":' + JS(SheetSizeName(SchDoc.SheetStyle)) +
    ',"w":' + JF(ShW) + ',"h":' + JF(ShH) + '}');

  Iterator := SchDoc.SchIterator_Create;
  Iterator.AddFilter_ObjectSet(MkSet(eSchComponent, eWire, eNetLabel, ePowerObject, ePort, eJunction, eNoERC, eLabel));
  Prim := Iterator.FirstSchObject;
  while Prim <> nil do
  begin
    case Prim.ObjectId of
      eSchComponent:
        begin
          NComp := NComp + 1;
          CompPars := ParamsOf(Prim);
          if CompPars <> '' then
            NCompPar := NCompPar + 1;
          s := '{"t":"comp","sheet":' + JS(SheetName) +
            ',"ref":' + JS(Prim.Designator.Text) +
            ',"sym":' + JS(Prim.LibReference) +
            ',"part":' + IntToStr(Prim.CurrentPartID) +
            ',"x":' + ML(Prim.Location.X) +
            ',"y":' + ML(Prim.Location.Y) +
            ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) +
            ',"mirror":' + JB(Prim.IsMirrored) +
            ',"footprint":' + JS(CurrentFootprintOf(Prim)) +
            ',"comment":' + JS(Prim.Comment.Text);
          // omitido quando vazio: o campo e novo e o schematic.js de projeto antigo nao o tem
          if CompPars <> '' then
            s := s + ',"params":' + JS(CompPars);
          AddItem(ItemsL, s + '}');
        end;
      eWire:
        begin
          NWire := NWire + 1;
          pts := '';
          for k := 1 to Prim.VerticesCount do
          begin
            if pts <> '' then
              pts := pts + ',';
            pts := pts + '[' + ML(Prim.Vertex[k].X) + ',' + ML(Prim.Vertex[k].Y) + ']';
          end;
          AddItem(ItemsL, '{"t":"wire","sheet":' + JS(SheetName) + ',"pts":[' + pts + ']}');
        end;
      eNetLabel:
        begin
          NLabel := NLabel + 1;
          AddItem(ItemsL, '{"t":"netlabel","sheet":' + JS(SheetName) +
            ',"net":' + JS(Prim.Text) +
            ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
            ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) + '}');
        end;
      ePowerObject:
        begin
          NPower := NPower + 1;
          AddItem(ItemsL, '{"t":"power","sheet":' + JS(SheetName) +
            ',"net":' + JS(Prim.Text) +
            ',"style":' + JS(PowerStyleName(Prim.Style)) +
            ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
            ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) + '}');
        end;
      // A Port e o conector de folha do Altium: uma palavra numa barra com bico. Ela nao
      // usa .Text como o rotulo e o power - o nome mora em .Name - e nao tem Orientation:
      // a direcao vem do Style. As tres propriedades novas (Name/Style/IOType/Width) vao
      // dentro de try/except uma a uma: se esta instalacao do Altium nao publicar alguma,
      // a folha inteira NAO pode parar de exportar por causa disso.
      ePort:
        begin
          NPort := NPort + 1;
          PortNome := '';
          PortSty := -1;
          PortIo := -1;
          PortW := 400;
          try
            PortNome := Prim.Name;
          except
            if PortWarn = '' then PortWarn := 'Name';
          end;
          try
            PortSty := Prim.Style;
          except
            if PortWarn = '' then PortWarn := 'Style';
          end;
          try
            PortIo := Prim.IOType;
          except
            if PortWarn = '' then PortWarn := 'IOType';
          end;
          try
            PortW := CoordToMils(Prim.Width);
          except
            if PortWarn = '' then PortWarn := 'Width';
          end;
          // Cores: sao a APARENCIA que o usuario escolheu no Altium (a port da casa e
          // amarela com letra preta). Cada uma na sua sonda - se esta instalacao nao
          // publicar TextColor, ainda assim o preenchimento vai. Campo omitido = o hub
          // desenha com o padrao dele, que e melhor que gravar cor inventada.
          PortFill := -1;
          PortTxt := -1;
          PortBrd := -1;
          try
            PortFill := Prim.AreaColor;
          except
            if PortWarn = '' then PortWarn := 'AreaColor';
          end;
          try
            PortTxt := Prim.TextColor;
          except
            if PortWarn = '' then PortWarn := 'TextColor';
          end;
          try
            PortBrd := Prim.Color;
          except
            if PortWarn = '' then PortWarn := 'Color';
          end;
          PortCor := '';
          if PortFill >= 0 then
            PortCor := PortCor + ',"fill":' + JS(HexDeCor(PortFill));
          if PortTxt >= 0 then
            PortCor := PortCor + ',"textColor":' + JS(HexDeCor(PortTxt));
          if PortBrd >= 0 then
            PortCor := PortCor + ',"color":' + JS(HexDeCor(PortBrd));
          AddItem(ItemsL, '{"t":"port","sheet":' + JS(SheetName) +
            ',"net":' + JS(PortNome) +
            ',"io":' + IntToStr(PortIo) +
            ',"style":' + IntToStr(PortSty) +
            ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
            ',"w":' + JF(PortW) + PortCor + '}');
        end;
      eJunction:
        begin
          NJunc := NJunc + 1;
          AddItem(ItemsL, '{"t":"junction","sheet":' + JS(SheetName) +
            ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) + '}');
        end;
      // A diretiva No ERC: o X vermelho que diz "este pino fica solto DE PROPOSITO".
      // So a ancora viaja. O SIMBOLO (cruz fina/grossa/circulo) e a cor ficam de fora ate
      // serem MEDIDOS num Altium de verdade: o mesmo cuidado que a Port ensinou — la, usar
      // as constantes nomeadas custou um "Undeclared identifier" e uma rodada perdida.
      eNoERC:
        begin
          NNoErc := NNoErc + 1;
          AddItem(ItemsL, '{"t":"noerc","sheet":' + JS(SheetName) +
            ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) + '}');
        end;
      eLabel:
        begin
          if IsStampLabel(Prim) then
            StampDropped := StampDropped + 1
          else
          begin
            NText := NText + 1;
            AddItem(ItemsL, '{"t":"text","sheet":' + JS(SheetName) +
              ',"s":' + JS(Prim.Text) +
              ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
              ',"h":10}');
          end;
        end;
    end;
    Prim := Iterator.NextSchObject;
  end;
  SchDoc.SchIterator_Destroy(Iterator);
end;

{ ------------------------------- rotina principal ------------------------------- }

procedure ExportSch;
var
  WS: IWorkspace;
  Prj: IProject;
  Doc: IDocument;
  i, SheetCount: Integer;
  ProjName, OutDir, CarimboTxt, ItensTxt: String;
  ItemsL, OutL: TStringList;
  Gravou: Boolean;
begin
  // Raiz do workspace DESTA maquina: PRIMEIRA coisa do procedimento, porque tudo abaixo
  // depende dela (ResolveProjectDir, ListProjectDirs, o indice projects.js).
  SCRIPT_HOME := HubHome(0);
  if SCRIPT_HOME = '' then
    Exit;
  PROJECTS_DIR := SCRIPT_HOME + '\Projects';

  if SchServer = nil then
  begin
    ShowMessage('SchServer indisponivel. Abra um esquema no Altium e rode de novo.');
    Exit;
  end;
  WS := GetWorkspace;
  if WS = nil then
  begin
    ShowMessage('Workspace indisponivel.');
    Exit;
  end;
  Prj := WS.DM_FocusedProject;
  if (Prj = nil) or (BaseName(Prj.DM_ProjectFileName) = 'Free Documents') then
  begin
    ShowMessage('Nenhum projeto focado. Abra o .PrjPcb e rode de novo.');
    Exit;
  end;
  ProjName := BaseName(Prj.DM_ProjectFileName);
  OutDir := ResolveProjectDir(ProjName, True);
  if OutDir = '' then
    Exit;

  SkippedDocs := 0;
  SheetCount := 0;
  StampDropped := 0;
  NComp := 0; NWire := 0; NLabel := 0; NPower := 0; NPort := 0; NJunc := 0; NText := 0; NNoErc := 0;
  NCompPar := 0;
  SheetsMeasured := 0;
  PortWarn := '';
  StampByObj := 0;
  StampByTpl := 0;
  StampBlind := 0;
  TplPath := '';
  StampKeys := TStringList.Create;
  TplTexts := TStringList.Create;
  ItemsL := TStringList.Create;
  for i := 0 to Prj.DM_LogicalDocumentCount - 1 do
  begin
    Doc := Prj.DM_LogicalDocuments(i);
    if Doc.DM_DocumentKind = 'SCH' then
    begin
      SheetCount := SheetCount + 1;
      ExportSheet(Doc.DM_FullPath, ItemsL);
    end;
  end;

  if SheetCount = 0 then
  begin
    ShowMessage('O projeto "' + ProjName + '" nao tem documentos de esquema (.SchDoc).');
    ItemsL.Free;
    StampKeys.Free;
    TplTexts.Free;
    Exit;
  end;

  OutL := TStringList.Create;
  OutL.Add('var schematic = {');
  OutL.Add('"format":"schmirror-v2",');
  OutL.Add('"project":' + JS(ProjName) + ',');
  OutL.Add('"generated":' + JS(DateTimeToStr(Now)) + ',');
  OutL.Add('"units":"mil",');
  OutL.Add('"items":[');
  OutL.AddStrings(ItemsL);
  OutL.Add(']};');
  Gravou := SalvaOuExplica(OutL, OutDir + '\schematic.js');
  OutL.Free;
  ItemsL.Free;
  StampKeys.Free;
  TplTexts.Free;
  // Nao gravou: SalvaOuExplica ja disse qual caminho falhou e de onde ele veio.
  // Sai sem mexer no indice e sem anunciar espelho que nao existe.
  if not Gravou then
    Exit;

  RegenerateProjectsIndex(ProjName);

  // O carimbo entra no relatorio porque o filtro dele depende de duas sondas que a
  // doc da Altium nao garante (ver o bloco "carimbo da folha"). Dizer quantos
  // rotulos sairam e por qual caminho e o que separa "filtrou" de "achei que filtrou".
  CarimboTxt := 'Carimbo: ' + IntToStr(StampDropped) + ' rotulos de template fora do espelho' +
    #13#10 + '   (sonda do objeto eTemplate respondeu em ' + IntToStr(StampByObj) +
    ' folha(s); a do .SchDot em ' + IntToStr(StampByTpl) + ')';
  if StampBlind > 0 then
    CarimboTxt := CarimboTxt + #13#10 +
      '   ATENCAO: em ' + IntToStr(StampBlind) + ' folha(s) nenhuma sonda respondeu -' +
      #13#10 + '   o carimbo dessas saiu junto no schematic.js.';

  ItensTxt := 'Itens: ' + IntToStr(NComp) + ' comp, ' + IntToStr(NWire) + ' fio, ' +
    IntToStr(NLabel) + ' rotulo, ' + IntToStr(NPower) + ' power, ' +
    IntToStr(NPort) + ' port, ' + IntToStr(NJunc) + ' juncao, ' + IntToStr(NNoErc) + ' no-erc, ' + IntToStr(NText) + ' texto';
  if NComp > 0 then
    ItensTxt := ItensTxt + #13#10 + '   ' + IntToStr(NCompPar) + ' de ' + IntToStr(NComp) +
      ' item(ns) comp com parametro de identidade (OdooId/MPN) - e o que a' +
      #13#10 + '   lista para o Odoo usa para achar o produto sem depender de texto.' +
      #13#10 + '   (um componente multi-parte conta uma vez por parte, como o resto desta linha)';
  if SheetsMeasured < SheetCount then
    ItensTxt := ItensTxt + #13#10 +
      '   ATENCAO: em ' + IntToStr(SheetCount - SheetsMeasured) + ' folha(s) o Altium nao' +
      #13#10 + '   informou a medida; o hub vai desenhar pelo nome do estilo e pode' +
      #13#10 + '   mostrar componente fora da pagina.';
  if PortWarn <> '' then
    ItensTxt := ItensTxt + #13#10 +
      '   ATENCAO: esta instalacao do Altium recusou a propriedade "' + PortWarn +
      '" da Port;' + #13#10 + '   as ports sairam com o valor padrao nesse campo.';

  ShowMessage('Esquema espelhado em:' + #13#10 + OutDir + '\schematic.js' + #13#10#13#10 +
    'Folhas: ' + IntToStr(SheetCount) +
    '   (nao abertas/puladas: ' + IntToStr(SkippedDocs) + ')' + #13#10 +
    ItensTxt + #13#10 +
    CarimboTxt + #13#10#13#10 +
    'PCB: rode o ExportBoard com o .PcbDoc focado.' + #13#10 +
    'Confira no hub.html (vista Esquema).');
end;
