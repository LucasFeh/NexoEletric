//! NexoEletric: a mesma interface web do hub, numa casca Rust no lugar do Electron.
//! - janela nativa (tao) + WebView2 do Windows (wry): nada de Chromium proprio nem Node;
//! - o servidor do hub em Rust no mesmo processo (nexo-hub): a abertura nao espera o Python, que so
//!   sobe (em segundo plano, preso a um Job Object) quando alguem pede uma rota que ficou nele;
//! - a vista PCB desenhada no WebGL com a malha do nucleo Rust (WASM).
//!
//! Uso: NexoEletric [--workspace PASTA] [--projeto NOME] [--aba pcb|esquema] [--porta N]
//!                  [--so-servidor] [--sem-remendos] [--sem-sessao] [--nexobd] [--cdp PORTA] [--livre] [--dados PASTA]
//!
//! NO INSTALADOR DO NEXOELETRIC (1.54.0+): o atalho abre o NexoEletric.exe de sempre (Electron), que
//! vira o MOTOR DE FUNDO, sem janela -- pasta de trabalho, sincronia com o NexoBD, configuracoes, o
//! runtime do MCP -- e abre esta janela (resources\rust\NexoEletric.exe) com NEXOELETRIC_MOTOR=1:
//!   - o menu que esta casca ainda nao tem (configuracoes, Conectar IA, Nexo Hub, Sobre...) sai pela
//!     saida padrao como "menu:<id>", e o motor abre a tela dele;
//!   - pela entrada padrao o motor manda "focar" (o atalho clicado de novo) e "toast <json>";
//!   - NEXOELETRIC_VERSAO = a versao do app, que vai para o session.json do MCP.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Fullscreen, WindowBuilder};
use wry::{DragDropEvent, NewWindowResponse, WebContext, WebViewBuilder, WebViewBuilderExtWindows};

/// Para onde vai um pedido de janela nova (link com target=_blank, window.open). Sem o tratador o wry
/// recusa todos em silencio, e o "Odoo ↗" dos componentes (hub-odoolink.js), o "Abrir em nova aba" e
/// qualquer link de fora pararam de abrir com a janela Rust (1.54.0). A regra e a do Electron
/// (electron/lib/web.js » endurecer): pagina do proprio hub abre numa janela do app; http, https e
/// mailto de fora vao para o navegador padrao do Windows; o resto nao abre.
#[derive(Debug, PartialEq)]
enum DestinoLink {
    Hub,
    Fora,
    Nada,
}

fn destino_link(url: &str, porta: u16) -> DestinoLink {
    let u = url.trim();
    if u.is_empty() || u.chars().any(|c| c.is_control() || c.is_whitespace() || c == '"') {
        return DestinoLink::Nada;
    }
    let l = u.to_ascii_lowercase();
    for h in [format!("http://127.0.0.1:{porta}"), format!("http://localhost:{porta}")] {
        if l == h || l.starts_with(&format!("{h}/")) || l.starts_with(&format!("{h}?")) || l.starts_with(&format!("{h}#")) {
            return DestinoLink::Hub;
        }
    }
    if l.starts_with("https://") || l.starts_with("http://") || l.starts_with("mailto:") {
        return DestinoLink::Fora;
    }
    DestinoLink::Nada
}

/// Abre no navegador padrao do Windows (o shell.openExternal do Electron). O rundll32 recebe a url
/// como um argumento so, sem passar pelo cmd (nada de & ou ^ virar comando); destino_link ja recusou
/// espaco, aspas e caractere de controle.
fn abre_fora(url: &str) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

enum Ev {
    Menu(String),
    Titulo(String),
    Arrastou(Vec<PathBuf>),
    Focar,
    Toast(String),
}

