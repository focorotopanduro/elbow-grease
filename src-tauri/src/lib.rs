#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Self-update pipeline.
    //
    //   tauri-plugin-updater : checks a signed JSON manifest on GitHub
    //                          Releases, downloads the new installer,
    //                          verifies its minisign signature, and
    //                          runs the installer.
    //   tauri-plugin-process : gives JS access to `relaunch()` so the
    //                          app can restart itself after installing.
    //
    // The actual "check on boot → prompt → install" logic lives in the
    // frontend (see `src/ui/UpdateManager.tsx`) so it can drive the UI.
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    // Phase 2: ComplianceDebugger opens IPC code deep-links externally.
    .plugin(tauri_plugin_shell::init())
    // Phase 4: project-bundle persistence (atomic rename, fsync, dir IO).
    .plugin(tauri_plugin_fs::init())
    // Phase 11.D: native open/save dialogs for .elbow bundles.
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
