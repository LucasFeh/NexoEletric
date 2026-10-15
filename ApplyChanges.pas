{ ..................................................................................................................... }
{ .  AltiumPCBMirror - ApplyChanges.pas                                                                               . }
{ .                                                                                                                   . }
{ .  Le Projects\<nome do projeto>\changes.js e aplica as mudancas na placa:                                          . }
{ .    comp_move | comp_attr | track_edit | track_add | track_del | via_edit | via_add | via_del |                    . }
{ .    arc_edit | arc_add | arc_del | text_edit | text_add | text_del | designator_move | outline_set |               . }
{ .    fill_add | fill_edit | fill_del | region_add | region_del |                                                    . }
{ .    comp_add | comp_del | pad_net | net_add | net_del | net_rename | pad_add | pad_edit | pad_del |                 . }
{ .    comment_move | poly_add | poly_edit | poly_del   (placa nova e ECO, 2026-10-13; outline_set aceita arco)       . }
{ .  Trilha, arco, fill, region e texto vao para qualquer camada do contrato menos a Multi (ver "Camadas").           . }
{ .  Toda chamada de API que este arquivo ainda nao tinha provado vai em try/except: a RECUSA em tempo de execucao    . }
{ .  vira FALHA ou AVISO no relatorio, dizendo qual chamada. Nome que esta versao do Altium NAO CONHECE e outra       . }
{ .  conversa: derruba a compilacao do arquivo inteiro, com try ou sem try - ver o bloco APOSTAS.                     . }
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

{ ======================================== APOSTAS ======================================== }
{ O DelphiScript confere os NOMES na compilacao. Um nome que esta versao do Altium nao tem -  }
{ constante ou membro, depois do ponto inclusive - impede este arquivo INTEIRO de rodar, e o  }
{ try/except nao ajuda, porque nada rodou ainda. Foi o que IPCB_Region.IsBoardCutout fez ao   }
{ ExportBoard (commit a4db644) e ePortLeft ao ExportProject. E aqui o custo e maior: o        }
{ ApplyProject mora neste arquivo e e a UNICA entrada do menu tambem para o BuildSchematic -  }
{ um nome recusado aqui tira do dono o esquema junto com a placa. Por isso:                   }
{   - nenhuma constante nova: as camadas novas (os CAM_), o tipo fill (OBJ_FILL) e o Kind do  }
{     recorte saem por NUMERO, conferido no comeco da rodada contra as constantes que ja      }
{     rodaram (CamadasNumeradas, ObjetosNumerados);                                           }
{   - objeto e contorno novos em variavel TObject: o nome do membro so precisa existir no     }
{     API, e nao numa interface declarada (IPCB_Region.ArcResolution nao compila no AD24,     }
{     apesar de o nome existir noutra interface);                                             }
{   - cada nome novo mora em poucas funcoes, listadas abaixo.                                 }
{ SE O ALTIUM RECUSAR com "Undeclared identifier: X": ache X abaixo, apague o bloco try da    }
{ funcao indicada (fica o Result do comeco, que e "recusado") e rode de novo. So aquela       }
{ operacao passa a sair como FALHA; o resto - inclusive o esquema - volta a rodar.            }
{                                                                                             }
{   SetOutlineContour ................................. MontaContorno (region_add)           }
{   X1Location Y1Location X2Location Y2Location ....... LeCantosFill e GravaCantosFill       }
{   UseTTFonts ........................................ FonteStroke (text_add)               }
{   --- placa nova e ECO (2026-10-13) ---                                                     }
{   Pattern (escrita), LoadCompFromLibrary,                                                   }
{     LoadCompFromLibraryWithFileName ................. CarregaFootprint (comp_add) - os dois  }
{                                                       metodos MEDIDOS so como nome, na      }
{                                                       tabela do Advpcb.dll do AD21          }
{   Pad.TopXSize/TopYSize/TopShape/BotXSize/BotYSize/BotShape/HoleSize/HoleType/HoleWidth/    }
{     HoleRotation/Name (ESCRITA; a leitura roda no ExportBoard) ... GravaPad (pad_add/edit)  }
{   Pad.Plated (escrita) .............................. GravaMetalizado (pad_add npth)        }
{   ChangeCommentAutoposition ......................... CommentManual (comment_move)          }
{   ArcTan, Sqrt (as primeiras contas de trigonometria dos .pas) ... AnguloDe e ArcoDoBulge    }
{                                                       (outline_set e poly_* com arco)       }
{   Seg.cx/cy/Radius/Angle1/Angle2 (ESCRITA; a leitura roda no ExportBoard) ... GravaSegmentos}
{   PolyHatchStyle, Grid, TrackSize, RemoveDead, PourIndex, Name do polygon ... PropsDoPoligono}
{   Rebuild de polygon (o do BoardOutline ja roda) .... DoPolyAdd, DoPolyEdit                 }
{ Os numeros novos (sem constante, ver acima): SEG_ARCO (TPolySegmentType, conferido contra o  }
{ ePolySegmentLine = 0 no comeco da rodada) e HATCH_* (TPolyHatchStyle, NAO conferido - a      }
{ ordem e a da documentacao). Pad.Net := nil (tirar o pad da net) e comportamento, nao nome:   }
{ esta no try do DoPadNet.                                                                     }
{                                                                                             }
{ Ja rodaram neste repositorio, entao o nome compila (o que falta medir e so o comportamento):}
{ XLocation/YLocation de texto (este arquivo, 2026-08), PCBObjectFactory e Layer (este        }
{ arquivo), Replicate (BuildSchematic), MirrorFlag, Kind(), Component, ObjectId,              }
{ GetMainContour, GetState_PointX/Y, Count, InPolygon, eTextObject, eRegionObject e           }
{ eRegionKind_Copper (ExportBoard).                                                           }

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
  // Numero (TLayer) das camadas que nao tem constante provada neste engine - o porque esta na
  // secao "Camadas". Mid1..Mid30 = 2..31, Plane1..Plane16 = 39..54, Mech1..Mech16 = 57..72.
  CAM_MID1 = 2;
  CAM_TOPPASTE = 35;
  CAM_BOTTOMPASTE = 36;
  CAM_TOPSOLDER = 37;
  CAM_BOTTOMSOLDER = 38;
  CAM_PLANE1 = 39;
  CAM_DRILLGUIDE = 55;
  CAM_MECH1 = 57;
  CAM_DRILLDRAWING = 73;
  // Kind de um Board Cutout quando a placa nao tem nenhum recorte de onde copiar o numero: a
  // posicao dele na lista TRegionKind (Copper 0, Cutout 1, NamedRegion 2, BoardCutout 3,
  // Cavity 4). Medido no AD24 por quem grava uma region de cada Kind e le o arquivo de volta: o
  // KIND salvo vai 0, 1, 2 e 4 - o 3 e o recorte da placa, que o arquivo guarda como KIND=0 com
  // ISBOARDCUTOUT=TRUE (igual aos PcbDoc da casa). NAO foi conferido no Altium 21 - ver
  // KindDoRecorte.
  KIND_RECORTE_PADRAO = 3;
  // Kind do recorte de POLYGON (Polygon Pour Cutout): KIND=1 no arquivo. Ele tambem pode morar
  // na Multi - medido: o PCBM-DI261904 (CBM - DI251876) tem 28 regions na MultiLayer, 18 board
  // cutouts e 10 recortes de polygon -, e nao e furo na placa: KindDoRecorte o deixa de fora.
  KIND_RECORTE_POLIGONO = 1;
  // Numero (TObjectId) do fill, pela POSICAO na lista do PCB API (eNoObject 0, eArcObject 1,
  // ePadObject 2, eViaObject 3, eTrackObject 4, eTextObject 5, eFillObject 6, eConnectionObject
  // 7, eNetObject 8, eComponentObject 9, ePolyObject 10, eRegionObject 11), e nao pelo nome
  // eFillObject: ver APOSTAS. Quem confere a numeracao e ObjetosNumerados, no comeco da rodada.
  OBJ_FILL = 6;
  // Segmento de arco do contorno (TPolySegmentType: Line 0, Arc 1), pelo numero: ver APOSTAS.
  SEG_ARCO = 1;
  // TPolyHatchStyle pela ordem da documentacao (Hatch90 0, Hatch45 1, VHatch 2, HHatch 3,
  // NoHatch 4, Solid 5) - NAO medido: ver APOSTAS.
  HATCH_90 = 0;
  HATCH_45 = 1;
  HATCH_NENHUM = 4;
  HATCH_SOLIDO = 5;
  PI_ = 3.14159265358979;

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
  // [AVISO] do relatorio: nao conta como falha, mas o dialogo final diz quantos sao - e por
  // eles que o dono fica sabendo das sondas desta rodada (ver ApplyChangesInto).
  AvisoCount: Integer;
  ScanInfo: String; // diagnostico do ultimo ListProjectDirs (aparece nos dialogos)
  // Sonda da numeracao das camadas (ver "Camadas"); preenchida no comeco do ApplyChangesInto.
  CamadasNumeradas: Boolean;
  // Sonda da numeracao dos tipos de objeto (OBJ_FILL); preenchida no comeco do ApplyChangesInto.
  ObjetosNumerados: Boolean;
  // O que uma busca nova (FindFill, FindRegion) teve recusado pelo Altium; '' = nada.
  SondaFalhou: String;
  // Kind do Board Cutout desta rodada (KindDoRecorte), perguntado UMA vez: -2 = ainda nao.
  // Uma vez so de proposito: depois do primeiro region_add com cutout, a placa ja tem o
  // recorte que ESTE script criou, e "copiar o numero dele" conferiria o chute com ele mesmo.
  KindRecorteN: Integer;
  KindRecorteOrigem: String;
  KindRecorteConferido: Boolean;
  // Sonda da numeracao do segmento de contorno (SEG_ARCO); preenchida no comeco do ApplyChangesInto.
  SegmentosNumerados: Boolean;

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

// Booleano JSON cru: so a palavra true vale (ausente, false ou outra coisa = False).
function JBool(Line, Key: String): Boolean;
begin
  Result := JGet(Line, Key) = 'true';
end;

// Campo presente E nao vazio. E o "if (ch.layer)" do HubCore: layer:"" num edit quer dizer
// "nao troca a camada", e nao "camada invalida".
function TemValor(Line, Key: String): Boolean;
begin
  Result := False;
  if JHas(Line, Key) then
    Result := JGet(Line, Key) <> '';
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

// Confirmacao digitada (o ApplyChanges chamava ConfirmNoYes sem nunca defini-la,
// o que estouraria no outline_set). Usa so primitivas provadas neste engine.
function ConfirmNoYes(Msg: String): Boolean;
var
  s: String;
begin
  s := Trim(InputBox('NexoEletric', Msg + #13#10#13#10 + 'Digite SIM para confirmar:', ''));
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

// x e y de um vertice 'x|y' do ParsePts
function PtX(P: String): Double;
begin
  Result := StrToFloatDot(Copy(P, 1, Pos('|', P) - 1));
end;

function PtY(P: String): Double;
begin
  Result := StrToFloatDot(Copy(P, Pos('|', P) + 1, 255));
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

// [a1,a2] e [b1,b2] sao o mesmo intervalo, com as pontas em qualquer ordem (tolerancia TOL_MM).
// E como o fill e achado: o mesmo retangulo escrito com os cantos trocados e o mesmo fill.
function MesmoIntervalo(a1, a2, b1, b2: Double): Boolean;
var
  amin, amax, bmin, bmax: Double;
begin
  amin := a1;
  amax := a2;
  if a2 < a1 then
  begin
    amin := a2;
    amax := a1;
  end;
  bmin := b1;
  bmax := b2;
  if b2 < b1 then
  begin
    bmin := b2;
    bmax := b1;
  end;
  Result := NearMM(amin, bmin) and NearMM(amax, bmax);
end;

{ ..................................................................................................................... }
{ .                                                     Camadas                                                       . }
{ ..................................................................................................................... }

// As chaves sao as do contrato (board.js / changes.js), as mesmas do HubCore.PCB_LAYERS:
//   Top, Mid1..Mid30, Bottom, Plane1..Plane16, TopOverlay, BottomOverlay, TopPaste, BottomPaste,
//   TopSolder, BottomSolder, DrillGuide, KeepOut, DrillDrawing, Multi, Mech1..Mech16.
//
// As 7 de sempre (Top, Bottom, TopOverlay, BottomOverlay, Multi, Mech1, KeepOut) continuam pelas
// constantes nomeadas que este arquivo ja usava: comportamento identico ao de antes.
//
// As outras saem POR CONTA, do numero da camada: o TLayer do Altium e o mesmo id de camada do
// .PcbDoc (Top 1, Mid 2..31, Bottom 32, TopOverlay 33, BottomOverlay 34, Paste 35/36, Solder
// 37/38, Plane 39..54, DrillGuide 55, KeepOut 56, Mech 57..72, DrillDrawing 73, Multi 74). Por
// conta, e nao por eMidLayer1/eInternalPlane1/eTopPaste...: constante nomeada que esta versao
// nao declare e "Undeclared identifier" NA COMPILACAO - derrubaria o script inteiro, inclusive
// as ops que sempre funcionaram (foi o que aconteceu com as constantes da port no esquema).
// A conta so vale se a numeracao for mesmo essa, e quem confere e CamadasNumeradas, no comeco
// do ApplyChangesInto, pelas 7 constantes provadas. Se alguma nao bater, as camadas novas
// ficam recusadas (LayerFromName devolve 0) e o relatorio abre com um [AVISO] dizendo por que.

// Numero no fim de uma chave ('Mid12' a partir da posicao 4 -> 12). 0 = nao e numero, ou
// comeca com zero ('Mid01' nao e chave da tabela).
function NumDaChave(Name: String; Desde: Integer): Integer;
var
  s: String;
begin
  Result := 0;
  s := Copy(Name, Desde, Length(Name));
  if s = '' then
    Exit;
  if s[1] = '0' then
    Exit;
  Result := SafeStrToInt(s);
end;

// Chave do contrato -> TLayer. 0 = chave desconhecida (ou camada nova com a numeracao recusada).
function LayerFromName(Name: String): TLayer;
var
  n: Integer;
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
  if Result <> 0 then
    Exit;
  if not CamadasNumeradas then
    Exit;

  if Name = 'TopPaste' then
    Result := CAM_TOPPASTE
  else if Name = 'BottomPaste' then
    Result := CAM_BOTTOMPASTE
  else if Name = 'TopSolder' then
    Result := CAM_TOPSOLDER
  else if Name = 'BottomSolder' then
    Result := CAM_BOTTOMSOLDER
  else if Name = 'DrillGuide' then
    Result := CAM_DRILLGUIDE
  else if Name = 'DrillDrawing' then
    Result := CAM_DRILLDRAWING
  else if Copy(Name, 1, 3) = 'Mid' then
  begin
    n := NumDaChave(Name, 4);
    if (n >= 1) and (n <= 30) then
      Result := CAM_MID1 + n - 1;
  end
  else if Copy(Name, 1, 5) = 'Plane' then
  begin
    n := NumDaChave(Name, 6);
    if (n >= 1) and (n <= 16) then
      Result := CAM_PLANE1 + n - 1;
  end
  else if Copy(Name, 1, 4) = 'Mech' then
  begin
    // Mech1 ja saiu la em cima, pela constante provada
    n := NumDaChave(Name, 5);
    if (n >= 2) and (n <= 16) then
      Result := CAM_MECH1 + n - 1;
  end;
end;

// TLayer -> chave do contrato. Camada fora da tabela sai 'L<numero>', como sempre saiu.
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
  else if not CamadasNumeradas then
    Result := 'L' + IntToStr(L)
  else if (L >= CAM_MID1) and (L <= CAM_MID1 + 29) then
    Result := 'Mid' + IntToStr(L - CAM_MID1 + 1)
  else if L = CAM_TOPPASTE then
    Result := 'TopPaste'
  else if L = CAM_BOTTOMPASTE then
    Result := 'BottomPaste'
  else if L = CAM_TOPSOLDER then
    Result := 'TopSolder'
  else if L = CAM_BOTTOMSOLDER then
    Result := 'BottomSolder'
  else if (L >= CAM_PLANE1) and (L <= CAM_PLANE1 + 15) then
    Result := 'Plane' + IntToStr(L - CAM_PLANE1 + 1)
  else if L = CAM_DRILLGUIDE then
    Result := 'DrillGuide'
  else if (L > CAM_MECH1) and (L <= CAM_MECH1 + 15) then
    Result := 'Mech' + IntToStr(L - CAM_MECH1 + 1)
  else if L = CAM_DRILLDRAWING then
    Result := 'DrillDrawing'
  else
    Result := 'L' + IntToStr(L);
end;

// Cobre = sinal (Top, Mid1..30, Bottom) ou plano (Plane1..16), como o HubCore.isCopper. A Multi
// NAO conta: pad e via passante sao outra conversa. E so no cobre que net faz sentido.
function EhCobre(L: TLayer): Boolean;
begin
  Result := (L = eTopLayer) or (L = eBottomLayer);
  if Result then
    Exit;
  if not CamadasNumeradas then
    Exit;
  Result := ((L >= CAM_MID1) and (L <= CAM_MID1 + 29)) or ((L >= CAM_PLANE1) and (L <= CAM_PLANE1 + 15));
end;

// Filtro de camada dos iteradores de busca. Top, Bottom, TopOverlay e BottomOverlay continuam
// pelo MkSet(L), o caminho de sempre (o unico que ja rodou neste engine com trilha, arco e
// texto). As outras vao pelo AllLayers - o filtro do FindVia e do FindComponent - e quem separa
// a camada e o laco de cada busca, por Prim.Layer = L: um MkSet de camada mecanica, de pasta ou
// de mascara nunca rodou aqui, e um filtro que nao devolvesse nada seria indistinguivel de "o
// objeto nao esta na placa".
procedure FiltraCamada(Iter: TObject; L: TLayer);
begin
  if (L = eTopLayer) or (L = eBottomLayer) or (L = eTopOverlay) or (L = eBottomOverlay) then
    Iter.AddFilter_LayerSet(MkSet(L))
  else
    Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
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

// Designator do componente dono do primitivo; '' = solto. E o Prim.Component que o ExportBoard
// le para o "owner" de trilha, arco e texto. Em try porque fill e region nunca passaram por ele
// aqui: se o Altium recusar, o primitivo vale como solto - que e como FindTrack, FindArc e
// FindFreeText sempre trataram todo mundo.
function DonoDe(Prim: TObject): String;
var
  C: TObject;
begin
  Result := '';
  try
    C := Prim.Component;
    if C <> nil then
    begin
      Result := C.Name.Text;
      if Result = '' then
        Result := '?';
    end;
  except
    Result := '';
  end;
end;

// Trilha cujo (x1,y1)-(x2,y2)/largura/camada casam com os orig_* (qualquer direcao).
// SoLivre: so trilha solta, fora de componente (ver RequireTrackOrig).
function FindTrack(L: TLayer; X1, Y1, X2, Y2, W: Double; SoLivre: Boolean): IPCB_Track;
var
  Iter, Prim: TObject;
  ax1, ay1, ax2, ay2: Double;
  DirectHit, ReverseHit, Casa: Boolean;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eTrackObject));
  FiltraCamada(Iter, L);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    Casa := False;
    if Prim.Layer = L then
    begin
      ax1 := XMM(Prim.X1);
      ay1 := YMM(Prim.Y1);
      ax2 := XMM(Prim.X2);
      ay2 := YMM(Prim.Y2);
      DirectHit := NearMM(ax1, X1) and NearMM(ay1, Y1) and NearMM(ax2, X2) and NearMM(ay2, Y2);
      ReverseHit := NearMM(ax1, X2) and NearMM(ay1, Y2) and NearMM(ax2, X1) and NearMM(ay2, Y1);
      Casa := (DirectHit or ReverseHit) and NearMM(CoordToMMs(Prim.Width), W);
      if Casa and SoLivre then
        Casa := DonoDe(Prim) = '';
    end;
    if Casa then
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

