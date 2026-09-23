{ ..................................................................................................................... }
{ .  AltiumPCBMirror - ApplyChanges.pas                                                                               . }
{ .                                                                                                                   . }
{ .  Le Projects\<nome do projeto>\changes.js e aplica as mudancas na placa:                                          . }
{ .    comp_move | track_edit | track_add | track_del | via_edit | via_add | via_del | arc_edit | arc_add |           . }
{ .    arc_del | text_edit | designator_move | outline_set                                                            . }
{ .                                                                                                                   . }
{ .  Seguranca:                                                                                                       . }
{ .    - Toda edicao/remocao exige campos orig_* (copiados do board.js). O objeto real so e alterado se casar         . }
{ .      com o original (tolerancia 0.001 mm) - protege contra placa dessincronizada do espelho.                      . }
{ .    - Tudo roda dentro de PCBServer.PreProcess/PostProcess: UM unico undo desfaz a aplicacao inteira.              . }
{ .    - Relatorio detalhado em Projects\<nome>\apply-report.txt.                                                     . }
{ .                                                                                                                   . }
{ .  CONTRATO DE COORDENADAS: mm, Y para cima, relativo a origem da placa - identico ao board.js / PCB List.          . }
{ .                                                                                                                   . }
{ .  Como executar: DXP >> Run Script >> ApplyChanges  (com o .PcbDoc aberto e focado)                                . }
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
  TOL_MM = 0.001;

var
  // Preenchidas por HubHome(0) na PRIMEIRA linha do procedimento principal. Eram const,
  // e const nao se reatribui em DelphiScript - por isso estao aqui. Nada que use as duas
  // pode rodar antes daquela linha (ResolveProjectDir, ListProjectDirs, o indice...).
  SCRIPT_HOME: String;
  PROJECTS_DIR: String;
  HomeOrigem: String;  // de onde veio SCRIPT_HOME; sai na mensagem de erro de gravacao
  Board: IPCB_Board;
  Report: TStringList;
  OkCount, FailCount: Integer;
  ScanInfo: String; // diagnostico do ultimo ListProjectDirs (aparece nos dialogos)

{ ..................................................................................................................... }
{ .                                          Parsing de JSON plano por linha                                          . }
{ ..................................................................................................................... }

// Converte string com ponto decimal (e expoente opcional) em Double, sem depender de locale
function StrToFloatDot(s: String): Double;
var
  i, ExpV: Integer;
  Neg, NegExp, InFrac, InExp: Boolean;
  IntPart, FracInt, FracDiv: Double;
begin
  IntPart := 0;
  FracInt := 0;
  FracDiv := 1;
  ExpV := 0;
  Neg := False;
  NegExp := False;
  InFrac := False;
  InExp := False;

  s := Trim(s);
  for i := 1 to Length(s) do
  begin
    case Ord(s[i]) of
      43: ; // '+'
      45: // '-'
        begin
          if InExp then
            NegExp := True
          else
            Neg := True;
        end;
      46: // '.'
        InFrac := True;
      69, 101: // 'E', 'e'
        InExp := True;
      48 .. 57: // digitos
        begin
          if InExp then
            ExpV := ExpV * 10 + (Ord(s[i]) - 48)
          else if InFrac then
          begin
            FracDiv := FracDiv * 10;
            FracInt := FracInt * 10 + (Ord(s[i]) - 48);
          end
          else
            IntPart := IntPart * 10 + (Ord(s[i]) - 48);
        end;
    end;
  end;

  Result := IntPart + FracInt / FracDiv;
  if Neg then
    Result := -Result;
  if InExp then
  begin
    for i := 1 to ExpV do
    begin
      if NegExp then
        Result := Result / 10
      else
        Result := Result * 10;
    end;
  end;
end;

// Retorna o valor bruto de "Key": na linha ('' se ausente). Strings voltam sem aspas e com escapes resolvidos.
function JGet(Line, Key: String): String;
var
  p, l: Integer;
  Hex: String;
begin
  Result := '';
  p := Pos('"' + Key + '":', Line);
  if p = 0 then
    Exit;
  p := p + Length(Key) + 3;
  l := Length(Line);
  while (p <= l) and (Line[p] = ' ') do
    p := p + 1;
  if p > l then
    Exit;

  if Line[p] = '"' then
  begin
    p := p + 1;
    while p <= l do
    begin
      if Line[p] = '\' then
      begin
        p := p + 1;
        if p > l then
          break;
        case Ord(Line[p]) of
          110: // n
            Result := Result + #10;
          116: // t
            Result := Result + #9;
          117: // uXXXX
            begin
              Hex := Copy(Line, p + 1, 4);
              Result := Result + Chr(StrToInt('$' + Hex));
              p := p + 4;
            end;
        else
          Result := Result + Line[p];
        end;
      end
      else if Line[p] = '"' then
        break
      else
        Result := Result + Line[p];
      p := p + 1;
    end;
  end
  else
  begin
    while (p <= l) and (Line[p] <> ',') and (Line[p] <> '}') do
    begin
      Result := Result + Line[p];
      p := p + 1;
    end;
    Result := Trim(Result);
  end;
end;

function JHas(Line, Key: String): Boolean;
begin
  Result := Pos('"' + Key + '":', Line) <> 0;
end;

function JNum(Line, Key: String): Double;
begin
  Result := StrToFloatDot(JGet(Line, Key));
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

// Os dois enderecos que sairam em 2026-09-15: o share da bancada e o disco dela. Estao
// nomeados aqui de proposito -- a migracao la embaixo toca NESTES DOIS e em mais nenhum
// outro home=, que continua mandando como sempre mandou.
function RaizAposentada(Raiz: String): Boolean;
begin
  Result := (CompareText(Raiz, '\\LUCAS-PC\D\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror') = 0)
         or (CompareText(Raiz, 'D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror') = 0);
end;

