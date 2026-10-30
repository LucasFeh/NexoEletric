//! O tema escuro do hub (hub-tema.css) no egui.

use egui::{Color32, CornerRadius, Stroke};

pub fn apply(ctx: &egui::Context) {
    ctx.set_theme(egui::Theme::Dark);
    ctx.global_style_mut(|s| {
        let v = &mut s.visuals;
        v.panel_fill = Color32::from_rgb(0x1e, 0x20, 0x24);
        v.window_fill = Color32::from_rgb(0x23, 0x26, 0x2b);
        v.extreme_bg_color = Color32::from_rgb(0x15, 0x17, 0x1a);
        v.faint_bg_color = Color32::from_rgb(0x26, 0x29, 0x2e);
        v.selection.bg_fill = Color32::from_rgb(0x1f, 0x5f, 0xa8);
        v.selection.stroke = Stroke::new(1.0, Color32::from_rgb(0x9c, 0xd0, 0xff));
        v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, Color32::from_rgb(0x33, 0x37, 0x3d));
        for w in [&mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
            w.corner_radius = CornerRadius::same(4);
        }
        s.spacing.item_spacing = egui::vec2(6.0, 4.0);
    });
}
