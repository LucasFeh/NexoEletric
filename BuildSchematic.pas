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
  SCRIPT_HOME = 'Z:\AltiumPCBMirror';
  PROJECTS_DIR = 'Z:\AltiumPCBMirror\Projects';
  SCHLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib';
  PCBLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE FOOTPRINT.PcbLib';

var
  Report: TStringList;
  OkCount, FailCount: Integer;
  SchLibDoc: ISch_Document;
  ScanInfo: String; // diagnostico do ultimo ListProjectDirs (aparece nos dialogos)
  PcbFpNames: TStringList;   // nil = PcbLib indisponivel (validacao de footprint vira aviso)

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

// valor de "name":"..." numa linha do projects.js ('' se a linha nao tiver)
function NameFieldOf(Line: String): String;
var
  p, l: Integer;
begin
  Result := '';
  p := Pos('"name":"', Line);
  if p = 0 then
    Exit;
  p := p + 8;
  l := Length(Line);
  while (p <= l) and (Line[p] <> '"') do
  begin
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
  Ou.SaveToFile(SCRIPT_HOME + '\projects.js');
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

function SheetStyleFromName(s: String): Integer;
begin
  Result := eSheetA4;
  if s = 'A3' then
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

function OpenSchLib(Dummy: Integer): Boolean;
begin
  Result := False;
  if SchServer = nil then
    Exit;
  SchLibDoc := SchServer.GetSchDocumentByPath(SCHLIB_FILE);
  if SchLibDoc = nil then
    SchLibDoc := SchServer.LoadSchDocumentByPath(SCHLIB_FILE);
  Result := SchLibDoc <> nil;
end;

function FindLibSymbol(Name: String): ISch_Component;
var
  Iterator, Comp: TObject;
begin
  Result := nil;
  Iterator := SchLibDoc.SchLibIterator_Create;
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
  SchLibDoc.SchIterator_Destroy(Iterator);
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

procedure PlaceComp(SchDoc: ISch_Document; Line: String);
var
  LibComp, NewComp: TObject;
  Ref: String;
  PartId: Integer;
begin
  Ref := JGet(Line, 'ref');
  PartId := 1;
  if JHas(Line, 'part') then
    PartId := Round(JNum(Line, 'part'));
  if PartId < 1 then
    PartId := 1;
  // ja existe na folha (re-despejo): nao duplica, so a passada 2b reposiciona
  if FindCompInDoc(SchDoc, Ref, PartId) <> nil then
  begin
    LogOk('comp ' + Ref + '/' + IntToStr(PartId) + ' ja existia - sera reposicionado');
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
  Ref, Lidos: String;
  PartId, TX, TY: Integer;
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
  // Tentativas COM LEITURA DE VOLTA: o relatorio passa a dizer onde o componente
  // REALMENTE ficou, em vez de so repetir o que foi pedido.
  C.Location := Point(TX, TY);
  Lidos := 'Location=' + IntToStr(C.Location.X) + ',' + IntToStr(C.Location.Y);
  if (C.Location.X <> TX) or (C.Location.Y <> TY) then
  begin
    C.MoveToXY(TX, TY);
    Lidos := Lidos + ' | MoveToXY=' + IntToStr(C.Location.X) + ',' + IntToStr(C.Location.Y);
  end;
  // Location/MoveToXY podem mover so a ancora e deixar as primitivas do simbolo
  // na origem. MoveByXY move ancora + primitivas: zera e move relativo.
  try
    C.Location := Point(0, 0);
    C.MoveByXY(TX, TY);
    Lidos := Lidos + ' | MoveByXY=' + IntToStr(C.Location.X) + ',' + IntToStr(C.Location.Y);
  except
    C.Location := Point(TX, TY);
    Lidos := Lidos + ' | MoveByXY indisponivel';
  end;
  SchServer.RobotManager.SendMessage(C.I_ObjectAddress, c_BroadCast,
    SCHM_EndModify, c_NoEventData);
  C.GraphicallyInvalidate;
  if (C.Location.X = TX) and (C.Location.Y = TY) then
    LogOk('posicao ' + Ref + '/' + IntToStr(PartId) + ' -> ' +
      JGet(Line, 'x') + ',' + JGet(Line, 'y') + ' rot ' + JGet(Line, 'rot'))
  else
    LogFail('posicao ' + Ref + '/' + IntToStr(PartId) + ': pedido ' +
      IntToStr(TX) + ',' + IntToStr(TY) + ' mas ficou ' + Lidos);
end;

// Confirmacao digitada (usa so primitivas provadas neste engine)
function ConfirmTypedYes(Msg: String): Boolean;
var
  s: String;
