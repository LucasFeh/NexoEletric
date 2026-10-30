//! A casca do NexoEletric nativo: projetos, vista PCB na GPU, camadas, propriedades e mudancas.

use crate::pcbview::{self, DrawItem, Mesh, PcbCallback, ViewUniform};
use crate::settings::Settings;
use egui::{Color32, Key, PointerButton, Pos2, Rect, RichText, Sense, Vec2};
use nexo_core::changes::Level;
use nexo_core::pick::{self, ItemRef, PickIndex};
use nexo_core::project::{self, Project, ProjectEntry};
use nexo_core::scene::{self, rgba, Capsule, Scene, Vert};
use nexo_core::{layers, Board};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const COR_FUNDO: Color32 = Color32::from_rgb(0x6b, 0x6b, 0x6b);
const ACENTO: Color32 = Color32::from_rgb(0x3d, 0x9b, 0xff);
const GRADE_5MIL: f64 = 0.127;

#[derive(Clone, Copy)]
pub struct View {
    pub cx: f64,
    pub cy: f64,
    /// pontos de tela por mm
    pub scale: f64,
    pub flip: bool,
}

impl View {
    fn to_world(&self, rect: Rect, p: Pos2) -> (f64, f64) {
        let fx = if self.flip { -1.0 } else { 1.0 };
        let c = rect.center();
        (
            (p.x as f64 - c.x as f64) / (self.scale * fx) + self.cx,
            (c.y as f64 - p.y as f64) / self.scale + self.cy,
        )
    }
    fn to_screen(&self, rect: Rect, x: f64, y: f64) -> Pos2 {
        let fx = if self.flip { -1.0 } else { 1.0 };
        let c = rect.center();
        Pos2::new((c.x as f64 + (x - self.cx) * self.scale * fx) as f32, (c.y as f64 - (y - self.cy) * self.scale) as f32)
    }
}

struct Loaded {
    proj: Project,
    scene: Arc<Scene>,
    scene_gen: u64,
    pick: PickIndex,
    present: Vec<String>,
}

impl Loaded {
    fn eb(&self) -> &Board {
        &self.proj.applied.board
    }
}

#[derive(PartialEq, Clone, Copy)]
enum Aba {
    Propriedades,
    Mudancas,
    Placa,
}

/// Roteiro do modo --bench: espera a placa, fica parado `idle` segundos, depois anda pela placa
/// sozinho (zoom 1x..12x e pan) por `secs` segundos e grava as medidas. A fase atual vai para o
/// arquivo `fase` (o medidor externo le) -- o mesmo protocolo do teste do Electron.
pub struct Bench {
    pub secs: f64,
    pub idle: f64,
    pub out: PathBuf,
    pub fase: Option<PathBuf>,
    pub t0: Instant,
    pronto: Option<Instant>,
    start: Option<Instant>,
    frames: Vec<f64>,
}

impl Bench {
    pub fn new(secs: f64, idle: f64, out: PathBuf, fase: Option<PathBuf>, t0: Instant) -> Bench {
        Bench { secs, idle, out, fase, t0, pronto: None, start: None, frames: Vec::new() }
    }
    fn marca(&self, f: &str) {
        if let Some(p) = &self.fase {
            let _ = std::fs::write(p, f);
        }
    }
}

pub struct NexoApp {
    settings: Settings,
    entries: Vec<ProjectEntry>,
    filtro: String,
    loaded: Option<Loaded>,
    erro: Option<String>,
    view: View,
    vis: HashMap<String, bool>,
    current: String,
    unica: bool,
    grade: bool,
    fantasmas: bool,
    hover: Option<ItemRef>,
    sel: Vec<ItemRef>,
    net_hl: Option<String>,
    hl_mesh: Option<(Arc<Mesh>, u64)>,
    sel_mesh: Option<(Arc<Mesh>, u64)>,
    sel_key: Vec<ItemRef>,
    gen: u64,
    aba: Aba,
    cursor_w: Option<(f64, f64)>,
    pcb_rect: Rect,
    fit_pending: bool,
    // medidas de quadro (intervalo entre quadros e tempo de CPU da UI)
    frame_dt: VecDeque<f64>,
    ui_ms: VecDeque<f64>,
    last_frame: Option<Instant>,
    watch_dir: Arc<Mutex<Option<PathBuf>>>,
    watch_flag: Arc<AtomicBool>,
    pub bench: Option<Bench>,
    msaa: u32,
    adapter: String,
}

