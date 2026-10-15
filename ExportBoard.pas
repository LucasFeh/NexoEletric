{ ..................................................................................................................... }
{ .  AltiumPCBMirror - ExportBoard.pas                                                                                . }
{ .                                                                                                                   . }
{ .  Exporta a PCB ABERTA no Altium Designer para "Projects\<nome do projeto>\":                                      . }
{ .    - board.js       : espelho completo e fiel da placa (componentes, pads, trilhas, arcos, vias, silk, contorno)  . }
{ .    - changes.js     : arquivo de mudancas (criado vazio apenas se nao existir - NUNCA sobrescrito)                . }
{ .    - AI-GUIDE.md    : guia para a sessao de IA (copiado de SCRIPT_HOME)                                           . }
{ .    - pcb-list.csv   : snapshot tipo "PCB List" (TSV: Designator/Footprint/Comment/Layer/X/Y/Rotation)             . }
{ .    - export-report.txt : o mesmo texto do dialogo final (contagens + sondas que o Altium recusou)                 . }
{ .                                                                                                                   . }
{ .  Desde 2026-10 (EXPORTER_ID) o board.js traz tambem, TUDO opcional: layers, rules, fills, lines, a segunda       . }
{ .  passada (Mid/Plane/mecanicas/Keep-Out/mascara/pasta/furacao), texto com tipo/fonte/largura/ancora/contorno,      . }
{ .  region com furos, mascara/pasta/tenting/metalizacao por pad e via. Ver o bloco SONDAS antes de mexer.           . }
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
  // Marca do espelho com os campos de 2026-10. O formato continua pcbmirror-v1 - tudo o que e
  // novo e opcional -; a marca e o que deixa a tela separar "o Altium nao deixou ler este
  // campo" de "este espelho e de antes do campo existir".
  EXPORTER_ID = 'ExportBoard 2026-10';
  // Sonda que falhou isto de vezes sem NUNCA ter respondido e nome que este Altium nao tem:
  // dali em diante ela nao e mais tentada (SondaAindaVale). Uma excecao por objeto pesa numa placa
  // de 20 mil trilhas.
  SONDA_DESISTE = 200;
  // Texto cujo contorno exato passa disto de vertices sai sem "polys" (a tela usa a fonte do
  // hub com a largura "w"): o board.js nao pode virar megabytes por causa de um texto.
  POLY_TEXTO_MAX = 4000;

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
  // ---- espelho de 2026-10 (ver o bloco SONDAS). Tudo preenchido no comeco do ExportPcb.
  SondaNomes: TStringList;   // cada sonda que ja falhou, uma vez so
  SondaQtd: TStringList;     // quantas vezes ela falhou (mesma posicao, como texto)
  SondaOk: TStringList;      // as sondas que ja responderam ao menos uma vez
  CamadasOk: Boolean;        // a numeracao de camadas e a documentada? (CamadasConferem)
  PilhaObj: TObject;         // Board.LayerStack (nil = a sonda nao respondeu)
  Usadas: TStringList;       // chaves de camada com objeto exportado na segunda passada
  RegraSuspeita: Boolean;    // a ordem suposta dos tipos de regra (13/14) nao conferiu
  RegrasLidas: TStringList;  // de qual regra saiu cada valor de "rules" (so no relatorio)
  RgSm, RgPm, RgClear, RgWidth, RgViaSize, RgViaDrill: String; // mm; '' = nao saiu
  RgSmP, RgPmP, RgClearP, RgWidthP, RgViaP: Integer;           // prioridade da regra usada
  // contagens do dialogo final e do export-report.txt
  NPads, NPadsTh, NPadsPlated, NPadsSm, NPadsSmd, NPadsPm, NPadsTent: Integer;
  NViasSm, NViasTent: Integer;
  NTextos, NTextosTipo, NTextosW, NTextosAncora, NTextosPoly, NTextosPolyGrande: Integer;
  NTextosPolyVazio: Integer; // MakeContour respondeu, mas sem contorno nenhum
  NRegioesFuro, NKeepout, NPilha: Integer;

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

// A numeracao de camadas deste Altium e a documentada? As sete constantes que este arquivo ja
// usava sao as ancoras: Top 1, Bottom 32, TopOverlay 33, BottomOverlay 34, KeepOut 56, Mech1
// 57, Multi 74. Se elas estao no lugar, as do meio tambem estao, porque a conta fecha: 30 mids
// entre Top e Bottom; TopPaste, BottomPaste, TopSolder, BottomSolder, 16 planos e Drill Guide
// entre BottomOverlay e KeepOut; 16 mecanicas e Drill Drawing entre KeepOut e Multi.
// Tem parametro de proposito: some do menu Run Script.
function CamadasConferem(Dummy: Integer): Boolean;
begin
  Result := False;
  try
    Result := (eTopLayer = 1) and (eBottomLayer = 32) and (eTopOverlay = 33) and
              (eBottomOverlay = 34) and (eKeepOutLayer = 56) and (eMechanical1 = 57) and
              (eMultiLayer = 74);
  except
    Result := False;
  end;
end;

// Chave de camada do board.js - a tabela do contrato (hub-core.js >> PCB_LAYERS).
// As 7 de sempre saem como sempre sairam. As outras saem pela POSICAO no TLayer, contada a
// partir das constantes que este arquivo ja usava, e NAO por eMidLayer1, eTopPaste,
// eInternalPlane1...: constante que nao existisse neste Altium seria erro de COMPILACAO e
// derrubaria o script inteiro (foi o que ePortLeft custou ao ExportProject). A posicao e a
// documentada (Top 1, Mid1..30 = 2..31, Bottom 32, TopOverlay 33, BottomOverlay 34, TopPaste
// 35, BottomPaste 36, TopSolder 37, BottomSolder 38, Plane1..16 = 39..54, DrillGuide 55,
// KeepOut 56, Mech1..16 = 57..72, DrillDrawing 73, Multi 74) e CamadasConferem a confere no
// comeco da rodada. Nao conferiu: essas camadas saem 'L<n>', como sempre sairam.
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
  else if not CamadasOk then
    Result := 'L' + IntToStr(L)
  else if (L > eTopLayer) and (L < eBottomLayer) then
    Result := 'Mid' + IntToStr(L - eTopLayer)
  else if L = eBottomOverlay + 1 then
    Result := 'TopPaste'
  else if L = eBottomOverlay + 2 then
    Result := 'BottomPaste'
  else if L = eBottomOverlay + 3 then
    Result := 'TopSolder'
  else if L = eBottomOverlay + 4 then
    Result := 'BottomSolder'
  else if (L >= eBottomOverlay + 5) and (L <= eBottomOverlay + 20) then
    Result := 'Plane' + IntToStr(L - eBottomOverlay - 4)
  else if L = eKeepOutLayer - 1 then
    Result := 'DrillGuide'
  else if (L > eMechanical1) and (L <= eMechanical1 + 15) then
    Result := 'Mech' + IntToStr(L - eMechanical1 + 1)
  else if L = eMultiLayer - 1 then
    Result := 'DrillDrawing'
  else
    Result := 'L' + IntToStr(L);
end;

// Cobre de sinal ou plano (Top, Mid<n>, Plane<n>, Bottom), pela chave.
function EhCobreKey(Chave: String): Boolean;
begin
  Result := (Chave = 'Top') or (Chave = 'Bottom') or (Pos('Mid', Chave) = 1) or
            (Pos('Plane', Chave) = 1);
end;

// As cinco camadas que a primeira passada (a de sempre) le. A segunda le o resto.
function EhPrimeiraPassada(L: TLayer): Boolean;
begin
  Result := (L = eTopLayer) or (L = eBottomLayer) or (L = eTopOverlay) or
            (L = eBottomOverlay) or (L = eMultiLayer);
end;

// TColor do Delphi e BGR (o byte BAIXO e o vermelho) -> '#RRGGBB'. A mesma conta do HexDeCor
// do ExportProject, que ja rodou no Altium (as cores das ports do DMB chegaram certas).
function HexDeCorBGR(c: Integer): String;
begin
  Result := '#' + IntToHex(c and $FF, 2) +
                  IntToHex((c shr 8) and $FF, 2) +
                  IntToHex((c shr 16) and $FF, 2);
end;

// Nome da forma de pad pelo codigo do Altium - a mesma tabela do PadJSON (1 redondo/oval,
// 2 retangulo, 3 octogono, 9 roundrect). Serve a pilha do Bottom.
function NomeDaForma(Codigo: Integer; W, H: String): String;
begin
  Result := 'circle';
  if Codigo = 1 then
  begin
    if W <> H then
      Result := 'oval';
  end
  else if Codigo = 2 then
    Result := 'rect'
  else if Codigo = 3 then
    Result := 'octagon'
  else if Codigo = 9 then
    Result := 'roundrect';
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

  Resposta := SemBarraFinal(InputBox('NexoEletric',
    'Nao achei o workspace do NexoEletric nesta maquina.' + #13#10 +
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

  ShowMessage('Nao achei a raiz do workspace do NexoEletric nesta maquina.' + #13#10 +
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
    Answer := Trim(InputBox('NexoEletric',
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
  Answer := InputBox('NexoEletric', ListStr, '1');
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

{ ======================================== SONDAS ======================================== }
{ O espelho de 2026-10 le propriedades do PCB API que este arquivo nunca tinha lido. Cada    }
{ leitura nova mora numa funcao Sonda* (ou num ajudante dela) e vai dentro de try/except: se }
{ a propriedade nao responder NAQUELE objeto, o campo opcional nao sai, a sonda entra na     }
{ lista de falhas (dialogo final e export-report.txt, com quantas vezes) e o export segue.   }
{ Campo ausente no board.js quer dizer "nao sabido" - nunca um valor inventado no lugar.     }
{                                                                                            }
{ O QUE O TRY NAO SEGURA: nome que nao existe em LUGAR NENHUM do API. O DelphiScript confere }
{ os nomes na COMPILACAO, e um nome desconhecido impede o script INTEIRO de rodar, com try   }
{ ou sem try. Foi o que IPCB_Region.IsBoardCutout fez aqui em 2026-08 (commit a4db644: "nao  }
{ compila, e try/except nao protege") e o que ePortLeft fez ao ExportProject. Por isso:      }
{   - nenhuma constante nova de camada: as camadas novas saem pela POSICAO no TLayer,        }
{     contada das sete que ja eram usadas (LayerNameOf e CamadasConferem);                   }
{   - tipo de regra, modo de mascara, pilha do pad e Kind da region viram INTEIRO pela       }
{     atribuicao a uma variavel Integer (como o ShapeCode do PadJSON sempre fez com o        }
{     TShape), nunca por eRule_*, eCacheManual, ePadMode_*;                                  }
{   - um nome por aposta: UseTTFonts e nao tambem TextKind; LayerObject.Name e nao tambem    }
{     Board.LayerName ou Layer2String (o nome padrao da camada o hub ja tem na tabela dele); }
{   - cada nome novo mora numa funcao so.                                                    }
{ SE O ALTIUM RECUSAR com "Undeclared identifier: X": ache X na lista abaixo, apague o(s)    }
{ try daquela funcao (fica o Result do comeco, que e o "nao sabido") e rode de novo. O resto }
{ do espelho sai igual, so sem aquele campo.                                                 }
{                                                                                            }
{   eFillObject ............................ ExportPcb, segunda passada: SAO DOIS lugares -  }
{                                            tire-o do MkSet E troque o teste               }
{                                            "Prim.ObjectId = eFillObject" por False.        }
{                                            (Um DelphiScript de terceiros que esta no Y:,  }
{                                            o InteractiveHTMLBOM4Altium2, ja usa o nome.)  }
{   eRuleObject ............................ LeRegrasDaPlaca                                }
{   IsKeepout .............................. SondaKeepout                                   }
{   X1Location Y1Location X2Location Y2Location ............ SondaFill                      }
{   UseTTFonts ............................. SondaTipoTexto. Recusado: em vez de apagar,    }
{                                            troque por "Prim.TextKind = 1" (0 = stroke,    }
{                                            1 = TrueType - e como aquele script do Y: le). }
{   FontName ............................... SondaFonteTexto                                }
{   Bold Italic ............................ SondaNegritoItalico                            }
{   Inverted ............................... SondaInvertido                                 }
{   PCBContourMaker MakeContour ............ SondaContornoTexto                             }
{   Contour ................................ ContornoDoPoligono                             }
{   IsHole ................................. EhFuroDoPoligono                               }
{   HoleCount .............................. SondaFurosRegiao                               }
{   Holes .................................. FuroDaRegiao                                   }
{   Plated ................................. SondaMetalizado                                }
{   GetState_Cache SolderMaskExpansionValid SolderMaskExpansion PasteMaskExpansionValid    }
{   PasteMaskExpansion FindDominantRuleForObject Expansion ...... SondaExpansao            }
{   IsTenting_Top IsTenting_Bottom ......... SondaTenting                                   }
{   Mode ................................... SondaPilhaPad                                  }
{   XPadOffset YPadOffset .................. SondaFuroDeslocado                             }
{   LayerStack ............................. CamadasJSON                                    }
{   FirstLayer NextLayer LayerID ........... SondaPilhaCobre                                }
{   LayerObject ............................ ObjCamada                                      }
{   MechanicalLayerEnabled ................. SondaMecHabilitada                             }
{   LayerColor ............................. SondaCorCamada                                 }
{   RuleKind Enabled Scope1Expression Scope2Expression Priority Gap FavoredWidth           }
{   PreferedWidth PreferedHoleWidth Expansion ............... LeRegra                       }
{ Ja usados neste repositorio e so lidos agora em objeto novo (o try e pelo objeto): Width e }
{ XLocation/YLocation de texto (ApplyChanges), Kind(), Component, Name, Count, BotXSize...   }

// Anota uma falha de sonda: o nome entra uma vez so e a contagem sobe. A lista sai no dialogo
// final e no export-report.txt.
procedure AnotaFalhaDeSonda(Nome: String);
var
  i, n: Integer;
begin
  i := SondaNomes.IndexOf(Nome);
  if i < 0 then
  begin
    SondaNomes.Add(Nome);
    SondaQtd.Add('1');
  end
  else
  begin
    n := SafeStrToInt(SondaQtd[i]);
    try
      SondaQtd[i] := IntToStr(n + 1);
    except
      // a contagem e so informativa: se nem a escrita na lista der, fica o numero que estava
    end;
  end;
end;

// Anota que a sonda respondeu - uma vez basta. E o que separa, no relatorio e no SondaAindaVale,
// "nome que este Altium nao tem" de "objeto em que essa leitura nao se aplica".
procedure AnotaRespostaDeSonda(Nome: String);
begin
  if SondaOk.IndexOf(Nome) < 0 then
    SondaOk.Add(Nome);
end;

// Ainda vale tentar? Sim, a menos que a sonda ja tenha falhado SONDA_DESISTE vezes sem NUNCA
// ter respondido: ai e nome que este Altium nao tem, e insistir so custaria uma excecao por
// objeto.
function SondaAindaVale(Nome: String): Boolean;
var
  i: Integer;
begin
  Result := True;
  if SondaOk.IndexOf(Nome) >= 0 then
    Exit;
  i := SondaNomes.IndexOf(Nome);
  if i >= 0 then
    Result := SafeStrToInt(SondaQtd[i]) < SONDA_DESISTE;
end;

// Dono (designator) de region e fill. Component ja e lido aqui em trilha, arco e texto; so o
// tipo de objeto e novo, entao o try e pelo objeto, nao pelo nome.
function DonoDoObjeto(Prim: TObject): String;
begin
  Result := '';
  try
    Result := OwnerRefOf(Prim);
  except
    Result := '';
    AnotaFalhaDeSonda('Component (dono de region/fill)');
  end;
end;

// ',"keepout":true' no objeto que e keepout (Prim.IsKeepout). Keepout de cobre continua no
// array de hoje (tracks/arcs/regions), com a marca: tira-lo de la renumeraria os ids das
// placas que ja tem changes.js. Quem gera cobre (Gerber, tela) o pula.
function SondaKeepout(Prim: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'IsKeepout';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    if Prim.IsKeepout then
      Result := ',"keepout":true';
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
  if Result <> '' then
    NKeepout := NKeepout + 1;
end;

// Geometria do fill: os cantos SEM rotacao (X1Location..Y2Location) e a rotacao em torno do
// centro - o contrato do board.js. '' = a sonda nao respondeu, e o fill nao sai.
function SondaFill(Prim: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'Fill.X1Location/Y1Location/X2Location/Y2Location/Rotation';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := ',"x1":' + CX(Prim.X1Location) + ',"y1":' + CY(Prim.Y1Location) +
      ',"x2":' + CX(Prim.X2Location) + ',"y2":' + CY(Prim.Y2Location) +
      ',"rot":' + JF(Prim.Rotation);
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Espessura do traco do texto (Text.Width), em mm: o "w" que a tela ja le. O text_edit do
// ApplyChanges escreve esta propriedade desde 2026-08; ler e que e novo.
function SondaTextoW(Prim: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'Text.Width';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := ',"w":' + CW(Prim.Width);
    AnotaRespostaDeSonda(Nm);
    NTextosW := NTextosW + 1;
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Tipo do texto: 'truetype' | 'stroke' | '' (nao sabido), por Text.UseTTFonts - a propriedade
// classica, do DXP em diante. TextKind (que separaria tambem o codigo de barras) ficou de fora
// DE PROPOSITO: seria um segundo nome apostado na compilacao, e codigo de barras nao aparece
// em nenhum dos 444 PcbDoc da casa.
function SondaTipoTexto(Prim: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'Text.UseTTFonts';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    if Prim.UseTTFonts then
      Result := 'truetype'
    else
      Result := 'stroke';
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Nome da fonte TrueType (Text.FontName) - "Arial Rounded MT Bold" nos rotulos do ESP32.
// So e chamada para texto TrueType: no stroke o registro diz "Arial" e a letra nao e Arial.
function SondaFonteTexto(Prim: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'Text.FontName';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := ',"font":' + JS(Prim.FontName);
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Negrito e italico do TrueType (Text.Bold, Text.Italic).
function SondaNegritoItalico(Prim: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'Text.Bold/Italic';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := ',"bold":' + JB(Prim.Bold) + ',"italic":' + JB(Prim.Italic);
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Texto invertido (Text.Inverted): a letra vazada num retangulo cheio.
function SondaInvertido(Prim: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'Text.Inverted';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := ',"inverted":' + JB(Prim.Inverted);
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Ancora do texto (XLocation/YLocation): o ponto que o Altium guarda. O "x"/"y" do board.js e
// o centro do retangulo de selecao, que nao bate com a tinta em texto de varias linhas (1,2 mm
// no "DS" do DMB). Os dois nomes ja foram lidos em IPCB_Text pelo ApplyChanges.
function SondaAncoraTexto(Prim: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'Text.XLocation/YLocation';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := ',"ax":' + CX(Prim.XLocation) + ',"ay":' + CY(Prim.YLocation);
    AnotaRespostaDeSonda(Nm);
    NTextosAncora := NTextosAncora + 1;
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// '[x,y],[x,y],...' de um IPCB_Contour, pelo mesmo Count/GetState_PointX/Y que o contorno
// principal das regions ja usa. '' se a leitura falhar ou se o contorno vier vazio.
function PontosDoContorno(C: TObject): String;
var
  k, n: Integer;
  s: String;
begin
  Result := '';
  s := '';
  try
    n := C.Count;
    for k := 0 to n - 1 do
    begin
      if k > 0 then
        s := s + ',';
      s := s + '[' + CX(C.GetState_PointX(k)) + ',' + CY(C.GetState_PointY(k)) + ']';
    end;
    Result := s;
  except
    Result := '';
    AnotaFalhaDeSonda('Contour.Count/GetState_PointX/GetState_PointY');
  end;
end;

// Contorno i de um IPCB_GeometricPolygon: Contour[i], e Contour(i) se o colchete nao servir.
// Propriedade indexada: este arquivo le Segments[i] com colchete e CornerRadius(L) com
// parenteses, e daqui nao da para saber qual dos dois o Altium aceita nesta.
function ContornoDoPoligono(GP: TObject; i: Integer): TObject;
var
  Nm: String;
  Leu: Boolean;
begin
  Result := nil;
  Leu := False;
  Nm := 'GeometricPolygon.Contour[i]';
  if SondaAindaVale(Nm) then
  begin
    try
      Result := GP.Contour[i];
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      Result := nil;
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  Nm := 'GeometricPolygon.Contour(i)';
  if (not Leu) and SondaAindaVale(Nm) then
  begin
    try
      Result := GP.Contour(i);
      AnotaRespostaDeSonda(Nm);
    except
      Result := nil;
      AnotaFalhaDeSonda(Nm);
    end;
  end;
end;

// O contorno i e furo? GeometricPolygon.IsHole[i], e IsHole(i) se o colchete nao servir.
// Falhou vira True quando nenhuma das duas responde.
function EhFuroDoPoligono(GP: TObject; i: Integer; var Falhou: Boolean): Boolean;
var
  Nm: String;
  Leu: Boolean;
begin
  Result := False;
  Leu := False;
  Nm := 'GeometricPolygon.IsHole[i]';
  if SondaAindaVale(Nm) then
  begin
    try
      Result := GP.IsHole[i];
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      Result := False;
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  Nm := 'GeometricPolygon.IsHole(i)';
  if (not Leu) and SondaAindaVale(Nm) then
  begin
    try
      Result := GP.IsHole(i);
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      Result := False;
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  if not Leu then
    Falhou := True;
end;

// CONTORNO EXATO DO TEXTO (texts[].polys): a letra como o Altium a desenha, em poligonos
// (contorno externo e furos), pelo mesmo fabricante de contorno que o Altium usa para afastar
// cobre - PCBServer.PCBContourMaker.MakeContour(texto, 0, camada), que devolve um
// IPCB_GeometricPolygon (Count, Contour[i], IsHole[i]). Com ele a tela e o Gerber deixam de
// depender da fonte do hub (IoU 0,38 contra a stroke do Altium) e o TrueType sai igual.
// Tudo ou nada: um contorno que nao pode ser lido derruba os polys DESTE texto (letra com um
// pedaco a menos e pior que a fonte do hub). Passou de POLY_TEXTO_MAX vertices: sem polys.
function SondaContornoTexto(Prim: TObject): String;
var
  Nm, Polys, Pts: String;
  Srv, GP, C: TObject;
  n, i, Total: Integer;
  Furo, Falhou, Respondeu: Boolean;
begin
  Result := '';
  Nm := 'PCBServer.PCBContourMaker.MakeContour';
  if not SondaAindaVale(Nm) then
    Exit;
  GP := nil;
  Respondeu := False;
  try
    Srv := PCBServer;
    GP := Srv.PCBContourMaker.MakeContour(Prim, 0, Prim.Layer);
    Respondeu := True;
    AnotaRespostaDeSonda(Nm);
  except
    GP := nil;
    AnotaFalhaDeSonda(Nm);
  end;
  if not Respondeu then
    Exit;
  if GP = nil then
  begin
    NTextosPolyVazio := NTextosPolyVazio + 1;
    Exit;
  end;
  Nm := 'GeometricPolygon.Count';
  if not SondaAindaVale(Nm) then
    Exit;
  n := -1;
  try
    n := GP.Count;
    AnotaRespostaDeSonda(Nm);
  except
    n := -1;
    AnotaFalhaDeSonda(Nm);
  end;
  if n = 0 then
    NTextosPolyVazio := NTextosPolyVazio + 1;
  if n <= 0 then
    Exit;
  // 1) conta os vertices ANTES de escrever: o limite e por texto
  Total := 0;
  Falhou := False;
  for i := 0 to n - 1 do
  begin
    C := ContornoDoPoligono(GP, i);
    if C = nil then
      Falhou := True
    else
    begin
      try
        Total := Total + C.Count;
      except
        Falhou := True;
        AnotaFalhaDeSonda('Contour.Count (contorno do texto)');
      end;
    end;
  end;
  if Falhou then
    Exit;
  if Total > POLY_TEXTO_MAX then
  begin
    NTextosPolyGrande := NTextosPolyGrande + 1;
    Exit;
  end;
  // 2) escreve: cada contorno com a sua marca de furo
  Polys := '';
  for i := 0 to n - 1 do
  begin
    C := ContornoDoPoligono(GP, i);
    Pts := '';
    if C <> nil then
      Pts := PontosDoContorno(C);
    if Pts = '' then
      Falhou := True
    else
    begin
      Furo := EhFuroDoPoligono(GP, i, Falhou);
      if Polys <> '' then
        Polys := Polys + ',';
      Polys := Polys + '{"hole":' + JB(Furo) + ',"pts":[' + Pts + ']}';
    end;
  end;
  if Falhou or (Polys = '') then
    Exit;
  Result := ',"polys":[' + Polys + ']';
  NTextosPoly := NTextosPoly + 1;
end;

// Furo h de uma region: Holes[h], e Holes(h) se o colchete nao servir. nil = sem resposta.
function FuroDaRegiao(R: TObject; h: Integer): TObject;
var
  Nm: String;
  Leu: Boolean;
begin
  Result := nil;
  Leu := False;
  Nm := 'Region.Holes[i]';
  if SondaAindaVale(Nm) then
  begin
    try
      Result := R.Holes[h];
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      Result := nil;
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  Nm := 'Region.Holes(i)';
  if (not Leu) and SondaAindaVale(Nm) then
  begin
    try
      Result := R.Holes(h);
      AnotaRespostaDeSonda(Nm);
    except
      Result := nil;
      AnotaFalhaDeSonda(Nm);
    end;
  end;
end;

// FUROS DA REGION (regions[].holes): o miolo que o polygon despejado deixa em volta de pad e
// trilha de outra net. Sem eles o cobre do Gerber fecha curto - 28 arquivos de cobre do acervo
// tem polygon com furo. O GetMainContour de sempre so traz o contorno externo.
// Tudo ou nada: region com UM furo a menos e curto no Gerber, entao, se algum furo nao puder
// ser lido, a region sai como saia ate hoje (sem "holes") e o relatorio diz.
function SondaFurosRegiao(R: TObject): String;
var
  Nm, Furos, Pts: String;
  n, h: Integer;
  F: TObject;
  Falhou: Boolean;
begin
  Result := '';
  Nm := 'Region.HoleCount';
  if not SondaAindaVale(Nm) then
    Exit;
  n := 0;
  try
    n := R.HoleCount;
    AnotaRespostaDeSonda(Nm);
  except
    n := 0;
    AnotaFalhaDeSonda(Nm);
  end;
  if n <= 0 then
    Exit;
  Furos := '';
  Falhou := False;
  for h := 0 to n - 1 do
  begin
    F := FuroDaRegiao(R, h);
    Pts := '';
    if F <> nil then
      Pts := PontosDoContorno(F);
    if Pts = '' then
      Falhou := True
    else
    begin
      if Furos <> '' then
        Furos := Furos + ',';
      Furos := Furos + '[' + Pts + ']';
    end;
  end;
  if Falhou then
  begin
    AnotaFalhaDeSonda('Region.Holes (algum furo nao pode ser lido: a region saiu sem holes)');
    Exit;
  end;
  Result := ',"holes":[' + Furos + ']';
  NRegioesFuro := NRegioesFuro + 1;
end;

// O inteiro do Kind() da region (cutouts[].kindn): separa Board Cutout, recorte de polygon e a
// regiao do tamanho da placa, que hoje caem juntos em cutouts. O que cada numero quer dizer
// nao foi medido - a primeira rodada no Altium diz (o furo de fixacao e o de layer Multi com
// incomp false; a regiao da placa cobre o bbox inteiro).
function SondaKindN(R: TObject): String;
var
  Nm: String;
  K: Integer;
begin
  Result := '';
  Nm := 'Region.Kind() (inteiro)';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    K := R.Kind();
    Result := ',"kindn":' + IntToStr(K);
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Furo metalizado (Pad.Plated): decide entre PTH e NPTH no Gerber. So pad passante.
function SondaMetalizado(Pad: TObject): String;
var
  Nm: String;
begin
  Result := '';
  Nm := 'Pad.Plated';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := ',"plated":' + JB(Pad.Plated);
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// O nome da regra contradiz o tipo suposto pelo inteiro? So vale para o par que tem a MESMA
// propriedade (Expansion): mascara de solda (13) e de pasta (14). Os nomes padrao do Altium
// sao "SolderMaskExpansion" e "PasteMaskExpansion".
function NomeContradiz(NomeMaiusc: String; Tipo: Integer): Boolean;
begin
  Result := False;
  if Tipo = 13 then
    Result := (Pos('PASTE', NomeMaiusc) > 0)
  else if Tipo = 14 then
    Result := (Pos('SOLDER', NomeMaiusc) > 0);
end;

// Expansao EFETIVA de mascara (Solda = True) ou de pasta (Solda = False) de pad ou via, em
// Coord: a manual do proprio objeto quando ele esta em modo manual, senao a da regra que manda
// nele (Board.FindDominantRuleForObject). False = nao deu para saber, e o campo nao sai -
// "regra" e "nao sei" nunca viram o mesmo numero. E o caso dos 40 pads do DMB com mascara
// manual 0, que a regra de 4 mil abriria.
//
// MODO: o registro de cache do objeto (GetState_Cache), campo ...ExpansionValid. O TCacheState
// documentado e (eCacheInvalid, eCacheValid, eCacheManual): 2 = manual, comparado pelo
// INTEIRO. O .PcbDoc do DMB grava o mesmo numero (1 = regra em 99 pads, 2 = manual em 40). O
// registro e lido direto da chamada (sem guardar numa variavel), que e como ele chega aqui.
// REGRA: o tipo vai pelo inteiro (13 SolderMaskExpansion, 14 PasteMaskExpansion - a ordem do
// TRuleKind, ver RegrasJSON) e o nome da regra devolvida ainda e conferido (NomeContradiz).
// Quem ('Pad' ou 'Via') entra no nome da sonda: pad e via sao objetos diferentes no API, e uma
// leitura que so a via recusasse sairia no relatorio como "respondeu em outros objetos" e seria
// tentada de novo em cada via, sem nunca desistir.
function SondaExpansao(Prim: TObject; Quem: String; Solda: Boolean; var Valor: Integer): Boolean;
var
  B, R: TObject;
  Nm: String;
  Modo, Tipo: Integer;
  Contradiz: Boolean;
begin
  Result := False;
  Valor := 0;
  if Solda then
    Nm := Quem + '.GetState_Cache.SolderMaskExpansionValid/SolderMaskExpansion'
  else
    Nm := Quem + '.GetState_Cache.PasteMaskExpansionValid/PasteMaskExpansion';
  if not SondaAindaVale(Nm) then
    Exit;
  Modo := -1;
  try
    if Solda then
    begin
      Modo := Prim.GetState_Cache.SolderMaskExpansionValid;
      if Modo = 2 then
        Valor := Prim.GetState_Cache.SolderMaskExpansion;
    end
    else
    begin
      Modo := Prim.GetState_Cache.PasteMaskExpansionValid;
      if Modo = 2 then
        Valor := Prim.GetState_Cache.PasteMaskExpansion;
    end;
    AnotaRespostaDeSonda(Nm);
  except
    Modo := -1;
    AnotaFalhaDeSonda(Nm);
  end;
  if Modo = 2 then
  begin
    Result := True;
    Exit;
  end;
  // sem o modo nao da para saber se o objeto e manual: melhor nao sair nada que sair a regra
  if (Modo < 0) or RegraSuspeita then
    Exit;
  Tipo := 14;
  if Solda then
    Tipo := 13;
  Nm := Quem + ': Board.FindDominantRuleForObject/Rule.Expansion';
  if not SondaAindaVale(Nm) then
    Exit;
  Contradiz := False;
  try
    B := Board;
    R := B.FindDominantRuleForObject(Prim, Tipo);
    if R <> nil then
    begin
      Contradiz := NomeContradiz(UpperCase(R.Name), Tipo);
      if not Contradiz then
      begin
        Valor := R.Expansion;
        Result := True;
      end;
    end;
    AnotaRespostaDeSonda(Nm);
  except
    Result := False;
    AnotaFalhaDeSonda(Nm);
  end;
  if Contradiz then
  begin
    Result := False;
    RegraSuspeita := True;
    AnotaFalhaDeSonda('RuleKind 13/14 (FindDominantRuleForObject devolveu regra de outro tipo)');
  end;
end;

// Tenting por face (IsTenting_Top/IsTenting_Bottom): true = sem abertura de mascara naquele
// lado. O DMB tem 33 vias abertas; um gerador que tampasse via por padrao apagaria 66 janelas.
// Quem ('Pad' ou 'Via') separa as duas sondas, pelo mesmo motivo do SondaExpansao.
function SondaTenting(Prim: TObject; Quem: String): String;
var
  Nm: String;
begin
  Result := '';
  Nm := Quem + '.IsTenting_Top/IsTenting_Bottom';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := ',"tentTop":' + JB(Prim.IsTenting_Top) + ',"tentBot":' + JB(Prim.IsTenting_Bottom);
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Pilha do pad passante: Mode 0 = simples (uma forma so), 1 = top-mid-bottom, 2 = pilha
// completa (a ordem do TPadMode documentado, pelo inteiro). So quando a pilha NAO e simples E o
// Bottom difere do Top sai "bot":{w,h,shape,radius} - numa pilha simples os campos Bot podem
// guardar lixo de uma pilha antiga e nao podem ser lidos. BotXSize/BotYSize/BotShape e
// CornerRadius(L) ja sao lidos por este arquivo (pad SMD no Bottom); o nome novo e Mode.
function SondaPilhaPad(Pad: TObject): String;
var
  Nm, BW, BH, Raio: String;
  Modo, Codigo: Integer;
  Igual: Boolean;
begin
  Result := '';
  Nm := 'Pad.Mode';
  if not SondaAindaVale(Nm) then
    Exit;
  Modo := -1;
  try
    Modo := Pad.Mode;
    AnotaRespostaDeSonda(Nm);
  except
    Modo := -1;
    AnotaFalhaDeSonda(Nm);
  end;
  if Modo <= 0 then
    Exit;
  try
    Igual := (Pad.BotXSize = Pad.TopXSize) and (Pad.BotYSize = Pad.TopYSize) and
             (Pad.BotShape = Pad.TopShape);
    if not Igual then
    begin
      BW := CW(Pad.BotXSize);
      BH := CW(Pad.BotYSize);
      Codigo := Pad.BotShape;
      Raio := '';
      if Codigo = 9 then
        Raio := ',"radius":' + CW(Pad.CornerRadius(eBottomLayer));
      Result := ',"bot":{"w":' + BW + ',"h":' + BH + ',"shape":' + JS(NomeDaForma(Codigo, BW, BH)) +
        Raio + '}';
    end;
  except
    Result := '';
    AnotaFalhaDeSonda('Pad.BotXSize/BotYSize/BotShape (pilha do passante)');
  end;
end;

// Furo deslocado do pad passante (o "Offset From Hole Center" do Altium): XPadOffset/YPadOffset
// do Top, em mm, no referencial do pad (antes da rotacao). So sai quando nao e zero.
function SondaFuroDeslocado(Pad: TObject): String;
var
  Nm: String;
  OX, OY: Integer;
  Leu: Boolean;
begin
  Result := '';
  Leu := False;
  OX := 0;
  OY := 0;
  Nm := 'Pad.XPadOffset[L]/YPadOffset[L]';
  if SondaAindaVale(Nm) then
  begin
    try
      OX := Pad.XPadOffset[eTopLayer];
      OY := Pad.YPadOffset[eTopLayer];
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  Nm := 'Pad.XPadOffset(L)/YPadOffset(L)';
  if (not Leu) and SondaAindaVale(Nm) then
  begin
    try
      OX := Pad.XPadOffset(eTopLayer);
      OY := Pad.YPadOffset(eTopLayer);
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  if Leu and ((OX <> 0) or (OY <> 0)) then
    Result := ',"hox":' + CW(OX) + ',"hoy":' + CW(OY);
end;

// IPCB_LayerObject de uma camada: Board.LayerStack.LayerObject[L], e LayerObject(L) se o
// colchete nao servir. nil = sem pilha ou sem resposta.
function ObjCamada(Camada: Integer): TObject;
var
  Nm: String;
  Leu: Boolean;
begin
  Result := nil;
  if PilhaObj = nil then
    Exit;
  Leu := False;
  Nm := 'LayerStack.LayerObject[L]';
  if SondaAindaVale(Nm) then
  begin
    try
      Result := PilhaObj.LayerObject[Camada];
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      Result := nil;
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  Nm := 'LayerStack.LayerObject(L)';
  if (not Leu) and SondaAindaVale(Nm) then
  begin
    try
      Result := PilhaObj.LayerObject(Camada);
      AnotaRespostaDeSonda(Nm);
    except
      Result := nil;
      AnotaFalhaDeSonda(Nm);
    end;
  end;
end;

// Nome da camada como ESTA placa a chama ("Top Layer", "Top 3D Body"...): LayerObject.Name.
function SondaNomeCamada(Camada: Integer): String;
var
  LO: TObject;
  Nm: String;
begin
  Result := '';
  LO := ObjCamada(Camada);
  if LO = nil then
    Exit;
  Nm := 'LayerObject.Name';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := LO.Name;
    AnotaRespostaDeSonda(Nm);
  except
    Result := '';
    AnotaFalhaDeSonda(Nm);
  end;
end;

// Cor da camada: Board.LayerColor[L] (e LayerColor(L) se o colchete nao servir), TColor BGR
// -> '#RRGGBB'. Cor de sistema (bit alto ligado) ou fora de 24 bits nao sai.
function SondaCorCamada(Camada: Integer): String;
var
  B: TObject;
  Nm: String;
  C: Integer;
  Leu: Boolean;
begin
  Result := '';
  Leu := False;
  C := -1;
  B := Board;
  Nm := 'Board.LayerColor[L]';
  if SondaAindaVale(Nm) then
  begin
    try
      C := B.LayerColor[Camada];
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  Nm := 'Board.LayerColor(L)';
  if (not Leu) and SondaAindaVale(Nm) then
  begin
    try
      C := B.LayerColor(Camada);
      Leu := True;
      AnotaRespostaDeSonda(Nm);
    except
      AnotaFalhaDeSonda(Nm);
    end;
  end;
  if Leu and (C >= 0) and (C <= $FFFFFF) then
    Result := HexDeCorBGR(C);
end;

// Mecanica habilitada? (LayerObject.MechanicalLayerEnabled). False tambem quando nao se sabe:
// a mecanica com objeto entra na lista de camadas de qualquer jeito (ver CamadasJSON).
function SondaMecHabilitada(Camada: Integer): Boolean;
var
  LO: TObject;
  Nm: String;
begin
  Result := False;
  LO := ObjCamada(Camada);
  if LO = nil then
    Exit;
  Nm := 'LayerObject.MechanicalLayerEnabled';
  if not SondaAindaVale(Nm) then
    Exit;
  try
    Result := LO.MechanicalLayerEnabled;
    AnotaRespostaDeSonda(Nm);
  except
    Result := False;
    AnotaFalhaDeSonda(Nm);
  end;
end;

// {"key","name","color","stack"} de uma camada. NomePilha = o nome que a pilha ja deu ('' =
// perguntar ao LayerObject); Pilha = posicao fisica no cobre (0 = o campo nao sai). Camada sem
// nome nem cor ainda sai, so com a chave: e o que diz "esta placa tem esta camada".
function CamadaJSON(Camada: Integer; Chave, NomePilha: String; Pilha: Integer): String;
var
  Nome, Cor: String;
begin
  Nome := NomePilha;
  if Nome = '' then
    Nome := SondaNomeCamada(Camada);
  Cor := SondaCorCamada(Camada);
  Result := '{"key":' + JS(Chave);
  if Nome <> '' then
    Result := Result + ',"name":' + JS(Nome);
  if Cor <> '' then
    Result := Result + ',"color":' + JS(Cor);
  if Pilha > 0 then
    Result := Result + ',"stack":' + IntToStr(Pilha);
  Result := Result + '}';
end;

// Cobre na ordem FISICA da pilha (Board.LayerStack: FirstLayer/NextLayer), Top = 1 ... Bottom
// = N: e a ordem que numera o _Copper_Signal_L<n> do Gerber. Itens prontos em Itens, chaves em
// Chaves. True = a pilha foi lida inteira E vai do Top ao Bottom; senao nada dela e usado,
// porque numero de pilha errado e pior que numero nenhum.
function SondaPilhaCobre(Itens: TStringList; Chaves: TStringList): Boolean;
var
  Nm, Chave, Nome, Primeira, Ultima: String;
  LO: TObject;
  Camada, n, Pilha: Integer;
  Leu: Boolean;
begin
  Result := False;
  Itens.Clear;
  Chaves.Clear;
  if PilhaObj = nil then
    Exit;
  Nm := 'LayerStack.FirstLayer/NextLayer/LayerID';
  if not SondaAindaVale(Nm) then
    Exit;
  Pilha := 0;
  n := 0;
  Primeira := '';
  Ultima := '';
  Leu := False;
  try
    LO := PilhaObj.FirstLayer;
    while (LO <> nil) and (n < 200) do
    begin
      Camada := LO.LayerID;
      Chave := LayerNameOf(Camada);
      if EhCobreKey(Chave) and (Chaves.IndexOf(Chave) < 0) then
      begin
        Pilha := Pilha + 1;
        if Primeira = '' then
          Primeira := Chave;
        Ultima := Chave;
        Nome := '';
        try
          Nome := LO.Name;
        except
          Nome := '';
        end;
        Itens.Add(CamadaJSON(Camada, Chave, Nome, Pilha));
        Chaves.Add(Chave);
      end;
      LO := PilhaObj.NextLayer(LO);
      n := n + 1;
    end;
    Leu := True;
    AnotaRespostaDeSonda(Nm);
  except
    Leu := False;
    AnotaFalhaDeSonda(Nm);
  end;
  Result := Leu and (Pilha >= 2) and (Primeira = 'Top') and (Ultima = 'Bottom');
  if Leu and (not Result) then
    AnotaFalhaDeSonda('LayerStack (a ordem lida nao vai do Top ao Bottom: sem "stack")');
  if not Result then
  begin
    Itens.Clear;
    Chaves.Clear;
  end;
end;

// Uma regra do iterador (RegrasJSON): guarda o valor dela se for de um dos cinco tipos lidos,
// ativa, de escopo All (a regra da placa) e de prioridade melhor que a ja guardada (1 = a mais
// forte). O tipo vem pelo INTEIRO de RuleKind - ver a ordem e as travas em RegrasJSON.
procedure LeRegra(R: TObject);
var
  Tipo, Prio: Integer;
  Ativa, Leu: Boolean;
  Esc1, Esc2, Nome, V1, V2, Nm: String;
begin
  Nm := 'Rule.RuleKind';
  if not SondaAindaVale(Nm) then
    Exit;
  Tipo := -1;
  try
    Tipo := R.RuleKind;
    AnotaRespostaDeSonda(Nm);
  except
    Tipo := -1;
    AnotaFalhaDeSonda(Nm);
  end;
  if (Tipo <> 0) and (Tipo <> 2) and (Tipo <> 11) and (Tipo <> 13) and (Tipo <> 14) then
    Exit;
  Leu := False;
  Ativa := False;
  Esc1 := '';
  Prio := 1000000;
  Nome := '';
  Nm := 'Rule.Enabled/Scope1Expression/Priority/Name';
  try
    Ativa := R.Enabled;
    Esc1 := Trim(R.Scope1Expression);
    Prio := R.Priority;
    Nome := R.Name;
    Leu := True;
    AnotaRespostaDeSonda(Nm);
  except
    Leu := False;
    AnotaFalhaDeSonda(Nm);
  end;
  if (not Leu) or (not Ativa) or (UpperCase(Esc1) <> 'ALL') then
    Exit;
  // Clearance e regra de DOIS escopos: a da placa e a "All" x "All"
  if Tipo = 0 then
  begin
    Esc2 := 'All';
    try
      Esc2 := Trim(R.Scope2Expression);
    except
      Esc2 := 'All';
      AnotaFalhaDeSonda('Rule.Scope2Expression');
    end;
    if UpperCase(Esc2) <> 'ALL' then
      Exit;
  end;
  if NomeContradiz(UpperCase(Nome), Tipo) then
  begin
    RegraSuspeita := True;
    AnotaFalhaDeSonda('RuleKind 13/14 (a regra "' + Nome + '" nao e do tipo suposto)');
    Exit;
  end;
  V1 := '';
  V2 := '';
  if Tipo = 13 then
  begin
    if Prio < RgSmP then
    begin
      try
        V1 := CW(R.Expansion);
      except
        V1 := '';
        AnotaFalhaDeSonda('Rule.Expansion');
      end;
      if V1 <> '' then
      begin
        RgSm := V1;
        RgSmP := Prio;
        RegrasLidas.Add('   sm = ' + V1 + ' mm   <- regra "' + Nome + '" (RuleKind 13, prioridade ' +
          IntToStr(Prio) + ')');
      end;
    end;
  end
  else if Tipo = 14 then
  begin
    if Prio < RgPmP then
    begin
      try
        V1 := CW(R.Expansion);
      except
        V1 := '';
        AnotaFalhaDeSonda('Rule.Expansion');
      end;
      if V1 <> '' then
      begin
        RgPm := V1;
        RgPmP := Prio;
        RegrasLidas.Add('   pm = ' + V1 + ' mm   <- regra "' + Nome + '" (RuleKind 14, prioridade ' +
          IntToStr(Prio) + ')');
      end;
    end;
  end
  else if Tipo = 0 then
  begin
    if Prio < RgClearP then
    begin
      try
        V1 := CW(R.Gap);
      except
        V1 := '';
        AnotaFalhaDeSonda('Rule.Gap');
      end;
      if V1 <> '' then
      begin
        RgClear := V1;
        RgClearP := Prio;
        RegrasLidas.Add('   clearance = ' + V1 + ' mm   <- regra "' + Nome + '" (RuleKind 0, prioridade ' +
          IntToStr(Prio) + ')');
      end;
    end;
  end
  else if Tipo = 2 then
  begin
    if Prio < RgWidthP then
    begin
      try
        V1 := CW(R.FavoredWidth[eTopLayer]);
      except
        V1 := '';
        AnotaFalhaDeSonda('Rule.FavoredWidth[L]');
      end;
      if V1 = '' then
      begin
        try
          V1 := CW(R.FavoredWidth(eTopLayer));
        except
          V1 := '';
          AnotaFalhaDeSonda('Rule.FavoredWidth(L)');
        end;
      end;
      if V1 <> '' then
      begin
        RgWidth := V1;
        RgWidthP := Prio;
        RegrasLidas.Add('   width = ' + V1 + ' mm (Top)   <- regra "' + Nome + '" (RuleKind 2, prioridade ' +
          IntToStr(Prio) + ')');
      end;
    end;
  end
  else if Tipo = 11 then
  begin
    if Prio < RgViaP then
    begin
      try
        V1 := CW(R.PreferedWidth);
        V2 := CW(R.PreferedHoleWidth);
      except
        V1 := '';
        V2 := '';
        AnotaFalhaDeSonda('Rule.PreferedWidth/PreferedHoleWidth');
      end;
      if (V1 <> '') and (V2 <> '') then
      begin
        RgViaSize := V1;
        RgViaDrill := V2;
        RgViaP := Prio;
        RegrasLidas.Add('   via = ' + V1 + ' / ' + V2 + ' mm   <- regra "' + Nome +
          '" (RuleKind 11, prioridade ' + IntToStr(Prio) + ')');
      end;
    end;
  end;
end;

{ ====================================== fim SONDAS ====================================== }

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
  Expa: Integer;
  Extra: String;
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

  // ---- campos de 2026-10, todos opcionais (ver SONDAS). Ausente = nao sabido.
  NPads := NPads + 1;
  if PadType = 'th' then
  begin
    NPadsTh := NPadsTh + 1;
    Extra := SondaMetalizado(Pad);
    if Extra <> '' then
      NPadsPlated := NPadsPlated + 1;
    s := s + Extra;
  end;
  // mascara: todo pad (o passante abre nas duas faces com a mesma expansao)
  if SondaExpansao(Pad, 'Pad', True, Expa) then
  begin
    s := s + ',"sm":' + CW(Expa);
    NPadsSm := NPadsSm + 1;
  end;
  // pasta: so pad SMD - o Altium nao poe pasta em pad passante (73 de 73 no Gerber do DMB)
  if PadType = 'smd' then
  begin
    NPadsSmd := NPadsSmd + 1;
    if SondaExpansao(Pad, 'Pad', False, Expa) then
    begin
      s := s + ',"pm":' + CW(Expa);
      // -1000 mm e o jeito do Altium dizer "sem pasta neste pad" (61 pads no acervo)
      if CoordToMMs(Expa) <= -500 then
        s := s + ',"nopaste":true';
      NPadsPm := NPadsPm + 1;
    end;
  end;
  Extra := SondaTenting(Pad, 'Pad');
  if Extra <> '' then
    NPadsTent := NPadsTent + 1;
  s := s + Extra;
  if PadType = 'th' then
  begin
    s := s + SondaPilhaPad(Pad);
    s := s + SondaFuroDeslocado(Pad);
  end;
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
  // keepout de cobre fica AQUI, com a marca (2026-10): tira-lo renumeraria os t<n>
  s := s + SondaKeepout(Prim);
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
  // keepout de cobre fica AQUI, com a marca (2026-10): tira-lo renumeraria os a<n>
  s := s + SondaKeepout(Prim);
  s := s + '}';
  Result := s;
end;

function ViaJSON(Prim: TObject; Id: String): String;
var
  s, Extra: String;
  Expa: Integer;
begin
  s := '{"id":' + JS(Id);
  s := s + ',"x":' + CX(Prim.x);
  s := s + ',"y":' + CY(Prim.y);
  s := s + ',"size":' + CW(Prim.Size);
  s := s + ',"drill":' + CW(Prim.HoleSize);
  s := s + ',"from":' + JS(LayerNameOf(Prim.LowLayer));
  s := s + ',"to":' + JS(LayerNameOf(Prim.HighLayer));
  s := s + ',"net":' + JS(NetNameOf(Prim));
  // ---- campos de 2026-10 (ver SONDAS): mascara efetiva e tenting por face
  if SondaExpansao(Prim, 'Via', True, Expa) then
  begin
    s := s + ',"sm":' + CW(Expa);
    NViasSm := NViasSm + 1;
  end;
  Extra := SondaTenting(Prim, 'Via');
  if Extra <> '' then
    NViasTent := NViasTent + 1;
  s := s + Extra;
  s := s + '}';
  Result := s;
end;

function TextJSON(Prim: TObject; Id: String): String;
var
  s, Owner, Tipo: String;
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

  // ---- campos de 2026-10, todos opcionais (ver SONDAS). Ausente = nao sabido.
  NTextos := NTextos + 1;
  s := s + SondaTextoW(Prim);
  Tipo := SondaTipoTexto(Prim);
  if Tipo <> '' then
  begin
    s := s + ',"kind":' + JS(Tipo);
    NTextosTipo := NTextosTipo + 1;
  end;
  // fonte, negrito e italico so existem no TrueType
  if Tipo = 'truetype' then
    s := s + SondaFonteTexto(Prim) + SondaNegritoItalico(Prim);
  s := s + SondaInvertido(Prim);
  s := s + SondaAncoraTexto(Prim);
  // o contorno vai por ultimo: e o campo grande da linha
  s := s + SondaContornoTexto(Prim);
  s := s + '}';
  Result := s;
end;

// Linha de silk (e, desde 2026-10, de "lines": mecanica, Keep-Out, mascara, pasta, furacao -
// o MESMO formato). Extra entra antes do fecho: '' no silk, a marca de keepout nas linhas.
function SilkLineJSON(Prim: TObject; Id, Extra: String): String;
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
  s := s + Extra;
  s := s + '}';
  Result := s;
end;

// Arco de silk (e de "lines"): o mesmo arranjo do SilkLineJSON.
function SilkArcJSON(Prim: TObject; Id, Extra: String): String;
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
  s := s + Extra;
  s := s + '}';
  Result := s;
end;

// Contorno principal de uma region (ou de cada region-filha de um poligono). Desde 2026-10
// tambem os furos ("holes"), a marca de pedaco de polygon despejado ("poly":true - EhPoly), o
// dono e a marca de keepout.
function ContourJSON(RegionPrim: TObject; Id, NetStr: String; EhPoly: Boolean): String;
var
  s, Owner: String;
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
  s := s + ']';
  // ---- campos de 2026-10 (ver SONDAS)
  s := s + SondaFurosRegiao(RegionPrim);
  if EhPoly then
    s := s + ',"poly":true';
  Owner := DonoDoObjeto(RegionPrim);
  if Owner <> '' then
    s := s + ',"owner":' + JS(Owner);
  s := s + SondaKeepout(RegionPrim);
  s := s + '}';
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
  s := s + ']';
  // 2026-10: o inteiro do Kind(), que separa os tres que caem aqui (ver SondaKindN)
  s := s + SondaKindN(RegionPrim);
  s := s + '}';
  Result := s;
end;

// Fill (retangulo cheio) - o QR code e o logo do silk da casa sao feitos deles (392 no DMB,
// 70% dos projetos). "x1".."y2" sao os cantos SEM rotacao e "rot" gira em torno do centro.
// '' = a sonda da geometria nao respondeu, e o fill nao sai.
function FillJSON(Prim: TObject; Id: String): String;
var
  s, Geo, Owner: String;
begin
  Result := '';
  Geo := SondaFill(Prim);
  if Geo = '' then
    Exit;
  s := '{"id":' + JS(Id);
  s := s + ',"layer":' + JS(LayerNameOf(Prim.Layer));
  s := s + Geo;
  s := s + ',"net":' + JS(NetNameOf(Prim));
  Owner := DonoDoObjeto(Prim);
  if Owner <> '' then
    s := s + ',"owner":' + JS(Owner);
  s := s + SondaKeepout(Prim);
  s := s + '}';
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
      AddItem(RegionL, ContourJSON(Child, 'g' + IntToStr(RegionIdx), NetStr, True));
    end;
    Child := GIter.NextPCBObject;
  end;
  Poly.GroupIterator_Destroy(GIter);
end;

{ ..................................................................................................................... }
{ .                                        Camadas e regras da placa (2026-10)                                        . }
{ ..................................................................................................................... }

// board.js >> layers: {"key","name","color","stack"} das camadas desta placa:
//   - cobre na ordem FISICA da pilha, com "stack" (Top = 1 ... Bottom = N); sem a pilha, Top e
//     Bottom e as Mid/Plane que tem objeto, sem "stack";
//   - mecanicas habilitadas (MechanicalLayerEnabled) ou com objeto exportado;
//   - as especiais, sempre: overlays, pastas, mascaras, Drill Guide, Keep-Out, Drill Drawing,
//     Multi. Com a numeracao de camadas sem conferir (CamadasOk) so saem as 7 de sempre.
// Nome e cor sao sondas; a chave sai sempre.
procedure CamadasJSON(Saida: TStringList);
var
  Itens, Chaves: TStringList;
  i, Camada: Integer;
  Chave, Nm: String;
  B: TObject;
begin
  PilhaObj := nil;
  Nm := 'Board.LayerStack';
  try
    // Pela variavel TObject, como SondaCorCamada e SondaExpansao: lido direto em Board (que e
    // IPCB_Board declarado) o nome teria de existir NAQUELA interface para compilar - e o caso
    // que o bloco APOSTAS do ApplyChanges registra (IPCB_Region.ArcResolution, AD24). Pela
    // variavel TObject basta o nome existir no API.
    B := Board;
    PilhaObj := B.LayerStack;
    AnotaRespostaDeSonda(Nm);
  except
    PilhaObj := nil;
    AnotaFalhaDeSonda(Nm);
  end;

  // 1) cobre
  Itens := TStringList.Create;
  Chaves := TStringList.Create;
  NPilha := 0;
  if SondaPilhaCobre(Itens, Chaves) then
  begin
    NPilha := Itens.Count;
    for i := 0 to Itens.Count - 1 do
      AddItem(Saida, Itens[i]);
  end
  else
  begin
    AddItem(Saida, CamadaJSON(eTopLayer, 'Top', '', 0));
    if CamadasOk then
    begin
      for Camada := eTopLayer + 1 to eBottomLayer - 1 do
        if Usadas.IndexOf(LayerNameOf(Camada)) >= 0 then
          AddItem(Saida, CamadaJSON(Camada, LayerNameOf(Camada), '', 0));
      for Camada := eBottomOverlay + 5 to eBottomOverlay + 20 do
        if Usadas.IndexOf(LayerNameOf(Camada)) >= 0 then
          AddItem(Saida, CamadaJSON(Camada, LayerNameOf(Camada), '', 0));
    end;
    AddItem(Saida, CamadaJSON(eBottomLayer, 'Bottom', '', 0));
  end;
  Itens.Free;
  Chaves.Free;

  // 2) mecanicas
  for i := 0 to 15 do
  begin
    Camada := eMechanical1 + i;
    if (i = 0) or CamadasOk then
    begin
      Chave := LayerNameOf(Camada);
      if (Usadas.IndexOf(Chave) >= 0) or SondaMecHabilitada(Camada) then
        AddItem(Saida, CamadaJSON(Camada, Chave, '', 0));
    end;
  end;

  // 3) especiais, na ordem das abas do Altium
  AddItem(Saida, CamadaJSON(eTopOverlay, 'TopOverlay', '', 0));
  AddItem(Saida, CamadaJSON(eBottomOverlay, 'BottomOverlay', '', 0));
  if CamadasOk then
  begin
    for Camada := eBottomOverlay + 1 to eBottomOverlay + 4 do
      AddItem(Saida, CamadaJSON(Camada, LayerNameOf(Camada), '', 0));
    AddItem(Saida, CamadaJSON(eKeepOutLayer - 1, 'DrillGuide', '', 0));
  end;
  AddItem(Saida, CamadaJSON(eKeepOutLayer, 'KeepOut', '', 0));
  if CamadasOk then
    AddItem(Saida, CamadaJSON(eMultiLayer - 1, 'DrillDrawing', '', 0));
  AddItem(Saida, CamadaJSON(eMultiLayer, 'Multi', '', 0));
end;

// Acrescenta "chave":valor a uma lista de campos JSON - so se o valor saiu ('' = nao sabido).
procedure CampoNum(var Acc: String; Chave, Valor: String);
begin
  if Valor = '' then
    Exit;
  if Acc <> '' then
    Acc := Acc + ',';
  Acc := Acc + '"' + Chave + '":' + Valor;
end;

// Le as regras da placa (board.js >> rules): o valor da regra de escopo "All" (a regra da
// placa) de cada tipo - sm = SolderMaskExpansion, pm = PasteMaskExpansion, clearance =
// Clearance (Gap), width = Width (a preferida, no Top), viaSize/viaDrill = RoutingVias (os
// preferidos) -, guardados em Rg*. Roda ANTES dos pads: e aqui que a ordem suposta dos tipos de
// regra e conferida pela primeira vez (RegraSuspeita). O JSON sai depois, em RegrasJSON.
//
// O TIPO DA REGRA VEM PELO INTEIRO de RuleKind, e nao pelas constantes eRule_*: constante que
// este arquivo nunca usou e erro de COMPILACAO se nao existir. A ordem do TRuleKind e a
// documentada:
//    0 Clearance, 1 ParallelSegment, 2 MaxMinWidth, 3 MaxMinLength, 4 MatchedLengths,
//    5 DaisyChainStubLength, 6 PowerPlaneConnectStyle, 7 RoutingTopology, 8 RoutingPriority,
//    9 RoutingLayers, 10 RoutingCornerStyle, 11 RoutingVias, 12 PowerPlaneClearance,
//   13 SolderMaskExpansion, 14 PasteMaskExpansion, ...
// e NAO foi medida neste Altium. Tres travas contra ela estar errada: (1) cada valor so sai se
// a propriedade PROPRIA do tipo responder (Gap, FavoredWidth, PreferedHoleWidth...); (2) as duas
// de mascara, que tem a MESMA propriedade Expansion, conferem o nome da regra (NomeContradiz) -
// e se nao conferir, nem a regra nem a mascara por pad saem; (3) o export-report.txt lista de
// qual regra saiu cada valor, para a primeira rodada conferir a olho.
// Tem parametro de proposito: some do menu Run Script.
procedure LeRegrasDaPlaca(Dummy: Integer);
var
  Iter, R: TObject;
  Nm: String;
begin
  RgSm := '';
  RgPm := '';
  RgClear := '';
  RgWidth := '';
  RgViaSize := '';
  RgViaDrill := '';
  RgSmP := 1000000;
  RgPmP := 1000000;
  RgClearP := 1000000;
  RgWidthP := 1000000;
  RgViaP := 1000000;
  Nm := 'eRuleObject (iterador de regras)';
  Iter := nil;
  try
    Iter := Board.BoardIterator_Create;
    Iter.AddFilter_ObjectSet(MkSet(eRuleObject));
    Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
    Iter.AddFilter_Method(eProcessAll);
    R := Iter.FirstPCBObject;
    while R <> nil do
    begin
      LeRegra(R);
      R := Iter.NextPCBObject;
    end;
    AnotaRespostaDeSonda(Nm);
  except
    AnotaFalhaDeSonda(Nm);
  end;
  if Iter <> nil then
    Board.BoardIterator_Destroy(Iter);
end;

// O conteudo de "rules":{...} a partir do que LeRegrasDaPlaca guardou. Montado DEPOIS das duas
// passadas porque a trava da ordem dos tipos (RegraSuspeita) tambem pode disparar num pad: se
// disparou em qualquer ponto, sm e pm da regra nao saem.
// Tem parametro de proposito: some do menu Run Script.
function RegrasJSON(Dummy: Integer): String;
var
  Acc: String;
begin
  if RegraSuspeita then
  begin
    RgSm := '';
    RgPm := '';
  end;
  Acc := '';
  CampoNum(Acc, 'sm', RgSm);
  CampoNum(Acc, 'pm', RgPm);
  CampoNum(Acc, 'clearance', RgClear);
  CampoNum(Acc, 'width', RgWidth);
  CampoNum(Acc, 'viaSize', RgViaSize);
  CampoNum(Acc, 'viaDrill', RgViaDrill);
  Result := Acc;
end;

// Uma linha no export-report.txt E no texto do dialogo final: sao o mesmo texto (o arquivo so
// ganha o cabecalho e o detalhe das regras).
procedure Relata(Rel: TStringList; var Txt: String; Linha: String);
begin
  Rel.Add(Linha);
  Txt := Txt + Linha + #13#10;
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
  // ---- espelho de 2026-10
  FillL, LineL, LayerL, Rel: TStringList;
  FillIdx, LineIdx: Integer;
  TrackAntes, ArcAntes, TextAntes, RegionAntes, CutoutAntes: Integer; // fim da primeira passada
  NNome, NCor: Integer;
  Chave, Linha, RegrasStr: String;
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

  // ---- espelho de 2026-10: o estado das sondas e as contagens nascem ANTES da primeira
  //      passada, porque ela ja sonda (mascara dos pads, tipo dos textos, furos das regions).
  SondaNomes := TStringList.Create;
  SondaQtd := TStringList.Create;
  SondaOk := TStringList.Create;
  Usadas := TStringList.Create;
  Usadas.Sorted := True;
  Usadas.Duplicates := dupIgnore;
  RegrasLidas := TStringList.Create;
  FillL := TStringList.Create;
  LineL := TStringList.Create;
  LayerL := TStringList.Create;
  CamadasOk := CamadasConferem(0);
  PilhaObj := nil;
  RegraSuspeita := False;
  FillIdx := 0;
  LineIdx := 0;
  NPads := 0;
  NPadsTh := 0;
  NPadsPlated := 0;
  NPadsSm := 0;
  NPadsSmd := 0;
  NPadsPm := 0;
  NPadsTent := 0;
  NViasSm := 0;
  NViasTent := 0;
  NTextos := 0;
  NTextosTipo := 0;
  NTextosW := 0;
  NTextosAncora := 0;
  NTextosPoly := 0;
  NTextosPolyGrande := 0;
  NTextosPolyVazio := 0;
  NRegioesFuro := 0;
  NKeepout := 0;
  NPilha := 0;

  // ------------------------------------------------------------------ regras da placa (2026-10)
  // ANTES dos pads: e aqui que a ordem suposta dos tipos de regra e conferida primeiro
  // (RegraSuspeita) - se nao conferir, nenhum pad le mascara por regra.
  LeRegrasDaPlaca(0);

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
            AddItem(SilkL, SilkLineJSON(Prim, 's' + IntToStr(SilkIdx), ''));
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
            AddItem(SilkL, SilkArcJSON(Prim, 's' + IntToStr(SilkIdx), ''));
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
            AddItem(RegionL, ContourJSON(Prim, 'g' + IntToStr(RegionIdx), NetNameOf(Prim), False));
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

  TrackAntes := TrackIdx;
  ArcAntes := ArcIdx;
  TextAntes := TextIdx;
  RegionAntes := RegionIdx;
  CutoutAntes := CutoutIdx;

  // ------------------------------------------------------------------ segunda passada (2026-10)
  // O que a primeira passada nunca leu: fill de TODAS as camadas; trilha, arco, texto e region
  // das camadas que ela deixava de fora (Mid, Plane, mecanicas, Keep-Out, mascara, pasta, Drill
  // Guide/Drawing); polygon fora de Top/Bottom. Vem DEPOIS, numa volta propria, para os ids de
  // hoje nao mudarem: a numeracao de t/a/x/g/k continua de onde a primeira parou, e f<n> e l<n>
  // sao secoes novas. Um changes.js escrito contra o board.js antigo continua casando id por id.
  // O que e da primeira passada fica de fora pela CAMADA (EhPrimeiraPassada): medido nos 18
  // board.js do repositorio, ela so devolve objeto dessas cinco camadas.
  //   trilha/arco de cobre (Mid, Plane) -> tracks/arcs; de outra camada -> lines (formato do silk)
  //   region de cobre fora de polygon -> regions; region que nao e de cobre -> cutouts
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_ObjectSet(MkSet(eTrackObject, eArcObject, eTextObject, eRegionObject, ePolyObject, eFillObject));
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    Chave := LayerNameOf(Prim.Layer);
    if Prim.ObjectId = eFillObject then
    begin
      s := FillJSON(Prim, 'f' + IntToStr(FillIdx + 1));
      if s <> '' then
      begin
        FillIdx := FillIdx + 1;
        AddItem(FillL, s);
        Usadas.Add(Chave);
      end;
    end
    else if Prim.ObjectId = ePolyObject then
    begin
      if (Prim.Layer <> eTopLayer) and (Prim.Layer <> eBottomLayer) then
      begin
        Iter2PolyRegions(Prim, RegionL, RegionIdx);
        Usadas.Add(Chave);
      end;
    end
    else if not EhPrimeiraPassada(Prim.Layer) then
    begin
      if Prim.ObjectId = eTrackObject then
      begin
        if EhCobreKey(Chave) then
        begin
          TrackIdx := TrackIdx + 1;
          AddItem(TrackL, TrackJSON(Prim, 't' + IntToStr(TrackIdx)));
        end
        else
        begin
          LineIdx := LineIdx + 1;
          AddItem(LineL, SilkLineJSON(Prim, 'l' + IntToStr(LineIdx), SondaKeepout(Prim)));
        end;
        Usadas.Add(Chave);
      end
      else if Prim.ObjectId = eArcObject then
      begin
        if EhCobreKey(Chave) then
        begin
          ArcIdx := ArcIdx + 1;
          AddItem(ArcL, ArcJSON(Prim, 'a' + IntToStr(ArcIdx)));
        end
        else
        begin
          LineIdx := LineIdx + 1;
          AddItem(LineL, SilkArcJSON(Prim, 'l' + IntToStr(LineIdx), SondaKeepout(Prim)));
        end;
        Usadas.Add(Chave);
      end
      else if Prim.ObjectId = eTextObject then
      begin
        if not Prim.IsHidden then
        begin
          TextIdx := TextIdx + 1;
          AddItem(TextL, TextJSON(Prim, 'x' + IntToStr(TextIdx)));
          Usadas.Add(Chave);
        end;
      end
      else if Prim.ObjectId = eRegionObject then
      begin
        if (Prim.Kind() = eRegionKind_Copper) and (not Prim.InPolygon()) then
        begin
          RegionIdx := RegionIdx + 1;
          AddItem(RegionL, ContourJSON(Prim, 'g' + IntToStr(RegionIdx), NetNameOf(Prim), False));
          Usadas.Add(Chave);
        end
        else if Prim.Kind() <> eRegionKind_Copper then
        begin
          CutoutIdx := CutoutIdx + 1;
          AddItem(CutoutL, CutoutJSON(Prim, 'k' + IntToStr(CutoutIdx)));
        end;
      end;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);

  // ------------------------------------------------------------------ camadas e regras (2026-10)
  // Depois das duas passadas: a lista de camadas inclui as mecanicas/Mid que tem objeto, e as
  // regras ja sabem se a trava da ordem dos tipos disparou em algum pad.
  CamadasJSON(LayerL);
  RegrasStr := RegrasJSON(0);

  // ------------------------------------------------------------------ montagem do board.js
  OutL := TStringList.Create;
  OutL.Add('var pcbmirror = {');
  OutL.Add('"format":' + JS(FORMAT_ID) + ',');
  OutL.Add('"exporter":' + JS(EXPORTER_ID) + ',');
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

  OutL.Add('"layers":[');
  OutL.AddStrings(LayerL);
  OutL.Add('],');

  OutL.Add('"rules":{' + RegrasStr + '},');

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

  OutL.Add('"fills":[');
  OutL.AddStrings(FillL);
  OutL.Add('],');

  OutL.Add('"lines":[');
  OutL.AddStrings(LineL);
  OutL.Add('],');

  OutL.Add('"stats":{"components":' + IntToStr(CompIdx) + ',"freepads":' + IntToStr(PadIdx) +
    ',"tracks":' + IntToStr(TrackIdx) + ',"arcs":' + IntToStr(ArcIdx) + ',"vias":' + IntToStr(ViaIdx) +
    ',"texts":' + IntToStr(TextIdx) + ',"silk":' + IntToStr(SilkIdx) + ',"regions":' + IntToStr(RegionIdx) +
    ',"cutouts":' + IntToStr(CutoutIdx) + ',"fills":' + IntToStr(FillIdx) + ',"lines":' + IntToStr(LineIdx) + '}');
  OutL.Add('};');

  // ------------------------------------------------------------------ relatorio (dialogo + export-report.txt)
  // O dialogo final e o export-report.txt sao o MESMO texto (Relata escreve nos dois); o arquivo
  // ganha so o cabecalho e, no fim, de qual regra saiu cada valor de "rules".
  NNome := 0;
  NCor := 0;
  for i := 0 to LayerL.Count - 1 do
  begin
    if Pos('"name":', LayerL[i]) > 0 then
      NNome := NNome + 1;
    if Pos('"color":', LayerL[i]) > 0 then
      NCor := NCor + 1;
  end;
  Rel := TStringList.Create;
  Rel.Add('NexoEletric - relatorio do ExportBoard (' + EXPORTER_ID + ')');
  Rel.Add('Placa: ' + Board.FileName);
  Rel.Add('Data:  ' + DateTimeToStr(Now));
  Rel.Add('');
  s := '';
  Relata(Rel, s, 'Exportacao concluida em:');
  Relata(Rel, s, OutDir);
  Relata(Rel, s, '');
  Relata(Rel, s, 'Componentes: ' + IntToStr(CompIdx));
  Relata(Rel, s, 'Trilhas: ' + IntToStr(TrackIdx) + '   Arcos: ' + IntToStr(ArcIdx) + '   Vias: ' + IntToStr(ViaIdx));
  Relata(Rel, s, 'Silk: ' + IntToStr(SilkIdx) + '   Textos: ' + IntToStr(TextIdx) + '   Regioes: ' + IntToStr(RegionIdx));
  Relata(Rel, s, 'Pads livres: ' + IntToStr(PadIdx));
  Relata(Rel, s, '');
  Relata(Rel, s, 'Novo neste espelho (' + EXPORTER_ID + '):');
  Relata(Rel, s, 'Fills: ' + IntToStr(FillIdx) + '   Linhas (mecanica, keep-out, mascara, pasta, furacao): ' +
    IntToStr(LineIdx) + '   Camadas: ' + IntToStr(LayerL.Count));
  Relata(Rel, s, 'Segunda passada: +' + IntToStr(TrackIdx - TrackAntes) + ' trilhas e +' +
    IntToStr(ArcIdx - ArcAntes) + ' arcos de cobre (Mid/Plane), +' + IntToStr(TextIdx - TextAntes) +
    ' textos, +' + IntToStr(RegionIdx - RegionAntes) + ' regioes, +' + IntToStr(CutoutIdx - CutoutAntes) + ' recortes');
  Linha := 'Camadas com nome: ' + IntToStr(NNome) + '   com cor: ' + IntToStr(NCor) + '   pilha de cobre: ';
  if NPilha > 0 then
    Linha := Linha + IntToStr(NPilha) + ' (Top ao Bottom)'
  else
    Linha := Linha + 'nao lida (sem "stack")';
  Relata(Rel, s, Linha);
  if RegrasStr = '' then
    Relata(Rel, s, 'Regras da placa: nenhuma lida')
  else
    Relata(Rel, s, 'Regras da placa (mm): ' + RegrasStr);
  Relata(Rel, s, 'Pads: ' + IntToStr(NPads) + '   mascara efetiva: ' + IntToStr(NPadsSm) +
    '   pasta efetiva: ' + IntToStr(NPadsPm) + ' de ' + IntToStr(NPadsSmd) + ' SMD' +
    '   metalizacao: ' + IntToStr(NPadsPlated) + ' de ' + IntToStr(NPadsTh) + ' passantes' +
    '   tenting: ' + IntToStr(NPadsTent));
  Relata(Rel, s, 'Vias: ' + IntToStr(ViaIdx) + '   mascara efetiva: ' + IntToStr(NViasSm) +
    '   tenting: ' + IntToStr(NViasTent));
  Relata(Rel, s, 'Textos: ' + IntToStr(NTextos) + '   tipo: ' + IntToStr(NTextosTipo) +
    '   largura: ' + IntToStr(NTextosW) + '   ancora: ' + IntToStr(NTextosAncora) +
    '   contorno exato: ' + IntToStr(NTextosPoly) + '   grandes demais para o contorno: ' +
    IntToStr(NTextosPolyGrande) + '   contorno vazio: ' + IntToStr(NTextosPolyVazio));
  Relata(Rel, s, 'Regioes com furo: ' + IntToStr(NRegioesFuro) + '   objetos marcados keepout: ' + IntToStr(NKeepout));
  if not CamadasOk then
    Relata(Rel, s, 'ATENCAO: a numeracao de camadas deste Altium nao e a documentada - as camadas fora das 7 de sempre sairam como L<n>.');
  if RegraSuspeita then
    Relata(Rel, s, 'ATENCAO: o tipo de regra 13/14 nao conferiu com o nome da regra - mascara e pasta pela regra NAO sairam.');
  Relata(Rel, s, '');
  if SondaNomes.Count = 0 then
    Relata(Rel, s, 'Sondas que falharam: nenhuma')
  else
  begin
    Relata(Rel, s, 'Sondas que falharam (' + IntToStr(SondaNomes.Count) + '). Sem resposta, o campo nao saiu; [i] e (i)' +
      ' sao duas formas do mesmo campo, e vale a que respondeu:');
    for i := 0 to SondaNomes.Count - 1 do
    begin
      Linha := '   ' + SondaNomes[i] + ': ' + SondaQtd[i] + ' vez(es)';
      if SondaOk.IndexOf(SondaNomes[i]) >= 0 then
        Linha := Linha + ', mas respondeu em outros objetos'
      else if SafeStrToInt(SondaQtd[i]) >= SONDA_DESISTE then
        Linha := Linha + ', nunca respondeu - desisti dela'
      else
        Linha := Linha + ', nunca respondeu';
      Relata(Rel, s, Linha);
    end;
  end;
  Relata(Rel, s, '');
  Relata(Rel, s, 'Confira no hub.html (vista PCB).');
  // so no arquivo: de onde saiu cada valor de "rules", para conferir a olho na primeira rodada
  Rel.Add('');
  if RegrasLidas.Count = 0 then
    Rel.Add('Regras lidas: nenhuma.')
  else
  begin
    Rel.Add('Regras lidas (vale a de prioridade menor de cada tipo):');
    Rel.AddStrings(RegrasLidas);
  end;
  Rel.Add('');
  Rel.Add('Campo ausente no board.js = nao sabido: a tela e o Gerber caem no padrao e avisam.');
  Rel.Add('Se o Altium recusar o script com "Undeclared identifier: X", veja o bloco SONDAS do ExportBoard.pas.');

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

  // ------------------------------------------------------------------ export-report.txt
  if Gravou then
    Gravou := SalvaOuExplica(Rel, OutDir + '\export-report.txt');

  if Gravou then
    RegenerateProjectsIndex(ProjName);

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
  FillL.Free;
  LineL.Free;
  LayerL.Free;
  Rel.Free;
  Usadas.Free;
  RegrasLidas.Free;
  SondaNomes.Free;
  SondaQtd.Free;
  SondaOk.Free;
end;
