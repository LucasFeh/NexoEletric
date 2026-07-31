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
  // Pasta onde este script esta instalado. AJUSTE AQUI se instalar em outro lugar.
  SCRIPT_HOME = 'Z:\AltiumPCBMirror';
  PROJECTS_DIR = 'Z:\AltiumPCBMirror\Projects';
  FORMAT_ID = 'pcbmirror-v1';

var
  Board: IPCB_Board;
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

// preenche Dirs com os nomes das subpastas de Projects\
procedure ListProjectDirs(Dirs: TStringList);
var
  SR: TSearchRec;
  r: Integer;
begin
  Dirs.Clear;
  r := FindFirst(PROJECTS_DIR + '\*', faDirectory, SR);
  while r = 0 do
  begin
    if ((SR.Attr and faDirectory) <> 0) and (SR.Name <> '.') and (SR.Name <> '..') then
      Dirs.Add(SR.Name);
    r := FindNext(SR);
  end;
  FindClose(SR);
end;

// nome do projeto focado no Workspace ('' se nenhum / Free Documents)
function FocusedProjectName: String;
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
    ShowMessage('Nenhum projeto em ' + PROJECTS_DIR + '.' + #13#10 +
      'Rode um export ou peca um projeto novo a IA primeiro.');
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
procedure RegenerateProjectsIndex;
var
  Dirs, Ou: TStringList;
  i: Integer;
  d, line: String;
begin
  Dirs := TStringList.Create;
  ListProjectDirs(Dirs);
  Dirs.Sort;
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

procedure ExportBoard;
var
  OutDir: String;
  ProjName: String;
  Iter, Prim: TObject;
  CompL, FreePadL, TrackL, ArcL, ViaL, TextL, SilkL, RegionL, CsvL, OutL: TStringList;
  CompIdx, PadIdx, TrackIdx, ArcIdx, ViaIdx, TextIdx, SilkIdx, RegionIdx: Integer;
  i: Integer;
  s, Id: String;
begin
  Board := PCBServer.GetCurrentPCBBoard;
  if Board = nil then
  begin
    ShowMessage('Nenhum documento PCB aberto/focado. Abra o .PcbDoc e rode novamente.');
    Exit;
  end;

  ProjName := FocusedProjectName;
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
  CsvL := TStringList.Create;

  CompIdx := 0;
  PadIdx := 0;
  TrackIdx := 0;
  ArcIdx := 0;
  ViaIdx := 0;
  TextIdx := 0;
  SilkIdx := 0;
  RegionIdx := 0;

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
          if (Prim.Kind() = eRegionKind_Copper) and (not Prim.InPolygon()) then
          begin
            RegionIdx := RegionIdx + 1;
            AddItem(RegionL, ContourJSON(Prim, 'g' + IntToStr(RegionIdx), NetNameOf(Prim)));
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

  OutL.Add('"stats":{"components":' + IntToStr(CompIdx) + ',"freepads":' + IntToStr(PadIdx) +
    ',"tracks":' + IntToStr(TrackIdx) + ',"arcs":' + IntToStr(ArcIdx) + ',"vias":' + IntToStr(ViaIdx) +
    ',"texts":' + IntToStr(TextIdx) + ',"silk":' + IntToStr(SilkIdx) + ',"regions":' + IntToStr(RegionIdx) + '}');
  OutL.Add('};');

  OutL.SaveToFile(OutDir + '\board.js');

  // ------------------------------------------------------------------ changes.js (apenas se nao existir)
  if not FileExists(OutDir + '\changes.js') then
  begin
    OutL.Clear;
    OutL.Add('// AltiumPCBMirror - arquivo de mudancas.');
    OutL.Add('// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.');
    OutL.Add('var changes = [');
    OutL.Add('];');
    OutL.SaveToFile(OutDir + '\changes.js');
  end;

  // ------------------------------------------------------------------ pcb-list.csv
  CsvL.SaveToFile(OutDir + '\pcb-list.csv');

  RegenerateProjectsIndex;

  s := 'Exportacao concluida em:' + #13#10 + OutDir + #13#10#13#10 +
    'Componentes: ' + IntToStr(CompIdx) + #13#10 +
    'Trilhas: ' + IntToStr(TrackIdx) + '   Arcos: ' + IntToStr(ArcIdx) + '   Vias: ' + IntToStr(ViaIdx) + #13#10 +
    'Silk: ' + IntToStr(SilkIdx) + '   Textos: ' + IntToStr(TextIdx) + '   Regioes: ' + IntToStr(RegionIdx) + #13#10 +
    'Pads livres: ' + IntToStr(PadIdx) + #13#10#13#10 +
    'Confira no hub.html (vista PCB).';
  ShowMessage(s);

  CompL.Free;
  FreePadL.Free;
  TrackL.Free;
  ArcL.Free;
  ViaL.Free;
  TextL.Free;
  SilkL.Free;
  RegionL.Free;
  CsvL.Free;
  OutL.Free;
  Nets.Free;
end;
