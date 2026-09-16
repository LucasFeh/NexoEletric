{ ..................................................................................................................... }
{ .  AltiumPCBMirror - BuildSchematic.pas                                                                             . }
{ .                                                                                                                   . }
{ .  Le Projects\<nome>\schematic.js (escrito pela IA) e cria os .SchDoc REAIS no projeto focado:                     . }
{ .    - valida tudo ANTES de criar qualquer coisa (simbolos na SchLib, footprints na PcbLib, refs)                   . }
{ .    - um .SchDoc por folha, na pasta do .PrjPcb, adicionado ao projeto                                             . }
{ .    - componentes COPIADOS da SchLib real (graficos/pinos/parametros preservados)                                  . }
{ .    - designator, comment e modelo de footprint definidos por componente                                           . }
{ .    - fios, net labels, power ports, junctions e textos                                                            . }
{ .    - relatorio em Projects\<nome>\build-report.txt                                                                . }
{ .                                                                                                                   . }
{ .  Depois: salve o projeto, Compile, e Design >> Update PCB (ECO nativo).                                           . }
{ .                                                                                                                   . }
{ .  Como executar: DXP >> Run Script >> BuildSchematic  (com o .PrjPcb do projeto focado)                            . }
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
  // A biblioteca da casa. Os projetos existentes ainda dependem dela: dos 108
  // simbolos que os 14 schematic.js usam, so 3 existem nas libs do almoxarifado
  // e 42 so existem aqui. Enquanto esses simbolos nao nascerem no almoxarifado,
  // tirar esta linha faz a validacao abortar e nenhum projeto ser reconstruido.
  // Sao o PADRAO: quem manda sao as chaves schlib/pcblib do home.txt desta maquina;
  // estes valores so valem quando a maquina nao declarou as chaves (nao quebra quem
  // ja usa, e quem trocou de PC corrige no home.txt em vez de no codigo).
  { As bibliotecas vem de DENTRO do workspace, e por isso sao relativas a SCRIPT_HOME:  }
  { a .SchLib da casa viaja na release (Libs\BIBLIOTECA DE ESQUEMA.SchLib, a copia que }
  { o guardiao publica) e os footprints do almoxarifado moram em Libs\Almox. Eram UNC  }
  { para o disco de uma maquina, e isso deixou de existir aqui: tudo vem do servidor.   }
  { Quem tiver a biblioteca noutro lugar declara schlib= / pcblib= no home.txt.         }
  SCHLIB_REL = '\Libs\BIBLIOTECA DE ESQUEMA.SchLib';
  PCBLIB_REL = '\Libs\Almox\FOOTPRINTS ALMOX.PcbLib';
  // Bibliotecas do almoxarifado, geradas a partir do Odoo: uma .SchLib por familia
  // (ALMOX RESISTOR, ALMOX CAPACITOR CERAMICO...), procuradas DEPOIS da principal.
  // O script varre a pasta em vez de listar arquivo por arquivo. A pasta sai da raiz:
  // ALMOX_DIR := SCRIPT_HOME + '\Libs\Almox', junto com o resto, no var abaixo.

var
  // Preenchidas por HubHome(0) na PRIMEIRA linha do procedimento principal. Eram const,
  // e const nao se reatribui em DelphiScript - por isso estao aqui. Nada que use as duas
  // pode rodar antes daquela linha (ResolveProjectDir, ListProjectDirs, o indice...).
  SCRIPT_HOME: String;
  PROJECTS_DIR: String;
  HomeOrigem: String;  // de onde veio SCRIPT_HOME; sai na mensagem de erro de gravacao
  SCHLIB_FILE: String;  // chave schlib do home.txt, ou SCHLIB_PADRAO
  PCBLIB_FILE: String;  // chave pcblib do home.txt, ou PCBLIB_PADRAO
  ALMOX_DIR: String;    // SCRIPT_HOME + '\Libs\Almox'
  Report: TStringList;
  OkCount, FailCount: Integer;
  SchLibDoc: ISch_Document;
  SchLibs: TInterfaceList;      // todas as SchLib de origem, na ordem de busca
  SchLibNomes: TStringList;     // os caminhos, para as mensagens
  ScanInfo: String; // diagnostico do ultimo ListProjectDirs (aparece nos dialogos)
  PcbFpNames: TStringList;   // nil = PcbLib indisponivel (validacao de footprint vira aviso)
  TrocouSimbolo: Boolean;    // algum componente ja existente teve o LibReference trocado:
                             // o desenho na folha continua o antigo ate Update From Libraries
  AvisosDeTexto: String;     // recados sobre POSICAO DE TEXTO ja dados nesta rodada, entre
                             // ';': nome de propriedade recusada (AvisaSonda) e tipo de
                             // falha sistemica (FalhaDeTexto). Cada um sai UMA vez - o que
                             // impede um texto impede os 318 da folha, e repetir afogaria o
                             // resto do despejo
  CompsDescolados: String;   // componentes que a passada 2b PROVOU descolados (a ancora diz
                             // um lugar e o desenho esta noutro), entre ';' no formato
                             // 'Ref/Parte'. A 2c le esta lista antes de posicionar texto:
                             // ancora mentirosa nao serve de referencia para nada
  // Contagem dos textos de componente (refdx/refdy, comdx/comdy). Existe pelo mesmo motivo
  // que o contador por tipo do ExportProject: sem numero, "nao aplicou" e "nao tinha o que
  // aplicar" ficam indistinguiveis - foi assim que a omissao do ePort passou meses de pe.
  // Sao baldes SEPARADOS, UM POR DESFECHO, e nao um so: "no lugar", "no lugar mas sem trava",
  // "nada a fazer", "nem mexi", "mexi e nao sei onde parou", "mexi e nao ficou" e "nem
  // tentei" sao SETE respostas diferentes, e juntar qualquer uma delas na primeira daria
  // rodape de sucesso numa rodada em que o Altium nao deixou mexer em texto nenhum. E a
  // regra da casa, escrita depois das juncoes: um numero de relatorio nunca junta "deu
  // certo" com "nao sei".
  TextosPedidos: Integer;    // textos que o espelho mandou posicionar
  TextosPostos: Integer;     // MOVIDOS, conferidos (antes e depois) e com a trava do
                             // autoposicionamento ACEITA - aceita, que nao e o mesmo que
                             // provada: a propria DesligaAutoPos avisa que a atribuicao pode
                             // ser aceita e ignorada. E o melhor desfecho que este script
                             // consegue afirmar, e nao uma garantia
  TextosSemTrava: Integer;   // movidos e conferidos, mas o autoposicionamento continuou
                             // LIGADO (a sonda Autoposition foi recusada): o Altium
                             // provavelmente re-ancora esses no proximo desenho
  TextosJaEstavam: Integer;  // ja estavam no lugar pedido: nada escrito, nada a relatar
  TextosNaoMexidos: Integer; // nenhuma posicao chegou a ser gravada (o objeto do texto, a
                             // leitura de antes ou a propria escrita foram recusados): o
                             // texto ficou onde o Altium ja o punha
  TextosSemConferencia: Integer; // a escrita foi ACEITA e a RELEITURA foi recusada: o texto
                             // provavelmente MEXEU e este script nao sabe onde ele parou
  TextosRecusados: Integer;  // a escrita foi feita e o texto NAO ficou onde foi pedido
  TextosPulados: Integer;    // nem tentados: a 2b marcou o componente como DESCOLADO, e a
                             // ancora dele nao serve de referencia para texto nenhum

{ ------------------------------- helpers JSON (copias do ExportBoard/ApplyChanges) ------------------------------- }
{ Copie aqui, identicos aos originais: JF, JB, JS (do ExportBoard.pas)                                              }
{ e StrToFloatDot, JGet, JHas, JNum (do ApplyChanges.pas linhas 32-161).                                            }

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

{ ------------------------------- log ------------------------------- }

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

// Aviso de SONDA: propriedade cujo nome no DelphiScript de ESQUEMA nunca foi medido num
// Altium de verdade. Sai no relatorio UMA vez por propriedade - repetido a cada componente
// viraria paisagem e afogaria o resto do despejo em 300 linhas iguais.
// Sem lista e sem objeto de proposito: um String com os recados ja dados entre ';' nao
// tem nada para criar nem para liberar, e por isso nao entra em nenhum dos caminhos de
// saida antecipada la de baixo (que hoje liberam sete TStringList na mao, um por um).
//
// ESTE AVISO NAO DIZ O QUE ACONTECEU COM O TEXTO, e nao pode dizer: ele e o mesmo recado
// para quatro pontos de chamada com desfechos DIFERENTES. Recusa no Autoposition nao impede
// nada - a posicao e escrita logo depois -; recusa na leitura DEPOIS quer dizer que a
// escrita ja foi feita e o texto provavelmente MEXEU. So o objeto do texto e a leitura de
// antes significam "nao mexi". A versao anterior afirmava "O texto fica onde o Altium ja o
// punha" nos quatro, o que era falso em dois - exatamente o tipo de frase que junta "deu
// certo" com "nao sei". O desfecho de cada texto esta nos baldes do rodape.
procedure AvisaSonda(Prop: String);
begin
  if Pos(';' + Prop + ';', AvisosDeTexto) > 0 then
    Exit;
  AvisosDeTexto := AvisosDeTexto + ';' + Prop + ';';
  Report.Add('[AVISO] ATENCAO: esta instalacao do Altium recusou a propriedade ' + Prop);
  Report.Add('        E uma SONDA: o nome dela no lado ESQUEMA nunca foi medido - o que esta');
  Report.Add('        provado sao Designator.Text e Comment.Text, nao a posicao deles.');
  Report.Add('        O QUE ISSO CUSTOU EM CADA TEXTO esta no resumo do rodape: recusa aqui');
  Report.Add('        pode significar "nem mexi", "mexi e nao sei onde parou" ou "mexi sem');
  Report.Add('        travar o autoposicionamento" - e esta linha nao sabe qual foi.');
  Report.Add('        O resto do despejo segue normal.');
end;

// Falha de posicao de texto que, quando acontece, acontece com TODOS: a escrita e aceita e
// IGNORADA pelo engine, ou o Altium RE-ANCORA o texto. Nao ha nada de particular ao
// componente nisso, e por isso o recado nao pode ser por componente: numa folha de 159
// componentes uma instalacao assim geraria 318 linhas [FALHA] dizendo a mesma coisa e o
// dialogo anunciaria "Falhas: 318" num despejo em que o desenho saiu inteiro - o oposto do
// cuidado que o ExportProject toma com os avisos dele.
// Entao: o PRIMEIRO caso de cada tipo sai INTEIRO, com nomes e numeros (ele e o exemplo que
// o usuario precisa para investigar) e conta uma falha no placar; do segundo em diante so
// entra no total, que sai numa linha unica no rodape do relatorio.
procedure FalhaDeTexto(Chave, Msg: String);
begin
  TextosRecusados := TextosRecusados + 1;
  if Pos(';' + Chave + ';', AvisosDeTexto) > 0 then
    Exit;
  AvisosDeTexto := AvisosDeTexto + ';' + Chave + ';';
  LogFail(Msg + ' [PRIMEIRO caso desta rodada - os proximos iguais so contam, no rodape]');
end;

{ ------------------------------- mapeamentos ------------------------------- }

function RotToOrient(rot: Integer): TRotationBy90;
begin
  Result := eRotate0;
  if rot = 90 then
    Result := eRotate90
  else if rot = 180 then
    Result := eRotate180
  else if rot = 270 then
    Result := eRotate270;
end;

function StyleFromName(s: String): TPowerObjectStyle;
begin
  Result := ePowerBar;
  if s = 'GndPower' then
    Result := ePowerGndPower
  else if s = 'GndSignal' then
    Result := ePowerGndSignal
  else if s = 'GndEarth' then
    Result := ePowerGndEarth
  else if s = 'Circle' then
    Result := ePowerCircle
  else if s = 'Arrow' then
    Result := ePowerArrow
  else if s = 'Wave' then
    Result := ePowerWave;
end;

// NAO ha PortStyleFromName/PortIoFromName: style e io viajam como INTEIRO CRU.
// A versao com constantes (ePortLeft, ePortNone_Vertical, ...) foi recusada pelo Altium
// com "Undeclared identifier". O inteiro e o que o .SchDoc grava, entao o que sai no
// ExportProject volta identico aqui - inclusive estilo que este script nao conheca.

// -1 = nome que nao e um estilo padrao do Altium ("Custom", ou um tamanho que o
// SheetSizeName do export nao sabe nomear). Quem chama NAO deve escrever SheetStyle nesse
// caso: os templates da casa usam folha CUSTOM (a "A4" deles e a ISO real, 11693x8268), e
// carimbar eSheetA4 por cima ENCOLHERIA a folha do usuario dentro do Altium — estrago no
// arquivo dele, nao so na tela. Na duvida, preservar a folha que ja esta la.
function SheetStyleFromName(s: String): Integer;
begin
  Result := -1;
  if s = 'A4' then
    Result := eSheetA4
  else if s = 'A3' then
    Result := eSheetA3
  else if s = 'A2' then
    Result := eSheetA2
  else if s = 'A1' then
    Result := eSheetA1
  else if s = 'A' then
    Result := eSheetA
  else if s = 'B' then
    Result := eSheetB
  else if s = 'C' then
    Result := eSheetC;
