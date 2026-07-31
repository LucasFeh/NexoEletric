{ ..................................................................................................................... }
{ .  AltiumPCBMirror - ExportLibs.pas                                                                                 . }
{ .                                                                                                                   . }
{ .  Espelha as bibliotecas do usuario para o workspace central:                                                      . }
{ .    Libs\schlib.js   : simbolos (pinos, graficos, modelos de footprint) - unidade: MIL                             . }
{ .    Libs\pcblib.js   : footprints (pads, silk, bbox) - unidade: MM (corpos 3D ficam de fora)                       . }
{ .    Libs\libs-report.txt : simbolos sem footprint valido na PcbLib                                                 . }
{ .                                                                                                                   . }
{ .  Rode de novo sempre que alterar as bibliotecas. Se der erro de servidor, abra as duas                            . }
{ .  bibliotecas no Altium (File >> Open) e rode novamente.                                                           . }
{ .                                                                                                                   . }
{ .  Como executar: DXP >> Run Script >> ExportLibs                                                                   . }
{ ..................................................................................................................... }

const
  // AJUSTE AQUI se as bibliotecas mudarem de lugar.
  SCRIPT_HOME = 'Z:\AltiumPCBMirror';
  OUT_DIR = 'Z:\AltiumPCBMirror\Libs';
  SCHLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib';
  PCBLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE FOOTPRINT.PcbLib';

var
  FpNames: TStringList;   // nomes de footprint presentes na PcbLib (para o crosscheck)
  NoFpList: TStringList;  // simbolos sem footprint valido
  SymCount, FpCount: Integer;

{ ------------------------------- helpers JSON / numeros (copia do ExportBoard) ------------------------------- }

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

// coordenada interna -> mil (esquema) / mm (pcb)
function ML(v: Integer): String;
begin
  Result := JF(CoordToMils(v));
end;

function MM(v: Integer): String;
begin
  Result := JF(CoordToMMs(v));
end;

procedure AddItem(Section: TStringList; Line: String);
begin
  if Section.Count > 0 then
    Section.Add(',' + Line)
  else
    Section.Add(Line);
end;

{ ------------------------------- mapeamentos Sch ------------------------------- }

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

function ElecName(e: TPinElectrical): String;
begin
  if e = eElectricInput then
    Result := 'Input'
  else if e = eElectricIO then
    Result := 'IO'
  else if e = eElectricOutput then
    Result := 'Output'
  else if e = eElectricOpenCollector then
    Result := 'OpenCollector'
  else if e = eElectricHiZ then
    Result := 'HiZ'
  else if e = eElectricOpenEmitter then
    Result := 'OpenEmitter'
  else if e = eElectricPower then
    Result := 'Power'
  else
    Result := 'Passive';
end;

// largura de linha do Sch (enum TSize) -> mil aproximado
function LineWMil(w: Integer): String;
begin
  if w <= 0 then
    Result := '4'
  else if w = 1 then
    Result := '10'
  else if w = 2 then
    Result := '20'
  else
    Result := '30';
end;

{ ------------------------------- serializacao SchLib ------------------------------- }

function PinJSON(Pin: TObject): String;
begin
  Result := '{"num":' + JS(Pin.Designator) +
    ',"name":' + JS(Pin.Name) +
    ',"x":' + ML(Pin.Location.X) +
    ',"y":' + ML(Pin.Location.Y) +
    ',"len":' + ML(Pin.PinLength) +
    ',"orient":' + IntToStr(RotDegOf(Pin.Orientation)) +
    ',"type":' + JS(ElecName(Pin.Electrical)) + '}';
end;

function GraphJSON(Prim: TObject): String;
var
  s: String;
  k: Integer;