/// o mesmo AppUserModelID do Electron (app.setAppUserModelId e o appId do instalador): a janela
/// agrupa na barra de tarefas com o atalho do NexoEletric (e com ele fixado), com o icone dele
#[cfg(windows)]
fn app_id_do_nexoeletric() {
    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(id: *const u16) -> i32;
    }
    let id: Vec<u16> = "com.dieletrons.altiumhub".encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(id.as_ptr());
    }
}
#[cfg(not(windows))]
fn app_id_do_nexoeletric() {}

/// aberto pelo motor de fundo (o NexoEletric.exe Electron do instalador)?
fn com_motor() -> bool {
    std::env::var("NEXOELETRIC_MOTOR").map(|v| v == "1").unwrap_or(false)
}

struct Args {
    workspace: PathBuf,
    projeto: Option<String>,
    aba: String,
    porta: u16,
    python: Option<PathBuf>,
    web: PathBuf,
    so_servidor: bool,
    remendos: bool,
    sessao: bool,
    nexobd: bool,
    cdp: Option<u16>,
    livre: bool,
    dados: Option<PathBuf>,
}

fn exe_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default()
}

/// a pasta de trabalho do NexoEletric (a mesma do app Electron, se ele ja foi configurado)
fn workspace_padrao() -> PathBuf {
    let cfg = std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("NexoEletric").join("settings.json"));
    if let Some(ws) = cfg
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|j| j.get("workspace").and_then(|w| w.as_str()).map(PathBuf::from))
        .filter(|p| p.join("hub.html").exists())
    {
        return ws;
    }
    PathBuf::from(r"C:\AltiumHub")
}

fn args() -> Args {
    let mut a = Args {
        workspace: workspace_padrao(),
        projeto: None,
        aba: "pcb".into(),
        porta: 8250,
        python: None,
        web: PathBuf::new(),
        so_servidor: false,
        remendos: true,
        sessao: true,
        nexobd: std::env::var("ALTIUMHUB_NEXOBD").map(|v| v == "1").unwrap_or(false),
        cdp: None,
        livre: false,
        dados: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(x) = it.next() {
        match x.as_str() {
            "--workspace" => a.workspace = it.next().map(PathBuf::from).unwrap_or(a.workspace),
            "--projeto" => a.projeto = it.next(),
            "--aba" => a.aba = it.next().unwrap_or(a.aba),
            "--porta" => a.porta = it.next().and_then(|s| s.parse().ok()).unwrap_or(a.porta),
            "--python" => a.python = it.next().map(PathBuf::from),
            "--web" => a.web = it.next().map(PathBuf::from).unwrap_or_default(),
            "--so-servidor" => a.so_servidor = true,
            "--sem-remendos" => a.remendos = false,
            "--sem-sessao" => a.sessao = false,
            "--nexobd" => a.nexobd = true,
            "--cdp" => a.cdp = it.next().and_then(|s| s.parse().ok()),
            "--livre" => a.livre = true,
            "--dados" => a.dados = it.next().map(PathBuf::from),
            _ => {}
        }
    }
    if a.python.is_none() {
        a.python = [exe_dir().join("python").join("python.exe"), PathBuf::from(r"C:\Program Files\NexoEletric\resources\python\python.exe")]
            .into_iter()
            .find(|p| p.is_file());
    }
    if a.web.as_os_str().is_empty() {
        a.web = [exe_dir().join("web"), PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("web")]
            .into_iter()
            .find(|p| p.join("nexo-gl.js").is_file())
            .unwrap_or_else(|| exe_dir().join("web"));
    }
    a
}

fn slug(nome: &str) -> String {
    let mut s = String::new();
    let mut traco = false;
    for c in nome.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            s.push(c);
            traco = false;
        } else if !traco {
            s.push('-');
            traco = true;
        }
    }
    s.trim_matches('-').to_string()
}

// ---- o ~/.nexoeletric/session.json do MCP: so se nenhum NexoEletric vivo ja o ocupa ----
fn arq_sessao() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".nexoeletric").join("session.json"))
}

