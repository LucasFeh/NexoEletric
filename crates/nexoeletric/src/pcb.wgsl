// A vista PCB na GPU. Mundo em mm (Y para cima); um uniform leva mundo -> NDC.
// Capsulas: segmento + largura desenhado por distancia (SDF) -- trilha, serigrafia, texto,
// arco, pad redondo/oval, via e furo, nitidos em qualquer zoom e com no minimo 1 pixel.

struct View {
    // ndc = pos * xf.xy + xf.zw
    xf: vec4<f32>,
    // x: mm por pixel, y: passo da grade (mm), z: grade ligada, w: alfa global
    px: vec4<f32>,
    // cores da grade (fina, grossa)
    grid1: vec4<f32>,
    grid2: vec4<f32>,
};

@group(0) @binding(0) var<uniform> v: View;

fn to_ndc(p: vec2<f32>) -> vec4<f32> {
    return vec4<f32>(p * v.xf.xy + v.xf.zw, 0.0, 1.0);
}

// ---------------- triangulos (pads retangulares, fills, regioes, texto de contorno) ----------------
struct TriOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) world: vec2<f32>,
};

@vertex
fn vs_tri(@location(0) pos: vec2<f32>, @location(1) color: vec4<f32>) -> TriOut {
    var o: TriOut;
    o.pos = to_ndc(pos);
    o.color = color;
    o.world = pos;
    return o;
}

@fragment
fn fs_tri(i: TriOut) -> @location(0) vec4<f32> {
    return vec4<f32>(i.color.rgb, i.color.a * v.px.w);
}

// a placa: preta, com a grade (so nela, como no Altium) calculada aqui -- sem geometria de grade
@fragment
fn fs_board(i: TriOut) -> @location(0) vec4<f32> {
    var c = i.color;
    if (v.px.z > 0.5) {
        let step = v.px.y;
        let g = i.world / step;
        let d = abs(fract(g - vec2<f32>(0.5)) - vec2<f32>(0.5)) * step / v.px.x;
        let k = abs(round(g) - 10.0 * round(g / 10.0));
        if (d.x < 0.5) {
            c = select(v.grid1, v.grid2, k.x < 0.5);
        }
        if (d.y < 0.5) {
            let cy = select(v.grid1, v.grid2, k.y < 0.5);
            if (d.x >= 0.5 || cy.r > c.r) {
                c = cy;
            }
        }
    }
    return c;
}

// ---------------- capsulas ----------------
struct CapOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) half_len: f32,
    @location(2) @interpolate(flat) radius: f32,
    @location(3) color: vec4<f32>,
};

@vertex
fn vs_cap(
    @builtin(vertex_index) vi: u32,
    @location(0) p0: vec2<f32>,
    @location(1) p1: vec2<f32>,
    @location(2) w: f32,
    @location(3) color: vec4<f32>,
) -> CapOut {
    let px = v.px.x;
    var r: f32;
    if (w < 0.0) {
        r = -w * px * 0.5;
    } else {
        r = max(w, px) * 0.5;
    }
    let d = p1 - p0;
    let len = length(d);
    var dir = vec2<f32>(1.0, 0.0);
    if (len > 1e-7) {
        dir = d / len;
    }
    let nrm = vec2<f32>(-dir.y, dir.x);
    let m = r + px;
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
    );
    let c = corners[vi];
    let hl = len * 0.5;
    let lx = c.x * (hl + m);
    let ly = c.y * m;
    let world = (p0 + p1) * 0.5 + dir * lx + nrm * ly;
    var o: CapOut;
    o.pos = to_ndc(world);
    o.local = vec2<f32>(lx, ly);
    o.half_len = hl;
    o.radius = r;
    o.color = color;
    return o;
}

@fragment
fn fs_cap(i: CapOut) -> @location(0) vec4<f32> {
    let q = vec2<f32>(max(abs(i.local.x) - i.half_len, 0.0), i.local.y);
    let dist = length(q) - i.radius;
    let a = clamp(0.5 - dist / v.px.x, 0.0, 1.0);
    if (a <= 0.0) {
        discard;
    }
    return vec4<f32>(i.color.rgb, i.color.a * a * v.px.w);
}
