{ ................................................................................................................... }
{ .  AltiumPCBMirror - RenameLibs.pas                                                                              . }
{ .                                                                                                                 . }
{ .  Padroniza os nomes da SchLib e da PcbLib (familia nos genericos, part number preservado).                      . }
{ .  Casa cada item por chave normalizada (maiuscula, sem acento, so A-Z0-9), entao acento                          . }
{ .  no nome antigo nao atrapalha.                                                                                  . }
{ .                                                                                                                 . }
{ .  SIMULAR = True (padrao): NAO altera nada, so escreve Libs\rename-report.txt com o que                          . }
{ .  seria feito. Confira o relatorio, depois troque para False e rode de novo.                                     . }
{ .                                                                                                                 . }
{ .  Footprint redundante NAO e apagado: ganha o prefixo "ZZ-OBSOLETO " e vai pro fim da                            . }
{ .  lista, para voce conferir e apagar a mao no editor da biblioteca.                                              . }
{ .                                                                                                                 . }
{ .  Depois de rodar: salve as duas bibliotecas e rode ExportLibs para o espelho bater.                             . }
{ .                                                                                                                 . }
{ .  Como executar: DXP >> Run Script >> RenameLibs                                                                 . }
{ ................................................................................................................... }

const
  SIMULAR = True;   // <<< troque para False depois de conferir o relatorio
  SCHLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib';
  PCBLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE FOOTPRINT.PcbLib';
  REPORT_FILE = '\\LUCAS-PC\D\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror\Libs\rename-report.txt';
  OBSOLETO = 'ZZ-OBSOLETO ';

var
  MapSym, MapFp, MapObs, Log: TStringList;
  NSym, NFp, NModel, NObs: Integer;

{ chave normalizada: maiuscula, acento -> letra base, descarta o resto }
function SimTxt: String;
begin
  if SIMULAR then Result := 'SIMULACAO - nada foi alterado'
  else Result := 'APLICADO';
end;

function NormKey(s: String): String;
var i, o: Integer; c: Char; r: String;
begin
  r := '';
  for i := 1 to Length(s) do
  begin
    c := UpCase(s[i]);
    o := Ord(c);
    if ((o >= 192) and (o <= 198)) or ((o >= 224) and (o <= 230)) then c := 'A'
    else if (o = 199) or (o = 231) then c := 'C'
    else if ((o >= 200) and (o <= 203)) or ((o >= 232) and (o <= 235)) then c := 'E'
    else if ((o >= 204) and (o <= 207)) or ((o >= 236) and (o <= 239)) then c := 'I'
    else if (o = 209) or (o = 241) then c := 'N'
    else if ((o >= 210) and (o <= 216)) or ((o >= 242) and (o <= 248)) then c := 'O'
    else if ((o >= 217) and (o <= 220)) or ((o >= 249) and (o <= 252)) then c := 'U';
    if ((c >= 'A') and (c <= 'Z')) or ((c >= '0') and (c <= '9')) then
      r := r + c;
  end;
  Result := r;
end;

function Look(L: TStringList; s: String): String;
begin
  Result := L.Values[NormKey(s)];
end;

