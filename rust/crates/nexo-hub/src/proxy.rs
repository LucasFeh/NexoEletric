//! O hubserver.py como reserva: as rotas que nao foram portadas (Gerber, PDF, BOM, Odoo, laser,
//! importar do Altium, almoxarifado...) vao a ele. Ele sobe so no primeiro pedido dessas rotas,
//! importado como modulo (sem o vigia que varria a pasta a cada segundo e sem o portao do Nexo Hub,
//! que agora sao daqui), numa porta livre, dentro de um Job Object do Windows: morre junto com o
//! app e nunca fica orfao segurando porta ou pasta.

use crate::Est;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::TryStreamExt;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::sync::OnceCell;

pub struct Python {
    exe: Option<PathBuf>,
    root: PathBuf,
    porta: OnceCell<Option<u16>>,
    cli: reqwest::Client,
}

impl Python {
    pub fn new(exe: Option<PathBuf>, root: PathBuf) -> Python {
        Python {
            exe,
            root,
            porta: OnceCell::new(),
            cli: reqwest::Client::builder().pool_idle_timeout(Duration::from_secs(30)).build().unwrap(),
        }
    }

    async fn porta(&self) -> Option<u16> {
        *self.porta.get_or_init(|| async { self.sobe().await }).await
    }

    /// Um POST JSON a uma rota do hubserver.py (sobe o Python se preciso). Para o que o Rust avisa depois de fazer
    /// (o historico do /api/save: equipe.rs). false = sem o Python ou ele recusou.
    pub async fn posta(&self, caminho: &str, corpo: &serde_json::Value) -> bool {
        let Some(porta) = self.porta().await else { return false };
        match self.cli.post(format!("http://127.0.0.1:{porta}{caminho}")).json(corpo).timeout(Duration::from_secs(60)).send().await {
            Ok(r) => r.status().is_success(),
            Err(e) => {
                eprintln!("[nexo-hub] -> python {caminho}: {e}");
                false
            }
        }
    }

    async fn sobe(&self) -> Option<u16> {
        let exe = self.exe.clone()?;
        if !exe.is_file() || !self.root.join("hubserver.py").is_file() {
            eprintln!("[nexo-hub] sem Python ou sem hubserver.py: rotas de reserva desligadas");
            return None;
        }
        // porta livre (o SO escolhe), so em 127.0.0.1
        let porta = std::net::TcpListener::bind("127.0.0.1:0").ok()?.local_addr().ok()?.port();
        let t0 = Instant::now();
        let codigo = format!(
            "import os, sys\nsys.argv = ['hubserver.py']\nos.chdir(r'''{root}''')\nsys.path.insert(0, r'''{root}''')\n\
             import hubserver\nhubserver.configura_escuta('127.0.0.1')\n\
             hubserver.app.run(host='127.0.0.1', port={porta}, threaded=True, debug=False)\n",
            root = self.root.display(),
            porta = porta
        );
        let mut cmd = tokio::process::Command::new(&exe);
        cmd.args(["-E", "-s", "-X", "utf8", "-u", "-c", &codigo])
            .current_dir(&self.root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        for (k, _) in std::env::vars() {
            if k.starts_with("PYTHON") {
                cmd.env_remove(k);
            }
        }
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let filho = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[nexo-hub] Python nao subiu: {e}");
                return None;
            }
        };
        #[cfg(windows)]
        if let Some(pid) = filho.id() {
            job::prende(pid);
        }
        // o processo fica preso a esta estrutura ate o app sair
        std::mem::forget(filho);
        for _ in 0..300 {
            if self.cli.get(format!("http://127.0.0.1:{porta}/api/nexohub/estado")).timeout(Duration::from_secs(1)).send().await.is_ok() {
                eprintln!("[nexo-hub] Python de reserva no ar em {:.2} s (porta {porta})", t0.elapsed().as_secs_f64());
                return Some(porta);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        eprintln!("[nexo-hub] o Python de reserva nao respondeu");
        None
    }
}

pub async fn repassa(est: &Est, _addr: SocketAddr, req: Request) -> Response {
    let Some(porta) = est.py.porta().await else {
        return (StatusCode::NOT_IMPLEMENTED, "rota do hubserver.py sem o Python de reserva").into_response();
    };
    let (parts, body) = req.into_parts();
    let pq = parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    eprintln!("[nexo-hub] -> python: {} {}", parts.method, pq);
    let url = format!("http://127.0.0.1:{porta}{pq}");
    let corpo = match axum::body::to_bytes(body, 200 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let mut r = est.py.cli.request(parts.method.clone(), &url).body(corpo);
    for (k, v) in parts.headers.iter() {
        if k != "host" && k != "connection" && k != "content-length" {
            r = r.header(k, v);
        }
    }
    match r.send().await {
        Ok(resp) => {
            let mut b = Response::builder().status(resp.status());
            for (k, v) in resp.headers().iter() {
                if k != "connection" && k != "transfer-encoding" && k != "content-length" {
                    b = b.header(k, v);
                }
            }
            let stream = resp.bytes_stream().map_err(std::io::Error::other);
            b.body(Body::from_stream(stream)).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(e) => {
            let mut resp = (StatusCode::BAD_GATEWAY, format!("hubserver.py: {e}")).into_response();
            resp.headers_mut().insert("x-nexo", HeaderValue::from_static("reserva"));
            resp
        }
    }
}

#[cfg(windows)]
mod job {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::*;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    struct H(HANDLE);
    unsafe impl Send for H {}
    unsafe impl Sync for H {}

    fn job() -> Option<HANDLE> {
        static J: OnceLock<Option<H>> = OnceLock::new();
        J.get_or_init(|| unsafe {
            let j = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if j.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                j,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            Some(H(j))
        })
        .as_ref()
        .map(|h| h.0)
    }

    /// o processo filho morre quando o app fechar (o handle do Job fecha com ele)
    pub fn prende(pid: u32) {
        unsafe {
            let Some(j) = job() else { return };
            let p = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if !p.is_null() {
                AssignProcessToJobObject(j, p);
                CloseHandle(p);
            }
        }
    }
}