begin
  Result := '';
  case Prim.ObjectId of
    eLine:
      Result := '{"g":"line","x1":' + ML(Prim.Location.X) + ',"y1":' + ML(Prim.Location.Y) +
        ',"x2":' + ML(Prim.Corner.X) + ',"y2":' + ML(Prim.Corner.Y) +
        ',"w":' + LineWMil(Prim.LineWidth) + '}';
    eRectangle:
      Result := '{"g":"rect","x1":' + ML(Prim.Location.X) + ',"y1":' + ML(Prim.Location.Y) +
        ',"x2":' + ML(Prim.Corner.X) + ',"y2":' + ML(Prim.Corner.Y) +
        ',"solid":' + JB(Prim.IsSolid) + '}';
    eArc:
      Result := '{"g":"arc","cx":' + ML(Prim.Location.X) + ',"cy":' + ML(Prim.Location.Y) +
        ',"r":' + ML(Prim.Radius) + ',"sa":' + JF(Prim.StartAngle) + ',"ea":' + JF(Prim.EndAngle) +
        ',"w":' + LineWMil(Prim.LineWidth) + '}';
    eEllipse:
      Result := '{"g":"ellipse","cx":' + ML(Prim.Location.X) + ',"cy":' + ML(Prim.Location.Y) +
        ',"rx":' + ML(Prim.Radius) + ',"ry":' + ML(Prim.SecondaryRadius) +
        ',"solid":' + JB(Prim.IsSolid) + '}';
    ePolygon:
      begin
        s := '';
        for k := 1 to Prim.VerticesCount do
        begin
          if s <> '' then
            s := s + ',';
          s := s + '[' + ML(Prim.Vertex[k].X) + ',' + ML(Prim.Vertex[k].Y) + ']';
        end;
        Result := '{"g":"poly","pts":[' + s + '],"solid":true}';
      end;
    ePolyline:
      begin
        s := '';
        for k := 1 to Prim.VerticesCount do
        begin
          if s <> '' then
            s := s + ',';
          s := s + '[' + ML(Prim.Vertex[k].X) + ',' + ML(Prim.Vertex[k].Y) + ']';
        end;
        Result := '{"g":"polyline","pts":[' + s + '],"w":' + LineWMil(Prim.LineWidth) + '}';
      end;
    eLabel:
      Result := '{"g":"label","x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
        ',"text":' + JS(Prim.Text) +
        ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) +
        ',"size":' + IntToStr(SchServer.FontManager.Size(Prim.FontID)) + '}';
  end;
end;

function SymbolJSON(Comp: TObject): String;
var
  PartsStr, PinsStr, GraphStr, FpStr, g: String;
  part, NP: Integer;
  Iter, Prim: TObject;
  HasFpInLib, HasAnyFp: Boolean;
begin
  NP := Comp.PartCount;
  if NP < 1 then
    NP := 1;

  PartsStr := '';
  for part := 1 to NP do
  begin
    PinsStr := '';
    GraphStr := '';
    Iter := Comp.SchIterator_Create;
    Iter.AddFilter_ObjectSet(MkSet(ePin, eLine, eRectangle, eArc, eEllipse, ePolygon, ePolyline, eLabel));
    Prim := Iter.FirstSchObject;
    while Prim <> nil do
    begin
      if ((Prim.OwnerPartId = part) or (Prim.OwnerPartId <= 0)) and (Prim.OwnerPartDisplayMode <= 0) then
      begin
        if Prim.ObjectId = ePin then
        begin
          if PinsStr <> '' then
            PinsStr := PinsStr + ',';
          PinsStr := PinsStr + PinJSON(Prim);
        end
        else
        begin
          g := GraphJSON(Prim);
          if g <> '' then
          begin
            if GraphStr <> '' then
              GraphStr := GraphStr + ',';
            GraphStr := GraphStr + g;
          end;
        end;
      end;
      Prim := Iter.NextSchObject;
    end;
    Comp.SchIterator_Destroy(Iter);
    if PartsStr <> '' then
      PartsStr := PartsStr + ',';
    PartsStr := PartsStr + '{"part":' + IntToStr(part) + ',"pins":[' + PinsStr + '],"graphics":[' + GraphStr + ']}';
  end;

  // modelos de footprint associados ao simbolo
  FpStr := '';
  HasFpInLib := False;
  HasAnyFp := False;
  Iter := Comp.SchIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eImplementation));
  Prim := Iter.FirstSchObject;
  while Prim <> nil do
  begin
    if UpperCase(Prim.ModelType) = 'PCBLIB' then
    begin
      HasAnyFp := True;
      if FpStr <> '' then
        FpStr := FpStr + ',';
      FpStr := FpStr + '{"name":' + JS(Prim.ModelName) +
        ',"incurrentlib":' + JB(FpNames.IndexOf(Prim.ModelName) >= 0) +
        ',"current":' + JB(Prim.IsCurrent) + '}';
      if FpNames.IndexOf(Prim.ModelName) >= 0 then
        HasFpInLib := True;
    end;
    Prim := Iter.NextSchObject;
  end;
  Comp.SchIterator_Destroy(Iter);

  if not HasFpInLib then
  begin
    if HasAnyFp then
      NoFpList.Add(Comp.LibReference + ' (modelo aponta p/ footprint fora da PcbLib)')
    else
      NoFpList.Add(Comp.LibReference + ' (sem modelo de footprint)');
  end;

  Result := '{"name":' + JS(Comp.LibReference) +
    ',"description":' + JS(Comp.ComponentDescription) +
    ',"partcount":' + IntToStr(NP) +
    ',"parts":[' + PartsStr + ']' +
    ',"footprints":[' + FpStr + ']}';