procedure BuildSym;
begin
  MapSym := TStringList.Create;
  MapSym.Add('DIODOSUPRESSORDETRANSIENTEBIDIRECIONALPTH=DIODO TVS BIDIR [PTH]');   // DIODO [ SUPRESSOR DE TRANSIENTE BIDIRECIONAL ] PTH
  MapSym.Add('DIODOSUPRESSORDETRANSIENTEBIDIRECIONALSMD=DIODO TVS BIDIR [SMD]');   // DIODO [ SUPRESSOR DE TRANSIENTE BIDIRECIONAL ] SMD
  MapSym.Add('DIODOSUPRESSORDETRANSIENTEUNIDIRECIONALSMD=DIODO TVS UNIDIR [SMD]');   // DIODO [ SUPRESSOR DE TRANSIENTE UNIDIRECIONAL ] SMD
  MapSym.Add('DIODOSUPRESSORDETRANSIENTEUNIDIRECIONALPTH=DIODO TVS UNIDIR [PTH]');   // DIODO [ SUPRESSOR DE TRANSIENTE UNIDIRECIONAL ] PTH
  MapSym.Add('SENSORHPORDREDUZIDO=SENSOR HP (ORD) REDUZIDO');   // Sensor HP (ord) Reduzido
  MapSym.Add('RELEFINDER3022PART1=RELE FINDER 30.22 PART 1');   // Rel? Finder 30.22_Part_1
  MapSym.Add('PONTERETIFICADORADF410=PONTE RET DF410');   // Ponte Retificadora DF410
  MapSym.Add('CHAVECONTATOMOMENTANEO=CHAVE CONTATO MOMENTANEO');   // Chave Contato Moment?neo
  MapSym.Add('CHAVE1POLO4POSICOES=CHAVE 1 POLO 4 POSICOES');   // chave_1_polo_4_posi??es
  MapSym.Add('DIODOSCHOTTKYSMD=DIODO SCHOTTKY [SMD]');   // DIODO [ Schottky ] SMD
  MapSym.Add('DIODOSCHOTTKYPTH=DIODO SCHOTTKY [PTH]');   // DIODO [ Schottky ] PTH
  MapSym.Add('CONEAPONTFIOCIRC2=CONE APONT FIO CIRC. 2');   // Cone apont FIO circ. 2
  MapSym.Add('CONEAPONTCONQUAD=CONE APONT CON QUAD >>');   // Cone apont CON quad >>
  MapSym.Add('CONEAPONTCONCIRC=CONE APONT CON CIRC >>');   // Cone apont CON circ >>
  MapSym.Add('BARRATERMINAL12VIAS=CONE BARRA [12V]');   // BARRA TERMINAL 12 VIAS
  MapSym.Add('BARRATERMINAL10VIAS=CONE BARRA [10V]');   // BARRA TERMINAL 10 VIAS
  MapSym.Add('INDUTORDEMODOCOMUM=INDUTOR MODO COMUM');   // Indutor de modo comum
  MapSym.Add('CONEAPONTMLOSAN=CONE APONT <<M* LOSAN');   // Cone apont <<M* LOSAN
  MapSym.Add('CONEAPONTFLOSAN=CONE APONT <<F* LOSAN');   // Cone apont <<F* LOSAN
  MapSym.Add('BARRATERMINAL5VIAS=CONE BARRA [05V]');   // BARRA TERMINAL 5 VIAS
  MapSym.Add('BARRATERMINAL4VIAS=CONE BARRA [04V]');   // BARRA TERMINAL 4 VIAS
  MapSym.Add('BARRATERMINAL3VIAS=CONE BARRA [03V]');   // BARRA TERMINAL 3 VIAS
  MapSym.Add('BARRATERMINAL2VIAS=CONE BARRA [02V]');   // BARRA TERMINAL 2 VIAS
  MapSym.Add('BARRATERMINAL13VIAS=CONE BARRA [13V]');   // BARRA TERMINAL 13VIAS
  MapSym.Add('CONEAPONTMCIRC=CONE APONT <<M* CIRC');   // Cone apont <<M* CIRC
  MapSym.Add('CONEAPONTFCIRC=CONE APONT <<F* CIRC');   // Cone apont <<F* CIRC
  MapSym.Add('CONEAPONTFIOBORNE=CONE APONT FIO-BORNE');   // Cone Apont Fio-Borne
  MapSym.Add('CONEAPONTFIOQUADR=CONE APONT FIO QUADR');   // Cone apont FIO quadr
  MapSym.Add('CONEAPONTFIOCIRC=CONE APONT FIO CIRC.');   // Cone apont FIO circ.
  MapSym.Add('CONE6ESP32BOARD=CONE 6 ESP32 (BOARD)');   // Cone 6 ESP32 (BOARD)
  MapSym.Add('CHAVESELETORSLAT=CHAVE SELETOR (SLAT)');   // Chave Seletor (SLAT)
  MapSym.Add('TRAFO2SECSIMPLES=TRAFO 2 SEC SIMPLES');   // Trafo 2 Sec Simples
  MapSym.Add('DISPLAYOLED128X64=DISPLAY OLED 128X64');   // Display OLED 128x64
  MapSym.Add('DIODOZENERSMD=DIODO ZENER [SMD]');   // DIODO [ ZENER ] SMD
  MapSym.Add('DIODOZENERPTH=DIODO ZENER [PTH]');   // DIODO [ ZENER ] PTH
  MapSym.Add('CONEFLAT10VDUPLO=CONE FLAT 10V DUPLO');   // cone flat 10v duplo
  MapSym.Add('CONEAPONTMQUA=CONE APONT <<M* QUA');   // Cone apont <<M* QUA
  MapSym.Add('SENSORDEROTACAO=SENSOR DE ROTACAO');   // Sensor de Rota??o
  MapSym.Add('RELEFINDER4152=RELE FINDER 41.52');   // Rel? Finder 41.52
  MapSym.Add('RELEFINDER3022=RELE FINDER 30.22');   // Rel? Finder 30.22
  MapSym.Add('PARAFUSOATERRADO=CONE PARAFUSO ATERRADO');   // Parafuso Aterrado
  MapSym.Add('INDUTORMAGNETICO=INDUTOR MAGNETICO');   // Indutor magn?tico
  MapSym.Add('FIOENTRADAPOR=CONE FIO (ENTRADA POR)');   // Fio (entrada por)
  MapSym.Add('DISPLAY4DIG7SEG=DISPLAY 4DIG 7SEG');   // Display 4Dig 7seg
  MapSym.Add('CONE108PHARTING=CONE 108P HARTING');   // Cone 108p Harting
  MapSym.Add('BATTERYCRA123A1=BATERIA CRA123A 1');   // Battery_CRA123A_1
  MapSym.Add('TRAFODUALINCT=TRAFO DUAL IN CT');   // Trafo Dual In CT
  MapSym.Add('MODTRANC905MHZ=MODULO TRANC 905MHZ');   // Mod Tranc 905MHz
  MapSym.Add('CONEHEAVYCON15=CONE HEAVYCON 15');   // Cone Heavycon 15
  MapSym.Add('CONE5PSEPARADO=CONE 5P SEPARADO');   // Cone 5p separado
  MapSym.Add('CAPELPTH=CAP EL [PTH]');   // CAP EL [  PTH  ]
  MapSym.Add('TRAFOLP34170=TRAFO LP-34-170');   // Trafo LP-34-170
  MapSym.Add('SENSORHPORD=SENSOR HP (ORD)');   // Sensor HP (ord)
  MapSym.Add('RELE34517=RELE 34.51.7...');   // Rel? 34.51.7...
  MapSym.Add('DISPLAYSSD1309=DISPLAY SSD1309');   // Display SSD1309
  MapSym.Add('CONECTORPADRAO=CONE PADRAO');   // CONECTOR PADR?O
  MapSym.Add('CONEAPONTM=CONE APONT <<M*');   // Cone apont <<M*
  MapSym.Add('CONEAPONTF=CONE APONT <<F*');   // Cone apont <<F*
  MapSym.Add('CAPELSMD=CAP EL [SMD]');   // CAP EL [ SMD  ]
  MapSym.Add('PTCPOLYSWITCH=FUSIVEL PTC POLYSWITCH');   // PTC POLYSWITCH
  MapSym.Add('PONTODETESTE=CONE PONTO DE TESTE');   // Ponto de teste
  MapSym.Add('JUMPER3X32=JUMPER 3X3 - 2');   // Jumper 3x3 - 2
  MapSym.Add('DIODODUALK=DIODO DUAL-K');   // DIODO [DUAL-K]
  MapSym.Add('DIODODUALA=DIODO DUAL-A');   // DIODO [DUAL-A]
  MapSym.Add('CONEAPONTFIO=CONE APONT FIO');   // Cone apont fio
  MapSym.Add('CONEAPONTEXT=CONE APONT EXT');   // Cone Apont Ext
  MapSym.Add('CONE2PINOSM=CONE 2 PINOS M');   // Cone 2 pinos m
  MapSym.Add('CHAVECONTMOM=CHAVE CONT MOM');   // Chave cont mom
  MapSym.Add('BATERIASLAT=BATERIA (SLAT)');   // Bateria (SLAT)
  MapSym.Add('POTENCIOMETRO=POT');   // Potenciometro
  MapSym.Add('PINOQUADRADO=CONE PINO QUADRADO');   // PINO QUADRADO
  MapSym.Add('JUMPER2VIAS=JUMPER [02V]');   // Jumper 2 Vias
  MapSym.Add('CONE6ATMEGA=CONE 6 ATMEGA');   // Cone 6 Atmega
  MapSym.Add('CHAVE2POLOS=CHAVE 2 POLOS');   // Chave 2 polos
  MapSym.Add('CAPSMD=CAP [SMD]');   // CAP [  SMD  ]
  MapSym.Add('CAPPTH=CAP [PTH]');   // CAP [  PTH  ]
  MapSym.Add('BATTERY18650=BATERIA 18650');   // battery_18650
  MapSym.Add('TRAFOTMIGBT=TRAFO TMIGBT');   // Trafo TMIGBT
  MapSym.Add('RELE1NA1NF=RELE 1NA 1NF');   // Rele 1NA 1NF
  MapSym.Add('PIC18F452B=PIC18F452 B');   // PIC18F452  B
  MapSym.Add('FERRITEBEAD=INDUTOR FERRITE');   // FERRITE BEAD
  MapSym.Add('CONEPARAF7=CONE PARAF 7');   // Cone paraf 7
  MapSym.Add('CONEPARAF3=CONE PARAF 3');   // Cone paraf 3
  MapSym.Add('CONEPARAF2=CONE PARAF 2');   // Cone paraf 2
  MapSym.Add('CONE3PINOS=CONE 3 PINOS');   // Cone 3 pinos
  MapSym.Add('CONE2LINHA=CONE 2 LINHA');   // Cone 2 linha
  MapSym.Add('CHAVEONOFF=CHAVE ON/OFF');   // Chave ON/OFF
  MapSym.Add('RESSMD=RES [SMD]');   // RES [ SMD ]
  MapSym.Add('RESPTH=RES [PTH]');   // RES [ PTH ]
  MapSym.Add('PUSHBUTTON=CHAVE PUSH-BUTTON');   // PUSH-BUTTON
  MapSym.Add('PONTERETG=PONTE RET G');   // Ponte Ret G
  MapSym.Add('MODULOADXL=MODULO ADXL');   // Modulo ADXL
  MapSym.Add('FONTEDCDC=FONTE DC-DC');   // Fonte DC-DC
  MapSym.Add('DIGITALPOT=POT DIGITAL');   // Digital Pot
  MapSym.Add('CONEPADTH=CONE PAD TH');   // Cone PAD TH
  MapSym.Add('CONEINCIS=CONE IN CIS');   // Cone IN CIS
  MapSym.Add('VOLTIMETRO=voltimetro');   // volt?metro
  MapSym.Add('THERMISTOR=FUSIVEL THERMISTOR');   // Thermistor
  MapSym.Add('TESTPOINT=CONE TEST POINT');   // TEST POINT
  MapSym.Add('RELE4152=RELE 41.52');   // Rele 41.52
  MapSym.Add('MAX3232B=MAX3232 B');   // MAX3232  B
  MapSym.Add('JUMPER3X3=JUMPER 3X3');   // Jumper 3x3
  MapSym.Add('CRISTAL3P=CRISTAL [3P]');   // Cristal 3p
  MapSym.Add('CONE9ESP=CONE 9 ESP');   // Cone 9 ESP
  MapSym.Add('CONE6P3V=CONE 6P-3V');   // Cone 6P-3V
  MapSym.Add('CONE4ESP=CONE 4 ESP');   // Cone 4 esp
  MapSym.Add('CONE3ESP=CONE 3 ESP');   // Cone 3 esp
  MapSym.Add('SENSORHP=SENSOR HP');   // Sensor HP
  MapSym.Add('POTDUPLO=POT DUPLO');   // Pot duplo
  MapSym.Add('PONTERET=PONTE RET');   // Ponte ret
  MapSym.Add('JUMPER4Q=JUMPER 4Q');   // Jumper 4q
  MapSym.Add('JUMPER3Q=JUMPER 3Q');   // Jumper 3q
  MapSym.Add('FOTODIODO=DIODO FOTO');   // FOTODIODO
  MapSym.Add('DIODOSMD=DIODO [SMD]');   // DIODO SMD
  MapSym.Add('DIODOPTH=DIODO [PTH]');   // DIODO PTH
  MapSym.Add('CARTAOSD=Cartao SD');   // Cart?o SD
  MapSym.Add('VARISTOR=VARISTOR');   // Varistor
  MapSym.Add('TRAFO3E=TRAFO 3E');   // Trafo 3E
  MapSym.Add('CONECTOR=CONE CANON');   // CONECTOR
  MapSym.Add('CONEBNC=CONE BNC');   // Cone BNC
  MapSym.Add('CHAVE2P=CHAVE 2P');   // Chave 2P
  MapSym.Add('TRIMMER=TRIMMER');   // Trimmer
  MapSym.Add('CRISTAL=CRISTAL [2P]');   // Cristal
  MapSym.Add('CONE7P=CONE 7P');   // Cone 7P
  MapSym.Add('CONE36=CONE [36V]');   // Cone 36
  MapSym.Add('CONE2O=CONE 2O');   // Cone 2o
  MapSym.Add('CONE16=CONE [16V]');   // Cone 16
  MapSym.Add('CONE14=CONE [14V]');   // Cone 14
  MapSym.Add('CONE13=CONE [13V]');   // Cone 13
  MapSym.Add('CONE12=CONE [12V]');   // Cone 12
  MapSym.Add('CONE11=CONE [11V]');   // Cone 11
  MapSym.Add('CONE10=CONE [10V]');   // Cone 10
  MapSym.Add('BATERIA=BATERIA');   // Bateria
  MapSym.Add('SOCKET=SOCKET');   // Socket
  MapSym.Add('RELE1=RELE 1');   // Rele 1
  MapSym.Add('MOSFET=TRANS MOSFET');   // MOSFET
  MapSym.Add('JUMPER=JUMPER');   // Jumper
  MapSym.Add('CONE9=CONE [09V]');   // Cone 9
  MapSym.Add('CONE8=CONE [08V]');   // Cone 8
  MapSym.Add('CONE7=CONE [07V]');   // Cone 7
  MapSym.Add('CONE6=CONE [06V]');   // Cone 6
  MapSym.Add('CONE5=CONE [05V]');   // Cone 5
  MapSym.Add('CONE4=CONE [04V]');   // Cone 4
  MapSym.Add('CONE3=CONE [03V]');   // Cone 3
  MapSym.Add('CONE2=CONE [02V]');   // Cone 2
  MapSym.Add('BUZZER=BUZZER');   // Buzzer
  MapSym.Add('BOBINA=INDUTOR BOBINA');   // BOBINA
  MapSym.Add('PILHA=BATERIA PILHA');   // Pilha
  MapSym.Add('BORNE=CONE BORNE');   // Borne
  MapSym.Add('RELE=RELE');   // Rel?
  MapSym.Add('PTC=FUSIVEL PTC');   // PTC
  MapSym.Add('NTC=RES NTC');   // NTC