// O primeiro nome do servidor que responde AGORA. '' se nenhum responde -- e ai a migracao
// NAO acontece: trocar uma configuracao quebrada por outra quebrada seria so embaralhar.
// Tem parametro de proposito: some do menu Run Script.
function ServidorValido(Dummy: Integer): String;
begin
  Result := '';
  if HomeValida('\\192.168.15.192\altiumhub\current') then
  begin
    Result := '\\192.168.15.192\altiumhub\current';
    Exit;
  end;
  if HomeValida('\\ODOO\altiumhub\current') then
    Result := '\\ODOO\altiumhub\current';
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
  Raiz, Resposta, Tentei, Novo: String;
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
    // MIGRACAO 2026-09-15, e e o UNICO caso em que uma linha home= existente e trocada.
    //
    // A regra de cima vale porque `home=` costuma ser escolha de quem configurou. So que
    // ela tambem e escrita pelo PROPRIO script (HomeCfgAnota, quando um candidato valida),
    // e ate 2026-09-15 o primeiro candidato era a bancada. Quem rodou antes disso tem um
    // carimbo apontando para la -- e a regra honraria esse carimbo para sempre. Foi assim
    // que uma exportacao disparada do servidor foi gravar no D: de outra maquina.
    //
    // Consertar o proprio carimbo errado nao e configuracao que se reescreve sozinha: os
    // dois caminhos estao nomeados em RaizAposentada, a troca so acontece com o servidor
    // respondendo, e a tela diz o que mudou e como desfazer.
    if RaizAposentada(Raiz) then
    begin
      Novo := ServidorValido(0);
      if Novo <> '' then
      begin
        ShowMessage('O ' + HOME_CFG + ' ainda apontava para:' + #13#10 +
          '   ' + Raiz + #13#10#13#10 +
          'Esse endereco saiu: o workspace agora vem do servidor. Passei a usar' + #13#10 +
          '   ' + Novo + #13#10 +
          'e anotei isso no arquivo -- esta rodada ja vai para la.' + #13#10#13#10 +
          'Se voce quer mesmo o caminho antigo, edite a linha home= nesse arquivo:' + #13#10 +
          '   ' + HOME_CFG);
        HomeOrigem := HOME_CFG + ' (migrado do endereco antigo)';
        HomeCfgAnota(Novo);
        Result := Novo;
        Exit;
      end;
    end;
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

// Confirmacao digitada (o ApplyChanges chamava ConfirmNoYes sem nunca defini-la,
// o que estouraria no outline_set). Usa so primitivas provadas neste engine.
function ConfirmNoYes(Msg: String): Boolean;
var
  s: String;
begin
  s := Trim(InputBox('AltiumPCBMirror', Msg + #13#10#13#10 + 'Digite SIM para confirmar:', ''));
  Result := (AnsiCompareText(s, 'SIM') = 0);
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

// Extrai "pts":[[x,y],[x,y],...] da linha -> TStringList de 'x|y' (strings numericas)
function ParsePts(Line: String): TStringList;
var
  p, i, Depth: Integer;
  Body, Cur, c: String;
begin
  Result := TStringList.Create;
  p := Pos('"pts":[', Line);
  if p = 0 then
    Exit;
  i := p + 7;
  Depth := 1;
  Body := '';
  while (i <= Length(Line)) and (Depth > 0) do
  begin
    c := Line[i];
    if c = '[' then
      Depth := Depth + 1
    else if c = ']' then
      Depth := Depth - 1;
    if Depth > 0 then
      Body := Body + c;
    i := i + 1;
  end;
  Cur := '';
  for i := 1 to Length(Body) do
  begin
    c := Body[i];
    if c = '[' then
      Cur := ''
    else if c = ']' then
    begin
      p := Pos(',', Cur);
      if p > 0 then
        Result.Add(Copy(Cur, 1, p - 1) + '|' + Copy(Cur, p + 1, 255));
    end
    else if c <> ' ' then
      Cur := Cur + c;
  end;
end;

{ ..................................................................................................................... }
{ .                                        Conversoes e comparacoes de geometria                                      . }
{ ..................................................................................................................... }

// mm relativo a origem -> coordenada interna absoluta
function MMX(v: Double): Integer;
begin
  Result := MMsToCoord(v) + Board.XOrigin;
end;

function MMY(v: Double): Integer;
begin
  Result := MMsToCoord(v) + Board.YOrigin;
end;

// coordenada interna absoluta -> mm relativo a origem
function XMM(v: Integer): Double;
begin
  Result := CoordToMMs(v - Board.XOrigin);
end;

function YMM(v: Integer): Double;
begin
  Result := CoordToMMs(v - Board.YOrigin);
end;

function NearMM(a, b: Double): Boolean;
begin
  Result := Abs(a - b) <= TOL_MM;
end;

function NearAngle(a, b: Double): Boolean;
var
  d: Double;
begin
  d := Abs(a - b);
  while d >= 360 do
    d := d - 360;
  if d > 180 then
    d := 360 - d;
  Result := d <= 0.01;
end;

function LayerFromName(Name: String): TLayer;
begin
  Result := 0;
  if Name = 'Top' then
    Result := eTopLayer
  else if Name = 'Bottom' then
    Result := eBottomLayer
  else if Name = 'TopOverlay' then
    Result := eTopOverlay
  else if Name = 'BottomOverlay' then
    Result := eBottomOverlay
  else if Name = 'Multi' then
    Result := eMultiLayer
  else if Name = 'Mech1' then
    Result := eMechanical1
  else if Name = 'KeepOut' then
    Result := eKeepOutLayer;
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

{ ..................................................................................................................... }
{ .                                            Localizacao de objetos reais                                           . }
{ ..................................................................................................................... }

function FindComponent(Ref: String): IPCB_Component;
var
  Iter, Prim: TObject;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eComponentObject));
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    if Prim.Name.Text = Ref then
    begin
      Result := Prim;
      break;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

function FindNet(Name: String): IPCB_Net;
var
  Iter, Prim: TObject;
begin
  Result := nil;
  if Name = '' then
    Exit;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eNetObject));
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    if Prim.Name = Name then
    begin
      Result := Prim;
      break;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

// Trilha cujo (x1,y1)-(x2,y2)/largura/camada casam com os orig_* (qualquer direcao)
function FindTrack(L: TLayer; X1, Y1, X2, Y2, W: Double): IPCB_Track;
var
  Iter, Prim: TObject;
  ax1, ay1, ax2, ay2: Double;
  DirectHit, ReverseHit: Boolean;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eTrackObject));
  Iter.AddFilter_LayerSet(MkSet(L));
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    ax1 := XMM(Prim.X1);
    ay1 := YMM(Prim.Y1);
    ax2 := XMM(Prim.X2);
    ay2 := YMM(Prim.Y2);
    DirectHit := NearMM(ax1, X1) and NearMM(ay1, Y1) and NearMM(ax2, X2) and NearMM(ay2, Y2);
    ReverseHit := NearMM(ax1, X2) and NearMM(ay1, Y2) and NearMM(ax2, X1) and NearMM(ay2, Y1);
    if (DirectHit or ReverseHit) and NearMM(CoordToMMs(Prim.Width), W) then
    begin
      Result := Prim;
      break;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

