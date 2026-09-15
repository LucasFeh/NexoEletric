{ ..................................................................................................................... }
{ .  AltiumPCBMirror - ExportBoard.pas                                                                                . }
{ .                                                                                                                   . }
{ .  Exporta a PCB ABERTA no Altium Designer para "Projects\<nome do projeto>\":                                      . }
{ .    - board.js       : espelho completo e fiel da placa (componentes, pads, trilhas, arcos, vias, silk, contorno)  . }
{ .    - changes.js     : arquivo de mudancas (criado vazio apenas se nao existir - NUNCA sobrescrito)                . }
{ .    - AI-GUIDE.md    : guia para a sessao de IA (copiado de SCRIPT_HOME)                                           . }
{ .    - pcb-list.csv   : snapshot tipo "PCB List" (TSV: Designator/Footprint/Comment/Layer/X/Y/Rotation)             . }
{ .                                                                                                                   . }
{ .  CONTRATO DE COORDENADAS (fidelidade com o Altium - NAO ALTERAR):                                                 . }
{ .    - mm, eixo Y PARA CIMA, relativo a origem da placa (Board.XOrigin/YOrigin)                                     . }
{ .    - exatamente os numeros exibidos na barra de status / Properties / PCB List do Altium                          . }
{ .    - rotacao em graus anti-horario, valor bruto de Component.Rotation                                             . }
{ .                                                                                                                   . }
{ .  Como executar: DXP >> Run Script >> ExportBoard  (com um .PcbDoc aberto e focado)                                . }
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
  FORMAT_ID = 'pcbmirror-v1';

var
  // Preenchidas por HubHome(0) na PRIMEIRA linha do procedimento principal. Eram const,
  // e const nao se reatribui em DelphiScript - por isso estao aqui. Nada que use as duas
  // pode rodar antes daquela linha (ResolveProjectDir, ListProjectDirs, o indice...).
  SCRIPT_HOME: String;
  PROJECTS_DIR: String;
  HomeOrigem: String;  // de onde veio SCRIPT_HOME; sai na mensagem de erro de gravacao
  Board: IPCB_Board;
  ScanInfo: String; // diagnostico do ultimo ListProjectDirs (aparece nos dialogos)
  Nets: TStringList;

{ ..................................................................................................................... }
{ .                                              Helpers JSON / numeros                                               . }
{ ..................................................................................................................... }

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
      34: // "
        Result := Result + '\"';
      92: // \
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

// Coordenada X absoluta interna -> mm relativo a origem da placa (SEM inversao)
function CX(v: Integer): String;
begin
  Result := JF(CoordToMMs(v - Board.XOrigin));
end;

// Coordenada Y absoluta interna -> mm relativo a origem da placa (SEM inversao - Y para cima, como no Altium)
function CY(v: Integer): String;
begin
  Result := JF(CoordToMMs(v - Board.YOrigin));
end;

// Dimensao (largura/diametro/raio) -> mm
function CW(v: Integer): String;
begin
  Result := JF(CoordToMMs(v));
end;

function LayerNameOf(L: TLayer): String;
begin
  if L = eTopLayer then
    Result := 'Top'
  else if L = eBottomLayer then
    Result := 'Bottom'
  else if L = eTopOverlay then
    Result := 'TopOverlay'
  else if L = eBottomOverlay then
    Result := 'BottomOverlay'
  else if L = eMultiLayer then
    Result := 'Multi'
  else if L = eMechanical1 then
    Result := 'Mech1'
  else if L = eKeepOutLayer then
    Result := 'KeepOut'
  else
    Result := 'L' + IntToStr(L);
end;

function NetNameOf(Prim: TObject): String;
begin
  Result := '';
  if Prim.Net <> nil then
    Result := Prim.Net.Name;
  if Result <> '' then
    Nets.Add(Result);
end;

function OwnerRefOf(Prim: TObject): String;
begin
  Result := '';
  if Prim.Component <> nil then
    Result := Prim.Component.Name.Text;
end;

// Acrescenta um item (objeto JSON em uma linha) a uma secao, cuidando das virgulas
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

  Cand := TStringList.Create;
  Cand.Add('D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror');
  Cand.Add('\\LUCAS-PC\D\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror');
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
    'D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror'));
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
      ',"annotations":' + JB(FileExists(d + '\annotations.js')) +
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