end;

{ ------------------------------- bibliotecas reais ------------------------------- }

// Abre uma SchLib e pendura na lista de origens. Ausente nao e erro: o almoxarifado
// pode ainda nao ter sido gerado, e a biblioteca da casa sozinha continua servindo.
procedure AddSchLib(Caminho: String);
var
  Doc: ISch_Document;
begin
  Doc := SchServer.GetSchDocumentByPath(Caminho);
  if Doc = nil then
    Doc := SchServer.LoadSchDocumentByPath(Caminho);
  if Doc <> nil then
  begin
    SchLibs.Add(Doc);
    SchLibNomes.Add(Caminho);
  end;
end;

// Abre todas as .SchLib da pasta do almoxarifado, alem da biblioteca da casa.
// Sem a pasta, segue so com a lib da casa - quem nunca sincronizou continua
// montando esquema normalmente.
procedure AddAlmoxLibs(Dummy: Integer);
var
  Busca: TSearchRec;
  Achou: Integer;
begin
  if not DirectoryExists(ALMOX_DIR) then
    Exit;
  Achou := FindFirst(ALMOX_DIR + '\*.SchLib', faAnyFile, Busca);
  while Achou = 0 do
  begin
    AddSchLib(ALMOX_DIR + '\' + Busca.Name);
    Achou := FindNext(Busca);
  end;
  FindClose(Busca);
end;

function OpenSchLib(Dummy: Integer): Boolean;
begin
  Result := False;
  if SchServer = nil then
    Exit;
  SchLibs := TInterfaceList.Create;
  SchLibNomes := TStringList.Create;
  AddSchLib(SCHLIB_FILE);
  AddAlmoxLibs(0);
  if SchLibs.Count = 0 then
    Exit;
  SchLibDoc := SchLibs.Items[0];      // a principal, para quem ainda usa a global
  Result := True;
end;

// Procura o simbolo em TODAS as bibliotecas abertas, na ordem em que entraram. E o que
// deixa a folha misturar componente da biblioteca da casa com valor vindo do
// almoxarifado, sem ninguem ter que dizer de onde cada um veio.
function FindLibSymbol(Name: String): ISch_Component;
var
  Iterator, Comp: TObject;
  Lib: ISch_Document;
  k: Integer;
begin
  Result := nil;
  for k := 0 to SchLibs.Count - 1 do
  begin
    Lib := SchLibs.Items[k];
    Iterator := Lib.SchLibIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eSchComponent));
    Comp := Iterator.FirstSchObject;
    while Comp <> nil do
    begin
      if AnsiCompareText(Comp.LibReference, Name) = 0 then
      begin
        Result := Comp;
        break;
      end;
      Comp := Iterator.NextSchObject;
    end;
    Lib.SchIterator_Destroy(Iterator);
    if Result <> nil then
      Exit;
  end;
end;

procedure LoadPcbFpNames(Dummy: Integer);
var
  PLib: IPCB_Library;
  LibIter, FP: TObject;
begin
  PcbFpNames := nil;
  if PCBServer = nil then
    Exit;
  PLib := PCBServer.GetPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
    PLib := PCBServer.LoadPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
    Exit;
  PcbFpNames := TStringList.Create;
  PcbFpNames.Sorted := True;
  PcbFpNames.Duplicates := dupIgnore;
  PcbFpNames.CaseSensitive := False;
  LibIter := PLib.LibraryIterator_Create;
  LibIter.SetState_FilterAll;
  FP := LibIter.FirstPCBObject;
  while FP <> nil do
  begin
    PcbFpNames.Add(FP.Name);
    FP := LibIter.NextPCBObject;
  end;
  PLib.LibraryIterator_Destroy(LibIter);
end;

{ ------------------------------- colocacao de objetos ------------------------------- }

// Acha na folha um componente ja colocado, pelo designador + parte (nil = nao existe).
// E o mesmo casamento que o SCH List usa: designador + numero da parte.
function FindCompInDoc(SchDoc: ISch_Document; Ref: String; PartId: Integer): TObject;
var
  Iter: TObject;
  C: TObject;
begin
  Result := nil;
  Iter := SchDoc.SchIterator_Create;
  if Iter = nil then
    Exit;
  Iter.AddFilter_ObjectSet(MkSet(eSchComponent));
  C := Iter.FirstSchObject;
  while C <> nil do
  begin
    if (AnsiCompareText(C.Designator.Text, Ref) = 0) and (C.CurrentPartID = PartId) then
    begin
      Result := C;
      break;
    end;
    C := Iter.NextSchObject;
  end;
  SchDoc.SchIterator_Destroy(Iter);
end;

procedure RegisterObj(SchDoc: ISch_Document; Obj: TObject);
begin
  SchDoc.RegisterSchObjectInContainer(Obj);
  SchServer.RobotManager.SendMessage(SchDoc.I_ObjectAddress, c_BroadCast,
    SCHM_PrimitiveRegistration, Obj.I_ObjectAddress);
end;

procedure SetFootprint(Comp: TObject; FpName: String; Ref: String);
var
  Iter, Impl: TObject;
  Found: Boolean;
begin
  Found := False;
  Iter := Comp.SchIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eImplementation));
  Impl := Iter.FirstSchObject;
  while Impl <> nil do
  begin
    if UpperCase(Impl.ModelType) = 'PCBLIB' then
    begin
      if AnsiCompareText(Impl.ModelName, FpName) = 0 then
      begin
        Impl.IsCurrent := True;
        Found := True;
      end
      else
        Impl.IsCurrent := False;
    end;
    Impl := Iter.NextSchObject;
  end;
  Comp.SchIterator_Destroy(Iter);
  if not Found then
  begin
    Impl := Comp.AddSchImplementation;
    if Impl = nil then
    begin
      Report.Add('[AVISO] ' + Ref + ': nao consegui criar o modelo de footprint "' + FpName +
        '" - defina manualmente no Altium');
      Exit;
    end;
    Impl.ModelName := FpName;
    Impl.ModelType := 'PCBLIB';
    Impl.Description := '';
    Impl.MapAsString := '';
    Impl.IsCurrent := True;
  end;
end;

// Escreve "Chave=Valor;Chave=Valor" como parametros do componente. Parametro que ja
// existe (o simbolo do almoxarifado nasce com todos declarados e ocultos) e reaproveitado
// em vez de duplicado - dois "Value" no mesmo componente confundem o BOM.
procedure AplicaParams(Comp: ISch_Component; Texto: String);
var
  i, p: Integer;
  Campo, Nome, Valor: String;
  Iter, Obj, Alvo: TObject;
  Par: ISch_Parameter;
begin
  Texto := Texto + ';';
  Campo := '';
  for i := 1 to Length(Texto) do
  begin
    if Texto[i] <> ';' then
    begin
      Campo := Campo + Texto[i];
      Continue;
    end;
    p := Pos('=', Campo);
    if (p > 1) and (Length(Campo) > p) then
    begin
      Nome := Copy(Campo, 1, p - 1);
      Valor := Copy(Campo, p + 1, Length(Campo));
      Alvo := nil;
      Iter := Comp.SchIterator_Create;
      Iter.AddFilter_ObjectSet(MkSet(eParameter));
      Obj := Iter.FirstSchObject;
      while Obj <> nil do
      begin
        if AnsiCompareText(Obj.Name, Nome) = 0 then
        begin
          Alvo := Obj;
          break;
        end;
        Obj := Iter.NextSchObject;
      end;
      Comp.SchIterator_Destroy(Iter);

      if Alvo <> nil then
        Alvo.Text := Valor
      else
      begin
        Par := SchServer.SchObjectFactory(eParameter, eCreate_GlobalCopy);
        if Par <> nil then
        begin
          Par.Name := Nome;
          Par.Text := Valor;
          Par.IsHidden := True;
          Par.OwnerPartId := -1;
          Par.Location := Point(Comp.Location.X, Comp.Location.Y);
          Comp.AddSchObject(Par);
        end;
      end;
    end;
    Campo := '';
  end;
end;

// ─── componente que JA ESTA na folha: atualiza a identidade, nao recria ───────────
// O caso e a migracao de um projeto antigo para a biblioteca nova: o hub vincula cada
// componente ao item do almoxarifado (schematic.js ganha `sym`, `comment` e `params`
// novos) e este script leva isso para a folha real.
//
// ATUALIZA, NUNCA RECRIA, e a diferenca nao e estilo:
//   - o UniqueID e o que liga o componente do esquema ao da PCB. Apagar e recolocar da um
//     UniqueID novo, e o ECO seguinte trata a peca como OUTRA: some da PCB e volta sem
//     posicao nem roteamento. O AI-GUIDE ja registra que e por isso que o re-despejo
//     reaproveita o componente pelo designador/parte.
//   - os fios sao objetos separados, ancorados em COORDENADA. O componente ficando onde
//     esta, a fiacao continua encostada onde estava.
//
// O QUE ESTA ROTINA NAO FAZ: redesenhar o simbolo. Trocar o LibReference diz QUAL peca da
// biblioteca o componente e — e e isso que o ExportProject le de volta como `sym`
// (ExportProject.pas:1089) —, mas o desenho na folha e a copia que foi replicada no dia em
// que o componente nasceu. Quem repoe o desenho a partir da biblioteca e o proprio Altium,
// em Tools » Update From Libraries, que mostra antes o que vai mudar. O relatorio avisa.
procedure AtualizaComp(SchDoc: ISch_Document; C: TObject; Line: String; Ref: String; PartId: Integer);
var
  SymNovo, SymVelho, ComentNovo, Mudou: String;
begin
  SymNovo := JGet(Line, 'sym');
  SymVelho := C.LibReference;
  Mudou := '';

  // simbolo que nao esta na biblioteca NAO entra: melhor o componente continuar o que era
  // do que ficar apontando para uma peca que nao existe
  if (SymNovo <> '') and (AnsiCompareText(SymVelho, SymNovo) <> 0) then
  begin
    if FindLibSymbol(SymNovo) = nil then
    begin
      LogFail('comp ' + Ref + '/' + IntToStr(PartId) + ': simbolo novo "' + SymNovo +
        '" nao esta na SchLib - identidade NAO foi trocada');
      SymNovo := '';
    end;
  end;

  SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
    SCHM_BeginModify, c_NoEventData);

  if (SymNovo <> '') and (AnsiCompareText(SymVelho, SymNovo) <> 0) then
  begin
    C.LibReference := SymNovo;
    Mudou := Mudou + 'simbolo ' + SymVelho + ' -> ' + SymNovo + '; ';
  end;

  if JHas(Line, 'comment') then
  begin
    ComentNovo := JGet(Line, 'comment');
    if C.Comment.Text <> ComentNovo then
    begin
      C.Comment.Text := ComentNovo;
      Mudou := Mudou + 'comment; ';
    end;
  end;

  // os dois reaproveitam o que ja existe (parametro pelo nome, modelo pelo ModelName),
  // entao chamar num componente ja colocado nao duplica nada
  if JHas(Line, 'params') then
  begin
    AplicaParams(C, JGet(Line, 'params'));
    Mudou := Mudou + 'params; ';
  end;
  if JGet(Line, 'footprint') <> '' then
    SetFootprint(C, JGet(Line, 'footprint'), Ref);

  SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
    SCHM_EndModify, c_NoEventData);
  C.GraphicallyInvalidate;

  if Mudou = '' then
    LogOk('comp ' + Ref + '/' + IntToStr(PartId) + ' ja existia - nada a atualizar')
  else
  begin
    LogOk('comp ' + Ref + '/' + IntToStr(PartId) + ' atualizado: ' + Mudou);
    if Pos('simbolo ', Mudou) = 1 then
      TrocouSimbolo := True;
  end;
end;

procedure PlaceComp(SchDoc: ISch_Document; Line: String);
var
  LibComp, NewComp: TObject;
  Ref: String;
  PartId: Integer;
  Achado: TObject;