impl NexoApp {
    pub fn new(cc: &eframe::CreationContext<'_>, msaa: u32, open: Option<PathBuf>, bench: Option<Bench>) -> NexoApp {
        let mut adapter = String::new();
        if let Some(rs) = cc.wgpu_render_state.as_ref() {
            let i = rs.adapter.get_info();
            adapter = format!("{} ({:?})", i.name, i.backend);
            let gpu = pcbview::PcbGpu::new(&rs.device, rs.target_format, msaa);
            rs.renderer.write().callback_resources.insert(gpu);
        }
        crate::theme::apply(&cc.egui_ctx);
        let settings = Settings::load();
        let watch_dir: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
        let watch_flag = Arc::new(AtomicBool::new(false));
        spawn_watcher(cc.egui_ctx.clone(), watch_dir.clone(), watch_flag.clone());
        let mut app = NexoApp {
            entries: project::scan(&settings.roots),
            settings,
            filtro: String::new(),
            loaded: None,
            erro: None,
            view: View { cx: 0.0, cy: 0.0, scale: 5.0, flip: false },
            vis: HashMap::new(),
            current: "Top".into(),
            unica: false,
            grade: true,
            fantasmas: true,
            hover: None,
            sel: Vec::new(),
            net_hl: None,
            hl_mesh: None,
            sel_mesh: None,
            sel_key: Vec::new(),
            gen: 1,
            aba: Aba::Propriedades,
            cursor_w: None,
            pcb_rect: Rect::from_min_size(Pos2::ZERO, Vec2::splat(100.0)),
            fit_pending: true,
            frame_dt: VecDeque::new(),
            ui_ms: VecDeque::new(),
            last_frame: None,
            watch_dir,
            watch_flag,
            bench,
            msaa,
            adapter,
        };
        let alvo = open.or_else(|| app.settings.last.clone().filter(|p| p.join("board.js").exists()));
        if let Some(dir) = alvo {
            app.open(dir);
        }
        app
    }

    fn open(&mut self, dir: PathBuf) {
        match project::load(&dir) {
            Ok(p) => {
                self.erro = None;
                self.settings.last = Some(dir.clone());
                self.settings.save();
                *self.watch_dir.lock().unwrap() = Some(dir.clone());
                let mesmo = self.loaded.as_ref().map(|l| l.proj.dir == dir).unwrap_or(false);
                self.install(p, !mesmo);
            }
            Err(e) => self.erro = Some(format!("{}: {e}", dir.display())),
        }
    }

    fn install(&mut self, p: Project, nova: bool) {
        let ghosts = Some(p.applied.ghosts.clone());
        let sc = scene::build(&p.applied.board, &scene::BuildOpts { flipped: self.view.flip, ghosts, ..Default::default() });
        let pick = PickIndex::build(&p.applied.board);
        let present: Vec<String> = sc.layers.iter().map(|l| l.key.clone()).collect();
        self.gen += 1;
        if nova {
            self.vis.clear();
            self.sel.clear();
            self.hover = None;
            self.net_hl = None;
            self.fit_pending = true;
            self.current = if present.iter().any(|k| k == "Top") { "Top".into() } else { present.first().cloned().unwrap_or_default() };
        }
        self.loaded = Some(Loaded { proj: p, scene: Arc::new(sc), scene_gen: self.gen, pick, present });
        self.sel.retain(|_| !nova);
        self.rebuild_hl();
        self.sel_key.clear();
    }

    fn reload(&mut self) {
        if let Some(dir) = self.loaded.as_ref().map(|l| l.proj.dir.clone()) {
            match project::load(&dir) {
                Ok(p) => {
                    self.sel.clear();
                    self.hover = None;
                    self.install(p, false)
                }
                Err(e) => self.erro = Some(e),
            }
        }
    }

    fn rebuild_scene(&mut self) {
        if let Some(l) = &mut self.loaded {
            let sc = scene::build(&l.proj.applied.board, &scene::BuildOpts { flipped: self.view.flip, ghosts: Some(l.proj.applied.ghosts.clone()), ..Default::default() });
            self.gen += 1;
            l.scene = Arc::new(sc);
            l.scene_gen = self.gen;
        }
    }

    fn visible(&self, k: &str) -> bool {
        if self.vis.get(k) == Some(&false) {
            return false;
        }
        if !self.unica {
            return true;
        }
        k == self.current || (k == "Multi" && layers::is_copper(&self.current))
    }

    fn fit(&mut self) {
        let Some(l) = &self.loaded else { return };
        let b = l.scene.extents.clone();
        let r = self.pcb_rect;
        let (w, h) = ((b.x2 - b.x1).max(1.0), (b.y2 - b.y1).max(1.0));
        self.view.cx = (b.x1 + b.x2) / 2.0;
        self.view.cy = (b.y1 + b.y2) / 2.0;
        self.view.scale = ((r.width() as f64 / w).min(r.height() as f64 / h) * 0.92).clamp(0.3, 30000.0);
    }

    fn zoom_at(&mut self, p: Pos2, factor: f64) {
        let r = self.pcb_rect;
        let (wx, wy) = self.view.to_world(r, p);
        self.view.scale = (self.view.scale * factor).clamp(0.3, 30000.0);
        let fx = if self.view.flip { -1.0 } else { 1.0 };
        let c = r.center();
        self.view.cx = wx - (p.x as f64 - c.x as f64) / (self.view.scale * fx);
        self.view.cy = wy + (p.y as f64 - c.y as f64) / self.view.scale;
    }

