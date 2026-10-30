//! A vista PCB desenhada direto na GPU (wgpu), dentro do render pass do egui.
//! Os buffers da placa sobem UMA vez por mudanca da placa; cada quadro so escreve um uniform de
//! 64 bytes e emite ~2 draw calls por camada visivel.

use bytemuck::{Pod, Zeroable};
use egui_wgpu::wgpu;
use egui_wgpu::wgpu::util::DeviceExt;
use nexo_core::scene::{Capsule, Scene, Vert};
use std::ops::Range;
use std::sync::Arc;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Default)]
pub struct ViewUniform {
    pub xf: [f32; 4],
    pub px: [f32; 4],
    pub grid1: [f32; 4],
    pub grid2: [f32; 4],
}

/// Uma malha avulsa (realce, selecao) ja pronta para subir.
#[derive(Default)]
pub struct Mesh {
    pub verts: Vec<Vert>,
    pub idx: Vec<u32>,
    pub caps: Vec<Capsule>,
}

struct GpuMesh {
    vbuf: Option<wgpu::Buffer>,
    ibuf: Option<wgpu::Buffer>,
    cbuf: Option<wgpu::Buffer>,
    n_idx: u32,
    n_caps: u32,
    gen: u64,
}

impl GpuMesh {
    fn upload(device: &wgpu::Device, verts: &[Vert], idx: &[u32], caps: &[Capsule], gen: u64, label: &str) -> GpuMesh {
        let mk = |data: &[u8], usage| {
            (!data.is_empty()).then(|| device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents: data, usage }))
        };
        GpuMesh {
            vbuf: mk(bytemuck::cast_slice(verts), wgpu::BufferUsages::VERTEX),
            ibuf: mk(bytemuck::cast_slice(idx), wgpu::BufferUsages::INDEX),
            cbuf: mk(bytemuck::cast_slice(caps), wgpu::BufferUsages::VERTEX),
            n_idx: idx.len() as u32,
            n_caps: caps.len() as u32,
            gen,
        }
    }
}

/// Os recursos da vista PCB, guardados no CallbackResources do egui-wgpu.
pub struct PcbGpu {
    tri: wgpu::RenderPipeline,
    board: wgpu::RenderPipeline,
    cap: wgpu::RenderPipeline,
    ubuf: wgpu::Buffer,
    bind: wgpu::BindGroup,
    scene: Option<GpuMesh>,
    hl: Option<GpuMesh>,
    sel: Option<GpuMesh>,
    dyn_caps: wgpu::Buffer,
    dyn_cap_n: u32,
    dyn_tris_v: wgpu::Buffer,
    dyn_tris_i: wgpu::Buffer,
    dyn_tri_n: u32,
}

const DYN_CAPS: u64 = 4096;
const DYN_TRIS: u64 = 1024;

impl PcbGpu {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, msaa: u32) -> PcbGpu {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("pcb.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("pcb.wgsl").into()),
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("pcb view"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pcb"),
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });
        let ubuf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("pcb view uniform"),
            size: std::mem::size_of::<ViewUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("pcb view"),
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: ubuf.as_entire_binding() }],
        });
        let vert_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vert>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Unorm8x4],
        };
        let cap_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Capsule>() as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Float32, 3 => Unorm8x4],
        };
        let target = [Some(wgpu::ColorTargetState {
            format,
            blend: Some(wgpu::BlendState::ALPHA_BLENDING),
            write_mask: wgpu::ColorWrites::ALL,
        })];
        let pipe = |vs: &str, fs: &str, buf: wgpu::VertexBufferLayout| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(fs),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some(vs),
                    compilation_options: Default::default(),
                    buffers: &[Some(buf)],
                },
                primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
                depth_stencil: None,
                multisample: wgpu::MultisampleState { count: msaa.max(1), mask: !0, alpha_to_coverage_enabled: false },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(fs),
                    compilation_options: Default::default(),
                    targets: &target,
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let tri = pipe("vs_tri", "fs_tri", vert_layout.clone());
        let board = pipe("vs_tri", "fs_board", vert_layout.clone());
        let cap = pipe("vs_cap", "fs_cap", cap_layout);
        let dyn_caps = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("pcb dyn caps"),
            size: DYN_CAPS * std::mem::size_of::<Capsule>() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let dyn_tris_v = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("pcb dyn tris v"),
            size: DYN_TRIS * std::mem::size_of::<Vert>() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let dyn_tris_i = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("pcb dyn tris i"),
            size: DYN_TRIS * 3 * 4,
            usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        PcbGpu { tri, board, cap, ubuf, bind, scene: None, hl: None, sel: None, dyn_caps, dyn_cap_n: 0, dyn_tris_v, dyn_tris_i, dyn_tri_n: 0 }
    }
}

/// O que um quadro desenha: faixas da cena na ordem certa.
#[derive(Clone)]
pub struct DrawItem {
    pub tris: Range<u32>,
    pub caps: Range<u32>,
    pub board: bool,
}

