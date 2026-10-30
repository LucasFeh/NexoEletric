// O icone e a ficha do .exe (recursos/nexoeletric.rc), compilados com o rc.exe do Windows SDK.
fn main() {
    println!("cargo:rerun-if-changed=recursos/nexoeletric.rc");
    println!("cargo:rerun-if-changed=recursos/nexoeletric.ico");
    #[cfg(windows)]
    embed_resource::compile("recursos/nexoeletric.rc", embed_resource::NONE).manifest_optional().unwrap();
}