end;

procedure BuildFp;
begin
  MapFp := TStringList.Create;
  MapFp.Add('FIO=FIO');   // Fio
  MapFp.Add('SOP8=SOP-8');   // SOP8
  MapFp.Add('FIO1=FIO 1');   // Fio 1
  MapFp.Add('FIO2=FIO 2');   // Fio 2
  MapFp.Add('FIOP=FIO P');   // Fio P
  MapFp.Add('SOP32=SOP-32');   // SOP32
  MapFp.Add('CRISTAL=CRISTAL');   // Cristal
  MapFp.Add('FIO2MM=FIO 2MM');   // fio 2mm
  MapFp.Add('FIO45=FIO 4.5');   // Fio 4.5
  MapFp.Add('SOP20DK=SOP-20DK');   // SOP20DK
  MapFp.Add('TRIMPOT=TRIMPOT');   // Trimpot
  MapFp.Add('FIOPEQ2=FIO PEQ2');   // Fio peq2
  MapFp.Add('BARRA1X4=CONE BARRA 1X4');   // Barra 1x4
  MapFp.Add('CRISTAL2=CRISTAL 2');   // Cristal 2
  MapFp.Add('FIOPILHA=FIO PILHA');   // Fio Pilha
  MapFp.Add('CONE1016=CONE 10.16');   // Cone 10.16
  MapFp.Add('JUMPER3X3=JUMPER 3X3');   // Jumper 3x3
  MapFp.Add('RELE3451=RELE 34.51');   // Rele 34.51
  MapFp.Add('RES4MMD3=RES 4MM D3');   // RES 4mm D3
  MapFp.Add('CONEINCIS=CONE IN CIS');   // Cone IN CIS
  MapFp.Add('CONECTORGP=CONE GP');   // Conector GP
  MapFp.Add('RES44MMD8=RES 44MM D8');   // RES 44mm D8
  MapFp.Add('TO225DEIT=TO-225 DEIT');   // TO-225 Deit
  MapFp.Add('CONEALICIS=CONE ALI CIS');   // Cone Ali CIS
  MapFp.Add('DIP14DCP01=DIP14 DCP01');   // Dip 14 DCP01
  MapFp.Add('INDUTOR0805=IND 0805');   // INDUTOR 0805
  MapFp.Add('INDUTORTOKO=IND TOKO');   // INDUTOR TOKO
  MapFp.Add('JUMPER2V90=JUMPER 2V 90');   // Jumper 2v 90
  MapFp.Add('RES5MMD25=RES 5MM D2.5');   // RES 5mm D2.5
  MapFp.Add('RES6MMD25=RES 6MM D2.5');   // RES 6mm D2.5
  MapFp.Add('RES9MMD25=RES 9MM D2.5');   // RES 9mm D2.5
  MapFp.Add('CONESTANDARD=CONE STANDARD');   // cone standard
  MapFp.Add('DISPLAY7SEG=DISPLAY 7 SEG');   // Display 7 seg
  MapFp.Add('INDUTOR3631B=IND 3631B');   // INDUTOR 3631B
  MapFp.Add('INDUTORCINZA=IND-CINZA');   // Indutor-Cinza
  MapFp.Add('RES16MMD25=RES 16MM D2.5');   // RES 16mm D2.5
  MapFp.Add('RES19MMD65=RES 19MM D6.5');   // RES 19mm D6.5
  MapFp.Add('RES27MMD65=RES 27MM D6.5');   // RES 27mm D6.5
  MapFp.Add('TO2202DEIT=TO-220-2 DEIT');   // TO-220-2 Deit
  MapFp.Add('TO2203DEIT=TO-220-3 DEIT');   // TO-220-3 Deit
  MapFp.Add('TO2205DEIT=TO-220-5 DEIT');   // TO-220-5 deit
  MapFp.Add('TRIMPOT3006P=TRIMPOT 3006P');   // trimpot 3006p
  MapFp.Add('TRIMPOT3296W=TRIMPOT 3296W');   // Trimpot 3296W
  MapFp.Add('TRIMPOT3299P=TRIMPOT 3299P');   // Trimpot 3299P
  MapFp.Add('TRIMPOT3386F=TRIMPOT 3386F');   // Trimpot 3386F
  MapFp.Add('CARTAOMICROSD=Cartao MicroSD');   // Cart?o MicroSD
  MapFp.Add('CONECTOR6PIN=CONE 6 PIN');   // Conector 6 pin
  MapFp.Add('CRISTAL2DEIT=CRISTAL 2 DEIT');   // Cristal 2 deit
  MapFp.Add('INDUTORGRANDE=IND GRANDE');   // INDUTOR GRANDE
  MapFp.Add('LEDRETRED=LED RET - RED');   // LED RET -  RED
  MapFp.Add('RES85MMD25=RES 8.5MM D2.5');   // RES 8.5mm D2.5
  MapFp.Add('SOP8TODIP8=SOP-8 TO DIP 8');   // SOP-8 To DIP 8
  MapFp.Add('CONECTOR2VIAS=CONE 2 VIAS');   // Conector 2 vias
  MapFp.Add('DISPLAYSSD1309=DISPLAY SSD1309');   // Display SSD1309
  MapFp.Add('MODULOTP4056=MODULO - TP4056');   // Modulo - TP4056
  MapFp.Add('PTC508MM8MMD=PTC 5.08MM 8MMD');   // PTC 5.08mm 8mmD
  MapFp.Add('SOT223MENOR=SOT-223 - MENOR');   // Sot-223 - menor
  MapFp.Add('CONECTOR56VIAS=CONE 56 VIAS');   // Conector 56 vias
  MapFp.Add('LED5MMREDV=LED 5MM - RED V');   // LED 5mm - RED  V
  MapFp.Add('TRAFOLP34170=TRAFO LP--34-170');   // Trafo LP--34-170
  MapFp.Add('BARRAPROGATMEGA=CONE BARRA PROG ATMEGA');   // Barra Prog Atmega
  MapFp.Add('CAPEL2MML10D6=CAP EL 2MM L10 D6');   // CAP EL 2mm L10 D6
  MapFp.Add('CAPEL3MML15D7=CAP EL 3MM L15 D7');   // Cap El 3mm L15 D7
  MapFp.Add('CAPEL3MML15D8=CAP EL 3MM L15 D8');   // CAP EL 3mm L15 D8
  MapFp.Add('CONEFITADISPLAY=CONE FITA DISPLAY');   // Cone fita display
  MapFp.Add('CONECTOREDGE80P=CONE EDGE 80P');   // Conector Edge 80P
  MapFp.Add('DISSIPADOR7805=DISSIPADOR - 7805');   // Dissipador - 7805
  MapFp.Add('FIOENTRADAPOR=FIO (ENTRADA POR)');   // Fio (entrada por)
  MapFp.Add('INDUTOR47UHSMD=IND 4.7UH SMD');   // INDUTOR 4.7uH SMD
  MapFp.Add('RES25126432=RES 2512 [6432]');   // RES 2512 [ 6432 ]
  MapFp.Add('TRAFOPOLARIZACAO=TRAFO POLARIZACAO');   // TRAFO POLARIZA?AO
  MapFp.Add('BARRA5PINOD90I=CONE BARRA 5PINOD 90');   // Barra 5pinod 90???
  MapFp.Add('BARRA7VIASFEMEA=CONE BARRA 7 VIAS FEMEA');   // BARRA 7 VIAS FEMEA
  MapFp.Add('BARRA8VIASDUPLA=CONE BARRA 8 VIAS DUPLA');   // BARRA 8 VIAS DUPLA
  MapFp.Add('BATTACCF2BRAIA=Bat TACCF 2Braa');   // Bat TACCF 2Bra???a
  MapFp.Add('BOBINAPOLARIZACAO=BOBINA POLARIZACAO');   // BOBINA POLARIZA?AO
  MapFp.Add('CAPEL5MML10D10=CAP EL 5MM L10 D10');   // CAP EL 5mm L10 D10
  MapFp.Add('CAPEL5MML20D12=CAP EL 5MM L20 D12');   // CAP EL 5mm L20 D12
  MapFp.Add('CONE2VIAS127MM=CONE 2 VIAS 1.27MM');   // cone 2 vias 1.27mm
  MapFp.Add('CONECTORALMREGUA=CONE ALM REGUA');   // Conector ALM Regua
  MapFp.Add('DISSIPADORDM812=DISSIPADOR - DM812');   // Dissipador - DM812
  MapFp.Add('INDUTORMODOCOMUM=IND MODO COMUM');   // INDUTOR MODO COMUM
  MapFp.Add('RELEMINIC4152=RELE MINI C/ 41.52');   // Rele Mini c/ 41.52
  MapFp.Add('TO2205DEITDISS=TO-220-5 DEIT DISS');   // TO-220-5 deit diss
  MapFp.Add('BARRAHB9500953P=CONE BARRA HB9500-9.5-3P');   // BARRA HB9500-9.5-3P
  MapFp.Add('CAPEL4MML145D8=CAP EL 4MM L14.5 D8');   // CAP EL 4mm L14.5 D8
  MapFp.Add('CONELATCH20P180=CONE LATCH 20P 180');   // CONE LATCH 20P 180?
  MapFp.Add('INDUTOR100UHFORNO=IND 100UH FORNO');   // INDUTOR 100uH FORNO
  MapFp.Add('INDUTORPOWER47UH=IND POWER 4.7UH');   // Indutor Power 4.7UH
  MapFp.Add('JUMPER3VREFORCADO=JUMPER 3V REFORCADO');   // Jumper 3V reforcado
  MapFp.Add('RES4MMD3VERTICAL=RES 4MM D3 VERTICAL');   // RES 4mm D3 Vertical
  MapFp.Add('BARRA5PINOS180I=CONE BARRA 5 PINOS 180');   // Barra 5 pinos 180???
  MapFp.Add('BARRAHB95009512P=CONE BARRA HB9500-9.5-12P');   // BARRA HB9500-9.5-12P
  MapFp.Add('BARRAHB95009513P=CONE BARRA HB9500-9.5-13P');   // BARRA HB9500-9.5-13P
  MapFp.Add('CAPEL4MML145D10=CAP EL 4MM L14.5 D10');   // CAP EL 4mm L14.5 D10
  MapFp.Add('CAPELSMD4MML5D5=CAP EL SMD 4MM L5 D5');   // CAP EL SMD 4mm L5 D5
  MapFp.Add('CAPPOLI508MML55=CAP POLI 5.08MM L5.5');   // Cap Poli 5.08MM L5.5
  MapFp.Add('CAPPOLI508MML75=CAP POLI 5.08MM L7.5');   // Cap poli 5.08MM L7.5
  MapFp.Add('CONECTORGP6CANAIS=CONE GP 6 CANAIS');   // Conector GP 6 Canais
  MapFp.Add('CONECTORLATCHFEMEA=CONE LATCH FEMEA');   // Conector latch femea
  MapFp.Add('DISSIPADORTO220PE=DISSIPADOR TO-220 PE');   // DISSIPADOR TO-220 P?
  MapFp.Add('DO201ADDUPLICATE=DO-201AD - DUPLICATE');   // DO-201AD - duplicate
  MapFp.Add('TO2205DEITABAIXO=TO-220-5 DEIT ABAIXO');   // TO-220-5 deit Abaixo
  MapFp.Add('TRILHAFUSAVEL15A=Trilha FusAvel 1.5A');   // Trilha Fus??vel 1.5A
  MapFp.Add('BARRA1X4DUPLICATE=CONE BARRA 1X4 - DUPLICATE');   // Barra 1x4 - duplicate
  MapFp.Add('CAPELSMD127MMD10=CAP EL SMD 12.7MM D10');   // CAP EL SMD 12.7mm D10
  MapFp.Add('CAPPOLICANECA01UF=CAP POLI CANECA 0.1UF');   // CAP Poli Caneca 0.1uF
  MapFp.Add('CONEMKDS156508=CONE MKDS 1,5/ 6-5,08');   // cone MKDS 1,5/ 6-5,08
  MapFp.Add('CONECTORPROG127M=CONE PROG - 1.27M');   // conector prog - 1.27M
  MapFp.Add('INDUTORPM502215MRC=IND PM5022-15M-RC');   // Indutor PM5022-15M-RC
  MapFp.Add('SENSORDEROTAIIO=Sensor de Rotao');   // Sensor de Rota??????o
  MapFp.Add('TO220AB3DEITFET=TO-220AB-3 DEIT - FET');   // TO-220AB-3 Deit - FET
  MapFp.Add('CONECTORFONTEENCODER=CONE FONTE ENCODER');   // Conector Fonte Encoder
  MapFp.Add('INDUTORSMD28A150UH=IND SMD 2.8A 150UH');   // INDUTOR SMD 2.8A 150uH
  MapFp.Add('DISSIPADORPEQUENO7815=DISSIPADOR PEQUENO 7815');   // Dissipador Pequeno 7815
  MapFp.Add('BARRAPROGESP32BOARD=CONE BARRA PROG ESP32 (BOARD)');   // Barra Prog ESP32 (BOARD)
  MapFp.Add('CONEMSTBV50810PGFB=CONE MSTBV 5.08/10P GF B');   // CONE MSTBV 5.08/10P GF b
  MapFp.Add('CONEMSTBV50813PGFB=CONE MSTBV 5.08/13P GF B');   // CONE MSTBV 5.08/13P GF b
  MapFp.Add('CONECTORTERMINAL9VIAS=CONE TERMINAL 9 VIAS');   // CONECTOR TERMINAL 9 VIAS
  MapFp.Add('DISPLAYOLED256X6432=DISPLAY OLED 256X64 3.2"');   // DISPLAY OLED 256x64 3.2"
  MapFp.Add('MODULODISPLAY4DIGITOS=MODULO DISPLAY 4 DIGITOS');   // Modulo Display 4 Digitos
  MapFp.Add('CAPELSMD55MML62D8=CAP EL SMD 5.5MM L6.2 D8');   // CAP EL SMD  5.5MM L6.2 D8
  MapFp.Add('CONEMCV153812P180I=CONE MCV1.5-3.81 2P 180');   // Cone MCV1.5-3.81 2P 180???
  MapFp.Add('CONEMCV153813P180I=CONE MCV1.5-3.81 3P 180');   // Cone MCV1.5-3.81 3P 180???
  MapFp.Add('CONEMCV153814P180I=CONE MCV1.5-3.81 4P 180');   // Cone MCV1.5-3.81 4P 180???
  MapFp.Add('CONEMCV153815P180I=CONE MCV1.5-3.81 5P 180');   // Cone MCV1.5-3.81 5P 180???
  MapFp.Add('CONEMCV153816P180I=CONE MCV1.5-3.81 6P 180');   // Cone MCV1.5-3.81 6P 180???
  MapFp.Add('CONEMCV153817P180I=CONE MCV1.5-3.81 7P 180');   // Cone MCV1.5-3.81 7P 180???
  MapFp.Add('CONEMCV153818P180I=CONE MCV1.5-3.81 8P 180');   // Cone MCV1.5-3.81 8P 180???
  MapFp.Add('CONEMCV153819P180I=CONE MCV1.5-3.81 9P 180');   // Cone MCV1.5-3.81 9P 180???
  MapFp.Add('ALIMENTAIIOVCAENCODER=Alimentao VCA Encoder');   // Alimenta??????o VCA Encoder
  MapFp.Add('CONEINDIVIDUAL25MM11MM=CONE INDIVIDUAL 2.5MM 1.1MM');   // Cone individual 2.5mm 1.1mm
  MapFp.Add('CONEMCH1538112P180I=CONE MCH1.5-3.81 12P 180');   // Cone MCH1.5-3.81 12P 180???
  MapFp.Add('CONEMCV1538110P180I=CONE MCV1.5-3.81 10P 180');   // Cone MCV1.5-3.81 10P 180???
  MapFp.Add('CONEMCV1538113P180I=CONE MCV1.5-3.81 13P 180');   // Cone MCV1.5-3.81 13P 180???
  MapFp.Add('CONEMCV1538116P180I=CONE MCV1.5-3.81 16P 180');   // Cone MCV1.5-3.81 16P 180???
  MapFp.Add('CONECTOR2VIASDUPLICATE=CONE 2 VIAS - DUPLICATE');   // Conector 2 vias - duplicate
  MapFp.Add('CONEMC153813P90II=CONE MC 1.5-3.81 3P 90');   // Cone MC 1.5-3.81 3P 90??????
  MapFp.Add('CONEMCV153814P180IB=CONE MCV1.5-3.81 4P 180 B');   // Cone MCV1.5-3.81 4P 180??? b
  MapFp.Add('CONEMCV153818P180IB=CONE MCV1.5-3.81 8P 180 B');   // Cone MCV1.5-3.81 8P 180??? b
  MapFp.Add('CONEMCV153819P180IB=CONE MCV1.5-3.81 9P 180 B');   // Cone MCV1.5-3.81 9P 180??? b
  MapFp.Add('INDUTORIFDC2525DZER331MSMD=IND IFDC2525DZER331M SMD');   // INDUTOR IFDC2525DZER331M SMD
  MapFp.Add('INDUTORTOROIDAL25MMSLAT=IND TOROIDAL 25MM (SLAT)');   // INDUTOR TOROIDAL 25mm (SLAT)
  MapFp.Add('CAPEL5MML20D12DEITADO=CAP EL 5MM L20 D12 - DEITADO');   // CAP EL 5mm L20  D12 - DEITADO
  MapFp.Add('CAPPOLI27MML23DEITADO=CAP POLI 27MM L23 [DEITADO]');   // CAP POLI 27MM L23 [ DEITADO ]
  MapFp.Add('CONECTORGP6CANAISREDUZIDO=CONE GP 6 CANAIS REDUZIDO');   // Conector GP 6 Canais Reduzido
  MapFp.Add('BARRAPROGESP32127SMD10MM=CONE BARRA PROG ESP32 1,27 SMD 10MM');   // BARRA PROG ESP32 1,27 SMD 10MM
  MapFp.Add('LOGODISILKBOTGDUPLICATE=LOGO DI SILK BOT G - DUPLICATE');   // Logo Di Silk Bot G - duplicate
  MapFp.Add('BARRADOSENSORDEVIBRACAOIIM=CONE BARRA DO SENSOR DE VIBRACAO IIM');   // BARRA DO SENSOR DE VIBRA?AO IIM
  MapFp.Add('BARRAPROGESP32127MMPTH10MM=CONE BARRA PROG ESP32 1,27MM PTH 10MM');   // BARRA PROG ESP32 1,27MM PTH 10MM
  MapFp.Add('BARRAPROGESP32127MMPTH6MM=CONE BARRA PROG ESP32 1.27MM PTH 6MM');   // BARRA PROG ESP32 1.27mm PTH 6MM
  MapFp.Add('BARRAPROGESP32127MMSMD6MM=CONE BARRA PROG ESP32 1.27MM SMD 6MM');   // BARRA PROG ESP32 1.27MM SMD 6MM
  MapFp.Add('CONECTORHEADER50VIAS2X25PASSO254MM90=CONE HEADER - 50 VIAS (2X25), PASSO 2.54MM 90');   // Conector Header - 50 vias (2x25), Passo 2.54mm 90?
  MapFp.Add('CONECTORHEADER16VIASVERTICAL2ROWS=CONE HEADER 16 VIAS VERTICAL - 2 ROWS');   // CONECTOR HEADER 16 VIAS VERTICAL - 2 ROWS
  MapFp.Add('CONECTORHEADER6VIASVERTICAL2ROWS=CONE HEADER 6 VIAS VERTICAL - 2 ROWS');   // CONECTOR HEADER 6 VIAS VERTICAL - 2 ROWS
  MapFp.Add('CONECTORLATCH10VIASHORIZONTAL2DOWS=CONE LATCH 10 VIAS HORIZONTAL - 2 DOWS');   // Conector Latch 10 vias HORIZONTAL - 2 DOWS
  MapFp.Add('CONECTORLATCH10VIASVERTICAL2ROWS=CONE LATCH 10 VIAS VERTICAL - 2 ROWS');   // Conector Latch 10 vias vertical - 2 ROWS
  MapFp.Add('CONECTORLATCH20VIASVERTICAL2ROWS=CONE LATCH 20 VIAS VERTICAL - 2 ROWS');   // Conector Latch 20 vias vertical -  2 ROWS
  MapFp.Add('CONECTORLATCH26VIASHORIZONTAL2ROWS=CONE LATCH 26 VIAS HORIZONTAL - 2 ROWS');   // CONECTOR LATCH 26 VIAS HORIZONTAL - 2 ROWS
  MapFp.Add('CONECTORLATCH26VIASVERTICAL2ROWS=CONE LATCH 26 VIAS VERTICAL - 2 ROWS');   // CONECTOR LATCH 26 VIAS VERTICAL - 2 ROWS
  MapFp.Add('CONECTORLATCH50VIASVERTICAL2ROWS=CONE LATCH 50 VIAS VERTICAL - 2 ROWS');   // CONECTOR LATCH 50 VIAS VERTICAL - 2 ROWS
  MapFp.Add('CONECTORTERMINAL10VIAS75MMCFX=CONE TERMINAL 10 VIAS / 7.5MM CFX');   // CONECTOR TERMINAL  10 VIAS / 7.5MM CFX
  MapFp.Add('CONECTORTERMINAL6VIAS13MMCFX=CONE TERMINAL 6 VIAS / 13MM CFX');   // CONECTOR TERMINAL  6 VIAS / 13MM CFX
  MapFp.Add('CONECTORTERMINAL10VIAS635MM=CONE TERMINAL 10 VIAS / 6.35MM');   // CONECTOR TERMINAL 10 VIAS / 6.35mm
  MapFp.Add('CONECTORTERMINAL2VIAS13MMCFX=CONE TERMINAL 2 VIAS / 13MM CFX');   // CONECTOR TERMINAL 2 VIAS / 13MM CFX
  MapFp.Add('CONECTORTERMINAL6VIAS13MM=CONE TERMINAL 6 VIAS / 13MM');   // CONECTOR TERMINAL 6 VIAS / 13MM
  MapFp.Add('CONECTORTERMINAL9VIAS635MM=CONE TERMINAL 9 VIAS / 6.35MM');   // CONECTOR TERMINAL 9 VIAS / 6.35mm
  MapFp.Add('TRAFO110220SAIDADUPLAISOLADA=TRAFO 110/220 SADA DUPLA ISOLADA');   // Trafo 110/220 sa???da dupla isolada
  MapFp.Add('TRAFOBIVOLT110220SINGLEOUT=TRAFO BIVOLT 110/220 - SINGLE OUT');   // TRAFO BIVOLT 110/220  - SINGLE OUT