end;

{ ------------------------------- serializacao PcbLib ------------------------------- }

function FpPadJSON(Pad: TObject): String;
var
  s, PadType, PadShape, DrillShape: String;
  W, H: String;
  ShapeCode: Integer;
  Radius: String;
begin
  Radius := '';
  if Pad.Layer = eTopLayer then
  begin
    PadType := 'smd';
    W := MM(Pad.TopXSize);
    H := MM(Pad.TopYSize);
    ShapeCode := Pad.TopShape;
  end
  else if Pad.Layer = eBottomLayer then
  begin
    PadType := 'smd';
    W := MM(Pad.BotXSize);
    H := MM(Pad.BotYSize);
    ShapeCode := Pad.BotShape;
  end
  else
  begin
    PadType := 'th';
    W := MM(Pad.TopXSize);
    H := MM(Pad.TopYSize);
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
        Radius := MM(Pad.CornerRadius(Pad.Layer));
      end;
  end;

  s := '{"name":' + JS(Pad.Name);
  s := s + ',"type":' + JS(PadType);
  s := s + ',"shape":' + JS(PadShape);
  if Radius <> '' then
    s := s + ',"radius":' + Radius;
  s := s + ',"x":' + MM(Pad.x);
  s := s + ',"y":' + MM(Pad.y);
  s := s + ',"w":' + W;
  s := s + ',"h":' + H;
  s := s + ',"rot":' + JF(Pad.Rotation);
  if Pad.Layer = eTopLayer then
    s := s + ',"layer":"Top"'
  else if Pad.Layer = eBottomLayer then
    s := s + ',"layer":"Bottom"'
  else
    s := s + ',"layer":"Multi"';
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
    s := s + ',"drill":' + MM(Pad.HoleSize);
    if Pad.HoleType <> 0 then
      s := s + ',"drillw":' + MM(Pad.HoleWidth);
    s := s + ',"holerot":' + JF(Pad.HoleRotation);
  end;
  s := s + '}';
  Result := s;
end;

function FootprintJSON(FP: TObject): String;
var
  GIter, Prim: TObject;
  PadsStr, SilkStr: String;
  MinX, MinY, MaxX, MaxY, cx, cy, half: Double;
