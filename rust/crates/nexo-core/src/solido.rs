//! A placa como solido 3D (a "Board" do 3D Layout Mode): o contorno com os recortes e TODOS os
//! furos vazados, na espessura da placa. A vista 3D do hub fazia isso no three.js (ExtrudeGeometry +
//! duas ShapeGeometry: o earcut da mesma forma com ~2.400 furos rodava tres vezes); aqui a
//! triangulacao sai uma vez so (lyon) e serve as tampas e as duas faces pintadas.

use lyon_tessellation::math::point;
use lyon_tessellation::path::Path;
use lyon_tessellation::{BuffersBuilder, FillOptions, FillRule, FillTessellator, FillVertex, VertexBuffers};

#[derive(Default, Debug)]
pub struct Placa3d {
    /// a tampa (xy), triangulos anti-horarios vistos de +Z
    pub tampa_xy: Vec<[f32; 2]>,
    pub tampa_idx: Vec<u32>,
    /// as paredes (contorno, recortes e furos), de z = 0 a z = esp, normal para fora do material
    pub lado_pos: Vec<[f32; 3]>,
    pub lado_nor: Vec<[f32; 3]>,
    pub lado_idx: Vec<u32>,
}

fn area(p: &[[f64; 2]]) -> f64 {
    let n = p.len();
    (0..n).map(|i| p[i][0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * p[i][1]).sum::<f64>() / 2.0
}

/// o anel sem o ultimo ponto repetido e sem pontos colados
fn limpa(p: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut out: Vec<[f64; 2]> = Vec::with_capacity(p.len());
    for q in p {
        if !q[0].is_finite() || !q[1].is_finite() {
            continue;
        }
        if out.last().map(|l| (l[0] - q[0]).abs() < 1e-7 && (l[1] - q[1]).abs() < 1e-7).unwrap_or(false) {
            continue;
        }
        out.push(*q);
    }
    while out.len() > 2 {
        let (a, z) = (out[0], *out.last().unwrap());
        if (a[0] - z[0]).abs() < 1e-7 && (a[1] - z[1]).abs() < 1e-7 {
            out.pop();
        } else {
            break;
        }
    }
    out
}

/// circulo do furo como o absarc do three.js com curveSegments = `seg`
fn circulo(x: f64, y: f64, r: f64, seg: usize) -> Vec<[f64; 2]> {
    (0..seg)
        .map(|i| {
            let a = std::f64::consts::TAU * i as f64 / seg as f64;
            [x + r * a.cos(), y + r * a.sin()]
        })
        .collect()
}

/// `lacos`: os lacos do contorno (o maior e a placa; os outros, vazados); `recortes`: os recortes da
/// placa; `furos`: (x, y, raio); `esp`: espessura (mm); `seg`: segmentos por furo.
pub fn placa(lacos: &[Vec<[f64; 2]>], recortes: &[Vec<[f64; 2]>], furos: &[[f64; 3]], esp: f64, seg: usize) -> Option<Placa3d> {
    let mut aneis: Vec<Vec<[f64; 2]>> = lacos.iter().map(|l| limpa(l)).filter(|l| l.len() >= 3).collect();
    if aneis.is_empty() {
        return None;
    }
    aneis.sort_by(|a, b| area(b).abs().partial_cmp(&area(a).abs()).unwrap_or(std::cmp::Ordering::Equal));
    for k in recortes {
        let k = limpa(k);
        if k.len() >= 3 {
            aneis.push(k);
        }
    }
    let seg = seg.clamp(6, 64);
    for f in furos {
        if f[2] > 0.05 && f[0].is_finite() && f[1].is_finite() {
            aneis.push(circulo(f[0], f[1], f[2], seg));
        }
    }
    // o de fora anti-horario, os vazados horarios: a normal (dy, -dx) da parede aponta para fora do
    // material nos dois casos
    for (i, a) in aneis.iter_mut().enumerate() {
        let ccw = area(a) > 0.0;
        if (i == 0) != ccw {
            a.reverse();
        }
    }

    // ---- a tampa: uma triangulacao, par-impar ----
    let mut b = Path::builder();
    for a in &aneis {
        b.begin(point(a[0][0] as f32, a[0][1] as f32));
        for p in &a[1..] {
            b.line_to(point(p[0] as f32, p[1] as f32));
        }
        b.end(true);
    }
    let path = b.build();
    let mut g: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
    FillTessellator::new()
        .tessellate_path(
            &path,
            &FillOptions::tolerance(0.001).with_fill_rule(FillRule::EvenOdd),
            &mut BuffersBuilder::new(&mut g, |v: FillVertex| v.position().to_array()),
        )
        .ok()?;
    let mut out = Placa3d { tampa_xy: g.vertices, tampa_idx: g.indices, ..Default::default() };
    // triangulos anti-horarios vistos de cima (a face de cima e FrontSide)
    for t in out.tampa_idx.chunks_mut(3) {
        let (p, q, r) = (out.tampa_xy[t[0] as usize], out.tampa_xy[t[1] as usize], out.tampa_xy[t[2] as usize]);
        if (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]) < 0.0 {
            t.swap(1, 2);
        }
    }

    // ---- as paredes: quina viva acima de 30 graus, curva lisa abaixo (o furo redondo) ----
    let liso = (30f64).to_radians().cos();
    let z1 = esp as f32;
    for a in &aneis {
        let n = a.len();
        let nor: Vec<[f64; 2]> = (0..n)
            .map(|i| {
                let (p, q) = (a[i], a[(i + 1) % n]);
                let (dx, dy) = (q[0] - p[0], q[1] - p[1]);
                let l = (dx * dx + dy * dy).sqrt().max(1e-12);
                [dy / l, -dx / l]
            })
            .collect();
        // a normal de cada ponta do segmento i: a media com o vizinho se a curva e lisa
        let ponta = |i: usize, vizinho: usize| -> [f32; 3] {
            let (u, v) = (nor[i], nor[vizinho]);
            if u[0] * v[0] + u[1] * v[1] >= liso {
                let (x, y) = (u[0] + v[0], u[1] + v[1]);
                let l = (x * x + y * y).sqrt().max(1e-12);
                [(x / l) as f32, (y / l) as f32, 0.0]
            } else {
                [u[0] as f32, u[1] as f32, 0.0]
            }
        };
        for i in 0..n {
            let (p, q) = (a[i], a[(i + 1) % n]);
            let na = ponta(i, (i + n - 1) % n);
            let nb = ponta(i, (i + 1) % n);
            let base = out.lado_pos.len() as u32;
            out.lado_pos.extend_from_slice(&[
                [p[0] as f32, p[1] as f32, 0.0],
                [q[0] as f32, q[1] as f32, 0.0],
                [q[0] as f32, q[1] as f32, z1],
                [p[0] as f32, p[1] as f32, z1],
            ]);
            out.lado_nor.extend_from_slice(&[na, nb, nb, na]);
            // anti-horario visto de fora (do lado da normal)
            out.lado_idx.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn quadrado_com_furo() {
        let q = vec![vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]]];
        let p = super::placa(&q, &[], &[[5.0, 5.0, 1.0]], 1.6, 18).unwrap();
        // area da tampa = 100 - pi (o poligono de 18 lados)
        let mut a = 0.0f64;
        for t in p.tampa_idx.chunks(3) {
            let (x, y, z) = (p.tampa_xy[t[0] as usize], p.tampa_xy[t[1] as usize], p.tampa_xy[t[2] as usize]);
            let s = ((y[0] - x[0]) * (z[1] - x[1]) - (z[0] - x[0]) * (y[1] - x[1])) as f64 / 2.0;
            assert!(s > 0.0, "triangulo horario");
            a += s;
        }
        let furo = 18.0 / 2.0 * (std::f64::consts::TAU / 18.0).sin();
        assert!((a - (100.0 - furo)).abs() < 1e-3, "area {a}");
        // 4 paredes de fora + 18 do furo
        assert_eq!(p.lado_idx.len(), (4 + 18) * 6);
        // a parede do furo aponta para o centro do furo (para fora do material)
        let i = 4 * 4;
        let (pp, nn) = (p.lado_pos[i], p.lado_nor[i]);
        assert!((pp[0] - 5.0) * nn[0] + (pp[1] - 5.0) * nn[1] < 0.0);
    }
}