end;

procedure BuildObs;
begin
  MapObs := TStringList.Create;
  MapObs.Add('LED3MMBLUE=LED 3MM - RED');   // LED 3MM - BLUE
  MapObs.Add('LED3MMGREEN=LED 3MM - RED');   // LED 3MM - GREEN
  MapObs.Add('LED3MMYELLOW=LED 3MM - RED');   // LED 3MM - YELLOW
  MapObs.Add('LED5MMRED=LED 5MM - GREEN');   // LED 5MM - RED
  MapObs.Add('LED5MMWHITE=LED 5MM - GREEN');   // LED 5MM - WHITE
  MapObs.Add('LED5MMYELLOW=LED 5MM - GREEN');   // LED 5MM - YELLOW
  MapObs.Add('LED5MMORANGE=LED 5MM - BLUE');   // LED 5MM - ORANGE
  MapObs.Add('TO225AA=TO-126');   // TO-225AA
  MapObs.Add('TO2635=DDPAK-5');   // TO-263-5
  MapObs.Add('NMAXXXXSC=NMA0515SC');   // NMAXXXXSC
  MapObs.Add('HCMS2963=HCMS-296X');   // HCMS-2963
end;

{ ---------------------------------- PcbLib ---------------------------------- }
procedure DoPcb;
var PLib: IPCB_Library; It: IPCB_LibraryIterator; FP: IPCB_LibComponent;
    novo, obs, antigo: String;