{ ..................................................................................................................... }
{ .                                            Serializacao de primitivas                                             . }
{ ..................................................................................................................... }

function PadJSON(Pad: TObject; Id: String): String;
var
  s: String;
  PadType, PadShape, DrillShape: String;
  W, H: String;
  ShapeCode: Integer;
  Radius: String;
begin
  Radius := '';

  if Pad.Layer = eTopLayer then
  begin
    PadType := 'smd';
    W := CW(Pad.TopXSize);
    H := CW(Pad.TopYSize);
    ShapeCode := Pad.TopShape;
  end
  else if Pad.Layer = eBottomLayer then
  begin
    PadType := 'smd';
    W := CW(Pad.BotXSize);
    H := CW(Pad.BotYSize);
    ShapeCode := Pad.BotShape;
  end
  else
  begin
    PadType := 'th';
    W := CW(Pad.TopXSize);
    H := CW(Pad.TopYSize);
    ShapeCode := Pad.TopShape;
  end;

  PadShape := 'circle';
  case ShapeCode of
    1:
      begin
        if W = H then
          PadShape := 'circle'
        else
          PadShape := 'oval';
      end;
    2:
      PadShape := 'rect';
    3:
      PadShape := 'octagon';
    9:
      begin
        PadShape := 'roundrect';
        Radius := CW(Pad.CornerRadius(Pad.Layer));
      end;
  end;

  s := '{"id":' + JS(Id);
  s := s + ',"name":' + JS(Pad.Name);
  s := s + ',"layer":' + JS(LayerNameOf(Pad.Layer));
  s := s + ',"type":' + JS(PadType);
  s := s + ',"shape":' + JS(PadShape);
  if Radius <> '' then
    s := s + ',"radius":' + Radius;
  s := s + ',"x":' + CX(Pad.x);
  s := s + ',"y":' + CY(Pad.y);
  s := s + ',"w":' + W;
  s := s + ',"h":' + H;
  s := s + ',"rot":' + JF(Pad.Rotation);

  if PadType = 'th' then
  begin
    DrillShape := 'circle';
    case Pad.HoleType of
      1:
        DrillShape := 'rect';
      2:
        DrillShape := 'oblong';
    end;
    s := s + ',"drillshape":' + JS(DrillShape);
    if Pad.HoleType = 0 then
      s := s + ',"drill":' + CW(Pad.HoleSize)
    else
    begin
      s := s + ',"drill":' + CW(Pad.HoleSize);
      s := s + ',"drillw":' + CW(Pad.HoleWidth);
    end;
    s := s + ',"holerot":' + JF(Pad.HoleRotation);
  end;

  s := s + ',"net":' + JS(NetNameOf(Pad));
  s := s + '}';
  Result := s;
end;

function ComponentJSON(Comp: TObject; Id: String): String;
var
  s: String;
  Iter, Prim: TObject;
  PadCount, PadIdx: Integer;
  PadsStr: String;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"ref":' + JS(Comp.Name.Text);
  s := s + ',"footprint":' + JS(Comp.Pattern);
  s := s + ',"comment":' + JS(Comp.Comment.Text);
  s := s + ',"layer":' + JS(LayerNameOf(Comp.Layer));
  s := s + ',"x":' + CX(Comp.x);
  s := s + ',"y":' + CY(Comp.y);
  s := s + ',"rot":' + JF(Comp.Rotation);

  s := s + ',"bbox":{"x1":' + CX(Comp.BoundingRectangleNoNameCommentForSignals.Left) +
    ',"y1":' + CY(Comp.BoundingRectangleNoNameCommentForSignals.Bottom) +
    ',"x2":' + CX(Comp.BoundingRectangleNoNameCommentForSignals.Right) +
    ',"y2":' + CY(Comp.BoundingRectangleNoNameCommentForSignals.Top) + '}';

  PadsStr := '';
  PadIdx := 0;
  Iter := Comp.GroupIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(ePadObject));
  Iter.AddFilter_LayerSet(AllLayers);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    PadIdx := PadIdx + 1;
    if PadsStr <> '' then
      PadsStr := PadsStr + ',';
    PadsStr := PadsStr + PadJSON(Prim, Id + 'p' + IntToStr(PadIdx));
    Prim := Iter.NextPCBObject;
  end;
  Comp.GroupIterator_Destroy(Iter);

  s := s + ',"pads":[' + PadsStr + ']';
  s := s + '}';
  Result := s;