// Arco cujo centro/raio/angulos/camada casam com os orig_*. SoLivre: como no FindTrack.
function FindArc(L: TLayer; cx, cy, r, sa, ea: Double; SoLivre: Boolean): IPCB_Arc;
var
  Iter, Prim: TObject;
  Casa: Boolean;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eArcObject));
  FiltraCamada(Iter, L);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    Casa := False;
    if Prim.Layer = L then
    begin
      Casa := NearMM(XMM(Prim.XCenter), cx) and NearMM(YMM(Prim.YCenter), cy) and
        NearMM(CoordToMMs(Prim.Radius), r) and NearAngle(Prim.StartAngle, sa) and
        NearAngle(Prim.EndAngle, ea);
      if Casa and SoLivre then
        Casa := DonoDe(Prim) = '';
    end;
    if Casa then
    begin
      Result := Prim;
      break;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

// Texto livre (nao designator/comment de footprint) cujo CENTRO do bounding box e o
// conteudo casam com os orig_* do board.js (o x/y exportado e o centro do bounding box).
// SoLivre: so texto fora de componente. O text_edit passa False (texto extra de footprint que
// nao e designator nem comment sempre foi editavel); o text_del passa True.
function FindFreeText(L: TLayer; X, Y: Double; Txt: String; SoLivre: Boolean): IPCB_Text;
var
  Iter, Prim: TObject;
  cx, cy: Double;
  Casa: Boolean;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eTextObject));
  FiltraCamada(Iter, L);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    Casa := False;
    if (Prim.Layer = L) and (not Prim.IsDesignator) and (not Prim.IsComment) and (Prim.Text = Txt) then
    begin
      cx := (XMM(Prim.BoundingRectangleForSelection.Left) + XMM(Prim.BoundingRectangleForSelection.Right)) / 2;
      cy := (YMM(Prim.BoundingRectangleForSelection.Bottom) + YMM(Prim.BoundingRectangleForSelection.Top)) / 2;
      Casa := NearMM(cx, X) and NearMM(cy, Y);
      if Casa and SoLivre then
        Casa := DonoDe(Prim) = '';
    end;
    if Casa then
    begin
      Result := Prim;
      break;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

// APOSTA (ver APOSTAS): os cantos de um fill SEM rotacao, em mm relativos a origem - os
// X1Location..Y2Location que o ExportBoard grava em x1..y2. False = o Altium recusou a leitura.
// Estes quatro nomes moram so aqui e em GravaCantosFill.
function LeCantosFill(Fill: TObject; var X1, Y1, X2, Y2: Double): Boolean;
begin
  Result := False;
  try
    X1 := XMM(Fill.X1Location);
    Y1 := YMM(Fill.Y1Location);
    X2 := XMM(Fill.X2Location);
    Y2 := YMM(Fill.Y2Location);
    Result := True;
  except
    Result := False;
  end;
end;

// APOSTA (ver APOSTAS): escreve os cantos de um fill. False = o Altium recusou a escrita.
function GravaCantosFill(Fill: TObject; X1, Y1, X2, Y2: Double): Boolean;
begin
  Result := False;
  try
    Fill.X1Location := MMX(X1);
    Fill.Y1Location := MMY(Y1);
    Fill.X2Location := MMX(X2);
    Fill.Y2Location := MMY(Y2);
    Result := True;
  except
    Result := False;
  end;
end;

// Fill pela camada + os dois cantos SEM rotacao (X1Location..Y2Location), em qualquer ordem: o
// mesmo retangulo escrito ao contrario e o mesmo fill (como no HubCore). A rotacao nao entra na
// busca - o contrato nao tem orig_rot. Ler os cantos de um fill e novo neste arquivo: uma recusa
// interrompe o laco e fica em SondaFalhou, para quem chamou dizer o que foi. O tipo fill vai pelo
// numero (OBJ_FILL), e so quando a sonda ObjetosNumerados confirmou a numeracao.
function FindFill(L: TLayer; X1, Y1, X2, Y2: Double; SoLivre: Boolean): TObject;
var
  Iter, Prim: TObject;
  Casa, Recusou: Boolean;
  ax1, ay1, ax2, ay2: Double;
begin
  Result := nil;
  if not ObjetosNumerados then
  begin
    SondaFalhou := 'o numero do tipo fill (a numeracao dos tipos de objeto desta versao nao e a ' +
      'esperada - ver o [AVISO] no comeco do relatorio)';
    Exit;
  end;
  Recusou := False;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(OBJ_FILL));
  FiltraCamada(Iter, L);
  Iter.AddFilter_Method(eProcessAll);
  try
    Prim := Iter.FirstPCBObject;
    while Prim <> nil do
    begin
      Casa := False;
      if Prim.Layer = L then
      begin
        if LeCantosFill(Prim, ax1, ay1, ax2, ay2) then
        begin
          Casa := MesmoIntervalo(ax1, ax2, X1, X2) and MesmoIntervalo(ay1, ay2, Y1, Y2);
          if Casa and SoLivre then
            Casa := DonoDe(Prim) = '';
        end
        else
          Recusou := True;
      end;
      if Casa or Recusou then
      begin
        if Casa then
          Result := Prim;
        Prim := nil;
      end
      else
        Prim := Iter.NextPCBObject;
    end;
  except
    Result := nil;
    Recusou := True;
  end;
  Board.BoardIterator_Destroy(Iter);
  if Recusou then
  begin
    Result := nil;
    SondaFalhou := 'a leitura dos cantos do fill (X1Location..Y2Location)';
  end;
end;

// Kind da region como inteiro; -1 = a leitura foi recusada. Prim.Kind() e a leitura que o
// ExportBoard ja faz em toda region.
function LeKind(Prim: TObject): Integer;
begin
  Result := -1;
  try
    Result := Prim.Kind();
  except
    Result := -1;
  end;
end;

// Region "livre": solida (Kind de cobre - que e o Kind de toda region normal, seja de cobre,
// de silk ou de mascara), fora de polygon despejado e fora de componente.
function RegionLivre(Prim: TObject): Boolean;
begin
  Result := False;
  if LeKind(Prim) <> eRegionKind_Copper then
    Exit;
  if Prim.InPolygon() then
    Exit;
  Result := DonoDe(Prim) = '';
end;

// Por que uma region que casou com os orig_* nao pode ser apagada por aqui.
function MotivoRegionPresa(Prim: TObject): String;
var
  Dono: String;
begin
  Result := 'nao e region livre';
  Dono := DonoDe(Prim);
  try
    if Prim.InPolygon() then
      Result := 'e pedaco de polygon despejado - o Altium redespeja; apague ou edite o polygon no Altium'
    else if Dono <> '' then
      Result := 'pertence ao componente ' + Dono + ' (edite o footprint no Altium)'
    else if LeKind(Prim) <> eRegionKind_Copper then
      Result := 'nao e region solida (Kind ' + IntToStr(LeKind(Prim)) +
        ': recorte, cavidade...) - remova no Altium';
  except
    Result := 'nao e region livre';
  end;
end;

// Region pela camada + numero de vertices + 1o vertice do contorno principal: o board.js grava
// o GetMainContour inteiro em "points", e o contrato manda orig_n (quantos) e orig_x0/orig_y0
// (o primeiro). SoLivre: so region livre (RegionLivre). As leituras sao as do ExportBoard, mas
// o laco vai em try do mesmo jeito: uma recusa aqui nao pode derrubar a aplicacao inteira.
function FindRegion(L: TLayer; N: Integer; X0, Y0: Double; SoLivre: Boolean): TObject;
var
  Iter, Prim: TObject;
  C: IPCB_Contour;
  Casa: Boolean;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eRegionObject));
  FiltraCamada(Iter, L);
  Iter.AddFilter_Method(eProcessAll);
  try
    Prim := Iter.FirstPCBObject;
    while Prim <> nil do
    begin
      Casa := False;
      if Prim.Layer = L then
      begin
        C := Prim.GetMainContour();
        if C.Count = N then
          Casa := NearMM(XMM(C.GetState_PointX(0)), X0) and NearMM(YMM(C.GetState_PointY(0)), Y0);
        if Casa and SoLivre then
          Casa := RegionLivre(Prim);
      end;
      if Casa then
      begin
        Result := Prim;
        Prim := nil;
      end
      else
        Prim := Iter.NextPCBObject;
    end;
  except
    Result := nil;
    SondaFalhou := 'a leitura do contorno das regions (GetMainContour)';
  end;
  Board.BoardIterator_Destroy(Iter);
end;

// A "Board Region" (a forma da placa, do storage BoardRegions) chega neste API como region na
// Multi com Kind diferente de cobre - igual a um recorte -, e nao e furo: e a placa inteira
// (nos board.js de hoje, o "recorte" de 4 a 173 pontos do tamanho do contorno). Separa pelo
// tamanho: o contorno principal cobre pelo menos 90% da largura E da altura da placa.
function EhRegiaoDaPlaca(Prim: TObject): Boolean;
var
  C: IPCB_Contour;
  k: Integer;
  x, y, MinX, MinY, MaxX, MaxY, BW, BH: Double;
begin
  Result := False;
  C := Prim.GetMainContour();
  if C.Count < 1 then
    Exit;
  MinX := XMM(C.GetState_PointX(0));
  MaxX := MinX;
  MinY := YMM(C.GetState_PointY(0));
  MaxY := MinY;
  for k := 1 to C.Count - 1 do
  begin
    x := XMM(C.GetState_PointX(k));
    y := YMM(C.GetState_PointY(k));
    if x < MinX then
      MinX := x;
    if x > MaxX then
      MaxX := x;
    if y < MinY then
      MinY := y;
    if y > MaxY then
      MaxY := y;
  end;
  BW := CoordToMMs(Board.BoardOutline.BoundingRectangle.Right - Board.BoardOutline.BoundingRectangle.Left);
  BH := CoordToMMs(Board.BoardOutline.BoundingRectangle.Top - Board.BoardOutline.BoundingRectangle.Bottom);
  if (BW <= 0) or (BH <= 0) then
    Exit;
  Result := ((MaxX - MinX) >= 0.9 * BW) and ((MaxY - MinY) >= 0.9 * BH);
end;

// O inteiro do Kind de um Board Cutout NESTA instalacao. A pergunta existe porque este API nao
// tem IsBoardCutout (ver ExportBoard) e a constante nomeada do Kind de recorte nunca foi
// conferida aqui - e constante que nao existe derruba o script inteiro na compilacao.
//
//   1) copia de um recorte que JA esta na placa: region na Multi (e la que este API reporta o
//      Board Cutout, apesar de LAYER=KEEPOUT no arquivo - ver ExportBoard), Kind diferente de
//      cobre e do recorte de polygon (KIND_RECORTE_POLIGONO, que tambem mora na Multi em placa
//      da casa), fora de componente e MENOR que a placa (EhRegiaoDaPlaca);
//   2) placa sem recorte: KIND_RECORTE_PADRAO, a posicao do Board Cutout na lista TRegionKind.
//      Conferido = False, e o relatorio diz isso na linha da op.
// Recortes da placa com Kinds diferentes entre si: vale o KIND_RECORTE_PADRAO se algum deles o
// tem (o numero esperado, e a placa o confirma); senao -1, que nao ha como escolher sem chutar.
function KindDoRecorte(var Origem: String; var Conferido: Boolean): Integer;
var
  Iter, Prim: TObject;
  k, Primeiro, Iguais, Outros, ComPadrao, DePoligono: Integer;
  Leu: Boolean;
  Nota: String;
begin
  Result := -1;
  Conferido := False;
  Primeiro := -1;
  Iguais := 0;
  Outros := 0;
  ComPadrao := 0;
  DePoligono := 0;
  Leu := True;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eRegionObject));
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_Method(eProcessAll);
  try
    Prim := Iter.FirstPCBObject;
    while Prim <> nil do
    begin
      if Prim.Layer = eMultiLayer then
      begin
        k := LeKind(Prim);
        if k = KIND_RECORTE_POLIGONO then
          DePoligono := DePoligono + 1
        else if (k >= 0) and (k <> eRegionKind_Copper) and (DonoDe(Prim) = '') then
        begin
          if not EhRegiaoDaPlaca(Prim) then
          begin
            if k = KIND_RECORTE_PADRAO then
              ComPadrao := ComPadrao + 1;
            if Primeiro < 0 then
              Primeiro := k;
            if k = Primeiro then
              Iguais := Iguais + 1
            else
              Outros := Outros + 1;
          end;
        end;
      end;
      Prim := Iter.NextPCBObject;
    end;
  except
    Leu := False;
  end;
  Board.BoardIterator_Destroy(Iter);

  Nota := '';
  if DePoligono > 0 then
    Nota := ' (' + IntToStr(DePoligono) + ' recorte(s) de polygon na Multi ficaram de fora: nao sao furo na placa)';
  if not Leu then
  begin
    Result := KIND_RECORTE_PADRAO;
    Origem := 'Kind ' + IntToStr(Result) + ' NAO conferido: a leitura dos recortes da placa foi recusada';
  end
  else if Iguais = 0 then
  begin
    Result := KIND_RECORTE_PADRAO;
    Origem := 'Kind ' + IntToStr(Result) + ' NAO conferido: a placa nao tinha recorte de onde copiar o numero' +
      Nota;
  end
  else if Outros = 0 then
  begin
    Result := Primeiro;
    Conferido := True;
    Origem := 'Kind ' + IntToStr(Result) + ', copiado de ' + IntToStr(Iguais) + ' recorte(s) da placa' + Nota;
  end
  else if ComPadrao > 0 then
  begin
    Result := KIND_RECORTE_PADRAO;
    Conferido := True;
    Origem := 'Kind ' + IntToStr(Result) + ', o de ' + IntToStr(ComPadrao) + ' recorte(s) da placa (outros ' +
      IntToStr(Iguais + Outros - ComPadrao) + ' com Kind diferente)' + Nota;
  end
  else
  begin
    Result := -1;
    Origem := IntToStr(Iguais) + ' recorte(s) da placa com Kind ' + IntToStr(Primeiro) + ' e ' +
      IntToStr(Outros) + ' com outro Kind - nao ha como escolher sem chutar' + Nota;
  end;
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

// Aviso nao conta como falha: a mudanca foi aplicada, com uma ressalva que o usuario precisa ler.
// O dialogo final mostra quantos foram (AvisoCount), para ninguem deixar de abrir o relatorio.
procedure LogAviso(Msg: String);
begin
  AvisoCount := AvisoCount + 1;
  Report.Add('[AVISO] ' + Msg);