begin
  PLib := PCBServer.GetPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then PLib := PCBServer.LoadPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
  begin
    Log.Add('ERRO: nao consegui abrir a PcbLib: ' + PCBLIB_FILE);
    Exit;
  end;
  It := PLib.LibraryIterator_Create;
  It.SetState_FilterAll;
  FP := It.FirstPCBObject;
  while FP <> nil do
  begin
    antigo := FP.Name;
    obs := Look(MapObs, antigo);
    novo := Look(MapFp, antigo);
    if obs <> '' then
    begin
      Log.Add('FP  OBSOLETO  ' + antigo + '   ->   ' + OBSOLETO + antigo + '   (usar ' + obs + ')');
      NObs := NObs + 1;
      if not SIMULAR then FP.Name := OBSOLETO + antigo;
    end
    else if (novo <> '') and (novo <> antigo) then
    begin
      Log.Add('FP  RENOMEIA  ' + antigo + '   ->   ' + novo);
      NFp := NFp + 1;
      if not SIMULAR then FP.Name := novo;
    end;
    FP := It.NextPCBObject;
  end;
  PLib.LibraryIterator_Destroy(It);
  if not SIMULAR then PLib.Board.ViewManager_FullUpdate;
end;

{ ---------------------------------- SchLib ---------------------------------- }
procedure DoSch;
var SchDoc: ISch_Document; It, PIt: ISch_Iterator; Comp: ISch_Component; Prim: ISch_Implementation;
    novo, antigo, m, mn: String;