#[cfg(windows)]
fn vivo(pid: u32) -> bool {
    extern "system" {
        fn OpenProcess(acesso: u32, herda: i32, pid: u32) -> *mut core::ffi::c_void;
        fn GetExitCodeProcess(h: *mut core::ffi::c_void, codigo: *mut u32) -> i32;
        fn CloseHandle(h: *mut core::ffi::c_void) -> i32;
    }
    unsafe {
        let h = OpenProcess(0x1000, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut c = 0u32;
        let ok = GetExitCodeProcess(h, &mut c) != 0 && c == 259;
        CloseHandle(h);
        ok
    }
}
#[cfg(not(windows))]
fn vivo(_pid: u32) -> bool {
    false
}

fn grava_sessao(ws: &Path, porta: u16) -> bool {
    let Some(arq) = arq_sessao() else { return false };
    if let Some(pid) = std::fs::read_to_string(&arq)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|j| j.get("pid").and_then(|p| p.as_u64()))
    {
        if pid as u32 != std::process::id() && vivo(pid as u32) {
            eprintln!("[NexoEletric] outro NexoEletric esta aberto (pid {pid}): o session.json do MCP fica com ele");
            return false;
        }
    }
    let j = serde_json::json!({
        "app": "nexoeletric",
        "versao": std::env::var("NEXOELETRIC_VERSAO").unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string()),
        "hub": format!("http://127.0.0.1:{porta}"),
        "root": ws, "pid": std::process::id(), "mcp": ws.join("mcp").join("eletrichub-mcp.js"),
        "exe": std::env::current_exe().unwrap_or_default(), "iniciado": "",
    });
    if let Some(d) = arq.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    std::fs::write(&arq, serde_json::to_string_pretty(&j).unwrap()).is_ok()
}

fn apaga_sessao() {
    let Some(arq) = arq_sessao() else { return };
    let nosso = std::fs::read_to_string(&arq)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|j| j.get("pid").and_then(|p| p.as_u64()))
        == Some(std::process::id() as u64);
    if nosso {
        let _ = std::fs::remove_file(arq);
    }
}

/// a ponte que a pagina do hub espera (o preload.js do Electron): menu(id) e caminho(arquivo)
const PONTE: &str = r#"(function(){
  if (!(location.protocol === 'http:' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost'))) return;
  window.eletricApp = {
    menu: function (id) { window.ipc.postMessage(JSON.stringify({ menu: String(id) })); return Promise.resolve(true); },
    caminho: function (f) {
      var a = (window.top && window.top.__nexoArrastados) || [], n = f && f.name;
      for (var i = a.length - 1; i >= 0; i--) if (a[i].split(/[\\/]/).pop() === n) return a[i];
      return '';
    },
  };
})();"#;