pub struct PcbCallback {
    pub view: ViewUniform,
    pub scene: Arc<Scene>,
    pub scene_gen: u64,
    pub draws: Vec<DrawItem>,
    pub hl: Option<(Arc<Mesh>, u64)>,
    pub sel: Option<(Arc<Mesh>, u64)>,
    /// por quadro: escurecer o resto (realce de net), marcas que dependem do zoom
    pub dyn_tris: Vec<Vert>,
    pub dyn_tri_idx: Vec<u32>,
    pub dyn_caps: Vec<Capsule>,
    /// os dyn_tris (veu) vao ANTES do realce; os dyn_caps por ultimo
    pub veil_before_hl: bool,
}

impl egui_wgpu::CallbackTrait for PcbCallback {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        _sd: &egui_wgpu::ScreenDescriptor,
        _enc: &mut wgpu::CommandEncoder,
        res: &mut egui_wgpu::CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        let Some(g) = res.get_mut::<PcbGpu>() else { return Vec::new() };
        queue.write_buffer(&g.ubuf, 0, bytemuck::bytes_of(&self.view));
        if g.scene.as_ref().map(|s| s.gen) != Some(self.scene_gen) {
            g.scene = Some(GpuMesh::upload(device, &self.scene.verts, &self.scene.indices, &self.scene.caps, self.scene_gen, "pcb scene"));
        }
        match &self.hl {
            Some((m, gen)) if g.hl.as_ref().map(|h| h.gen) != Some(*gen) => {
                g.hl = Some(GpuMesh::upload(device, &m.verts, &m.idx, &m.caps, *gen, "pcb hl"))
            }
            None => g.hl = None,
            _ => {}
        }
        match &self.sel {
            Some((m, gen)) if g.sel.as_ref().map(|h| h.gen) != Some(*gen) => {
                g.sel = Some(GpuMesh::upload(device, &m.verts, &m.idx, &m.caps, *gen, "pcb sel"))
            }
            None => g.sel = None,
            _ => {}
        }
        let nc = self.dyn_caps.len().min(DYN_CAPS as usize);
        if nc > 0 {
            queue.write_buffer(&g.dyn_caps, 0, bytemuck::cast_slice(&self.dyn_caps[..nc]));
        }
        g.dyn_cap_n = nc as u32;
        let nt = self.dyn_tri_idx.len().min(DYN_TRIS as usize * 3);
        if nt > 0 && self.dyn_tris.len() <= DYN_TRIS as usize {
            queue.write_buffer(&g.dyn_tris_v, 0, bytemuck::cast_slice(&self.dyn_tris));
            queue.write_buffer(&g.dyn_tris_i, 0, bytemuck::cast_slice(&self.dyn_tri_idx[..nt]));
            g.dyn_tri_n = nt as u32;
        } else {
            g.dyn_tri_n = 0;
        }
        Vec::new()
    }

    fn paint(&self, _info: egui::PaintCallbackInfo, rp: &mut wgpu::RenderPass<'static>, res: &egui_wgpu::CallbackResources) {
        let Some(g) = res.get::<PcbGpu>() else { return };
        let Some(sc) = &g.scene else { return };
        rp.set_bind_group(0, &g.bind, &[]);
        let draw_mesh = |rp: &mut wgpu::RenderPass<'static>, m: &GpuMesh, tris: Range<u32>, caps: Range<u32>, board: bool| {
            if !tris.is_empty() {
                if let (Some(vb), Some(ib)) = (&m.vbuf, &m.ibuf) {
                    rp.set_pipeline(if board { &g.board } else { &g.tri });
                    rp.set_vertex_buffer(0, vb.slice(..));
                    rp.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
                    rp.draw_indexed(tris, 0, 0..1);
                }
            }
            if !caps.is_empty() {
                if let Some(cb) = &m.cbuf {
                    rp.set_pipeline(&g.cap);
                    rp.set_vertex_buffer(0, cb.slice(..));
                    rp.draw(0..6, caps);
                }
            }
        };
        for d in &self.draws {
            draw_mesh(rp, sc, d.tris.clone(), d.caps.clone(), d.board);
        }
        let veil = |rp: &mut wgpu::RenderPass<'static>| {
            if g.dyn_tri_n > 0 {
                rp.set_pipeline(&g.tri);
                rp.set_vertex_buffer(0, g.dyn_tris_v.slice(..));
                rp.set_index_buffer(g.dyn_tris_i.slice(..), wgpu::IndexFormat::Uint32);
                rp.draw_indexed(0..g.dyn_tri_n, 0, 0..1);
            }
        };
        if self.veil_before_hl {
            veil(rp);
        }
        if let Some(h) = &g.hl {
            draw_mesh(rp, h, 0..h.n_idx, 0..h.n_caps, false);
        }
        if !self.veil_before_hl {
            veil(rp);
        }
        if let Some(h) = &g.sel {
            draw_mesh(rp, h, 0..h.n_idx, 0..h.n_caps, false);
        }
        if g.dyn_cap_n > 0 {
            rp.set_pipeline(&g.cap);
            rp.set_vertex_buffer(0, g.dyn_caps.slice(..));
            rp.draw(0..6, 0..g.dyn_cap_n);
        }
    }
}