begin
  SchDoc := SchServer.GetSchDocumentByPath(SCHLIB_FILE);
  if SchDoc = nil then SchDoc := SchServer.LoadSchDocumentByPath(SCHLIB_FILE);
  if SchDoc = nil then
  begin
    Log.Add('ERRO: nao consegui abrir a SchLib: ' + SCHLIB_FILE);
    Exit;
  end;
  if not SIMULAR then SchServer.ProcessControl.PreProcess(SchDoc, 0);
  It := SchDoc.SchLibIterator_Create;
  Comp := It.FirstSchObject;
  while Comp <> nil do
  begin
    antigo := Comp.LibReference;
    novo := Look(MapSym, antigo);
    if (novo <> '') and (novo <> antigo) then
    begin
      Log.Add('SYM RENOMEIA  ' + antigo + '   ->   ' + novo);
      NSym := NSym + 1;
      if not SIMULAR then
      begin
        Comp.LibReference := novo;
        SchServer.RobotManager.SendMessage(SchDoc.I_ObjectAddress, c_BroadCast,
          SCHM_PrimitiveRegistration, Comp.I_ObjectAddress);
      end;
    end;
    { modelos de footprint do simbolo tem que seguir o rename da PcbLib }
    PIt := Comp.SchIterator_Create;
    PIt.AddFilter_ObjectSet(MkSet(eImplementation));
    Prim := PIt.FirstSchObject;
    while Prim <> nil do
    begin
      if UpperCase(Prim.ModelType) = 'PCBLIB' then
      begin
        m := Prim.ModelName;
        mn := Look(MapObs, m);
        if mn = '' then mn := Look(MapFp, m);
        if (mn <> '') and (mn <> m) then
        begin
          Log.Add('    modelo  ' + antigo + ' : ' + m + '   ->   ' + mn);
          NModel := NModel + 1;
          if not SIMULAR then Prim.ModelName := mn;
        end;
      end;
      Prim := PIt.NextSchObject;
    end;
    Comp.SchIterator_Destroy(PIt);
    Comp := It.NextSchObject;
  end;
  SchDoc.SchLibIterator_Destroy(It);
  if not SIMULAR then
  begin
    SchServer.ProcessControl.PostProcess(SchDoc, 0);
    SchDoc.GraphicallyInvalidate;
  end;
