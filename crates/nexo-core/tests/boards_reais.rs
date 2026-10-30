//! Carrega todas as placas reais do NexoEletric (quando a pasta existe nesta maquina) e confere
//! que o board.js le, o changes.js aplica e a cena monta.
use nexo_core::{project, scene};
use std::path::PathBuf;

#[test]
fn todas_as_placas_carregam() {
    let root = PathBuf::from(std::env::var("NEXO_PROJECTS").unwrap_or_else(|_| r"D:\Pessoal\NexoEletric\Projects".into()));
    let lista = project::scan(&[root]);
    if lista.is_empty() {
        eprintln!("sem projetos nesta maquina; pulando");
        return;
    }
    for e in lista {
        let p = project::load(&e.dir).unwrap_or_else(|err| panic!("{}: {err}", e.name));
        let (ok, w, er) = p.applied.counts();
        let sc = scene::build(&p.applied.board, &scene::BuildOpts { flipped: false, ghosts: Some(p.applied.ghosts.clone()), ..Default::default() });
        let idx = nexo_core::pick::PickIndex::build(&p.applied.board);
        let _ = idx;
        eprintln!(
            "{:<55} comps={:>4} trilhas={:>5} ops ok/aviso/erro={}/{}/{} tri={:>7} caps={:>7} parse={:.1}ms cena={:.1}ms",
            e.name, p.board.components.len(), p.board.tracks.len(), ok, w, er, sc.stats.triangles, sc.stats.capsules,
            p.timings.parse_ms, sc.stats.build_ms
        );
        for s in p.applied.status.iter().filter(|s| s.level != nexo_core::changes::Level::Ok) {
            eprintln!("    #{} {} {:?}: {}", s.idx + 1, s.op, s.level, s.msg);
        }
        assert!(sc.stats.capsules > 0);
    }
}

#[test]
fn placa_tem_fundo() {
    // o recorte que repete o contorno (k4 do PRJ-UR) nao pode vazar a placa inteira
    let dir = PathBuf::from(r"D:\Pessoal\NexoEletric\Projects\PRJ-UR-DI261924");
    if !dir.exists() {
        return;
    }
    let p = project::load(&dir).unwrap();
    let sc = scene::build(&p.applied.board, &scene::BuildOpts { flipped: false, ghosts: None, ..Default::default() });
    let b = sc.board.as_ref().unwrap();
    let mut area = 0.0f64;
    for t in sc.indices[b.tris.start as usize..b.tris.end as usize].chunks(3) {
        let (a, bb, c) = (sc.verts[t[0] as usize].pos, sc.verts[t[1] as usize].pos, sc.verts[t[2] as usize].pos);
        area += 0.5 * (((bb[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (bb[1] - a[1])) as f64).abs();
    }
    let e = &sc.extents;
    let caixa = (e.x2 - e.x1) * (e.y2 - e.y1);
    assert!(area > 0.95 * caixa && area < caixa, "area da placa {area:.1} x caixa {caixa:.1}");
}