end;

// Junta mais um problema na lista de uma op ("a; b; c"), para o relatorio dizer numa linha so
// tudo o que nao pegou.
procedure MaisProblema(var Lista: String; Msg: String);
begin
  if Lista <> '' then
    Lista := Lista + '; ';
  Lista := Lista + Msg;
end;

{ ..................................................................................................................... }
{ .                                Objetos novos: camada de destino, espelho, fonte                                   . }
{ ..................................................................................................................... }

// Camada de destino de um objeto novo ou editado: tem de ser chave da tabela, e a Multi e so
// de pad e via - o Altium nao tem trilha, fill, region ou texto "passante" (o HubCore recusa
// igual). 0 = recusada, e a FALHA ja saiu no relatorio com o nome da op.
function CamadaDeDestino(Nome, What, Oque: String): TLayer;
var
  Nota: String;
begin
  Result := LayerFromName(Nome);
  if Result = 0 then
  begin
    Nota := '';
    if not CamadasNumeradas then
      Nota := ' - nesta versao do Altium so Top, Bottom, TopOverlay, BottomOverlay, Mech1 e KeepOut ' +
        'estao liberadas (ver o [AVISO] no comeco do relatorio)';
    LogFail(What + ': camada invalida "' + Nome + '" (use uma chave da tabela: Top, Bottom, Mid1..30, ' +
      'Plane1..16, TopOverlay, BottomOverlay, TopPaste, BottomPaste, TopSolder, BottomSolder, DrillGuide, ' +
      'KeepOut, DrillDrawing, Mech1..16)' + Nota);
    Exit;
  end;
  if Result = eMultiLayer then
  begin
    LogFail(What + ': ' + Oque + ' nao pode ficar na Multi-Layer (ela e so de pad e via)');
    Result := 0;
  end;
end;

// Espelho do texto. LER o MirrorFlag e provado (o ExportBoard le); ESCREVER e novo, entao vai em
// try e e conferido relendo. So escreve quando o pedido difere do que o texto ja tem.
// False = o texto NAO ficou como pedido.
function AplicaEspelho(Txt: TObject; Quer: Boolean): Boolean;
begin
  Result := False;
  try
    if Txt.MirrorFlag <> Quer then
      Txt.MirrorFlag := Quer;
    Result := Txt.MirrorFlag = Quer;
  except
    Result := False;
  end;
end;

// Objeto que saiu da fabrica e NAO vai para a placa (uma etapa foi recusada) fica so na memoria
// ate o Altium fechar: fora da placa, sem registro no undo, sem efeito nenhum no PcbDoc. Nao ha
// "descarte" de proposito - PCBServer.DestroyPCBObject seria um nome novo (aposta de
// compilacao, ver APOSTAS) para ganho nenhum.

// APOSTA (ver APOSTAS): fonte stroke num texto novo. O eCreate_Default traz a fonte das
// Preferences > Default Primitives, que pode estar em TrueType. False = recusado.
function FonteStroke(Txt: TObject): Boolean;
begin
  Result := False;
  try
    Txt.UseTTFonts := False;
    Result := not Txt.UseTTFonts;
  except
    Result := False;
  end;
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
  X1, Y1, X2, Y2, W: Double;
  Dono: IPCB_Track;
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
  X1 := JNum(Line, 'orig_x1');
  Y1 := JNum(Line, 'orig_y1');
  X2 := JNum(Line, 'orig_x2');
  Y2 := JNum(Line, 'orig_y2');
  W := JNum(Line, 'orig_w');
  // A solta primeiro. Sem solta, a do componente: no COBRE ela vale, como sempre valeu (o hub
  // de antes mandava track_edit de trilha de footprint, e changes.js antigo nao pode deixar de
  // aplicar); FORA do cobre o contrato a recusa - silk e linha mecanica de footprint sao do
  // componente, e mexer numa delas sozinha desmancha o desenho dele.
  Result := FindTrack(L, X1, Y1, X2, Y2, W, True);
  if Result <> nil then
    Exit;
  Dono := FindTrack(L, X1, Y1, X2, Y2, W, False);
  if Dono = nil then
    LogFail(What + ': trilha original nao encontrada na placa (re-exporte o espelho)')
  else if EhCobre(L) then
    Result := Dono
  else
    LogFail(What + ': a trilha pertence ao componente ' + DonoDe(Dono) +
      ' (so linha solta e editavel sozinha; edite o footprint no Altium)');
end;

procedure DoTrackEdit(Line: String);
var
  Track: IPCB_Track;
  What, NetStr: String;
  Destino: TLayer;
  Net: IPCB_Net;
  CamadaOk: Boolean;