end;

function TrackJSON(Prim: TObject; Id: String): String;
var
  s, Owner: String;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"layer":' + JS(LayerNameOf(Prim.Layer));
  s := s + ',"x1":' + CX(Prim.X1);
  s := s + ',"y1":' + CY(Prim.Y1);
  s := s + ',"x2":' + CX(Prim.X2);
  s := s + ',"y2":' + CY(Prim.Y2);
  s := s + ',"w":' + CW(Prim.Width);
  s := s + ',"net":' + JS(NetNameOf(Prim));
  Owner := OwnerRefOf(Prim);
  if Owner <> '' then
    s := s + ',"owner":' + JS(Owner);
  s := s + '}';
  Result := s;
end;

function ArcJSON(Prim: TObject; Id: String): String;
var
  s, Owner: String;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"layer":' + JS(LayerNameOf(Prim.Layer));
  s := s + ',"cx":' + CX(Prim.XCenter);
  s := s + ',"cy":' + CY(Prim.YCenter);
  s := s + ',"r":' + CW(Prim.Radius);
  s := s + ',"sa":' + JF(Prim.StartAngle);
  s := s + ',"ea":' + JF(Prim.EndAngle);
  s := s + ',"w":' + CW(Prim.LineWidth);
  s := s + ',"net":' + JS(NetNameOf(Prim));
  Owner := OwnerRefOf(Prim);
  if Owner <> '' then
    s := s + ',"owner":' + JS(Owner);
  s := s + '}';
  Result := s;
end;

function ViaJSON(Prim: TObject; Id: String): String;
var
  s: String;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"x":' + CX(Prim.x);
  s := s + ',"y":' + CY(Prim.y);
  s := s + ',"size":' + CW(Prim.Size);
  s := s + ',"drill":' + CW(Prim.HoleSize);
  s := s + ',"from":' + JS(LayerNameOf(Prim.LowLayer));
  s := s + ',"to":' + JS(LayerNameOf(Prim.HighLayer));
  s := s + ',"net":' + JS(NetNameOf(Prim));
  s := s + '}';
  Result := s;
end;

function TextJSON(Prim: TObject; Id: String): String;
var
  s, Owner: String;
  X1, Y1, X2, Y2: Double;
begin
  X1 := CoordToMMs(Prim.BoundingRectangleForSelection.Left - Board.XOrigin);
  Y1 := CoordToMMs(Prim.BoundingRectangleForSelection.Bottom - Board.YOrigin);
  X2 := CoordToMMs(Prim.BoundingRectangleForSelection.Right - Board.XOrigin);
  Y2 := CoordToMMs(Prim.BoundingRectangleForSelection.Top - Board.YOrigin);

  s := '{"id":' + JS(Id);
  s := s + ',"layer":' + JS(LayerNameOf(Prim.Layer));
  // centro do bounding box (Y para cima)
  s := s + ',"x":' + JF((X1 + X2) / 2);
  s := s + ',"y":' + JF((Y1 + Y2) / 2);
  s := s + ',"text":' + JS(Prim.Text);
  s := s + ',"h":' + CW(Prim.Size);
  s := s + ',"rot":' + JF(Prim.Rotation);
  s := s + ',"mirror":' + JB(Prim.MirrorFlag);
  s := s + ',"designator":' + JB(Prim.IsDesignator);
  s := s + ',"comment":' + JB(Prim.IsComment);
  Owner := OwnerRefOf(Prim);
  if Owner <> '' then
    s := s + ',"owner":' + JS(Owner);
  s := s + '}';
  Result := s;
end;

function SilkLineJSON(Prim: TObject; Id: String): String;
var
  s, Owner: String;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"layer":' + JS(LayerNameOf(Prim.Layer));
  s := s + ',"kind":"line"';
  s := s + ',"x1":' + CX(Prim.X1);
  s := s + ',"y1":' + CY(Prim.Y1);
  s := s + ',"x2":' + CX(Prim.X2);
  s := s + ',"y2":' + CY(Prim.Y2);
  s := s + ',"w":' + CW(Prim.Width);
  Owner := OwnerRefOf(Prim);
  if Owner <> '' then
    s := s + ',"owner":' + JS(Owner);
  s := s + '}';
  Result := s;
end;