fn main() {
    app_id_do_nexoeletric();
    let a = args();
    let cfg = nexo_hub::Config {
        root: a.workspace.clone(),
        port: a.porta,
        host: [127, 0, 0, 1],
        python: a.python.clone(),
        overlay: a.web.clone(),
        nexobd: a.nexobd,
        remendos: a.remendos,
    };
    let porta = match nexo_hub::serve_em_thread(cfg) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[NexoEletric] o servidor nao subiu: {e}");
            std::process::exit(1);
        }
    };
    let base = format!("http://127.0.0.1:{porta}/");
    eprintln!("[NexoEletric] hub em {base} (pasta {})", a.workspace.display());
    if a.so_servidor {
        loop {
            std::thread::park();
        }
    }
    let sessao = a.sessao && grava_sessao(&a.workspace, porta);
    let url = match &a.projeto {
        Some(p) => format!("{base}#{}/{}", slug(p), a.aba),
        None => base.clone(),
    };

    let ev_loop = EventLoopBuilder::<Ev>::with_user_event().build();
    let proxy = ev_loop.create_proxy();
    let mut wb = WindowBuilder::new().with_title("NexoEletric").with_maximized(true);
    #[cfg(windows)]
    {
        use tao::platform::windows::{IconExtWindows, WindowBuilderExtWindows};
        use tao::window::Icon;
        // o icone do NexoEletric embutido no .exe (recursos/nexoeletric.rc, ordinal 1)
        if let Ok(i) = Icon::from_resource(1, None) {
            wb = wb.with_window_icon(Some(i));
        }
        if let Ok(i) = Icon::from_resource(1, None) {
            wb = wb.with_taskbar_icon(Some(i));
        }
    }
    let janela = wb.build(&ev_loop).expect("janela");
    janela.set_maximized(true);
    let motor = com_motor();
    if motor {
        // o motor de fundo fala pela entrada padrao: "focar" e "toast {texto, tipo}"
        let px = proxy.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            for linha in std::io::stdin().lock().lines() {
                let Ok(l) = linha else { break };
                let l = l.trim();
                let ev = if l == "focar" {
                    Ev::Focar
                } else if let Some(j) = l.strip_prefix("toast ") {
                    Ev::Toast(j.to_string())
                } else {
                    continue;
                };
                if px.send_event(ev).is_err() {
                    break;
                }
            }
        });
    }
    // a pasta do WebView2 (cache, IndexedDB dos modelos 3D); --dados da outra (teste ao lado do app aberto)
    let dados = a.dados.clone().or_else(|| std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("NexoEletric-rust").join("WebView2")));
    let mut ctx = WebContext::new(dados);
    let mut extra = String::from("--lang=pt-BR");
    if let Some(p) = a.cdp {
        extra.push_str(&format!(" --remote-debugging-port={p}"));
    }
    if a.livre {
        extra.push_str(" --disable-gpu-vsync --disable-frame-rate-limit");
    }
    let (p1, p2, p3) = (proxy.clone(), proxy.clone(), proxy.clone());
    let webview = WebViewBuilder::new_with_web_context(&mut ctx)
        .with_url(&url)
        .with_devtools(true)
        .with_additional_browser_args(extra)
        .with_initialization_script(PONTE)
        .with_ipc_handler(move |req| {
            if let Ok(j) = serde_json::from_str::<serde_json::Value>(req.body()) {
                if let Some(m) = j.get("menu").and_then(|m| m.as_str()) {
                    let _ = p1.send_event(Ev::Menu(m.to_string()));
                }
            }
        })
        .with_new_window_req_handler(move |u, _| match destino_link(&u, porta) {
            DestinoLink::Hub => NewWindowResponse::Allow,
            DestinoLink::Fora => {
                abre_fora(&u);
                NewWindowResponse::Deny
            }
            DestinoLink::Nada => NewWindowResponse::Deny,
        })
        .with_document_title_changed_handler(move |t| {
            let _ = p2.send_event(Ev::Titulo(t));
        })
        .with_drag_drop_handler(move |e| {
            if let DragDropEvent::Drop { paths, .. } = e {
                let _ = p3.send_event(Ev::Arrastou(paths));
            }
            false
        })
        .build(&janela)
        .expect("webview");

    let mut zoom = 1.0f64;
    let ws = a.workspace.clone();
    ev_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                if sessao {
                    apaga_sessao();
                }
                *flow = ControlFlow::Exit;
            }
            Event::UserEvent(Ev::Titulo(t)) => janela.set_title(if t.is_empty() { "NexoEletric" } else { &t }),
            Event::UserEvent(Ev::Focar) => {
                if janela.is_minimized() {
                    janela.set_minimized(false);
                }
                janela.set_visible(true);
                janela.set_focus();
            }
            Event::UserEvent(Ev::Toast(j)) => {
                // j = {"texto": ..., "tipo": "ok"|"warn"|"err"|"info"} (JSON do motor)
                let _ = webview.evaluate_script(&format!(
                    "(function(t){{ if (window.HubDialog && HubDialog.toast) HubDialog.toast(t.texto, t.tipo || 'info', t.ms || 8000); \
                     else if (window.toast) toast(t.texto); else console.warn(t.texto); }})({j});"
                ));
            }
            Event::UserEvent(Ev::Arrastou(p)) => {
                let lista: Vec<String> = p.iter().map(|x| x.to_string_lossy().into_owned()).collect();
                let _ = webview.evaluate_script(&format!("window.__nexoArrastados = {};", serde_json::to_string(&lista).unwrap()));
            }
            Event::UserEvent(Ev::Menu(m)) => match m.as_str() {
                "recarregar" | "recarregarSemCache" => {
                    let _ = webview.reload();
                }
                "zoomMais" | "zoomMenos" | "zoom0" => {
                    zoom = match m.as_str() {
                        "zoomMais" => (zoom * 1.1).min(3.0),
                        "zoomMenos" => (zoom / 1.1).max(0.3),
                        _ => 1.0,
                    };
                    let _ = webview.zoom(zoom);
                }
                "painelProjetos" => {
                    let _ = webview.evaluate_script("window.EletricShell && EletricShell.alternarProjetos()");
                }
                "telaCheia" => janela.set_fullscreen(if janela.fullscreen().is_some() { None } else { Some(Fullscreen::Borderless(None)) }),
                "devtools" => webview.open_devtools(),
                "abrirPasta" => {
                    let _ = std::process::Command::new("explorer").arg(&ws).spawn();
                }
                "sair" => {
                    if sessao {
                        apaga_sessao();
                    }
                    *flow = ControlFlow::Exit;
                }
                outro if motor => {
                    // o motor de fundo (Electron) tem a tela: configuracoes, Conectar IA, Nexo Hub, Sobre...
                    use std::io::Write;
                    let mut o = std::io::stdout().lock();
                    let _ = writeln!(o, "menu:{outro}");
                    let _ = o.flush();
                }
                outro => {
                    let msg = format!("“{outro}” ainda não foi portado para a versão Rust do NexoEletric");
                    let _ = webview.evaluate_script(&format!(
                        "(window.HubDialog && HubDialog.toast) ? HubDialog.toast({0}, 'warn') : console.warn({0});",
                        serde_json::to_string(&msg).unwrap()
                    ));
                }
            },
            _ => {}
        }
    });
}