begin
  What := 'track_edit ' + JGet(Line, 'id');
  // A camada nova e conferida ANTES de mexer em qualquer coisa: camada recusada recusa a
  // mudanca inteira, em vez de mover a trilha e deixa-la na camada velha. (layer:"" e "nao
  // troca", como no HubCore - ver TemValor.)
  Destino := 0;
  if TemValor(Line, 'layer') then
  begin
    Destino := CamadaDeDestino(JGet(Line, 'layer'), What, 'trilha');
    if Destino = 0 then
      Exit;
  end;
  Track := RequireTrackOrig(Line, What);
  if Track = nil then
    Exit;
  if Destino = 0 then
    Destino := Track.Layer;

  CamadaOk := True;
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
  // Top/Bottom e o caminho de sempre; as outras camadas sao numero calculado (ver "Camadas"),
  // entao a escrita vai protegida - e conferida relendo, no fim.
  if TemValor(Line, 'layer') then
  begin
    try
      Track.Layer := Destino;
    except
      CamadaOk := False;
    end;
  end;
  // Net so no cobre. A net que a trilha ja tinha fica com ela quando ela sai do cobre: o Altium
  // nao liga objeto fora das camadas eletricas, e o HubCore tambem nao apaga a net do eff.
  if JHas(Line, 'net') then
  begin
    NetStr := JGet(Line, 'net');
    if not EhCobre(Destino) then
    begin
      if NetStr <> '' then
        LogAviso(What + ': net "' + NetStr + '" so vale em camada de cobre - ignorada');
    end
    else
    begin
      Net := FindNet(NetStr);
      if Net <> nil then
        Track.Net := Net
      else if NetStr <> '' then
        LogAviso(What + ': net "' + NetStr + '" nao existe na placa - a trilha ficou com a net que tinha');
    end;
  end;
  PCBServer.SendMessageToRobots(Track.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Track.GraphicallyInvalidate;
  if not CamadaOk then
    LogFail(What + ': o Altium recusou a camada ' + JGet(Line, 'layer') + ' - o resto da mudanca foi ' +
      'aplicado e a trilha ficou na ' + LayerNameOf(Track.Layer))
  else if TemValor(Line, 'layer') and (Track.Layer <> Destino) then
    LogFail(What + ': a camada nao pegou (pedida ' + JGet(Line, 'layer') + ', ficou ' +
      LayerNameOf(Track.Layer) + ') - o resto da mudanca foi aplicado')
  else
    LogOk(What);
end;

procedure DoTrackAdd(Line: String);
var
  Track: IPCB_Track;
  L: TLayer;
  Net: IPCB_Net;
  NetStr: String;
  CamadaOk: Boolean;
begin
  // qualquer camada da tabela menos a Multi (o contrato); net so no cobre
  L := CamadaDeDestino(JGet(Line, 'layer'), 'track_add', 'trilha');
  if L = 0 then
    Exit;
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
  // Top/Bottom e o caminho de sempre; as outras camadas sao numero calculado: escrita protegida
  // e conferida relendo, antes de a trilha ir para a placa
  CamadaOk := True;
  try
    Track.Layer := L;
    CamadaOk := Track.Layer = L;
  except
    CamadaOk := False;
  end;
  if not CamadaOk then
  begin
    // a trilha so nao vai para a placa (objeto fora da placa nao tem efeito - ver o comentario
    // antes de FonteStroke)
    LogFail('track_add: o Altium recusou a camada ' + JGet(Line, 'layer') + ' (ou ela nao pegou) - nada foi criado');
    Exit;
  end;

  NetStr := JGet(Line, 'net');
  if NetStr <> '' then
  begin
    if not EhCobre(L) then
      LogAviso('track_add: net "' + NetStr + '" so vale em camada de cobre - ignorada')
    else
    begin
      Net := FindNet(NetStr);
      if Net <> nil then
        Track.Net := Net
      else
        LogAviso('track_add: net "' + NetStr + '" nao existe na placa - trilha criada sem net');
    end;
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
      LogAviso('via_add: net "' + NetStr + '" nao existe na placa - via criada sem net');
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
  cx, cy, r, sa, ea: Double;
  Dono: IPCB_Arc;
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
  cx := JNum(Line, 'orig_cx');
  cy := JNum(Line, 'orig_cy');
  r := JNum(Line, 'orig_r');
  sa := JNum(Line, 'orig_sa');
  ea := JNum(Line, 'orig_ea');
  // a mesma regra do RequireTrackOrig: solto primeiro; o do componente so vale no cobre
  Result := FindArc(L, cx, cy, r, sa, ea, True);
  if Result <> nil then
    Exit;
  Dono := FindArc(L, cx, cy, r, sa, ea, False);
  if Dono = nil then
    LogFail(What + ': arco original nao encontrado na placa (re-exporte o espelho)')
  else if EhCobre(L) then
    Result := Dono
  else
    LogFail(What + ': o arco pertence ao componente ' + DonoDe(Dono) +
      ' (so arco solto e editavel sozinho; edite o footprint no Altium)');
end;

procedure DoArcEdit(Line: String);
var
  Arc: IPCB_Arc;
  What: String;
  Destino: TLayer;
  CamadaOk: Boolean;
begin
  What := 'arc_edit ' + JGet(Line, 'id');
  // camada nova conferida antes de mexer (ver DoTrackEdit)
  Destino := 0;
  if TemValor(Line, 'layer') then
  begin
    Destino := CamadaDeDestino(JGet(Line, 'layer'), What, 'arco');
    if Destino = 0 then
      Exit;
  end;
  Arc := RequireArcOrig(Line, What);
  if Arc = nil then
    Exit;

  CamadaOk := True;
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
  // camada: escrita protegida e conferida relendo, como no DoTrackEdit (o arc_edit do contrato
  // nao tem net; a que o arco ja tinha fica com ele)
  if TemValor(Line, 'layer') then
  begin
    try
      Arc.Layer := Destino;
    except
      CamadaOk := False;
    end;
  end;
  PCBServer.SendMessageToRobots(Arc.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Arc.GraphicallyInvalidate;
  if not CamadaOk then
    LogFail(What + ': o Altium recusou a camada ' + JGet(Line, 'layer') + ' - o resto da mudanca foi ' +
      'aplicado e o arco ficou na ' + LayerNameOf(Arc.Layer))
  else if TemValor(Line, 'layer') and (Arc.Layer <> Destino) then
    LogFail(What + ': a camada nao pegou (pedida ' + JGet(Line, 'layer') + ', ficou ' +
      LayerNameOf(Arc.Layer) + ') - o resto da mudanca foi aplicado')
  else
    LogOk(What);
end;

procedure DoArcAdd(Line: String);
var
  Arc: IPCB_Arc;
  L: TLayer;
  Net: IPCB_Net;
  NetStr: String;
  CamadaOk: Boolean;
begin
  // qualquer camada da tabela menos a Multi (o contrato); net so no cobre
  L := CamadaDeDestino(JGet(Line, 'layer'), 'arc_add', 'arco');
  if L = 0 then
    Exit;
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
  // camada: escrita protegida e conferida relendo, como no DoTrackAdd
  CamadaOk := True;
  try
    Arc.Layer := L;
    CamadaOk := Arc.Layer = L;
  except
    CamadaOk := False;
  end;
  if not CamadaOk then
  begin
    LogFail('arc_add: o Altium recusou a camada ' + JGet(Line, 'layer') + ' (ou ela nao pegou) - nada foi criado');
    Exit;
  end;

  NetStr := JGet(Line, 'net');
  if NetStr <> '' then
  begin
    if not EhCobre(L) then
      LogAviso('arc_add: net "' + NetStr + '" so vale em camada de cobre - ignorada')
    else
    begin
      Net := FindNet(NetStr);
      if Net <> nil then
        Arc.Net := Net
      else
        LogAviso('arc_add: net "' + NetStr + '" nao existe na placa - arco criado sem net');
    end;
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
// layer e mirror (contrato 2026-10): entram no MESMO ciclo do estilo - o espelho muda o
// bounding box, e a centralizacao (2) mede depois dele. Escrever Layer e MirrorFlag em texto e
// novo neste arquivo: vai em try, e o relatorio (3) confere os dois relendo.
procedure DoTextEdit(Line: String);
var
  Txt: IPCB_Text;
  What, Problemas: String;
  L, Destino: TLayer;
  cx, cy, dx, dy: Double;
  CamadaOk: Boolean;
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
  // camada nova conferida antes de mexer (ver DoTrackEdit)
  Destino := 0;
  if TemValor(Line, 'layer') then
  begin
    Destino := CamadaDeDestino(JGet(Line, 'layer'), What, 'texto');
    if Destino = 0 then
      Exit;
  end;
  Txt := FindFreeText(L, JNum(Line, 'orig_x'), JNum(Line, 'orig_y'), JGet(Line, 'orig_text'), False);
  if Txt = nil then
  begin
    LogFail(What + ': texto original nao encontrado na placa (re-exporte o espelho)');
    Exit;
  end;

  // 1) Estilo num ciclo proprio: o engine so recalcula o bounding box no EndModify.
  //    (Medir e ajustar a ancora no MESMO ciclo devolvia o box velho e o ajuste de
  //    XLocation era descartado - os textos nunca saiam do lugar.)
  Problemas := '';
  CamadaOk := True;
  PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JHas(Line, 'text') then
    Txt.Text := JGet(Line, 'text');
  if JHas(Line, 'h') then
    Txt.Size := MMsToCoord(JNum(Line, 'h'));
  if JHas(Line, 'w') then
    Txt.Width := MMsToCoord(JNum(Line, 'w'));
  if JHas(Line, 'rot') then
    Txt.Rotation := JNum(Line, 'rot');
  if Destino <> 0 then
  begin
    try
      Txt.Layer := Destino;
    except
      CamadaOk := False;
    end;
    if not CamadaOk then
      MaisProblema(Problemas, 'o Altium recusou a camada ' + JGet(Line, 'layer'));
  end;
  if JHas(Line, 'mirror') then
    if not AplicaEspelho(Txt, JBool(Line, 'mirror')) then
      MaisProblema(Problemas, 'o espelho (MirrorFlag) nao ficou ' + JGet(Line, 'mirror'));
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

  // 3) Relatorio honesto: mede o centro DEPOIS de tudo e confere com o alvo - e a camada
  //    nova, relendo (aceitar a escrita nao e o mesmo que ela pegar).
  cx := (XMM(Txt.BoundingRectangleForSelection.Left) + XMM(Txt.BoundingRectangleForSelection.Right)) / 2;
  cy := (YMM(Txt.BoundingRectangleForSelection.Bottom) + YMM(Txt.BoundingRectangleForSelection.Top)) / 2;
  if CamadaOk and (Destino <> 0) then
    if Txt.Layer <> Destino then
      MaisProblema(Problemas, 'a camada nao pegou (pedida ' + JGet(Line, 'layer') + ', ficou ' +
        LayerNameOf(Txt.Layer) + ')');
  if (JHas(Line, 'x') and (Abs(cx - JNum(Line, 'x')) > 0.01)) or
     (JHas(Line, 'y') and (Abs(cy - JNum(Line, 'y')) > 0.01)) then
    MaisProblema(Problemas, 'centro medido (' + FloatToStr(cx) + ',' + FloatToStr(cy) +
      ') nao chegou no alvo (' + JGet(Line, 'x') + ',' + JGet(Line, 'y') + ')');
  if Problemas <> '' then
    LogFail(What + ': ' + Problemas)
  else
    LogOk(What + ' -> texto=' + Txt.Text + ' centro medido=(' + FloatToStr(cx) + ',' + FloatToStr(cy) + ')');
end;

// text_add: texto livre novo, fonte stroke. x/y = CENTRO do bounding box, como no text_edit: o
// texto nasce, vai para a placa e so entao e medido e deslocado para o centro cair em x/y (a
// largura de "1" e a de "10" sao diferentes, e quem sabe a largura e o Altium). Medicao honesta
// no fim, como no DoTextEdit. w ausente = h/10 (o contrato).
// Txt e TObject, e nao IPCB_Text, de proposito (ver APOSTAS): com a interface declarada o
// DelphiScript confere cada membro NELA na compilacao, e UseTTFonts nunca compilou aqui.
procedure DoTextAdd(Line: String);
var
  Txt: TObject;
  What, Etapa, Texto, Problemas: String;
  L: TLayer;
  H, W, cx, cy, dx, dy: Double;
  Ok, Ancorou: Boolean;
begin
  Texto := JGet(Line, 'text');
  What := 'text_add "' + Texto + '"';
  L := CamadaDeDestino(JGet(Line, 'layer'), What, 'texto');
  if L = 0 then
    Exit;
  if Texto = '' then
  begin
    LogFail('text_add: campo "text" ausente ou vazio');
    Exit;
  end;
  if not (JHas(Line, 'x') and JHas(Line, 'y') and JHas(Line, 'h')) then
  begin
    LogFail(What + ': faltam campos x/y/h');
    Exit;
  end;
  H := JNum(Line, 'h');
  if H <= 0 then
  begin
    LogFail(What + ': altura h deve ser > 0');
    Exit;
  end;
  W := H / 10;
  if JHas(Line, 'w') then
    W := JNum(Line, 'w');
  if W <= 0 then
  begin
    LogFail(What + ': espessura w deve ser > 0');
    Exit;
  end;

  // 1) O objeto. A fabrica de texto e o Layer de texto sao novos aqui; Text, Size, Width e
  //    Rotation sao os que o DoTextEdit ja escreve. Cada passo diz o nome se for recusado.
  Txt := nil;
  Ok := False;
  Etapa := 'PCBServer.PCBObjectFactory(eTextObject)';
  try
    Txt := PCBServer.PCBObjectFactory(eTextObject, eNoDimension, eCreate_Default);
    if Txt <> nil then
    begin
      Etapa := 'IPCB_Text.Layer';
      Txt.Layer := L;
      Etapa := 'IPCB_Text.Text/Size/Width/Rotation';
      Txt.Text := Texto;
      Txt.Size := MMsToCoord(H);
      Txt.Width := MMsToCoord(W);
      if JHas(Line, 'rot') then
        Txt.Rotation := JNum(Line, 'rot');
      Ok := True;
    end;
  except
    Ok := False;
  end;
  if not Ok then
  begin
    // o texto nao vai para a placa (objeto fora da placa nao tem efeito - ver FonteStroke)
    LogFail(What + ': o Altium recusou ' + Etapa + ' - nada foi criado');
    Exit;
  end;

  // 2) Fonte stroke (o contrato). Sonda (FonteStroke): recusa vira AVISO e o texto nasce com
  //    a fonte padrao das Preferences - o desenho dele so muda de fonte, nao de lugar.
  if not FonteStroke(Txt) then
    LogAviso(What + ': o Altium recusou IPCB_Text.UseTTFonts - o texto ficou com a fonte padrao das Preferences');

  // 3) Espelho. Texto do lado de baixo sem espelho sai de tras para frente na placa: aqui a
  //    recusa e FALHA, e o texto nao e criado.
  if JHas(Line, 'mirror') then
    if not AplicaEspelho(Txt, JBool(Line, 'mirror')) then
    begin
      LogFail(What + ': o Altium recusou o espelho (IPCB_Text.MirrorFlag) - nada foi criado');
      Exit;
    end;

  // 4) Ancora inicial no alvo. Escrever XLocation em texto que JA esta na placa e ignorado
  //    neste engine (ver DoTextEdit); num objeto novo e o que o exemplo do proprio Altium faz.
  //    Se nao pegar, tanto faz: a centralizacao (6) leva o texto ao lugar pela medida.
  Ancorou := True;
  try
    Txt.XLocation := MMX(JNum(Line, 'x'));
    Txt.YLocation := MMY(JNum(Line, 'y'));
  except
    Ancorou := False;
  end;

  // 5) Para a placa.
  Ok := False;
  try
    Board.AddPCBObject(Txt);
    PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Txt.I_ObjectAddress);
    Ok := True;
  except
    Ok := False;
  end;
  if not Ok then
  begin
    LogFail(What + ': o Altium recusou Board.AddPCBObject - confira se o texto ficou na placa');
    Exit;
  end;

  // 6) Centraliza. Um ciclo de modificacao antes de medir (o bounding box so e recalculado no
  //    EndModify - ver DoTextEdit), depois mede e desloca com MoveByXY, como o DoTextEdit.
  PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Txt.GraphicallyInvalidate;
  cx := (XMM(Txt.BoundingRectangleForSelection.Left) + XMM(Txt.BoundingRectangleForSelection.Right)) / 2;
  cy := (YMM(Txt.BoundingRectangleForSelection.Bottom) + YMM(Txt.BoundingRectangleForSelection.Top)) / 2;
  dx := JNum(Line, 'x') - cx;
  dy := JNum(Line, 'y') - cy;
  PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  Txt.MoveByXY(MMsToCoord(dx), MMsToCoord(dy));
  PCBServer.SendMessageToRobots(Txt.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Txt.GraphicallyInvalidate;

  // 7) Relatorio honesto: a camada relida e o centro medido DEPOIS de tudo.
  cx := (XMM(Txt.BoundingRectangleForSelection.Left) + XMM(Txt.BoundingRectangleForSelection.Right)) / 2;
  cy := (YMM(Txt.BoundingRectangleForSelection.Bottom) + YMM(Txt.BoundingRectangleForSelection.Top)) / 2;
  Problemas := '';
  if Txt.Layer <> L then
    MaisProblema(Problemas, 'a camada nao pegou (pedida ' + JGet(Line, 'layer') + ', ficou ' +
      LayerNameOf(Txt.Layer) + ')');
  if (Abs(cx - JNum(Line, 'x')) > 0.01) or (Abs(cy - JNum(Line, 'y')) > 0.01) then
  begin
    if Ancorou then
      MaisProblema(Problemas, 'o centro medido (' + FloatToStr(cx) + ',' + FloatToStr(cy) +
        ') nao chegou no alvo (' + JGet(Line, 'x') + ',' + JGet(Line, 'y') + ')')
    else
      MaisProblema(Problemas, 'o centro medido (' + FloatToStr(cx) + ',' + FloatToStr(cy) +
        ') nao chegou no alvo (' + JGet(Line, 'x') + ',' + JGet(Line, 'y') + ') - e a ancora inicial ' +
        '(XLocation/YLocation) tinha sido recusada');
  end;
  if Problemas <> '' then
    LogFail(What + ': criado, mas ' + Problemas)
  else
    LogOk(What + ' ' + JGet(Line, 'layer') + ' -> centro medido=(' + FloatToStr(cx) + ',' + FloatToStr(cy) + ')');
end;

// text_del: remove um texto LIVRE - nao designator/comment, e fora de componente.
procedure DoTextDel(Line: String);
var
  Txt: IPCB_Text;
  What: String;
  L: TLayer;
  Ok: Boolean;
begin
  What := 'text_del ' + JGet(Line, 'id');
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
  Txt := FindFreeText(L, JNum(Line, 'orig_x'), JNum(Line, 'orig_y'), JGet(Line, 'orig_text'), True);
  if Txt = nil then
  begin
    // so para a mensagem dizer o motivo certo: existe, mas e de um componente?
    Txt := FindFreeText(L, JNum(Line, 'orig_x'), JNum(Line, 'orig_y'), JGet(Line, 'orig_text'), False);
    if Txt <> nil then
      LogFail(What + ': o texto pertence ao componente ' + DonoDe(Txt) +
        ' (so texto livre pode ser removido; edite o footprint no Altium)')
    else
      LogFail(What + ': texto original nao encontrado na placa (re-exporte o espelho)');
    Exit;
  end;
  Ok := True;
  try
    Board.RemovePCBObject(Txt);
  except
    Ok := False;
  end;
  if Ok then
    LogOk(What + ' "' + JGet(Line, 'orig_text') + '"')
  else
    LogFail(What + ': o Altium recusou a remocao do texto');
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

{ ---- contorno com arco (bulge) ---- }

// APOSTA (ver APOSTAS): ArcTan e Sqrt - as primeiras contas de trigonometria dos .pas.
// Angulo de (dx,dy) em graus, 0..360 (o atan2 feito com ArcTan, que e o que o Pascal tem).
function AnguloDe(dx, dy: Double): Double;
begin
  if Abs(dx) < 1E-12 then
  begin
    if dy >= 0 then
      Result := 90
    else
      Result := 270;
    Exit;
  end;
  Result := ArcTan(dy / dx) * 180 / PI_;
  if dx < 0 then
    Result := Result + 180;
  if Result < 0 then
    Result := Result + 360;
  if Result >= 360 then
    Result := Result - 360;
end;

// O arco de bulge B que vai de (x1,y1) a (x2,y2) - a mesma conta do HubCore.bulgeArco, so com
// algebra e ArcTan: raio = c(1+b^2)/(4|b|), centro a (c/2)(1-b^2)/(2b) da corda, a esquerda.
// Sai anti-horario de A1 para A2 (como o ExportBoard le Angle1/Angle2).
procedure ArcoDoBulge(x1, y1, x2, y2, B: Double; var cx, cy, r, A1, A2: Double);
var
  c, ux, uy, s, t: Double;
begin
  c := Sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  ux := (x2 - x1) / c;
  uy := (y2 - y1) / c;
  r := c * (1 + B * B) / (4 * Abs(B));
  s := (c / 2) * (1 - B * B) / (2 * B);
  cx := (x1 + x2) / 2 - uy * s;
  cy := (y1 + y2) / 2 + ux * s;
  A1 := AnguloDe(x1 - cx, y1 - cy);
  A2 := AnguloDe(x2 - cx, y2 - cy);
  if B < 0 then
  begin
    t := A1;
    A1 := A2;
    A2 := t;
  end;
end;

// 'x|y' ou 'x|y,b' (o ParsePts deixa o terceiro numero colado no y) -> y e bulge
function PtYSo(P: String): Double;
var
  s: String;
  k: Integer;
begin
  s := Copy(P, Pos('|', P) + 1, 255);
  k := Pos(',', s);
  if k > 0 then
    s := Copy(s, 1, k - 1);
  Result := StrToFloatDot(s);
end;

function PtBulge(P: String): Double;
var
  s: String;
  k: Integer;
begin
  Result := 0;
  s := Copy(P, Pos('|', P) + 1, 255);
  k := Pos(',', s);
  if k > 0 then
    Result := StrToFloatDot(Copy(s, k + 1, 255));
end;

// Os segmentos de um contorno (BoardOutline ou polygon) a partir do pts com bulge. Arco por
// NUMERO (SEG_ARCO, conferido no comeco da rodada contra o ePolySegmentLine que ja roda); os
// campos cx/cy/Radius/Angle1/Angle2 sao os que o ExportBoard le do BoardOutline.
procedure GravaSegmentos(BO: TObject; Pts: TStringList);
var
  i, j: Integer;
  Seg: TPolySegment;
  B, cx, cy, r, A1, A2: Double;
begin
  BO.PointCount := Pts.Count;
  for i := 0 to Pts.Count - 1 do
  begin
    j := (i + 1) mod Pts.Count;
    Seg := BO.Segments[i];
    B := PtBulge(Pts[i]);
    Seg.vx := MMX(PtX(Pts[i]));
    Seg.vy := MMY(PtYSo(Pts[i]));
    if (Abs(B) > 1E-12) and SegmentosNumerados then
    begin
      ArcoDoBulge(PtX(Pts[i]), PtYSo(Pts[i]), PtX(Pts[j]), PtYSo(Pts[j]), B, cx, cy, r, A1, A2);
      Seg.Kind := SEG_ARCO;
      Seg.cx := MMX(cx);
      Seg.cy := MMY(cy);
      Seg.Radius := MMsToCoord(r);
      Seg.Angle1 := A1;
      Seg.Angle2 := A2;
    end
    else
      Seg.Kind := ePolySegmentLine;
    BO.Segments[i] := Seg;
  end;
end;

// quantos vertices do pts tem arco (bulge <> 0)
function ContaArcos(Pts: TStringList): Integer;
var
  i: Integer;
begin
  Result := 0;
  for i := 0 to Pts.Count - 1 do
    if Abs(PtBulge(Pts[i])) > 1E-12 then
      Result := Result + 1;
end;

// Vertice [x,y] = reta ate o proximo; [x,y,b] = arco de bulge b (o HubCore.ptsToOutline). O
// arco vai por GravaSegmentos (ver APOSTAS); sem a numeracao do segmento conferida, o contorno
// sai so com as retas entre os vertices, e o relatorio diz.
procedure DoOutlineSet(Line: String);
var
  Pts: TStringList;
  BO: TObject;
  NArcos: Integer;
begin
  Pts := ParsePts(Line);
  NArcos := ContaArcos(Pts);
  if (Pts.Count < 3) and not ((Pts.Count = 2) and (NArcos > 0)) then
  begin
    LogFail('outline_set: pts precisa de pelo menos 3 vertices [[x,y],...] (2 com arco)');
    Pts.Free;
    Exit;
  end;
  if (NArcos > 0) and not SegmentosNumerados then
    LogAviso('outline_set: a numeracao do segmento de contorno nao e a esperada (ePolySegmentLine = ' +
      IntToStr(ePolySegmentLine) + ') - os ' + IntToStr(NArcos) + ' arco(s) saem como reta');
  if not ConfirmNoYes('outline_set: substituir o CONTORNO DA PLACA por um poligono de ' +
    IntToStr(Pts.Count) + ' vertices (' + IntToStr(NArcos) + ' com arco)?') then
  begin
    LogFail('outline_set: cancelado pelo usuario');
    Pts.Free;
    Exit;
  end;
  BO := Board.BoardOutline;
  PCBServer.SendMessageToRobots(BO.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  BO.Invalidate;
  GravaSegmentos(BO, Pts);
  BO.Rebuild;
  BO.Validate;
  PCBServer.SendMessageToRobots(BO.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  LogOk('outline_set: contorno redefinido com ' + IntToStr(Pts.Count) + ' vertices');
  Pts.Free;
end;

{ ..................................................................................................................... }
{ .                                     Fill (retangulo cheio) e region (poligono cheio)                              . }
{ ..................................................................................................................... }

// Os cantos e a rotacao que o fill GUARDOU, conferidos contra o pedido (cantos em qualquer
// ordem; a rotacao so quando TemRot). Lido = o que foi lido, para o relatorio. False tambem
// quando a leitura e recusada.
function FillConfere(Fill: TObject; X1, Y1, X2, Y2, Rot: Double; TemRot: Boolean; var Lido: String): Boolean;
var
  ax1, ay1, ax2, ay2, ar: Double;
begin
  Result := False;
  Lido := '(leitura recusada)';
  if not LeCantosFill(Fill, ax1, ay1, ax2, ay2) then
    Exit;
  try
    ar := Fill.Rotation;
    Lido := '(' + FloatToStr(ax1) + ',' + FloatToStr(ay1) + ')-(' + FloatToStr(ax2) + ',' +
      FloatToStr(ay2) + ') rot=' + FloatToStr(ar);
    Result := MesmoIntervalo(ax1, ax2, X1, X2) and MesmoIntervalo(ay1, ay2, Y1, Y2);
    if Result and TemRot then
      Result := NearAngle(ar, Rot);
  except
    Result := False;
  end;
end;

// O fill dos orig_* (camada + cantos), so se for SOLTO. Fill de componente (o footprint pode
// ter) e recusado com o nome do dono, como o HubCore faz.
function RequireFillOrig(Line, What: String): TObject;
var
  L: TLayer;
  X1, Y1, X2, Y2: Double;
  Dono: TObject;
begin
  Result := nil;
  if not (JHas(Line, 'orig_x1') and JHas(Line, 'orig_y1') and JHas(Line, 'orig_x2') and
    JHas(Line, 'orig_y2') and JHas(Line, 'orig_layer')) then
  begin
    LogFail(What + ': faltam campos orig_x1/orig_y1/orig_x2/orig_y2/orig_layer (copie do board.js)');
    Exit;
  end;
  L := LayerFromName(JGet(Line, 'orig_layer'));
  if L = 0 then
  begin
    LogFail(What + ': orig_layer invalida "' + JGet(Line, 'orig_layer') + '"');
    Exit;
  end;
  X1 := JNum(Line, 'orig_x1');
  Y1 := JNum(Line, 'orig_y1');
  X2 := JNum(Line, 'orig_x2');
  Y2 := JNum(Line, 'orig_y2');
  SondaFalhou := '';
  Result := FindFill(L, X1, Y1, X2, Y2, True);
  if Result <> nil then
    Exit;
  if SondaFalhou <> '' then
  begin
    LogFail(What + ': o Altium recusou ' + SondaFalhou + ' - nada foi mudado');
    Exit;
  end;
  Dono := FindFill(L, X1, Y1, X2, Y2, False);
  if Dono <> nil then
    LogFail(What + ': o fill pertence ao componente ' + DonoDe(Dono) +
      ' (so fill solto e editavel sozinho; edite o footprint no Altium)')
  else
    LogFail(What + ': fill original nao encontrado na placa (re-exporte o espelho)');
end;

// Net de um fill novo ou editado: so no cobre (fora dele e AVISO e fica sem net), e so se a
// net existir na placa. Fill.Net e escrita nova aqui: vai em try.
procedure NetNoFill(Fill: TObject; L: TLayer; NetStr, What: String);
var
  Net: IPCB_Net;
  Ok: Boolean;
begin
  if NetStr = '' then
    Exit;
  if not EhCobre(L) then
  begin
    LogAviso(What + ': net "' + NetStr + '" so vale em camada de cobre - ignorada');
    Exit;
  end;
  Net := FindNet(NetStr);
  if Net = nil then
  begin
    LogAviso(What + ': net "' + NetStr + '" nao existe na placa - o fill ficou sem ela');
    Exit;
  end;
  Ok := True;
  try
    Fill.Net := Net;
  except
    Ok := False;
  end;
  if not Ok then
    LogAviso(What + ': o Altium recusou a net no fill (IPCB_Fill.Net) - o fill ficou sem ela');
end;

// fill_add: retangulo cheio. x1..y2 = os cantos SEM rotacao (X1Location..Y2Location do Altium)
// e rot gira em torno do centro - o formato do board.js. A fabrica e as propriedades do fill sao
// novas neste arquivo: cada passo em try, e o fill so vai para a placa depois de conferido
// (cantos e rotacao lidos de volta) - um fill que nao guardou o retangulo seria lixo no PcbDoc.
// O tipo vai pelo numero (OBJ_FILL), conferido pela sonda ObjetosNumerados, e o objeto criado e
// conferido de novo pelo ObjectId antes de qualquer escrita.
procedure DoFillAdd(Line: String);
var
  Fill: TObject;
  What, Etapa, Lido: String;
  L: TLayer;
  x1, y1, x2, y2, Rot: Double;
  Ok: Boolean;
begin
  What := 'fill_add ' + JGet(Line, 'layer');
  if not ObjetosNumerados then
  begin
    LogFail(What + ': a numeracao dos tipos de objeto desta versao do Altium nao e a esperada, e o ' +
      'tipo fill vai pelo numero (ver o [AVISO] no comeco do relatorio) - nada foi criado');
    Exit;
  end;
  L := CamadaDeDestino(JGet(Line, 'layer'), 'fill_add', 'fill');
  if L = 0 then
    Exit;
  if not (JHas(Line, 'x1') and JHas(Line, 'y1') and JHas(Line, 'x2') and JHas(Line, 'y2')) then
  begin
    LogFail('fill_add: faltam campos x1/y1/x2/y2');
    Exit;
  end;
  x1 := JNum(Line, 'x1');
  y1 := JNum(Line, 'y1');
  x2 := JNum(Line, 'x2');
  y2 := JNum(Line, 'y2');
  if NearMM(x1, x2) or NearMM(y1, y2) then
  begin
    LogFail('fill_add: fill sem area (x1 = x2 ou y1 = y2)');
    Exit;
  end;
  Rot := 0;
  if JHas(Line, 'rot') then
    Rot := JNum(Line, 'rot');

  // Em todo "nada foi criado" abaixo o fill so nao vai para a placa: objeto fora da placa nao
  // tem efeito no PcbDoc (ver o comentario antes de FonteStroke).
  Fill := nil;
  Ok := False;
  Etapa := 'PCBServer.PCBObjectFactory (tipo fill = ' + IntToStr(OBJ_FILL) + ')';
  try
    Fill := PCBServer.PCBObjectFactory(OBJ_FILL, eNoDimension, eCreate_Default);
    if Fill <> nil then
    begin
      Etapa := 'o ObjectId do objeto criado (devia ser ' + IntToStr(OBJ_FILL) + ', o fill)';
      Ok := Fill.ObjectId = OBJ_FILL;
    end;
  except
    Ok := False;
  end;
  if Ok then
  begin
    Etapa := 'IPCB_Fill.X1Location..Y2Location';
    Ok := GravaCantosFill(Fill, x1, y1, x2, y2);
  end;
  if Ok then
  begin
    try
      Etapa := 'IPCB_Fill.Rotation';
      Fill.Rotation := Rot;
      Etapa := 'IPCB_Fill.Layer';
      Fill.Layer := L;
    except
      Ok := False;
    end;
  end;
  if not Ok then
  begin
    LogFail(What + ': o Altium recusou ' + Etapa + ' - nada foi criado');
    Exit;
  end;
  if not FillConfere(Fill, x1, y1, x2, y2, Rot, True, Lido) then
  begin
    LogFail(What + ': o fill nao guardou o retangulo pedido (lido ' + Lido + ') - nada foi criado');
    Exit;
  end;
  Ok := False;
  try
    Ok := Fill.Layer = L;
  except
    Ok := False;
  end;
  if not Ok then
  begin
    LogFail(What + ': o fill nao ficou na camada pedida - nada foi criado');
    Exit;
  end;

  NetNoFill(Fill, L, JGet(Line, 'net'), 'fill_add');

  Ok := False;
  try
    Board.AddPCBObject(Fill);
    PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Fill.I_ObjectAddress);
    Ok := True;
  except
    Ok := False;
  end;
  if Ok then
    LogOk(What + ' (' + JGet(Line, 'x1') + ',' + JGet(Line, 'y1') + ')-(' + JGet(Line, 'x2') + ',' +
      JGet(Line, 'y2') + ') rot=' + FloatToStr(Rot))
  else
    LogFail(What + ': o Altium recusou Board.AddPCBObject - confira se o fill ficou na placa');
end;

// fill_edit: cantos, rotacao, camada e net de um fill SOLTO. O retangulo final (o pedido por
// cima do que o fill ja tem) e conferido antes - fill sem area recusa a mudanca inteira - e
// relido no fim.
procedure DoFillEdit(Line: String);
var
  Fill: TObject;
  What, Etapa, Lido: String;
  Destino: TLayer;
  x1, y1, x2, y2, Rot: Double;
  Ok: Boolean;
begin
  What := 'fill_edit ' + JGet(Line, 'id');
  // camada nova conferida antes de mexer (ver DoTrackEdit)
  Destino := 0;
  if TemValor(Line, 'layer') then
  begin
    Destino := CamadaDeDestino(JGet(Line, 'layer'), What, 'fill');
    if Destino = 0 then
      Exit;
  end;
  Fill := RequireFillOrig(Line, What);
  if Fill = nil then
    Exit;

  // o retangulo de agora (a busca acabou de ler os cantos; Rotation e Layer sao leituras novas)
  Ok := LeCantosFill(Fill, x1, y1, x2, y2);
  if Ok then
  begin
    try
      Rot := Fill.Rotation;
      if Destino = 0 then
        Destino := Fill.Layer;
    except
      Ok := False;
    end;
  end;
  if not Ok then
  begin
    LogFail(What + ': o Altium recusou a leitura do fill (cantos/Rotation/Layer) - nada foi mudado');
    Exit;
  end;
  if JHas(Line, 'x1') then
    x1 := JNum(Line, 'x1');
  if JHas(Line, 'y1') then
    y1 := JNum(Line, 'y1');
  if JHas(Line, 'x2') then
    x2 := JNum(Line, 'x2');
  if JHas(Line, 'y2') then
    y2 := JNum(Line, 'y2');
  if JHas(Line, 'rot') then
    Rot := JNum(Line, 'rot');
  if NearMM(x1, x2) or NearMM(y1, y2) then
  begin
    LogFail(What + ': fill sem area (x1 = x2 ou y1 = y2) - nada foi mudado');
    Exit;
  end;

  Etapa := 'IPCB_Fill.X1Location..Y2Location';
  PCBServer.SendMessageToRobots(Fill.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  Ok := GravaCantosFill(Fill, x1, y1, x2, y2);
  if Ok then
  begin
    try
      Etapa := 'IPCB_Fill.Rotation';
      if JHas(Line, 'rot') then
        Fill.Rotation := Rot;
      Etapa := 'IPCB_Fill.Layer';
      if TemValor(Line, 'layer') then
        Fill.Layer := Destino;
    except
      Ok := False;
    end;
  end;
  // net: so no cobre; a que o fill ja tinha fica com ele ao sair do cobre (ver DoTrackEdit)
  if Ok and JHas(Line, 'net') then
    NetNoFill(Fill, Destino, JGet(Line, 'net'), What);
  PCBServer.SendMessageToRobots(Fill.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Fill.GraphicallyInvalidate;

  if not Ok then
    LogFail(What + ': o Altium recusou ' + Etapa + ' - o fill pode ter mudado so em parte (confira na placa)')
  else if not FillConfere(Fill, x1, y1, x2, y2, Rot, JHas(Line, 'rot'), Lido) then
    LogFail(What + ': o fill nao ficou com o retangulo pedido (lido ' + Lido + ')')
  else if TemValor(Line, 'layer') and (Fill.Layer <> Destino) then
    LogFail(What + ': a camada nao pegou (pedida ' + JGet(Line, 'layer') + ', ficou ' +
      LayerNameOf(Fill.Layer) + ') - o retangulo foi aplicado')
  else
    LogOk(What + ' -> ' + Lido);
end;

procedure DoFillDel(Line: String);
var
  Fill: TObject;
  What: String;
  Ok: Boolean;
begin
  What := 'fill_del ' + JGet(Line, 'id');
  Fill := RequireFillOrig(Line, What);
  if Fill = nil then
    Exit;
  Ok := True;
  try
    Board.RemovePCBObject(Fill);
  except
    Ok := False;
  end;
  if Ok then
    LogOk(What)
  else
    LogFail(What + ': o Altium recusou a remocao do fill');
end;

// APOSTA (ver APOSTAS): grava o contorno da region pelo caminho que o script de referencia do
// AD24 (altium-designer-mcp, GenerateSamples.pas) chama de provado - copiado do FP_AddPoly do
// UltraLibrarian: o contorno principal REPLICADO, Count, os vertices em X[i]/Y[i] e
// SetOutlineContour. NAO pelo PCBServer.PCBContourFactory + AddPoint: na documentacao do Altium
// a fabrica pede um parametro (AArcResolution) que nao tem valor padrao, e AddPoint nao aparece
// em script nenhum que se tenha visto rodar.
//
// A BASE do X[i] e sonda. La ela e 1 (X[1]..X[N]); aqui a leitura provada, GetState_PointX(k),
// e base 0 (k de 0 a Count-1: foi assim que o board.js do DMB bateu vertice a vertice com o
// PcbDoc). Gravar X[N] numa base 0 seria escrever fora do contorno, e uma violacao de acesso
// dentro do Altium o try nao segura. Entao so o 1o vertice vai primeiro, em X[1] (indice valido
// nas duas bases, com N >= 3), e a leitura provada diz onde ele caiu: no 0, base 1; no 1, base 0.
// Os vertices sao os N primeiros de Pts. False = recusado; Etapa diz qual chamada e Base sai
// com a base achada (-1 = nao achou). Variavel TObject de proposito (ver APOSTAS).
function MontaContorno(Region: TObject; Pts: TStringList; N: Integer; var Etapa: String; var Base: Integer): Boolean;
var
  Contorno: TObject;
  k, Alvo: Integer;
begin
  Result := False;
  Base := -1;
  try
    Etapa := 'IPCB_Region.GetMainContour().Replicate';
    Contorno := Region.GetMainContour();
    Contorno := Contorno.Replicate;
    Etapa := 'IPCB_Contour.Count/X[1]';
    Contorno.Count := N;
    Alvo := MMX(PtX(Pts[0]));
    Contorno.X[1] := Alvo;
    Etapa := 'IPCB_Contour.GetState_PointX (a sonda da base de X[])';
    if Abs(Contorno.GetState_PointX(0) - Alvo) < 2 then
      Base := 1
    else if Abs(Contorno.GetState_PointX(1) - Alvo) < 2 then
      Base := 0;
    if Base < 0 then
      Etapa := 'IPCB_Contour.X[] (o vertice gravado em X[1] nao apareceu em GetState_PointX(0) nem (1))'
    else
    begin
      Etapa := 'IPCB_Contour.X[i]/Y[i] (base ' + IntToStr(Base) + ')';
      for k := 0 to N - 1 do
      begin
        Contorno.X[k + Base] := MMX(PtX(Pts[k]));
        Contorno.Y[k + Base] := MMY(PtY(Pts[k]));
      end;
      Etapa := 'IPCB_Region.SetOutlineContour';
      Region.SetOutlineContour(Contorno);
      Result := True;
    end;
  except
    Result := False;
  end;
end;

// O contorno que a region GUARDOU e o pedido? Lido como o ExportBoard le (GetState_PointX/Y de
// 0 a Count-1, a leitura que bateu vertice a vertice com o binario do DMB): pelo menos 3
// vertices, e todo vertice guardado e um dos pedidos. A ordem e o ponto de partida nao entram (o
// Altium pode comecar noutro vertice). E a segunda rede da sonda da base em MontaContorno: um
// X[i]/Y[i] gravado com a base errada deixa um vertice zerado ou fora do lugar, e e isso que
// esta conferencia pega. Lidos = Count, ou -1 se a releitura foi recusada.
function ContornoConfere(Region: TObject; Pts: TStringList; N: Integer; var Lidos: Integer): Boolean;
var
  C: TObject;
  k, j: Integer;
  x, y: Double;
  Achou, Todos: Boolean;
begin
  Result := False;
  Lidos := -1;
  try
    C := Region.GetMainContour();
    Lidos := C.Count;
    Todos := Lidos >= 3;
    k := 0;
    while Todos and (k < Lidos) do
    begin
      x := XMM(C.GetState_PointX(k));
      y := YMM(C.GetState_PointY(k));
      Achou := False;
      j := 0;
      while (not Achou) and (j < N) do
      begin
        if NearMM(x, PtX(Pts[j])) and NearMM(y, PtY(Pts[j])) then
          Achou := True;
        j := j + 1;
      end;
      Todos := Achou;
      k := k + 1;
    end;
    Result := Todos;
  except
    Result := False;
  end;
end;

// region_add: region solida (cheia) na camada pedida ou - com cutout:true - um recorte da placa
// (Board Cutout: e assim que a casa faz furo de fixacao). Poligono fechado implicito: o ultimo
// vertice liga no primeiro, e um ultimo vertice repetindo o primeiro e ignorado.
//
// A ordem e a do script de referencia do AD24 (AddRegionCutout, conferido la): camada e Kind
// primeiro, contorno depois (MontaContorno). Toda chamada nova vai em try: recusa = FALHA
// dizendo QUAL chamada, e nada entra na placa. Antes de ir para a placa a region e relida
// (ContornoConfere e, no recorte, o Kind): region que nao guardou o pedido seria lixo no PcbDoc.
//
// Recorte: o Kind sai de KindDoRecorte (o porque esta la) e e escrito como inteiro na propriedade
// Kind - a atribuicao direta, que e a que o AD24 aceita -, relido antes do contorno, depois dele
// e depois de ir para a placa. Se nao pegar, a FALHA e "recorte nao suportado nesta versao". A
// camada e a Multi, a dos recortes que a casa desenha (V7_LAYER=MULTILAYER nos PcbDoc).
procedure DoRegionAdd(Line: String);
var
  Pts: TStringList;
  Region: TObject;
  Net: IPCB_Net;
  What, NetStr, Etapa, Origem, Vertices: String;
  L: TLayer;
  N, KindLido, Medidos, BaseX: Integer;
  Corte, Ok, Conferido, CamadaOk: Boolean;
begin
  Corte := JBool(Line, 'cutout');
  if Corte then
    What := 'region_add (recorte)'
  else
    What := 'region_add ' + JGet(Line, 'layer');

  // N = quantos vertices de Pts valem: um ultimo igual ao primeiro e o fechamento escrito a mao
  Pts := ParsePts(Line);
  N := Pts.Count;
  if N > 1 then
    if NearMM(PtX(Pts[N - 1]), PtX(Pts[0])) and NearMM(PtY(Pts[N - 1]), PtY(Pts[0])) then
      N := N - 1;
  if N < 3 then
  begin
    LogFail(What + ': pts precisa de pelo menos 3 vertices [[x,y],...]');
    Pts.Free;
    Exit;
  end;

  if Corte then
  begin
    L := eMultiLayer;
    if JGet(Line, 'net') <> '' then
      LogAviso(What + ': recorte nao tem net - "' + JGet(Line, 'net') + '" ignorada');
    if KindRecorteN = -2 then
    begin
      // por variaveis locais: parametro var so foi provado aqui com local (Iter2PolyRegions)
      Origem := '';
      Conferido := False;
      KindRecorteN := KindDoRecorte(Origem, Conferido);
      KindRecorteOrigem := Origem;
      KindRecorteConferido := Conferido;
    end;
    if KindRecorteN < 0 then
    begin
      LogFail(What + ': recorte nao suportado nesta versao: desenhe o Board Cutout no Altium (' +
        KindRecorteOrigem + ') - nada foi criado');
      Pts.Free;
      Exit;
    end;
  end
  else
  begin
    L := CamadaDeDestino(JGet(Line, 'layer'), What, 'region');
    if L = 0 then
    begin
      Pts.Free;
      Exit;
    end;
  end;

  // Em todo "nada foi criado" abaixo a region so nao vai para a placa: objeto fora da placa nao
  // tem efeito no PcbDoc (ver o comentario antes de FonteStroke).

  // 1) a region
  Region := nil;
  Ok := False;
  Etapa := 'PCBServer.PCBObjectFactory(eRegionObject)';
  try
    Region := PCBServer.PCBObjectFactory(eRegionObject, eNoDimension, eCreate_Default);
    Ok := Region <> nil;
  except
    Ok := False;
  end;
  if not Ok then
  begin
    LogFail(What + ': o Altium recusou ' + Etapa + ' - nada foi criado');
    Pts.Free;
    Exit;
  end;

  // 2) a camada (escrita nova em region, conferida relendo). Region solida: recusa e FALHA.
  //    Recorte: a Multi; recusa aqui so AVISA (quem faz o recorte e o Kind), e ela e tentada de
  //    novo depois do Kind, caso o Altium so aceite a Multi numa region que ja e recorte.
  CamadaOk := True;
  try
    Region.Layer := L;
    CamadaOk := Region.Layer = L;
  except
    CamadaOk := False;
  end;
  if (not CamadaOk) and (not Corte) then
  begin
    LogFail(What + ': o Altium recusou a camada ' + JGet(Line, 'layer') + ' na region (ou ela nao pegou) - ' +
      'nada foi criado');
    Pts.Free;
    Exit;
  end;

  // 3) recorte: o Kind, escrito e relido; depois a Multi, se ainda nao pegou
  if Corte then
  begin
    Ok := True;
    try
      Region.Kind := KindRecorteN;
    except
      Ok := False;
    end;
    KindLido := LeKind(Region);
    if KindLido <> KindRecorteN then
    begin
      if Ok then
        Etapa := 'nao pegou'
      else
        Etapa := 'foi recusado na escrita (Region.Kind)';
      LogFail(What + ': recorte nao suportado nesta versao: desenhe o Board Cutout no Altium (o Kind ' +
        IntToStr(KindRecorteN) + ' ' + Etapa + ': a region ficou com Kind ' + IntToStr(KindLido) +
        ') - nada foi criado');
      Pts.Free;
      Exit;
    end;
    if not CamadaOk then
    begin
      try
        Region.Layer := eMultiLayer;
        CamadaOk := Region.Layer = eMultiLayer;
      except
        CamadaOk := False;
      end;
      if not CamadaOk then
        LogAviso(What + ': o Altium recusou por o recorte na Multi - ele ficou na camada que a fabrica deu');
    end;
  end;

  // 4) o contorno, gravado e relido
  if not MontaContorno(Region, Pts, N, Etapa, BaseX) then
  begin
    LogFail(What + ': o Altium recusou ' + Etapa + ' - nada foi criado');
    Pts.Free;
    Exit;
  end;
  if not ContornoConfere(Region, Pts, N, Medidos) then
  begin
    if Medidos < 0 then
      LogFail(What + ': o Altium recusou a releitura do contorno (GetMainContour) - nada foi criado')
    else
      LogFail(What + ': o contorno que a region guardou (' + IntToStr(Medidos) + ' vertice(s)) nao e o ' +
        'pedido (' + IntToStr(N) + ' vertices) - nada foi criado');
    Pts.Free;
    Exit;
  end;

  // 5) recorte: o Kind de novo (gravar o contorno nao pode te-lo desfeito). Region solida: a net,
  //    so no cobre.
  if Corte then
  begin
    KindLido := LeKind(Region);
    if KindLido <> KindRecorteN then
    begin
      LogFail(What + ': recorte nao suportado nesta versao: desenhe o Board Cutout no Altium (o Kind ' +
        IntToStr(KindRecorteN) + ' se perdeu ao gravar o contorno: a region ficou com Kind ' +
        IntToStr(KindLido) + ') - nada foi criado');
      Pts.Free;
      Exit;
    end;
  end
  else
  begin
    NetStr := JGet(Line, 'net');
    if NetStr <> '' then
    begin
      if not EhCobre(L) then
        LogAviso(What + ': net "' + NetStr + '" so vale em camada de cobre - ignorada')
      else
      begin
        Net := FindNet(NetStr);
        if Net = nil then
          LogAviso(What + ': net "' + NetStr + '" nao existe na placa - region criada sem net')
        else
        begin
          Ok := True;
          try
            Region.Net := Net;
          except
            Ok := False;
          end;
          if not Ok then
            LogAviso(What + ': o Altium recusou a net na region (IPCB_Region.Net) - region criada sem net');
        end;
      end;
    end;
  end;

  // 6) para a placa
  Ok := False;
  try
    Board.AddPCBObject(Region);
    PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Region.I_ObjectAddress);
    Ok := True;
  except
    Ok := False;
  end;
  // a base de X[] que a sonda achou vai junto: e a medida que falta para o proximo script
  Vertices := IntToStr(Medidos) + ' vertices';
  if Medidos <> N then
    Vertices := Vertices + ' (pedidos ' + IntToStr(N) + ')';
  Vertices := Vertices + ' [sonda: X[] base ' + IntToStr(BaseX) + ']';
  if not Ok then
    LogFail(What + ': o Altium recusou Board.AddPCBObject - confira se a region ficou na placa')
  else if Corte then
  begin
    // 7) o recorte ja na placa: o Kind ficou? Se nao ficou, a region ESTA na placa - por isso a
    //    mensagem diz como tira-la.
    KindLido := LeKind(Region);
    if KindLido <> KindRecorteN then
      LogFail(What + ': foi para a placa, mas ficou com Kind ' + IntToStr(KindLido) + ' em vez de ' +
        IntToStr(KindRecorteN) + ' - NAO e recorte: apague essa region no Altium (ou desfaca a aplicacao ' +
        'inteira com um Ctrl+Z) e desenhe o Board Cutout la')
    else
    begin
      LogOk(What + ': ' + Vertices + ', ' + KindRecorteOrigem);
      if not KindRecorteConferido then
        LogAviso(What + ': o Kind ' + IntToStr(KindRecorteN) + ' NAO foi conferido nesta placa - confira no ' +
          'Altium se virou Board Cutout (o furo aparece no 3D e some do cobre). Se nao virou, desfaca a ' +
          'aplicacao (um Ctrl+Z desfaz tudo) e desenhe o recorte no Altium; o Kind certo sai no proximo ' +
          'ExportPcb, no "kindn" dos cutouts');
    end;
  end
  else
    LogOk(What + ': ' + Vertices);
  // Menos vertices do que o pedido, todos eles dos pedidos: o Altium pode ter tirado vertice
  // alinhado (a forma e a mesma) - ou nao. A forma so se confere olhando.
  if Ok and (Medidos < N) then
    LogAviso(What + ': a region guardou ' + IntToStr(Medidos) + ' dos ' + IntToStr(N) + ' vertices pedidos ' +
      '(todos os guardados sao dos pedidos) - confira a forma no Altium');
  Pts.Free;
end;

// region_del: remove uma region LIVRE, achada pela camada + numero de vertices + 1o vertice do
// contorno (orig_n, orig_x0, orig_y0). Pedaco de polygon despejado, region de componente ou
// region que nao e solida (recorte, cavidade) sao recusados dizendo qual dos tres.
procedure DoRegionDel(Line: String);
var
  Region: TObject;
  What: String;
  L: TLayer;
  N: Integer;
  X0, Y0: Double;
  Ok: Boolean;
begin
  What := 'region_del ' + JGet(Line, 'id');
  if not (JHas(Line, 'orig_layer') and JHas(Line, 'orig_n') and JHas(Line, 'orig_x0') and
    JHas(Line, 'orig_y0')) then
  begin
    LogFail(What + ': faltam orig_layer/orig_n/orig_x0/orig_y0 (copie do board.js)');
    Exit;
  end;
  L := LayerFromName(JGet(Line, 'orig_layer'));
  if L = 0 then
  begin
    LogFail(What + ': orig_layer invalida "' + JGet(Line, 'orig_layer') + '"');
    Exit;
  end;
  N := Round(JNum(Line, 'orig_n'));
  if N < 3 then
  begin
    LogFail(What + ': orig_n invalido "' + JGet(Line, 'orig_n') + '" (o numero de vertices de "points" no board.js)');
    Exit;
  end;
  X0 := JNum(Line, 'orig_x0');
  Y0 := JNum(Line, 'orig_y0');

  SondaFalhou := '';
  Region := FindRegion(L, N, X0, Y0, True);
  if Region = nil then
  begin
    if SondaFalhou <> '' then
    begin
      LogFail(What + ': o Altium recusou ' + SondaFalhou + ' - nada foi removido');
      Exit;
    end;
    // so para a mensagem dizer o motivo certo
    Region := FindRegion(L, N, X0, Y0, False);
    if Region <> nil then
      LogFail(What + ': ' + MotivoRegionPresa(Region))
    else
      LogFail(What + ': region original nao encontrada na placa (re-exporte o espelho; pedaco de ' +
        'polygon despejado se apaga mexendo no polygon, no Altium)');
    Exit;
  end;
  Ok := True;
  try
    Board.RemovePCBObject(Region);
  except
    Ok := False;
  end;
  if Ok then
    LogOk(What)
  else
    LogFail(What + ': o Altium recusou a remocao da region');
end;

{ ..................................................................................................................... }
{ .                     Placa nova e ECO (2026-10-13): componente, pad, net, comment, polygon                         . }
{ ..................................................................................................................... }

// Net de um primitivo ('' = sem net). Em try: o ExportBoard le Prim.Net.Name de pad, trilha e
// via; aqui ele vale tambem para o pad de componente novo, que nunca passou por ele.
function NetDe(Prim: TObject): String;
begin
  Result := '';
  try
    if Prim.Net <> nil then
      Result := Prim.Net.Name;
  except
    Result := '';
  end;
end;

// Quantos pads o componente tem (o GroupIterator de pads e o do ExportBoard).
function ContaPads(Comp: TObject): Integer;
var
  Iter, Pad: TObject;
begin
  Result := 0;
  Iter := Comp.GroupIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(ePadObject));
  Iter.AddFilter_LayerSet(AllLayers);
  Pad := Iter.FirstPCBObject;
  while Pad <> nil do
  begin
    Result := Result + 1;
    Pad := Iter.NextPCBObject;
  end;
  Comp.GroupIterator_Destroy(Iter);
end;

// Pads do componente com o nome PadNome. Conferir: quantos sao e se TODOS estao em OrigNet
// (Diverge = algum nao esta). Gravar: poe todos em Net (nil = sem net) e devolve quantos.
function NetNosPads(Comp: TObject; PadNome: String; Gravar: Boolean; Net: TObject; OrigNet: String;
  var Diverge: Boolean): Integer;
var
  Iter, Pad: TObject;
begin
  Result := 0;
  Diverge := False;
  Iter := Comp.GroupIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(ePadObject));
  Iter.AddFilter_LayerSet(AllLayers);
  Pad := Iter.FirstPCBObject;
  while Pad <> nil do
  begin
    if Pad.Name = PadNome then
    begin
      Result := Result + 1;
      if not Gravar then
      begin
        if NetDe(Pad) <> OrigNet then
          Diverge := True;
      end
      else
      begin
        PCBServer.SendMessageToRobots(Pad.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
        Pad.Net := Net;
        PCBServer.SendMessageToRobots(Pad.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
      end;
    end;
    Pad := Iter.NextPCBObject;
  end;
  Comp.GroupIterator_Destroy(Iter);
end;

// APOSTA (ver APOSTAS): o footprint da biblioteca no componente novo. Comp.Pattern (escrita) e
// LoadCompFromLibrary / LoadCompFromLibraryWithFileName - os dois nomes foram MEDIDOS no
// Advpcb.dll do AD21 (metodos do componente, na tabela ao lado de AutoPosition_NameComment e
// GetState_PadByName), mas nada disto rodou. Primeiro as bibliotecas instaladas no Altium; nao
// vindo pad nenhum, o arquivo da chave pcblib do home.txt (a mesma do BuildSchematic). False =
// recusado ou sem pad; Etapa diz onde.
function CarregaFootprint(Comp: TObject; Fp: String; var Etapa: String): Boolean;
var
  Lib: String;
begin
  Result := False;
  try
    Etapa := 'IPCB_Component.Pattern';
    Comp.Pattern := Fp;
    Etapa := 'IPCB_Component.LoadCompFromLibrary';
    Comp.LoadCompFromLibrary(True);
    Result := ContaPads(Comp) > 0;
    if not Result then
    begin
      Lib := HomeCfgGet('pcblib');
      if Lib <> '' then
      begin
        Etapa := 'IPCB_Component.LoadCompFromLibraryWithFileName(' + Lib + ')';
        Comp.LoadCompFromLibraryWithFileName(Lib);
        Result := ContaPads(Comp) > 0;
      end
      else
        Etapa := Etapa + ' (sem pad; o home.txt nao tem a chave pcblib para tentar o arquivo)';
    end;
  except
    Result := False;
  end;
end;

// "1=GND;2=VCC" (o campo nets do comp_add) -> cada pad na sua net. Devolve o que nao pegou.
function AplicaNetsDoCampo(Comp: TObject; Campo: String): String;
var
  Resto, Par, PadNome, NetNome: String;
  p, n: Integer;
  Net: TObject;
  Difere: Boolean;
begin
  Result := '';
  Resto := Campo;
  while Resto <> '' do
  begin
    p := Pos(';', Resto);
    if p > 0 then
    begin
      Par := Copy(Resto, 1, p - 1);
      Resto := Copy(Resto, p + 1, Length(Resto));
    end
    else
    begin
      Par := Resto;
      Resto := '';
    end;
    p := Pos('=', Par);
    if p > 1 then
    begin
      PadNome := Copy(Par, 1, p - 1);
      NetNome := Copy(Par, p + 1, Length(Par));
      if NetNome <> '' then
      begin
        Net := FindNet(NetNome);
        if Net = nil then
          MaisProblema(Result, 'net "' + NetNome + '" nao existe (pad ' + PadNome + ' sem net)')
        else
        begin
          n := NetNosPads(Comp, PadNome, True, Net, '', Difere);
          if n = 0 then
            MaisProblema(Result, 'pad "' + PadNome + '" nao existe no footprint');
        end;
      end;
    end;
  end;
end;

procedure DoCompAdd(Line: String);
var
  Comp: TObject;
  Ref, Fp, What, Etapa, Prob: String;
begin
  Ref := JGet(Line, 'ref');
  Fp := JGet(Line, 'footprint');
  What := 'comp_add ' + Ref + ' (' + Fp + ')';
  if (Ref = '') or (Fp = '') or not (JHas(Line, 'x') and JHas(Line, 'y')) then
  begin
    LogFail(What + ': faltam campos ref/footprint/x/y');
    Exit;
  end;
  if FindComponent(Ref) <> nil then
  begin
    LogFail(What + ': ja existe um componente com esse designator (para trocar o footprint, comp_del antes)');
    Exit;
  end;
  Comp := PCBServer.PCBObjectFactory(eComponentObject, eNoDimension, eCreate_Default);
  Etapa := '';
  if not CarregaFootprint(Comp, Fp, Etapa) then
  begin
    LogFail(What + ': o Altium nao carregou o footprint (' + Etapa + ') - confira se a PcbLib da casa esta ' +
      'instalada; senao coloque este pelo Design >> Update PCB Document');
    Exit;
  end;
  Comp.Name.Text := Ref;
  if JHas(Line, 'comment') then
    Comp.Comment.Text := JGet(Line, 'comment');
  Board.AddPCBObject(Comp);
  PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Comp.I_ObjectAddress);
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JGet(Line, 'layer') = 'Bottom' then
    Comp.Layer := eBottomLayer;
  if JHas(Line, 'rot') then
    Comp.Rotation := JNum(Line, 'rot');
  Comp.MoveToXY(MMX(JNum(Line, 'x')), MMY(JNum(Line, 'y')));
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Comp.GraphicallyInvalidate;
  Prob := '';
  if JHas(Line, 'nets') then
    Prob := AplicaNetsDoCampo(Comp, JGet(Line, 'nets'));
  if Prob <> '' then
    LogAviso(What + ': colocado, mas ' + Prob);
  LogOk(What + ' -> x=' + JGet(Line, 'x') + ' y=' + JGet(Line, 'y') + ' rot=' + JGet(Line, 'rot') +
    ' (' + IntToStr(ContaPads(Comp)) + ' pads)');
end;

procedure DoCompDel(Line: String);
var
  Ref, What: String;
  Comp: IPCB_Component;
begin
  Ref := JGet(Line, 'ref');
  What := 'comp_del ' + Ref;
  Comp := FindComponent(Ref);
  if Comp = nil then
  begin
    LogFail(What + ': componente nao encontrado');
    Exit;
  end;
  if not (JHas(Line, 'orig_x') and JHas(Line, 'orig_y') and JHas(Line, 'orig_rot') and JHas(Line, 'orig_layer')) then
  begin
    LogFail(What + ': faltam campos orig_* (copie do board.js)');
    Exit;
  end;
  if not (NearMM(XMM(Comp.x), JNum(Line, 'orig_x')) and NearMM(YMM(Comp.y), JNum(Line, 'orig_y')) and
    NearAngle(Comp.Rotation, JNum(Line, 'orig_rot')) and (LayerNameOf(Comp.Layer) = JGet(Line, 'orig_layer'))) then
  begin
    LogFail(What + ': estado atual da placa nao casa com orig_* (re-exporte o espelho)');
    Exit;
  end;
  if JHas(Line, 'orig_footprint') and (Comp.Pattern <> JGet(Line, 'orig_footprint')) then
  begin
    LogFail(What + ': o footprint na placa e "' + Comp.Pattern + '", nao "' + JGet(Line, 'orig_footprint') + '"');
    Exit;
  end;
  Board.RemovePCBObject(Comp);
  LogOk(What);
end;

procedure DoPadNet(Line: String);
var
  Ref, PadNome, NetNome, What: String;
  Comp: IPCB_Component;
  Net: TObject;
  n: Integer;
  Difere: Boolean;
begin
  Ref := JGet(Line, 'ref');
  PadNome := JGet(Line, 'pad');
  NetNome := JGet(Line, 'net');
  What := 'pad_net ' + Ref + '-' + PadNome + ' -> "' + NetNome + '"';
  Comp := FindComponent(Ref);
  if Comp = nil then
  begin
    LogFail(What + ': componente nao encontrado');
    Exit;
  end;
  if not JHas(Line, 'orig_net') then
  begin
    LogFail(What + ': falta orig_net (a net atual do pad)');
    Exit;
  end;
  n := NetNosPads(Comp, PadNome, False, nil, JGet(Line, 'orig_net'), Difere);
  if n = 0 then
  begin
    LogFail(What + ': o componente nao tem pad "' + PadNome + '"');
    Exit;
  end;
  if Difere then
  begin
    LogFail(What + ': o pad nao esta na net "' + JGet(Line, 'orig_net') + '" (re-exporte o espelho)');
    Exit;
  end;
  Net := nil;
  if NetNome <> '' then
  begin
    Net := FindNet(NetNome);
    if Net = nil then
      LogAviso(What + ': a net nao existe na placa - o pad fica sem net');
  end;
  try
    n := NetNosPads(Comp, PadNome, True, Net, '', Difere);
    LogOk(What + ' (' + IntToStr(n) + ' pad(s))');
  except
    LogFail(What + ': o Altium recusou trocar a net do pad (Pad.Net)');
  end;
end;

procedure DoNetAdd(Line: String);
var
  Nome, What: String;
  Net: TObject;
begin
  Nome := JGet(Line, 'net');
  What := 'net_add "' + Nome + '"';
  if Nome = '' then
  begin
    LogFail('net_add: falta o nome (net)');
    Exit;
  end;
  if FindNet(Nome) <> nil then
  begin
    LogFail(What + ': a net ja existe');
    Exit;
  end;
  try
    Net := PCBServer.PCBObjectFactory(eNetObject, eNoDimension, eCreate_Default);
    Net.Name := Nome;
    Board.AddPCBObject(Net);
    if FindNet(Nome) <> nil then
      LogOk(What)
    else
      LogFail(What + ': criada, mas o FindNet nao a acha (o Altium nao registrou a net)');
  except
    LogFail(What + ': o Altium recusou criar a net (PCBObjectFactory eNetObject / Name)');
  end;
end;

procedure DoNetDel(Line: String);
var
  Nome, What: String;
  Net: TObject;
begin
  Nome := JGet(Line, 'net');
  What := 'net_del "' + Nome + '"';
  Net := FindNet(Nome);
  if Net = nil then
  begin
    LogFail(What + ': a net nao existe na placa');
    Exit;
  end;
  try
    Board.RemovePCBObject(Net);
    LogOk(What + ' (os objetos dela ficam sem net)');
  except
    LogFail(What + ': o Altium recusou remover a net');
  end;
end;

procedure DoNetRename(Line: String);
var
  Velho, Novo, What: String;
  Net: TObject;
begin
  Velho := JGet(Line, 'orig_net');
  Novo := JGet(Line, 'net');
  What := 'net_rename "' + Velho + '" -> "' + Novo + '"';
  Net := FindNet(Velho);
  if Net = nil then
  begin
    LogFail(What + ': a net nao existe na placa');
    Exit;
  end;
  if (Novo = '') or (FindNet(Novo) <> nil) then
  begin
    LogFail(What + ': o nome novo e vazio ou ja e de outra net');
    Exit;
  end;
  try
    Net.Name := Novo;
    if FindNet(Novo) <> nil then
      LogOk(What)
    else
      LogFail(What + ': o nome nao pegou (releitura)');
  except
    LogFail(What + ': o Altium recusou renomear (Net.Name)');
  end;
end;

// formato do pad -> o numero do TopShape que o ExportBoard le (1 redondo, 2 retangulo,
// 3 octogono, 9 retangulo arredondado; oval e o redondo com w <> h)
function FormaDoPad(Nome: String): Integer;
begin
  Result := 1;
  if Nome = 'rect' then
    Result := 2
  else if Nome = 'octagon' then
    Result := 3
  else if Nome = 'roundrect' then
    Result := 9;
end;

// furo -> o numero do HoleType que o ExportBoard le (0 redondo, 1 retangular, 2 slot)
function TipoDoFuro(Nome: String): Integer;
begin
  Result := 0;
  if Nome = 'rect' then
    Result := 1
  else if Nome = 'oblong' then
    Result := 2;
end;

// APOSTA (ver APOSTAS): grava no pad os campos PRESENTES na linha. Os nomes sao os que o
// ExportBoard LE (TopXSize/TopYSize/TopShape, BotXSize..., HoleSize, HoleType, HoleWidth,
// HoleRotation, Plated, Rotation, Name); a escrita nao rodou. Pad passante: a pilha de baixo
// recebe o mesmo (modo simples). False = recusado; Etapa diz onde.
function GravaPad(Pad: TObject; Line: String; Passante: Boolean; var Etapa: String): Boolean;
begin
  Result := False;
  try
    Etapa := 'Pad.x/y';
    if JHas(Line, 'x') then
      Pad.x := MMX(JNum(Line, 'x'));
    if JHas(Line, 'y') then
      Pad.y := MMY(JNum(Line, 'y'));
    Etapa := 'Pad.TopXSize/TopYSize/TopShape';
    if JHas(Line, 'w') then
      Pad.TopXSize := MMsToCoord(JNum(Line, 'w'));
    if JHas(Line, 'h') then
      Pad.TopYSize := MMsToCoord(JNum(Line, 'h'));
    if JHas(Line, 'shape') then
      Pad.TopShape := FormaDoPad(JGet(Line, 'shape'));
    if Passante then
    begin
      Etapa := 'Pad.BotXSize/BotYSize/BotShape';
      Pad.BotXSize := Pad.TopXSize;
      Pad.BotYSize := Pad.TopYSize;
      Pad.BotShape := Pad.TopShape;
      Etapa := 'Pad.HoleSize/HoleType/HoleWidth/HoleRotation';
      if JHas(Line, 'drill') then
        Pad.HoleSize := MMsToCoord(JNum(Line, 'drill'));
      if JHas(Line, 'drillshape') then
        Pad.HoleType := TipoDoFuro(JGet(Line, 'drillshape'));
      if JHas(Line, 'drillw') then
        Pad.HoleWidth := MMsToCoord(JNum(Line, 'drillw'));
      if JHas(Line, 'holerot') then
        Pad.HoleRotation := JNum(Line, 'holerot');
    end;
    Etapa := 'Pad.Rotation';
    if JHas(Line, 'rot') then
      Pad.Rotation := JNum(Line, 'rot');
    Etapa := 'Pad.Name';
    if JHas(Line, 'name') then
      Pad.Name := JGet(Line, 'name');
    Result := True;
  except
    Result := False;
  end;
end;

// APOSTA (ver APOSTAS): furo nao metalizado. Ler Pad.Plated e sonda do ExportBoard; escrever nao rodou.
function GravaMetalizado(Pad: TObject; Quer: Boolean): Boolean;
begin
  Result := False;
  try
    Pad.Plated := Quer;
    Result := Pad.Plated = Quer;
  except
    Result := False;
  end;
end;

procedure DoPadAdd(Line: String);
var
  Pad, Net: TObject;
  Tipo, What, Etapa, NetNome: String;
  L: TLayer;
begin
  Tipo := JGet(Line, 'type');
  What := 'pad_add ' + Tipo + ' (' + JGet(Line, 'x') + ',' + JGet(Line, 'y') + ')';
  if not (JHas(Line, 'x') and JHas(Line, 'y') and JHas(Line, 'w') and JHas(Line, 'h')) then
  begin
    LogFail(What + ': faltam campos x/y/w/h');
    Exit;
  end;
  L := eMultiLayer;
  if Tipo = 'smd' then
  begin
    L := eTopLayer;
    if JGet(Line, 'layer') = 'Bottom' then
      L := eBottomLayer;
  end
  else if not ((Tipo = 'th') or (Tipo = 'npth')) then
  begin
    LogFail(What + ': type deve ser smd, th ou npth');
    Exit;
  end;
  Pad := PCBServer.PCBObjectFactory(ePadObject, eNoDimension, eCreate_Default);
  Pad.Layer := L;
  Etapa := '';
  if not GravaPad(Pad, Line, Tipo <> 'smd', Etapa) then
  begin
    LogFail(What + ': o Altium recusou ' + Etapa);
    Exit;
  end;
  if (Tipo = 'npth') and not GravaMetalizado(Pad, False) then
    LogAviso(What + ': o Altium recusou desligar a metalizacao (Pad.Plated) - o furo ficou PTH; desligue no Properties');
  NetNome := JGet(Line, 'net');
  if (NetNome <> '') and (Tipo <> 'npth') then
  begin
    Net := FindNet(NetNome);
    if Net <> nil then
      Pad.Net := Net
    else
      LogAviso(What + ': net "' + NetNome + '" nao existe na placa - pad sem net');
  end;
  if (JGet(Line, 'shape') = 'roundrect') and JHas(Line, 'radius') then
    LogAviso(What + ': o raio do canto (radius) fica o padrao do Altium - ajuste no Properties');
  Board.AddPCBObject(Pad);
  PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Pad.I_ObjectAddress);
  LogOk(What);
end;

// Pad SOLTO (fora de componente) em (X, Y).
function FindFreePad(X, Y: Double): TObject;
var
  Iter, Prim: TObject;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(ePadObject));
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    if NearMM(XMM(Prim.x), X) and NearMM(YMM(Prim.y), Y) and (DonoDe(Prim) = '') then
    begin
      Result := Prim;
      break;
    end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

procedure DoPadEdit(Line: String);
var
  Pad, Net: TObject;
  What, Etapa, NetNome: String;
begin
  What := 'pad_edit ' + JGet(Line, 'id');
  if not (JHas(Line, 'orig_x') and JHas(Line, 'orig_y')) then
  begin
    LogFail(What + ': faltam orig_x/orig_y');
    Exit;
  end;
  Pad := FindFreePad(JNum(Line, 'orig_x'), JNum(Line, 'orig_y'));
  if Pad = nil then
  begin
    LogFail(What + ': nenhum pad solto em orig_x/orig_y (re-exporte o espelho)');
    Exit;
  end;
  PCBServer.SendMessageToRobots(Pad.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JHas(Line, 'layer') and (Pad.Layer <> eMultiLayer) then
  begin
    if JGet(Line, 'layer') = 'Bottom' then
      Pad.Layer := eBottomLayer
    else if JGet(Line, 'layer') = 'Top' then
      Pad.Layer := eTopLayer;
  end;
  Etapa := '';
  if not GravaPad(Pad, Line, Pad.Layer = eMultiLayer, Etapa) then
    LogFail(What + ': o Altium recusou ' + Etapa + ' (o pad pode ter ficado pela metade)')
  else
  begin
    if JHas(Line, 'net') then
    begin
      NetNome := JGet(Line, 'net');
      Net := nil;
      if NetNome <> '' then
        Net := FindNet(NetNome);
      if (NetNome <> '') and (Net = nil) then
        LogAviso(What + ': net "' + NetNome + '" nao existe na placa - a net do pad nao mudou')
      else
        Pad.Net := Net;
    end;
    LogOk(What);
  end;
  PCBServer.SendMessageToRobots(Pad.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Pad.GraphicallyInvalidate;
end;

procedure DoPadDel(Line: String);
var
  Pad: TObject;
  What: String;
begin
  What := 'pad_del ' + JGet(Line, 'id');
  Pad := FindFreePad(JNum(Line, 'orig_x'), JNum(Line, 'orig_y'));
  if Pad = nil then
  begin
    LogFail(What + ': nenhum pad solto em orig_x/orig_y (re-exporte o espelho)');
    Exit;
  end;
  Board.RemovePCBObject(Pad);
  LogOk(What);
end;

// APOSTA (ver APOSTAS): Comment do componente em Manual (o par do ChangeNameAutoposition, que
// ja rodou no designator_move). False = recusado (o comment se move, mas o Altium pode re-ancorar).
function CommentManual(Comp: TObject): Boolean;
begin
  Result := False;
  try
    Comp.ChangeCommentAutoposition(eAutoPos_Manual);
    Result := True;
  except
    Result := False;
  end;
end;

procedure DoCommentMove(Line: String);
var
  Comp: IPCB_Component;
  Cm: IPCB_Text;
  What, Ref: String;
  cx, cy, dx, dy: Double;
begin
  Ref := JGet(Line, 'ref');
  What := 'comment_move ' + Ref;
  if not (JHas(Line, 'orig_x') and JHas(Line, 'orig_y')) then
  begin
    LogFail(What + ': faltam campos orig_x/orig_y (copie do item do comment em board.js >> texts)');
    Exit;
  end;
  Comp := FindComponent(Ref);
  if Comp = nil then
  begin
    LogFail(What + ': componente nao encontrado');
    Exit;
  end;
  Cm := Comp.Comment;
  cx := (XMM(Cm.BoundingRectangleForSelection.Left) + XMM(Cm.BoundingRectangleForSelection.Right)) / 2;
  cy := (YMM(Cm.BoundingRectangleForSelection.Bottom) + YMM(Cm.BoundingRectangleForSelection.Top)) / 2;
  if not (NearMM(cx, JNum(Line, 'orig_x')) and NearMM(cy, JNum(Line, 'orig_y'))) then
  begin
    LogFail(What + ': comment atual nao casa com orig_* (re-exporte o espelho)');
    Exit;
  end;
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if not CommentManual(Comp) then
    LogAviso(What + ': o Altium recusou o autoposition Manual do comment - ele pode voltar para o lugar automatico');
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  if JHas(Line, 'h') or JHas(Line, 'rot') then
  begin
    PCBServer.SendMessageToRobots(Cm.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
    if JHas(Line, 'h') then
      Cm.Size := MMsToCoord(JNum(Line, 'h'));
    if JHas(Line, 'rot') then
      Cm.Rotation := JNum(Line, 'rot');
    PCBServer.SendMessageToRobots(Cm.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  end;
  if JHas(Line, 'x') or JHas(Line, 'y') then
  begin
    cx := (XMM(Cm.BoundingRectangleForSelection.Left) + XMM(Cm.BoundingRectangleForSelection.Right)) / 2;
    cy := (YMM(Cm.BoundingRectangleForSelection.Bottom) + YMM(Cm.BoundingRectangleForSelection.Top)) / 2;
    dx := 0;
    dy := 0;
    if JHas(Line, 'x') then
      dx := JNum(Line, 'x') - cx;
    if JHas(Line, 'y') then
      dy := JNum(Line, 'y') - cy;
    PCBServer.SendMessageToRobots(Cm.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
    Cm.MoveByXY(MMsToCoord(dx), MMsToCoord(dy));
    PCBServer.SendMessageToRobots(Cm.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  end;
  Comp.GraphicallyInvalidate;
  cx := (XMM(Cm.BoundingRectangleForSelection.Left) + XMM(Cm.BoundingRectangleForSelection.Right)) / 2;
  cy := (YMM(Cm.BoundingRectangleForSelection.Bottom) + YMM(Cm.BoundingRectangleForSelection.Top)) / 2;
  if (JHas(Line, 'x') and (Abs(cx - JNum(Line, 'x')) > 0.01)) or (JHas(Line, 'y') and (Abs(cy - JNum(Line, 'y')) > 0.01)) then
    LogFail(What + ': centro medido (' + FloatToStr(cx) + ',' + FloatToStr(cy) + ') nao chegou no alvo')
  else
    LogOk(What + ' -> centro medido=(' + FloatToStr(cx) + ',' + FloatToStr(cy) + ')');
end;

{ ---- polygon pour (a definicao; o Altium despeja no Rebuild) ---- }

// APOSTA (ver APOSTAS): as propriedades do polygon que o hub manda. PolyHatchStyle por NUMERO
// (TPolyHatchStyle na ordem da documentacao do Altium: Hatch90 0, Hatch45 1, VHatch 2, HHatch 3,
// NoHatch 4, Solid 5 - ordem NAO medida), RemoveDead, PourIndex (a ordem), Name, e no hachurado
// Grid/TrackSize. False = alguma foi recusada; Etapa diz qual.
function PropsDoPoligono(Poly: TObject; Line: String; var Etapa: String): Boolean;
var
  Pour: String;
begin
  Result := False;
  try
    if JHas(Line, 'pour') then
    begin
      Etapa := 'Polygon.PolyHatchStyle';
      Pour := JGet(Line, 'pour');
      if Pour = 'solid' then
        Poly.PolyHatchStyle := HATCH_SOLIDO
      else if Pour = 'none' then
        Poly.PolyHatchStyle := HATCH_NENHUM
      else if JGet(Line, 'con_angulo') = '45' then
        Poly.PolyHatchStyle := HATCH_45
      else
        Poly.PolyHatchStyle := HATCH_90;
    end;
    if JHas(Line, 'hatch_grade') then
    begin
      Etapa := 'Polygon.Grid';
      Poly.Grid := MMsToCoord(JNum(Line, 'hatch_grade'));
    end;
    if JHas(Line, 'hatch_largura') then
    begin
      Etapa := 'Polygon.TrackSize';
      Poly.TrackSize := MMsToCoord(JNum(Line, 'hatch_largura'));
    end;
    if JHas(Line, 'removeDead') then
    begin
      Etapa := 'Polygon.RemoveDead';
      Poly.RemoveDead := JBool(Line, 'removeDead');
    end;
    if JHas(Line, 'ordem') then
    begin
      Etapa := 'Polygon.PourIndex';
      Poly.PourIndex := Trunc(JNum(Line, 'ordem'));
    end;
    if JHas(Line, 'nome') then
    begin
      Etapa := 'Polygon.Name';
      Poly.Name := JGet(Line, 'nome');
    end;
    Result := True;
  except
    Result := False;
  end;
end;

procedure AvisoRegrasDoPoligono(What, Line: String);
begin
  if JHas(Line, 'con_tipo') or JHas(Line, 'clearance') or JHas(Line, 'minArea') then
    LogAviso(What + ': conexao (Relief/Direct), clearance e ilha minima sao REGRAS no Altium ' +
      '(Polygon Connect Style, Clearance) - confira as regras; o polygon nao as carrega');
end;

procedure DoPolyAdd(Line: String);
var
  Poly, Net: TObject;
  Pts: TStringList;
  L: TLayer;
  What, Etapa: String;
begin
  What := 'poly_add ' + JGet(Line, 'layer') + ' ' + JGet(Line, 'net');
  L := CamadaDeDestino(JGet(Line, 'layer'), What, 'o polygon');
  if L = 0 then
    Exit;
  if not EhCobre(L) then
  begin
    LogFail(What + ': polygon pour so em camada de cobre');
    Exit;
  end;
  Pts := ParsePts(Line);
  if Pts.Count < 3 then
  begin
    LogFail(What + ': pts precisa de pelo menos 3 vertices');
    Pts.Free;
    Exit;
  end;
  Poly := PCBServer.PCBObjectFactory(ePolyObject, eNoDimension, eCreate_Default);
  Poly.Layer := L;
  if JGet(Line, 'net') <> '' then
  begin
    Net := FindNet(JGet(Line, 'net'));
    if Net <> nil then
      Poly.Net := Net
    else
      LogAviso(What + ': net nao existe na placa - polygon sem net');
  end;
  GravaSegmentos(Poly, Pts);
  Pts.Free;
  Etapa := '';
  if not PropsDoPoligono(Poly, Line, Etapa) then
    LogAviso(What + ': o Altium recusou ' + Etapa + ' - confira as propriedades do polygon');
  Board.AddPCBObject(Poly);
  PCBServer.SendMessageToRobots(Board.I_ObjectAddress, c_Broadcast, PCBM_BoardRegisteration, Poly.I_ObjectAddress);
  try
    Poly.Rebuild;
  except
    LogAviso(What + ': o despejo (Rebuild) foi recusado - rode Tools >> Polygon Pours >> Repour All');
  end;
  AvisoRegrasDoPoligono(What, Line);
  LogOk(What);
end;

// Polygon de camada L com N vertices e o 1o em (X0,Y0) (a trava orig_* do poly_edit/poly_del)
function FindPoly(L: TLayer; N: Integer; X0, Y0: Double): TObject;
var
  Iter, Prim: TObject;
begin
  Result := nil;
  Iter := Board.BoardIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(ePolyObject));
  Iter.AddFilter_IPCB_LayerSet(LayerSet.AllLayers);
  Iter.AddFilter_Method(eProcessAll);
  Prim := Iter.FirstPCBObject;
  while Prim <> nil do
  begin
    if (Prim.Layer = L) and (Prim.PointCount = N) then
      if NearMM(XMM(Prim.Segments[0].vx), X0) and NearMM(YMM(Prim.Segments[0].vy), Y0) then
      begin
        Result := Prim;
        break;
      end;
    Prim := Iter.NextPCBObject;
  end;
  Board.BoardIterator_Destroy(Iter);
end;

function RequirePolyOrig(Line, What: String): TObject;
var
  L: TLayer;
begin
  Result := nil;
  if not (JHas(Line, 'orig_layer') and JHas(Line, 'orig_n') and JHas(Line, 'orig_x0') and JHas(Line, 'orig_y0')) then
  begin
    LogFail(What + ': faltam orig_layer/orig_n/orig_x0/orig_y0 (copie do board.js >> polygons)');
    Exit;
  end;
  L := LayerFromName(JGet(Line, 'orig_layer'));
  Result := FindPoly(L, Trunc(JNum(Line, 'orig_n')), JNum(Line, 'orig_x0'), JNum(Line, 'orig_y0'));
  if Result = nil then
    LogFail(What + ': nenhum polygon casa com orig_* (re-exporte o espelho)');
end;

procedure DoPolyEdit(Line: String);
var
  Poly, Net: TObject;
  Pts: TStringList;
  L: TLayer;
  What, Etapa: String;
begin
  What := 'poly_edit ' + JGet(Line, 'id');
  Poly := RequirePolyOrig(Line, What);
  if Poly = nil then
    Exit;
  PCBServer.SendMessageToRobots(Poly.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if TemValor(Line, 'layer') then
  begin
    L := CamadaDeDestino(JGet(Line, 'layer'), What, 'o polygon');
    if (L <> 0) and EhCobre(L) then
      Poly.Layer := L;
  end;
  if JHas(Line, 'net') then
  begin
    Net := nil;
    if JGet(Line, 'net') <> '' then
      Net := FindNet(JGet(Line, 'net'));
    Poly.Net := Net;
  end;
  if JHas(Line, 'pts') then
  begin
    Pts := ParsePts(Line);
    if Pts.Count >= 3 then
      GravaSegmentos(Poly, Pts)
    else
      LogAviso(What + ': pts com menos de 3 vertices - o contorno nao mudou');
    Pts.Free;
  end;
  Etapa := '';
  if not PropsDoPoligono(Poly, Line, Etapa) then
    LogAviso(What + ': o Altium recusou ' + Etapa);
  PCBServer.SendMessageToRobots(Poly.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  try
    Poly.Rebuild;
  except
    LogAviso(What + ': o despejo (Rebuild) foi recusado - rode Tools >> Polygon Pours >> Repour All');
  end;
  AvisoRegrasDoPoligono(What, Line);
  LogOk(What);
end;

procedure DoPolyDel(Line: String);
var
  Poly: TObject;
  What: String;
begin
  What := 'poly_del ' + JGet(Line, 'id');
  Poly := RequirePolyOrig(Line, What);
  if Poly = nil then
    Exit;
  Board.RemovePCBObject(Poly);
  LogOk(What + ' (o cobre despejado sai junto)');
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

  // Sonda da numeracao das camadas (ver "Camadas"): as 7 constantes que este arquivo sempre
  // usou dizem se a conta das camadas novas vale nesta versao do Altium.
  CamadasNumeradas := (eTopLayer = 1) and (eBottomLayer = 32) and (eTopOverlay = 33) and
    (eBottomOverlay = 34) and (eKeepOutLayer = 56) and (eMechanical1 = CAM_MECH1) and (eMultiLayer = 74);
  // Sonda da numeracao dos tipos de objeto (OBJ_FILL, ver APOSTAS): os tipos que ja rodaram neste
  // repositorio tem de estar na posicao da lista do PCB API. Com o texto no 5 e a net no 8, o 6
  // e o fill (o 7 e a conexao do ratsnest); o ObjectId do fill criado e conferido de novo.
  ObjetosNumerados := (eArcObject = 1) and (ePadObject = 2) and (eViaObject = 3) and (eTrackObject = 4) and
    (eTextObject = 5) and (eNetObject = 8) and (eComponentObject = 9);
  SondaFalhou := '';
  SegmentosNumerados := ePolySegmentLine = 0;
  KindRecorteN := -2;
  KindRecorteOrigem := '';
  KindRecorteConferido := False;
  OkCount := 0;
  FailCount := 0;
  AvisoCount := 0;
  Recognized := 0;

  Report := TStringList.Create;
  Report.Add('NexoEletric - relatorio de aplicacao');
  Report.Add('Placa: ' + Board.FileName);
  Report.Add('Data:  ' + DateTimeToStr(Now));
  Report.Add('');
  if not CamadasNumeradas then
  begin
    LogAviso('A numeracao das camadas desta versao do Altium nao e a esperada (Top=' +
      IntToStr(eTopLayer) + ' Bottom=' + IntToStr(eBottomLayer) + ' KeepOut=' + IntToStr(eKeepOutLayer) +
      ' Mech1=' + IntToStr(eMechanical1) + ' Multi=' + IntToStr(eMultiLayer) + ').');
    Report.Add('        Nesta rodada valem so Top, Bottom, TopOverlay, BottomOverlay, Multi, Mech1 e KeepOut;');
    Report.Add('        as outras (Mid, Plane, Mech2..16, Paste, Solder, DrillGuide, DrillDrawing) sao recusadas.');
    Report.Add('');
  end;
  if not ObjetosNumerados then
  begin
    LogAviso('A numeracao dos tipos de objeto desta versao do Altium nao e a esperada (arco=' +
      IntToStr(eArcObject) + ' trilha=' + IntToStr(eTrackObject) + ' texto=' + IntToStr(eTextObject) +
      ' net=' + IntToStr(eNetObject) + ' componente=' + IntToStr(eComponentObject) + ').');
    Report.Add('        Nesta rodada fill_add, fill_edit e fill_del sao recusados: o tipo fill vai pelo numero');
    Report.Add('        (OBJ_FILL = ' + IntToStr(OBJ_FILL) + '), e a conta so vale com essa numeracao.');
    Report.Add('');
  end;

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

    // REDE DE SEGURANCA: um erro do Altium no meio de UMA operacao vira FALHA dela, e as outras
    // seguem. Sem isto o erro derrubava o script entre o PreProcess e o PostProcess - placa
    // aplicada pela metade, sem relatorio, e o undo da aplicacao inteira quebrado. Cada chamada
    // nova ja tem o seu try (com a mensagem certa); este pega o que ninguem previu.
    try
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
      else if Op = 'text_add' then
        DoTextAdd(Line)
      else if Op = 'text_del' then
        DoTextDel(Line)
      else if Op = 'designator_move' then
        DoDesignatorMove(Line)
      else if Op = 'outline_set' then
        DoOutlineSet(Line)
      else if Op = 'fill_add' then
        DoFillAdd(Line)
      else if Op = 'fill_edit' then
        DoFillEdit(Line)
      else if Op = 'fill_del' then
        DoFillDel(Line)
      else if Op = 'region_add' then
        DoRegionAdd(Line)
      else if Op = 'region_del' then
        DoRegionDel(Line)
      else if Op = 'comp_add' then
        DoCompAdd(Line)
      else if Op = 'comp_del' then
        DoCompDel(Line)
      else if Op = 'pad_net' then
        DoPadNet(Line)
      else if Op = 'net_add' then
        DoNetAdd(Line)
      else if Op = 'net_del' then
        DoNetDel(Line)
      else if Op = 'net_rename' then
        DoNetRename(Line)
      else if Op = 'pad_add' then
        DoPadAdd(Line)
      else if Op = 'pad_edit' then
        DoPadEdit(Line)
      else if Op = 'pad_del' then
        DoPadDel(Line)
      else if Op = 'comment_move' then
        DoCommentMove(Line)
      else if Op = 'poly_add' then
        DoPolyAdd(Line)
      else if Op = 'poly_edit' then
        DoPolyEdit(Line)
      else if Op = 'poly_del' then
        DoPolyDel(Line)
      else if Op = 'comp_attr' then
        AttrLines.Add(Line)   // renames por ultimo: FindComponent casa por Name.Text
      else
        LogFail('operacao desconhecida: "' + Op + '"');
    except
      LogFail(Op + ' (linha ' + IntToStr(i + 1) + ' do changes.js): o Altium deu erro no meio da operacao - ' +
        'ela pode ter ficado pela metade; confira esse objeto na placa. As outras mudancas seguiram.');
    end;
  end;

  // comp_attr aplicado por ultimo (renomear designator cedo quebraria refs das ops seguintes)
  for i := 0 to AttrLines.Count - 1 do
  begin
    try
      DoCompAttr(AttrLines[i]);
    except
      LogFail('comp_attr ' + JGet(AttrLines[i], 'ref') + ': o Altium deu erro no meio da operacao - ' +
        'confira o componente na placa. As outras mudancas seguiram.');
    end;
  end;

  PCBServer.PostProcess;

  Client.SendMessage('PCB:Zoom', 'Action=Redraw', 255, Client.CurrentView);

  Report.Add('');
  Report.Add('Mudancas reconhecidas: ' + IntToStr(Recognized));
  Report.Add('Aplicadas com sucesso: ' + IntToStr(OkCount));
  Report.Add('Falhas:                ' + IntToStr(FailCount));
  Report.Add('Avisos:                ' + IntToStr(AvisoCount));
  // As mudancas ja estao na placa; so o relatorio depende da raiz do workspace.
  Gravou := SalvaOuExplica(Report, OutDir + '\apply-report.txt');
  if Gravou then
    RelTxt := 'Relatorio: ' + OutDir + '\apply-report.txt'
  else
    RelTxt := 'O relatorio NAO pode ser gravado (o aviso anterior diz por que).';
  // Os [AVISO] sao o resultado das sondas desta rodada (camadas, tipo fill, Kind do recorte,
  // fonte do texto...): o dialogo diz quantos sao, para o relatorio ser aberto.
  if Gravou and (AvisoCount > 0) then
    RelTxt := IntToStr(AvisoCount) + ' aviso(s) [AVISO] no relatorio - leia antes de seguir.' + #13#10 + RelTxt;

  if Gravou then
    RegenerateProjectsIndex(ExtractFileName(OutDir));

  ShowMessage('Aplicacao concluida.' + #13#10#13#10 +
    'Reconhecidas: ' + IntToStr(Recognized) + #13#10 +
    'OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount) + '   Avisos: ' + IntToStr(AvisoCount) +
    #13#10#13#10 +
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
// "op"), para os dois nunca discordarem sobre o que e uma mudanca. Mora ANTES da janela
// de escolha porque a etiqueta [PCB] da lista usa o mesmo criterio.
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

// Janela com a lista de projetos de Projects\ (selecao por clique).
// Retorna o nome escolhido; '' se o usuario cancelar.
function PickProjectName(Dirs: TStringList): String;
var
  F: TForm;
  LB: TListBox;
  BOk, BCan: TButton;
  Lbl: TLabel;
  i, res: Integer;
  Nome, Tag, Foco: String;
begin
  Result := '';
  F := TForm.Create(nil);
  F.Caption := 'NexoEletric - escolha o projeto';
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
    // pelo CONTEUDO: o changes.js sempre existe, e a etiqueta aparecia em todo projeto
    if ChangesTemOps(PROJECTS_DIR + '\' + Nome + '\changes.js') then
      Tag := Tag + '   [PCB]';
    LB.Items.Add(Nome + Tag);
  end;
  if LB.Items.Count > 0 then
    LB.ItemIndex := 0;
  // O PROJETO FOCADO VEM MARCADO, e nao o primeiro da lista. Com o primeiro marcado, quem
  // apertava Aplicar sem olhar levava o que viesse primeiro na ordem alfabetica - e foi
  // assim, duas vezes, que o esquema do DMB (o primeiro da lista) foi mandado para outro
  // projeto: com o PAEL focado em 16/09 e com o PCB_Project_1 em 2026-09-23.
  Foco := FocusedProjectName(0);
  if Foco <> '' then
    for i := 0 to Dirs.Count - 1 do
      if AnsiCompareText(Dirs[i], Foco) = 0 then
        LB.ItemIndex := i;

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

procedure ApplyProject;
var
  Dirs: TStringList;
  Nome, Dir, Foco: String;
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

  // TRAVA: A PASTA ESCOLHIDA TEM DE SER A DO PROJETO FOCADO. O esquema e despejado no
  // projeto que esta FOCADO no Altium, e o changes.js e aplicado na placa FOCADA - a pasta
  // escolhida so diz de onde vem o conteudo. Nada comparava os dois: o build-report de
  // 16/09 registra o esquema do DMB indo para o PAEL, e o de 2026-09-23 16:14, para o
  // PCB_Project_1. So nao criaram nada porque a validacao falhou por outro motivo.
  //
  // Nome diferente nao e sempre engano (a pasta pode ter nascido com outro nome), entao a
  // trava pergunta em vez de recusar - com SIM digitado, como o outline_set, porque um
  // Enter distraido e exatamente o erro que ela existe para pegar. Sem projeto focado
  // ('' - Free Documents), nao ha com o que comparar, e quem reclama e o passo seguinte.
  Foco := FocusedProjectName(0);
  if (Foco <> '') and (AnsiCompareText(Foco, Nome) <> 0) then
    if not ConfirmNoYes('O projeto FOCADO no Altium e:' + #13#10 +
      '   ' + Foco + #13#10#13#10 +
      'mas a pasta escolhida e:' + #13#10 +
      '   ' + Nome + #13#10#13#10 +
      'Seguir despeja o conteudo de "' + Nome + '" DENTRO de "' + Foco + '".' + #13#10 +
      'Para usar o projeto certo: cancele, clique nele no painel Projects e rode de novo.') then
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

