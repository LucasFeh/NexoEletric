//! A equipe do projeto no /api/save do Rust (1.84.0; a regra e a do tools/rotas/equipe.py).
//!
//! Quem esta gravando e quem esta logado no Nexo Hub desta maquina (GET <hub>/api/v1/sessao, cache de 2 s; o servidor
//! pergunta, nunca a pagina). Pode gravar no projeto: o admin, o responsavel, um colaborador convidado, ou qualquer um
//! num projeto sem responsavel (Projects/<p>/equipe.json). Hub antigo (404, sem login) ou fora do ar: liberado (quem
//! barra sem Hub e o portao, gate.rs). O resto -- convidar, o historico, o diff do que mudou -- e do Python: depois de
//! gravar, o Rust manda o conteudo anterior para POST /api/historico/registra, e o diff fica num lugar so.

use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CACHE: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, PartialEq)]
pub enum Modo {
    /// alguem logado: (id, nome, admin)
    Login { id: String, nome: String, admin: bool },
    Deslogado,
    /// Hub antigo, sem login (/api/v1/sessao responde 404)
    Legado,
    /// o Hub nao respondeu
    Fora,
}

#[derive(Default)]
pub struct Sessao {
    cache: Mutex<Option<(Instant, Modo)>>,
    /// so para os testes: o endereco do Hub de mentira (senao o do conexao.json, como o portao)
    pub url: Mutex<Option<String>>,
}

impl Sessao {
    #[cfg(test)]
    pub fn esquece(&self) {
        *self.cache.lock().unwrap() = None;
    }

    pub async fn modo(&self, cli: &reqwest::Client) -> Modo {
        if let Some((t, m)) = self.cache.lock().unwrap().clone() {
            if t.elapsed() < CACHE {
                return m;
            }
        }
        let url = self.url.lock().unwrap().clone().unwrap_or_else(|| crate::gate::conexao().0);
        let m = match cli.get(format!("{url}/api/v1/sessao")).header("X-App", "nexoeletric").timeout(Duration::from_secs(3)).send().await {
            Ok(r) if r.status().as_u16() == 404 => Modo::Legado,
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(j) => de_sessao(&j),
                Err(_) => Modo::Fora,
            },
            _ => Modo::Fora,
        };
        *self.cache.lock().unwrap() = Some((Instant::now(), m.clone()));
        m
    }
}

/// a resposta do GET /api/v1/sessao -> o modo
pub fn de_sessao(j: &Value) -> Modo {
    let u = &j["usuario"];
    match (j["logado"].as_bool(), u["id"].as_str()) {
        (Some(true), Some(id)) if !id.is_empty() => Modo::Login {
            id: id.to_string(),
            nome: u["nome"].as_str().or(u["login"].as_str()).unwrap_or("").to_string(),
            admin: u["admin"].as_bool().unwrap_or(false),
        },
        _ => Modo::Deslogado,
    }
}

pub fn le_equipe(pdir: &Path) -> Value {
    std::fs::read_to_string(pdir.join("equipe.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

/// Ok = pode gravar; Err = o corpo da resposta 403
pub fn pode(equipe: &Value, modo: &Modo) -> Result<(), Value> {
    let resp = equipe.get("responsavel").filter(|r| r.get("id").and_then(|i| i.as_str()).is_some_and(|i| !i.is_empty()));
    let Some(resp) = resp else { return Ok(()) };
    let id_resp = resp["id"].as_str().unwrap_or("");
    match modo {
        Modo::Legado | Modo::Fora => return Ok(()),
        Modo::Login { id, admin, .. } => {
            if *admin || id == id_resp {
                return Ok(());
            }
            let colab = equipe["colaboradores"].as_array().map(|l| l.iter().any(|c| c["id"].as_str() == Some(id.as_str()))).unwrap_or(false);
            if colab {
                return Ok(());
            }
        }
        Modo::Deslogado => {}
    }
    let nome = resp["nome"].as_str().filter(|n| !n.is_empty()).unwrap_or("—");
    Err(json!({
        "ok": false, "codigo": "sem_permissao", "responsavel": resp,
        "error": format!("Só o responsável ({nome}) e os colaboradores convidados mexem neste projeto"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eq() -> Value {
        json!({"formato": "nexoeletric-equipe-1", "responsavel": {"id": "u-dono", "login": "dono", "nome": "Davi Dono"},
               "colaboradores": [{"id": "u-colab", "login": "colab", "nome": "Carla"}]})
    }
    fn login(id: &str, admin: bool) -> Modo {
        Modo::Login { id: id.into(), nome: id.into(), admin }
    }

    #[test]
    fn quem_grava() {
        let e = eq();
        assert!(pode(&e, &login("u-admin", true)).is_ok(), "o admin mexe em tudo");
        assert!(pode(&e, &login("u-dono", false)).is_ok(), "o responsavel");
        assert!(pode(&e, &login("u-colab", false)).is_ok(), "o colaborador");
        let r = pode(&e, &login("u-fora", false)).unwrap_err();
        assert_eq!(r["codigo"], "sem_permissao");
        assert_eq!(r["error"], "Só o responsável (Davi Dono) e os colaboradores convidados mexem neste projeto");
        assert!(pode(&e, &Modo::Deslogado).is_err(), "ninguem logado num projeto com dono");
        assert!(pode(&e, &Modo::Legado).is_ok() && pode(&e, &Modo::Fora).is_ok(), "Hub antigo ou fora: liberado");
        // sem responsavel (projeto antigo, ou sem equipe.json): qualquer um
        assert!(pode(&Value::Null, &login("u-fora", false)).is_ok());
        assert!(pode(&json!({"responsavel": null, "colaboradores": []}), &Modo::Deslogado).is_ok());
    }

    #[test]
    fn le_a_sessao_do_hub() {
        let m = de_sessao(&json!({"ok": true, "logado": true, "usuario": {"id": "u1", "login": "ana", "nome": "Ana", "admin": true}}));
        assert_eq!(m, Modo::Login { id: "u1".into(), nome: "Ana".into(), admin: true });
        assert_eq!(de_sessao(&json!({"ok": true, "logado": false, "usuario": null})), Modo::Deslogado);
    }
}