function SilkArcJSON(Prim: TObject; Id: String): String;
var
  s, Owner: String;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"layer":' + JS(LayerNameOf(Prim.Layer));
  s := s + ',"kind":"arc"';
  s := s + ',"cx":' + CX(Prim.XCenter);
  s := s + ',"cy":' + CY(Prim.YCenter);
  s := s + ',"r":' + CW(Prim.Radius);
  s := s + ',"sa":' + JF(Prim.StartAngle);
  s := s + ',"ea":' + JF(Prim.EndAngle);
  s := s + ',"w":' + CW(Prim.LineWidth);
  Owner := OwnerRefOf(Prim);
  if Owner <> '' then
    s := s + ',"owner":' + JS(Owner);
  s := s + '}';
  Result := s;
end;

// Contorno principal de uma region (ou de cada region-filha de um poligono)
function ContourJSON(RegionPrim: TObject; Id, NetStr: String): String;
var
  s: String;
  contour: IPCB_Contour;
  k: Integer;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"layer":' + JS(LayerNameOf(RegionPrim.Layer));
  s := s + ',"net":' + JS(NetStr);
  s := s + ',"points":[';
  contour := RegionPrim.GetMainContour();
  for k := 0 to contour.Count - 1 do
  begin
    if k > 0 then
      s := s + ',';
    s := s + '[' + CX(contour.GetState_PointX(k)) + ',' + CY(contour.GetState_PointY(k)) + ']';
  end;
  s := s + ']}';
  Result := s;
end;

// Recorte da placa (Board Cutout): furo de fixacao, janela, rasgo. Como a region de cobre,
// o contorno ja vem achatado pelo Altium - um furo redondo sai como poligono de ~37 pontos.
// Sem "net": recorte e ausencia de material, nao tem ligacao eletrica.
function CutoutJSON(RegionPrim: TObject; Id: String): String;
var
  s: String;
  contour: IPCB_Contour;
  k: Integer;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"layer":' + JS(LayerNameOf(RegionPrim.Layer));
  // `layer` e `incomp` ficam no JSON porque sao o que sobra para separar um Board Cutout de
  // um recorte de poligono: o API desta versao nao expoe IsBoardCutout nem o nome do Kind.
  s := s + ',"incomp":' + JB(RegionPrim.InComponent);
  s := s + ',"points":[';
  contour := RegionPrim.GetMainContour();
  for k := 0 to contour.Count - 1 do
  begin
    if k > 0 then
      s := s + ',';
    s := s + '[' + CX(contour.GetState_PointX(k)) + ',' + CY(contour.GetState_PointY(k)) + ']';
  end;
  s := s + ']}';
  Result := s;
end;

{ ..................................................................................................................... }
{ .                                                Contorno da placa                                                  . }
{ ..................................................................................................................... }

function OutlineJSON(Dummy: Integer): String;
var
  s: String;
  BO: TObject;
  i, j: Integer;
begin
  s := '';
  BO := Board.BoardOutline;
  if BO = nil then
  begin
    Result := '';
    Exit;
  end;

  for i := 0 to BO.PointCount - 1 do
  begin
    j := (i + 1) mod BO.PointCount;
    if s <> '' then
      s := s + ',';
    if BO.Segments[i].Kind = ePolySegmentLine then
    begin
      s := s + '{"kind":"line","x1":' + CX(BO.Segments[i].vx) + ',"y1":' + CY(BO.Segments[i].vy) +
        ',"x2":' + CX(BO.Segments[j].vx) + ',"y2":' + CY(BO.Segments[j].vy) + '}';
    end
    else
    begin
      s := s + '{"kind":"arc","cx":' + CX(BO.Segments[i].cx) + ',"cy":' + CY(BO.Segments[i].cy) +
        ',"r":' + CW(BO.Segments[i].Radius) + ',"sa":' + JF(BO.Segments[i].Angle1) +
        ',"ea":' + JF(BO.Segments[i].Angle2) + '}';
    end;
  end;
  Result := s;
end;

{ ..................................................................................................................... }
{ .                                              Utilitarios de arquivo                                               . }
{ ..................................................................................................................... }

// Exporta o contorno de cada region-filha de um poligono despejado
procedure Iter2PolyRegions(Poly: TObject; RegionL: TStringList; var RegionIdx: Integer);
var
  GIter, Child: TObject;
  NetStr: String;