begin
  MinX := 1e9;
  MinY := 1e9;
  MaxX := -1e9;
  MaxY := -1e9;
  PadsStr := '';
  SilkStr := '';

  GIter := FP.GroupIterator_Create;
  GIter.AddFilter_ObjectSet(MkSet(ePadObject, eTrackObject, eArcObject));
  Prim := GIter.FirstPCBObject;
  while Prim <> nil do
  begin
    case Prim.ObjectId of
      ePadObject:
        begin
          if PadsStr <> '' then
            PadsStr := PadsStr + ',';
          PadsStr := PadsStr + FpPadJSON(Prim);
          cx := CoordToMMs(Prim.x);
          cy := CoordToMMs(Prim.y);
          half := CoordToMMs(Prim.TopXSize);
          if CoordToMMs(Prim.TopYSize) > half then
            half := CoordToMMs(Prim.TopYSize);
          half := half / 2;
          if cx - half < MinX then MinX := cx - half;
          if cx + half > MaxX then MaxX := cx + half;
          if cy - half < MinY then MinY := cy - half;
          if cy + half > MaxY then MaxY := cy + half;
        end;
      eTrackObject:
        begin
          if (Prim.Layer = eTopOverlay) or (Prim.Layer = eBottomOverlay) then
          begin
            if SilkStr <> '' then
              SilkStr := SilkStr + ',';
            SilkStr := SilkStr + '{"kind":"line","x1":' + MM(Prim.X1) + ',"y1":' + MM(Prim.Y1) +
              ',"x2":' + MM(Prim.X2) + ',"y2":' + MM(Prim.Y2) + ',"w":' + MM(Prim.Width) + '}';
            if CoordToMMs(Prim.X1) < MinX then MinX := CoordToMMs(Prim.X1);
            if CoordToMMs(Prim.X2) < MinX then MinX := CoordToMMs(Prim.X2);
            if CoordToMMs(Prim.X1) > MaxX then MaxX := CoordToMMs(Prim.X1);
            if CoordToMMs(Prim.X2) > MaxX then MaxX := CoordToMMs(Prim.X2);
            if CoordToMMs(Prim.Y1) < MinY then MinY := CoordToMMs(Prim.Y1);
            if CoordToMMs(Prim.Y2) < MinY then MinY := CoordToMMs(Prim.Y2);
            if CoordToMMs(Prim.Y1) > MaxY then MaxY := CoordToMMs(Prim.Y1);
            if CoordToMMs(Prim.Y2) > MaxY then MaxY := CoordToMMs(Prim.Y2);
          end;
        end;
      eArcObject:
        begin
          if (Prim.Layer = eTopOverlay) or (Prim.Layer = eBottomOverlay) then
          begin
            if SilkStr <> '' then
              SilkStr := SilkStr + ',';
            SilkStr := SilkStr + '{"kind":"arc","cx":' + MM(Prim.XCenter) + ',"cy":' + MM(Prim.YCenter) +
              ',"r":' + MM(Prim.Radius) + ',"sa":' + JF(Prim.StartAngle) + ',"ea":' + JF(Prim.EndAngle) +
              ',"w":' + MM(Prim.LineWidth) + '}';
            if CoordToMMs(Prim.XCenter) - CoordToMMs(Prim.Radius) < MinX then MinX := CoordToMMs(Prim.XCenter) - CoordToMMs(Prim.Radius);
            if CoordToMMs(Prim.XCenter) + CoordToMMs(Prim.Radius) > MaxX then MaxX := CoordToMMs(Prim.XCenter) + CoordToMMs(Prim.Radius);
            if CoordToMMs(Prim.YCenter) - CoordToMMs(Prim.Radius) < MinY then MinY := CoordToMMs(Prim.YCenter) - CoordToMMs(Prim.Radius);
            if CoordToMMs(Prim.YCenter) + CoordToMMs(Prim.Radius) > MaxY then MaxY := CoordToMMs(Prim.YCenter) + CoordToMMs(Prim.Radius);
          end;
        end;
    end;
    Prim := GIter.NextPCBObject;
  end;
  FP.GroupIterator_Destroy(GIter);

  if MinX > MaxX then
  begin
    MinX := -1;
    MinY := -1;
    MaxX := 1;
    MaxY := 1;
  end;

  Result := '{"name":' + JS(FP.Name) +
    ',"description":' + JS(FP.Description) +
    ',"bbox":{"x1":' + JF(MinX) + ',"y1":' + JF(MinY) + ',"x2":' + JF(MaxX) + ',"y2":' + JF(MaxY) + '}' +
    ',"pads":[' + PadsStr + ']' +
    ',"silk":[' + SilkStr + ']}';
end;

{ ------------------------------- rotina principal ------------------------------- }

procedure ExportLibs;
var
  PLib: IPCB_Library;
  LibIter, FP: TObject;
  SchDoc: ISch_Document;
  Iterator, Comp: TObject;
  FpL, SymL, OutL: TStringList;
  i: Integer;
  s: String;
