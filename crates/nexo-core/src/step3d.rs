//! A malha de um modelo STEP pronta para a vista 3D: o `suaviza` do hub-pcb3d-vista.js (normais com
//! angulo de vinco de 35 graus -- o "Auto Smooth" do Blender -- e UV por projecao na caixa) mais os
//! triangulos REORDENADOS por cor. O three.js desenhava um grupo por face do STEP (um conector vira
//! centenas de chamadas de desenho por quadro); aqui sai um grupo por cor.

use std::collections::HashMap;

/// Uma face do STEP: triangulos `ini..=fim` e a cor dela (None = a cor da malha).
#[derive(Clone, Copy, Debug)]
pub struct Face {
    pub ini: u32,
    pub fim: u32,
    pub cor: Option<[f32; 3]>,
}

#[derive(Default, Debug)]
pub struct Malha {
    /// triangulos soltos (3 vertices cada), na ordem dos grupos
    pub pos: Vec<f32>,
    pub nor: Vec<f32>,
    pub uv: Vec<f32>,
    /// (primeiro vertice, quantos vertices, material): material 0 = a cor da malha, k = cores[k-1]
    pub grupos: Vec<[u32; 3]>,
    pub cores: Vec<[f32; 3]>,
    /// a esfera envolvente como o three.js calcula (centro da caixa, raio = o vertice mais longe)
    pub esfera: [f32; 4],
}

const VINCO_GRAUS: f32 = 35.0;