begin
  NetStr := '';
  if Poly.Net <> nil then
    NetStr := Poly.Net.Name;
  if NetStr <> '' then
    Nets.Add(NetStr);

  GIter := Poly.GroupIterator_Create;
  Child := GIter.FirstPCBObject;
  while Child <> nil do
  begin
    if Child.ObjectId = eRegionObject then
    begin
      RegionIdx := RegionIdx + 1;
      AddItem(RegionL, ContourJSON(Child, 'g' + IntToStr(RegionIdx), NetStr));
    end;
    Child := GIter.NextPCBObject;
  end;
  Poly.GroupIterator_Destroy(GIter);
end;

{ ..................................................................................................................... }
{ .                                                Rotina principal                                                   . }
{ ..................................................................................................................... }

procedure ExportPcb;
var
  OutDir: String;
  ProjName: String;
  Iter, Prim: TObject;
  CompL, FreePadL, TrackL, ArcL, ViaL, TextL, SilkL, RegionL, CutoutL, CsvL, OutL: TStringList;
  CompIdx, PadIdx, TrackIdx, ArcIdx, ViaIdx, TextIdx, SilkIdx, RegionIdx, CutoutIdx: Integer;
  i: Integer;
  s, Id: String;
  Gravou: Boolean;
begin
  // Raiz do workspace DESTA maquina: PRIMEIRA coisa do procedimento, porque tudo abaixo
  // depende dela (ResolveProjectDir, ListProjectDirs, o indice projects.js).
  SCRIPT_HOME := HubHome(0);
  if SCRIPT_HOME = '' then
    Exit;
  PROJECTS_DIR := SCRIPT_HOME + '\Projects';

  Board := PCBServer.GetCurrentPCBBoard;
  if Board = nil then
  begin
    ShowMessage('Nenhum documento PCB aberto/focado. Abra o .PcbDoc e rode novamente.');
    Exit;
  end;

  ProjName := FocusedProjectName(0);
  if ProjName = '' then
    ProjName := BaseName(Board.FileName);
  OutDir := ResolveProjectDir(ProjName, True);
  if OutDir = '' then
    Exit;

  Nets := TStringList.Create;
  Nets.Sorted := True;
  Nets.Duplicates := dupIgnore;

  CompL := TStringList.Create;
  FreePadL := TStringList.Create;
  TrackL := TStringList.Create;
  ArcL := TStringList.Create;
  ViaL := TStringList.Create;
  TextL := TStringList.Create;
  SilkL := TStringList.Create;
  RegionL := TStringList.Create;
  CutoutL := TStringList.Create;
  CsvL := TStringList.Create;

  CompIdx := 0;
  PadIdx := 0;
  TrackIdx := 0;
  ArcIdx := 0;
  ViaIdx := 0;
  TextIdx := 0;
  SilkIdx := 0;
  RegionIdx := 0;
  CutoutIdx := 0;

  // ------------------------------------------------------------------ componentes
  CsvL.Add('Designator' + #9 + 'Footprint' + #9 + 'Comment' + #9 + 'Layer' + #9 + 'X_mm' + #9 + 'Y_mm' + #9 + 'Rotation');

  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eComponentObject));
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    CompIdx := CompIdx + 1;
    Id := 'c' + IntToStr(CompIdx);
    AddItem(CompL, ComponentJSON(Prim, Id));

    CsvL.Add(Prim.Name.Text + #9 + Prim.Pattern + #9 + Prim.Comment.Text + #9 +
      LayerNameOf(Prim.Layer) + #9 + CX(Prim.x) + #9 + CY(Prim.y) + #9 + JF(Prim.Rotation));

    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);

  // ------------------------------------------------------------------ pads livres (furos de fixacao, NPTH...)
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(ePadObject));
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    if not Prim.InComponent then
    begin
      PadIdx := PadIdx + 1;
      AddItem(FreePadL, PadJSON(Prim, 'p' + IntToStr(PadIdx)));
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);

  // ------------------------------------------------------------------ cobre, overlay, vias, textos, regioes
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_LayerSet(MkSet(eTopLayer, eBottomLayer, eTopOverlay, eBottomOverlay, eMultiLayer));
  Iter.AddFilter_ObjectSet(MkSet(eTrackObject, eArcObject, eViaObject, eTextObject, eRegionObject, ePolyObject));
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    case Prim.ObjectId of
      eTrackObject:
        begin
          if (Prim.Layer = eTopLayer) or (Prim.Layer = eBottomLayer) then
          begin
            TrackIdx := TrackIdx + 1;
            AddItem(TrackL, TrackJSON(Prim, 't' + IntToStr(TrackIdx)));
          end
          else if (Prim.Layer = eTopOverlay) or (Prim.Layer = eBottomOverlay) then
          begin
            SilkIdx := SilkIdx + 1;
            AddItem(SilkL, SilkLineJSON(Prim, 's' + IntToStr(SilkIdx)));
          end;
        end;
      eArcObject:
        begin
          if (Prim.Layer = eTopLayer) or (Prim.Layer = eBottomLayer) then
          begin
            ArcIdx := ArcIdx + 1;
            AddItem(ArcL, ArcJSON(Prim, 'a' + IntToStr(ArcIdx)));
          end
          else if (Prim.Layer = eTopOverlay) or (Prim.Layer = eBottomOverlay) then
          begin
            SilkIdx := SilkIdx + 1;
            AddItem(SilkL, SilkArcJSON(Prim, 's' + IntToStr(SilkIdx)));
          end;
        end;
      eViaObject:
        begin
          ViaIdx := ViaIdx + 1;
          AddItem(ViaL, ViaJSON(Prim, 'v' + IntToStr(ViaIdx)));
        end;
      eTextObject:
        begin
          if not Prim.IsHidden then
          begin
            TextIdx := TextIdx + 1;
            AddItem(TextL, TextJSON(Prim, 'x' + IntToStr(TextIdx)));
          end;
        end;
      eRegionObject:
        begin
          // Region que NAO e de cobre e recorte: Board Cutout (o furo de fixacao), recorte de
          // poligono, cavidade. O Kind() e o unico discriminador que serve aqui - a camada nao
          // serve (o API reporta o Board Cutout na Multi, nao na Keep-Out, apesar de
          // LAYER=KEEPOUT no arquivo) e IPCB_Region.IsBoardCutout nao existe neste PCB API.
          // Este laco JA via os recortes: ontem a placa tinha 66 regions e exportou 62, e a
          // diferenca eram exatamente os 4 furos caindo fora do teste de cobre abaixo.
          if (Prim.Kind() = eRegionKind_Copper) and (not Prim.InPolygon()) then
          begin
            RegionIdx := RegionIdx + 1;
            AddItem(RegionL, ContourJSON(Prim, 'g' + IntToStr(RegionIdx), NetNameOf(Prim)));
          end
          else if Prim.Kind() <> eRegionKind_Copper then
          begin
            CutoutIdx := CutoutIdx + 1;
            AddItem(CutoutL, CutoutJSON(Prim, 'k' + IntToStr(CutoutIdx)));
          end;
        end;
      ePolyObject:
        begin
          if (Prim.Layer = eTopLayer) or (Prim.Layer = eBottomLayer) then
          begin
            // poligono despejado: exporta o contorno de cada region-filha
            Iter2PolyRegions(Prim, RegionL, RegionIdx);
          end;
        end;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);

  // ------------------------------------------------------------------ montagem do board.js
  OutL := TStringList.Create;
  OutL.Add('var pcbmirror = {');
  OutL.Add('"format":' + JS(FORMAT_ID) + ',');
  OutL.Add('"generated":' + JS(DateTimeToStr(Now)) + ',');
  OutL.Add('"source":' + JS(Board.FileName) + ',');
  OutL.Add('"units":"mm",');
  OutL.Add('"axis":"y-up",');
  OutL.Add('"origin_note":"coordenadas em mm relativas a origem da placa (Board.XOrigin/YOrigin), Y para cima - identicas ao PCB List / Properties do Altium",');

  OutL.Add('"board":{"bbox":{"x1":' + CX(Board.BoardOutline.BoundingRectangle.Left) +
    ',"y1":' + CY(Board.BoardOutline.BoundingRectangle.Bottom) +
    ',"x2":' + CX(Board.BoardOutline.BoundingRectangle.Right) +
    ',"y2":' + CY(Board.BoardOutline.BoundingRectangle.Top) + '},');
  OutL.Add('"outline":[' + OutlineJSON(0) + ']},');

  OutL.Add('"nets":[');
  for i := 0 to Nets.Count - 1 do
  begin
    if i > 0 then
      OutL.Add(',' + JS(Nets[i]))
    else
      OutL.Add(JS(Nets[i]));
  end;
  OutL.Add('],');

  OutL.Add('"components":[');
  OutL.AddStrings(CompL);
  OutL.Add('],');

  OutL.Add('"freepads":[');
  OutL.AddStrings(FreePadL);
  OutL.Add('],');

  OutL.Add('"tracks":[');
  OutL.AddStrings(TrackL);
  OutL.Add('],');

  OutL.Add('"arcs":[');
  OutL.AddStrings(ArcL);
  OutL.Add('],');

  OutL.Add('"vias":[');
  OutL.AddStrings(ViaL);
  OutL.Add('],');

  OutL.Add('"texts":[');
  OutL.AddStrings(TextL);
  OutL.Add('],');

  OutL.Add('"silk":[');
  OutL.AddStrings(SilkL);
  OutL.Add('],');

  OutL.Add('"regions":[');
  OutL.AddStrings(RegionL);
  OutL.Add('],');

  OutL.Add('"cutouts":[');
  OutL.AddStrings(CutoutL);
  OutL.Add('],');

  OutL.Add('"stats":{"components":' + IntToStr(CompIdx) + ',"freepads":' + IntToStr(PadIdx) +
    ',"tracks":' + IntToStr(TrackIdx) + ',"arcs":' + IntToStr(ArcIdx) + ',"vias":' + IntToStr(ViaIdx) +
    ',"texts":' + IntToStr(TextIdx) + ',"silk":' + IntToStr(SilkIdx) + ',"regions":' + IntToStr(RegionIdx) +
    ',"cutouts":' + IntToStr(CutoutIdx) + '}');
  OutL.Add('};');

  // O board.js e o primeiro arquivo a ir para o disco: raiz errada aparece AQUI.
  // Os tres seguintes so sao tentados se este passou - senao seriam quatro dialogos
  // repetindo a mesma coisa.
  Gravou := SalvaOuExplica(OutL, OutDir + '\board.js');

  // ------------------------------------------------------------------ changes.js (apenas se nao existir)
  if Gravou and (not FileExists(OutDir + '\changes.js')) then
  begin
    OutL.Clear;
    OutL.Add('// AltiumPCBMirror - arquivo de mudancas.');
    OutL.Add('// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.');
    OutL.Add('var changes = [');
    OutL.Add('];');
    Gravou := SalvaOuExplica(OutL, OutDir + '\changes.js');
  end;

  // ------------------------------------------------------------------ annotations.js (apenas se nao existir)
  if Gravou and (not FileExists(OutDir + '\annotations.js')) then
  begin
    OutL.Clear;
    OutL.Add('// AltiumPCBMirror - sinalizadores do usuario para a IA. Um objeto JSON por linha.');
    OutL.Add('// A IA le, corrige via changes.js e marca status resolved + reply. Consulte AI-GUIDE.md Parte C.');
    OutL.Add('var annotations = [');
    OutL.Add('];');
    Gravou := SalvaOuExplica(OutL, OutDir + '\annotations.js');
  end;

  // ------------------------------------------------------------------ pcb-list.csv
  if Gravou then
    Gravou := SalvaOuExplica(CsvL, OutDir + '\pcb-list.csv');

  if Gravou then
    RegenerateProjectsIndex(ProjName);

  s := 'Exportacao concluida em:' + #13#10 + OutDir + #13#10#13#10 +
    'Componentes: ' + IntToStr(CompIdx) + #13#10 +
    'Trilhas: ' + IntToStr(TrackIdx) + '   Arcos: ' + IntToStr(ArcIdx) + '   Vias: ' + IntToStr(ViaIdx) + #13#10 +
    'Silk: ' + IntToStr(SilkIdx) + '   Textos: ' + IntToStr(TextIdx) + '   Regioes: ' + IntToStr(RegionIdx) + #13#10 +
    'Pads livres: ' + IntToStr(PadIdx) + #13#10#13#10 +
    'Confira no hub.html (vista PCB).';
  // Falhou alguma gravacao: SalvaOuExplica ja explicou. Nao anuncia sucesso por cima.
  if Gravou then
    ShowMessage(s);

  CompL.Free;
  FreePadL.Free;
  TrackL.Free;
  ArcL.Free;
  ViaL.Free;
  TextL.Free;
  SilkL.Free;
  RegionL.Free;
  CutoutL.Free;
  CsvL.Free;
  OutL.Free;
  Nets.Free;
end;
