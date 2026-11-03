//! Os arquivos do projeto sao JavaScript (`var pcbmirror = {...};`, `var changes = [...];`):
//! JSON com comentarios `//`, virgula sobrando e `null` onde o exportador nao achou valor.
//! Aqui eles viram JSON puro sem executar nada.

use serde::de::DeserializeOwned;
use serde_json::Value;

/// Tira comentarios fora de strings e a virgula que sobra antes de `]`/`}`.
pub fn clean_js(src: &str) -> String {
    let b = src.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let mut in_str: u8 = 0;
    while i < b.len() {
        let c = b[i];
        if in_str != 0 {
            out.push(c);
            if c == b'\\' && i + 1 < b.len() {
                out.push(b[i + 1]);
                i += 2;
                continue;
            }
            if c == in_str {
                in_str = 0;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' | b'\'' => {
                in_str = c;
                out.push(b'"');
                i += 1;
                // string com aspas simples: troca o delimitador por aspas duplas
                if c == b'\'' {
                    while i < b.len() && b[i] != b'\'' {
                        if b[i] == b'"' {
                            out.extend_from_slice(b"\\\"");
                        } else if b[i] == b'\\' && i + 1 < b.len() {
                            out.push(b[i]);
                            out.push(b[i + 1]);
                            i += 1;
                        } else {
                            out.push(b[i]);
                        }
                        i += 1;
                    }
                    out.push(b'"');
                    in_str = 0;
                    i += 1;
                }
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'/' => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'*' => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    i += 1;
                }
                i += 2;
            }
            b']' | b'}' => {
                // virgula sobrando: volta por cima de espacos ate a ultima virgula
                let mut j = out.len();
                while j > 0 && out[j - 1].is_ascii_whitespace() {
                    j -= 1;
                }
                if j > 0 && out[j - 1] == b',' {
                    out.remove(j - 1);
                }
                out.push(c);
                i += 1;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).unwrap_or_default()
}

/// O valor depois do `=` da primeira declaracao (`var x = VALOR;`), ou o arquivo inteiro.
fn rhs(src: &str) -> &str {
    let t = src.trim_start_matches('\u{feff}');
    let start = t.find(|c| c == '{' || c == '[').unwrap_or(0);
    let body = &t[start..];
    let open = body.as_bytes().first().copied().unwrap_or(b'{');
    let close = if open == b'[' { ']' } else { '}' };
    match body.rfind(close) {
        Some(e) => &body[..=e],
        None => body,
    }
}

/// `null` dentro de objeto vira campo ausente (o default do struct vale).
pub fn strip_nulls(v: &mut Value) {
    match v {
        Value::Object(m) => {
            m.retain(|_, x| !x.is_null());
            for x in m.values_mut() {
                strip_nulls(x);
            }
        }
        Value::Array(a) => {
            for x in a.iter_mut() {
                strip_nulls(x);
            }
        }
        _ => {}
    }
}

/// Le uma declaracao JS como `T`. Caminho rapido: JSON puro direto no struct; se falhar,
/// limpa (comentarios, virgulas, nulls) e tenta de novo.
pub fn parse_js<T: DeserializeOwned>(src: &str) -> Result<T, String> {
    let body = rhs(src);
    if let Ok(v) = serde_json::from_str::<T>(body) {
        return Ok(v);
    }
    let clean = clean_js(src);
    let body = rhs(&clean);
    let mut v: Value = serde_json::from_str(body).map_err(|e| format!("JSON invalido: {e}"))?;
    strip_nulls(&mut v);
    serde_json::from_value(v).map_err(|e| format!("formato inesperado: {e}"))
}

/// O valor da declaracao como TEXTO JSON puro (limpo de comentarios e virgulas): para devolver a
/// placa inteira numa resposta sem interpretar e reescrever 1 MB de JSON.
pub fn js_body(src: &str) -> String {
    let body = rhs(src);
    if serde_json::from_str::<serde::de::IgnoredAny>(body).is_ok() {
        return body.to_string();
    }
    let clean = clean_js(src);
    rhs(&clean).to_string()
}

pub fn parse_js_value(src: &str) -> Result<Value, String> {
    let clean = clean_js(src);
    let body = rhs(&clean);
    serde_json::from_str(body).map_err(|e| format!("JSON invalido: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changes_com_comentario_e_virgula() {
        let s = "// cabecalho\nvar changes = [\n// nota\n{\"op\":\"track_add\",\"w\":0.3}, // fim\n];\n";
        let v = parse_js_value(s).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["op"], "track_add");
    }
    #[test]
    fn url_dentro_de_string_nao_e_comentario() {
        let v = parse_js_value("var x = {\"a\":\"http://x/y\"};").unwrap();
        assert_eq!(v["a"], "http://x/y");
    }
}