    fn layer_color(&self, k: &str) -> [u8; 3] {
        let bl = self.loaded.as_ref().map(|l| l.eb().layers.as_slice()).unwrap_or(&[]);
        layers::color_of(k, bl)
    }

    fn rebuild_hl(&mut self) {
        self.hl_mesh = None;
        let Some(l) = &self.loaded else { return };
        let Some(net) = self.net_hl.clone() else { return };
        let bl = l.eb().layers.clone();
        let (v, i, c) = scene::highlight(l.eb(), Some(&net), &[], &|k| rgba(layers::color_of(k, &bl), 1.0));
        self.gen += 1;
        self.hl_mesh = Some((Arc::new(Mesh { verts: v, idx: i, caps: c }), self.gen));
    }

    fn rebuild_sel(&mut self) {
        let mut key = self.sel.clone();
        if let Some(h) = self.hover {
            key.push(h);
        }
        if key == self.sel_key {
            return;
        }
        self.sel_key = key;
        let Some(l) = &self.loaded else { return };
        let mut m = Mesh::default();
        let white = rgba([255, 255, 255], 0.55);
        let hov = rgba([255, 255, 255], 0.30);
        let (v, i, c) = scene::highlight(l.eb(), None, &self.sel, &|_| white);
        m.verts = v;
        m.idx = i;
        m.caps = c;
        if let Some(h) = self.hover.filter(|h| !self.sel.contains(h)) {
            let (v, i, c) = scene::highlight(l.eb(), None, &[h], &|_| hov);
            let base = m.verts.len() as u32;
            m.verts.extend(v);
            m.idx.extend(i.into_iter().map(|x| x + base));
            m.caps.extend(c);
        }
        self.gen += 1;
        self.sel_mesh = if m.verts.is_empty() && m.caps.is_empty() { None } else { Some((Arc::new(m), self.gen)) };
    }

    // ------------------------------------------------------------------ UI

    fn menu(&mut self, ui: &mut egui::Ui) {
        egui::MenuBar::new().ui(ui, |ui| {
            ui.menu_button("Arquivo", |ui| {
                if ui.button("Abrir pasta de projeto…").clicked() {
                    if let Some(d) = rfd::FileDialog::new().set_title("Pasta do projeto (com board.js)").pick_folder() {
                        self.open(d);
                    }
                    ui.close();
                }
                if ui.button("Adicionar pasta de projetos…").clicked() {
                    if let Some(d) = rfd::FileDialog::new().set_title("Pasta com projetos do NexoEletric").pick_folder() {
                        if !self.settings.roots.contains(&d) {
                            self.settings.roots.push(d);
                            self.settings.save();
                            self.entries = project::scan(&self.settings.roots);
                        }
                    }
                    ui.close();
                }
                if ui.button("Recarregar placa (F5)").clicked() {
                    self.reload();
                    ui.close();
                }
                ui.separator();
                if ui.button("Sair").clicked() {
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                }
            });
            ui.menu_button("Exibir", |ui| {
                if ui.button("Ajustar à placa (Home)").clicked() {
                    self.fit();
                    ui.close();
                }
                if ui.checkbox(&mut self.view.flip, "Virar placa (V, B)").changed() {
                    self.rebuild_scene();
                }
                ui.checkbox(&mut self.unica, "Camada única (Shift+S)");
                ui.checkbox(&mut self.grade, "Grade");
                ui.checkbox(&mut self.fantasmas, "Mostrar diferenças do changes.js");
                ui.separator();
                if ui.button("Mostrar todas as camadas").clicked() {
                    self.vis.clear();
                    ui.close();
                }
            });
            ui.menu_button("Ajuda", |ui| {
                ui.label(RichText::new("NexoEletric nativo (Rust + wgpu)").strong());
                ui.label(format!("versão {}", env!("CARGO_PKG_VERSION")));
                ui.separator();
                ui.label("Roda: zoom no cursor · Shift+roda: horizontal");
                ui.label("Botão direito/meio arrastando: mover a vista");
                ui.label("Clique: selecionar · Ctrl+clique: realçar a net");
                ui.label("Home: ajustar · Shift+S: camada única · +/-: camada");
                ui.label("Esc: limpar seleção e realce");
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if let Some(l) = &self.loaded {
                    ui.label(RichText::new(&l.proj.name).color(ACENTO).strong());
                }
            });
        });
    }