function FindVia(x, Y: Double): IPCB_Via;
var
  Iter, Prim: TObject;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eViaObject));
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    if NearMM(XMM(Prim.x), x) and NearMM(YMM(Prim.y), Y) then
    begin
      Result := Prim;
      break;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

function FindArc(L: TLayer; cx, cy, r, sa, ea: Double): IPCB_Arc;
var
  Iter, Prim: TObject;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eArcObject));
  Iter.AddFilter_LayerSet(MkSet(L));
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    if NearMM(XMM(Prim.XCenter), cx) and NearMM(YMM(Prim.YCenter), cy) and
      NearMM(CoordToMMs(Prim.Radius), r) and NearAngle(Prim.StartAngle, sa) and
      NearAngle(Prim.EndAngle, ea) then
    begin
      Result := Prim;
      break;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

// Texto livre (nao designator/comment de footprint) cujo CENTRO do bounding box e o
// conteudo casam com os orig_* do board.js (o x/y exportado e o centro do bounding box)
function FindFreeText(L: TLayer; X, Y: Double; Txt: String): IPCB_Text;
var
  Iter, Prim: TObject;
  cx, cy: Double;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eTextObject));
  Iter.AddFilter_LayerSet(MkSet(L));
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    if (not Prim.IsDesignator) and (not Prim.IsComment) and (Prim.Text = Txt) then
    begin
      cx := (XMM(Prim.BoundingRectangleForSelection.Left) + XMM(Prim.BoundingRectangleForSelection.Right)) / 2;
      cy := (YMM(Prim.BoundingRectangleForSelection.Bottom) + YMM(Prim.BoundingRectangleForSelection.Top)) / 2;
      if NearMM(cx, X) and NearMM(cy, Y) then
      begin
        Result := Prim;
        break;
      end;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

{ ..................................................................................................................... }
{ .                                                Relatorio                                                          . }
{ ..................................................................................................................... }

procedure LogOk(Msg: String);
begin
  OkCount := OkCount + 1;
  Report.Add('[OK]    ' + Msg);
end;

procedure LogFail(Msg: String);
begin
  FailCount := FailCount + 1;
  Report.Add('[FALHA] ' + Msg);
end;

{ ..................................................................................................................... }
{ .                                            Aplicacao de cada operacao                                             . }
{ ..................................................................................................................... }

procedure DoCompMove(Line: String);
var
  Ref, LayerStr, OrigLayerStr: String;
  Comp: IPCB_Component;
  NewLayer: TLayer;
begin
  Ref := JGet(Line, 'ref');
  Comp := FindComponent(Ref);
  if Comp = nil then
  begin
    LogFail('comp_move ' + Ref + ': componente nao encontrado');
    Exit;
  end;

  if not (JHas(Line, 'orig_x') and JHas(Line, 'orig_y') and JHas(Line, 'orig_rot') and JHas(Line, 'orig_layer')) then
  begin
    LogFail('comp_move ' + Ref + ': faltam campos orig_* (copie do board.js)');
    Exit;
  end;

  OrigLayerStr := JGet(Line, 'orig_layer');
  if not (NearMM(XMM(Comp.x), JNum(Line, 'orig_x')) and NearMM(YMM(Comp.y), JNum(Line, 'orig_y')) and
    NearAngle(Comp.Rotation, JNum(Line, 'orig_rot')) and (LayerNameOf(Comp.Layer) = OrigLayerStr)) then
  begin
    LogFail('comp_move ' + Ref + ': estado atual da placa nao casa com orig_* (re-exporte o espelho)');
    Exit;
  end;

  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);

  if JHas(Line, 'layer') then
  begin
    LayerStr := JGet(Line, 'layer');
    NewLayer := LayerFromName(LayerStr);
    if ((NewLayer = eTopLayer) or (NewLayer = eBottomLayer)) and (NewLayer <> Comp.Layer) then
      Comp.Layer := NewLayer;
  end;

  if JHas(Line, 'rot') then
    Comp.Rotation := JNum(Line, 'rot');

  Comp.MoveToXY(MMX(JNum(Line, 'x')), MMY(JNum(Line, 'y')));

  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Comp.GraphicallyInvalidate;

  LogOk('comp_move ' + Ref + ' -> x=' + JGet(Line, 'x') + ' y=' + JGet(Line, 'y') + ' rot=' + JGet(Line, 'rot'));
end;

function RequireTrackOrig(Line, What: String): IPCB_Track;
var
  L: TLayer;
begin
  Result := nil;
  if not (JHas(Line, 'orig_x1') and JHas(Line, 'orig_y1') and JHas(Line, 'orig_x2') and
    JHas(Line, 'orig_y2') and JHas(Line, 'orig_w') and JHas(Line, 'orig_layer')) then
  begin
    LogFail(What + ': faltam campos orig_* (copie do board.js)');
    Exit;
  end;
  L := LayerFromName(JGet(Line, 'orig_layer'));
  if L = 0 then
  begin
    LogFail(What + ': orig_layer invalida "' + JGet(Line, 'orig_layer') + '"');
    Exit;
  end;
  Result := FindTrack(L, JNum(Line, 'orig_x1'), JNum(Line, 'orig_y1'), JNum(Line, 'orig_x2'),
    JNum(Line, 'orig_y2'), JNum(Line, 'orig_w'));
  if Result = nil then
    LogFail(What + ': trilha original nao encontrada na placa (re-exporte o espelho)');
end;

procedure DoTrackEdit(Line: String);
var
  Track: IPCB_Track;
  What: String;
  L: TLayer;
  Net: IPCB_Net;