begin
  Ref := JGet(Line, 'ref');
  PartId := 1;
  if JHas(Line, 'part') then
    PartId := Round(JNum(Line, 'part'));
  if PartId < 1 then
    PartId := 1;
  // ja existe na folha (re-despejo): nao duplica. Mas tambem nao ignora - a identidade
  // (simbolo, comment, params, footprint) e atualizada, que e o que leva a biblioteca nova
  // para um projeto antigo. A posicao continua sendo da passada 2b.
  Achado := FindCompInDoc(SchDoc, Ref, PartId);
  if Achado <> nil then
  begin
    AtualizaComp(SchDoc, Achado, Line, Ref, PartId);
    Exit;
  end;
  LibComp := FindLibSymbol(JGet(Line, 'sym'));
  if LibComp = nil then
  begin
    LogFail('comp ' + Ref + ': simbolo "' + JGet(Line, 'sym') + '" sumiu da SchLib');
    Exit;
  end;
  NewComp := LibComp.Replicate;
  if NewComp = nil then
  begin
    LogFail('comp ' + Ref + ': Replicate falhou');
    Exit;
  end;
  // Aqui so entra a parte e o designador: posicao/orientacao/espelho ficam para a
  // passada 2b (PositionComp), depois que o simbolo ja esta na folha.
  NewComp.CurrentPartID := PartId;
  NewComp.Designator.Text := Ref;
  if JHas(Line, 'comment') then
    NewComp.Comment.Text := JGet(Line, 'comment');
  // O valor do almoxarifado nao e mais uma PART do simbolo: ele chega como um campo
  // "params" no formato Chave=Valor;Chave=Valor e vira parametro do componente. E o
  // que leva Value/MPN/Mouser/Estoque/Local/OdooId para o BOM e para a folha.
  if JHas(Line, 'params') then
    AplicaParams(NewComp, JGet(Line, 'params'));
  RegisterObj(SchDoc, NewComp);
  SetFootprint(NewComp, JGet(Line, 'footprint'), Ref);
  LogOk('comp ' + Ref + ' (' + JGet(Line, 'sym') + ' / ' + JGet(Line, 'footprint') + ')');
end;

// Passada 2b: aplica posicao/orientacao/espelho no componente ja colocado.
// A posicao vem POR ULTIMO de proposito: no engine do Altium, mexer em
// Orientation/IsMirrored depois do Location desloca o componente.
procedure PositionComp(SchDoc: ISch_Document; Line: String);
var
  C: TObject;
  Ref, Metodo: String;
  PartId, TX, TY, BL, BR, BB, BT, Tol: Integer;
  TemBBox, Descolado: Boolean;
begin
  Ref := JGet(Line, 'ref');
  PartId := 1;
  if JHas(Line, 'part') then
    PartId := Round(JNum(Line, 'part'));
  if PartId < 1 then
    PartId := 1;
  C := FindCompInDoc(SchDoc, Ref, PartId);
  if C = nil then
  begin
    LogFail('posicao ' + Ref + '/' + IntToStr(PartId) + ': componente nao esta na folha');
    Exit;
  end;
  TX := MilsToCoord(JNum(Line, 'x'));
  TY := MilsToCoord(JNum(Line, 'y'));
  SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
    SCHM_BeginModify, c_NoEventData);
  C.Orientation := RotToOrient(Round(JNum(Line, 'rot')));
  C.IsMirrored := (JGet(Line, 'mirror') = 'true');

  // NUNCA atribuir C.Location := Point(...) num COMPONENTE: isso mexe na ancora
  // sem mover as primitivas do simbolo, e a leitura de volta passa a mentir
  // (a ancora diz o valor certo enquanto o desenho ficou noutro lugar).
  //
  // Medido no .SchDoc real deste projeto: a versao que chamava C.MoveToXY(alvo)
  // deixou os 81 componentes em alvo + (2920,4300) mil - constante, erro zero -
  // enquanto net labels e power ports (que usam Location) ficaram exatos.
  // Isto e, MoveToXY aqui se comporta como movimento RELATIVO: somou o alvo a
  // posicao onde os simbolos ja estavam. Entao movemos por DELTA MEDIDO.
  // Ordem: primeiro a semantica DOCUMENTADA (MoveToXY absoluto), depois a que a
  // medicao sugere (MoveToXY como deslocamento), depois MoveByXY protegido - ele
  // pode simplesmente nao existir neste engine. Cada passo so dispara se o
  // anterior nao acertou e o delta e sempre RELIDO, entao a escada converge
  // qualquer que seja a semantica real e nunca soma coordenada como se fosse
  // deslocamento. Rodar duas vezes nao mexe na segunda (idempotente).
  Metodo := 'ja estava';
  if (C.Location.X <> TX) or (C.Location.Y <> TY) then
  begin
    C.MoveToXY(TX, TY);
    Metodo := 'MoveToXY absoluto';
  end;
  if (C.Location.X <> TX) or (C.Location.Y <> TY) then
  begin
    C.MoveToXY(TX - C.Location.X, TY - C.Location.Y);
    Metodo := 'MoveToXY delta';
  end;
  if (C.Location.X <> TX) or (C.Location.Y <> TY) then
  begin
    try
      C.MoveByXY(TX - C.Location.X, TY - C.Location.Y);
      Metodo := 'MoveByXY delta';
    except
      Metodo := 'MoveByXY indisponivel';
    end;
  end;

  SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
    SCHM_EndModify, c_NoEventData);
  C.GraphicallyInvalidate;

  // CONFERENCIA GEOMETRICA. Comparar so C.Location com o alvo e verificacao
  // circular: e a mesma propriedade que acabamos de escrever. Foi assim que 81
  // componentes desenhados FORA da folha A4 sairam como [OK] - a ancora lia o
  // alvo enquanto o desenho estava (2920,4300) mil dali (medido no .SchDoc).
  // A ancora de um simbolo sao tem que cair DENTRO da caixa dele; se nao cair,
  // ancora e desenho estao descolados e nenhum delta conserta - so refazer.
  //
  // A CAIXA INCLUI O TEXTO DO DESIGNADOR, e e por isso que a passada 2c (que afasta esse
  // texto quando o espelho manda) roda DEPOIS deste teste, e nao aqui dentro. Caixa maior
  // nunca inventa um "descolado" - o teste pergunta se a ancora caiu FORA dela -, mas pode
  // ESCONDER um: mexendo no texto so depois, a 2b continua medindo exatamente o que media
  // antes destes campos existirem.
  //
  // Num RE-despejo, porem, o texto ja vem afastado do PROPRIO arquivo e a caixa ja nasce
  // inflada - para essa parte nao ha ordem de passada que resolva. Inflada de quanto: nos
  // mesmos 159 designadores medidos do PRJ-UR-DI261924 (ExportProject.pas) os deslocamentos
  // vao de -361 a +330 mil em X e de -310 a +1320 mil em Y - mais de SEIS vezes a tolerancia
  // de 200 mil deste teste, e nao "dezenas de mil" como se escreveu aqui antes de conferir.
  // A consequencia e concreta e fica registrada: um componente descolado por ate ~1300 mil
  // em Y pode sair [OK] daqui, porque a ancora ainda cai dentro da caixa que o proprio
  // designador esticou. O descolamento que existiu de verdade (2920x4300 mil) continua sendo
  // pego com folga; o que some e o pequeno.
  TemBBox := True;
  BL := 0; BR := 0; BB := 0; BT := 0;
  try
    BL := C.BoundingRectangle_Full.Left;
    BR := C.BoundingRectangle_Full.Right;
    BB := C.BoundingRectangle_Full.Bottom;
    BT := C.BoundingRectangle_Full.Top;
  except
    TemBBox := False;
  end;
  Descolado := False;
  if TemBBox then
  begin
    Tol := MilsToCoord(200);
    Descolado := (C.Location.X < BL - Tol) or (C.Location.X > BR + Tol) or
                 (C.Location.Y < BB - Tol) or (C.Location.Y > BT + Tol);
  end;

  if (C.Location.X <> TX) or (C.Location.Y <> TY) then
    LogFail('posicao ' + Ref + '/' + IntToStr(PartId) + ': pedido ' +
      IntToStr(TX) + ',' + IntToStr(TY) + ' mas ficou ' +
      IntToStr(C.Location.X) + ',' + IntToStr(C.Location.Y) +
      ' (ultimo metodo: ' + Metodo + ')')
  else if Descolado then
  begin
    // A 2c precisa saber DISTO. La a ancora do componente e a unica referencia possivel
    // para o texto ("ancora + deslocamento"), e aqui acabou de ficar provado que ela mente:
    // ela diz o alvo enquanto o desenho esta longe dali (foi medido 2920x4300 mil). Sem
    // este registro a 2c poe o designador em ancora-mentirosa+dx - milhares de mil do
    // simbolo que o usuario ve - e ainda escreve [OK], porque a conferencia dela confirma
    // uma coordenada que esta certa em relacao a uma referencia errada.
    CompsDescolados := CompsDescolados + ';' + Ref + '/' + IntToStr(PartId) + ';';
    LogFail('posicao ' + Ref + '/' + IntToStr(PartId) + ': ancora em ' +
      JGet(Line, 'x') + ',' + JGet(Line, 'y') + ' mas o DESENHO esta fora dela ' +
      '(caixa ' + IntToStr(BL) + ',' + IntToStr(BB) + ' a ' + IntToStr(BR) + ',' +
      IntToStr(BT) + ') - componente descolado por despejo antigo; apague a folha ' +
      '(Ctrl+A, Delete) e redespeje');
  end
  else
  begin
    if not TemBBox then
      Metodo := Metodo + ', bbox nao verificavel';
    LogOk('posicao ' + Ref + '/' + IntToStr(PartId) + ' -> ' +
      JGet(Line, 'x') + ',' + JGet(Line, 'y') + ' rot ' + JGet(Line, 'rot') +
      ' [' + Metodo + ']');
  end;
end;