begin
  if PCBServer = nil then
  begin
    ShowMessage('PCBServer indisponivel. Abra a PcbLib no Altium e rode de novo.');
    Exit;
  end;
  ForceDirectories(OUT_DIR);

  // ------------------------------------------------ PcbLib primeiro (para o crosscheck)
  PLib := PCBServer.GetPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
    PLib := PCBServer.LoadPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
  begin
    ShowMessage('Nao consegui abrir a PcbLib:' + #13#10 + PCBLIB_FILE + #13#10#13#10 +
      'Abra a biblioteca no Altium (File >> Open) e rode de novo.');
    Exit;
  end;

  FpNames := TStringList.Create;
  FpNames.Sorted := True;
  FpNames.Duplicates := dupIgnore;
  FpNames.CaseSensitive := False;
  NoFpList := TStringList.Create;
  FpL := TStringList.Create;
  SymL := TStringList.Create;
  FpCount := 0;
  SymCount := 0;

  LibIter := PLib.LibraryIterator_Create;
  LibIter.SetState_FilterAll;
  FP := LibIter.FirstPCBObject;
  while FP <> nil do
  begin
    FpCount := FpCount + 1;
    FpNames.Add(FP.Name);
    AddItem(FpL, FootprintJSON(FP));
    FP := LibIter.NextPCBObject;
  end;
  PLib.LibraryIterator_Destroy(LibIter);

  OutL := TStringList.Create;
  OutL.Add('var pcblib = {');
  OutL.Add('"format":"pcblib-v2",');
  OutL.Add('"generated":' + JS(DateTimeToStr(Now)) + ',');
  OutL.Add('"source":' + JS(PCBLIB_FILE) + ',');
  OutL.Add('"units":"mm",');
  OutL.Add('"footprints":[');
  OutL.AddStrings(FpL);
  OutL.Add('],');
  OutL.Add('"stats":{"footprints":' + IntToStr(FpCount) + '}');
  OutL.Add('};');
  OutL.SaveToFile(OUT_DIR + '\pcblib.js');
  OutL.Free;

  // ------------------------------------------------ SchLib
  if SchServer = nil then
  begin
    ShowMessage('SchServer indisponivel. Abra a SchLib no Altium e rode de novo.' + #13#10 +
      '(pcblib.js ja foi gerado)');
    FpL.Free;
    SymL.Free;
    FpNames.Free;
    NoFpList.Free;
    Exit;
  end;
  SchDoc := SchServer.GetSchDocumentByPath(SCHLIB_FILE);
  if SchDoc = nil then
    SchDoc := SchServer.LoadSchDocumentByPath(SCHLIB_FILE);
  if SchDoc = nil then
  begin
    ShowMessage('Nao consegui abrir a SchLib:' + #13#10 + SCHLIB_FILE + #13#10#13#10 +
      'Abra a biblioteca no Altium (File >> Open) e rode de novo. (pcblib.js ja foi gerado)');
    FpL.Free;
    SymL.Free;
    FpNames.Free;
    NoFpList.Free;
    Exit;
  end;

  Iterator := SchDoc.SchLibIterator_Create;
  Iterator.AddFilter_ObjectSet(MkSet(eSchComponent));
  Comp := Iterator.FirstSchObject;
  while Comp <> nil do
  begin
    SymCount := SymCount + 1;
    AddItem(SymL, SymbolJSON(Comp));
    Comp := Iterator.NextSchObject;
  end;
  SchDoc.SchIterator_Destroy(Iterator);

  OutL := TStringList.Create;
  OutL.Add('var schlib = {');
  OutL.Add('"format":"schlib-v2",');
  OutL.Add('"generated":' + JS(DateTimeToStr(Now)) + ',');
  OutL.Add('"source":' + JS(SCHLIB_FILE) + ',');
  OutL.Add('"units":"mil",');
  OutL.Add('"symbols":[');
  OutL.AddStrings(SymL);
  OutL.Add('],');
  OutL.Add('"stats":{"symbols":' + IntToStr(SymCount) + ',"nofootprint":' + IntToStr(NoFpList.Count) + '}');
  OutL.Add('};');
  OutL.SaveToFile(OUT_DIR + '\schlib.js');
  OutL.Free;

  // ------------------------------------------------ relatorio + resumo
  OutL := TStringList.Create;
  OutL.Add('AltiumPCBMirror - relatorio das bibliotecas');
  OutL.Add('Data: ' + DateTimeToStr(Now));
  OutL.Add('Simbolos: ' + IntToStr(SymCount) + '   Footprints: ' + IntToStr(FpCount));
  OutL.Add('');
  OutL.Add('Simbolos SEM footprint valido na PcbLib (' + IntToStr(NoFpList.Count) + '):');
  OutL.AddStrings(NoFpList);
  OutL.SaveToFile(OUT_DIR + '\libs-report.txt');
  OutL.Free;

  s := 'Bibliotecas espelhadas em ' + OUT_DIR + #13#10#13#10 +
    'Simbolos: ' + IntToStr(SymCount) + #13#10 +
    'Footprints: ' + IntToStr(FpCount) + #13#10 +
    'Simbolos sem footprint na PcbLib: ' + IntToStr(NoFpList.Count) + #13#10#13#10 +
    'Detalhes em libs-report.txt';
  ShowMessage(s);

  FpL.Free;
  SymL.Free;
  FpNames.Free;
  NoFpList.Free;
end;
