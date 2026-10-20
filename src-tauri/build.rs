fn main() {
    // The data folder is named after package.json's productName, as Electron's userData is.
    println!("cargo:rerun-if-changed=../package.json");
    let pkg = std::fs::read_to_string("../package.json").expect("read ../package.json");
    let pkg: serde_json::Value = serde_json::from_str(&pkg).expect("parse ../package.json");
    let name = pkg["productName"].as_str().expect("productName in package.json");
    println!("cargo:rustc-env=RIDE_PRODUCT_NAME={name}");
    tauri_build::build()
}
