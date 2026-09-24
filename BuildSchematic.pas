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
  AlmoxIndice: Integer;     // .SchLib do almoxarifado achadas pelo almox.csv + FileExists
  AlmoxVarredura: Integer;  // ...e as que o FindFirst devolveu (ver AddAlmoxLibs)
  Report: TStringList;
  OkCount, FailCount: Integer;
  SchLibDoc: ISch_Document;
  SchLibs: TInterfaceList;      // todas as SchLib de origem, na ordem de busca
  SchLibNomes: TStringList;     // os caminhos, para as mensagens
  ScanInfo: String; // diagnostico do ultimo ListProjectDirs (aparece nos dialogos)
  PcbFpNames: TStringList;   // nil = PcbLib indisponivel (validacao de footprint vira aviso)
  BoardFps: TStringList;     // footprints que JA ESTAO na placa deste projeto (board.js)
  BoardRefs: TStringList;    // designador de cada componente da placa...
  BoardRefFp: TStringList;   // ...e o footprint dele, no MESMO indice (ver LoadBoardFps)
  SemFpRefs: TStringList;    // designadores que foram SEM vinculo de footprint (VinculaFootprint)
  NomeDe, NomePara: TStringList;   // cache do NomeNaLib: nome pedido e nome achado, mesmo indice
  RenNovo, RenVelho: TStringList;  // rename-map AO CONTRARIO: nome novo e o antigo, mesmo indice
  SubsDe, SubsPara: TStringList;   // lib-subs: nome do projeto e nome da biblioteca, mesmo indice
  SemSimbRefs: TStringList;        // componentes NOVOS sem simbolo em biblioteca nenhuma: nao colocados
  SimbAntigoRefs: TStringList;     // componentes que JA estavam na folha e ficaram com o simbolo antigo
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
  // Tamanho de folha. Dois baldes porque sao dois desfechos que NAO podem virar um: "troquei
  // a folha do usuario" e "nao troquei porque nao tinha certeza" contam historias opostas, e
  // a versao anterior deste script nao contava nenhuma das duas - escrevia eSheetA4 em cima
  // de qualquer folha, em silencio.
  FolhasTrocadas: Integer;     // folhas cujo tamanho ESTE despejo mudou (de-para no relatorio)
  FolhasPreservadas: Integer;  // folhas deixadas como estavam por falta de certeza

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

  Resposta := SemBarraFinal(InputBox('EletricHUB',
    'Nao achei o workspace do EletricHUB nesta maquina.' + #13#10 +
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

  ShowMessage('Nao achei a raiz do workspace do EletricHUB nesta maquina.' + #13#10 +
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
    Answer := Trim(InputBox('EletricHUB',
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
  Answer := InputBox('EletricHUB', ListStr, '1');
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
// E NAO BASTA O -1. O nome sozinho nunca foi prova: ate esta versao o ExportProject chamava
// TODA folha de "A4" (a A3 do PRJ-UR-DI261924 e uma A0 saiam as duas assim), entao o "A4"
// que chega aqui pode ser qualquer folha do mundo. Quem chama e o AplicaFolha, e ele so usa
// este resultado depois de conferir que a MEDIDA do espelho e a nominal daquele estilo.
// NAO ACRESCENTE eSheet* NOVO aqui: eSheetA0, eSheetD e eSheetE nunca foram usados neste
// repositorio e ninguem sabe se existem - identificador inexistente e erro de COMPILACAO e
// derruba o script inteiro. Folha sem estilo conhecido se escreve como CUSTOM, com a medida.
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

{ ------------------------------- tamanho da folha ------------------------------- }
{ O bloco de MEDIDA (DifAbs, CasaMedida, SheetNameFromMils) e DUPLICADO, com o mesmo texto, }
{ no ExportProject.pas - de proposito, pelo mesmo motivo do bloco HOME: o .PrjScr nao ganha  }
{ unidade nova e resolucao entre unidades do DelphiScript do Altium nao da para testar fora  }
{ do Altium. Mudou aqui, mude la.                                                            }

// DIFERENCA ABSOLUTA sem usar Abs. Abs nao aparece em nenhum destes scripts, e neste engine
// identificador que nao existe e erro de COMPILACAO: derruba o script INTEIRO, nao a linha
// (foi o que ePortLeft e ePortNone_Vertical fizeram - ver o comentario do PortStyle acima).
// Duas subtracoes custam menos que descobrir isso dentro do Altium.
function DifAbs(a: Double; b: Double): Double;
begin
  if a > b then
    Result := a - b
  else
    Result := b - a;
end;

// Duas medidas sao a MESMA folha? Tolerancia de 5 mil (0,127 mm), escolhida pelos dois
// lados:
//   - folga de sobra para o ruido. A folha ISO nasce em mm e chega aqui em mil
//     (297 mm = 11692,9134 mil), passando pelo Coord inteiro do Altium (1/10000 mil) e por
//     template de terceiro que arredonda - erro de decimo de mil, nunca de unidade. Medido
//     no template da casa (Libs\Almox\snippets\*.SchDoc, RECORD=31): CustomX=1169 +
//     CustomX_Frac=29134, ou seja 11692,9134 - a ISO exata.
//   - 133 vezes MENOR que a menor distancia entre duas entradas das tabelas abaixo, que e
//     667,7 mil - entre a A4 ISO (11692,913) e a A4 legado (11500), que ainda por cima
//     carregam o MESMO nome. Entre entradas de nomes DIFERENTES a menor distancia e 1500
//     mil (A3 legado 15500x11000 e B legado 15000x9500). Distancia aqui e o maior dos dois
//     eixos, que e o que importa: so ha confusao quando OS DOIS caem dentro da tolerancia.
//     Nenhuma folha se confunde com outra, e nenhuma deixa de se reconhecer.
function CasaMedida(W: Double; H: Double; NomW: Double; NomH: Double): Boolean;
begin
  Result := (DifAbs(W, NomW) <= 5.0) and (DifAbs(H, NomH) <= 5.0);
end;

// Coord -> mil SEM CoordToMils. Essa funcao existe no Altium e o ExportProject a usa, mas
// NESTE arquivo ela nunca apareceu fora de um comentario - e identificador que este script
// nunca compilou e risco de erro de COMPILACAO, que derruba tudo. A escala sai do proprio
// MilsToCoord, que este arquivo usa 17 vezes: o que ele faz na ida, esta desfaz na volta, e
// nenhum "10000" chutado entra na conta.
function CoordParaMil(c: Double): Double;
begin
  Result := c * 1000.0 / MilsToCoord(1000);
end;

// NOME DA FOLHA PELA MEDIDA. Mesma tabela do ExportProject (ISO real da casa + legado do
// Altium, as duas orientacoes pelo maior/menor lado). Aqui ele serve so para ESCREVER o
// de-para no relatorio: quem decide o que aplicar e a medida, nao o nome.
// '' = nenhuma tabela reconheceu.
function SheetNameFromMils(W: Double; H: Double): String;
var
  Maior, Menor: Double;
begin
  Result := '';
  if (W <= 0) or (H <= 0) then
    Exit;
  if W >= H then
  begin
    Maior := W;
    Menor := H;
  end
  else
  begin
    Maior := H;
    Menor := W;
  end;
  // ISO real, em mil (210 / 297 / 420 / 594 / 841 / 1189 mm)
  if CasaMedida(Maior, Menor, 11692.913, 8267.717) then
    Result := 'A4'
  else if CasaMedida(Maior, Menor, 16535.433, 11692.913) then
    Result := 'A3'
  else if CasaMedida(Maior, Menor, 23385.827, 16535.433) then
    Result := 'A2'
  else if CasaMedida(Maior, Menor, 33110.236, 23385.827) then
    Result := 'A1'
  else if CasaMedida(Maior, Menor, 46811.024, 33110.236) then
    Result := 'A0'
  // legado do Altium: a medida de uma folha de ESTILO NOMEADO de verdade
  else if CasaMedida(Maior, Menor, 11500, 7600) then
    Result := 'A4'
  else if CasaMedida(Maior, Menor, 15500, 11000) then
    Result := 'A3'
  else if CasaMedida(Maior, Menor, 22000, 15500) then
    Result := 'A2'
  else if CasaMedida(Maior, Menor, 31000, 22000) then
    Result := 'A1'
  else if CasaMedida(Maior, Menor, 44000, 31000) then
    Result := 'A0'
  else if CasaMedida(Maior, Menor, 9500, 7500) then
    Result := 'A'
  else if CasaMedida(Maior, Menor, 15000, 9500) then
    Result := 'B'
  else if CasaMedida(Maior, Menor, 20000, 15000) then
    Result := 'C'
  else if CasaMedida(Maior, Menor, 32000, 20000) then
    Result := 'D'
  else if CasaMedida(Maior, Menor, 42000, 32000) then
    Result := 'E';
end;

// Como uma folha se escreve no relatorio: "16535.433x11692.913 mil (A3, em pe)".
// O nome e a orientacao saem os dois da medida - nao ha outro lugar de onde tira-los.
function DescreveFolha(W: Double; H: Double): String;
var
  Nome, Orient: String;
begin
  Nome := SheetNameFromMils(W, H);
  if Nome = '' then
    Nome := 'Custom';
  if H > W then
    Orient := 'em pe'
  else if W > H then
    Orient := 'deitada'
  else
    Orient := 'quadrada';
  Result := JF(W) + 'x' + JF(H) + ' mil (' + Nome + ', ' + Orient + ')';
end;

// Medida NOMINAL, em mil, do estilo nomeado que o SheetStyleFromName sabe escrever - o
// LEGADO do Altium, que e o que uma folha de estilo nomeado mede de verdade. So estes sete:
// e exatamente a lista dos eSheet* provados neste arquivo. False = o nome nao e um estilo
// que este script possa escrever (Custom, A0, D, E...), e o caminho e a folha custom.
function MedidaNominalDoEstilo(Nome: String; var NomW: Double; var NomH: Double): Boolean;
begin
  Result := True;
  NomW := 0;
  NomH := 0;
  if Nome = 'A4' then
  begin
    NomW := 11500;
    NomH := 7600;
  end
  else if Nome = 'A3' then
  begin
    NomW := 15500;
    NomH := 11000;
  end
  else if Nome = 'A2' then
  begin
    NomW := 22000;
    NomH := 15500;
  end
  else if Nome = 'A1' then
  begin
    NomW := 31000;
    NomH := 22000;
  end
  else if Nome = 'A' then
  begin
    NomW := 9500;
    NomH := 7500;
  end
  else if Nome = 'B' then
  begin
    NomW := 15000;
    NomH := 9500;
  end
  else if Nome = 'C' then
  begin
    NomW := 20000;
    NomH := 15000;
  end
  else
    Result := False;
end;

// Medida ATUAL da folha aberta, em mil. E a mesma leitura do ExportProject >> SheetSizeMils
// (duplicada de proposito, ver o cabecalho deste bloco): folha custom responde por
// CustomX/CustomY, folha de estilo nomeado por SheetSizeX/SheetSizeY. 0/0 = nenhuma das duas
// sondas respondeu.
//
// AS CINCO PROPRIEDADES SAO SONDA NESTE ARQUIVO: o ExportProject as LE ha tempos no mesmo
// ISch_Document, mas o BuildSchematic nunca as tocou. Propriedade que nao existe e erro de
// EXECUCAO (nao de compilacao, como e o caso dos identificadores), entao cada uma vai no seu
// try/except e a recusa vira relatorio, nao script derrubado.
procedure LeFolhaAtual(SchDoc: ISch_Document; var W: Double; var H: Double; var Custom: Boolean);
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
      W := CoordParaMil(SchDoc.CustomX);
      H := CoordParaMil(SchDoc.CustomY);
    except
      W := 0;
      H := 0;
    end;
  end
  else
  begin
    try
      W := CoordParaMil(SchDoc.SheetSizeX);
      H := CoordParaMil(SchDoc.SheetSizeY);
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

// Junta nomes numa frase: 'CustomX e CustomY'. So para o relatorio.
function MaisNome(Lista: String; Nome: String): String;
begin
  if Lista = '' then
    Result := Nome
  else
    Result := Lista + ' e ' + Nome;
end;

// APLICA NA FOLHA DO ALTIUM O TAMANHO QUE O ESPELHO PEDIU.
//
// O QUE ESTAVA AQUI ERA DESTRUTIVO. Eram tres linhas:
//     EstiloFolha := SheetStyleFromName(SheetSizes[si]);
//     if EstiloFolha >= 0 then SchDoc.SheetStyle := EstiloFolha;
// Como o ExportProject chamava TODA folha de "A4" (o SheetSizeName dele conhecia so
// A3/A2/A1/A/B/C e mandava o resto para o else), isto escrevia eSheetA4 em cima de QUALQUER
// folha - inclusive a A0 do usuario, que encolhia para 11500x7600 mil dentro do arquivo
// dele. O comentario de SheetStyleFromName ja prometia "na duvida, preservar a folha que ja
// esta la", e a guarda nao cumpria a promessa porque nunca chegava um nome que nao fosse A4.
//
// A CERTEZA AGORA VEM DA MEDIDA, e nao do nome. Todo espelho recente traz w/h (o Altium mede
// e o ExportProject emite), e medida e comparavel:
//   sem w/h            -> nao mexe em nada, e diz por que (nome sozinho ja mentiu uma vez);
//   ja mede o pedido   -> nao escreve nada. E o caso normal, e ele importa: sem esta saida,
//                         cada re-despejo reescreveria a folha inteira a toa;
//   pedido = a medida NOMINAL do estilo nomeado (o legado: A4 11500x7600, A3 15500x11000...)
//                      -> escreve SheetStyle, que e a forma NATIVA daquela folha;
//   qualquer outro     -> folha CUSTOM (UseCustomSheet/CustomX/CustomY), que e como o ISO
//                         real, o retrato e os tamanhos sem eSheet* conhecido existem.
//
// E O CAMINHO CUSTOM QUE ATENDE "A0 EM RETRATO" SEM CITAR eSheetA0: esse identificador nunca
// foi usado neste repositorio e ninguem sabe se existe - e identificador inexistente nao da
// erro de execucao, da erro de COMPILACAO e leva o script inteiro junto (ePortLeft,
// ePortNone_Vertical). Propriedade e outra historia, e por isso cada uma abaixo tem o seu
// try/except. Nenhum eSheet* novo entrou aqui.
//
// TODA TROCA VAI PARA O RELATORIO COM O DE-PARA: mudar o tamanho da folha do usuario e
// exatamente o tipo de coisa que ele precisa ver escrita, e nao descobrir abrindo o arquivo.
procedure AplicaFolha(SchDoc: ISch_Document; SheetName: String; Linha: String);
var
  W, H, AtualW, AtualH, NomW, NomH: Double;
  Custom, LeuAtual, OkEstilo, OkFlag, OkX, OkY: Boolean;
  Nome, DePara, Recusadas: String;
  Estilo: Integer;
begin
  Nome := JGet(Linha, 'size');
  W := 0;
  H := 0;
  if JHas(Linha, 'w') then
    W := JNum(Linha, 'w');
  if JHas(Linha, 'h') then
    H := JNum(Linha, 'h');

  if (W <= 0) or (H <= 0) then
  begin
    FolhasPreservadas := FolhasPreservadas + 1;
    Report.Add('[AVISO] folha ' + SheetName + ': tamanho PRESERVADO como esta no Altium.');
    Report.Add('        O espelho nao traz medida (w/h) e o "size" sozinho ("' + Nome +
      '") nao e prova:');
    Report.Add('        export anterior a esta versao chamava QUALQUER folha de "A4", e');
    Report.Add('        carimbar esse nome numa folha maior ENCOLHERIA o arquivo do usuario.');
    Report.Add('        E nem um nome honesto bastaria: "A0" pode ser a ISO real (46811x33110)');
    Report.Add('        ou a legado do Altium (44000x31000), e o script nao tem como escolher.');
    Report.Add('        Rode o ExportProject uma vez para o espelho ganhar a medida - e quem');
    Report.Add('        escolhe a folha no hub tem de gravar w/h junto do "size", senao a');
    Report.Add('        escolha nao chega ate aqui.');
    Exit;
  end;

  LeFolhaAtual(SchDoc, AtualW, AtualH, Custom);
  LeuAtual := (AtualW > 0) and (AtualH > 0);
  if LeuAtual and CasaMedida(AtualW, AtualH, W, H) then
  begin
    LogOk('folha ' + SheetName + ': ja mede ' + DescreveFolha(W, H) + ' - nada escrito');
    Exit;
  end;

  if LeuAtual then
  begin
    DePara := 'de ' + DescreveFolha(AtualW, AtualH) + ' para ' + DescreveFolha(W, H);
    if Custom then
      DePara := DePara + ' [antes: folha custom]'
    else
      DePara := DePara + ' [antes: estilo nomeado]';
  end
  else
    // As duas sondas recusadas e o espelho COM medida e combinacao quase impossivel (as
    // propriedades sao as mesmas que o ExportProject usou para medir): se ela aparecer, o
    // relatorio precisa dizer que o "antes" nao foi lido, em vez de inventar um.
    DePara := 'para ' + DescreveFolha(W, H) +
      ' [o tamanho ANTERIOR nao pode ser lido - as duas sondas foram recusadas]';

  Estilo := SheetStyleFromName(Nome);
  NomW := 0;
  NomH := 0;
  if (Estilo >= 0) and MedidaNominalDoEstilo(Nome, NomW, NomH) and
    CasaMedida(W, H, NomW, NomH) then
  begin
    // Estilo nomeado do Altium E a medida do espelho e exatamente a nominal dele: aqui ha
    // certeza, e SheetStyle e a forma nativa de dizer isto. Note que a folha da casa NAO cai
    // aqui: a "A4" dela mede a ISO 11692x8267, nao a legado 11500x7600.
    OkEstilo := False;
    try
      SchDoc.SheetStyle := Estilo;
      OkEstilo := True;
    except
      OkEstilo := False;
    end;
    // UseCustomSheet=True manda MAIS que o SheetStyle (e assim que o template da casa guarda
    // a A4 ISO). Sem desliga-lo, o estilo escrito acima nao apareceria na tela.
    OkFlag := False;
    try
      SchDoc.UseCustomSheet := False;
      OkFlag := True;
    except
      OkFlag := False;
    end;
    if OkEstilo then
    begin
      FolhasTrocadas := FolhasTrocadas + 1;
      if OkFlag then
        LogOk('folha ' + SheetName + ': estilo ' + Nome + ' aplicado - ' + DePara)
      else
        LogOk('folha ' + SheetName + ': estilo ' + Nome + ' aplicado - ' + DePara +
          ' [UseCustomSheet recusada: se a folha era custom, o estilo pode nao aparecer]');
    end
    else
    begin
      FolhasPreservadas := FolhasPreservadas + 1;
      LogFail('folha ' + SheetName + ': SheetStyle recusado pelo Altium - tamanho ' +
        'PRESERVADO (queria ir ' + DePara + ')');
    end;
    Exit;
  end;

  // Folha CUSTOM: o ISO real da casa, o retrato, e todo tamanho sem eSheet* conhecido
  // (A0, D, E). E tambem o caso de "Custom" vindo do espelho COM medida - o hub pediu um
  // tamanho que nao tem nome, e um tamanho sem nome ainda e um tamanho.
  OkFlag := False;
  OkX := False;
  OkY := False;
  try
    SchDoc.UseCustomSheet := True;
    OkFlag := True;
  except
    OkFlag := False;
  end;
  try
    SchDoc.CustomX := MilsToCoord(W);
    OkX := True;
  except
    OkX := False;
  end;
  try
    SchDoc.CustomY := MilsToCoord(H);
    OkY := True;
  except
    OkY := False;
  end;
  if OkFlag and OkX and OkY then
  begin
    FolhasTrocadas := FolhasTrocadas + 1;
    LogOk('folha ' + SheetName + ': folha custom - ' + DePara);
  end
  else
  begin
    FolhasPreservadas := FolhasPreservadas + 1;
    Recusadas := '';
    if not OkFlag then
      Recusadas := MaisNome(Recusadas, 'UseCustomSheet');
    if not OkX then
      Recusadas := MaisNome(Recusadas, 'CustomX');
    if not OkY then
      Recusadas := MaisNome(Recusadas, 'CustomY');
    LogFail('folha ' + SheetName + ': esta instalacao do Altium recusou ' + Recusadas +
      ' - o tamanho pode ter ficado PELA METADE (queria ir ' + DePara + ').');
    Report.Add('        SONDA: o ExportProject LE essas tres ha tempos, mas ESCREVER nelas');
    Report.Add('        nunca foi medido num Altium real. Se este aviso saiu, confira o');
    Report.Add('        tamanho da folha no Altium antes de dar o despejo por bom - e anote');
    Report.Add('        o nome recusado, que e o que falta medir deste lado.');
  end;
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

// A mesma SchLib nao entra duas vezes: o indice e a varredura abaixo acham os mesmos
// arquivos, e o nome pode vir com caixa diferente ("especiais 1" do csv, "ESPECIAIS 1" da
// pasta) - o SchLibNomes nao diferencia caixa.
procedure AddSchLibUnica(Caminho: String);
begin
  if SchLibNomes.IndexOf(Caminho) < 0 then
    AddSchLib(Caminho);
end;

// Abre todas as .SchLib da pasta do almoxarifado, alem da biblioteca da casa.
// Sem a pasta, segue so com a lib da casa - quem nunca sincronizou continua
// montando esquema normalmente.
//
// NAO DEPENDE DE LISTAR A PASTA. Era um `if not DirectoryExists(...) then Exit` seguido de
// FindFirst/FindNext - as duas primitivas que este workspace ja registrou como nao
// confiaveis neste engine (HomeValida e ProjectDirExists usam FileExists de proposito). Pelo
// share do servidor, atraves de dois symlinks (current -> release, Libs -> shared), o
// resultado foi ZERO bibliotecas do almoxarifado: o build-report do DMB de 2026-09-23 diz
// "nenhuma das 1 SchLib de origem", e os 13 componentes convertidos naquele dia foram
// recusados. Os 13 existem, com o nome exato, nas .SchLib do almoxarifado (conferido lendo
// o LibReference de cada uma) - o script so nao as abria.
//
// Agora e o mesmo remedio do ListProjectDirs: um INDICE lido com FileExists+LoadFromFile,
// cada candidato confirmado com FileExists, e a varredura so como fonte extra. O indice e o
// almox.csv que o sincronismo grava junto das bibliotecas: cada .SchLib se chama
// "<Familia ou Biblioteca>[ N] ALMOX.SchLib" (o N e a quebra pelo teto do cabecalho:
// RESISTOR 1, RESISTOR 2, ESPECIAIS 1...). Medido: esses candidatos cobrem os 55 arquivos
// reais, sem sobrar nenhum; e as colunas Biblioteca/Familia nunca levam virgula nem aspas
// nas 3574 linhas, entao separar pelas virgulas basta.
//
// As duas contagens vao para o relatorio. Se um dia o total cair de novo, ele diz qual
// caminho falhou, em vez de "nenhuma das 1 SchLib" sem mais nada.
procedure AddAlmoxLibs(Dummy: Integer);
var
  Busca: TSearchRec;
  Achou, i, n, p: Integer;
  Csv, Bases: TStringList;
  Linha, Arq: String;
begin
  AlmoxIndice := 0;
  AlmoxVarredura := 0;

  if FileExists(ALMOX_DIR + '\almox.csv') then
  begin
    Bases := TStringList.Create;
    Bases.Sorted := True;
    Bases.Duplicates := dupIgnore;
    Bases.CaseSensitive := False;
    Csv := TStringList.Create;
    Csv.LoadFromFile(ALMOX_DIR + '\almox.csv');
    // a linha 0 e o cabecalho (e carrega o BOM): comeca da 1
    for i := 1 to Csv.Count - 1 do
    begin
      // Chave,Biblioteca,Familia,...
      Linha := Csv[i];
      p := Pos(',', Linha);
      if p = 0 then
        continue;
      Linha := Copy(Linha, p + 1, Length(Linha));
      p := Pos(',', Linha);
      if p = 0 then
        continue;
      Bases.Add(Trim(Copy(Linha, 1, p - 1)));
      Linha := Copy(Linha, p + 1, Length(Linha));
      p := Pos(',', Linha);
      if p = 0 then
        continue;
      Bases.Add(Trim(Copy(Linha, 1, p - 1)));
    end;
    Csv.Free;

    for i := 0 to Bases.Count - 1 do
    begin
      if Bases[i] = '' then
        continue;
      Arq := ALMOX_DIR + '\' + Bases[i] + ' ALMOX.SchLib';
      if FileExists(Arq) then
      begin
        AlmoxIndice := AlmoxIndice + 1;
        AddSchLibUnica(Arq);
      end;
      // as partes numeradas nascem em sequencia (1, 2, ...): para no primeiro buraco
      n := 1;
      Arq := ALMOX_DIR + '\' + Bases[i] + ' ' + IntToStr(n) + ' ALMOX.SchLib';
      while FileExists(Arq) do
      begin
        AlmoxIndice := AlmoxIndice + 1;
        AddSchLibUnica(Arq);
        n := n + 1;
        Arq := ALMOX_DIR + '\' + Bases[i] + ' ' + IntToStr(n) + ' ALMOX.SchLib';
      end;
    end;
    Bases.Free;
  end;

  // a varredura continua, como fonte extra: acha a .SchLib que nao tem linha no csv. Sem a
  // guarda do DirectoryExists - FindFirst numa pasta que nao existe so devolve erro, e o
  // ListProjectDirs ja faz assim.
  Achou := FindFirst(ALMOX_DIR + '\*.SchLib', faAnyFile, Busca);
  while Achou = 0 do
  begin
    AlmoxVarredura := AlmoxVarredura + 1;
    AddSchLibUnica(ALMOX_DIR + '\' + Busca.Name);
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

{ ------------------------ o nome do hub -> o nome da biblioteca ------------------------
  O HUB E O ALTIUM USAM NOMES DIFERENTES PARA O MESMO SIMBOLO, e isso e de proposito: a
  biblioteca da casa que o Altium le ainda tem os nomes de antes da padronizacao ("RES [ SMD
  ]", "CAP EL [  PTH  ]", "CONECTOR PADRAO"), e o espelho do hub aplica o rename-map para
  MOSTRAR os padronizados ("RES [SMD]", "CAP EL [PTH]", "CONE PADRAO") - d83e7c4, "o mirror
  respeita o rename-map". Faltava a volta: o schematic.js que o hub regrava sai com o nome
  novo, e o BuildSchematic procurava o nome literal numa biblioteca que so tem o antigo.
  Medido em 2026-09-23: o TCMS_Reader_V2 parou em 8 simbolos assim, e os 8 voltam, pelo
  rename-map lido de tras para frente, a um nome que EXISTE na biblioteca publicada. O DMB
  funcionava so porque o schematic.js dele veio cru do Altium, com os nomes antigos.

  Republicar a biblioteca com os nomes novos nao era a saida: todo projeto que ja existe no
  Altium referencia os antigos, e ficaria apontando para simbolos que sumiram.

  O ACENTO: o rename-map.js e UTF-8 cru, e o jeito como o Altium converte esses bytes ao ler
  o arquivo nao da para provar daqui ("CONECTOR PADR" + os dois bytes do A til). Entao, quando
  o nome antigo nao casa direto, a comparacao e so pela parte ASCII (ChaveAscii) - e o nome
  usado e SEMPRE o que esta dentro da biblioteca, nunca o lido do mapa. }

// o texto sem os caracteres acima de 127: igual para o nome certo e para o mal decodificado
function ChaveAscii(S: String): String;
var
  i: Integer;
begin
  Result := '';
  for i := 1 to Length(S) do
    if Ord(S[i]) < 128 then
      Result := Result + S[i];
end;

// o mesmo FindLibSymbol, comparando pela ChaveAscii
function FindLibSymbolChave(Chave: String): ISch_Component;
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
      if AnsiCompareText(ChaveAscii(Comp.LibReference), Chave) = 0 then
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

// O nome a usar na biblioteca para o `sym` do schematic.js. Na ordem:
//   1. o proprio nome, se a biblioteca o tem;
//   2. o lib-subs (nome do projeto -> nome da lib, escolha feita na aba Biblioteca);
//   3. o rename-map ao contrario (nome padronizado -> nome antigo), casado direto ou pela
//      parte ASCII.
// Nao achou: devolve o proprio nome, e a validacao diz que falta. Cada traducao sai no
// relatorio uma vez, e o resultado fica em cache - o nome e pedido de novo por componente.
function NomeNaLib(S: String): String;
var
  k: Integer;
  T, O: String;
  C: ISch_Component;
begin
  Result := S;
  if S = '' then
    Exit;
  k := NomeDe.IndexOf(S);
  if k >= 0 then
  begin
    Result := NomePara[k];
    Exit;
  end;
  if FindLibSymbol(S) = nil then
  begin
    T := S;
    k := SubsDe.IndexOf(S);
    if k >= 0 then
      T := SubsPara[k];
    if (T <> S) and (FindLibSymbol(T) <> nil) then
      Result := T
    else
    begin
      k := RenNovo.IndexOf(T);
      if k >= 0 then
      begin
        O := RenVelho[k];
        if FindLibSymbol(O) <> nil then
          Result := O
        else
        begin
          C := FindLibSymbolChave(ChaveAscii(O));
          if C <> nil then
            Result := C.LibReference;
        end;
      end;
    end;
    if Result <> S then
      Report.Add('[OK]    simbolo "' + S + '" e "' + Result + '" na biblioteca (nome antigo, via rename-map/lib-subs)');
  end;
  NomeDe.Add(S);
  NomePara.Add(Result);
end;

// Le o rename-map (so o bloco symRename) e o lib-subs de Libs\. Sem os arquivos, as listas
// ficam vazias e o NomeNaLib so acha o nome literal - que e o comportamento de antes.
procedure CarregaRenomes(Dummy: Integer);
var
  L: TStringList;
  i, p: Integer;
  Linha: String;
  Dentro: Boolean;
begin
  NomeDe := TStringList.Create;
  NomePara := TStringList.Create;
  RenNovo := TStringList.Create;
  RenVelho := TStringList.Create;
  SubsDe := TStringList.Create;
  SubsPara := TStringList.Create;
  SemSimbRefs := TStringList.Create;
  SemSimbRefs.Sorted := True;
  SemSimbRefs.Duplicates := dupIgnore;
  SemSimbRefs.CaseSensitive := False;
  SimbAntigoRefs := TStringList.Create;
  SimbAntigoRefs.Sorted := True;
  SimbAntigoRefs.Duplicates := dupIgnore;
  SimbAntigoRefs.CaseSensitive := False;

  if FileExists(SCRIPT_HOME + '\Libs\rename-map.js') then
  begin
    // formato: a linha '"symRename":{' abre o bloco, um par por linha - ,"antigo":"novo" -
    // e a linha que comeca com '}' fecha. Medido no do servidor: 152 pares, sem aspas
    // escapadas dentro dos nomes.
    L := TStringList.Create;
    L.LoadFromFile(SCRIPT_HOME + '\Libs\rename-map.js');
    Dentro := False;
    for i := 0 to L.Count - 1 do
    begin
      Linha := Trim(L[i]);
      if not Dentro then
      begin
        if Pos('"symRename":{', Linha) = 1 then
          Dentro := True;
        continue;
      end;
      if Pos('}', Linha) = 1 then
        break;
      if Pos(',', Linha) = 1 then
        Linha := Copy(Linha, 2, Length(Linha));
      p := Pos('":"', Linha);
      if (p = 0) or (Pos('"', Linha) <> 1) then
        continue;
      RenVelho.Add(Copy(Linha, 2, p - 2));
      RenNovo.Add(Copy(Linha, p + 3, Length(Linha) - p - 3));
    end;
    L.Free;
  end;

  if FileExists(SCRIPT_HOME + '\Libs\lib-subs.js') then
  begin
    // um objeto por linha; o JGet ja desfaz os escapes \uXXXX
    L := TStringList.Create;
    L.LoadFromFile(SCRIPT_HOME + '\Libs\lib-subs.js');
    for i := 0 to L.Count - 1 do
      if JGet(L[i], 'kind') = 'sym' then
      begin
        SubsDe.Add(JGet(L[i], 'from'));
        SubsPara.Add(JGet(L[i], 'to'));
      end;
    L.Free;
  end;

  Report.Add('Nomes: ' + IntToStr(RenNovo.Count) + ' renomeacao(oes) do rename-map e ' +
    IntToStr(SubsDe.Count) + ' substituicao(oes) do lib-subs - para achar o nome antigo na biblioteca.');
end;

procedure FreeRenomes(Dummy: Integer);
begin
  if NomeDe <> nil then NomeDe.Free;
  if NomePara <> nil then NomePara.Free;
  if RenNovo <> nil then RenNovo.Free;
  if RenVelho <> nil then RenVelho.Free;
  if SubsDe <> nil then SubsDe.Free;
  if SubsPara <> nil then SubsPara.Free;
  if SemSimbRefs <> nil then SemSimbRefs.Free;
  if SimbAntigoRefs <> nil then SimbAntigoRefs.Free;
  SemSimbRefs := nil;
  SimbAntigoRefs := nil;
  NomeDe := nil;
  NomePara := nil;
  RenNovo := nil;
  RenVelho := nil;
  SubsDe := nil;
  SubsPara := nil;
end;

// "A, B, C" - a lista do dialogo final. Montada a mao: o CommaText nunca rodou neste engine.
function JuntaLista(L: TStringList): String;
var
  i: Integer;
begin
  Result := '';
  for i := 0 to L.Count - 1 do
  begin
    if Result <> '' then
      Result := Result + ', ';
    Result := Result + L[i];
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

// OS FOOTPRINTS QUE JA ESTAO NA PLACA deste projeto, lidos do board.js que o ExportPcb
// grava.
//
// POR QUE: a validacao conferia todo footprint do schematic.js contra UMA PcbLib - a do
// almoxarifado, desde que a da casa deixou de ser alcancavel (a bancada saiu dos .pas em
// 2026-09-15). Um projeto exportado do Altium traz os footprints da biblioteca antiga
// ("RES 1206", "1206 resistor", "Cap El 3mm L15 D7"), que nao estao la - e um so ja
// abortava a folha inteira. Foi o que o build-report do DMB registrou em 16/09, um dia
// depois: 5 footprints recusados, NADA criado. O proprio commit que trocou a PcbLib
// avisava que isso ia acontecer.
//
// So que esses footprints nao sao invencao: estao na placa, ligados aos componentes. E o
// painel de conversao do hub os PRESERVA de proposito ao trocar um componente pela peca do
// almoxarifado (medido no DMB: 30 partes convertidas, zero footprints alterados), e o
// AtualizaComp os reaplica com SetFootprint. O vinculo ja estava certo nas duas pontas; so
// a validacao o recusava.
//
// O FORMATO: um componente por linha, com exatamente um "footprint" em cada (medido no
// board.js do DMB: 21 linhas, nenhuma com dois), entao o mesmo JHas/JGet do schematic.js
// serve. Sem board.js (projeto que ainda nao tem placa) as listas ficam vazias e a
// validacao volta a ser so contra a PcbLib - que e o certo para um projeto novo.
procedure LoadBoardFps(ProjDir: String);
var
  L: TStringList;
  i: Integer;
  Linha, Fp: String;
begin
  BoardFps := TStringList.Create;
  BoardFps.Sorted := True;
  BoardFps.Duplicates := dupIgnore;
  BoardFps.CaseSensitive := False;
  BoardRefs := TStringList.Create;
  BoardRefFp := TStringList.Create;
  SemFpRefs := TStringList.Create;
  SemFpRefs.Sorted := True;
  SemFpRefs.Duplicates := dupIgnore;
  SemFpRefs.CaseSensitive := False;
  if not FileExists(ProjDir + '\board.js') then
    Exit;
  L := TStringList.Create;
  L.LoadFromFile(ProjDir + '\board.js');
  for i := 0 to L.Count - 1 do
  begin
    Linha := L[i];
    if not JHas(Linha, 'footprint') then
      continue;
    Fp := JGet(Linha, 'footprint');
    if Fp = '' then
      continue;
    BoardFps.Add(Fp);
    if JGet(Linha, 'ref') <> '' then
    begin
      BoardRefs.Add(JGet(Linha, 'ref'));
      BoardRefFp.Add(Fp);
    end;
  end;
  L.Free;
end;

procedure FreeBoardFps(Dummy: Integer);
begin
  if BoardFps <> nil then
    BoardFps.Free;
  if BoardRefs <> nil then
    BoardRefs.Free;
  if BoardRefFp <> nil then
    BoardRefFp.Free;
  if SemFpRefs <> nil then
    SemFpRefs.Free;
  BoardFps := nil;
  BoardRefs := nil;
  BoardRefFp := nil;
  SemFpRefs := nil;
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

// true se o footprint existe na PcbLib OU na placa deste projeto (ver LoadBoardFps).
// PcbLib indisponivel: nao da para conferir, e vale o de antes - vincula.
function FootprintConhecido(Fp: String): Boolean;
begin
  Result := True;
  if PcbFpNames = nil then
    Exit;
  if PcbFpNames.IndexOf(Fp) >= 0 then
    Exit;
  if BoardFps.IndexOf(Fp) >= 0 then
    Exit;
  Result := False;
end;

// O ESQUEMA VAI PARA O ALTIUM INDEPENDENTE DO FOOTPRINT (pedido do usuario em 2026-09-23:
// "se tiver footprint estabelecido blz, se nao, mantem sem e eu mesmo resolvo").
//
// Nao basta tirar o footprint da validacao: o SetFootprint, quando o nome nao esta entre os
// modelos do componente, CRIA um modelo novo com esse nome e desliga os outros. Chamado
// com um footprint que nao existe, ele trocaria o footprint que funciona por um vinculo
// quebrado. Entao a decisao mora aqui, e so aqui, para os dois caminhos (AtualizaComp e
// PlaceComp):
//   - conhecido (PcbLib ou placa): vincula, como sempre;
//   - desconhecido ou vazio: NAO toca nos modelos. O componente que ja existe mantem os
//     que tem; o novo vai com o que o simbolo da biblioteca ja traz. Um aviso por
//     DESIGNADOR (nao por parte: um conector de 16 partes daria 16 avisos) e a contagem
//     no dialogo final.
procedure VinculaFootprint(Comp: TObject; Line: String; Ref: String);
var
  Fp: String;
begin
  Fp := JGet(Line, 'footprint');
  if (Fp <> '') and FootprintConhecido(Fp) then
  begin
    SetFootprint(Comp, Fp, Ref);
    Exit;
  end;
  if SemFpRefs.IndexOf(Ref) >= 0 then
    Exit;
  SemFpRefs.Add(Ref);
  if Fp = '' then
    Report.Add('[AVISO] ' + Ref + ': sem footprint no schematic.js - foi sem vinculo, defina no Altium')
  else
    Report.Add('[AVISO] ' + Ref + ': footprint "' + Fp +
      '" nao existe na PcbLib nem na placa - vinculo NAO feito, os modelos do componente ficaram como estavam');
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
  SymNovo := NomeNaLib(JGet(Line, 'sym'));
  SymVelho := C.LibReference;
  Mudou := '';

  // simbolo que nao esta na biblioteca NAO entra: melhor o componente continuar o que era
  // do que ficar apontando para uma peca que nao existe
  if (SymNovo <> '') and (AnsiCompareText(SymVelho, SymNovo) <> 0) then
  begin
    if FindLibSymbol(SymNovo) = nil then
    begin
      // aviso e nao [FALHA]: e o desfecho combinado (ver a validacao), e sai listado no
      // dialogo final - contar como falha tambem so dobraria o recado
      if SimbAntigoRefs.IndexOf(Ref) < 0 then
      begin
        SimbAntigoRefs.Add(Ref);
        Report.Add('[AVISO] comp ' + Ref + ': simbolo novo "' + SymNovo +
          '" nao esta em biblioteca nenhuma - ficou o simbolo antigo, "' + SymVelho + '"');
      end;
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
  VinculaFootprint(C, Line, Ref);

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
  LibComp := FindLibSymbol(NomeNaLib(JGet(Line, 'sym')));
  if LibComp = nil then
  begin
    // NAO COLOCADO, de proposito: sem o desenho nao ha o que por na folha. Os fios dele
    // ficam no lugar, soltos, e o designador sai no dialogo final para ser colocado a mao.
    // Uma linha por designador, nao por parte.
    if SemSimbRefs.IndexOf(Ref) < 0 then
    begin
      SemSimbRefs.Add(Ref);
      Report.Add('[AVISO] comp ' + Ref + ': simbolo "' + JGet(Line, 'sym') +
        '" nao existe em biblioteca nenhuma - NAO colocado, coloque no Altium');
    end;
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
  VinculaFootprint(NewComp, Line, Ref);
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
    // quem o PlaceComp deixou de fora por falta de simbolo ja esta no dialogo final:
    // repetir aqui transformaria um componente faltando em varias "falhas"
    if SemSimbRefs.IndexOf(Ref) >= 0 then
      Exit;
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
  s := Trim(InputBox('EletricHUB', Msg + #13#10#13#10 + 'Digite SIM para confirmar:', ''));
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
  F.Caption := 'EletricHUB - onde despejar "' + SheetName + '"';
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
  Src, Syms, Fps, Refs, SheetNames, Pts, ItemSheets: TStringList;
  SheetLines: TStringList;               // a LINHA inteira de cada {"t":"sheet",...}. Era
                                         // uma lista so com o "size"; o tamanho da folha
                                         // passou a se decidir por w/h, e o nome sozinho
                                         // deixou de bastar (ver AplicaFolha)
  i, si, ErrCount, PartId, Restantes, AntesSave, DepoisSave: Integer;
  k, Diverge: Integer;                   // esquema x placa (ver LoadBoardFps)
  Avisados: TStringList;
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
  Report.Add('EletricHUB - BuildSchematic');
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
  FolhasTrocadas := 0;
  FolhasPreservadas := 0;

  Src := TStringList.Create;
  Src.LoadFromFile(SchFile);

  { ---------------- PASSO 1: validacao total (nada e criado se houver erro) ---------------- }
  ErrCount := 0;
  Syms := TStringList.Create;  Syms.Sorted := True;  Syms.Duplicates := dupIgnore;  Syms.CaseSensitive := False;
  Fps := TStringList.Create;   Fps.Sorted := True;   Fps.Duplicates := dupIgnore;   Fps.CaseSensitive := False;
  Refs := TStringList.Create;  Refs.Sorted := True;  Refs.Duplicates := dupAccept;
  SheetNames := TStringList.Create;
  SheetLines := TStringList.Create;
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
      SheetLines.Add(Line);
    end
    else if T = 'comp' then
    begin
      if (JGet(Line, 'ref') = '') or (JGet(Line, 'sym') = '') or
        (not JHas(Line, 'x')) or (not JHas(Line, 'y')) then
      begin
        Report.Add('[ERRO] comp invalido (faltam ref/sym/x/y): ' + Line);
        ErrCount := ErrCount + 1;
      end;
      // footprint NAO bloqueia mais (ver VinculaFootprint): o esquema vai, e o componente
      // sem footprint e resolvido no Altium
      if JGet(Line, 'footprint') = '' then
        Report.Add('[AVISO] comp ' + JGet(Line, 'ref') + ': sem footprint - vai sem vinculo');
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
    else if T = 'noerc' then
    begin
      // O DESPEJO JA SABIA CRIAR O No ERC (PlaceNoERC, no passo 2), mas esta lista branca
      // nao tinha o tipo - e ela roda ANTES. Os 21 No ERC do DMB viravam "tipo
      // desconhecido", abortavam a folha inteira, e o PlaceNoERC nunca era chamado
      // (build-report de 2026-09-23 15:39). Um tipo novo precisa entrar nas DUAS listas.
      // A conferencia de x/y e a mesma dos rotulos acima: o PlaceNoERC le as duas com
      // JNum, que devolve 0 calado, e o X nasceria em (0,0), fora da folha.
      if (not JHas(Line, 'x')) or (not JHas(Line, 'y')) then
      begin
        Report.Add('[ERRO] noerc: faltam x/y: ' + Line);
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
    Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetLines.Free; ItemSheets.Free;
    Exit;
  end;
  Report.Add('SchLib de origem: ' + IntToStr(SchLibs.Count) +
    ' (almoxarifado pelo almox.csv: ' + IntToStr(AlmoxIndice) +
    ', pela varredura da pasta: ' + IntToStr(AlmoxVarredura) + ')');
  // o nome que o hub escreve pode ser o padronizado, e a biblioteca ter o antigo: NomeNaLib
  CarregaRenomes(0);
  for i := 0 to Syms.Count - 1 do
    // SIMBOLO QUE NAO EXISTE NAO TRAVA MAIS A FOLHA - a mesma regra que o usuario deu para
    // o footprint ("o esquema precisa voltar pro Altium; o que faltar, eu resolvo la"). Era o
    // ultimo tudo-ou-nada: em 2026-09-23 o TCMS_Reader parou inteiro por UM componente, o
    // IC2 (MAX3051ESA+T, "CMP-05676-000007-1"), peca do cofre do Altium que nao esta na lib
    // da casa nem no almoxarifado. O despejo ja sabia o que fazer com ele - o AtualizaComp
    // mantem o simbolo antigo de quem ja esta na folha, e o PlaceComp pula o novo -; so esta
    // validacao, que roda antes, barrava. Os dois casos saem no dialogo final.
    if FindLibSymbol(NomeNaLib(Syms[i])) = nil then
      Report.Add('[AVISO] simbolo "' + Syms[i] + '" nao existe em nenhuma das '
                 + IntToStr(SchLibs.Count) + ' SchLib de origem (nem pelo rename-map/lib-subs)' +
                 ' - quem ja esta na folha fica com o simbolo que tem; o novo NAO e colocado');

  LoadPcbFpNames(0);
  // o footprint que JA ESTA NA PLACA vale como existente: ver LoadBoardFps
  LoadBoardFps(ProjDir);
  if BoardFps.Count > 0 then
    Report.Add('Placa deste projeto (board.js): ' + IntToStr(BoardFps.Count) +
      ' footprint(s) - valem como existentes, mesmo fora da PcbLib.');
  if PcbFpNames = nil then
    Report.Add('[AVISO] PcbLib indisponivel - existencia dos footprints NAO conferida')
  else
    for i := 0 to Fps.Count - 1 do
      // AVISO, nao erro: o esquema vai mesmo assim, e o VinculaFootprint deixa os modelos
      // desse componente como estavam
      if (PcbFpNames.IndexOf(Fps[i]) < 0) and (BoardFps.IndexOf(Fps[i]) < 0) then
        Report.Add('[AVISO] footprint "' + Fps[i] + '" nao existe na PcbLib nem na placa deste projeto' +
          ' - os componentes com ele vao sem esse vinculo');

  // ESQUEMA x PLACA: o mesmo designador com footprint diferente nos dois lados.
  //
  // Nao bloqueia - o esquema pode estar certo e a placa desatualizada -, mas precisa ser
  // dito ANTES do ECO, porque o ECO vai propor trocar o footprint de um componente que ja
  // esta posicionado e roteado. Medido no DMB: o D1 e "SOD3716X135N" no esquema e
  // "DO-214AC" na placa, e ninguem tinha como saber sem abrir os dois.
  //
  // Uma linha por DESIGNADOR, nao por parte: um conector de 16 partes daria 16 avisos iguais.
  Avisados := TStringList.Create;
  Avisados.Sorted := True;
  Avisados.Duplicates := dupIgnore;
  Avisados.CaseSensitive := False;
  Diverge := 0;
  for i := 0 to Src.Count - 1 do
  begin
    Line := Trim(Src[i]);
    if JGet(Line, 't') <> 'comp' then
      continue;
    k := BoardRefs.IndexOf(JGet(Line, 'ref'));
    if k < 0 then
      continue;
    if AnsiCompareText(BoardRefFp[k], JGet(Line, 'footprint')) = 0 then
      continue;
    if Avisados.IndexOf(JGet(Line, 'ref')) >= 0 then
      continue;
    Avisados.Add(JGet(Line, 'ref'));
    Report.Add('[AVISO] ' + JGet(Line, 'ref') + ': o esquema pede o footprint "' +
      JGet(Line, 'footprint') + '" e a placa usa "' + BoardRefFp[k] +
      '" - no ECO o Altium vai propor trocar o da placa');
    Diverge := Diverge + 1;
  end;
  Avisados.Free;

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
    FreeBoardFps(0);
    FreeRenomes(0);
    Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetLines.Free; ItemSheets.Free;
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
    // TAMANHO DA FOLHA: a decisao inteira esta em AplicaFolha, e ela se decide pela MEDIDA
    // (w/h do espelho), e nao pelo nome. As tres linhas que havia aqui escreviam eSheetA4
    // em cima de qualquer folha, porque o export chamava todas de "A4".
    AplicaFolha(SchDoc, SheetName, SheetLines[si]);

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
  // O TAMANHO DA FOLHA ENTRA NO RODAPE sempre que este despejo mexeu nele - ou deixou de
  // mexer por falta de certeza. E a coisa mais visivel que este script faz no arquivo do
  // usuario, e ate esta versao ela era feita em silencio e errada.
  if (FolhasTrocadas > 0) or (FolhasPreservadas > 0) then
  begin
    Report.Add('Tamanho de folha: ' + IntToStr(FolhasTrocadas) + ' trocada(s), ' +
      IntToStr(FolhasPreservadas) + ' preservada(s) por falta de certeza.');
    Report.Add('  O de-para de cada uma esta nas linhas acima, com a medida em mil e a');
    Report.Add('  orientacao (retrato = h > w, e nao ha campo proprio para ele: a medida E a');
    Report.Add('  orientacao).');
    Report.Add('  A folha so muda quando o espelho traz w/h. O "size" sozinho nao e prova:');
    Report.Add('  todo export anterior a esta versao chamava QUALQUER folha de "A4".');
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
  // Folha entra DEPOIS da linha acima, de proposito: ela fala dos numeros de TEXTO, e
  // tamanho de folha nao e texto. Sai no dialogo e nao so no relatorio porque o usuario abre
  // o relatorio quando tem motivo, e "a sua folha mudou de tamanho" e motivo que ele precisa
  // ver antes de procurar.
  if FolhasTrocadas > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(FolhasTrocadas) +
      ' folha(s) MUDARAM DE TAMANHO, a pedido do espelho' + #13#10 +
      '   (o de-para, com medida e orientacao, esta no relatorio).';
  if FolhasPreservadas > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(FolhasPreservadas) +
      ' folha(s) com tamanho PRESERVADO - o espelho nao' + #13#10 +
      '   soube pedir com certeza, ou o Altium recusou a escrita (o relatorio diz qual).';

  // No DIALOGO e nao so no relatorio, pela mesma razao das folhas acima: o proximo passo e o
  // ECO, e e nele que a troca de footprint numa placa ja roteada acontece.
  if Diverge > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(Diverge) +
      ' componente(s) com footprint DIFERENTE do da placa -' + #13#10 +
      '   no ECO o Altium vai propor trocar o footprint na placa (o relatorio lista cada um).';
  // O QUE FICOU PARA O USUARIO FAZER NO ALTIUM - na tela, e nao so no relatorio, porque e
  // trabalho manual que ninguem mais vai lembrar. O mais grave primeiro: componente que nem
  // entrou na folha.
  if SemSimbRefs.Count > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(SemSimbRefs.Count) +
      ' componente(s) NAO foram colocados (simbolo em biblioteca nenhuma):' +
      #13#10 + '   ' + JuntaLista(SemSimbRefs) + ' - coloque no Altium; os fios deles estao no lugar.';
  if SimbAntigoRefs.Count > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(SimbAntigoRefs.Count) +
      ' componente(s) ficaram com o simbolo ANTIGO (o novo nao existe em biblioteca nenhuma):' +
      #13#10 + '   ' + JuntaLista(SimbAntigoRefs) + '.';
  if SemFpRefs.Count > 0 then
    TxtWarn := TxtWarn + #13#10 + '   ATENCAO: ' + IntToStr(SemFpRefs.Count) +
      ' componente(s) foram SEM vinculo de footprint (nao existe na PcbLib nem na placa):' +
      #13#10 + '   ' + JuntaLista(SemFpRefs) + ' - defina no Altium.';

  ShowMessage('Esquema despejado.' + #13#10 +
    'OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount) + TxtWarn + #13#10#13#10 +
    RelTxt + #13#10#13#10 +
    'PROXIMOS PASSOS: salve (Ctrl+S), rode Project >> Compile,' + #13#10 +
    'e depois Design >> Update PCB (ECO) para levar tudo a placa.');

  Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetLines.Free; ItemSheets.Free;
  if PcbFpNames <> nil then
    PcbFpNames.Free;
  FreeBoardFps(0);
  FreeRenomes(0);
end;