    fn projects_panel(&mut self, ui: &mut egui::Ui) {
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("PROJETOS").small().strong());
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.small_button("⟳").on_hover_text("Procurar de novo").clicked() {
                    self.entries = project::scan(&self.settings.roots);
                }
            });
        });
        ui.add(egui::TextEdit::singleline(&mut self.filtro).hint_text("filtrar…").desired_width(f32::INFINITY));
        ui.add_space(4.0);
        let atual = self.loaded.as_ref().map(|l| l.proj.dir.clone());
        let f = self.filtro.to_lowercase();
        let mut abrir = None;
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            for e in self.entries.iter().filter(|e| f.is_empty() || e.name.to_lowercase().contains(&f)) {
                let sel = atual.as_ref() == Some(&e.dir);
                let r = ui.add(egui::Button::selectable(sel, &e.name).truncate()).on_hover_text(format!(
                    "{}\nboard.js: {} KB{}",
                    e.dir.display(),
                    e.board_size / 1024,
                    if e.has_sch { " · tem esquema" } else { "" }
                ));
                if r.clicked() && !sel {
                    abrir = Some(e.dir.clone());
                }
            }
            if self.entries.is_empty() {
                ui.label(RichText::new("Nenhum projeto encontrado. Use Arquivo › Adicionar pasta de projetos.").weak());
            }
        });
        if let Some(d) = abrir {
            self.open(d);
        }
    }

    fn props_panel(&mut self, ui: &mut egui::Ui) {
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.aba, Aba::Propriedades, "Propriedades");
            let n = self.loaded.as_ref().map(|l| l.proj.changes.len()).unwrap_or(0);
            ui.selectable_value(&mut self.aba, Aba::Mudancas, format!("Mudanças ({n})"));
            ui.selectable_value(&mut self.aba, Aba::Placa, "Placa");
        });
        ui.separator();
        let Some(l) = &self.loaded else {
            ui.label(RichText::new("Abra um projeto.").weak());
            return;
        };
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| match self.aba {
            Aba::Propriedades => {
                if self.sel.is_empty() {
                    ui.label(RichText::new("Nada selecionado. Clique num objeto da placa.").weak());
                    if let Some(n) = &self.net_hl {
                        ui.add_space(6.0);
                        ui.label(format!("Net realçada: {n}"));
                    }
                }
                for it in self.sel.clone() {
                    let (titulo, kv) = pick::describe(l.eb(), it);
                    ui.label(RichText::new(titulo).strong().color(ACENTO));
                    egui::Grid::new(format!("{it:?}")).num_columns(2).striped(true).show(ui, |ui| {
                        for (k, v) in kv {
                            ui.label(RichText::new(k).weak());
                            ui.label(v);
                            ui.end_row();
                        }
                    });
                    ui.add_space(8.0);
                }
            }
            Aba::Mudancas => {
                let (ok, w, e) = l.proj.applied.counts();
                ui.label(format!("{ok} ok · {w} aviso(s) · {e} erro(s)"));
                ui.add_space(4.0);
                for s in &l.proj.applied.status {
                    let (cor, sinal) = match s.level {
                        Level::Ok => (Color32::from_rgb(0x00, 0xe6, 0x76), "✔"),
                        Level::Warn => (Color32::from_rgb(0xff, 0xd5, 0x4f), "⚠"),
                        Level::Err => (Color32::from_rgb(0xff, 0x52, 0x52), "✖"),
                    };
                    ui.horizontal_wrapped(|ui| {
                        ui.label(RichText::new(sinal).color(cor));
                        ui.label(RichText::new(format!("#{} {}", s.idx + 1, s.op)).monospace());
                        if !s.note.is_empty() {
                            ui.label(RichText::new(&s.note).weak());
                        }
                    });
                    if !s.msg.is_empty() {
                        ui.label(RichText::new(&s.msg).color(cor).small());
                    }
                }
                if l.proj.applied.status.is_empty() {
                    ui.label(RichText::new("changes.js vazio: a placa é a espelhada.").weak());
                }
            }
            Aba::Placa => {
                let p = &l.proj;
                let ext = &l.scene.extents;
                egui::Grid::new("placa").num_columns(2).striped(true).show(ui, |ui| {
                    let mut kv = |k: &str, v: String| {
                        ui.label(RichText::new(k).weak());
                        ui.label(v);
                        ui.end_row();
                    };
                    kv("Projeto", p.name.clone());
                    kv("Formato", p.board.format.clone());
                    kv("Exportado", p.board.generated.clone());
                    kv("Tamanho", format!("{:.2} x {:.2} mm", ext.x2 - ext.x1, ext.y2 - ext.y1));
                    for (k, n) in l.eb().counts() {
                        kv(k, n.to_string());
                    }
                    kv("Triângulos (GPU)", l.scene.stats.triangles.to_string());
                    kv("Cápsulas (GPU)", l.scene.stats.capsules.to_string());
                    kv("Ler arquivos", format!("{:.1} ms", p.timings.read_ms));
                    kv("Interpretar", format!("{:.1} ms", p.timings.parse_ms));
                    kv("Aplicar mudanças", format!("{:.1} ms", p.timings.apply_ms));
                    kv("Montar malha", format!("{:.1} ms", l.scene.stats.build_ms));
                    kv("MSAA", format!("{}x", self.msaa));
                    kv("GPU", self.adapter.clone());
                });
                ui.add_space(6.0);
                ui.label(RichText::new(p.board.source.clone()).weak().small());
            }
        });
    }

    fn layer_bar(&mut self, ui: &mut egui::Ui) {
        let Some(l) = &self.loaded else { return };
        let present = l.present.clone();
        ui.horizontal(|ui| {
            egui::ScrollArea::horizontal().id_salt("camadas").show(ui, |ui| {
                ui.horizontal(|ui| {
                    for k in present.iter().filter(|k| layers::by_key(k).is_some()) {
                        let c = self.layer_color(k);
                        let cor = Color32::from_rgb(c[0], c[1], c[2]);
                        let on = self.vis.get(k) != Some(&false);
                        let atual = *k == self.current;
                        let (rect, resp) = ui.allocate_exact_size(Vec2::new(ui.fonts_mut(|f| f.layout_no_wrap(layers::name_of(k), egui::FontId::proportional(12.0), Color32::WHITE).size().x) + 26.0, 20.0), Sense::click());
                        let p = ui.painter();
                        p.rect_filled(rect, 3.0, if atual { Color32::from_gray(70) } else { Color32::from_gray(40) });
                        let sw = Rect::from_min_size(rect.min + Vec2::new(5.0, 5.0), Vec2::splat(10.0));
                        if on {
                            p.rect_filled(sw, 2.0, cor);
                        } else {
                            p.rect_stroke(sw, 2.0, egui::Stroke::new(1.0, cor), egui::StrokeKind::Inside);
                        }
                        p.text(
                            rect.min + Vec2::new(20.0, 10.0),
                            egui::Align2::LEFT_CENTER,
                            layers::name_of(k),
                            egui::FontId::proportional(12.0),
                            if on { Color32::WHITE } else { Color32::GRAY },
                        );
                        if atual {
                            p.line_segment([rect.left_bottom(), rect.right_bottom()], egui::Stroke::new(2.0, cor));
                        }
                        if resp.clicked() {
                            self.current = k.clone();
                        }
                        if resp.secondary_clicked() {
                            self.vis.insert(k.clone(), !on);
                        }
                        resp.on_hover_text("Clique: camada atual · Botão direito: mostrar/esconder");
                    }
                });
            });
        });
    }

    fn status_bar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            if let Some((x, y)) = self.cursor_w {
                ui.label(RichText::new(format!("X {:>9.3}  Y {:>9.3} mm", x, y)).monospace());
                ui.separator();
            }
            ui.label(RichText::new(format!("zoom {:.1} px/mm", self.view.scale)).monospace());
            ui.separator();
            let avg = |q: &VecDeque<f64>| if q.is_empty() { 0.0 } else { q.iter().sum::<f64>() / q.len() as f64 };
            let dt = avg(&self.frame_dt);
            if dt > 0.0 {
                ui.label(RichText::new(format!("{:.0} fps · UI {:.2} ms", 1000.0 / dt, avg(&self.ui_ms))).monospace());
                ui.separator();
            }
            ui.label(RichText::new(format!("camada atual: {}", layers::name_of(&self.current))).monospace());
            if let Some(n) = &self.net_hl {
                ui.separator();
                ui.label(RichText::new(format!("net: {n}")).color(ACENTO));
            }
            if let Some(e) = &self.erro {
                ui.separator();
                ui.label(RichText::new(e).color(Color32::from_rgb(0xff, 0x52, 0x52)));
            }
        });
    }

    fn pcb(&mut self, ui: &mut egui::Ui) {
        let (rect, resp) = ui.allocate_exact_size(ui.available_size(), Sense::click_and_drag());
        self.pcb_rect = rect;
        ui.painter().rect_filled(rect, 0.0, COR_FUNDO);
        if self.loaded.is_none() {
            ui.painter().text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                "Escolha um projeto à esquerda (ou Arquivo › Abrir pasta de projeto)",
                egui::FontId::proportional(16.0),
                Color32::from_gray(220),
            );
            return;
        }
        // ajusta a placa a janela ate a pessoa mexer na vista (a janela maximiza depois do 1o quadro)
        if self.fit_pending && rect.width() > 10.0 {
            self.fit();
        }

        // ---- entrada ----
        let (events, mods, hover_pos) = ui.input(|i| (i.events.clone(), i.modifiers, i.pointer.hover_pos()));
        if resp.hovered() {
            for e in &events {
                if let egui::Event::MouseWheel { unit, delta, modifiers, .. } = e {
                    let esc = match unit {
                        egui::MouseWheelUnit::Line => 16.0,
                        egui::MouseWheelUnit::Page => 400.0,
                        egui::MouseWheelUnit::Point => 1.0,
                    };
                    if modifiers.shift {
                        let d = (if delta.x != 0.0 { delta.x } else { delta.y }) as f64 * esc;
                        let fx = if self.view.flip { -1.0 } else { 1.0 };
                        self.view.cx -= d / (self.view.scale * fx);
                    } else if delta.y != 0.0 {
                        if let Some(p) = hover_pos {
                            let notches = (delta.y as f64 * esc / 50.0).clamp(-3.0, 3.0);
                            let f = if notches.abs() < 1.0 { 1.18f64.powf(notches) } else { 1.18f64.powf(notches.signum() * notches.abs().max(1.0)) };
                            self.zoom_at(p, f);
                        }
                    }
                }
            }
        }
        let mexeu = resp.dragged() || (resp.hovered() && events.iter().any(|e| matches!(e, egui::Event::MouseWheel { .. })));
        if mexeu {
            self.fit_pending = false;
        }
        if resp.dragged_by(PointerButton::Secondary) || resp.dragged_by(PointerButton::Middle) {
            let d = resp.drag_delta();
            let fx = if self.view.flip { -1.0 } else { 1.0 };
            self.view.cx -= d.x as f64 / (self.view.scale * fx);
            self.view.cy += d.y as f64 / self.view.scale;
        }
        self.cursor_w = hover_pos.filter(|p| rect.contains(*p)).map(|p| self.view.to_world(rect, p));

        // hover e selecao
        let tol = 3.0 / self.view.scale;
        let mut new_hover = None;
        if let (Some((x, y)), Some(l)) = (self.cursor_w, &self.loaded) {
            if !resp.dragged() {
                let vis = |k: &str| self.visible(k);
                new_hover = l.pick.pick(l.eb(), x, y, tol, &self.current, &vis);
            }
        }
        self.hover = new_hover;
        if resp.clicked() {
            if mods.ctrl {
                let net = self.hover.and_then(|h| self.loaded.as_ref().and_then(|l| pick::net_of(l.eb(), h)));
                self.net_hl = if net == self.net_hl { None } else { net };
                self.rebuild_hl();
            } else if let Some(h) = self.hover {
                if mods.shift {
                    if let Some(i) = self.sel.iter().position(|s| *s == h) {
                        self.sel.remove(i);
                    } else {
                        self.sel.push(h);
                    }
                } else {
                    self.sel = vec![h];
                }
                self.aba = Aba::Propriedades;
            } else {
                self.sel.clear();
            }
        }
        if resp.double_clicked() {
            if let Some(h) = self.hover {
                if let Some(net) = self.loaded.as_ref().and_then(|l| pick::net_of(l.eb(), h)) {
                    self.net_hl = Some(net);
                    self.rebuild_hl();
                }
            }
        }
        self.rebuild_sel();

        // ---- o quadro ----
        let Some(l) = &self.loaded else { return };
        let ppp = ui.ctx().pixels_per_point() as f64;
        let scale_px = self.view.scale * ppp;
        let (wpx, hpx) = (rect.width() as f64 * ppp, rect.height() as f64 * ppp);
        let fx = if self.view.flip { -1.0 } else { 1.0 };
        let sx = scale_px * fx * 2.0 / wpx;
        let sy = scale_px * 2.0 / hpx;
        let mut passo = GRADE_5MIL;
        let mut n = 0;
        while passo * self.view.scale < 7.0 && n < 30 {
            passo *= if n % 2 == 0 { 5.0 } else { 2.0 };
            n += 1;
        }
        let g1 = [0x1c as f32 / 255.0, 0x1c as f32 / 255.0, 0x1c as f32 / 255.0, 1.0];
        let g2 = [0x30 as f32 / 255.0, 0x30 as f32 / 255.0, 0x30 as f32 / 255.0, 1.0];
        let uni = ViewUniform {
            xf: [sx as f32, sy as f32, (-self.view.cx * sx) as f32, (-self.view.cy * sy) as f32],
            px: [(1.0 / scale_px) as f32, passo as f32, if self.grade { 1.0 } else { 0.0 }, 1.0],
            grid1: g1,
            grid2: g2,
        };
        let sc = &l.scene;
        let mut draws = Vec::with_capacity(sc.layers.len() + 4);
        if let Some(b) = &sc.board {
            draws.push(DrawItem { tris: b.tris.clone(), caps: b.caps.clone(), board: true });
        }
        let order = layers::draw_order(&l.present, self.view.flip, &self.current);
        for k in &order {
            if !self.visible(k) {
                continue;
            }
            if let Some(m) = sc.layers.iter().find(|m| m.key == *k) {
                draws.push(DrawItem { tris: m.tris.clone(), caps: m.caps.clone(), board: false });
            }
        }
        for m in [&sc.drills, &sc.outline].into_iter().flatten() {
            draws.push(DrawItem { tris: m.tris.clone(), caps: m.caps.clone(), board: false });
        }
        if self.fantasmas {
            if let Some(m) = &sc.overlay {
                draws.push(DrawItem { tris: m.tris.clone(), caps: m.caps.clone(), board: false });
            }
        }
        // marcas que dependem do zoom: a origem; e o veu do realce de net
        let mut dyn_caps: Vec<Capsule> = Vec::new();
        let origem = rgba([0xe0, 0xe0, 0xe0], 1.0);
        let r = 9.0 / self.view.scale;
        dyn_caps.push(Capsule { p0: [-r as f32, 0.0], p1: [r as f32, 0.0], w: -1.2, color: origem });
        dyn_caps.push(Capsule { p0: [0.0, -r as f32], p1: [0.0, r as f32], w: -1.2, color: origem });
        let circ = nexo_core::geom::arc_points(0.0, 0.0, r * 0.55, 0.0, 360.0, r * 0.01);
        for s in circ.windows(2) {
            dyn_caps.push(Capsule { p0: [s[0][0] as f32, s[0][1] as f32], p1: [s[1][0] as f32, s[1][1] as f32], w: -1.2, color: origem });
        }
        let (mut dyn_tris, mut dyn_idx) = (Vec::new(), Vec::new());
        if self.hl_mesh.is_some() {
            let (a, b) = (self.view.to_world(rect, rect.left_top()), self.view.to_world(rect, rect.right_bottom()));
            let veu = rgba([0, 0, 0], 0.62);
            for (x, y) in [(a.0, a.1), (b.0, a.1), (b.0, b.1), (a.0, b.1)] {
                dyn_tris.push(Vert { pos: [x as f32, y as f32], color: veu });
            }
            dyn_idx.extend_from_slice(&[0, 1, 2, 0, 2, 3]);
        }
        let cb = PcbCallback {
            view: uni,
            scene: sc.clone(),
            scene_gen: l.scene_gen,
            draws,
            hl: self.hl_mesh.clone(),
            sel: self.sel_mesh.clone(),
            dyn_tris,
            dyn_tri_idx: dyn_idx,
            dyn_caps,
            veil_before_hl: true,
        };
        ui.painter().add(egui_wgpu::Callback::new_paint_callback(rect, cb));

        // a etiqueta do objeto sob o cursor
        if let (Some(h), Some(p)) = (self.hover, hover_pos) {
            let (t, kv) = pick::describe(l.eb(), h);
            let net = kv.iter().find(|(k, _)| k == "Net").map(|(_, v)| format!(" · {v}")).unwrap_or_default();
            let txt = format!("{t}{net}");
            let galley = ui.painter().layout_no_wrap(txt, egui::FontId::proportional(12.0), Color32::WHITE);
            let pos = p + Vec2::new(14.0, 14.0);
            let bg = Rect::from_min_size(pos - Vec2::new(4.0, 2.0), galley.size() + Vec2::new(8.0, 4.0));
            ui.painter().rect_filled(bg, 3.0, Color32::from_black_alpha(190));
            ui.painter().galley(pos, galley, Color32::WHITE);
        }
        let _ = self.view.to_screen(rect, 0.0, 0.0);
    }

    fn keys(&mut self, ctx: &egui::Context) {
        if ctx.egui_wants_keyboard_input() {
            return;
        }
        let (home, esc, f5, ss, plus, minus, v) = ctx.input(|i| {
            (
                i.key_pressed(Key::Home),
                i.key_pressed(Key::Escape),
                i.key_pressed(Key::F5),
                i.modifiers.shift && i.key_pressed(Key::S),
                i.key_pressed(Key::Plus) || i.key_pressed(Key::Equals),
                i.key_pressed(Key::Minus),
                i.key_pressed(Key::B) && i.modifiers.is_none(),
            )
        });
        if home {
            self.fit();
            self.fit_pending = false;
        }
        if esc {
            self.sel.clear();
            self.net_hl = None;
            self.rebuild_hl();
        }
        if f5 {
            self.reload();
        }
        if ss {
            self.unica = !self.unica;
        }
        if v {
            self.view.flip = !self.view.flip;
            self.rebuild_scene();
        }
        if plus || minus {
            if let Some(l) = &self.loaded {
                let ks: Vec<&String> = l.present.iter().filter(|k| layers::by_key(k).is_some()).collect();
                if let Some(i) = ks.iter().position(|k| **k == self.current) {
                    let n = ks.len();
                    let j = if plus { (i + 1) % n } else { (i + n - 1) % n };
                    self.current = ks[j].clone();
                }
            }
        }
    }

    fn run_bench(&mut self, ctx: &egui::Context) {
        let Some(b) = &mut self.bench else { return };
        if self.loaded.is_none() {
            return;
        }
        self.fit_pending = false;
        let now = Instant::now();
        // 1) a placa na tela: o quadro em que ela foi desenhada pela primeira vez
        let pronto = match b.pronto {
            Some(p) => p,
            None => {
                b.pronto = Some(now);
                b.marca("parado");
                ctx.request_repaint();
                return;
            }
        };
        // 2) parado: nenhum quadro pedido; so um despertador para o fim da espera
        let parado = (now - pronto).as_secs_f64();
        if parado < b.idle {
            ctx.request_repaint_after(Duration::from_secs_f64(b.idle - parado));
            self.fit();
            return;
        }
        // 3) animando
        let st = match b.start {
            Some(s) => s,
            None => {
                b.marca("animando");
                b.start = Some(now);
                now
            }
        };
        let t = (now - st).as_secs_f64();
        if let Some(l) = self.last_frame {
            if t > 0.5 {
                b.frames.push((now - l).as_secs_f64() * 1000.0);
            }
        }
        let ext = self.loaded.as_ref().unwrap().scene.extents.clone();
        let (w, h) = (ext.x2 - ext.x1, ext.y2 - ext.y1);
        let r = self.pcb_rect;
        let base = ((r.width() as f64 / w.max(1.0)).min(r.height() as f64 / h.max(1.0)) * 0.92).max(0.3);
        let z = 1.0 + 5.5 * (1.0 - (t * 0.9).cos());
        self.view.scale = base * z;
        self.view.cx = (ext.x1 + ext.x2) / 2.0 + w * 0.35 * (t * 0.55).sin();
        self.view.cy = (ext.y1 + ext.y2) / 2.0 + h * 0.35 * (t * 0.37).cos();
        ctx.request_repaint();
        if t >= b.secs {
            b.marca("fim");
            let mut fr = b.frames.clone();
            fr.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let n = fr.len().max(1);
            let pct = |p: f64| fr.get(((n as f64 - 1.0) * p).round() as usize).copied().unwrap_or(0.0);
            let mean = fr.iter().sum::<f64>() / n as f64;
            let l = self.loaded.as_ref().unwrap();
            let out = serde_json::json!({
                "app": "NexoEletric-rust",
                "gpu": self.adapter,
                "projeto": l.proj.name,
                "abrir_ms": (pronto - b.t0).as_secs_f64() * 1000.0,
                "carga_ms": { "ler": l.proj.timings.read_ms, "interpretar": l.proj.timings.parse_ms,
                              "mudancas": l.proj.timings.apply_ms, "malha": l.scene.stats.build_ms },
                "area_px": [r.width(), r.height()],
                "segundos": b.secs,
                "quadros": fr.len(),
                "fps_medio": if mean > 0.0 { 1000.0 / mean } else { 0.0 },
                "quadro_ms": { "medio": mean, "p50": pct(0.5), "p95": pct(0.95), "p99": pct(0.99), "max": fr.last().copied().unwrap_or(0.0) },
                "ui_ms_medio": self.ui_ms.iter().sum::<f64>() / self.ui_ms.len().max(1) as f64,
            });
            let _ = std::fs::write(&b.out, serde_json::to_string_pretty(&out).unwrap());
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            self.bench = None;
        }
    }
}

