//! NexoEletric nativo: o mesmo programa do Electron, em Rust, desenhado na GPU.
//!
//! Uso: NexoEletric [pasta-do-projeto] [--msaa N] [--novsync]
//!      [--bench SEGUNDOS --bench-idle SEGUNDOS --bench-out arquivo.json --bench-fase arquivo.txt]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod pcbview;
mod settings;
mod theme;

use std::path::PathBuf;

fn main() -> eframe::Result<()> {
    let t0 = std::time::Instant::now();
    let mut args = std::env::args().skip(1);
    let mut open: Option<PathBuf> = None;
    let mut bench_secs: Option<f64> = None;
    let mut bench_out = PathBuf::from("bench-rust.json");
    let mut bench_idle = 0.0;
    let mut bench_fase: Option<PathBuf> = None;
    let mut msaa: u32 = 4;
    let mut vsync = true;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--bench" => bench_secs = args.next().and_then(|s| s.parse().ok()),
            "--bench-idle" => bench_idle = args.next().and_then(|s| s.parse().ok()).unwrap_or(0.0),
            "--bench-fase" => bench_fase = args.next().map(PathBuf::from),
            "--bench-out" => bench_out = args.next().map(PathBuf::from).unwrap_or(bench_out),
            "--novsync" => vsync = false,
            "--msaa" => msaa = args.next().and_then(|s| s.parse().ok()).unwrap_or(4),
            _ => open = Some(PathBuf::from(a)),
        }
    }
    let bench = bench_secs.map(|s| app::Bench::new(s, bench_idle, bench_out, bench_fase, t0));
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("NexoEletric")
            .with_inner_size([1600.0, 950.0])
            .with_min_inner_size([800.0, 500.0])
            .with_maximized(true),
        multisampling: msaa as u16,
        renderer: eframe::Renderer::Wgpu,
        wgpu_options: egui_wgpu::WgpuConfiguration {
            surface: egui_wgpu::SurfaceConfig {
                present_mode: if vsync { egui_wgpu::wgpu::PresentMode::AutoVsync } else { egui_wgpu::wgpu::PresentMode::AutoNoVsync },
                ..egui_wgpu::SurfaceConfig::HIGH_THROUGHPUT
            },
            ..Default::default()
        },
        ..Default::default()
    };
    eframe::run_native(
        "NexoEletric",
        options,
        Box::new(move |cc| Ok(Box::new(app::NexoApp::new(cc, msaa, open, bench)))),
    )
}
