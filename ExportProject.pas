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
  // Caminho como visto do PC que RODA o Altium (workspace fica no LUCAS-PC).
  SCRIPT_HOME = '\\LUCAS-PC\D\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror';
  PROJECTS_DIR = '\\LUCAS-PC\D\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror\Projects';

var
  SkippedDocs: Integer;
  ScanInfo: String; // diagnostico do ultimo ListProjectDirs (aparece nos dialogos)

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

{ ------------------------------- mapeamentos Sch ------------------------------- }

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

{ ------------------------------- exportacao de uma folha ------------------------------- }

procedure ExportSheet(Path: String; ItemsL: TStringList);
var
  SchDoc: ISch_Document;
  Iterator, Prim: TObject;
  SheetName, s, pts: String;
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

  AddItem(ItemsL, '{"t":"sheet","name":' + JS(SheetName) + ',"size":' + JS(SheetSizeName(SchDoc.SheetStyle)) + '}');

  Iterator := SchDoc.SchIterator_Create;
  Iterator.AddFilter_ObjectSet(MkSet(eSchComponent, eWire, eNetLabel, ePowerObject, eJunction, eLabel));
  Prim := Iterator.FirstSchObject;
  while Prim <> nil do
  begin
    case Prim.ObjectId of
      eSchComponent:
        begin
          s := '{"t":"comp","sheet":' + JS(SheetName) +
            ',"ref":' + JS(Prim.Designator.Text) +
            ',"sym":' + JS(Prim.LibReference) +
            ',"part":' + IntToStr(Prim.CurrentPartID) +
            ',"x":' + ML(Prim.Location.X) +
            ',"y":' + ML(Prim.Location.Y) +
            ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) +
            ',"mirror":' + JB(Prim.IsMirrored) +
            ',"footprint":' + JS(CurrentFootprintOf(Prim)) +
            ',"comment":' + JS(Prim.Comment.Text) + '}';
          AddItem(ItemsL, s);
        end;
      eWire:
        begin
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
        AddItem(ItemsL, '{"t":"netlabel","sheet":' + JS(SheetName) +
          ',"net":' + JS(Prim.Text) +
          ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
          ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) + '}');
      ePowerObject:
        AddItem(ItemsL, '{"t":"power","sheet":' + JS(SheetName) +
          ',"net":' + JS(Prim.Text) +
          ',"style":' + JS(PowerStyleName(Prim.Style)) +
          ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
          ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) + '}');
      eJunction:
        AddItem(ItemsL, '{"t":"junction","sheet":' + JS(SheetName) +
          ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) + '}');
      eLabel:
        AddItem(ItemsL, '{"t":"text","sheet":' + JS(SheetName) +
          ',"s":' + JS(Prim.Text) +
          ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
          ',"h":10}');
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
  ProjName, OutDir: String;
  ItemsL, OutL: TStringList;
begin
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
  OutL.SaveToFile(OutDir + '\schematic.js');
  OutL.Free;
  ItemsL.Free;

  RegenerateProjectsIndex(ProjName);

  ShowMessage('Esquema espelhado em:' + #13#10 + OutDir + '\schematic.js' + #13#10#13#10 +
    'Folhas: ' + IntToStr(SheetCount) +
    '   (nao abertas/puladas: ' + IntToStr(SkippedDocs) + ')' + #13#10#13#10 +
    'PCB: rode o ExportBoard com o .PcbDoc focado.' + #13#10 +
    'Confira no hub.html (vista Esquema).');
end;