impl eframe::App for NexoApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let t0 = Instant::now();
        let ctx = ui.ctx().clone();
        let now = Instant::now();
        if let Some(l) = self.last_frame {
            let dt = (now - l).as_secs_f64() * 1000.0;
            if dt < 1000.0 {
                self.frame_dt.push_back(dt);
                if self.frame_dt.len() > 60 {
                    self.frame_dt.pop_front();
                }
            } else {
                self.frame_dt.clear();
            }
        }
        if self.watch_flag.swap(false, Ordering::Relaxed) {
            self.reload();
        }
        self.run_bench(&ctx);
        self.last_frame = Some(now);
        self.keys(&ctx);

        egui::Panel::top("menu").show(ui, |ui| self.menu(ui));
        egui::Panel::bottom("status").exact_size(22.0).show(ui, |ui| self.status_bar(ui));
        egui::Panel::bottom("camadas").exact_size(28.0).show(ui, |ui| self.layer_bar(ui));
        egui::Panel::left("projetos").default_size(240.0).resizable(true).show(ui, |ui| self.projects_panel(ui));
        egui::Panel::right("props").default_size(300.0).resizable(true).show(ui, |ui| self.props_panel(ui));
        egui::CentralPanel::default().frame(egui::Frame::new().fill(COR_FUNDO)).show(ui, |ui| self.pcb(ui));

        self.ui_ms.push_back(t0.elapsed().as_secs_f64() * 1000.0);
        if self.ui_ms.len() > 60 {
            self.ui_ms.pop_front();
        }
    }
}

/// Acompanha o board.js/changes.js do projeto aberto: o MCP e o Altium gravam e a vista
/// recarrega sozinha (como a vista do hub).
fn spawn_watcher(ctx: egui::Context, dir: Arc<Mutex<Option<PathBuf>>>, flag: Arc<AtomicBool>) {
    std::thread::Builder::new()
        .name("vigia".into())
        .spawn(move || {
            let mut last: Option<(PathBuf, project::Stamp)> = None;
            loop {
                std::thread::sleep(Duration::from_millis(500));
                let Some(d) = dir.lock().unwrap().clone() else { continue };
                let s = project::stamp(&d);
                match &last {
                    Some((ld, ls)) if *ld == d && *ls != s => {
                        flag.store(true, Ordering::Relaxed);
                        ctx.request_repaint();
                    }
                    _ => {}
                }
                last = Some((d, s));
            }
        })
        .ok();
}