begin
  What := 'track_edit ' + JGet(Line, 'id');
  Track := RequireTrackOrig(Line, What);
  if Track = nil then
    Exit;

  PCBServer.SendMessageToRobots(Track.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JHas(Line, 'x1') then
    Track.X1 := MMX(JNum(Line, 'x1'));
  if JHas(Line, 'y1') then
    Track.Y1 := MMY(JNum(Line, 'y1'));
  if JHas(Line, 'x2') then
    Track.X2 := MMX(JNum(Line, 'x2'));
  if JHas(Line, 'y2') then
    Track.Y2 := MMY(JNum(Line, 'y2'));
  if JHas(Line, 'w') then
    Track.Width := MMsToCoord(JNum(Line, 'w'));
  if JHas(Line, 'layer') then
  begin
    L := LayerFromName(JGet(Line, 'layer'));
    if (L = eTopLayer) or (L = eBottomLayer) then
      Track.Layer := L;
  end;
  if JHas(Line, 'net') then
  begin
    Net := FindNet(JGet(Line, 'net'));
    if Net <> nil then
      Track.Net := Net;
  end;
  PCBServer.SendMessageToRobots(Track.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Track.GraphicallyInvalidate;
  LogOk(What);
end;

procedure DoTrackAdd(Line: String);
var
  Track: IPCB_Track;
  L: TLayer;
  Net: IPCB_Net;
  NetStr: String;
begin
  L := LayerFromName(JGet(Line, 'layer'));
  if (L <> eTopLayer) and (L <> eBottomLayer) then
  begin
    LogFail('track_add: camada invalida "' + JGet(Line, 'layer') + '" (use Top ou Bottom)');
    Exit;
  end;
  if not (JHas(Line, 'x1') and JHas(Line, 'y1') and JHas(Line, 'x2') and JHas(Line, 'y2') and JHas(Line, 'w')) then
  begin
    LogFail('track_add: faltam campos x1/y1/x2/y2/w');
    Exit;
  end;

  Track := PCBServer.PCBObjectFactory(eTrackObject, eNoDimension, eCreate_Default);
  Track.X1 := MMX(JNum(Line, 'x1'));
  Track.Y1 := MMY(JNum(Line, 'y1'));
  Track.X2 := MMX(JNum(Line, 'x2'));
  Track.Y2 := MMY(JNum(Line, 'y2'));
  Track.Width := MMsToCoord(JNum(Line, 'w'));
  Track.Layer := L;

  NetStr := JGet(Line, 'net');
  if NetStr <> '' then
  begin
    Net := FindNet(NetStr);
    if Net <> nil then
      Track.Net := Net
    else
      Report.Add('[AVISO] track_add: net "' + NetStr + '" nao existe na placa - trilha criada sem net');
  end;

  Board.AddPCBObject(Track);
  PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Track.I_ObjectAddress);
  LogOk('track_add ' + JGet(Line, 'layer') + ' (' + JGet(Line, 'x1') + ',' + JGet(Line, 'y1') + ')-(' +
    JGet(Line, 'x2') + ',' + JGet(Line, 'y2') + ') w=' + JGet(Line, 'w'));
end;

procedure DoTrackDel(Line: String);
var
  Track: IPCB_Track;
  What: String;
begin
  What := 'track_del ' + JGet(Line, 'id');
  Track := RequireTrackOrig(Line, What);
  if Track = nil then
    Exit;
  Board.RemovePCBObject(Track);
  LogOk(What);
end;

function RequireViaOrig(Line, What: String): IPCB_Via;
begin
  Result := nil;
  if not (JHas(Line, 'orig_x') and JHas(Line, 'orig_y')) then
  begin
    LogFail(What + ': faltam campos orig_x/orig_y (copie do board.js)');
    Exit;
  end;
  Result := FindVia(JNum(Line, 'orig_x'), JNum(Line, 'orig_y'));
  if Result = nil then
    LogFail(What + ': via original nao encontrada na placa (re-exporte o espelho)');
end;

procedure DoViaEdit(Line: String);
var
  Via: IPCB_Via;
  What: String;
begin
  What := 'via_edit ' + JGet(Line, 'id');
  Via := RequireViaOrig(Line, What);
  if Via = nil then
    Exit;

  PCBServer.SendMessageToRobots(Via.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JHas(Line, 'x') then
    Via.x := MMX(JNum(Line, 'x'));
  if JHas(Line, 'y') then
    Via.y := MMY(JNum(Line, 'y'));
  if JHas(Line, 'size') then
    Via.Size := MMsToCoord(JNum(Line, 'size'));
  if JHas(Line, 'drill') then
    Via.HoleSize := MMsToCoord(JNum(Line, 'drill'));
  PCBServer.SendMessageToRobots(Via.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Via.GraphicallyInvalidate;
  LogOk(What);
end;

procedure DoViaAdd(Line: String);
var
  Via: IPCB_Via;
  Net: IPCB_Net;
  NetStr: String;
  LFrom, LTo: TLayer;
begin
  if not (JHas(Line, 'x') and JHas(Line, 'y') and JHas(Line, 'size') and JHas(Line, 'drill')) then
  begin
    LogFail('via_add: faltam campos x/y/size/drill');
    Exit;
  end;

  Via := PCBServer.PCBObjectFactory(eViaObject, eNoDimension, eCreate_Default);
  Via.x := MMX(JNum(Line, 'x'));
  Via.y := MMY(JNum(Line, 'y'));
  Via.Size := MMsToCoord(JNum(Line, 'size'));
  Via.HoleSize := MMsToCoord(JNum(Line, 'drill'));

  LFrom := eTopLayer;
  LTo := eBottomLayer;
  if JHas(Line, 'from') then
    LFrom := LayerFromName(JGet(Line, 'from'));
  if JHas(Line, 'to') then
    LTo := LayerFromName(JGet(Line, 'to'));
  Via.LowLayer := LFrom;
  Via.HighLayer := LTo;

  NetStr := JGet(Line, 'net');
  if NetStr <> '' then
  begin
    Net := FindNet(NetStr);
    if Net <> nil then
      Via.Net := Net
    else
      Report.Add('[AVISO] via_add: net "' + NetStr + '" nao existe na placa - via criada sem net');
  end;

  Board.AddPCBObject(Via);
  PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Via.I_ObjectAddress);
  LogOk('via_add (' + JGet(Line, 'x') + ',' + JGet(Line, 'y') + ') size=' + JGet(Line, 'size') +
    ' drill=' + JGet(Line, 'drill'));
end;

procedure DoViaDel(Line: String);
var
  Via: IPCB_Via;
  What: String;
begin
  What := 'via_del ' + JGet(Line, 'id');
  Via := RequireViaOrig(Line, What);
  if Via = nil then
    Exit;
  Board.RemovePCBObject(Via);
  LogOk(What);
end;

function RequireArcOrig(Line, What: String): IPCB_Arc;
var
  L: TLayer;
begin
  Result := nil;
  if not (JHas(Line, 'orig_cx') and JHas(Line, 'orig_cy') and JHas(Line, 'orig_r') and
    JHas(Line, 'orig_sa') and JHas(Line, 'orig_ea') and JHas(Line, 'orig_layer')) then
  begin
    LogFail(What + ': faltam campos orig_* (copie do board.js)');
    Exit;
  end;
  L := LayerFromName(JGet(Line, 'orig_layer'));
  if L = 0 then
  begin
    LogFail(What + ': orig_layer invalida "' + JGet(Line, 'orig_layer') + '"');
    Exit;
  end;
  Result := FindArc(L, JNum(Line, 'orig_cx'), JNum(Line, 'orig_cy'), JNum(Line, 'orig_r'),
    JNum(Line, 'orig_sa'), JNum(Line, 'orig_ea'));
  if Result = nil then
    LogFail(What + ': arco original nao encontrado na placa (re-exporte o espelho)');
end;

procedure DoArcEdit(Line: String);
var
  Arc: IPCB_Arc;
  What: String;
  L: TLayer;
begin
  What := 'arc_edit ' + JGet(Line, 'id');
  Arc := RequireArcOrig(Line, What);
  if Arc = nil then
    Exit;

  PCBServer.SendMessageToRobots(Arc.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JHas(Line, 'cx') then
    Arc.XCenter := MMX(JNum(Line, 'cx'));
  if JHas(Line, 'cy') then
    Arc.YCenter := MMY(JNum(Line, 'cy'));
  if JHas(Line, 'r') then
    Arc.Radius := MMsToCoord(JNum(Line, 'r'));
  if JHas(Line, 'sa') then
    Arc.StartAngle := JNum(Line, 'sa');
  if JHas(Line, 'ea') then
    Arc.EndAngle := JNum(Line, 'ea');
  if JHas(Line, 'w') then
    Arc.LineWidth := MMsToCoord(JNum(Line, 'w'));
  if JHas(Line, 'layer') then
  begin
    L := LayerFromName(JGet(Line, 'layer'));
    if (L = eTopLayer) or (L = eBottomLayer) then
      Arc.Layer := L;
  end;
  PCBServer.SendMessageToRobots(Arc.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Arc.GraphicallyInvalidate;
  LogOk(What);
end;

procedure DoArcAdd(Line: String);
var
  Arc: IPCB_Arc;
  L: TLayer;
  Net: IPCB_Net;
  NetStr: String;
begin
  L := LayerFromName(JGet(Line, 'layer'));
  if (L <> eTopLayer) and (L <> eBottomLayer) then
  begin
    LogFail('arc_add: camada invalida "' + JGet(Line, 'layer') + '" (use Top ou Bottom)');
    Exit;
  end;
  if not (JHas(Line, 'cx') and JHas(Line, 'cy') and JHas(Line, 'r') and JHas(Line, 'sa') and
    JHas(Line, 'ea') and JHas(Line, 'w')) then
  begin
    LogFail('arc_add: faltam campos cx/cy/r/sa/ea/w');
    Exit;
  end;

  Arc := PCBServer.PCBObjectFactory(eArcObject, eNoDimension, eCreate_Default);
  Arc.XCenter := MMX(JNum(Line, 'cx'));
  Arc.YCenter := MMY(JNum(Line, 'cy'));
  Arc.Radius := MMsToCoord(JNum(Line, 'r'));
  Arc.StartAngle := JNum(Line, 'sa');
  Arc.EndAngle := JNum(Line, 'ea');
  Arc.LineWidth := MMsToCoord(JNum(Line, 'w'));
  Arc.Layer := L;

  NetStr := JGet(Line, 'net');
  if NetStr <> '' then
  begin
    Net := FindNet(NetStr);
    if Net <> nil then
      Arc.Net := Net
    else
      Report.Add('[AVISO] arc_add: net "' + NetStr + '" nao existe na placa - arco criado sem net');
  end;

  Board.AddPCBObject(Arc);
  PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Arc.I_ObjectAddress);
  LogOk('arc_add ' + JGet(Line, 'layer') + ' c=(' + JGet(Line, 'cx') + ',' + JGet(Line, 'cy') + ') r=' + JGet(Line, 'r'));
end;

procedure DoArcDel(Line: String);
var
  Arc: IPCB_Arc;
  What: String;
begin
  What := 'arc_del ' + JGet(Line, 'id');
  Arc := RequireArcOrig(Line, What);
  if Arc = nil then
    Exit;
  Board.RemovePCBObject(Arc);
  LogOk(What);
end;

// text_edit: altera texto livre (silk/topo). x/y do contrato = CENTRO do bounding box,
// igual ao board.js: aplica texto/altura/rot primeiro, mede o bounding box NOVO e
// desloca a ancora para o centro cair exatamente em x/y - centralizacao exata
// independente da largura do texto (1 vs 10).
procedure DoTextEdit(Line: String);
var
  Txt: IPCB_Text;
  What: String;
  L: TLayer;
  cx, cy, dx, dy: Double;
begin
  What := 'text_edit ' + JGet(Line, 'id');
  if not (JHas(Line, 'orig_x') and JHas(Line, 'orig_y') and JHas(Line, 'orig_text') and
    JHas(Line, 'orig_layer')) then
  begin
    LogFail(What + ': faltam campos orig_x/orig_y/orig_text/orig_layer (copie do board.js)');
    Exit;
  end;
  L := LayerFromName(JGet(Line, 'orig_layer'));
  if L = 0 then
  begin
    LogFail(What + ': orig_layer invalida "' + JGet(Line, 'orig_layer') + '"');
    Exit;
  end;
  Txt := FindFreeText(L, JNum(Line, 'orig_x'), JNum(Line, 'orig_y'), JGet(Line, 'orig_text'));
  if Txt = nil then
  begin
    LogFail(What + ': texto original nao encontrado na placa (re-exporte o espelho)');
    Exit;
  end;

  // 1) Estilo num ciclo proprio: o engine so recalcula o bounding box no EndModify.
  //    (Medir e ajustar a ancora no MESMO ciclo devolvia o box velho e o ajuste de
  //    XLocation era descartado - os textos nunca saiam do lugar.)
  PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JHas(Line, 'text') then
    Txt.Text := JGet(Line, 'text');
  if JHas(Line, 'h') then
    Txt.Size := MMsToCoord(JNum(Line, 'h'));
  if JHas(Line, 'w') then
    Txt.Width := MMsToCoord(JNum(Line, 'w'));
  if JHas(Line, 'rot') then
    Txt.Rotation := JNum(Line, 'rot');
  PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Txt.GraphicallyInvalidate;

  // 2) Centraliza com MoveByXY (escrever XLocation em texto e ignorado neste engine;
  //    MoveByXY e da mesma familia do MoveToXY comprovado no comp_move).
  if JHas(Line, 'x') or JHas(Line, 'y') then
  begin
    cx := (XMM(Txt.BoundingRectangleForSelection.Left) + XMM(Txt.BoundingRectangleForSelection.Right)) / 2;
    cy := (YMM(Txt.BoundingRectangleForSelection.Bottom) + YMM(Txt.BoundingRectangleForSelection.Top)) / 2;
    dx := 0;
    dy := 0;
    if JHas(Line, 'x') then
      dx := JNum(Line, 'x') - cx;
    if JHas(Line, 'y') then
      dy := JNum(Line, 'y') - cy;
    PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
    Txt.MoveByXY(MMsToCoord(dx), MMsToCoord(dy));
    PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
    Txt.GraphicallyInvalidate;
  end;

  // 3) Relatorio honesto: mede o centro DEPOIS de tudo e confere com o alvo.
  cx := (XMM(Txt.BoundingRectangleForSelection.Left) + XMM(Txt.BoundingRectangleForSelection.Right)) / 2;
  cy := (YMM(Txt.BoundingRectangleForSelection.Bottom) + YMM(Txt.BoundingRectangleForSelection.Top)) / 2;
  if (JHas(Line, 'x') and (Abs(cx - JNum(Line, 'x')) > 0.01)) or
     (JHas(Line, 'y') and (Abs(cy - JNum(Line, 'y')) > 0.01)) then
    LogFail(What + ': centro medido (' + FloatToStr(cx) + ',' + FloatToStr(cy) +
      ') nao chegou no alvo (' + JGet(Line, 'x') + ',' + JGet(Line, 'y') + ')')
  else
    LogOk(What + ' -> texto=' + Txt.Text + ' centro medido=(' + FloatToStr(cx) + ',' + FloatToStr(cy) + ')');
end;

// designator_move: reposiciona o texto do designator de um componente (ref). x/y do
// contrato = CENTRO do bounding box (igual ao item designator:true de board.js >> texts).
// Poe o autoposition do nome em Manual e desloca a ancora pela medida real do bounding
// box, entao a centralizacao independe da largura do texto.
procedure DoDesignatorMove(Line: String);
var
  Comp: IPCB_Component;
  Nm: IPCB_Text;
  What, Ref: String;
  cx, cy, dx, dy: Double;
begin
  Ref := JGet(Line, 'ref');
  What := 'designator_move ' + Ref;
  if not (JHas(Line, 'orig_x') and JHas(Line, 'orig_y')) then
  begin
    LogFail(What + ': faltam campos orig_x/orig_y (copie do item do designator em board.js >> texts)');
    Exit;
  end;
  Comp := FindComponent(Ref);
  if Comp = nil then
  begin
    LogFail(What + ': componente nao encontrado');
    Exit;
  end;
  Nm := Comp.Name;
  cx := (XMM(Nm.BoundingRectangleForSelection.Left) + XMM(Nm.BoundingRectangleForSelection.Right)) / 2;
  cy := (YMM(Nm.BoundingRectangleForSelection.Bottom) + YMM(Nm.BoundingRectangleForSelection.Top)) / 2;
  if not (NearMM(cx, JNum(Line, 'orig_x')) and NearMM(cy, JNum(Line, 'orig_y'))) then
  begin
    LogFail(What + ': designator atual nao casa com orig_* (re-exporte o espelho)');
    Exit;
  end;

  // Autoposition Manual num ciclo proprio (senao o Altium re-ancora sozinho).
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  Comp.ChangeNameAutoposition(eAutoPos_Manual);
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);

  // Estilo num ciclo proprio (bounding box so recalcula no EndModify - ver DoTextEdit).
  if JHas(Line, 'h') or JHas(Line, 'rot') then
  begin
    PCBServer.SendMessageToRobots(Nm.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
    if JHas(Line, 'h') then
      Nm.Size := MMsToCoord(JNum(Line, 'h'));
    if JHas(Line, 'rot') then
      Nm.Rotation := JNum(Line, 'rot');
    PCBServer.SendMessageToRobots(Nm.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
    Nm.GraphicallyInvalidate;
  end;

  // Move com MoveByXY (escrever XLocation em texto e ignorado neste engine).
  if JHas(Line, 'x') or JHas(Line, 'y') then
  begin
    cx := (XMM(Nm.BoundingRectangleForSelection.Left) + XMM(Nm.BoundingRectangleForSelection.Right)) / 2;
    cy := (YMM(Nm.BoundingRectangleForSelection.Bottom) + YMM(Nm.BoundingRectangleForSelection.Top)) / 2;
    dx := 0;
    dy := 0;
    if JHas(Line, 'x') then
      dx := JNum(Line, 'x') - cx;
    if JHas(Line, 'y') then
      dy := JNum(Line, 'y') - cy;
    PCBServer.SendMessageToRobots(Nm.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
    Nm.MoveByXY(MMsToCoord(dx), MMsToCoord(dy));
    PCBServer.SendMessageToRobots(Nm.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
    Nm.GraphicallyInvalidate;
  end;
  Comp.GraphicallyInvalidate;

  // Relatorio honesto: centro medido apos as mudancas.
  cx := (XMM(Nm.BoundingRectangleForSelection.Left) + XMM(Nm.BoundingRectangleForSelection.Right)) / 2;
  cy := (YMM(Nm.BoundingRectangleForSelection.Bottom) + YMM(Nm.BoundingRectangleForSelection.Top)) / 2;
  if (JHas(Line, 'x') and (Abs(cx - JNum(Line, 'x')) > 0.01)) or
     (JHas(Line, 'y') and (Abs(cy - JNum(Line, 'y')) > 0.01)) then
    LogFail(What + ': centro medido (' + FloatToStr(cx) + ',' + FloatToStr(cy) +
      ') nao chegou no alvo (' + JGet(Line, 'x') + ',' + JGet(Line, 'y') + ')')
  else
    LogOk(What + ' -> centro medido=(' + FloatToStr(cx) + ',' + FloatToStr(cy) + ')');
end;

procedure DoCompAttr(Line: String);
var
  Ref: String;
  Comp: IPCB_Component;
begin
  Ref := JGet(Line, 'ref');
  Comp := FindComponent(Ref);
  if Comp = nil then
  begin
    LogFail('comp_attr ' + Ref + ': componente nao encontrado');
    Exit;
  end;
  if not (JHas(Line, 'orig_designator') and JHas(Line, 'orig_comment')) then
  begin
    LogFail('comp_attr ' + Ref + ': faltam orig_designator/orig_comment (copie do board.js)');
    Exit;
  end;
  if (Comp.Name.Text <> JGet(Line, 'orig_designator')) or (Comp.Comment.Text <> JGet(Line, 'orig_comment')) then
  begin
    LogFail('comp_attr ' + Ref + ': designator/comment atuais nao casam com orig_* (re-exporte o espelho)');
    Exit;
  end;
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JHas(Line, 'designator') then
  begin
    if JGet(Line, 'designator') <> '' then
      Comp.Name.Text := JGet(Line, 'designator');
  end;
  if JHas(Line, 'comment') then
    Comp.Comment.Text := JGet(Line, 'comment');
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Comp.GraphicallyInvalidate;
  LogOk('comp_attr ' + Ref + ' -> designator=' + JGet(Line, 'designator') + ' comment=' + JGet(Line, 'comment'));
end;

procedure DoOutlineSet(Line: String);
var
  Pts: TStringList;
  i, p: Integer;
  BO: TObject;
  Seg: TPolySegment;
  x, y: Double;
begin
  Pts := ParsePts(Line);
  if Pts.Count < 3 then
  begin
    LogFail('outline_set: pts precisa de pelo menos 3 vertices [[x,y],...]');
    Pts.Free;
    Exit;
  end;
  if not ConfirmNoYes('outline_set: substituir o CONTORNO DA PLACA por um poligono de ' +
    IntToStr(Pts.Count) + ' vertices?') then
  begin
    LogFail('outline_set: cancelado pelo usuario');
    Pts.Free;
    Exit;
  end;
  BO := Board.BoardOutline;
  PCBServer.SendMessageToRobots(BO.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  BO.Invalidate;
  BO.PointCount := Pts.Count;
  for i := 0 to Pts.Count - 1 do
  begin
    p := Pos('|', Pts[i]);
    x := StrToFloatDot(Copy(Pts[i], 1, p - 1));
    y := StrToFloatDot(Copy(Pts[i], p + 1, 255));
    Seg := BO.Segments[i];
    Seg.Kind := ePolySegmentLine;
    Seg.vx := MMX(x);
    Seg.vy := MMY(y);
    BO.Segments[i] := Seg;
  end;
  BO.Rebuild;
  BO.Validate;
  PCBServer.SendMessageToRobots(BO.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  LogOk('outline_set: contorno redefinido com ' + IntToStr(Pts.Count) + ' vertices');
  Pts.Free;
end;

{ ..................................................................................................................... }
{ .                                                Rotina principal                                                   . }
{ ..................................................................................................................... }

// Aplica <OutDir>\changes.js na PCB focada.
// Tem parametro de proposito: some do menu Run Script (chamada por ApplyProject).
procedure ApplyChangesInto(OutDir: String);
var
  ChangesFile, Line, Op, RelTxt: String;
  Src, AttrLines: TStringList;
  i, Recognized: Integer;
  Gravou: Boolean;
begin
  Board := PCBServer.GetCurrentPCBBoard;
  if Board = nil then
  begin
    ShowMessage('Nenhum documento PCB aberto/focado. Abra o .PcbDoc e rode novamente.');
    Exit;
  end;

  if OutDir = '' then
    Exit;
  ChangesFile := OutDir + '\changes.js';
  if not FileExists(ChangesFile) then
  begin
    ShowMessage('Arquivo de mudancas nao encontrado:' + #13#10 + ChangesFile + #13#10#13#10 +
      'Rode primeiro o ExportPcb e peca as mudancas a IA.');
    Exit;
  end;

  Report := TStringList.Create;
  Report.Add('AltiumPCBMirror - relatorio de aplicacao');
  Report.Add('Placa: ' + Board.FileName);
  Report.Add('Data:  ' + DateTimeToStr(Now));
  Report.Add('');
  OkCount := 0;
  FailCount := 0;
  Recognized := 0;

  Src := TStringList.Create;
  AttrLines := TStringList.Create;
  Src.LoadFromFile(ChangesFile);

  PCBServer.PreProcess;

  for i := 0 to Src.Count - 1 do
  begin
    Line := Trim(Src[i]);
    if Pos('//', Line) = 1 then
      continue;
    if not JHas(Line, 'op') then
      continue;

    Recognized := Recognized + 1;
    Op := JGet(Line, 'op');

    if Op = 'comp_move' then
      DoCompMove(Line)
    else if Op = 'track_edit' then
      DoTrackEdit(Line)
    else if Op = 'track_add' then
      DoTrackAdd(Line)
    else if Op = 'track_del' then
      DoTrackDel(Line)
    else if Op = 'via_edit' then
      DoViaEdit(Line)
    else if Op = 'via_add' then
      DoViaAdd(Line)
    else if Op = 'via_del' then
      DoViaDel(Line)
    else if Op = 'arc_edit' then
      DoArcEdit(Line)
    else if Op = 'arc_add' then
      DoArcAdd(Line)
    else if Op = 'arc_del' then
      DoArcDel(Line)
    else if Op = 'text_edit' then
      DoTextEdit(Line)
    else if Op = 'designator_move' then
      DoDesignatorMove(Line)
    else if Op = 'outline_set' then
      DoOutlineSet(Line)
    else if Op = 'comp_attr' then
      AttrLines.Add(Line)   // renames por ultimo: FindComponent casa por Name.Text
    else
      LogFail('operacao desconhecida: "' + Op + '"');
  end;

  // comp_attr aplicado por ultimo (renomear designator cedo quebraria refs das ops seguintes)
  for i := 0 to AttrLines.Count - 1 do
    DoCompAttr(AttrLines[i]);

  PCBServer.PostProcess;

  Client.SendMessage('PCB:Zoom', 'Action=Redraw', 255, Client.CurrentView);

  Report.Add('');
  Report.Add('Mudancas reconhecidas: ' + IntToStr(Recognized));
  Report.Add('Aplicadas com sucesso: ' + IntToStr(OkCount));
  Report.Add('Falhas:                ' + IntToStr(FailCount));
  // As mudancas ja estao na placa; so o relatorio depende da raiz do workspace.
  Gravou := SalvaOuExplica(Report, OutDir + '\apply-report.txt');
  if Gravou then
    RelTxt := 'Relatorio: ' + OutDir + '\apply-report.txt'
  else
    RelTxt := 'O relatorio NAO pode ser gravado (o aviso anterior diz por que).';

  if Gravou then
    RegenerateProjectsIndex(ExtractFileName(OutDir));

  ShowMessage('Aplicacao concluida.' + #13#10#13#10 +
    'Reconhecidas: ' + IntToStr(Recognized) + #13#10 +
    'OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount) + #13#10#13#10 +
    RelTxt + #13#10#13#10 +
    'IMPORTANTE: confira o resultado, rode o DRC do Altium e re-execute o ExportPcb para atualizar o espelho.');

  AttrLines.Free;
  Src.Free;
  Report.Free;
end;

{ ---------------------------------------------------------------------------- }
{  ApplyProject - unica entrada do menu para trazer um projeto do espelho para  }
{  o projeto Altium atual. Pergunta qual pasta de Projects\ usar e aplica o que }
{  faz sentido no momento: esquema (cria os .SchDoc) ou PCB (aplica changes.js).}
{ ---------------------------------------------------------------------------- }

// Janela com a lista de projetos de Projects\ (selecao por clique).
// Retorna o nome escolhido; '' se o usuario cancelar.
function PickProjectName(Dirs: TStringList): String;
var
  F: TForm;
  LB: TListBox;
  BOk, BCan: TButton;
  Lbl: TLabel;
  i, res: Integer;
  Nome, Tag: String;
begin
  Result := '';
  F := TForm.Create(nil);
  F.Caption := 'AltiumPCBMirror - escolha o projeto';
  F.Width := 460;
  F.Height := 400;

  Lbl := TLabel.Create(F);
  Lbl.Parent := F;
  Lbl.Left := 12;
  Lbl.Top := 12;
  Lbl.Width := 420;
  Lbl.Caption := 'Qual projeto de Projects\ aplicar no projeto Altium atual?';

  LB := TListBox.Create(F);
  LB.Parent := F;
  LB.Left := 12;
  LB.Top := 36;
  LB.Width := 420;
  LB.Height := 268;
  for i := 0 to Dirs.Count - 1 do
  begin
    Nome := Dirs[i];
    Tag := '';
    if FileExists(PROJECTS_DIR + '\' + Nome + '\schematic.js') then
      Tag := Tag + '   [esquema]';
    if FileExists(PROJECTS_DIR + '\' + Nome + '\changes.js') then
      Tag := Tag + '   [PCB]';
    LB.Items.Add(Nome + Tag);
  end;
  if LB.Items.Count > 0 then
    LB.ItemIndex := 0;

  BOk := TButton.Create(F);
  BOk.Parent := F;
  BOk.Caption := 'Aplicar';
  BOk.Left := 244;
  BOk.Top := 316;
  BOk.Width := 90;
  BOk.Height := 28;
  BOk.ModalResult := 1;  // mrOk

  BCan := TButton.Create(F);
  BCan.Parent := F;
  BCan.Caption := 'Cancelar';
  BCan.Left := 342;
  BCan.Top := 316;
  BCan.Width := 90;
  BCan.Height := 28;
  BCan.ModalResult := 2;  // mrCancel

  res := F.ShowModal;
  if (res = 1) and (LB.ItemIndex >= 0) and (LB.ItemIndex < Dirs.Count) then
    Result := Dirs[LB.ItemIndex];
  F.Free;
end;

// true se o changes.js tem ao menos UMA mudanca de verdade.
//
// O ARQUIVO SEMPRE EXISTE: o ExportPcb cria o esqueleto vazio ("var changes = [ ];") e
// nunca o apaga. Perguntar so FileExists fazia o ApplyProject escolher o ramo da PCB
// sempre que houvesse um .PcbDoc focado - aplicava zero mudancas, saia, e o esquema
// nunca era construido. Medido em 2026-09-23: os 11 changes.js do servidor estavam
// vazios, e o schematic.js do DMB tinha sido gravado naquele dia pelo painel de
// conversao do hub. O esquema convertido simplesmente nao chegava ao Altium.
//
// Reconhece a mudanca EXATAMENTE como o ApplyChangesInto reconhece (pula // e exige
// "op"), para os dois nunca discordarem sobre o que e uma mudanca.
function ChangesTemOps(Arq: String): Boolean;
var
  L: TStringList;
  i: Integer;
  Linha: String;
begin
  Result := False;
  if not FileExists(Arq) then
    Exit;
  L := TStringList.Create;
  L.LoadFromFile(Arq);
  for i := 0 to L.Count - 1 do
  begin
    Linha := Trim(L[i]);
    if Pos('//', Linha) = 1 then
      continue;
    if JHas(Linha, 'op') then
    begin
      Result := True;
      break;
    end;
  end;
  L.Free;
end;

procedure ApplyProject;
var
  Dirs: TStringList;
  Nome, Dir: String;
  HasSch, HasChg, PcbFocada: Boolean;
begin
  // Raiz do workspace DESTA maquina: PRIMEIRA coisa do procedimento, porque tudo abaixo
  // depende dela (ResolveProjectDir, ListProjectDirs, o indice projects.js).
  SCRIPT_HOME := HubHome(0);
  if SCRIPT_HOME = '' then
    Exit;
  PROJECTS_DIR := SCRIPT_HOME + '\Projects';

  ForceDirectories(PROJECTS_DIR);
  Dirs := TStringList.Create;
  ListProjectDirs(Dirs);
  if Dirs.Count = 0 then
  begin
    ShowMessage('Nenhum projeto em ' + PROJECTS_DIR + '.' + #13#10 +
      '[' + ScanInfo + ']' + #13#10 +
      'Peca um projeto novo a IA ou rode ExportSch/ExportPcb primeiro.');
    Dirs.Free;
    Exit;
  end;

  Nome := PickProjectName(Dirs);
  Dirs.Free;
  if Nome = '' then
    Exit;
  Dir := PROJECTS_DIR + '\' + Nome;

  HasSch := FileExists(Dir + '\schematic.js');
  // pelo CONTEUDO, nao pela existencia: ver ChangesTemOps
  HasChg := ChangesTemOps(Dir + '\changes.js');
  PcbFocada := False;
  if PCBServer <> nil then
    PcbFocada := PCBServer.GetCurrentPCBBoard <> nil;

  // PCB focada + mudancas prontas: aplica na placa
  if PcbFocada and HasChg then
  begin
    ApplyChangesInto(Dir);
    Exit;
  end;

  // senao, materializa o esquema (etapa 1 de um projeto novo, ou um esquema editado no hub)
  //
  // SEM AVISO PROPRIO DEPOIS DAQUI. Aqui havia um ShowMessage dizendo "Esquema gerado no
  // projeto atual", disparado SEMPRE - inclusive quando o BuildSchematicInto tinha acabado
  // de dizer "Validacao falhou com 33 erro(s) - nada foi criado" (build-report do DMB,
  // 16/09). A ultima coisa na tela era a mentira. O BuildSchematicInto ja avisa o proprio
  // desfecho em todo ramo alcancavel daqui - falha de validacao, sucesso com os proximos
  // passos, e cada motivo de parada -, entao o aviso daqui so podia repetir ou contradizer.
  if HasSch then
  begin
    BuildSchematicInto(Dir);
    Exit;
  end;

  ShowMessage('A pasta ' + Dir + ' nao tem schematic.js nem mudancas no changes.js.' + #13#10 +
    'Peca o projeto a IA primeiro.');
end;