pub fn prepara(p: &[f32], idx: &[u32], faces: &[Face]) -> Malha {
    let nt = idx.len() / 3;
    let nv = p.len() / 3;
    if nt == 0 || idx.iter().any(|&i| i as usize >= nv) {
        return Malha::default();
    }
    let vinco = VINCO_GRAUS.to_radians().cos();
    // normal de cada triangulo
    let mut fnor = vec![[0f32; 3]; nt];
    for t in 0..nt {
        let (a, b, c) = (idx[t * 3] as usize * 3, idx[t * 3 + 1] as usize * 3, idx[t * 3 + 2] as usize * 3);
        let (ux, uy, uz) = (p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
        let (vx, vy, vz) = (p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]);
        let (nx, ny, nz) = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        let l = (nx * nx + ny * ny + nz * nz).sqrt();
        let l = if l > 0.0 { l } else { 1.0 };
        fnor[t] = [nx / l, ny / l, nz / l];
    }
    // os triangulos de cada ponto (pela posicao arredondada a 0,5 um, como o hub)
    let chave = |v: usize| -> (i32, i32, i32) {
        let r = |x: f32| (x as f64 * 2e3).round() as i32;
        (r(p[v * 3]), r(p[v * 3 + 1]), r(p[v * 3 + 2]))
    };
    let mut ponto_de: Vec<u32> = vec![0; nv];
    let mut ids: HashMap<(i32, i32, i32), u32> = HashMap::with_capacity(nv);
    for (v, slot) in ponto_de.iter_mut().enumerate() {
        let n = ids.len() as u32;
        *slot = *ids.entry(chave(v)).or_insert(n);
    }
    let np = ids.len();
    let mut ini = vec![0u32; np + 1];
    for &v in idx {
        ini[ponto_de[v as usize] as usize + 1] += 1;
    }
    for i in 0..np {
        ini[i + 1] += ini[i];
    }
    let mut cheio = ini.clone();
    let mut tri_do_ponto = vec![0u32; idx.len()];
    for (k, &v) in idx.iter().enumerate() {
        let q = ponto_de[v as usize] as usize;
        tri_do_ponto[cheio[q] as usize] = (k / 3) as u32;
        cheio[q] += 1;
    }
    // o material de cada triangulo: 0 = a cor da malha; as cores na ordem em que aparecem
    let mut mat = vec![0u32; nt];
    let mut cores: Vec<[f32; 3]> = Vec::new();
    let mut por_cor: HashMap<[i32; 3], u32> = HashMap::new();
    for f in faces {
        let Some(c) = f.cor else { continue };
        let k = [(c[0] * 255.0).round() as i32, (c[1] * 255.0).round() as i32, (c[2] * 255.0).round() as i32];
        let m = *por_cor.entry(k).or_insert_with(|| {
            cores.push(c);
            cores.len() as u32
        });
        let (a, b) = (f.ini as usize, (f.fim as usize).min(nt.saturating_sub(1)));
        if a <= b {
            for x in &mut mat[a..=b] {
                *x = m;
            }
        }
    }
    // a ordem de saida: por material (estavel)
    let mut ordem: Vec<u32> = (0..nt as u32).collect();
    ordem.sort_by_key(|&t| mat[t as usize]);
    let mut out = Malha { pos: Vec::with_capacity(nt * 9), nor: Vec::with_capacity(nt * 9), uv: Vec::with_capacity(nt * 6), cores, ..Default::default() };
    for (j, &t) in ordem.iter().enumerate() {
        let t = t as usize;
        let m = mat[t];
        match out.grupos.last_mut() {
            Some(g) if g[2] == m => g[1] += 3,
            _ => out.grupos.push([(j * 3) as u32, 3, m]),
        }
        let f = fnor[t];
        let (ax, ay, az) = (f[0].abs(), f[1].abs(), f[2].abs());
        for k in 0..3 {
            let v = idx[t * 3 + k] as usize;
            let (x, y, z) = (p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
            out.pos.extend_from_slice(&[x, y, z]);
            let q = ponto_de[v] as usize;
            let (mut sx, mut sy, mut sz) = (0f32, 0f32, 0f32);
            for &s in &tri_do_ponto[ini[q] as usize..ini[q + 1] as usize] {
                let g = fnor[s as usize];
                if g[0] * f[0] + g[1] * f[1] + g[2] * f[2] >= vinco {
                    sx += g[0];
                    sy += g[1];
                    sz += g[2];
                }
            }
            let l = (sx * sx + sy * sy + sz * sz).sqrt();
            let l = if l > 0.0 { l } else { 1.0 };
            out.nor.extend_from_slice(&[sx / l, sy / l, sz / l]);
            if az >= ax && az >= ay {
                out.uv.extend_from_slice(&[x * 0.5, y * 0.5]);
            } else if ax >= ay {
                out.uv.extend_from_slice(&[y * 0.5, z * 0.5]);
            } else {
                out.uv.extend_from_slice(&[x * 0.5, z * 0.5]);
            }
        }
    }
    out.esfera = esfera(&out.pos);
    out
}

/// computeBoundingSphere do three.js: o centro da caixa e a maior distancia ate ele
pub fn esfera(pos: &[f32]) -> [f32; 4] {
    if pos.len() < 3 {
        return [0.0; 4];
    }
    let (mut lo, mut hi) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
    for v in pos.chunks_exact(3) {
        for k in 0..3 {
            lo[k] = lo[k].min(v[k]);
            hi[k] = hi[k].max(v[k]);
        }
    }
    let c = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0];
    let mut r2 = 0f32;
    for v in pos.chunks_exact(3) {
        r2 = r2.max((v[0] - c[0]).powi(2) + (v[1] - c[1]).powi(2) + (v[2] - c[2]).powi(2));
    }
    [c[0], c[1], c[2], r2.sqrt()]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cubo_com_faces_coloridas_vira_um_grupo_por_cor() {
        // um cubo: 8 vertices, 12 triangulos, 6 faces de 2 triangulos; 3 faces vermelhas alternadas
        let p: Vec<f32> = vec![0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0., 0., 0., 1., 1., 0., 1., 1., 1., 1., 0., 1., 1.];
        let idx: Vec<u32> = vec![0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];
        let verm = Some([1.0, 0.0, 0.0]);
        let faces: Vec<Face> = (0..6).map(|i| Face { ini: i * 2, fim: i * 2 + 1, cor: if i % 2 == 0 { verm } else { None } }).collect();
        let m = prepara(&p, &idx, &faces);
        assert_eq!(m.pos.len(), 12 * 9);
        assert_eq!(m.cores.len(), 1);
        assert_eq!(m.grupos, vec![[0, 18, 0], [18, 18, 1]]);
        // quina de 90 graus > 35: a normal do vertice e a da propria face (viva)
        let n = &m.nor[0..3];
        assert!((n[0].abs() + n[1].abs() + n[2].abs() - 1.0).abs() < 1e-5);
    }
}