begin
  s := Trim(InputBox('AltiumPCBMirror', Msg + #13#10#13#10 + 'Digite SIM para confirmar:', ''));
  Result := (AnsiCompareText(s, 'SIM') = 0);
end;

// Remove da folha os objetos que este script cria (componentes, fios, rotulos,
// power ports, junctions e textos). O template/carimbo da folha NAO e tocado.
// Serve para re-despejar sem duplicar o que ja foi despejado antes.
procedure ClearDumpedObjects(SchDoc: ISch_Document);
var
  Iter, Obj: TObject;
  Lst: TStringList;
  i, n: Integer;
begin
  Lst := TStringList.Create;
  Iter := SchDoc.SchIterator_Create;
  if Iter <> nil then
  begin
    Iter.AddFilter_ObjectSet(MkSet(eSchComponent, eWire, eNetLabel, ePowerObject,
      eJunction, eLabel));
    Obj := Iter.FirstSchObject;
    while Obj <> nil do
    begin
      Lst.AddObject('x', Obj);
      Obj := Iter.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iter);
  end;
  n := 0;
  for i := 0 to Lst.Count - 1 do
  begin
    Obj := Lst.Objects[i];
    // so RemoveSchObject: a constante SCHM_PrimitiveDeRegistration nao existe
    // neste engine (a de registro existe) e derruba o script em execucao.
    SchDoc.RemoveSchObject(Obj);
    n := n + 1;
  end;
  Lst.Free;
  SchDoc.GraphicallyInvalidate;
  LogOk('limpeza: ' + IntToStr(n) + ' objetos removidos da folha');
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

procedure PlaceText(SchDoc: ISch_Document; Line: String);
var
  L: TObject;
begin
  L := SchServer.SchObjectFactory(eLabel, eCreate_GlobalCopy);
  if L = nil then
  begin
    LogFail('text: factory falhou');
    Exit;
  end;
  L.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
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
  ProjFolder, SchFile, Line, T, SheetName, TargetPath: String;
  Src, Syms, Fps, Refs, SheetNames, SheetSizes, Pts, ItemSheets: TStringList;
  i, si, ErrCount, PartId: Integer;
  ServerDoc: IServerDocument;
  SchDoc: ISch_Document;
begin
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
    else if (T = 'netlabel') or (T = 'power') then
    begin
      if JGet(Line, 'net') = '' then
      begin
        Report.Add('[ERRO] ' + T + ' sem net: ' + Line);
        ErrCount := ErrCount + 1;
      end;
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
    ShowMessage('Nao consegui abrir a SchLib:' + #13#10 + SCHLIB_FILE + #13#10 +
      'Abra a biblioteca no Altium e rode de novo.');
    Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
    Exit;
  end;
  for i := 0 to Syms.Count - 1 do
    if FindLibSymbol(Syms[i]) = nil then
    begin
      Report.Add('[ERRO] simbolo "' + Syms[i] + '" nao existe na SchLib');
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
    Report.SaveToFile(ProjDir + '\build-report.txt');
    ShowMessage('Validacao falhou com ' + IntToStr(ErrCount) + ' erro(s) - nada foi criado.' + #13#10 +
      'Veja ' + ProjDir + '\build-report.txt');
    if PcbFpNames <> nil then
      PcbFpNames.Free;
    Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
    Exit;
  end;
  Report.Add('Validacao OK (' + IntToStr(SheetNames.Count) + ' folha(s)).');
  Report.Add('');

  { ---------------- PASSO 2: despejo folha a folha ----------------
    O usuario escolhe um .SchDoc JA EXISTENTE do projeto (o carimbo/template dele
    e preservado). Dentro da folha o despejo e em duas passadas:
      2a) coloca os simbolos (ou reaproveita o que ja tem o mesmo designador/parte)
      2b) so entao aplica posicao/orientacao/espelho de cada um, conforme o .js
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
    SchDoc.SheetStyle := SheetStyleFromName(SheetSizes[si]);

    SchServer.ProcessControl.PreProcess(SchDoc, '');
    if ConfirmTypedYes('Limpar o conteudo ja despejado nesta folha antes?' + #13#10 +
      '(componentes, fios, rotulos, power ports e textos - o carimbo/template fica)' + #13#10 +
      'Responda SIM se voce ja despejou este projeto aqui antes.') then
      ClearDumpedObjects(SchDoc);
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
      else if T = 'junction' then
        PlaceJunction(SchDoc, Line)
      else if T = 'text' then
        PlaceText(SchDoc, Line);
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
    SchServer.ProcessControl.PostProcess(SchDoc, '');
    SchDoc.GraphicallyInvalidate;

    if not ServerDoc.DoFileSave('SCH') then
      LogFail('folha ' + SheetName + ': falha ao salvar ' + TargetPath)
    else
      LogOk('folha ' + SheetName + ' despejada em: ' + TargetPath);
  end;

  Report.Add('');
  Report.Add('OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount));
  Report.SaveToFile(ProjDir + '\build-report.txt');
  RegenerateProjectsIndex(ExtractFileName(ProjDir));

  ShowMessage('Esquema despejado.' + #13#10 +
    'OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount) + #13#10#13#10 +
    'Relatorio: ' + ProjDir + '\build-report.txt' + #13#10#13#10 +
    'PROXIMOS PASSOS: salve (Ctrl+S), rode Project >> Compile,' + #13#10 +
    'e depois Design >> Update PCB (ECO) para levar tudo a placa.');

  Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
  if PcbFpNames <> nil then
    PcbFpNames.Free;
end;