end;

{ ------------------------------- entrada ------------------------------- }
procedure RenameLibs;
var Doc: IServerDocument;
begin
  if (PCBServer = nil) or (SchServer = nil) then
  begin
    ShowMessage('Abra a SchLib e a PcbLib no Altium (File >> Open) e rode de novo.');
    Exit;
  end;
  BuildSym; BuildFp; BuildObs;
  Log := TStringList.Create;
  NSym := 0; NFp := 0; NModel := 0; NObs := 0;
  Log.Add('AltiumPCBMirror - RenameLibs');
  Log.Add('modo: ' + SimTxt);
  Log.Add('');
  DoPcb;
  DoSch;
  Log.Add('');
  Log.Add('simbolos renomeados : ' + IntToStr(NSym));
  Log.Add('footprints renomeados: ' + IntToStr(NFp));
  Log.Add('modelos repontados   : ' + IntToStr(NModel));
  Log.Add('footprints marcados ZZ-OBSOLETO: ' + IntToStr(NObs));
  Log.Add('A MAO: FOOTPRINT CAP EL 2mm L11.5 D5  ->  CAP EL 2MM L11.5 D5   (chave ambigua)');
  Log.Add('A MAO: SIMBOLO MC33072P_1  -> apagar, duplicata de MC33072P');
  Log.SaveToFile(REPORT_FILE);
  Log.Free; MapSym.Free; MapFp.Free; MapObs.Free;
  if not SIMULAR then
  begin
    Doc := Client.GetDocumentByPath(PCBLIB_FILE);
    if Doc <> nil then Doc.DoFileSave('');
    Doc := Client.GetDocumentByPath(SCHLIB_FILE);
    if Doc <> nil then Doc.DoFileSave('');
  end;
  ShowMessage('RenameLibs (' + SimTxt + ')' + #13#10 +
    'simbolos: ' + IntToStr(NSym) + '   footprints: ' + IntToStr(NFp) + #13#10 +
    'modelos: ' + IntToStr(NModel) + '   obsoletos marcados: ' + IntToStr(NObs) + #13#10#13#10 +
    'relatorio: ' + REPORT_FILE);
end;