#[cfg(test)]
mod testes {
    use super::{destino_link, DestinoLink};

    #[test]
    fn links_novos_como_o_electron() {
        // o "Odoo ↗" de um componente (hub-odoolink.js) vai para o navegador do Windows
        assert_eq!(destino_link("http://192.168.15.192:8070/odoo/action-282/2116", 8200), DestinoLink::Fora);
        assert_eq!(destino_link("https://cart.jlcpcb.com/quote", 8200), DestinoLink::Fora);
        assert_eq!(destino_link("mailto:compras@dieletrons.com", 8200), DestinoLink::Fora);
        // o proprio hub: numa janela do app
        assert_eq!(destino_link("http://127.0.0.1:8200/pcbframe.html?p=DMB", 8200), DestinoLink::Hub);
        assert_eq!(destino_link("http://localhost:8200/", 8200), DestinoLink::Hub);
        assert_eq!(destino_link("http://127.0.0.1:8200", 8200), DestinoLink::Hub);
        // outra porta da maquina nao e o hub (e um servico qualquer): vai para fora
        assert_eq!(destino_link("http://127.0.0.1:82001/x", 8200), DestinoLink::Fora);
        // o resto nao abre: esquema estranho, espaco, aspas, quebra de linha
        assert_eq!(destino_link("file:///C:/Windows/system32/calc.exe", 8200), DestinoLink::Nada);
        assert_eq!(destino_link("javascript:alert(1)", 8200), DestinoLink::Nada);
        assert_eq!(destino_link("http://x.com/a b", 8200), DestinoLink::Nada);
        assert_eq!(destino_link("http://x.com/\"&calc", 8200), DestinoLink::Nada);
        assert_eq!(destino_link("http://x.com/\ncalc", 8200), DestinoLink::Nada);
        assert_eq!(destino_link("", 8200), DestinoLink::Nada);
    }
}