{ ------------------- passada 2c: posicao dos textos do componente ------------------- }
{                                                                                         }
{ O item "comp" pode trazer QUATRO campos OPCIONAIS, todos numeros planos em mil:          }
{   refdx/refdy -> deslocamento do texto do DESIGNADOR em relacao a ANCORA do componente   }
{   comdx/comdy -> o mesmo para o texto do COMMENT                                         }
{                                                                                         }
{ A posicao do texto na folha e (comp.x + dx, comp.y + dy): coordenada de FOLHA, mil, Y    }
{ para cima, a mesma de comp.x/comp.y. O texto NAO gira com o componente (o Altium desenha }
{ designador e comment sempre na horizontal), entao aqui nao ha transform nenhum: e soma.  }
{                                                                                         }
{ O PONTO E O CANTO INFERIOR-ESQUERDO do texto, e nao o centro dele - e e o mesmo ponto    }
{ que o .SchDoc guarda (RECORD=34 no designador, RECORD=41 no comment: sem Justification   }
{ os dois nascem BottomLeft). O hub ancora no canto tambem (schframe.js >> textoComp e     }
{ caixaTexto). Os tres lados falam do MESMO ponto, entao aqui NAO HA CONVERSAO A FAZER:    }
{ Txt.Location e, tal e qual, o ponto do contrato. Meia palavra de correcao "para          }
{ centralizar" seria um erro que nunca fecha o ciclo - o espelho leria deslocado para um   }
{ lado e escreveria deslocado para o outro.                                                }
{                                                                                         }
{ AUSENTE NAO E ZERO. Zero e uma posicao legitima - o texto em cima da ancora -, enquanto  }
{ ausente quer dizer "o hub decide sozinho" (ele desenha embaixo/em cima do corpo) e o     }
{ Altium tem de ficar com o que ja tinha. Por isso TODO campo passa pelo portao JHas ANTES }
{ de ser lido: JNum de chave ausente devolve 0 CALADO (ver JNum la em cima), e sem o       }
{ portao os 15 projetos que existem hoje - nenhum deles tem estes campos - teriam TODO     }
{ designador empilhado em cima da ancora do proprio componente, com o relatorio dizendo    }
{ [OK] para cada um.                                                                       }
{                                                                                         }
{ E "ausente nao e zero" vale POR CAMPO, nao por par: dx sem dy nao e "dy = 0". O par e    }
{ EXIGIDO, e meio par e recusado com [FALHA] sem tocar no texto. A escolha e essa, e nao   }
{ "nao mexer nesse eixo", por dois motivos: os dois escritores do arquivo sempre escrevem  }
{ os dois campos juntos e sempre apagam os dois juntos (schframe.js >> arrastar o texto e  }
{ "voltar ao lugar de origem"; ExportProject.pas >> um try por texto, que emite o par ou   }
{ nada), entao meio par nao vem de uso normal - vem de .js editado a mao ou truncado, e    }
{ nessa hora chutar o eixo que falta e escrever no arquivo do usuario uma posicao que      }
{ ninguem pediu. O que existia antes puxava o designador para o X exato da ancora e ainda  }
{ dizia [OK]. Segundo motivo: "nao mexer nesse eixo" exigiria LER a posicao atual do texto }
{ para completar o par - e essa leitura e justamente a sonda que pode nao existir nesta    }
{ instalacao, ou seja, o caminho mais fragil para o caso mais raro.                        }
{                                                                                         }
{ O preco da escolha, dito por inteiro: com meio par o hub AINDA desenha o texto com       }
{ zero no eixo que falta (schframe.js >> textoComp, "dx || 0"), entao previa e folha       }
{ divergem nesse caso unico. E por isso a recusa sai como [FALHA] nomeando o campo que     }
{ falta, e nao em silencio: o relatorio e o unico lugar onde a divergencia aparece.        }

// "No mesmo lugar", com folga. Comparar coordenada interna com igualdade exata faria todo
// re-despejo ver diferenca onde nao ha: o deslocamento da uma volta inteira (Coord -> mil
// no ExportProject via CoordToMils, mil no .js, mil -> Coord aqui via MilsToCoord) e volta
// com o arredondamento da volta. A folga e de 2 mil, bem menor que o menor passo de grade
// da folha (100 mil) - ela nao confunde texto movido com texto parado.
// Sem Abs de proposito: as duas comparacoes dizem o mesmo e nao dependem de mais uma
// primitiva do engine.
function MesmoPonto(AX, AY, BX, BY, Tol: Integer): Boolean;
begin
  Result := (AX - BX <= Tol) and (BX - AX <= Tol) and
            (AY - BY <= Tol) and (BY - AY <= Tol);
end;

// Desliga o autoposicionamento do texto: com ele ligado, o Altium re-ancora o texto sozinho
// e a posicao escrita pode nao aparecer em lugar nenhum.
//
// ISTO E UMA SONDA - e sao TRES suposicoes numa linha so, nenhuma delas medida:
//   1. o NOME. No .SchDoc a marca e OverrideNotAutoPosition (designador) e NotAutoPosition
//      (parametro); como a propriedade se chama no DelphiScript de ESQUEMA, ninguem mediu;
//   2. o MECANISMO. Do lado PCB isto NAO e atribuicao, e METODO:
//      Comp.ChangeNameAutoposition(eAutoPos_Manual) (ApplyChanges.pas >> DoDesignatorMove);
//   3. o DONO. La o metodo e do COMPONENTE, nao do objeto do texto - aqui se atribui no
//      texto, que e o dono que faz sentido para o Comment tambem.
// A consequencia de (2) e (3) e o que precisa estar escrito: se no esquema tambem for
// preciso um metodo, esta atribuicao pode ser ACEITA e nao fazer NADA - sem excecao, sem
// aviso. Por isso ela nunca e prova de coisa nenhuma: quem diz se a posicao pegou e a
// conferencia ANTES/DEPOIS da PositionCompText, nunca esta linha.
//
// O valor vai como INTEIRO CRU (0 = o primeiro item de TTextAutoposition, que do lado PCB e
// o Manual que o ApplyChanges usa) pelo mesmo motivo de style/io da port: constante NOMEADA
// desconhecida e erro de COMPILACAO, derruba o script INTEIRO para todo mundo e nenhum
// try/except pega; propriedade desconhecida e erro de EXECUCAO, que o try/except pega.
//
// O QUE A PRIMEIRA RODADA NUM ALTIUM DE VERDADE RESPONDE, e como ler a resposta:
//   excecao aqui                  -> o NOME esta errado; sai [AVISO] uma vez, com o nome
//                                    tentado, e o resto do despejo segue normal;
//   sem excecao e texto no alvo   -> nome, mecanismo e dono certos;
//   sem excecao e texto re-ancorado pelo Altium -> a atribuicao foi aceita e IGNORADA: o
//                                    caminho e procurar o metodo equivalente ao do lado PCB.
// Recusada, segue-se em frente: a posicao ainda e TENTADA.
//
// E POR ISSO ESTA ROTINA DEVOLVE UM BOOLEAN, em vez de engolir a recusa num aviso. Como o
// nome nunca foi medido, a recusa e o desfecho MAIS PROVAVEL da primeira rodada num Altium
// de verdade - e, sem o valor de volta, esse desfecho ficava invisivel: a posicao era
// escrita, a conferencia antes/depois dava certo e o rodape anunciava "N movidos e
// CONFERIDOS" sem uma palavra de que aqueles N textos continuaram com o autoposicionamento
// LIGADO e vao ser re-ancorados pelo Altium no proximo desenho. "Movido e conferido" e
// "movido e o Altium provavelmente vai desfazer" nao podem ser o mesmo numero.
function DesligaAutoPos(Txt: TObject; Qual: String): Boolean;
begin
  Result := True;
  try
    Txt.Autoposition := 0;
  except
    Result := False;
    AvisaSonda(Qual + '.Autoposition');
  end;
end;

// Aplica refdx/refdy e comdx/comdy num componente que JA ESTA no lugar final.
// Chamada pela passada 2c - o porque de ser uma passada propria esta no comentario dela,
// la na rotina principal.
procedure PositionCompText(SchDoc: ISch_Document; Line: String);
var
  C, Txt: TObject;
  Ref, Qual, Pref, Falta, Quem, Feito, Trava: String;
  PartId, i, AX, AY, TX, TY, Tol: Integer;
  AntesX, AntesY, DepoisX, DepoisY: Integer;
  DX, DY: Double;
  TemX, TemY, LeuAntes, LeuDepois, Escreveu, TravouAutoPos: Boolean;
begin
  // Espelho antigo nao tem nenhum dos quatro campos: sai ANTES de procurar o componente.
  // Para quem nao usa, esta passada nao toca em propriedade nenhuma e nao escreve uma linha
  // sequer no relatorio - que e o que "nao pode mudar de comportamento" quer dizer.
  if not (JHas(Line, 'refdx') or JHas(Line, 'refdy') or
          JHas(Line, 'comdx') or JHas(Line, 'comdy')) then
    Exit;
  Ref := JGet(Line, 'ref');
  PartId := 1;
  if JHas(Line, 'part') then
    PartId := Round(JNum(Line, 'part'));
  if PartId < 1 then
    PartId := 1;
  Quem := 'texto ' + Ref + '/' + IntToStr(PartId);
  C := FindCompInDoc(SchDoc, Ref, PartId);
  if C = nil then
    // Sai CALADO, de proposito. A passada 2b varre exatamente as mesmas linhas "comp" desta
    // folha e ja registrou [FALHA] para este componente, com este mesmo designador e esta
    // mesma parte: "componente nao esta na folha". Se a 2b nao achou, a 2c nao vai achar, e
    // repetir o recado so dobraria o numero do rodape por um problema so - o usuario iria
    // procurar dois defeitos onde existe um.
    Exit;

  // COMPONENTE DESCOLADO: nao se tenta nada. A 2b mediu e provou que a ancora deste
  // componente diz um lugar enquanto o desenho esta noutro, e a ancora e justamente a unica
  // referencia que esta passada teria para o texto. Tentar aqui poria o designador em
  // ancora-mentirosa + dx, longe do simbolo que o usuario ve, e - pior - registraria [OK],
  // porque a conferencia antes/depois confirmaria uma coordenada certa em relacao a uma
  // referencia errada. O conserto do descolado e refazer a folha (a 2b diz como); ate la o
  // texto fica onde esta.
  // O numero sai no rodape porque "nem tentei" nao pode virar "deu certo" nem sumir: o
  // pedido existiu no .js e tem de aparecer em algum balde.
  if Pos(';' + Ref + '/' + IntToStr(PartId) + ';', CompsDescolados) > 0 then
  begin
    if JHas(Line, 'refdx') or JHas(Line, 'refdy') then
    begin
      TextosPedidos := TextosPedidos + 1;
      TextosPulados := TextosPulados + 1;
    end;
    if JHas(Line, 'comdx') or JHas(Line, 'comdy') then
    begin
      TextosPedidos := TextosPedidos + 1;
      TextosPulados := TextosPulados + 1;
    end;
    // Sem linha propria no relatorio, pelo mesmo motivo do C = nil acima: a 2b ja gritou
    // por este componente, com este designador e esta parte.
    Exit;
  end;

  // A ancora e a do componente COMO ELE ESTA AGORA, e nao o x/y pedido no .js. Isso e para o
  // outro desfecho ruim da 2b, o em que ela nao CONSEGUIU mover o componente: ali a ancora
  // continua honesta - ela diz onde o simbolo de fato ficou - e o texto tem de acompanhar o
  // simbolo, em vez de voar para uma coordenada que ninguem alcancou. O caso em que a ancora
  // MENTE e o descolado, e ele ja saiu logo acima sem tentar nada: se a 2b marcou, nenhum
  // valor lido daqui presta. Com a 2b em ordem os dois numeros sao o mesmo.
  AX := C.Location.X;
  AY := C.Location.Y;
  Tol := MilsToCoord(2);

  for i := 0 to 1 do
  begin
    if i = 0 then
    begin
      Qual := 'Designator';
      Pref := 'ref';
    end
    else
    begin
      Qual := 'Comment';
      Pref := 'com';
    end;
    TemX := JHas(Line, Pref + 'dx');
    TemY := JHas(Line, Pref + 'dy');
    if not (TemX or TemY) then
      continue;
    TextosPedidos := TextosPedidos + 1;

    // O PAR E OBRIGATORIO (o porque esta no cabecalho desta passada): meio par nao vira
    // zero no eixo que falta, vira recusa - e o texto fica exatamente onde esta.
    if not (TemX and TemY) then
    begin
      if TemX then
        Falta := Pref + 'dy'
      else
        Falta := Pref + 'dx';
      LogFail(Quem + ' (' + Qual + '): falta ' + Falta + ' - o par ' + Pref + 'dx/' +
        Pref + 'dy e obrigatorio, o eixo que falta NAO vale zero; texto NAO movido ' +
        '(conserte a linha no .js ou reexporte o projeto)');
      continue;
    end;
    DX := JNum(Line, Pref + 'dx');
    DY := JNum(Line, Pref + 'dy');
    Feito := JF(DX) + ',' + JF(DY) + ' mil da ancora do componente';

    // Faixa valida, no mesmo espirito do style/io da port. 50000 mil e maior que o maior
    // lado de folha do Altium (a A0 tem 46811), entao nenhum deslocamento de texto de
    // verdade e recusado aqui - e um texto a 50000 mil do proprio componente nao seria
    // dele. Recusar e melhor que escrever: fora da folha, o usuario nem acha o texto.
    if (DX < -50000) or (DX > 50000) or (DY < -50000) or (DY > 50000) then
    begin
      LogFail(Quem + ' (' + Qual + '): deslocamento ' + JF(DX) + ',' + JF(DY) +
        ' mil esta fora da faixa - NAO aplicado');
      continue;
    end;

    // Designator e Comment sao OBJETOS de texto do componente. Ler o .Text dos dois e o que
    // este arquivo ja faz e esta provado; pegar o objeto para ESCREVER nele e o passo novo,
    // entao ele tambem vai protegido.
    Txt := nil;
    try
      if i = 0 then
        Txt := C.Designator
      else
        Txt := C.Comment;
    except
      Txt := nil;
    end;
    if Txt = nil then
    begin
      // O nome que vai no aviso diz o que FALHOU: o objeto, e nao a propriedade de posicao
      // dele. Avisar "recusou a propriedade Designator" mandaria investigar Designator.Text,
      // que e justamente o que este arquivo ja usa e sabe que funciona.
      AvisaSonda(Qual + ' (o objeto do texto - nao o ' + Qual + '.Text, que e provado)');
      // Sem o objeto nao ha o que escrever: nada foi tocado, o texto ficou onde estava.
      TextosNaoMexidos := TextosNaoMexidos + 1;
      continue;
    end;

    TX := AX + MilsToCoord(DX);
    TY := AY + MilsToCoord(DY);

    // LEITURA ANTES DA ESCRITA - e ela e o portao de tudo o que vem depois. Duas razoes:
    //
    //   1. e a unica base de comparacao HONESTA. Ler Location DEPOIS de escrever Location e
    //      perguntar a mesma propriedade que acabou de ser gravada: verificacao circular, a
    //      mesma que este arquivo proibe por escrito na passada 2b e que fez 81 componentes
    //      desenhados FORA da folha sairem [OK]. Com o valor de antes na mao da para exigir
    //      o que importa - que a Location tenha MUDADO, e mudado para o alvo -, e e isso que
    //      pega o caso real: a escrita ser aceita e ignorada pelo engine;
    //
    //   2. nao dando para LER, nao se ESCREVE. Sem leitura nao ha como saber se o texto ja
    //      esta onde foi pedido, e escrever as cegas significaria desligar o
    //      autoposicionamento de TODOS os textos da folha para nada (ver a guarda abaixo).
    LeuAntes := True;
    AntesX := 0;
    AntesY := 0;
    try
      AntesX := Txt.Location.X;
      AntesY := Txt.Location.Y;
    except
      LeuAntes := False;
    end;
    if not LeuAntes then
    begin
      AvisaSonda(Qual + '.Location');
      // A guarda acima e explicita: nao dando para LER, nao se ESCREVE. Entao aqui o texto
      // com certeza nao mexeu.
      TextosNaoMexidos := TextosNaoMexidos + 1;
      continue;
    end;

    // JA ESTA NO LUGAR: nao escreve NADA - nem a posicao, nem o autoposicionamento - e nem
    // gasta linha de relatorio. Isto nao e economia, e o contrario de um estrago: foi medido
    // que 156 dos 159 designadores reais NAO carregam a marca OverrideNotAutoPosition, ou
    // seja, hoje eles se reposicionam sozinhos quando o simbolo muda. Como o ExportProject
    // emite refdx/refdy para TODOS (dali nao da para separar "movido a mao" de "posto pelo
    // Altium"), um re-despejo sem esta guarda passaria a folha INTEIRA para manual de uma
    // vez, para sempre, sem ninguem ter pedido - e dali em diante o nome de cada componente
    // so acompanharia o simbolo na unha. Com a guarda, quem perde o autoposicionamento e so
    // o texto que o usuario REALMENTE moveu: o unico cujo deslocamento no .js difere do que
    // esta na folha.
    if MesmoPonto(AntesX, AntesY, TX, TY, Tol) then
    begin
      TextosJaEstavam := TextosJaEstavam + 1;
      continue;
    end;

    // CICLO 1, so o autoposicionamento. Separado de proposito: do lado PCB foi MEDIDO que
    // ele precisa estar commitado ANTES do movimento, senao o Altium re-ancora o texto
    // sozinho (ApplyChanges.pas >> DoDesignatorMove, "num ciclo proprio"). Aqui nao ha
    // medicao nenhuma, entao vale a licao do lado que ja doeu.
    // As mensagens vao no endereco do COMPONENTE, o unico provado neste arquivo.
    // O valor de volta e guardado porque ele muda o VEREDITO la embaixo: texto que chega no
    // alvo sem a trava do autoposicionamento nao entra no mesmo balde do que chega travado.
    SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
      SCHM_BeginModify, c_NoEventData);
    TravouAutoPos := DesligaAutoPos(Txt, Qual);
    SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
      SCHM_EndModify, c_NoEventData);
    // Frase pronta para as mensagens la de baixo. Com o valor de volta na mao, elas param de
    // PERGUNTAR se o autoposicionamento estava ligado e passam a DIZER - a pergunta era a
    // mesma coisa que este arquivo cobra em todo lugar: afirmar (ou duvidar) sem medir.
    if TravouAutoPos then
      Trava := 'a trava do autoposicionamento foi ACEITA e mesmo assim ele re-ancorou'
    else
      Trava := 'o autoposicionamento continuou LIGADO: a trava foi recusada nesta instalacao';

    // CICLO 2, a posicao. Location de TEXTO e a ancora do proprio texto - e o que netlabel
    // e power ja usam aqui, e a medicao do .SchDoc real mostrou esses dois exatos. O
    // "NUNCA atribuir Location" da PositionComp vale para COMPONENTE, que tem as primitivas
    // do simbolo penduradas na ancora; o designador nao tem nenhuma pendurada nele.
    Escreveu := True;
    SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
      SCHM_BeginModify, c_NoEventData);
    try
      Txt.Location := Point(TX, TY);
    except
      Escreveu := False;
    end;
    SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
      SCHM_EndModify, c_NoEventData);
    if not Escreveu then
    begin
      AvisaSonda(Qual + '.Location');
      // A atribuicao levantou excecao: o engine recusou a escrita, entao nenhuma posicao
      // nova foi gravada e o texto ficou onde estava.
      TextosNaoMexidos := TextosNaoMexidos + 1;
      continue;
    end;

    // LEITURA DEPOIS. Leu antes e nao le agora: a escrita foi ACEITA (nenhuma excecao) e nao
    // da para saber onde o texto parou - o provavel e que ele TENHA mexido. Isso nao e "nao
    // mexi", e "mexi e nao sei onde foi parar": balde proprio, e nunca o mesmo de "no
    // lugar" - ver o rodape.
    LeuDepois := True;
    DepoisX := 0;
    DepoisY := 0;
    try
      DepoisX := Txt.Location.X;
      DepoisY := Txt.Location.Y;
    except
      LeuDepois := False;
    end;
    if not LeuDepois then
    begin
      AvisaSonda(Qual + '.Location');
      TextosSemConferencia := TextosSemConferencia + 1;
      continue;
    end;

    // O VEREDITO. Chegar aqui ja quer dizer que o texto NAO estava no alvo antes (a guarda
    // acima teria saido), entao "esta no alvo agora" e mudanca de verdade, e nao a leitura
    // de volta do que acabou de ser gravado.
    if MesmoPonto(DepoisX, DepoisY, TX, TY, Tol) then
    begin
      if TravouAutoPos then
      begin
        TextosPostos := TextosPostos + 1;
        LogOk(Quem + ' (' + Qual + ') -> ' + Feito);
      end
      else
      begin
        // CHEGOU NO ALVO, MAS SEM TRAVA. A posicao foi escrita e conferida AGORA - por isso
        // e [OK] e nao [FALHA] -, so que o autoposicionamento continuou ligado: no proximo
        // redesenho o Altium pode re-ancorar este texto sozinho e desfazer tudo, sem avisar
        // ninguem. Numero separado no rodape porque a diferenca e temporal, e nao de grau:
        // um esta feito, o outro esta feito ATE o Altium desenhar de novo.
        TextosSemTrava := TextosSemTrava + 1;
        LogOk(Quem + ' (' + Qual + ') -> ' + Feito +
          ' - SEM TRAVA: o autoposicionamento nao pode ser desligado (sonda recusada), ' +
          'entao o Altium pode re-ancorar este texto no proximo desenho');
      end;
    end
    else if MesmoPonto(DepoisX, DepoisY, AntesX, AntesY, 0) then
      // O caso que a conferencia circular NUNCA pegaria: a escrita foi aceita (nenhuma
      // excecao) e o engine a ignorou - a Location nao saiu do lugar. Do lado PCB isso e
      // regra, e nao excecao: "escrever XLocation em texto e ignorado neste engine"
      // (ApplyChanges.pas >> DoDesignatorMove, que por isso move com MoveByXY).
      FalhaDeTexto('ignorada', Quem + ' (' + Qual + '): a escrita foi ACEITA mas a Location ' +
        'NAO mudou - continua em ' + IntToStr(AntesX) + ',' + IntToStr(AntesY) + ', pedido ' +
        IntToStr(TX) + ',' + IntToStr(TY) + '. Neste engine a Location de texto pode ser ' +
        'ignorada; o caminho e mover por metodo, como o MoveByXY do lado PCB.')
    else
      FalhaDeTexto('reancorado', Quem + ' (' + Qual + '): pedido ' + IntToStr(TX) + ',' +
        IntToStr(TY) + ' mas ficou ' + IntToStr(DepoisX) + ',' + IntToStr(DepoisY) +
        ' (antes estava em ' + IntToStr(AntesX) + ',' + IntToStr(AntesY) + ') - o Altium ' +
        're-ancorou o texto; ' + Trava);
  end;
  C.GraphicallyInvalidate;
