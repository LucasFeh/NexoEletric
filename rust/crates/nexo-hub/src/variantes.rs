//! A variante de projeto ativa (1.88.0; o mesmo do tools/rotas/variantes.py » recusa_salvar): com uma variante ativa
//! nesta maquina (Projects/<p>/.variante-ativa.json, que aponta para uma variante do variantes.json), a PCB e a mesma --
//! o /api/save nao muda o schematic.js, o changes.js, o annotations.js nem o rules.js (409 variante_ativa). Gravar o
//! mesmo texto que esta no disco passa (nao muda nada).
use serde_json::{json, Value};
use std::path::Path;

const TRAVADOS: [&str; 4] = ["schematic.js", "changes.js", "annotations.js", "rules.js"];

fn le_json(p: &Path) -> Option<Value> {
    let t = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()
}

/// a variante ativa nesta maquina ({id, nome, codigo}) ou None (a padrao)
pub fn ativa(pdir: &Path) -> Option<Value> {
    let id = le_json(&pdir.join(".variante-ativa.json"))?.get("id")?.as_str()?.to_string();
    if id.is_empty() {
        return None;
    }
    let lista = le_json(&pdir.join("variantes.json"))?;
    lista.get("variantes")?.as_array()?.iter().find(|v| v.get("id").and_then(|x| x.as_str()) == Some(id.as_str())).cloned()
}

/// None = pode gravar; senao o corpo da resposta 409
pub fn recusa_salvar(pdir: &Path, arquivo: &str, novo: &str) -> Option<Value> {
    if !TRAVADOS.contains(&arquivo) {
        return None;
    }
    let v = ativa(pdir)?;
    let atual = std::fs::read_to_string(pdir.join(arquivo)).ok().map(|t| t.replace("\r\n", "\n"));
    if atual.as_deref() == Some(novo.replace("\r\n", "\n").as_str()) {
        return None;
    }
    let nome = v.get("nome").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let codigo = v.get("codigo").and_then(|x| x.as_str()).unwrap_or("").to_string();
    Some(json!({
        "ok": false, "codigo": "variante_ativa",
        "variante": {"id": v.get("id").cloned().unwrap_or(Value::Null), "nome": nome, "codigo": codigo},
        "error": format!("A variante \"{nome}\" ({codigo}) está ativa: a PCB é a mesma, nela só se suprime ou monta componente. \
Volte para \"Padrão\" (Configurações › Variante de projeto) para editar o esquema ou a PCB."),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variante_ativa_trava_o_esquema_e_a_pcb() {
        let pdir = std::env::temp_dir().join(format!("nexo-hub-variante-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&pdir).unwrap();
        std::fs::write(pdir.join("changes.js"), "var changes = [\n];\n").unwrap();
        // sem variante ativa: grava
        assert!(recusa_salvar(&pdir, "changes.js", "var changes = [\n{\"op\":\"x\"},\n];\n").is_none());
        std::fs::write(pdir.join("variantes.json"), json!({"formato": "nexoeletric-variantes-1",
            "variantes": [{"id": "v0a1b2c", "nome": "Sem display", "codigo": "PXSD-DI261950", "suprimidos": [{"ref": "U3"}]}]}).to_string()).unwrap();
        std::fs::write(pdir.join(".variante-ativa.json"), json!({"id": "v0a1b2c"}).to_string()).unwrap();
        let r = recusa_salvar(&pdir, "changes.js", "var changes = [\n{\"op\":\"x\"},\n];\n").expect("recusa");
        assert_eq!(r["codigo"], "variante_ativa");
        assert!(r["error"].as_str().unwrap().contains("Sem display"));
        // o mesmo texto do disco passa; outro arquivo (fora dos travados) tambem
        assert!(recusa_salvar(&pdir, "changes.js", "var changes = [\r\n];\r\n").is_none());
        assert!(recusa_salvar(&pdir, "bom-opts.json", "{}").is_none());
        for a in ["schematic.js", "annotations.js", "rules.js"] {
            assert!(recusa_salvar(&pdir, a, "x").is_some(), "{a}");
        }
        // a ativa que nao existe mais (apagada noutra maquina): volta a padrao
        std::fs::write(pdir.join(".variante-ativa.json"), json!({"id": "vffffff"}).to_string()).unwrap();
        assert!(recusa_salvar(&pdir, "changes.js", "x").is_none());
        let _ = std::fs::remove_dir_all(&pdir);
    }
}