end;

// Confirmacao digitada (usa so primitivas provadas neste engine)
function ConfirmTypedYes(Msg: String): Boolean;
var
  s: String;
begin
  s := Trim(InputBox('AltiumPCBMirror', Msg + #13#10#13#10 + 'Digite SIM para confirmar:', ''));
  Result := (AnsiCompareText(s, 'SIM') = 0);
end;

// Conta o que ainda esta na folha dos tipos que este script despeja.
// Componente NAO entra: ele e reaproveitado pelo designador/parte (PlaceComp),
// para preservar o UniqueID de que o ECO depende - apagar e recriar faria a PCB
// perder o casamento com os componentes ja posicionados.
// O carimbo tambem nao entra: os rotulos dele pertencem ao template (OwnerIndex
// do objeto de template), e o iterador de documento so devolve o nivel de cima.
function CountDumpedObjects(SchDoc: ISch_Document): Integer;
var
  Iter, Obj: TObject;
begin
  Result := 0;
  Iter := SchDoc.SchIterator_Create;
  if Iter = nil then
    Exit;
  Iter.AddFilter_ObjectSet(MkSet(eWire, eNetLabel, ePowerObject, ePort, eJunction, eNoERC));
  Obj := Iter.FirstSchObject;
  while Obj <> nil do
  begin
    Result := Result + 1;
    Obj := Iter.NextSchObject;
  end;
  SchDoc.SchIterator_Destroy(Iter);
end;

// Remove da folha os objetos que este script cria (fios, rotulos, power ports,
// junctions e textos). O template/carimbo da folha NAO e tocado.
// Serve para re-despejar sem duplicar o que ja foi despejado antes.
//
// POR QUE A VERSAO ANTERIOR REMOVIA ZERO (medido: "sobraram 631 de 631",
// depois 937 de 937, depois 1243 de 1243 - crescendo 306 por run, que e um
// despejo inteiro):
//
//  1) Ela guardava os objetos num TStringList (Lst.AddObject / Lst.Objects[i]).
//     Objeto de esquema em DelphiScript e uma INTERFACE (ISch_*); o slot
//     Objects[] e um TObject da RTL do host. O round-trip pelo slot descarta a
//     referencia, e RemoveSchObject recebe lixo e vira no-op silencioso.
//     Todo exemplo oficial da Altium que coleta antes de apagar usa
//     TInterfaceList - mas esse tipo nao esta na lista de classes garantidas do
//     DelphiScript, entao aqui nao usamos container NENHUM.
//  2) Ela nunca avisava o servidor. Quem notifica a REMOCAO e a MESMA mensagem
//     do cadastro, SCHM_PrimitiveRegistration - nao existe (e nunca existiu)
//     SCHM_PrimitiveDeRegistration na API de esquema; a tabela SCHM_ vai de 0 a
//     14 sem lacuna. O comentario antigo aqui acertou o sintoma e errou a
//     conclusao: nao havia o que contornar.
//
// Este e o idioma oficial (DeleteSchObjects.pas, (c) Altium Limited): avanca o
// iterador ANTES de remover (o objeto sai do banco mas continua em memoria, por
// isso I_ObjectAddress ainda vale na linha seguinte), remove, e so entao avisa.
// UMA passada - o laco de 12 da versao anterior era sintoma, nao solucao.
// PreProcess/PostProcess ficam com o chamador; nao aninhar outro par aqui.
procedure ClearDumpedObjects(SchDoc: ISch_Document);
var
  Iter, Obj, Prox: TObject;
  Antes, Restam: Integer;
begin
  Antes := CountDumpedObjects(SchDoc);
  if Antes = 0 then
  begin
    LogOk('limpeza: folha ja estava limpa');
    Exit;
  end;
  Iter := SchDoc.SchIterator_Create;
  if Iter = nil then
  begin
    LogFail('limpeza: SchIterator_Create devolveu nil - nada removido');
    Exit;
  end;
  Iter.AddFilter_ObjectSet(MkSet(eWire, eNetLabel, ePowerObject, ePort, eJunction, eNoERC));
  Obj := Iter.FirstSchObject;
  while Obj <> nil do
  begin
    Prox := Iter.NextSchObject;
    SchDoc.RemoveSchObject(Obj);
    SchServer.RobotManager.SendMessage(SchDoc.I_ObjectAddress, c_BroadCast,
      SCHM_PrimitiveRegistration, Obj.I_ObjectAddress);
    Obj := Prox;
  end;
  SchDoc.SchIterator_Destroy(Iter);
  SchDoc.GraphicallyInvalidate;
  Restam := CountDumpedObjects(SchDoc);
  if Restam = 0 then
    LogOk('limpeza: folha zerada - ' + IntToStr(Antes) + ' objetos removidos')
  else
    LogFail('limpeza: sobraram ' + IntToStr(Restam) + ' de ' + IntToStr(Antes) +
      ' objetos - o despejo seria duplicado');
end;

// Janela com os .SchDoc do projeto focado; devolve o caminho escolhido ('' = cancelou)
function PickProjectSchDoc(Prj: IProject; SheetName: String): String;
var
  F: TForm;
  LB: TListBox;
  BOk, BCan: TButton;
  Lbl: TLabel;
  Paths: TStringList;
  Doc: IDocument;
  i, res: Integer;
begin
  Result := '';
  Paths := TStringList.Create;
  for i := 0 to Prj.DM_LogicalDocumentCount - 1 do
  begin
    Doc := Prj.DM_LogicalDocuments(i);
    if Doc = nil then
      continue;
    if AnsiCompareText(Doc.DM_DocumentKind, 'SCH') = 0 then
      Paths.Add(Doc.DM_FullPath);
  end;
  if Paths.Count = 0 then
  begin
    ShowMessage('O projeto nao tem nenhum .SchDoc.' + #13#10 +
      'Crie uma folha de esquema (File >> New >> Schematic), salve no projeto e rode de novo.');
    Paths.Free;
    Exit;
  end;
  if Paths.Count = 1 then
  begin
    Result := Paths[0];
    Paths.Free;
    Exit;
  end;

  F := TForm.Create(nil);
  F.Caption := 'AltiumPCBMirror - onde despejar "' + SheetName + '"';
  F.Width := 620;
  F.Height := 360;
  Lbl := TLabel.Create(F);
  Lbl.Parent := F;
  Lbl.Left := 12;
  Lbl.Top := 12;
  Lbl.Width := 580;
  Lbl.Caption := 'Escolha o esquematico do projeto que vai receber "' + SheetName + '":';
  LB := TListBox.Create(F);
  LB.Parent := F;
  LB.Left := 12;
  LB.Top := 36;
  LB.Width := 580;
  LB.Height := 228;
  for i := 0 to Paths.Count - 1 do
    LB.Items.Add(Paths[i]);
  LB.ItemIndex := 0;
  BOk := TButton.Create(F);
  BOk.Parent := F;
  BOk.Caption := 'Despejar aqui';
  BOk.Left := 384;
  BOk.Top := 276;
  BOk.Width := 110;
  BOk.Height := 28;
  BOk.ModalResult := 1;
  BCan := TButton.Create(F);
  BCan.Parent := F;
  BCan.Caption := 'Cancelar';
  BCan.Left := 502;
  BCan.Top := 276;
  BCan.Width := 90;
  BCan.Height := 28;
  BCan.ModalResult := 2;
  res := F.ShowModal;
  if (res = 1) and (LB.ItemIndex >= 0) then
    Result := Paths[LB.ItemIndex];
  F.Free;
  Paths.Free;
end;

procedure PlaceWire(SchDoc: ISch_Document; Line: String);
var
  Wire: TObject;
  Pts: TStringList;
  i, p: Integer;
  x, y: Double;
begin
  Pts := ParsePts(Line);
  if Pts.Count < 2 then
  begin
    LogFail('wire: pts precisa de >= 2 pontos');
    Pts.Free;
    Exit;
  end;
  Wire := SchServer.SchObjectFactory(eWire, eCreate_GlobalCopy);
  if Wire = nil then
  begin
    LogFail('wire: factory falhou');
    Pts.Free;
    Exit;
  end;
  p := Pos('|', Pts[0]);
  x := StrToFloatDot(Copy(Pts[0], 1, p - 1));
  y := StrToFloatDot(Copy(Pts[0], p + 1, 255));
  Wire.Location := Point(MilsToCoord(x), MilsToCoord(y));
  for i := 0 to Pts.Count - 1 do
  begin
    p := Pos('|', Pts[i]);
    x := StrToFloatDot(Copy(Pts[i], 1, p - 1));
    y := StrToFloatDot(Copy(Pts[i], p + 1, 255));
    Wire.InsertVertex := i + 1;
    Wire.SetState_Vertex(i + 1, Point(MilsToCoord(x), MilsToCoord(y)));
  end;
  RegisterObj(SchDoc, Wire);
  LogOk('wire com ' + IntToStr(Pts.Count) + ' pontos');
  Pts.Free;
end;

procedure PlaceNetLabel(SchDoc: ISch_Document; Line: String);
var
  NL: TObject;
begin
  NL := SchServer.SchObjectFactory(eNetLabel, eCreate_GlobalCopy);
  if NL = nil then
  begin
    LogFail('netlabel ' + JGet(Line, 'net') + ': factory falhou');
    Exit;
  end;
  NL.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  NL.Orientation := RotToOrient(Round(JNum(Line, 'rot')));
  NL.Text := JGet(Line, 'net');
  RegisterObj(SchDoc, NL);
  LogOk('netlabel ' + JGet(Line, 'net'));
end;

// A Port do Altium. Diferencas em relacao ao power/netlabel, medidas no .SchDoc real:
// o nome mora em .Name (nao .Text) e nao ha Orientation - a direcao vem do Style.
// Width em 0 nasceria invisivel, entao um w ausente vira 400 mil (o padrao do Altium).
// Cada propriedade vai em try/except: se esta instalacao recusar alguma, a port ainda
// nasce com o resto, em vez de derrubar a folha inteira no meio do despejo.
// "#rrggbb" -> TColor BGR do Delphi (o byte baixo e o VERMELHO). -1 quando a string nao e
// uma cor: melhor nao escrever nada do que pintar a port de uma cor inventada.
function CorDeHex(s: String): Integer;
var
  r, g, b: Integer;
begin
  Result := -1;
  if Length(s) <> 7 then
    Exit;
  if s[1] <> '#' then
    Exit;
  try
    r := StrToInt('$' + Copy(s, 2, 2));
    g := StrToInt('$' + Copy(s, 4, 2));
    b := StrToInt('$' + Copy(s, 6, 2));
  except
    Exit;
  end;
  Result := r + (g shl 8) + (b shl 16);
end;

procedure PlacePort(SchDoc: ISch_Document; Line: String);
var
  PT: TObject;
  W: Double;
  Cor: Integer;
begin
  PT := SchServer.SchObjectFactory(ePort, eCreate_GlobalCopy);
  if PT = nil then
  begin
    LogFail('port ' + JGet(Line, 'net') + ': factory falhou');
    Exit;
  end;
  PT.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  W := JNum(Line, 'w');
  if W <= 0 then
    W := 400;
  try
    PT.Name := JGet(Line, 'net');
  except
    LogFail('port ' + JGet(Line, 'net') + ': propriedade Name recusada pelo Altium');
  end;
  try
    PT.Width := MilsToCoord(W);
  except
    LogFail('port ' + JGet(Line, 'net') + ': propriedade Width recusada pelo Altium');
  end;
  // style/io so sao escritos se vieram do Altium. -1 (ou ausente) quer dizer "o export
  // nao conseguiu ler" - nesse caso deixa o Altium usar o padrao dele em vez de gravar
  // um numero inventado por cima.
  if JHas(Line, 'style') and (Round(JNum(Line, 'style')) >= 0) then
  try
    PT.Style := Round(JNum(Line, 'style'));
  except
    LogFail('port ' + JGet(Line, 'net') + ': propriedade Style recusada pelo Altium');
  end;
  if JHas(Line, 'io') and (Round(JNum(Line, 'io')) >= 0) then
  try
    PT.IOType := Round(JNum(Line, 'io'));
  except
    LogFail('port ' + JGet(Line, 'net') + ': propriedade IOType recusada pelo Altium');
  end;
  // As cores da ficha da vista Esquema voltam para o Altium. Sem isto o ajuste feito no
  // hub seria desfeito no proximo despejo, e a "cor editavel" seria so cosmetica no HTML.
  // Campo ausente = nao mexer: a port fica com a cor que o Altium ja da a ela.
  Cor := CorDeHex(JGet(Line, 'fill'));
  if Cor >= 0 then
  try
    PT.AreaColor := Cor;
  except
    LogFail('port ' + JGet(Line, 'net') + ': propriedade AreaColor recusada pelo Altium');
  end;
  Cor := CorDeHex(JGet(Line, 'textColor'));
  if Cor >= 0 then
  try
    PT.TextColor := Cor;
  except
    LogFail('port ' + JGet(Line, 'net') + ': propriedade TextColor recusada pelo Altium');
  end;
  Cor := CorDeHex(JGet(Line, 'color'));
  if Cor >= 0 then
  try
    PT.Color := Cor;
  except
    LogFail('port ' + JGet(Line, 'net') + ': propriedade Color recusada pelo Altium');
  end;
  RegisterObj(SchDoc, PT);
  LogOk('port ' + JGet(Line, 'net'));
end;

procedure PlacePower(SchDoc: ISch_Document; Line: String);
var
  PW: TObject;
begin
  PW := SchServer.SchObjectFactory(ePowerObject, eCreate_GlobalCopy);
  if PW = nil then
  begin
    LogFail('power ' + JGet(Line, 'net') + ': factory falhou');
    Exit;
  end;
  PW.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  PW.Orientation := RotToOrient(Round(JNum(Line, 'rot')));
  PW.Style := StyleFromName(JGet(Line, 'style'));
  PW.Text := JGet(Line, 'net');
  PW.ShowNetName := True;
  RegisterObj(SchDoc, PW);
  LogOk('power ' + JGet(Line, 'net'));
end;

// A diretiva No ERC - o X vermelho que marca um pino como solto DE PROPOSITO. E um objeto
// de PONTO, igual a junction: so a ancora importa, e ela precisa cair EXATAMENTE na ponta
// quente do pino, senao o Altium prende a diretiva ao lado e o ERC continua reclamando.
// O simbolo (cruz fina/grossa/circulo) e a cor ficam no default do Altium ate serem MEDIDOS
// num Altium de verdade - a Port ja ensinou o preco de adivinhar constante nomeada.
procedure PlaceNoERC(SchDoc: ISch_Document; Line: String);
var
  N: TObject;
begin
  N := SchServer.SchObjectFactory(eNoERC, eCreate_GlobalCopy);
  if N = nil then
  begin
    LogFail('noerc: factory falhou');
    Exit;
  end;
  N.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  RegisterObj(SchDoc, N);
  LogOk('noerc');
end;

procedure PlaceJunction(SchDoc: ISch_Document; Line: String);
var
  J: TObject;
begin
  J := SchServer.SchObjectFactory(eJunction, eCreate_GlobalCopy);
  if J = nil then
  begin
    LogFail('junction: factory falhou');
    Exit;
  end;
  J.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  RegisterObj(SchDoc, J);
  LogOk('junction');
end;

// O carimbo/template da folha tambem e feito de eLabel (DESEN., VERIF., =Revisao,
// =Arquivo, ...) e o iterador de documento ALCANCA esses rotulos - medido: a folha
// "vazia" ainda devolvia 26. Por isso eLabel ficou de fora da limpeza: apagar por
// tipo levaria o carimbo junto. Em troca, o texto do despejo e IDEMPOTENTE - se ja
// existe um rotulo com o mesmo conteudo na mesma posicao, nao cria outro.
function FindLabelAt(SchDoc: ISch_Document; Txt: String; X, Y: Integer): TObject;
var
  Iter, L: TObject;
begin
  Result := nil;
  Iter := SchDoc.SchIterator_Create;
  if Iter = nil then
    Exit;
  Iter.AddFilter_ObjectSet(MkSet(eLabel));
  L := Iter.FirstSchObject;
  while L <> nil do
  begin
    if (L.Text = Txt) and (L.Location.X = X) and (L.Location.Y = Y) then
    begin
      Result := L;
      break;
    end;
    L := Iter.NextSchObject;
  end;
  SchDoc.SchIterator_Destroy(Iter);
end;

procedure PlaceText(SchDoc: ISch_Document; Line: String);
var
  L: TObject;
  TX, TY: Integer;
begin
  TX := MilsToCoord(JNum(Line, 'x'));
  TY := MilsToCoord(JNum(Line, 'y'));
  if FindLabelAt(SchDoc, JGet(Line, 's'), TX, TY) <> nil then
  begin
    LogOk('text "' + JGet(Line, 's') + '" ja existia - mantido');
    Exit;
  end;
  L := SchServer.SchObjectFactory(eLabel, eCreate_GlobalCopy);
  if L = nil then
  begin
    LogFail('text: factory falhou');
    Exit;
  end;
  L.Location := Point(TX, TY);
  L.Text := JGet(Line, 's');
  RegisterObj(SchDoc, L);
  LogOk('text "' + JGet(Line, 's') + '"');
end;

{ ------------------------------- rotina principal ------------------------------- }

// Cria os .SchDoc do projeto focado a partir de <ProjDir>\schematic.js.
// Tem parametro de proposito: some do menu Run Script (chamada por ApplyProject).
procedure BuildSchematicInto(ProjDir: String);
var
  WS: IWorkspace;
  Prj: IProject;
  ProjFolder, SchFile, Line, T, SheetName, TargetPath, SalvouTxt: String;
  Src, Syms, Fps, Refs, SheetNames, SheetSizes, Pts, ItemSheets: TStringList;
  i, si, ErrCount, PartId, Restantes, AntesSave, DepoisSave: Integer;
  EstiloFolha: Integer;                  // -1 = folha custom: nao escrever SheetStyle
  ServerDoc: IServerDocument;
  SchDoc: ISch_Document;
  RelTxt, TxtWarn: String;
  Gravou: Boolean;
begin
  // Raiz do workspace DESTA maquina: PRIMEIRA coisa do procedimento, porque tudo abaixo
  // depende dela (ResolveProjectDir, ListProjectDirs, o indice projects.js).
  SCRIPT_HOME := HubHome(0);
  if SCRIPT_HOME = '' then
    Exit;
  PROJECTS_DIR := SCRIPT_HOME + '\Projects';

  ALMOX_DIR := SCRIPT_HOME + '\Libs\Almox';
  // A biblioteca da casa MORA no workspace desde que o guardiao passou a publica-la:
  // o padrao e relativo a SCRIPT_HOME, e as chaves schlib/pcblib do home.txt so
  // existem para quem guarda a lib noutro lugar.
  SCHLIB_FILE := HomeCfgGet('schlib');
  if SCHLIB_FILE = '' then
    SCHLIB_FILE := SCRIPT_HOME + SCHLIB_REL;
  PCBLIB_FILE := HomeCfgGet('pcblib');
  if PCBLIB_FILE = '' then
    PCBLIB_FILE := SCRIPT_HOME + PCBLIB_REL;

  if SchServer = nil then
  begin
    ShowMessage('SchServer indisponivel. Abra um documento de esquema qualquer e rode de novo.');
    Exit;
  end;
  WS := GetWorkspace;
  Prj := nil;
  if WS <> nil then
    Prj := WS.DM_FocusedProject;
  if (Prj = nil) or (BaseName(Prj.DM_ProjectFileName) = 'Free Documents') then
  begin
    ShowMessage('Nenhum projeto focado. Crie/abra o .PrjPcb do projeto (File >> New >> Project) e rode de novo.');
    Exit;
  end;

  if ProjDir = '' then
    Exit;
  SchFile := ProjDir + '\schematic.js';
  if not FileExists(SchFile) then
  begin
    ShowMessage('Nao achei ' + SchFile + #13#10 + 'Peca o esquema a IA primeiro.');
    Exit;
  end;
  ProjFolder := ExtractFilePath(Prj.DM_ProjectFullPath);

  Report := TStringList.Create;
  Report.Add('AltiumPCBMirror - BuildSchematic');
  Report.Add('Projeto: ' + Prj.DM_ProjectFullPath);
  Report.Add('Fonte:   ' + SchFile);
  Report.Add('Data:    ' + DateTimeToStr(Now));
  Report.Add('');
  OkCount := 0;
  TrocouSimbolo := False;   // DelphiScript nao zera global: sem isto o aviso do
                           // relatorio herdaria o valor da rodada anterior do script
  AvisosDeTexto := '';     // idem: sem zerar, a segunda rodada da sessao ficaria MUDA
                           // sobre uma propriedade que o Altium recusou de novo
  CompsDescolados := '';   // idem: sem zerar, a 2c pularia o texto de um componente que so
                           // estava descolado na rodada ANTERIOR - e que esta rodada, com a
                           // folha ja refeita, posicionaria sem problema
  TextosPedidos := 0;
  TextosPostos := 0;
  TextosSemTrava := 0;
  TextosJaEstavam := 0;
  TextosNaoMexidos := 0;
  TextosSemConferencia := 0;
  TextosRecusados := 0;
  TextosPulados := 0;
  FailCount := 0;

  Src := TStringList.Create;
  Src.LoadFromFile(SchFile);

  { ---------------- PASSO 1: validacao total (nada e criado se houver erro) ---------------- }
  ErrCount := 0;
  Syms := TStringList.Create;  Syms.Sorted := True;  Syms.Duplicates := dupIgnore;  Syms.CaseSensitive := False;
  Fps := TStringList.Create;   Fps.Sorted := True;   Fps.Duplicates := dupIgnore;   Fps.CaseSensitive := False;
  Refs := TStringList.Create;  Refs.Sorted := True;  Refs.Duplicates := dupAccept;
  SheetNames := TStringList.Create;
  SheetSizes := TStringList.Create;
  ItemSheets := TStringList.Create;
  ItemSheets.Sorted := True;
  ItemSheets.Duplicates := dupIgnore;

  for i := 0 to Src.Count - 1 do
  begin
    Line := Trim(Src[i]);
    if not JHas(Line, 't') then
      continue;
    T := JGet(Line, 't');
    if T <> 'sheet' then
      ItemSheets.Add(JGet(Line, 'sheet'));
    if T = 'sheet' then
    begin
      SheetNames.Add(JGet(Line, 'name'));
      SheetSizes.Add(JGet(Line, 'size'));
    end
    else if T = 'comp' then
    begin
      if (JGet(Line, 'ref') = '') or (JGet(Line, 'sym') = '') or
        (not JHas(Line, 'x')) or (not JHas(Line, 'y')) then
      begin
        Report.Add('[ERRO] comp invalido (faltam ref/sym/x/y): ' + Line);
        ErrCount := ErrCount + 1;
      end;
      if JGet(Line, 'footprint') = '' then
      begin
        Report.Add('[ERRO] comp ' + JGet(Line, 'ref') + ': falta footprint (obrigatorio)');
        ErrCount := ErrCount + 1;
      end;
      if (Round(JNum(Line, 'rot')) mod 90) <> 0 then
      begin
        Report.Add('[ERRO] comp ' + JGet(Line, 'ref') + ': rot deve ser 0/90/180/270');
        ErrCount := ErrCount + 1;
      end;
      Syms.Add(JGet(Line, 'sym'));
      Fps.Add(JGet(Line, 'footprint'));
      PartId := 1;
      if JHas(Line, 'part') then
        PartId := Round(JNum(Line, 'part'));
      if PartId < 1 then
        PartId := 1;
      Refs.Add(UpperCase(JGet(Line, 'ref')) + '/' + IntToStr(PartId));
    end
    else if T = 'wire' then
    begin
      Pts := ParsePts(Line);
      if Pts.Count < 2 then
      begin
        Report.Add('[ERRO] wire com menos de 2 pontos: ' + Line);
        ErrCount := ErrCount + 1;
      end;
      Pts.Free;
    end
    else if (T = 'netlabel') or (T = 'power') or (T = 'port') then
    begin
      if JGet(Line, 'net') = '' then
      begin
        Report.Add('[ERRO] ' + T + ' sem net: ' + Line);
        ErrCount := ErrCount + 1;
      end;
      // JNum de chave ausente devolve 0 calado: sem este teste um rotulo escrito sem
      // x/y nasceria em (0,0), fora da folha, e ainda apareceria como [OK] no relatorio.
      if (not JHas(Line, 'x')) or (not JHas(Line, 'y')) then
      begin
        Report.Add('[ERRO] ' + T + ' ' + JGet(Line, 'net') + ': faltam x/y: ' + Line);
        ErrCount := ErrCount + 1;
      end;
    end
    else if (T <> 'junction') and (T <> 'text') then
    begin
      // Tipo que o hub escreve e o builder nao conhece. Falhar aqui, no PASSO 1, e o que
      // impede o despejo de "dar certo" jogando fora o trabalho do usuario em silencio.
      Report.Add('[ERRO] tipo "' + T + '" desconhecido - este BuildSchematic nao sabe cria-lo');
      ErrCount := ErrCount + 1;
    end;
  end;

  if SheetNames.Count = 0 then
  begin
    Report.Add('[ERRO] nenhuma folha ({"t":"sheet",...}) no schematic.js');
    ErrCount := ErrCount + 1;
  end;
  for i := 0 to ItemSheets.Count - 1 do
    if SheetNames.IndexOf(ItemSheets[i]) < 0 then
    begin
      Report.Add('[ERRO] item com "sheet":"' + ItemSheets[i] + '" sem folha declarada');
      ErrCount := ErrCount + 1;
    end;
  for i := 1 to Refs.Count - 1 do
    if Refs[i] = Refs[i - 1] then
    begin
      Report.Add('[ERRO] ref duplicado: ' + Refs[i]);
      ErrCount := ErrCount + 1;
    end;

  if not OpenSchLib(0) then
  begin
    ShowMessage('Nao consegui abrir nenhuma SchLib de origem:' + #13#10 +
      SCHLIB_FILE + #13#10 + ALMOX_DIR + #13#10#13#10 +
      'Abra a biblioteca no Altium e rode de novo.');
    Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
    Exit;
  end;
  for i := 0 to Syms.Count - 1 do
    if FindLibSymbol(Syms[i]) = nil then
    begin
      Report.Add('[ERRO] simbolo "' + Syms[i] + '" nao existe em nenhuma das '
                 + IntToStr(SchLibs.Count) + ' SchLib de origem');
      ErrCount := ErrCount + 1;
    end;

  LoadPcbFpNames(0);
  if PcbFpNames = nil then
    Report.Add('[AVISO] PcbLib indisponivel - existencia dos footprints NAO conferida')
  else
    for i := 0 to Fps.Count - 1 do
      if PcbFpNames.IndexOf(Fps[i]) < 0 then
      begin
        Report.Add('[ERRO] footprint "' + Fps[i] + '" nao existe na PcbLib');
        ErrCount := ErrCount + 1;
      end;

  if ErrCount > 0 then
  begin
    Report.Add('');
    Report.Add('VALIDACAO FALHOU com ' + IntToStr(ErrCount) + ' erro(s). NADA foi criado.');
    Gravou := SalvaOuExplica(Report, ProjDir + '\build-report.txt');
    if Gravou then
      ShowMessage('Validacao falhou com ' + IntToStr(ErrCount) + ' erro(s) - nada foi criado.' + #13#10 +
        'Veja ' + ProjDir + '\build-report.txt')
    else
      ShowMessage('Validacao falhou com ' + IntToStr(ErrCount) + ' erro(s) - nada foi criado.' + #13#10 +
        'O relatorio nao pode ser gravado (o aviso anterior diz por que).');
    if PcbFpNames <> nil then
      PcbFpNames.Free;
    Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
    Exit;
  end;
  Report.Add('Validacao OK (' + IntToStr(SheetNames.Count) + ' folha(s)).');
  Report.Add('');

  { ---------------- PASSO 2: despejo folha a folha ----------------
    O usuario escolhe um .SchDoc JA EXISTENTE do projeto (o carimbo/template dele
    e preservado). Dentro da folha o despejo e em tres passadas:
      2a) coloca os simbolos (ou reaproveita o que ja tem o mesmo designador/parte)
      2b) so entao aplica posicao/orientacao/espelho de cada um, conforme o .js
      2c) e, por fim, a posicao dos TEXTOS (designador/comment) de quem pediu
    Aplicar a posicao no fim evita o deslocamento que a mudanca de Orientation
    provoca quando ela vem depois do Location. }
  for si := 0 to SheetNames.Count - 1 do
  begin
    SheetName := SheetNames[si];
    TargetPath := PickProjectSchDoc(Prj, SheetName);
    if TargetPath = '' then
    begin
      LogFail('folha ' + SheetName + ': nenhum .SchDoc escolhido');
      continue;
    end;

    ServerDoc := Client.OpenDocument('SCH', TargetPath);
    if ServerDoc = nil then
    begin
      LogFail('folha ' + SheetName + ': nao consegui abrir ' + TargetPath);
      continue;
    end;
    Client.ShowDocument(ServerDoc);
    SchDoc := SchServer.GetCurrentSchDocument;
    if SchDoc = nil then
    begin
      LogFail('folha ' + SheetName + ': documento nao ficou focado');
      continue;
    end;
    // So mexe no tamanho quando o espelho traz um estilo PADRAO que o Altium conhece.
    // Folha custom (a do template da casa) nao tem estilo a escrever: deixar como esta e
    // o certo — ver o comentario de SheetStyleFromName.
    EstiloFolha := SheetStyleFromName(SheetSizes[si]);
    if EstiloFolha >= 0 then
      SchDoc.SheetStyle := EstiloFolha;

    SchServer.ProcessControl.PreProcess(SchDoc, '');
    if ConfirmTypedYes('Limpar o conteudo ja despejado nesta folha antes?' + #13#10 +
      '(fios, rotulos, power ports, ports, junctions e textos - o carimbo/template fica;' + #13#10 +
      'os componentes sao reaproveitados pelo designador, nao sao apagados)' + #13#10 +
      'Responda SIM se voce ja despejou este projeto aqui antes.') then
      ClearDumpedObjects(SchDoc)
    else
      LogOk('limpeza: pulada a pedido do usuario');

    // TRAVA ANTI-DUPLICACAO: despejar em cima do que ja esta na folha foi
    // exatamente o que produziu 2 e depois 3 copias sobrepostas de cada fio,
    // net label e power port. Se a folha nao esta zerada, NAO despeja - aborta
    // esta folha e diz o que fazer. Vale tanto para limpeza que falhou quanto
    // para o usuario que respondeu NAO sem a folha estar vazia.
    Restantes := CountDumpedObjects(SchDoc);
    if Restantes > 0 then
    begin
      LogFail('folha ' + SheetName + ': DESPEJO ABORTADO - ainda ha ' +
        IntToStr(Restantes) + ' objetos na folha (fios/rotulos/power/ports/junctions/textos). ' +
        'Despejar agora criaria copias sobrepostas. No Altium: Ctrl+A, Delete, e rode de novo.');
      SchServer.ProcessControl.PostProcess(SchDoc, '');
      continue;
    end;

    // 2a) simbolos e demais objetos
    for i := 0 to Src.Count - 1 do
    begin
      Line := Trim(Src[i]);
      if not JHas(Line, 't') then
        continue;
      if JGet(Line, 'sheet') <> SheetName then
        continue;
      T := JGet(Line, 't');
      if T = 'comp' then
        PlaceComp(SchDoc, Line)
      else if T = 'wire' then
        PlaceWire(SchDoc, Line)
      else if T = 'netlabel' then
        PlaceNetLabel(SchDoc, Line)
      else if T = 'power' then
        PlacePower(SchDoc, Line)
      else if T = 'port' then
        PlacePort(SchDoc, Line)
      else if T = 'junction' then
        PlaceJunction(SchDoc, Line)
      else if T = 'noerc' then
        PlaceNoERC(SchDoc, Line)
      else if T = 'text' then
        PlaceText(SchDoc, Line)
      else
        // Sem este else, um tipo que o hub aprendeu e o builder ainda nao sumia sem
        // deixar rastro, com o dialogo final anunciando "Falhas: 0". Melhor falhar alto.
        LogFail('tipo desconhecido "' + T + '" ignorado: ' + Line);
    end;
    // 2b) posiciona cada componente pelo designador/parte do .js
    for i := 0 to Src.Count - 1 do
    begin
      Line := Trim(Src[i]);
      if not JHas(Line, 't') then
        continue;
      if (JGet(Line, 'sheet') <> SheetName) or (JGet(Line, 't') <> 'comp') then
        continue;
      PositionComp(SchDoc, Line);
    end;
    // 2c) posicao dos TEXTOS do componente (refdx/refdy, comdx/comdy). Passada PROPRIA,
    // depois da 2b, por tres motivos - nesta ordem de importancia:
    //   1. a posicao do texto e "ancora do componente + deslocamento", e so existe depois
    //      que o componente chegou no lugar final. A 2b so termina aqui;
    //   2. ela precisa valer TAMBEM para componente que JA ESTAVA na folha - que hoje e o
    //      caso de todos os 15 projetos deste workspace. Esse passa pela AtualizaComp, la
    //      na 2a, quando a ancora dele ainda e a antiga; aplicar o texto de dentro da
    //      AtualizaComp resolveria so o re-despejo e ainda por cima em cima de uma ancora
    //      velha. Uma passada que varre as MESMAS linhas "comp" da 2b pega os dois casos,
    //      novo e existente, sem nenhum if sobre quem colocou o componente;
    //   3. a conferencia geometrica da 2b mede BoundingRectangle_Full, e o designador entra
    //      nessa caixa (ver a nota la). Mexer no texto so depois deixa aquele teste medindo
    //      o mesmo que ele media antes destes campos existirem.
    for i := 0 to Src.Count - 1 do
    begin
      Line := Trim(Src[i]);
      if not JHas(Line, 't') then
        continue;
      if (JGet(Line, 'sheet') <> SheetName) or (JGet(Line, 't') <> 'comp') then
        continue;
      PositionCompText(SchDoc, Line);
    end;
    SchServer.ProcessControl.PostProcess(SchDoc, '');
    SchDoc.GraphicallyInvalidate;

    // SAVE. O que estava aqui era 'DoFileSave('SCH')', e isso passava um
    // DOCUMENT KIND onde a API espera um FILTRO de gravacao - por isso devolvia
    // True sem escrever byte nenhum. Medido: tres runs logaram sucesso e o
    // arquivo em disco (e o History do Altium) ficaram parados no dia 04/08.
    // Filtro correto do .SchDoc binario padrao e a string VAZIA. Alem disso o
    // servidor so grava documento marcado como sujo - dai o SetModified.
    // Nada disso e assumido: o resultado e conferido pela DATA DO ARQUIVO, e
    // quando nao da para provar, o relatorio manda dar Ctrl+S em vez de mentir.
    // (O ApplyChanges, que funciona, nunca salva sozinho: deixa o Ctrl+S pro
    // usuario. Aqui o save e melhor-esforco COM prova.)
    AntesSave := -1;
    DepoisSave := -2;
    try
      AntesSave := FileAge(TargetPath);
    except
      AntesSave := -1;
    end;
    try
      ServerDoc.SetModified(True);
    except
      // engine sem SetModified: segue para o save mesmo assim
    end;
    SalvouTxt := 'False';
    try
      if ServerDoc.DoFileSave('') then
        SalvouTxt := 'True';
    except
      SalvouTxt := 'excecao';
    end;
    try
      DepoisSave := FileAge(TargetPath);
    except
      DepoisSave := -2;
    end;

    if (AntesSave <> -1) and (DepoisSave <> -2) and (DepoisSave <> AntesSave) then
      LogOk('folha ' + SheetName + ' despejada e GRAVADA em: ' + TargetPath)
    else if (AntesSave <> -1) and (DepoisSave = AntesSave) then
      LogFail('folha ' + SheetName + ': o arquivo NAO mudou em disco (' + TargetPath +
        ') - DoFileSave devolveu ' + SalvouTxt +
        '. O despejo esta so na memoria: de Ctrl+S no Altium para gravar.')
    else
      LogFail('folha ' + SheetName + ': nao consegui PROVAR a gravacao de ' + TargetPath +
        ' (DoFileSave devolveu ' + SalvouTxt +
        ', data do arquivo nao verificavel) - de Ctrl+S no Altium por seguranca.');
  end;

  Report.Add('');
  // O aviso so aparece quando ALGUEM trocou de simbolo: recado que sai sempre vira
  // paisagem, e este e justamente o que nao pode ser ignorado.
  if TrocouSimbolo then
  begin
    Report.Add('ATENCAO: componente(s) mudaram de simbolo (LibReference).');
    Report.Add('  A identidade ja e a nova - o ExportProject vai ler o simbolo novo, e o BOM tambem.');
    Report.Add('  O DESENHO na folha continua o antigo: o simbolo de um componente colocado e uma');
    Report.Add('  copia, feita no dia em que ele nasceu. Para repor o desenho a partir da biblioteca,');
    Report.Add('  rode no Altium: Tools > Update From Libraries (ele mostra o que vai mudar antes).');
    Report.Add('');
  end;
  // O numero dos textos e a prova de que a passada 2c fez alguma coisa. Sem ele, "o Altium
  // recusou a propriedade" e "o espelho nao pediu nada" sairiam iguais no relatorio: em
  // silencio. A linha so aparece quando alguem pediu - projeto que nao usa os campos nao
  // ganha linha nova nenhuma.
  //
  // Um numero por DESFECHO, e nao um so: "no lugar", "no lugar mas sem trava", "nada a
  // fazer", "nem mexi", "mexi e nao sei onde parou", "mexi e nao ficou" e "nem tentei" sao
  // sete respostas diferentes, e a primeira nao pode comer nenhuma das outras seis.
  // Esses baldes sao tambem o que impede a enxurrada - numa instalacao que recuse a sonda,
  // uma folha de 159 componentes daria 318 linhas [FALHA] repetindo o mesmo recado e o
  // dialogo anunciaria "Falhas: 318" num despejo em que o desenho saiu inteiro. Aqui isso e
  // UM resumo por rodada, com o [AVISO] (ou a primeira [FALHA]) la em cima dizendo o que
  // esta instalacao recusou.
  if TextosPedidos > 0 then
  begin
    Report.Add('Textos de componente (refdx/refdy, comdx/comdy): ' + IntToStr(TextosPedidos) +
      ' pedidos.');
    Report.Add('  ' + IntToStr(TextosPostos) + ' movidos e CONFERIDOS (posicao lida ANTES e ' +
      'DEPOIS da escrita, e ela mudou para o ponto pedido; a trava do autoposicionamento foi ' +
      'ACEITA - aceita, que nao e o mesmo que provada).');
    if TextosSemTrava > 0 then
    begin
      Report.Add('  ' + IntToStr(TextosSemTrava) + ' movidos e conferidos, mas SEM TRAVA: esta ' +
        'instalacao recusou a propriedade de autoposicionamento (o [AVISO] acima diz qual).');
      Report.Add('     Estao no lugar AGORA e nao contam junto com os de cima: com o');
      Report.Add('     autoposicionamento ligado, o Altium pode re-ancorar cada um deles no');
      Report.Add('     proximo redesenho e desfazer isto sem avisar. Confira depois de');
      Report.Add('     compilar; se voltaram, o caminho e o metodo, como o do lado PCB.');
    end;
    if TextosJaEstavam > 0 then
      Report.Add('  ' + IntToStr(TextosJaEstavam) + ' ja estavam no lugar pedido: nada a fazer, ' +
        'nenhuma propriedade escrita (e por isso nao ha uma linha para cada um acima).');
    if TextosNaoMexidos > 0 then
    begin
      Report.Add('  ' + IntToStr(TextosNaoMexidos) + ' NAO mexidos: a sonda foi recusada e ' +
        'nenhuma posicao chegou a ser gravada (o [AVISO] acima diz qual propriedade).');
      Report.Add('     Nao contam como "no lugar" nem como falha por componente: aqui o texto');
      Report.Add('     ficou mesmo onde o Altium ja o punha.');
    end;
    if TextosSemConferencia > 0 then
    begin
      Report.Add('  ' + IntToStr(TextosSemConferencia) + ' escritos SEM CONFERENCIA: a escrita ' +
        'foi aceita e a RELEITURA foi recusada (o [AVISO] acima diz qual propriedade).');
      Report.Add('     Estes nao sao "nao mexi": o provavel e que tenham mexido, e o que falta');
      Report.Add('     e saber onde pararam. Confira no Altium antes de dar o desenho por bom.');
    end;
    if TextosRecusados > 0 then
      Report.Add('  ' + IntToStr(TextosRecusados) + ' NAO ficaram onde foi pedido (escrita ' +
        'aceita e ignorada, ou texto re-ancorado pelo Altium): a [FALHA] acima e o primeiro ' +
        'caso, com os numeros, e vale por todos eles.');
    if TextosPulados > 0 then
      Report.Add('  ' + IntToStr(TextosPulados) + ' nem tentados: o componente esta DESCOLADO ' +
        '(a [FALHA] de posicao acima nomeia cada um) - a ancora dele mente, e texto posto a ' +
        'partir dela cairia longe do simbolo com cara de [OK]. Refaca a folha e redespeje.');
    if (TextosPostos + TextosSemTrava + TextosJaEstavam + TextosNaoMexidos +
        TextosSemConferencia + TextosRecusados + TextosPulados) < TextosPedidos then
      Report.Add('  O resto esta acima, um a um, com o motivo.');
  end;
  Report.Add('OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount));
  // As folhas ja nasceram na pasta do .PrjPcb; so o relatorio depende da raiz.
  Gravou := SalvaOuExplica(Report, ProjDir + '\build-report.txt');
  if Gravou then
    RelTxt := 'Relatorio: ' + ProjDir + '\build-report.txt'
  else
    RelTxt := 'O relatorio NAO pode ser gravado (o aviso anterior diz por que).';
  if Gravou then
    RegenerateProjectsIndex(ExtractFileName(ProjDir));

  // O DIALOGO E O UNICO LUGAR QUE O USUARIO SEMPRE VE - o build-report.txt ele so abre se
  // tiver motivo, e "OK: 159   Falhas: 0" nao e motivo nenhum. Enquanto o resumo dos textos
  // vivia so no rodape do relatorio, uma instalacao que recusasse a sonda mostrava
  // exatamente o mesmo dialogo de um despejo perfeito, e a recusa podia passar rodadas sem
  // ser vista. O ExportProject ja leva o ATENCAO da sonda dele para dentro do ShowMessage
  // (TxtPosWarn); aqui vale igual - nada de placar que junta "deu certo" com "nao sei".
  // Uma linha por desfecho, e so quando ele aconteceu: despejo limpo continua com o dialogo
  // de sempre.
  TxtWarn := '';
  if TextosSemTrava > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(TextosSemTrava) +
      ' texto(s) no lugar mas SEM TRAVA - o Altium pode' + #13#10 +
      '   re-ancorar cada um no proximo redesenho (sonda de autoposicionamento recusada).';
  if TextosNaoMexidos > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(TextosNaoMexidos) +
      ' texto(s) NAO posicionados - esta instalacao do' + #13#10 +
      '   Altium recusou a sonda de posicao de texto.';
  if TextosSemConferencia > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(TextosSemConferencia) +
      ' texto(s) escritos SEM CONFERENCIA - a releitura' + #13#10 +
      '   foi recusada e nao da para saber onde eles pararam.';
  if TextosRecusados > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(TextosRecusados) +
      ' texto(s) NAO ficaram onde foi pedido.';
  if TextosPulados > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(TextosPulados) +
      ' texto(s) nem tentados - o componente esta DESCOLADO.';
  if TxtWarn <> '' then
    TxtWarn := TxtWarn + #13#10 +
      '   O relatorio explica cada numero (secao "Textos de componente").';

  ShowMessage('Esquema despejado.' + #13#10 +
    'OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount) + TxtWarn + #13#10#13#10 +
    RelTxt + #13#10#13#10 +
    'PROXIMOS PASSOS: salve (Ctrl+S), rode Project >> Compile,' + #13#10 +
    'e depois Design >> Update PCB (ECO) para levar tudo a placa.');

  Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
  if PcbFpNames <> nil then
    PcbFpNames.Free;
end;
